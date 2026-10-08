// loadBook の細かな場合
import { expect } from '@std/expect';
import { type Book, buildEpub, type Chapter, EpubInputError } from '../mod.ts';
import { loadBook } from '../load.ts';
import { unzipText } from './helpers/unzip.ts';

const BOOK_TOML = 'identifier = "id"\ntitle = "t"\nlanguage = "ja"\n';

type Tree = Record<string, string | Uint8Array | { symlink: string }>;

async function project<T>(tree: Tree, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await Deno.makeTempDir({ prefix: 'epub-builder-test-' });
  try {
    for (const [path, content] of Object.entries(tree)) {
      const full = `${dir}/${path}`;
      await Deno.mkdir(full.slice(0, full.lastIndexOf('/')), { recursive: true });
      if (path.endsWith('/')) continue;
      if (typeof content === 'string') await Deno.writeTextFile(full, content);
      else if (content instanceof Uint8Array) await Deno.writeFile(full, content);
      else await Deno.symlink(content.symlink, full);
    }
    return await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

const load = (tree: Tree, version: '2.0.1' | '3.0' = '3.0'): Promise<Book> =>
  project({ 'book.toml': BOOK_TOML, ...tree }, (dir) => loadBook(dir, { version }));

const titles = (chapters: Chapter[]): unknown[] =>
  chapters.map((c) => (c.children ? [c.title, titles(c.children)] : c.title));

Deno.test('題名の決め方の細かな場合', async (t) => {
  await t.step('見出しの空白はまとめる', async () => {
    const book = await load({ 'body/a.html': '<h2>\n  題\n\t名  </h2>' });
    expect(book.chapters[0].title).toBe('題 名');
  });
  await t.step('空の見出しはファイルの名前にする', async () => {
    const book = await load({ 'body/01-名前.html': '<h1> </h1><h2>次</h2>' });
    expect(book.chapters[0].title).toBe('名前');
  });
  await t.step('最初の見出しのレベルを問わない', async () => {
    const book = await load({ 'body/a.md': '#### 四\n\n# 一' });
    expect(book.chapters[0].title).toBe('四');
  });
  await t.step('Setext の見出し', async () => {
    const book = await load({ 'body/a.md': '二\n---' });
    expect(book.chapters[0].title).toBe('二');
  });
  await t.step('入れ子の要素の中の見出し', async () => {
    const book = await load({ 'body/a.xhtml': '<section><header><h1>中</h1></header></section>' });
    expect(book.chapters[0].title).toBe('中');
  });
  await t.step('見出しのない奥付はファイルの名前', async () => {
    const book = await load({ 'body/a.md': 'a', 'meta/colophon.html': '<p>c</p>' });
    expect(book.chapters.at(-1)!.title).toBe('colophon');
  });
  await t.step('連番の区切りの種類', async () => {
    const book = await load({ 'body/1_a.md': 'a', 'body/2.b.md': 'b', 'body/3-c.md': 'c', 'body/4 d.md': 'd' });
    expect(titles(book.chapters)).toEqual(['a', 'b', 'c', '4 d']);
  });
  await t.step('ディレクトリの名前の連番', async () => {
    const book = await load({ 'body/01-部/a.md': 'a', 'body/02/b.md': 'b' });
    expect(titles(book.chapters)).toEqual([['部', ['a']], ['02', ['b']]]);
  });
  await t.step('EPUB 2.0.1 の括弧書きのルビは親文字だけを題名にする', async () => {
    const book = await load({ 'body/a.md': '# 漢字《かんじ》' }, '2.0.1');
    expect(book.chapters[0].title).toBe('漢字');
  });
});

Deno.test('index の細かな場合', async (t) => {
  await t.step('index.xhtml と index.html', async () => {
    const book = await load({
      'body/a/index.xhtml': '<h1>A</h1>',
      'body/a/x.md': 'x',
      'body/b/index.html': '<h1>B</h1>',
      'body/b/y.md': 'y',
    });
    expect(titles(book.chapters)).toEqual([['A', ['x']], ['B', ['y']]]);
  });
  await t.step('index は名前の順に関わらず先頭にする', async () => {
    const book = await load({ 'body/a/0.md': '0', 'body/a/index.md': '# I' });
    expect(book.chapters[0].body).toBe('<h1>I</h1>');
    expect(titles(book.chapters)).toEqual([['I', ['0']]]);
  });
  await t.step('index だけのディレクトリ', async () => {
    const book = await load({ 'body/a/index.md': '# I' });
    expect(book.chapters).toEqual([{ title: 'I', body: '<h1>I</h1>', stylesheets: [], children: [] }]);
  });
  await t.step('body/ の直下の index は普通の文書', async () => {
    const book = await load({ 'body/index.md': 'i', 'body/a.md': 'a' });
    expect(titles(book.chapters)).toEqual(['a', 'index']);
  });
  await t.step('index という名前のディレクトリは index の文書でない', async () => {
    const book = await load({ 'body/a/index/x.md': 'x', 'body/a/b.md': 'b' });
    expect(titles(book.chapters)).toEqual([['a', ['b', ['index', ['x']]]]]);
  });
  await t.step('同じディレクトリの index.md と index.html', async () => {
    await expect(load({ 'body/a/index.md': 'a', 'body/a/index.html': 'b' })).rejects.toThrow(EpubInputError);
  });
  await t.step('最初の子がディレクトリのとき、その中の最初の文書を指す', async () => {
    const book = await load({ 'body/a/1/x.md': 'x', 'body/a/2.md': 'y' });
    const files = await unzipText(await buildEpub(book, { version: '3.0' }));
    expect(files.get('OEBPS/nav.xhtml')).toMatch(
      /<a href="text\/0001.xhtml">a<\/a>\s*<ol>\s*<li><a href="text\/0001.xhtml">1<\/a>/,
    );
  });
});

Deno.test('meta/ の細かな場合', async (t) => {
  await t.step('HTML の表紙と XHTML の奥付', async () => {
    const book = await load({
      'body/a.md': 'a',
      'meta/cover.html': '<p>c<br>',
      'meta/colophon.xhtml': '<h1>奥付</h1>',
    });
    expect(book.cover!.body).toBe('<p>c<br/></p>');
    expect(book.chapters.at(-1)).toMatchObject({ title: '奥付', body: '<h1>奥付</h1>' });
  });
  await t.step('meta/ の中の . で始まるファイルは無視する', async () => {
    const book = await load({ 'body/a.md': 'a', 'meta/.DS_Store': 'x' });
    expect(book.cover).toBe(undefined);
  });
  await t.step('meta/ のディレクトリ', async () => {
    await expect(load({ 'body/a.md': 'a', 'meta/cover/': '' })).rejects.toThrow(EpubInputError);
  });
  await t.step('meta/ の知らない拡張子', async () => {
    await expect(load({ 'body/a.md': 'a', 'meta/cover.txt': 'x' })).rejects.toThrow(EpubInputError);
  });
});

Deno.test('参照の細かな場合', async (t) => {
  const assets = { 'assets/i.png': new Uint8Array([1]), 'assets/s.css': '' };
  await t.step('表紙から assets/ の画像を指す', async () => {
    const book = await load({ ...assets, 'body/a.md': 'a', 'meta/cover.md': '![](../assets/i.png)' });
    expect(book.cover!.body).toBe('<p><img src="../assets/i.png" alt=""/></p>');
  });
  await t.step('本文から奥付を指す', async () => {
    const book = await load({ 'body/a.md': '[奥付](../meta/colophon.md)', 'meta/colophon.md': 'c' });
    expect(book.chapters[0].body).toBe('<p><a href="0002.xhtml">奥付</a></p>');
  });
  await t.step('リンクで assets/ のスタイルシートを指す', async () => {
    const book = await load({ ...assets, 'body/a.md': '[css](../assets/s.css#x)' });
    expect(book.chapters[0].body).toBe('<p><a href="../assets/s.css#x">css</a></p>');
  });
  await t.step('同じ文書への参照', async () => {
    const book = await load({ 'body/a.md': '[自分](a.md#x) [自分](./a.md)' });
    expect(book.chapters[0].body).toBe('<p><a href="0001.xhtml#x">自分</a> <a href="0001.xhtml">自分</a></p>');
  });
  await t.step('上に出てから戻る参照', async () => {
    const book = await load({ 'body/d/a.md': '[b](../../body/./b.md)', 'body/b.md': 'b' });
    // b.md が d/ より先に並ぶ
    expect(book.chapters[1].children![0].body).toBe('<p><a href="0001.xhtml">b</a></p>');
  });
  await t.step('NFD で書いた参照を NFC のファイルに解決する', async () => {
    const book = await load({ 'body/が.md': '[x](が.md)' });
    expect(book.chapters[0].body).toBe('<p><a href="0001.xhtml">x</a></p>');
  });
  await t.step('mailto と tel は書き換えない', async () => {
    const book = await load({ 'body/a.html': '<a href="mailto:a@example.com">m</a><a href="tel:0">t</a>' });
    expect(book.chapters[0].body).toBe('<a href="mailto:a@example.com">m</a><a href="tel:0">t</a>');
  });
  await t.step('href のない a と src のない img', async () => {
    const book = await load({ 'body/a.html': '<a id="x">a</a><img alt="">' });
    expect(book.chapters[0].body).toBe('<a id="x">a</a><img alt=""/>');
  });
  const invalid: [string, string][] = [
    ['画像でスタイルシートを指す', '<img src="../assets/s.css">'],
    ['表紙の画像で外部を指す', '<svg><image href="https://example.com/a.png"/></svg>'],
    ['xlink:href で外部の画像を指す', '<svg><image xlink:href="http://example.com/a.png"/></svg>'],
    ['ディレクトリを指す', '<a href="../assets">x</a>'],
    ['クエリを含む', '<a href="b.md?x=1">x</a>'],
    ['正しくないパーセントエンコード', '<a href="%E3%81">x</a>'],
    ['プロジェクトの直下のファイルを指す', '<a href="../book.toml">x</a>'],
    ['プロトコル相対の参照', '<img src="//example.com/a.png">'],
    ['data: の画像', '<img src="data:image/png;base64,AA==">'],
  ];
  for (const [label, src] of invalid) {
    await t.step(label, async () => {
      await expect(load({ ...assets, 'body/a.html': src, 'body/b.md': 'b' })).rejects.toThrow(EpubInputError);
    });
  }
  await t.step('例外はファイルと位置を示す', async () => {
    await expect(load({ 'body/d/a.html': '<p>x</p>\n<p>\n  <img src="none.png"></p>' })).rejects.toThrow(
      /^body\/d\/a\.html:3:3: assets\/ の下にない画像を指す参照: none\.png$/,
    );
  });
});

Deno.test('ファイルとディレクトリの細かな場合', async (t) => {
  await t.step('シンボリックリンクのファイルとディレクトリをたどる', async () => {
    const book = await project({
      'book.toml': BOOK_TOML,
      'src/x.md': '# X',
      'src/d/y.md': '# Y',
      'body/1.md': { symlink: '../src/x.md' },
      'body/2': { symlink: '../src/d' },
    }, (dir) => loadBook(dir, { version: '3.0' }));
    expect(titles(book.chapters)).toEqual(['X', ['2', ['Y']]]);
  });
  await t.step('ディレクトリの末尾の / を許す', async () => {
    const book = await project(
      { 'book.toml': BOOK_TOML, 'body/a.md': 'a' },
      (dir) => loadBook(`${dir}/`, { version: '3.0' }),
    );
    expect(book.chapters.length).toBe(1);
  });
  await t.step('UTF-8 でない本文', async () => {
    await expect(load({ 'body/a.md': new Uint8Array([0xff, 0xfe]) })).rejects.toThrow('body/a.md: UTF-8 でない');
  });
  await t.step('UTF-8 でない book.toml', async () => {
    await expect(
      project(
        { 'book.toml': new Uint8Array([0x61, 0x3d, 0xff]), 'body/a.md': 'a' },
        (dir) => loadBook(dir, { version: '3.0' }),
      ),
    ).rejects.toThrow('book.toml が UTF-8 でない');
  });
  await t.step('book.toml の誤りは位置を示す', async () => {
    await expect(
      project({ 'book.toml': `${BOOK_TOML}x = `, 'body/a.md': 'a' }, (dir) => loadBook(dir, { version: '3.0' })),
    ).rejects.toThrow(/^book\.toml:4:5: /);
  });
  await t.step('assets/ の . で始まるファイルとディレクトリを無視する', async () => {
    const book = await load({ 'body/a.md': 'a', 'assets/.DS_Store': 'x', 'assets/.git/x': 'x' });
    expect(book.stylesheets).toEqual([]);
    expect(book.images).toEqual([]);
  });
  await t.step('空の assets/ のディレクトリ', async () => {
    const book = await load({ 'body/a.md': 'a', 'assets/': '' });
    expect(book.images).toEqual([]);
  });
  await t.step('cover_image でスタイルシートを指す', async () => {
    await expect(
      project(
        { 'book.toml': `${BOOK_TOML}cover_image = "assets/s.css"`, 'body/a.md': 'a', 'assets/s.css': '' },
        (dir) => loadBook(dir, { version: '3.0' }),
      ),
    ).rejects.toThrow(EpubInputError);
  });
  await t.step('知らない版', async () => {
    await expect(load({ 'body/a.md': 'a' }, '3.1' as '3.0')).rejects.toThrow(EpubInputError);
  });
  await t.step('同じ名前のファイルとディレクトリは並べて読む', async () => {
    const book = await load({ 'body/a.md': '# A', 'body/a/b.md': '# B' });
    expect(titles(book.chapters)).toEqual([['a', ['B']], 'A']);
  });
});

Deno.test('読んだ本は、どちらの版でも buildEpub が受け付ける', async () => {
  for (const version of ['2.0.1', '3.0'] as const) {
    const book = await load({
      'body/01.md': '# 一\n\n漢字《かんじ》[^1]\n\n[^1]: 注',
      'body/02/index.html': '<h1>二</h1>',
      'body/02/a.xhtml': '<p>a</p>',
      'meta/cover.md': '![表紙](../assets/c.png)',
      'meta/colophon.md': '# 奥付',
      'assets/c.png': new Uint8Array([1]),
      'assets/s.css': 'p{}',
    }, version);
    const files = await unzipText(await buildEpub(book, { version }));
    expect([...files.keys()].filter((n) => n.startsWith('OEBPS/text/')).length).toBe(5);
  }
});
