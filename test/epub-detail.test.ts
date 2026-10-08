// buildEpub と zip の細かな場合
import { expect } from '@std/expect';
import { type Book, buildEpub, type Chapter, EpubInputError } from '../mod.ts';
import { contentDocumentName } from '../src/epub.ts';
import { crc32, writeZip } from '../src/zip.ts';
import { unzip, unzipText } from './helpers/unzip.ts';

const minimal = (chapters: Chapter[] = [{ title: 'a', body: '<p>a</p>' }]): Book => ({
  metadata: { identifier: 'id', title: 't', language: 'ja', modified: new Date('2026-01-02T03:04:05Z') },
  chapters,
});

Deno.test('内容文書の名前は 4 桁以上にゼロ詰めする', () => {
  expect(contentDocumentName(0, 1)).toBe('0001.xhtml');
  expect(contentDocumentName(9998, 9999)).toBe('9999.xhtml');
  expect(contentDocumentName(0, 10000)).toBe('00001.xhtml');
  expect(contentDocumentName(9999, 10000)).toBe('10000.xhtml');
});

Deno.test('最小の本', async () => {
  for (const version of ['2.0.1', '3.0'] as const) {
    const files = await unzipText(await buildEpub(minimal(), { version }));
    const opf = files.get('OEBPS/content.opf')!;
    expect(opf).not.toContain('dc:creator');
    expect(opf).not.toContain('dc:publisher');
    expect(opf).not.toContain('cover');
    expect(opf).not.toContain('page-progression-direction');
    expect([...files.keys()].filter((n) => n.startsWith('OEBPS/text/'))).toEqual(['OEBPS/text/0001.xhtml']);
    expect(files.get('OEBPS/text/0001.xhtml')).not.toContain('<link');
  }
});

Deno.test('modified を省くと呼んだ時刻を使う', async () => {
  const book = minimal();
  delete book.metadata.modified;
  const before = Date.now();
  const files = await unzipText(await buildEpub(book, { version: '3.0' }));
  const value = /<meta property="dcterms:modified">([^<]+)<\/meta>/.exec(files.get('OEBPS/content.opf')!)![1];
  expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  expect(Date.parse(value)).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000);
});

Deno.test('同じ入力からは同じバイト列を作る', async () => {
  const a = await buildEpub(minimal(), { version: '3.0' });
  const b = await buildEpub(minimal(), { version: '3.0' });
  expect(a).toEqual(b);
});

Deno.test('ltr の頁送りの向き', async () => {
  const book = { ...minimal(), pageProgressionDirection: 'ltr' as const };
  const files = await unzipText(await buildEpub(book, { version: '3.0' }));
  expect(files.get('OEBPS/content.opf')).toContain('page-progression-direction="ltr"');
});

Deno.test('書誌情報と題名は、どこに書いても実体参照に直す', async () => {
  const book = minimal([{ title: '<&">', body: '<p/>' }]);
  book.metadata = {
    identifier: 'a&b',
    title: '<t>',
    language: 'ja',
    authors: ['"&"'],
    publisher: '<p>',
    description: '&amp;',
  };
  for (const version of ['2.0.1', '3.0'] as const) {
    const files = await unzipText(await buildEpub(book, { version }));
    for (const [name, content] of files) {
      if (!/\.(opf|ncx|xhtml)$/.test(name)) continue;
      // 実体参照でない & と、書誌情報から来た < がない
      expect(content, name).not.toMatch(/&(?!amp;|lt;|gt;|quot;)|<t>|<p>|<&/);
    }
    expect(files.get('OEBPS/content.opf')).toContain('<dc:description>&amp;amp;</dc:description>');
    expect(files.get('OEBPS/toc.ncx')).toContain('<meta name="dtb:uid" content="a&amp;b"/>');
    expect(files.get('OEBPS/toc.ncx')).toContain('<text>&lt;&amp;"&gt;</text>');
    expect(files.get('OEBPS/text/0001.xhtml')).toContain('<title>&lt;&amp;"&gt;</title>');
  }
});

