// EPUB 3.0 のナビゲーション文書の landmarks（ADR 0019）
import { expect } from '@std/expect';
import { type Book, buildEpub } from '../mod.ts';
import { unzipText } from './helpers/unzip.ts';

const base = (overrides: Partial<Book> = {}): Book => ({
  metadata: { identifier: 'id', title: 't', language: 'ja', modified: new Date('2026-01-01T00:00:00Z') },
  chapters: [{ title: '章', body: '<p>a</p>' }],
  ...overrides,
});

async function landmarks(book: Book): Promise<[string, string, string][]> {
  const nav = (await unzipText(await buildEpub(book, { version: '3.0' }))).get('OEBPS/nav.xhtml')!;
  const block = nav.slice(nav.indexOf('<nav epub:type="landmarks" hidden="">'));
  return [...block.matchAll(/<a epub:type="([^"]+)" href="([^"]+)">([^<]+)<\/a>/g)].map((m) => [m[1], m[2], m[3]]);
}

Deno.test('表紙、本文、後付けの順に、行き先がある項目だけを書く', async () => {
  const book = base({
    cover: { body: '<p>c</p>', epubType: 'frontmatter cover' },
    chapters: [
      { title: '前書き', body: '<p/>', epubType: 'frontmatter preface' },
      { title: '一', body: '<p/>', epubType: 'bodymatter chapter' },
      { title: '二', body: '<p/>', epubType: 'bodymatter chapter' },
      { title: '奥付', body: '<p/>', epubType: 'backmatter colophon' },
    ],
  });
  expect(await landmarks(book)).toEqual([
    ['cover', 'text/0001.xhtml', '表紙'],
    ['bodymatter', 'text/0003.xhtml', '本文'],
    ['backmatter', 'text/0005.xhtml', '後付け'],
    ['colophon', 'text/0005.xhtml', '奥付'],
  ]);
});

Deno.test('目次の項目は書かない', async () => {
  expect((await landmarks(base())).some(([type]) => type === 'toc')).toBe(false);
});

Deno.test('bodymatter を含む章がなければ、最初の章の文書を本文の始まりにする', async () => {
  expect(await landmarks(base({ cover: { body: '<p/>' } }))).toEqual([
    ['cover', 'text/0001.xhtml', '表紙'],
    ['bodymatter', 'text/0002.xhtml', '本文'],
  ]);
});

Deno.test('入れ子の章の bodymatter を見つける', async () => {
  const book = base({
    chapters: [
      { title: '部', children: [{ title: '章', body: '<p/>', epubType: 'bodymatter chapter' }] },
    ],
  });
  expect(await landmarks(book)).toEqual([['bodymatter', 'text/0001.xhtml', '本文']]);
});

Deno.test('表示名は言語で決める', async () => {
  const book = (language: string) =>
    base({
      metadata: { identifier: 'id', title: 't', language, modified: new Date(0) },
      cover: { body: '<p/>' },
      chapters: [{ title: 'a', body: '<p/>' }, { title: 'b', body: '<p/>', epubType: 'backmatter' }],
    });
  expect((await landmarks(book('ja-JP'))).map(([, , label]) => label)).toEqual(['表紙', '本文', '後付け']);
  expect((await landmarks(book('en'))).map(([, , label]) => label)).toEqual([
    'Cover',
    'Start of Content',
    'Back Matter',
  ]);
  // 語を持たない backmatter は、種類ごとの項目を作らない
  expect((await landmarks(book('jav'))).map(([, , label]) => label)[0]).toBe('Cover');
});

Deno.test('EPUB 2.0.1 には landmarks を書かない', async () => {
  const files = await unzipText(await buildEpub(base({ cover: { body: '<p/>' } }), { version: '2.0.1' }));
  expect(files.has('OEBPS/nav.xhtml')).toBe(false);
});

async function guide(book: Book): Promise<[string, string, string][]> {
  const opf = (await unzipText(await buildEpub(book, { version: '2.0.1' }))).get('OEBPS/content.opf')!;
  return [...opf.matchAll(/<reference type="([^"]+)" title="([^"]+)" href="([^"]+)"\/>/g)].map((m) => [
    m[1],
    m[3],
    m[2],
  ]);
}

