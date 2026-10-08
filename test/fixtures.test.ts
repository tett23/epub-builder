// フィクスチャごとの期待と、出力のスナップショット
import { expect } from '@std/expect';
import { assertSnapshot } from '@std/testing/snapshot';
import { buildEpub, type EpubVersion } from '../mod.ts';
import { loadBook } from '../load.ts';
import { FIXTURES } from './fixtures.ts';
import { unzip, unzipText } from './helpers/unzip.ts';

async function build(name: string, version: EpubVersion): Promise<Map<string, string>> {
  const book = await loadBook(`test/fixtures/${name}`, { version });
  return await unzipText(await buildEpub(book, { version }));
}

const textDocs = (files: Map<string, string>) => [...files].filter(([n]) => n.startsWith('OEBPS/text/'));
const count = (s: string, re: RegExp) => s.match(re)?.length ?? 0;

Deno.test('novel-book：縦書きの長編', async (t) => {
  for (const version of ['2.0.1', '3.0'] as const) {
    await t.step(version, async () => {
      const files = await build('novel-book', version);
      // 表紙、プロローグ、三部（扉と 4、5、6 章）、エピローグ、奥付
      expect(textDocs(files).length).toBe(1 + 1 + 3 + 4 + 5 + 6 + 1 + 1);
      const ncx = files.get('OEBPS/toc.ncx')!;
      expect(ncx).toContain('<meta name="dtb:depth" content="2"/>');
      expect(count(ncx, /<navPoint /g)).toBe(1 + 3 + 15 + 1 + 1);
      expect(ncx).toContain('<text>第一部　港</text>');
      expect(ncx).not.toContain('《');
      const all = textDocs(files).map(([, c]) => c).join('');
      expect(all).not.toContain('《');
      if (version === '3.0') {
        expect(count(all, /<ruby>/g)).toBeGreaterThan(50);
        expect(all).not.toContain('class="ruby"');
        expect(files.get('OEBPS/content.opf')).toContain('page-progression-direction="rtl"');
      } else {
        expect(count(all, /<span class="ruby">/g)).toBeGreaterThan(50);
        expect(all).not.toContain('<ruby');
      }
      // 脚注は文書ごとに 1 から番号を振る
      for (const [name, content] of textDocs(files)) {
        const numbers = [...content.matchAll(/<sup><a class="noteref" id="fnref-(\d+)"/g)].map((m) => Number(m[1]));
        expect(numbers, name).toEqual(numbers.map((_, i) => i + 1));
        expect(count(content, /class="footnote"/g), name).toBe(numbers.length);
      }
      const opf = files.get('OEBPS/content.opf')!;
      expect(opf.indexOf('assets/style/parts.css')).toBeLessThan(opf.indexOf('assets/style/vertical.css'));
    });
  }
});

Deno.test('large-book：多くの文書', async () => {
  const files = await build('large-book', '3.0');
  expect(textDocs(files).length).toBe(151);
  expect(files.has('OEBPS/text/0151.xhtml')).toBe(true);
  const ncx = files.get('OEBPS/toc.ncx')!;
  expect(count(ncx, /<navPoint /g)).toBe(10 + 150 + 1);
  // 文書のない巻の項目は、最初の章と同じ playOrder を持つ
  expect(ncx).toMatch(/playOrder="1">\s*<navLabel><text>巻1<\/text>/);
  expect(ncx).toMatch(/playOrder="151">\s*<navLabel><text>奥付<\/text>/);
  // 巻10 は巻2 より後（数字を数として比べない）ではなく、ゼロ詰めの名前の順
  expect(ncx.indexOf('<text>巻2</text>')).toBeLessThan(ncx.indexOf('<text>巻10</text>'));
  const nav = files.get('OEBPS/nav.xhtml')!;
  const tocNav = nav.slice(0, nav.indexOf('<nav epub:type="landmarks"'));
  expect(count(tocNav, /<li>/g)).toBe(161);
});

Deno.test('tech-book：横書きの技術書', async () => {
  for (const version of ['2.0.1', '3.0'] as const) {
    const files = await build('tech-book', version);
    const opf = files.get('OEBPS/content.opf')!;
    expect(opf).toContain('<dc:language>en</dc:language>');
    expect(opf).toContain('<dc:description>Literal string with "quotes" and \\backslashes\\</dc:description>');
    const intro = files.get('OEBPS/text/0002.xhtml')!;
    expect(intro).toContain('<a href="https://example.com/spec" title="Specification">the spec</a>');
    expect(intro).toContain('<a href="0004.xhtml#tree">basics</a>');
    expect(intro).toContain('<img src="../assets/diagrams/flow.svg" alt="A flow diagram"/>');
    expect(intro).toContain('<code>code &lt;with&gt; &amp; entities</code>');
    const colophon = [...files].find(([n, c]) => n.startsWith('OEBPS/text/') && c.includes('Colophon'))![1];
    expect(colophon).toContain('<a href="0002.xhtml#scope">the introduction</a>');
    const ordering = files.get('OEBPS/text/0005.xhtml')!;
    expect(ordering).toContain('<tbody><tr><td><code>01-a.md</code></td><td>1\n  </td></tr>');
    expect(ordering).toContain('— not “naturally”.');
    const ns = files.get('OEBPS/text/0006.xhtml')!;
    expect(ns).toContain('<a href="0005.xhtml">ordering</a>');
    expect(ns).toContain('xlink:href="../assets/diagrams/cover.png"');
    expect(files.get('OEBPS/text/0004.xhtml')).toContain('<a href="0002.xhtml">link back</a>');
    // スタイルシートは文字コード順に、すべての文書に付ける
    for (const [name, content] of textDocs(files)) {
      expect(content.indexOf('assets/css/base.css'), name).toBeLessThan(content.indexOf('assets/css/code.css'));
    }
  }
});

