// Markdown の変換、ルビの記法、脚注の細かな場合
import { expect } from '@std/expect';
import { sourceToTree } from '../src/load/convert.ts';
import { parseRuby } from '../src/load/ruby.ts';
import { ConversionError, writeXhtml } from '../src/load/xhtml-writer.ts';
import type { EpubVersion } from '../src/types.ts';

const md = (src: string, version: EpubVersion = '3.0') => writeXhtml(sourceToTree(src, 'md', version), version);
const ruby3 = (base: string, reading: string) => `<ruby>${base}<rp>（</rp><rt>${reading}</rt><rp>）</rp></ruby>`;

Deno.test('ルビの記法の細かな場合', async (t) => {
  const cases: [string, string, ReturnType<typeof parseRuby>][] = [
    ['補助平面の漢字', '𠮷野家《よしのや》', [{ type: 'ruby', base: '𠮷野家', reading: 'よしのや' }]],
    ['〆と〇とヶ', '〆切《しめきり》〇《まる》三ヶ月《さんかげつ》', [
      { type: 'ruby', base: '〆切', reading: 'しめきり' },
      { type: 'ruby', base: '〇', reading: 'まる' },
      { type: 'ruby', base: '三ヶ月', reading: 'さんかげつ' },
    ]],
    ['漢字の並びは直前のかなで切れる', 'これは漢字《かんじ》', [
      { type: 'text', value: 'これは' },
      { type: 'ruby', base: '漢字', reading: 'かんじ' },
    ]],
    ['｜でかなを親文字にする', 'これは｜かな《カナ》', [
      { type: 'text', value: 'これは' },
      { type: 'ruby', base: 'かな', reading: 'カナ' },
    ]],
    ['｜で漢字の並びの一部だけを親文字にする', '東京｜都庁《とちょう》', [
      { type: 'text', value: '東京' },
      { type: 'ruby', base: '都庁', reading: 'とちょう' },
    ]],
    ['親文字に空白や記号を含められる', '｜A B!《えーびー》', [{ type: 'ruby', base: 'A B!', reading: 'えーびー' }]],
    ['続けて書いたルビ', '漢《かん》字《じ》', [
      { type: 'ruby', base: '漢', reading: 'かん' },
      { type: 'ruby', base: '字', reading: 'じ' },
    ]],
    ['ルビの直後の漢字の並び', '｜読《よ》漢字《かんじ》', [
      { type: 'ruby', base: '読', reading: 'よ' },
      { type: 'ruby', base: '漢字', reading: 'かんじ' },
    ]],
    ['二つ目の｜から始まる', '｜a｜b《び》', [
      { type: 'text', value: '｜a' },
      { type: 'ruby', base: 'b', reading: 'び' },
    ]],
    ['閉じない《', '漢字《かんじ', [{ type: 'text', value: '漢字《かんじ' }]],
    ['》だけ', '漢字》', [{ type: 'text', value: '漢字》' }]],
    ['ルビの中の｜', '漢字《か｜ん》', [{ type: 'text', value: '漢字《か｜ん》' }]],
    ['｜の後の》', '｜a》b《c》', [{ type: 'text', value: '｜a》b《c》' }]],
    ['ルビに漢字や記号を含められる', '漢字《Kanji/かんじ》', [{ type: 'ruby', base: '漢字', reading: 'Kanji/かんじ' }]],
    ['空の文字列', '', []],
    ['\\ だけ', '\\', [{ type: 'text', value: '\\' }]],
    ['\\ の後の《でない文字', '\\a漢《かん》', [
      { type: 'text', value: '\\a' },
      { type: 'ruby', base: '漢', reading: 'かん' },
    ]],
    ['エスケープした《の後の》', '漢字\\《かんじ》', [{ type: 'text', value: '漢字《かんじ》' }]],
  ];
  for (const [label, src, expected] of cases) {
    await t.step(label, () => expect(parseRuby(src)).toEqual(expected));
  }
});

Deno.test('Markdown の中のルビ', async (t) => {
  const cases: [string, string, string][] = [
    ['強調をまたぐ親文字は書けない', '*漢*字《じ》', `<p><em>漢</em>${ruby3('字', 'じ')}</p>`],
    ['リンクの文字の中', '[漢字《かんじ》](#a)', `<p><a href="#a">${ruby3('漢字', 'かんじ')}</a></p>`],
    [
      '画像の代替文字は解釈しない',
      '![漢字《かんじ》](https://example.com/a.png)',
      '<p><img src="https://example.com/a.png" alt="漢字《かんじ》"/></p>',
    ],
    [
      'リストと引用の中',
      '- 漢《かん》\n\n> 字《じ》',
      `<ul>\n<li>${ruby3('漢', 'かん')}</li>\n</ul>\n<blockquote>\n<p>${ruby3('字', 'じ')}</p>\n</blockquote>`,
    ],
    [
      '生の HTML の中は解釈しない',
      '<span title="漢字《かんじ》">a</span>',
      '<p><span title="漢字《かんじ》">a</span></p>',
    ],
    ['Markdown のエスケープの後の｜', '\\|漢字《かんじ》', `<p>${ruby3('漢字', 'かんじ')}</p>`],
    ['親文字とルビの中の文字は実体参照にする', '｜a&lt;b《&amp;》', `<p>${ruby3('a&lt;b', '&amp;')}</p>`],
    ['改行をまたぐ親文字', '漢\n字《じ》', `<p>漢\n${ruby3('字', 'じ')}</p>`],
  ];
  for (const [label, src, expected] of cases) {
    await t.step(label, () => expect(md(src)).toBe(expected));
  }
});