Deno.test('EPUB 2.0.1 の guide に、表紙、本文、後付け、奥付の順で、行き先がある項目だけを書く', async () => {
  const book = base({
    cover: { body: '<p>c</p>', epubType: 'frontmatter cover' },
    chapters: [
      { title: '前書き', body: '<p/>', epubType: 'frontmatter preface' },
      { title: '一', body: '<p/>', epubType: 'bodymatter chapter' },
      { title: '付録', body: '<p/>', epubType: 'backmatter appendix' },
      { title: '奥付', body: '<p/>', epubType: 'backmatter colophon' },
    ],
  });
  expect(await guide(book)).toEqual([
    ['cover', 'text/0001.xhtml', '表紙'],
    ['text', 'text/0003.xhtml', '本文'],
    ['other.appendix', 'text/0004.xhtml', '付録'],
    ['colophon', 'text/0005.xhtml', '奥付'],
  ]);
  const opf = (await unzipText(await buildEpub(book, { version: '2.0.1' }))).get('OEBPS/content.opf')!;
  expect(opf).toMatch(/<\/spine>\n<guide>/);
  expect(opf).not.toContain('type="toc"');
  // epubType は guide にだけ使い、本文には書かない
  const doc = (await unzipText(await buildEpub(book, { version: '2.0.1' }))).get('OEBPS/text/0003.xhtml')!;
  expect(doc).not.toContain('epub:type');
});

Deno.test('guide の text は、bodymatter がなければ最初の章を指す', async () => {
  expect(await guide(base())).toEqual([['text', 'text/0001.xhtml', '本文']]);
});

Deno.test('guide の title は言語で決める', async () => {
  const book = base({
    metadata: { identifier: 'id', title: 't', language: 'en-US', modified: new Date(0) },
    cover: { body: '<p/>' },
    chapters: [{ title: 'a', body: '<p/>' }, { title: 'c', body: '<p/>', epubType: 'colophon' }],
  });
  expect((await guide(book)).map(([, , title]) => title)).toEqual(['Cover', 'Start of Content', 'Colophon']);
});

Deno.test('EPUB 3.0 には guide を書かない', async () => {
  const files = await unzipText(await buildEpub(base({ cover: { body: '<p/>' } }), { version: '3.0' }));
  expect(files.get('OEBPS/content.opf')).not.toContain('<guide');
});

Deno.test('後付けの種類ごとに、landmarks と guide の項目を決まった順で書く', async () => {
  const terms = [
    'colophon',
    'copyright-page',
    'index',
    'glossary',
    'bibliography',
    'appendix',
    'acknowledgments',
    'afterword',
  ];
  // 章の並びとは逆の順に置いても、項目は決まった順になる
  const book = base({
    chapters: [
      { title: '一', body: '<p/>', epubType: 'bodymatter chapter' },
      ...terms.map((t) => ({ title: t, body: '<p/>', epubType: `backmatter ${t}` })),
    ],
  });
  expect((await landmarks(book)).map(([type, href, label]) => `${type} ${href} ${label}`)).toEqual([
    'bodymatter text/0001.xhtml 本文',
    'backmatter text/0002.xhtml 後付け',
    'afterword text/0009.xhtml あとがき',
    'acknowledgments text/0008.xhtml 謝辞',
    'appendix text/0007.xhtml 付録',
    'bibliography text/0006.xhtml 参考文献',
    'glossary text/0005.xhtml 用語集',
    'index text/0004.xhtml 索引',
    'copyright-page text/0003.xhtml 著作権表示',
    'colophon text/0002.xhtml 奥付',
  ]);
  expect((await guide(book)).map(([type, , title]) => `${type} ${title}`)).toEqual([
    'text 本文',
    'other.afterword あとがき',
    'acknowledgements 謝辞',
    'other.appendix 付録',
    'bibliography 参考文献',
    'glossary 用語集',
    'index 索引',
    'copyright-page 著作権表示',
    'colophon 奥付',
  ]);
  const en = base({
    metadata: { identifier: 'id', title: 't', language: 'en', modified: new Date(0) },
    chapters: [{ title: 'a', body: '<p/>' }, { title: 'b', body: '<p/>', epubType: 'backmatter copyright-page' }],
  });
  expect((await landmarks(en)).map(([, , label]) => label)).toEqual(['Start of Content', 'Back Matter', 'Copyright']);
});