Deno.test('パスはパーセントエンコードして参照する', async () => {
  const book = minimal();
  book.stylesheets = [{ path: 'スタイル/a b.css', content: '' }];
  book.images = [{ path: 'images/画 像#1.png', mediaType: 'image/png', data: new Uint8Array([1]) }];
  book.chapters[0].stylesheets = ['スタイル/a b.css'];
  const files = await unzipText(await buildEpub(book, { version: '3.0' }));
  expect(files.has('OEBPS/スタイル/a b.css')).toBe(true);
  expect(files.has('OEBPS/images/画 像#1.png')).toBe(true);
  const opf = files.get('OEBPS/content.opf')!;
  expect(opf).toContain(`href="${encodeURIComponent('スタイル')}/a%20b.css"`);
  expect(opf).toContain(`href="images/${encodeURIComponent('画 像#1.png')}"`);
  expect(files.get('OEBPS/text/0001.xhtml')).toContain(`href="../${encodeURIComponent('スタイル')}/a%20b.css"`);
});

Deno.test('SVG と MathML を含む文書に properties を付ける（EPUB 3.0）', async () => {
  const book = minimal([
    { title: 'svg', body: '<svg xmlns="http://www.w3.org/2000/svg"/>' },
    { title: 'math', body: '<p><math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi></math></p>' },
    { title: 'both', body: '<svg/><math/>' },
    { title: 'none', body: '<p>svg math &lt;svg&gt;</p>' },
  ]);
  const opf = (await unzipText(await buildEpub(book, { version: '3.0' }))).get('OEBPS/content.opf')!;
  expect(opf).toContain('href="text/0001.xhtml" media-type="application/xhtml+xml" properties="svg"/>');
  expect(opf).toContain('href="text/0002.xhtml" media-type="application/xhtml+xml" properties="mathml"/>');
  expect(opf).toContain('href="text/0003.xhtml" media-type="application/xhtml+xml" properties="svg mathml"/>');
  expect(opf).toContain('href="text/0004.xhtml" media-type="application/xhtml+xml"/>');
});

Deno.test('深い入れ子の目次と、文書のない項目の playOrder', async () => {
  const book = minimal([
    { title: '1', children: [{ title: '1-1', children: [{ title: '1-1-1', body: '<p/>' }] }] },
    { title: '2', body: '<p/>', children: [{ title: '2-1', body: '<p/>' }] },
  ]);
  const files = await unzipText(await buildEpub(book, { version: '3.0' }));
  const ncx = files.get('OEBPS/toc.ncx')!;
  expect(ncx).toContain('<meta name="dtb:depth" content="3"/>');
  const orders = [...ncx.matchAll(/playOrder="(\d+)">\s*<navLabel><text>([^<]+)</g)].map((m) => [m[2], m[1]]);
  expect(orders).toEqual([['1', '1'], ['1-1', '1'], ['1-1-1', '1'], ['2', '2'], ['2-1', '3']]);
  const nav = files.get('OEBPS/nav.xhtml')!;
  expect(nav).toMatch(/<a href="text\/0001.xhtml">1<\/a>\s*<ol>\s*<li><a href="text\/0001.xhtml">1-1<\/a>/);
  expect([...nav.matchAll(/<ol>/g)].length).toBe(4);
});