Deno.test('脚注の細かな場合', async (t) => {
  await t.step('ラベルは大文字と小文字を区別しない', () => {
    const out = md('a[^Note]\n\n[^note]: n');
    expect(out).toContain('id="fnref-1"');
    expect(out).toContain('<a href="#fnref-1">1</a> n');
  });
  await t.step('日本語のラベル', () => {
    expect(md('a[^注一]\n\n[^注一]: n')).toContain('id="fn-1"');
  });
  await t.step('見出しの中の参照', () => {
    expect(md('# 題[^a]\n\n[^a]: n')).toContain('<h1>題<sup><a class="noteref" id="fnref-1" href="#fn-1"');
  });
  await t.step('リストの中の定義', () => {
    const out = md('a[^x]\n\n- b\n\n  [^x]: n');
    expect(out).toContain(
      '<aside class="footnote" id="fn-1" epub:type="footnote"><p><a href="#fnref-1">1</a> n</p></aside>',
    );
  });
  await t.step('段落で始まらない注の本文', () => {
    const out = md('a[^x]\n\n[^x]:\n    ```\n    code\n    ```');
    expect(out).toContain(
      '<aside class="footnote" id="fn-1" epub:type="footnote"><p><a href="#fnref-1">1</a></p><pre>',
    );
  });
  await t.step('注の本文の中のリスト', () => {
    const out = md('a[^x]\n\n[^x]: n\n\n    - i');
    expect(out).toMatch(/<p><a href="#fnref-1">1<\/a> n<\/p>\s*<ul>\s*<li>i<\/li>\s*<\/ul><\/aside>/);
  });
  await t.step('三度の参照', () => {
    const out = md('a[^x]b[^x]c[^x]\n\n[^x]: n');
    expect(out).toContain('id="fnref-1"');
    expect(out).toContain('id="fnref-1-2"');
    expect(out).toContain('id="fnref-1-3"');
    expect(out.match(/class="footnote"/g)?.length).toBe(1);
  });
  await t.step('脚注のない文書には注の欄を作らない', () => {
    expect(md('a')).toBe('<p>a</p>');
  });
  await t.step('脚注の本文は、本文の最後の要素の後に置く', () => {
    const out = md('a[^x]\n\n[^x]: n\n\nb');
    expect(out.indexOf('<p>b</p>')).toBeLessThan(out.indexOf('<div class="footnotes">'));
  });
  await t.step('エスケープした [^x] は誤りにしないで文字のまま出す', () => {
    expect(md('\\[^x]')).toBe('<p>[^x]</p>');
    expect(md('[^x\\]')).toBe('<p>[^x]</p>');
  });
  await t.step('コードの中の [^x] は誤りにしない', () => {
    expect(md('`[^x]`')).toBe('<p><code>[^x]</code></p>');
  });
});

Deno.test('Markdown の変換の細かな場合', async (t) => {
  const cases: [string, string, string][] = [
    [
      '参照形式のリンク',
      '[a][r]\n\n[r]: https://example.com/ "t"',
      '<p><a href="https://example.com/" title="t">a</a></p>',
    ],
    ['自動リンク', '<https://example.com/>', '<p><a href="https://example.com/">https://example.com/</a></p>'],
    ['ハードブレーク', 'a  \nb', '<p>a<br/>\nb</p>'],
    ['水平線', '***', '<hr/>'],
    ['コードブロックの言語', '```js\nx < 1\n```', '<pre><code class="language-js">x &lt; 1\n</code></pre>'],
    ['番号付きのリストの開始番号', '3. a\n4. b', '<ol start="3">\n<li>a</li>\n<li>b</li>\n</ol>'],
    ['複数行の生の HTML のブロック', '<div>\n\n*a*\n\n</div>', '<div>\n<p><em>a</em></p>\n</div>'],
    ['インラインの生の HTML', 'a <span class="x">b</span> c', '<p>a <span class="x">b</span> c</p>'],
    ['生の HTML のコメント', '<!-- c -->\n\na', '<!-- c -->\n<p>a</p>'],
    ['GFM の表は扱わない', '| a |\n| - |\n| b |', '<p>| a |\n| - |\n| b |</p>'],
    ['GFM の取り消し線は扱わない', '~~a~~', '<p>~~a~~</p>'],
    ['実体参照', '&copy; &#x3042; &amp;', '<p>© あ &amp;</p>'],
  ];
  for (const [label, src, expected] of cases) {
    await t.step(label, () => expect(md(src)).toBe(expected));
  }
});

Deno.test('Markdown の中の生の HTML の誤りは、Markdown の中の位置を示す', () => {
  try {
    md('a\n\nb\n\n  <p>x</p><body>');
    throw new Error('例外にならない');
  } catch (e) {
    expect(e).toBeInstanceOf(ConversionError);
    expect((e as ConversionError).line).toBe(5);
  }
});
