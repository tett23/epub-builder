import { expect } from '@std/expect';
import { sourceToTree } from '../src/load/convert.ts';
import { headingTitle } from '../src/load/load-book.ts';
import { parseRuby } from '../src/load/ruby.ts';
import { ConversionError, writeXhtml } from '../src/load/xhtml-writer.ts';
import { parseXhtmlFragment } from '../src/load/xml-fragment.ts';
import type { EpubVersion } from '../src/types.ts';

const convert = (src: string, format: 'md' | 'xhtml' | 'html', version: EpubVersion = '3.0') =>
  writeXhtml(sourceToTree(src, format, version), version);

Deno.test('ルビの記法を区切る', () => {
  expect(parseRuby('｜試験《しけん》と|半角《はんかく》')).toEqual([
    { type: 'ruby', base: '試験', reading: 'しけん' },
    { type: 'text', value: 'と' },
    { type: 'ruby', base: '半角', reading: 'はんかく' },
  ]);
  expect(parseRuby('かな漢字々《かんじ》')).toEqual([
    { type: 'text', value: 'かな' },
    { type: 'ruby', base: '漢字々', reading: 'かんじ' },
  ]);
  for (const literal of ['｜《ルビ》', '漢字《》', 'かな《かな》', 'a | b', '漢字《か《な》', '\\《漢字》']) {
    const expected = literal.replace('\\《', '《');
    expect(parseRuby(literal), literal).toEqual([{ type: 'text', value: expected }]);
  }
  expect(parseRuby('漢\\《字《じ》')).toEqual([
    { type: 'text', value: '漢《' },
    { type: 'ruby', base: '字', reading: 'じ' },
  ]);
});

Deno.test('ルビは版ごとの形で出る', () => {
  expect(convert('漢字《かんじ》', 'md', '3.0')).toBe('<p><ruby>漢字<rp>（</rp><rt>かんじ</rt><rp>）</rp></ruby></p>');
  // OPS 2.0.1 は ruby 要素を持たないため、括弧書きにする（ADR 0013）
  const v2 = convert('漢字《かんじ》', 'md', '2.0.1');
  expect(v2).toBe(
    '<p><span class="ruby"><span class="rb">漢字</span><span class="rp">（</span><span class="rt">かんじ</span><span class="rp">）</span></span></p>',
  );
  expect(v2).not.toContain('<ruby');
});

Deno.test('ルビは強調、リンク、見出しの中で使え、コードの中では使えない', () => {
  const out = convert(
    '# 見出《みだし》\n\n*強調《きょうちょう》* [連結《れんけつ》](#a) `漢字《かんじ》`\n\n    漢字《かんじ》',
    'md',
  );
  expect(out).toContain('<h1><ruby>見出');
  expect(out).toContain('<em><ruby>強調');
  expect(out).toContain('<a href="#a"><ruby>連結');
  expect(out).toContain('<code>漢字《かんじ》</code>');
  expect(out).toContain('<pre><code>漢字《かんじ》\n</code></pre>');
});

Deno.test('脚注は、最初に参照した順の番号で、版ごとの形で出る', () => {
  const src = 'a[^y] b[^x] c[^y]\n\n[^x]: X です。\n\n[^y]: Y です。\n\n    二段落目。\n';
  const v3 = convert(src, 'md', '3.0');
  expect(v3).toContain('<sup><a class="noteref" id="fnref-1" href="#fn-1" epub:type="noteref">1</a></sup>');
  expect(v3).toContain('<sup><a class="noteref" id="fnref-2" href="#fn-2" epub:type="noteref">2</a></sup>');
  expect(v3).toContain('<sup><a class="noteref" id="fnref-1-2" href="#fn-1" epub:type="noteref">1</a></sup>');
  expect(v3).toContain(
    '<div class="footnotes"><aside class="footnote" id="fn-1" epub:type="footnote"><p><a href="#fnref-1">1</a> Y です。</p><p>二段落目。</p></aside>',
  );
  expect(v3).toContain(
    '<aside class="footnote" id="fn-2" epub:type="footnote"><p><a href="#fnref-2">2</a> X です。</p>',
  );
  const v2 = convert(src, 'md', '2.0.1');
  expect(v2).toContain('<sup><a class="noteref" id="fnref-1" href="#fn-1">1</a></sup>');
  expect(v2).toContain('<div class="footnote" id="fn-1"><p><a href="#fnref-1">1</a> Y です。</p>');
  expect(v2).not.toContain('epub:type');
});

