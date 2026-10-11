import { expect } from '@std/expect';
import { type Book, buildEpub } from '../mod.ts';
import { unzip, unzipText } from './helpers/unzip.ts';

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function sampleBook(): Book {
  return {
    metadata: {
      identifier: 'urn:uuid:00000000-0000-4000-8000-000000000000',
      title: 'A & B <題名>',
      language: 'ja',
      authors: ['著者 "一"'],
      publisher: '出版者',
      description: '説明',
      modified: new Date('2026-10-09T01:02:03.456Z'),
    },
    pageProgressionDirection: 'rtl',
    stylesheets: [{ path: 'style.css', content: 'p { margin: 0; }' }],
    images: [{ path: 'images/cover.png', mediaType: 'image/png', data: png }],
    coverImage: 'images/cover.png',
    cover: { body: '<p><img src="../images/cover.png" alt=""/></p>', stylesheets: ['style.css'] },
    chapters: [
      { title: '一', body: '<p>一</p>', stylesheets: ['style.css'] },
      {
        title: '部',
        children: [
          { title: '二', body: '<p>二</p>' },
          { title: '三', body: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' },
        ],
      },
    ],
  };
}

Deno.test('どちらの版でも、mimetype が最初の圧縮しない項目になる', async () => {
  for (const version of ['2.0.1', '3.0'] as const) {
    const entries = await unzip(await buildEpub(sampleBook(), { version }));
    expect(entries[0].name).toBe('mimetype');
    expect(entries[0].method).toBe(0);
    expect(new TextDecoder().decode(entries[0].data)).toBe('application/epub+zip');
    expect(entries[1].name).toBe('META-INF/container.xml');
  }
});

Deno.test('EPUB 2.0.1 のパッケージ文書、NCX、本文', async () => {
  const files = await unzipText(await buildEpub(sampleBook(), { version: '2.0.1' }));
  const opf = files.get('OEBPS/content.opf')!;
  expect(opf).toContain('version="2.0"');
  expect(opf).toContain('<dc:title>A &amp; B &lt;題名&gt;</dc:title>');
  expect(opf).toContain('<dc:creator opf:role="aut">著者 "一"</dc:creator>');
  expect(opf).toContain('<meta name="cover" content="img-1"/>');
  expect(opf).toContain('<spine toc="ncx">');
  expect(opf).not.toContain('page-progression-direction');
  expect(opf).not.toContain('properties=');
  expect(files.has('OEBPS/nav.xhtml')).toBe(false);
  const ncx = files.get('OEBPS/toc.ncx')!;
  expect(ncx).toContain('<meta name="dtb:depth" content="2"/>');
  // 文書のない項目は最初の子の文書を指し、同じ playOrder を持つ
  expect(ncx).toMatch(/playOrder="2">\s*<navLabel><text>部<\/text><\/navLabel>\s*<content src="text\/0003.xhtml"\/>/);
  expect(ncx).toMatch(/playOrder="2">\s*<navLabel><text>二<\/text>/);
  const doc = files.get('OEBPS/text/0002.xhtml')!;
  expect(doc).toContain('<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN"');
  expect(doc).toContain('<link rel="stylesheet" type="text/css" href="../style.css"/>');
  expect(doc).toContain('<p>一</p>');
});

Deno.test('EPUB 3.0 のパッケージ文書、ナビゲーション文書、本文', async () => {
  const files = await unzipText(await buildEpub(sampleBook(), { version: '3.0' }));
  const opf = files.get('OEBPS/content.opf')!;
  expect(opf).toContain('version="3.0"');
  expect(opf).toContain('<meta property="dcterms:modified">2026-10-09T01:02:03Z</meta>');
  expect(opf).toContain('properties="nav"');
  expect(opf).toContain('properties="cover-image"');
  expect(opf).toContain('<spine toc="ncx" page-progression-direction="rtl">');
  expect(opf).toContain(
    '<item id="doc-0004" href="text/0004.xhtml" media-type="application/xhtml+xml" properties="svg"/>',
  );
  // 表紙は読み順の最初で、目次には入らない
  expect(opf.indexOf('idref="doc-0001"')).toBeLessThan(opf.indexOf('idref="doc-0002"'));
  // 目次の nav だけを見る（landmarks を除く）
  const nav = files.get('OEBPS/nav.xhtml')!.split('<nav epub:type="landmarks"')[0];
  expect(nav).toContain('<nav epub:type="toc" id="toc">');
  expect(nav).not.toContain('0001.xhtml');
  expect(nav).toMatch(/<li><a href="text\/0003.xhtml">部<\/a>\s*<ol>/);
  expect(files.has('OEBPS/toc.ncx')).toBe(true);
  const doc = files.get('OEBPS/text/0002.xhtml')!;
  expect(doc).toContain('<!DOCTYPE html>\n');
  expect(doc).toContain('xmlns:epub="http://www.idpf.org/2007/ops"');
});

Deno.test('入力の誤りを、EPUB を作る前に例外で知らせる', async () => {
  const cases: [string, (book: Book) => void][] = [
    ['題名がない', (b) => (b.metadata.title = '')],
    ['パスが重なる', (b) => b.images!.push({ path: 'Style.css', mediaType: 'image/png', data: png })],
    ['知らないメディアタイプ', (b) => (b.images![0].mediaType = 'image/webp' as 'image/png')],
    ['表紙の画像がない', (b) => (b.coverImage = 'nothing.png')],
    ['スタイルシートがない', (b) => (b.chapters[0].stylesheets = ['nothing.css'])],
    ['本文も子もない', (b) => b.chapters.push({ title: '空' })],
    ['ライブラリのパス', (b) => (b.stylesheets![0].path = 'text/a.css')],
    ['上に出るパス', (b) => (b.stylesheets![0].path = '../a.css')],
    ['章がない', (b) => (b.chapters = [])],
  ];
  for (const [label, mutate] of cases) {
    const book = sampleBook();
    mutate(book);
    await expect(buildEpub(book, { version: '3.0' }), label).rejects.toMatchObject({ name: 'EpubInputError' });
  }
});
