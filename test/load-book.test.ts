import { expect } from '@std/expect';
import { type Book, buildEpub, type Chapter, EpubInputError } from '../mod.ts';
import { loadBook } from '../load.ts';
import { compareCodePoints, stripSerial } from '../src/load/load-book.ts';
import { FIXTURES } from './fixtures.ts';
import { unzipText } from './helpers/unzip.ts';

const BOOK_TOML = `identifier = "urn:uuid:00000000-0000-4000-8000-000000000001"
title = "題名"
language = "ja"
`;

type Tree = Record<string, string | Uint8Array>;

async function withProject(tree: Tree, fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: 'epub-builder-test-' });
  try {
    for (const [path, content] of Object.entries(tree)) {
      const full = `${dir}/${path}`;
      await Deno.mkdir(full.slice(0, full.lastIndexOf('/')), { recursive: true });
      if (path.endsWith('/')) continue;
      if (typeof content === 'string') await Deno.writeTextFile(full, content);
      else await Deno.writeFile(full, content);
    }
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

const load = (tree: Tree, version: '2.0.1' | '3.0' = '3.0') => {
  let book: Book | undefined;
  return withProject(tree, async (dir) => {
    book = await loadBook(dir, { version });
  }).then(() => book!);
};

const titles = (chapters: Chapter[]): unknown[] =>
  chapters.map((c) => (c.children ? [c.title, titles(c.children)] : c.title));

Deno.test('符号位置の順で比べる', () => {
  const names = ['b', '2-x', '10-x', '\u{1F600}', '｡', 'a'];
  expect(names.sort(compareCodePoints)).toEqual(['10-x', '2-x', 'a', 'b', '｡', '\u{1F600}']);
  expect(stripSerial('01-序')).toBe('序');
  expect(stripSerial('01')).toBe('01');
  expect(stripSerial('01.')).toBe('01.');
});

Deno.test('book.toml を書誌情報に読む', async () => {
  const book = await load({
    'book.toml': `${BOOK_TOML}authors = ["一", "二"]
publisher = "出版者"
description = "説明"
modified = 2026-10-09T09:00:00+09:00
page_progression_direction = "rtl"
cover_image = "assets/c.png"
`,
    'body/a.md': 'a',
    'assets/c.png': new Uint8Array([1]),
  });
  expect(book.metadata).toEqual({
    identifier: 'urn:uuid:00000000-0000-4000-8000-000000000001',
    title: '題名',
    language: 'ja',
    authors: ['一', '二'],
    publisher: '出版者',
    description: '説明',
    modified: new Date('2026-10-09T00:00:00Z'),
  });
  expect(book.pageProgressionDirection).toBe('rtl');
  expect(book.coverImage).toBe('assets/c.png');
});

Deno.test('book.toml の誤りは例外になる', async () => {
  const cases: Record<string, string> = {
    'identifier がない': 'title = "a"\nlanguage = "ja"',
    '知らないキー': `${BOOK_TOML}titel = "a"`,
    '型が違う': `${BOOK_TOML}authors = "a"`,
    'ローカル日時': `${BOOK_TOML}modified = 2026-10-09T00:00:00`,
    '向きが違う': `${BOOK_TOML}page_progression_direction = "ttb"`,
    'ない表紙': `${BOOK_TOML}cover_image = "assets/none.png"`,
    'TOML の誤り': `${BOOK_TOML}title = "b"`,
  };
  for (const [label, toml] of Object.entries(cases)) {
    await expect(load({ 'book.toml': toml, 'body/a.md': 'a' }), label).rejects.toThrow(EpubInputError);
  }
  await expect(load({ 'body/a.md': 'a' })).rejects.toThrow('book.toml がない');
});

Deno.test('並びは符号位置の順で、連番の桁はそろえない', async () => {
  const book = await load({
    'book.toml': BOOK_TOML,
    'body/10-十.md': 'a',
    'body/2-二.md': 'a',
    'body/\u{1F600}.md': 'a',
    'body/｡.md': 'a',
    // NFD で書いた「が」は NFC に正規化して比べる
    'body/が.md': 'a',
    'body/がが.md': 'a',
  });
  expect(titles(book.chapters)).toEqual(['十', '二', 'が', 'がが', '｡', '\u{1F600}']);
});

Deno.test('目次と読み順を、ディレクトリの構成と見出しから決める', async () => {
  const book = await load({
    'book.toml': BOOK_TOML,
    'body/01-a.md': '# 題名《だいめい》\n\n本文',
    'body/02-部/index.html': '<h1>部の扉</h1>',
    'body/02-部/01-x.xhtml': '<p>見出しなし</p>',
    'body/03-章/01.md': '本文',
    'body/03-章/02-y/01-z.md': '# Z',
    'body/.hidden.md': 'x',
    'body/.dir/x.txt': 'x',
    'meta/cover.md': '表紙',
    'meta/colophon.md': '# 奥付',
  });
  expect(titles(book.chapters)).toEqual([
    '題名',
    ['部の扉', ['x']],
    ['章', ['01', ['y', ['Z']]]],
    '奥付',
  ]);
  expect(book.cover?.body).toBe('<p>表紙</p>');
  expect(book.chapters[2].body).toBe(undefined);
  const files = await unzipText(await buildEpub(book, { version: '3.0' }));
  // 目次の nav だけを見る（landmarks を除く）
  const nav = files.get('OEBPS/nav.xhtml')!.split('<nav epub:type="landmarks"')[0];
  expect(nav).not.toContain('0001.xhtml');
  expect(nav).toContain('<a href="text/0003.xhtml">部の扉</a>');
  // index のない章は、最初の子の文書を指す
  expect(nav).toContain('<a href="text/0005.xhtml">章</a>');
  expect(nav).toContain('<a href="text/0007.xhtml">奥付</a>');
});

Deno.test('ファイルの構成の誤りは例外になる', async () => {
  const cases: Record<string, Tree> = {
    '同じ名前の .md と .xhtml': { 'body/a.md': 'a', 'body/a.xhtml': '<p/>' },
    '知らない拡張子': { 'body/a.txt': 'a' },
    '大文字の拡張子': { 'body/a.MD': 'a' },
    'body/ がない': { 'meta/cover.md': 'a' },
    '空の body/': { 'body/': '' },
    '空のサブディレクトリ': { 'body/a.md': 'a', 'body/b/': '' },
    'meta/ の知らない名前': { 'body/a.md': 'a', 'meta/title.md': 'a' },
    'meta/ の重なる名前': { 'body/a.md': 'a', 'meta/cover.md': 'a', 'meta/cover.html': 'a' },
    'assets/ の知らない拡張子': { 'body/a.md': 'a', 'assets/font.woff': 'a' },
    'assets/ の大文字の拡張子': { 'body/a.md': 'a', 'assets/a.JPG': 'a' },
  };
  for (const [label, tree] of Object.entries(cases)) {
    await expect(load({ 'book.toml': BOOK_TOML, ...tree }), label).rejects.toThrow(EpubInputError);
  }
});

Deno.test('assets/ のスタイルシートを、すべての文書に符号位置の順で適用する', async () => {
  const book = await load({
    'book.toml': BOOK_TOML,
    'body/a.md': 'a',
    'meta/cover.md': 'c',
    'assets/z.css': 'z',
    'assets/b/a.css': 'a',
    'assets/i.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
  });
  expect(book.stylesheets!.map((s) => s.path)).toEqual(['assets/b/a.css', 'assets/z.css']);
  expect(book.images!.map((i) => [i.path, i.mediaType])).toEqual([['assets/i.svg', 'image/svg+xml']]);
  expect(book.chapters[0].stylesheets).toEqual(['assets/b/a.css', 'assets/z.css']);
  expect(book.cover!.stylesheets).toEqual(['assets/b/a.css', 'assets/z.css']);
});

Deno.test('参照を EPUB の中での相対パスに書き換える', async () => {
  const book = await load({
    'book.toml': BOOK_TOML,
    'body/01-a.md': '[次](02-dir/01-b.html#x) [画像](../assets/img/a%20b.png) [外](https://example.com/) [内](#y)',
    'body/02-dir/01-b.html': '<p id="x"><img src="../../assets/img/a b.png"></p><a href="../01-a.md">戻る</a>',
    'body/02-dir/02-c.xhtml':
      '<svg xmlns="http://www.w3.org/2000/svg"><image href="../../assets/img/a%20b.png"/></svg>',
    'assets/img/a b.png': new Uint8Array([1]),
  });
  expect(book.chapters[0].body).toBe(
    '<p><a href="0002.xhtml#x">次</a> <a href="../assets/img/a_b.png">画像</a> <a href="https://example.com/">外</a> <a href="#y">内</a></p>',
  );
  expect(book.chapters[1].children![0].body).toBe(
    '<p id="x"><img src="../assets/img/a_b.png"/></p><a href="0001.xhtml">戻る</a>',
  );
  expect(book.chapters[1].children![1].body).toContain('<image href="../assets/img/a_b.png"/>');
});

Deno.test('参照の誤りは例外になる', async () => {
  const cases: Record<string, string> = {
    '外部の画像': '![a](https://example.com/a.png)',
    '/ で始まる': '[a](/assets/a.png)',
    'プロジェクトの外': '[a](../../a.md)',
    'ないファイル': '[a](none.md)',
    'assets/ の外の画像': '![a](../book.toml)',
  };
  for (const [label, md] of Object.entries(cases)) {
    await expect(load({ 'book.toml': BOOK_TOML, 'body/a.md': md }), label).rejects.toThrow(EpubInputError);
  }
  await expect(load({ 'book.toml': BOOK_TOML, 'body/a.xhtml': '<p>\n<b></p>' })).rejects.toThrow(
    'body/a.xhtml:2:4:',
  );
});

Deno.test('ルビと脚注は loadBook に渡した版の形で出る', async () => {
  const tree = { 'book.toml': BOOK_TOML, 'body/a.md': '漢字《かんじ》[^1]\n\n[^1]: 注' };
  expect((await load(tree, '2.0.1')).chapters[0].body).toContain('<span class="rb">漢字</span>');
  expect((await load(tree, '3.0')).chapters[0].body).toContain('epub:type="footnote"');
});

Deno.test('すべてのフィクスチャから、決めた版の EPUB を作れる', async () => {
  for (const [name, versions] of Object.entries(FIXTURES)) {
    for (const version of versions) {
      const book = await loadBook(`test/fixtures/${name}`, { version });
      const files = await unzipText(await buildEpub(book, { version }));
      expect(files.get('mimetype'), `${name} ${version}`).toBe('application/epub+zip');
    }
  }
});

Deno.test('EPUB 3.0 にしかない機能を使うフィクスチャは、EPUB 2.0.1 では例外になる', async () => {
  await expect(loadBook('test/fixtures/epub3-book', { version: '2.0.1' })).rejects.toThrow(EpubInputError);
});

Deno.test('test/fixtures/ のディレクトリはすべて一覧に載っている', async () => {
  const dirs: string[] = [];
  for await (const entry of Deno.readDir('test/fixtures')) if (entry.isDirectory) dirs.push(entry.name);
  expect(dirs.sort()).toEqual(Object.keys(FIXTURES).sort());
});
