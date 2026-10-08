// EPUB 3.0 のナビゲーション文書の landmarks（ADR 0011）
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
  expect((await landmarks(book('jav'))).map(([, , label]) => label)[0]).toBe('Cover');
});

Deno.test('EPUB 2.0.1 には landmarks も guide も書かない', async () => {
  const files = await unzipText(await buildEpub(base({ cover: { body: '<p/>' } }), { version: '2.0.1' }));
  expect(files.has('OEBPS/nav.xhtml')).toBe(false);
  expect(files.get('OEBPS/content.opf')).not.toContain('<guide');
});