Deno.test('本の値の誤り', async (t) => {
  const cases: [string, (b: Book) => void][] = [
    ['空白だけの識別子', (b) => (b.metadata.identifier = '  ')],
    ['言語がない', (b) => (b.metadata.language = '')],
    ['空の著者', (b) => (b.metadata.authors = [''])],
    ['正しくない日時', (b) => (b.metadata.modified = new Date('x'))],
    ['XML で使えない文字の題名', (b) => (b.metadata.title = 'a\u0000')],
    ['知らない頁送りの向き', (b) => (b.pageProgressionDirection = 'ttb' as 'ltr')],
    ['空のパス', (b) => (b.stylesheets = [{ path: '', content: '' }])],
    ['/ で始まるパス', (b) => (b.stylesheets = [{ path: '/a.css', content: '' }])],
    ['バックスラッシュのパス', (b) => (b.stylesheets = [{ path: 'a\\b.css', content: '' }])],
    ['空の区切りのパス', (b) => (b.stylesheets = [{ path: 'a//b.css', content: '' }])],
    ['. のパス', (b) => (b.stylesheets = [{ path: './a.css', content: '' }])],
    ['content.opf と重なるパス', (b) => (b.stylesheets = [{ path: 'content.opf', content: '' }])],
    ['nav.xhtml と重なるパス', (b) => (b.stylesheets = [{ path: 'nav.xhtml', content: '' }])],
    [
      '大文字と小文字だけ違うパス',
      (b) => (b.stylesheets = [{ path: 'a.css', content: '' }, { path: 'A.css', content: '' }]),
    ],
    [
      'NFC と NFD だけ違うパス',
      (b) => (b.stylesheets = [{ path: 'が.css', content: '' }, { path: 'が.css', content: '' }]),
    ],
    ['空白だけの章の題名', (b) => (b.chapters[0].title = ' ')],
    ['子だけの章の子に本文がない', (b) => (b.chapters = [{ title: 'a', children: [{ title: 'b' }] }])],
    ['表紙の文書のスタイルシートがない', (b) => (b.cover = { body: '', stylesheets: ['x.css'] })],
    [
      '子の章のスタイルシートがない',
      (b) => (b.chapters[0].children = [{ title: 'c', body: '', stylesheets: ['x.css'] }]),
    ],
  ];
  for (const [label, mutate] of cases) {
    await t.step(label, async () => {
      const book = minimal();
      mutate(book);
      await expect(buildEpub(book, { version: '3.0' })).rejects.toThrow(EpubInputError);
    });
  }
  await t.step('知らない版', async () => {
    await expect(buildEpub(minimal(), { version: '3.3' as '3.0' })).rejects.toThrow(EpubInputError);
  });
});

Deno.test('zip の細かな場合', async (t) => {
  await t.step('項目がない', async () => {
    const zip = await writeZip([], new Date());
    expect(zip.length).toBe(22);
    expect(await unzip(zip)).toEqual([]);
  });
  await t.step('中身が空の項目', async () => {
    const [entry] = await unzip(await writeZip([{ name: 'a', data: new Uint8Array() }], new Date()));
    expect(entry.data.length).toBe(0);
    expect(entry.crc).toBe(0);
  });
  await t.step('日時は DOS の形で書き、1980 年より前は 1980 年にする', async () => {
    const zip = await writeZip([{ name: 'a', data: new Uint8Array([1]) }], new Date('2026-10-09T12:34:56Z'));
    const view = new DataView(zip.buffer);
    const time = view.getUint16(10, true);
    const date = view.getUint16(12, true);
    expect([time >> 11, (time >> 5) & 63, (time & 31) * 2]).toEqual([12, 34, 56]);
    expect([(date >> 9) + 1980, (date >> 5) & 15, date & 31]).toEqual([2026, 10, 9]);
    const old = await writeZip([{ name: 'a', data: new Uint8Array([1]) }], new Date('1970-01-01T00:00:00Z'));
    expect((new DataView(old.buffer).getUint16(12, true) >> 9) + 1980).toBe(1980);
  });
  await t.step('大きな項目を圧縮して読み戻せる', async () => {
    const data = new Uint8Array(1 << 20).map((_, i) => (i * 7919) % 251);
    const [entry] = await unzip(await writeZip([{ name: 'big', data }], new Date()));
    expect(entry.method).toBe(8);
    expect(entry.data).toEqual(data);
    expect(entry.crc).toBe(crc32(data));
  });
  await t.step('多くの項目', async () => {
    const entries = Array.from({ length: 300 }, (_, i) => ({ name: `f/${i}`, data: new TextEncoder().encode(`${i}`) }));
    const out = await unzip(await writeZip(entries, new Date()));
    expect(out.map((e) => e.name)).toEqual(entries.map((e) => e.name));
  });
  await t.step('外部の unzip でも読める', async () => {
    const dir = await Deno.makeTempDir({ prefix: 'epub-builder-zip-' });
    try {
      const path = `${dir}/a.zip`;
      await Deno.writeFile(path, await buildEpub(minimal(), { version: '3.0' }));
      const result = await new Deno.Command('unzip', { args: ['-tq', path], stdout: 'piped', stderr: 'piped' })
        .output();
      expect(new TextDecoder().decode(result.stdout)).toContain('No errors detected');
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  });
});
