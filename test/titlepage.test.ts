// 扉（titlepage）（ADR 0019）
import { expect } from '@std/expect';
import { type Book, buildEpub, EpubInputError } from '../mod.ts';
import { loadBook } from '../load.ts';
import { unzipText } from './helpers/unzip.ts';

const book = (overrides: Partial<Book> = {}): Book => ({
  metadata: { identifier: 'id', title: '題名', language: 'ja', modified: new Date('2026-01-01T00:00:00Z') },
  chapters: [{ title: '章', body: '<p>a</p>', epubType: 'bodymatter chapter' }],
  ...overrides,
});

Deno.test('buildEpub は扉を表紙の次に置き、目次に入れない', async () => {
  const b = book({
    cover: { body: '<p>c</p>', epubType: 'frontmatter cover' },
    titlepage: { body: '<h1>題名</h1>', epubType: 'frontmatter titlepage' },
  });
  for (const version of ['2.0.1', '3.0'] as const) {
    const files = await unzipText(await buildEpub(b, { version }));
    const opf = files.get('OEBPS/content.opf')!;
    expect([...opf.matchAll(/<itemref idref="([^"]+)"/g)].map((m) => m[1])).toEqual([
      'doc-0001',
      'doc-0002',
      'doc-0003',
    ]);
    expect(files.get('OEBPS/text/0002.xhtml')).toContain('<title>題名</title>');
    expect(files.get('OEBPS/toc.ncx')).not.toContain('0002.xhtml');
  }
});

Deno.test('表紙がなければ扉を最初に置く', async () => {
  const files = await unzipText(await buildEpub(book({ titlepage: { body: '<p>t</p>' } }), { version: '3.0' }));
  expect(files.get('OEBPS/text/0001.xhtml')).toContain('<p>t</p>');
  expect(files.get('OEBPS/toc.ncx')).toContain('<content src="text/0002.xhtml"/>');
});

Deno.test('landmarks と guide に扉を入れる', async () => {
  const b = book({ cover: { body: '<p/>' }, titlepage: { body: '<p/>' } });
  const nav = (await unzipText(await buildEpub(b, { version: '3.0' }))).get('OEBPS/nav.xhtml')!;
  expect(nav).toContain(
    '<li><a epub:type="cover" href="text/0001.xhtml">表紙</a></li>\n<li><a epub:type="titlepage" href="text/0002.xhtml">扉</a></li>\n<li><a epub:type="bodymatter" href="text/0003.xhtml">本文</a></li>',
  );
  const opf = (await unzipText(await buildEpub(b, { version: '2.0.1' }))).get('OEBPS/content.opf')!;
  expect(opf).toContain(
    '<reference type="cover" title="表紙" href="text/0001.xhtml"/>\n<reference type="title-page" title="扉" href="text/0002.xhtml"/>\n<reference type="text" title="本文" href="text/0003.xhtml"/>',
  );
  const en = book({
    metadata: { identifier: 'id', title: 't', language: 'en', modified: new Date(0) },
    titlepage: { body: '<p/>' },
  });
  expect((await unzipText(await buildEpub(en, { version: '3.0' }))).get('OEBPS/nav.xhtml')).toContain(
    '<a epub:type="titlepage" href="text/0001.xhtml">Title Page</a>',
  );
  expect((await unzipText(await buildEpub(en, { version: '2.0.1' }))).get('OEBPS/content.opf')).toContain(
    '<reference type="title-page" title="Title Page" href="text/0001.xhtml"/>',
  );
});

Deno.test('扉の bodymatter は、扉の後の最初の章にする', async () => {
  const b = book({ titlepage: { body: '<p/>' }, chapters: [{ title: 'a', body: '<p/>' }] });
  const nav = (await unzipText(await buildEpub(b, { version: '3.0' }))).get('OEBPS/nav.xhtml')!;
  expect(nav).toContain('<a epub:type="bodymatter" href="text/0002.xhtml">');
});

Deno.test('扉の値の誤り', async () => {
  await expect(buildEpub(book({ titlepage: { body: '', stylesheets: ['x.css'] } }), { version: '3.0' })).rejects
    .toThrow(EpubInputError);
  await expect(buildEpub(book({ titlepage: { body: '', epubType: ' ' } }), { version: '3.0' })).rejects.toThrow(
    EpubInputError,
  );
});

Deno.test('loadBook は meta/titlepage を扉にする', async () => {
  const dir = await Deno.makeTempDir({ prefix: 'epub-builder-test-' });
  try {
    const files: Record<string, string> = {
      'book.toml': 'identifier = "id"\ntitle = "t"\nlanguage = "ja"\n',
      'body/a.md': '# 章\n\n[扉へ](../meta/titlepage.html)',
      'meta/cover.md': '表紙',
      'meta/titlepage.html': '<h1>扉の題</h1><h2>副題</h2>',
      'assets/s.css': 'p {}',
    };
    for (const [path, content] of Object.entries(files)) {
      await Deno.mkdir(`${dir}/${path.slice(0, path.lastIndexOf('/'))}`, { recursive: true });
      await Deno.writeTextFile(`${dir}/${path}`, content);
    }
    for (const version of ['2.0.1', '3.0'] as const) {
      const loaded = await loadBook(dir, { version });
      expect(loaded.titlepage).toEqual({
        body: '<h1>扉の題</h1><h2>副題</h2>',
        epubType: 'frontmatter titlepage',
        stylesheets: ['assets/s.css'],
      });
      // 扉へのリンクは読み順の 2 番目の文書を指す
      expect(loaded.chapters[0].body).toContain('<a href="0002.xhtml">扉へ</a>');
      const out = await unzipText(await buildEpub(loaded, { version }));
      expect(out.get('OEBPS/toc.ncx')).not.toContain('扉の題');
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
