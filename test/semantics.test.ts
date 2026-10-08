// EPUB 3.0 の部・章・節の意味づけ（ADR 0012）
import { expect } from '@std/expect';
import type { Element, Root } from 'hast';
import { type Book, buildEpub, EpubInputError } from '../mod.ts';
import { loadBook } from '../load.ts';
import { sourceToTree } from '../src/load/convert.ts';
import { extractSections, wrapSections } from '../src/load/load-book.ts';
import { writeXhtml } from '../src/load/xhtml-writer.ts';
import { unzipText } from './helpers/unzip.ts';

/** 節を取り出して section で囲み、改行を除いた XHTML にする */
function wrap(src: string, format: 'md' | 'html' = 'md'): string {
  const tree = sourceToTree(src, format, '3.0') as Root;
  const headings = new Set<Element>();
  extractSections(tree, headings);
  wrapSections(tree, headings);
  return writeXhtml(tree, '3.0').replace(/\n/g, '');
}

Deno.test('節の section 要素', async (t) => {
  await t.step('見出しのレベルで入れ子にする', () => {
    expect(wrap('# 題\n\nA\n\n## 一\n\nB\n\n### 一の一\n\nC\n\n## 二\n\nD')).toBe(
      '<h1>題</h1><p>A</p>' +
        '<section><h2 id="sec-1">一</h2><p>B</p>' +
        '<section><h3 id="sec-2">一の一</h3><p>C</p></section></section>' +
        '<section><h2 id="sec-3">二</h2><p>D</p></section>',
    );
  });
  await t.step('レベルが飛ぶ見出し', () => {
    expect(wrap('# 題\n\n## 一\n\n#### 深い\n\n### 浅い')).toBe(
      '<h1>題</h1><section><h2 id="sec-1">一</h2>' +
        '<section><h4 id="sec-2">深い</h4></section>' +
        '<section><h3 id="sec-3">浅い</h3></section></section>',
    );
  });
  await t.step('題名とそれより前の内容は囲まない', () => {
    expect(wrap('前\n\n## 題\n\n後')).toBe('<p>前</p><h2>題</h2><p>後</p>');
  });
  await t.step('脚注の欄は section の外に出す', () => {
    expect(wrap('# 題\n\n## 一\n\n本文[^a]\n\n[^a]: 注')).toMatch(
      /<\/section><div class="footnotes"><aside class="footnote"/,
    );
  });
  await t.step('ほかの要素の中の見出しは囲まないが、目次の節には残す', () => {
    const tree = sourceToTree('<h1>題</h1><div><h2>中</h2><p>x</p></div><h2>外</h2><p>y</p>', 'html', '3.0') as Root;
    const headings = new Set<Element>();
    const sections = extractSections(tree, headings);
    wrapSections(tree, headings);
    expect(sections.map((s) => s.title)).toEqual(['中', '外']);
    expect(writeXhtml(tree, '3.0')).toBe(
      '<h1>題</h1><div><h2 id="sec-1">中</h2><p>x</p></div><section><h2 id="sec-2">外</h2><p>y</p></section>',
    );
  });
  await t.step('節にしない空の見出しは section を始めない', () => {
    expect(wrap('# 題\n\n## 一\n\n## \n\nx')).toBe(
      '<h1>題</h1><section><h2 id="sec-1">一</h2><h2></h2><p>x</p></section>',
    );
  });
  await t.step('直接書いた section の中の見出しは、さらに囲まない', () => {
    expect(wrap('<h1>題</h1><section><h2>中</h2></section>', 'html')).toBe(
      '<h1>題</h1><section><h2 id="sec-1">中</h2></section>',
    );
  });
});

const book = (chapter: Partial<Book['chapters'][0]> = {}): Book => ({
  metadata: { identifier: 'id', title: 't', language: 'ja', modified: new Date('2026-01-01T00:00:00Z') },
  cover: { body: '<p>c</p>', epubType: 'frontmatter cover' },
  chapters: [{ title: '章', body: '<p>a</p>', epubType: 'bodymatter chapter', ...chapter }],
});