Deno.test('minimal-book：必須のものだけ', async () => {
  for (const version of ['2.0.1', '3.0'] as const) {
    const files = await build('minimal-book', version);
    expect([...files.keys()].filter((n) => !n.startsWith('META-INF') && n !== 'mimetype').sort()).toEqual(
      version === '3.0'
        ? ['OEBPS/content.opf', 'OEBPS/nav.xhtml', 'OEBPS/text/0001.xhtml', 'OEBPS/toc.ncx']
        : ['OEBPS/content.opf', 'OEBPS/text/0001.xhtml', 'OEBPS/toc.ncx'],
    );
    expect(files.get('OEBPS/toc.ncx')).toContain('<text>本文</text>');
  }
});

Deno.test('mixed-format-book：三つの形式は、空白を除いて同じ本文になる', async () => {
  for (const version of ['2.0.1', '3.0'] as const) {
    const files = await build('mixed-format-book', version);
    const bodies = textDocs(files).map(([, c]) =>
      c.slice(c.indexOf('<body>') + 6, c.indexOf('</body>')).replace(/>\s+</g, '><').replace(/\s+</g, '<').trim()
    );
    expect(bodies.length).toBe(3);
    expect(bodies[1]).toBe(bodies[0]);
    expect(bodies[2]).toBe(bodies[0]);
  }
});

Deno.test('edge-book：境界の場合', async () => {
  for (const version of ['2.0.1', '3.0'] as const) {
    const files = await build('edge-book', version);
    const opf = files.get('OEBPS/content.opf')!;
    expect(opf).toContain('<dc:title>境界 &amp; &lt;試験&gt;</dc:title>');
    expect(opf).toContain(`href="assets/${encodeURIComponent('画像集')}/${encodeURIComponent('写真.jpg')}"`);
    for (const type of ['image/jpeg', 'image/gif', 'image/png', 'text/css']) expect(opf).toContain(type);
    expect(files.get('OEBPS/content.opf')).toContain(version === '3.0' ? 'page-progression-direction="ltr"' : '');
    expect(files.get('OEBPS/toc.ncx')).toContain('<meta name="dtb:depth" content="3"/>');
  }
  const entries = await unzip(
    await buildEpub(await loadBook('test/fixtures/edge-book', { version: '3.0' }), { version: '3.0' }),
  );
  const jpeg = entries.find((e) => e.name.endsWith('写真.jpg'))!;
  // 圧縮しても小さくならない画像は stored のまま
  expect(jpeg.data.subarray(0, 2)).toEqual(new Uint8Array([0xff, 0xd8]));
});

Deno.test('sections-book：文書の中の見出しを節として目次に出す', async () => {
  for (const version of ['2.0.1', '3.0'] as const) {
    const files = await build('sections-book', version);
    const ncx = files.get('OEBPS/toc.ncx')!;
    expect(ncx).toContain('<meta name="dtb:depth" content="5"/>');
    const labels = [...ncx.matchAll(/<text>([^<]+)<\/text>/g)].map((m) => m[1]).slice(1);
    expect(labels).toContain('第二節　漢字の見出し');
    expect(labels).not.toContain('表紙の見出しは目次に入らない');
    expect(labels).not.toContain('表紙の小見出しも入らない');
    expect(labels.slice(-3)).toEqual(['奥付', '著者', '発行']);
    // 部の扉の節は、子の章より前
    expect(labels.indexOf('第一部の概要')).toBeLessThan(labels.indexOf('第一章'));
    // 本文の id を避けて番号を付ける
    const ids = files.get('OEBPS/text/0006.xhtml')!;
    expect(ids).toContain('<h3 id="sec-2">id のない見出し</h3>');
    expect(ids).toContain('<h3 id="sec-5">次の id のない見出し</h3>');
    // playOrder は 1 から目次の順に増える
    const orders = [...ncx.matchAll(/playOrder="(\d+)"/g)].map((m) => Number(m[1]));
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  }
});

Deno.test('出力のスナップショット', async (t) => {
  for (const [name, versions] of Object.entries(FIXTURES)) {
    for (const version of versions) {
      await t.step(`${name} ${version}`, async (step) => {
        const book = await loadBook(`test/fixtures/${name}`, { version });
        const entries = await unzip(await buildEpub(book, { version }));
        const decoder = new TextDecoder();
        // modified を書かない本は呼んだ時刻になるため、その値だけを伏せる
        const mask = (text: string) =>
          book.metadata.modified ? text : text.replace(/(<meta property="dcterms:modified">)[^<]+/, '$1(呼んだ時刻)')
            .replace(/(<dc:date opf:event="modification">)[^<]+/, '$1(呼んだ日付)');
        const snapshot = entries.map((e) => {
          const isText = /\.(xhtml|opf|ncx|xml|css)$|^mimetype$/.test(e.name);
          // 多くの文書の本は、本文の文書の中身を除いて記録する
          const skip = name === 'large-book' && e.name.startsWith('OEBPS/text/') && e.name !== 'OEBPS/text/0001.xhtml';
          return isText && !skip
            ? `== ${e.name}\n${mask(decoder.decode(e.data))}`
            : `== ${e.name} (${e.data.length} bytes)`;
        }).join('\n');
        await assertSnapshot(step, snapshot);
      });
    }
  }
});