Deno.test('脚注の誤りは例外になる', () => {
  const invalid = [
    'a[^none]',
    'a\n\n[^x]: 参照されない',
    'a[^x]\n\n[^x]: 一\n\n[^x]: 二',
    'a[^x]\n\n[^x]: 中で[^y]\n\n[^y]: y',
    'a[^x]\n\n<p id="fn-1">衝突</p>\n\n[^x]: x',
  ];
  for (const src of invalid) expect(() => convert(src, 'md'), src).toThrow(ConversionError);
});

Deno.test('Markdown と HTML は XHTML の構文で出る', () => {
  expect(convert('a<br>b &nbsp;\n\n<hr>', 'md')).toBe('<p>a<br/>b  </p>\n<hr/>');
  expect(convert('<p class=x>a<br>b<p>c', 'html')).toBe('<p class="x">a<br/>b</p><p>c</p>');
  expect(convert('<section epub:type="chapter"><div></div></section>', 'html')).toBe(
    '<section epub:type="chapter"><div></div></section>',
  );
  expect(convert('<svg viewBox="0 0 1 1"><image xlink:href="a.png"/></svg>', 'html')).toBe(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><image xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="a.png"/></svg>',
  );
  expect(convert('<p epub:type="x" xml:lang="en">a<!-- c --><br/>&amp;&#x3042;<![CDATA[<b>]]></p>', 'xhtml')).toBe(
    '<p epub:type="x" xml:lang="en">a<!-- c --><br/>&amp;あ&lt;b&gt;</p>',
  );
});

Deno.test('XHTML に直せないものは位置を示す例外になる', () => {
  const invalid: [string, 'md' | 'xhtml' | 'html', EpubVersion?][] = [
    ['<p a"b="1">x</p>', 'html'],
    ['<p foo:bar="1">x</p>', 'html'],
    ['<p epub:type="x">x</p>', 'html', '2.0.1'],
    ['<p>\u0001</p>', 'html'],
    ['<!-- a -- b -->', 'html'],
    ['<!DOCTYPE html><p>x</p>', 'html'],
    ['<head><title>t</title></head>', 'html'],
    ['a\n\n<body>\n\nb', 'md'],
    ['<p>x', 'xhtml'],
    ['<p>&nbsp;</p>', 'xhtml'],
    ['<!DOCTYPE p><p/>', 'xhtml'],
    ['<p>a</b>', 'xhtml'],
    ['<p a="1" a="2"/>', 'xhtml'],
    ['<x:p/>', 'xhtml'],
    ['<p epub:type="x"/>', 'xhtml', '2.0.1'],
  ];
  for (const [src, format, version] of invalid) {
    expect(() => convert(src, format, version ?? '3.0'), src).toThrow(ConversionError);
  }
  expect(() => convert('<p>\n  <b>x</p>', 'xhtml')).toThrow(/^2:7: /);
});

Deno.test('自前の解析器と書き出し器で、読み直すと同じ結果になる', () => {
  const src =
    '<div class="a b"><p xml:lang="en">x &amp; y</p><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1"/></svg><br/></div>';
  const once = writeXhtml(parseXhtmlFragment(src, '3.0'), '3.0');
  expect(once).toBe(src);
  expect(writeXhtml(parseXhtmlFragment(once, '3.0'), '3.0')).toBe(once);
});

Deno.test('見出しの題名は、ルビの親文字だけを使い、脚注の参照を除く', () => {
  for (const version of ['2.0.1', '3.0'] as const) {
    expect(headingTitle(sourceToTree('## 第一《だいいち》 話[^x]\n\n[^x]: x', 'md', version))).toBe('第一 話');
  }
  expect(headingTitle(sourceToTree('<p>a</p><h3>  題 <b>名</b> </h3>', 'html', '3.0'))).toBe('題 名');
  expect(headingTitle(sourceToTree('本文だけ', 'md', '3.0'))).toBe(undefined);
});