Deno.test('buildEpub は EPUB 3.0 でだけ body に epub:type を書く', async () => {
  const v3 = await unzipText(await buildEpub(book(), { version: '3.0' }));
  expect(v3.get('OEBPS/text/0001.xhtml')).toContain('<body epub:type="frontmatter cover">');
  expect(v3.get('OEBPS/text/0002.xhtml')).toContain('<body epub:type="bodymatter chapter">');
  const v2 = await unzipText(await buildEpub(book(), { version: '2.0.1' }));
  expect(v2.get('OEBPS/text/0002.xhtml')).toContain('<body>');
  expect(v2.get('OEBPS/text/0002.xhtml')).not.toContain('epub:type');
});

Deno.test('buildEpub は epubType の誤りを例外にする', async () => {
  for (const epubType of [' ', 'a\u0000']) {
    await expect(buildEpub(book({ epubType }), { version: '3.0' })).rejects.toThrow(EpubInputError);
  }
  const files = await unzipText(await buildEpub(book({ epubType: 'a"<&' }), { version: '3.0' }));
  expect(files.get('OEBPS/text/0002.xhtml')).toContain('<body epub:type="a&quot;&lt;&amp;">');
});

Deno.test('loadBook はどちらの版でも文書の役割を epubType にする', async () => {
  const dir = await Deno.makeTempDir({ prefix: 'epub-builder-test-' });
  try {
    const files: Record<string, string> = {
      'book.toml': 'identifier = "id"\ntitle = "t"\nlanguage = "ja"\n',
      'body/00.md': '# 序',
      'body/部/index.md': '# 部',
      'body/部/章/index.md': '# 深い扉',
      'body/部/章/節.md': '# 節の文書',
      'body/扉なし/a.md': '# a',
      'meta/cover.md': '表紙',
      'meta/colophon.md': '# 奥付',
    };
    for (const [path, content] of Object.entries(files)) {
      await Deno.mkdir(`${dir}/${path.slice(0, path.lastIndexOf('/'))}`, { recursive: true });
      await Deno.writeTextFile(`${dir}/${path}`, content);
    }
    const v3 = await loadBook(dir, { version: '3.0' });
    const roles = (chapters: Book['chapters']): unknown[] =>
      chapters.map((c) => [c.title, c.epubType, ...(c.children ? [roles(c.children)] : [])]);
    expect(v3.cover!.epubType).toBe('frontmatter cover');
    expect(roles(v3.chapters)).toEqual([
      ['序', 'bodymatter chapter'],
      // 「扉」（U+6249）は「部」（U+90E8）より前に並ぶ
      ['扉なし', undefined, [['a', 'bodymatter chapter']]],
      ['部', 'bodymatter part', [['深い扉', 'bodymatter division', [['節の文書', 'bodymatter chapter']]]]],
      ['奥付', 'backmatter colophon'],
    ]);
    // EPUB 2.0.1 でも guide のために役割を付ける（ADR 0012）
    const v2 = await loadBook(dir, { version: '2.0.1' });
    expect(v2.cover!.epubType).toBe('frontmatter cover');
    expect(roles(v2.chapters)).toEqual(roles(v3.chapters));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test('EPUB 2.0.1 では section で囲まない', async () => {
  const dir = await Deno.makeTempDir({ prefix: 'epub-builder-test-' });
  try {
    await Deno.writeTextFile(`${dir}/book.toml`, 'identifier = "id"\ntitle = "t"\nlanguage = "ja"\n');
    await Deno.mkdir(`${dir}/body`);
    await Deno.writeTextFile(`${dir}/body/a.md`, '# 題\n\n## 一\n\nx');
    expect((await loadBook(dir, { version: '2.0.1' })).chapters[0].body).toBe(
      '<h1>題</h1>\n<h2 id="sec-1">一</h2>\n<p>x</p>',
    );
    expect((await loadBook(dir, { version: '3.0' })).chapters[0].body).toContain('<section><h2 id="sec-1">一</h2>');
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
