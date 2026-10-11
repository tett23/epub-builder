// EPUB 3.2（ADR 0024）
import { expect } from '@std/expect';
import { buildEpub, EPUB_VERSIONS, hasNcx, isEpub3 } from '../mod.ts';
import { loadBook } from '../load.ts';
import { main } from '../cli.ts';
import { unzipText } from './helpers/unzip.ts';

const build = async (name: string, version: '2.0.1' | '3.0' | '3.2') =>
  await unzipText(await buildEpub(await loadBook(`test/fixtures/${name}`, { version }), { version }));

Deno.test('版の一覧と、版の性格を表す関数', () => {
  expect(EPUB_VERSIONS).toEqual(['2.0.1', '3.0', '3.2']);
  expect(EPUB_VERSIONS.map(isEpub3)).toEqual([false, true, true]);
  expect(EPUB_VERSIONS.map(hasNcx)).toEqual([true, true, false]);
});

Deno.test('3.2 はパッケージ文書の version を 3.0 と書き、NCX を含まない', async () => {
  const files = await build('sample-book', '3.2');
  const opf = files.get('OEBPS/content.opf')!;
  expect(opf).toMatch(/<package [^>]*version="3\.0"/);
  expect(files.has('OEBPS/toc.ncx')).toBe(false);
  expect(opf).not.toContain('toc.ncx');
  expect(opf).not.toContain('application/x-dtbncx+xml');
  expect(opf).toMatch(/<spine page-progression-direction="rtl">/);
  // 目次と landmarks はナビゲーション文書で持つ
  expect(opf).toContain('properties="nav"');
  const nav = files.get('OEBPS/nav.xhtml')!;
  expect(nav).toContain('<nav epub:type="toc" id="toc">');
  expect(nav).toContain('<nav epub:type="landmarks" hidden="">');
});

Deno.test('3.2 は NCX のほかは 3.0 と同じ', async () => {
  for (const name of ['sample-book', 'novel-book', 'tech-book', 'sections-book', 'epub3-book']) {
    const v30 = await build(name, '3.0');
    const v32 = await build(name, '3.2');
    expect([...v32.keys()], name).toEqual([...v30.keys()].filter((path) => path !== 'OEBPS/toc.ncx'));
    for (const [path, content] of v32) {
      if (path === 'OEBPS/content.opf') continue;
      expect(content, `${name} ${path}`).toBe(v30.get(path));
    }
    // パッケージ文書は、NCX の manifest の項目と spine の toc 属性だけが違う
    const opf30 = v30.get('OEBPS/content.opf')!
      .replace('<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>\n', '')
      .replace('<spine toc="ncx"', '<spine');
    expect(v32.get('OEBPS/content.opf'), name).toBe(opf30);
  }
});

Deno.test('3.2 でも Kindle の primary-writing-mode を書く', async () => {
  const opf = (await build('novel-book', '3.2')).get('OEBPS/content.opf')!;
  expect(opf).toContain('<meta name="primary-writing-mode" content="vertical-rl"/>');
});

Deno.test('3.0 と 3.2 は、EPUB 3.2 で非推奨とされたものを書かない', async () => {
  for (const version of ['3.0', '3.2'] as const) {
    for (const [path, content] of await build('tech-book', version)) {
      for (const deprecated of ['<guide', '<bindings', 'epub:switch', 'epub:trigger', 'rendition:viewport']) {
        expect(content.includes(deprecated), `${version} ${path} ${deprecated}`).toBe(false);
      }
    }
  }
});

Deno.test('loadBook は 3.2 で 3.0 と同じ本文を作る', async () => {
  const v30 = await loadBook('test/fixtures/sections-book', { version: '3.0' });
  const v32 = await loadBook('test/fixtures/sections-book', { version: '3.2' });
  expect(v32).toEqual(v30);
});

Deno.test('CLI の使い方に、三つの版の向いている環境が書かれている', async () => {
  const stdout: string[] = [];
  await main(['help'], { stdout: (l) => stdout.push(l), stderr: () => {} });
  const help = stdout.join('\n');
  expect(help).toContain('2.0.1   EPUB 3 に対応しない古い端末やアプリ向け');
  expect(help).toContain('3.0     EPUB 3 に対応する端末やアプリ向け。古いアプリのための目次（NCX）も入れる');
  expect(help).toContain('3.2     EPUB 3 に対応する新しい端末やアプリ向け');
  expect(help).toContain('all     上の三つすべて（既定）');
});
