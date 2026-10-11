// ファイル名の空白の置き換えと、EPUB 2.0.1 で使えない要素の警告（ADR 0019）
import { expect } from '@std/expect';
import { stub } from '@std/testing/mock';
import { type Book, buildEpub } from '../mod.ts';
import { loadBook, type LoadWarning } from '../load.ts';
import { replaceSpaces } from '../src/load/load-book.ts';
import { unzipText } from './helpers/unzip.ts';

const BOOK_TOML = 'identifier = "id"\ntitle = "t"\nlanguage = "ja"\n';
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

async function load(
  tree: Record<string, string | Uint8Array>,
  version: '2.0.1' | '3.0' = '3.0',
  toml = BOOK_TOML,
): Promise<{ book: Book; warnings: LoadWarning[] }> {
  const dir = await Deno.makeTempDir({ prefix: 'epub-builder-test-' });
  try {
    for (const [path, content] of Object.entries({ 'book.toml': toml, ...tree })) {
      const full = `${dir}/${path}`;
      await Deno.mkdir(full.slice(0, full.lastIndexOf('/')), { recursive: true });
      if (typeof content === 'string') await Deno.writeTextFile(full, content);
      else await Deno.writeFile(full, content);
    }
    const warnings: LoadWarning[] = [];
    const book = await loadBook(dir, { version, onWarning: (w) => warnings.push(w) });
    return { book, warnings };
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test('空白類を _ に置き換える', () => {
  expect(replaceSpaces('a b\tc　d e f')).toBe('a_b_c_d_e_f');
  expect(replaceSpaces('a  b')).toBe('a__b');
  expect(replaceSpaces('assets/画像 集/図 1.png')).toBe('assets/画像_集/図_1.png');
  expect(replaceSpaces('a_b')).toBe('a_b');
});

Deno.test('assets/ のファイルとディレクトリの名前の空白を置き換え、参照を書き換える', async () => {
  const { book, warnings } = await load(
    {
      'body/a.md': '![a](../assets/画像%20集/図%201.png) ![b](<../assets/画像 集/全角　空白.png>)',
      'body/b.html': '<img src="../assets/画像 集/図 1.png"><a href="../assets/my style.css#x">css</a>',
      'assets/画像 集/図 1.png': png,
      'assets/画像 集/全角　空白.png': png,
      'assets/my style.css': 'p {}',
      'assets/plain.png': png,
    },
    '3.0',
    `${BOOK_TOML}cover_image = "assets/画像 集/図 1.png"\n`,
  );
  expect(book.images!.map((i) => i.path).sort()).toEqual([
    'assets/plain.png',
    'assets/画像_集/全角_空白.png',
    'assets/画像_集/図_1.png',
  ]);
  expect(book.stylesheets!.map((s) => s.path)).toEqual(['assets/my_style.css']);
  expect(book.coverImage).toBe('assets/画像_集/図_1.png');
  const enc = (s: string) => s.split('/').map(encodeURIComponent).join('/');
  expect(book.chapters[0].body).toContain(`src="../${enc('assets/画像_集/図_1.png')}"`);
  expect(book.chapters[0].body).toContain(`src="../${enc('assets/画像_集/全角_空白.png')}"`);
  expect(book.chapters[1].body).toContain('<a href="../assets/my_style.css#x">css</a>');
  expect(book.chapters[0].stylesheets).toEqual(['assets/my_style.css']);
  expect(warnings.map((w) => [w.code, w.path]).sort()).toEqual([
    ['renamed-file', 'assets/my style.css'],
    ['renamed-file', 'assets/画像 集/全角　空白.png'],
    ['renamed-file', 'assets/画像 集/図 1.png'],
  ]);
  expect(warnings[0].message).toContain('url()');
  const files = await unzipText(await buildEpub(book, { version: '3.0' }));
  expect([...files.keys()].some((name) => /\s/.test(name))).toBe(false);
});

Deno.test('置き換えた結果が重なるパスは例外になる', async () => {
  await expect(load({ 'body/a.md': 'a', 'assets/a b.png': png, 'assets/a_b.png': png })).rejects.toMatchObject({
    name: 'EpubInputError',
  });
  await expect(load({ 'body/a.md': 'a', 'assets/x y/a.png': png, 'assets/x_y/a.png': png })).rejects.toThrow(
    '空白を _ に置き換えると、ファイルのパスが重なる',
  );
});

Deno.test('本文と meta/ のファイル名の空白は警告しない', async () => {
  const { book, warnings } = await load({ 'body/0 a b.md': '# A', 'meta/colophon.md': 'c' });
  expect(warnings).toEqual([]);
  expect(book.chapters[0].title).toBe('A');
});

Deno.test('EPUB 2.0.1 の MathML と ruby 要素は、例外にせず位置付きで警告する', async () => {
  const tree = {
    'body/a.xhtml': '<p>\n  <math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi></math></p>',
    'body/b.html': '<p><ruby>漢<rt>かん</ruby> <math><mi>y</mi></math>',
    'body/c.md': '本文\n\n<ruby>字<rt>じ</rt></ruby>\n\n記法の漢字《かんじ》は警告しない',
  };
  const { book, warnings } = await load(tree, '2.0.1');
  expect(warnings.map((w) => [w.code, w.path, w.line, w.column])).toEqual([
    ['mathml-in-epub-2', 'body/a.xhtml', 2, 3],
    ['ruby-in-epub-2', 'body/b.html', 1, 4],
    ['mathml-in-epub-2', 'body/b.html', 1, 25],
    ['ruby-in-epub-2', 'body/c.md', 3, 1],
  ]);
  // 要素はそのまま出す
  expect(book.chapters[0].body).toContain('<math xmlns="http://www.w3.org/1998/Math/MathML">');
  expect(book.chapters[1].body).toContain('<ruby>漢<rt>かん</rt></ruby>');
  expect(book.chapters[2].body).toContain('<span class="ruby">');
  const v3 = await load(tree, '3.0');
  expect(v3.warnings).toEqual([]);
});

Deno.test('onWarning を渡さないと console.warn に書く', async () => {
  const dir = await Deno.makeTempDir({ prefix: 'epub-builder-test-' });
  const warn = stub(console, 'warn');
  try {
    await Deno.writeTextFile(`${dir}/book.toml`, BOOK_TOML);
    await Deno.mkdir(`${dir}/body`);
    await Deno.writeTextFile(`${dir}/body/a.html`, '<math><mi>x</mi></math>');
    await loadBook(dir, { version: '2.0.1' });
    expect(warn.calls.length).toBe(1);
    expect(warn.calls[0].args[0]).toBe(
      '警告: body/a.html:1:1: EPUB 2.0.1 の本文に MathML は書けない。作った EPUB は EPUBCheck で誤りになる',
    );
  } finally {
    warn.restore();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test('onWarning の中で例外を投げれば、警告を誤りにできる', async () => {
  await expect(
    load({ 'body/a.md': 'a', 'assets/a b.png': png }).then(() => undefined),
  ).resolves.toBe(undefined);
  const dir = await Deno.makeTempDir({ prefix: 'epub-builder-test-' });
  try {
    await Deno.writeTextFile(`${dir}/book.toml`, BOOK_TOML);
    await Deno.mkdir(`${dir}/body`);
    await Deno.writeTextFile(`${dir}/body/a.html`, '<ruby>a<rt>b</ruby>');
    await expect(
      loadBook(dir, {
        version: '2.0.1',
        onWarning: (w) => {
          throw new Error(w.code);
        },
      }),
    ).rejects.toThrow('ruby-in-epub-2');
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
