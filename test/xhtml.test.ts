// 自前の XML の断片の解析器と、XHTML の書き出し器
import { expect } from '@std/expect';
import type { Element, Root } from 'hast';
import { sourceToTree } from '../src/load/convert.ts';
import { ConversionError, writeXhtml } from '../src/load/xhtml-writer.ts';
import { parseXhtmlFragment, XmlError } from '../src/load/xml-fragment.ts';
import type { EpubVersion } from '../src/types.ts';

const roundTrip = (src: string, version: EpubVersion = '3.0') => writeXhtml(parseXhtmlFragment(src, version), version);
const html = (src: string, version: EpubVersion = '3.0') => writeXhtml(sourceToTree(src, 'html', version), version);

Deno.test('XML の断片の解析器', async (t) => {
  const cases: [string, string, string][] = [
    ['空の断片', '', ''],
    ['文字だけ', 'a &lt; b', 'a &lt; b'],
    ['事前定義の実体参照', '&lt;&gt;&amp;&quot;&apos;', '&lt;&gt;&amp;"\''],
    ['10 進と 16 進の文字参照', '&#12354;&#x3044;&#X3046;'.replace('&#X3046;', ''), 'あい'],
    ['補助平面の文字参照', '&#x1F600;', '\u{1F600}'],
    ['補助平面の文字', '<p>𠮷</p>', '<p>𠮷</p>'],
    ['単引用符の属性', "<p title='a\"b'/>", '<p title="a&quot;b"></p>'],
    ['属性値の中の実体参照', '<p title="&lt;&#x41;"/>', '<p title="&lt;A"></p>'],
    ['属性値の改行とタブの正規化', '<p title="a\nb\tc"/>', '<p title="a b c"></p>'],
    ['属性の = の周りの空白', '<p title = "a" />', '<p title="a"></p>'],
    ['終了タグの空白', '<p>a</p  >', '<p>a</p>'],
    ['CRLF を LF にする', '<p>a\r\nb\rc</p>', '<p>a\nb\nc</p>'],
    ['CDATA 区間', '<p><![CDATA[<a> & ]]></p>', '<p>&lt;a&gt; &amp; </p>'],
    ['CDATA 区間の中の ]]', '<p><![CDATA[a]]b]]></p>', '<p>a]]b</p>'],
    ['コメント', '<!-- a - b -->', '<!-- a - b -->'],
    ['入れ子', '<div><p><em>a</em><br/></p></div>', '<div><p><em>a</em><br/></p></div>'],
    ['空要素の閉じ方をそろえる', '<br></br><img src="a.png" alt=""/>', '<br/><img src="a.png" alt=""/>'],
    ['空でない要素の閉じ方', '<div/><span/>', '<div></div><span></span>'],
    ['class の複数の値', '<p class=" a  b "/>', '<p class="a b"></p>'],
    ['data 属性', '<p data-x-y="1"/>', '<p data-x-y="1"></p>'],
    ['xml:lang', '<p xml:lang="en"/>', '<p xml:lang="en"></p>'],
    ['XHTML の既定の名前空間の宣言', '<p xmlns="http://www.w3.org/1999/xhtml">a</p>', '<p>a</p>'],
    ['epub の接頭辞の宣言', '<p xmlns:epub="http://www.idpf.org/2007/ops" epub:type="x"/>', '<p epub:type="x"></p>'],
    [
      'SVG の大文字と小文字',
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><linearGradient gradientUnits="x"/></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><linearGradient gradientUnits="x"/></svg>',
    ],
    [
      'SVG の xlink:href',
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="a.png"/></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><image xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="a.png"/></svg>',
    ],
    [
      'SVG の foreignObject の中の XHTML',
      '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><p xmlns="http://www.w3.org/1999/xhtml">a</p></foreignObject></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><p xmlns="http://www.w3.org/1999/xhtml">a</p></foreignObject></svg>',
    ],
    [
      'MathML',
      '<math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi></math>',
      '<math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi></math>',
    ],
    ['ドットを含む要素の名前', '<my.el/>', '<my.el></my.el>'],
    ['ruby', '<ruby>漢<rp>(</rp><rt>かん</rt><rp>)</rp></ruby>', '<ruby>漢<rp>(</rp><rt>かん</rt><rp>)</rp></ruby>'],
  ];
  for (const [label, src, expected] of cases) {
    await t.step(label, () => expect(roundTrip(src)).toBe(expected));
  }
});

Deno.test('XML の断片の誤り', async (t) => {
  const cases: [string, string, EpubVersion?][] = [
    ['閉じない要素', '<p>'],
    ['合わない終了タグ', '<p></div>'],
    ['開始タグのない終了タグ', '</p>'],
    ['閉じないタグ', '<p'],
    ['引用符のない属性', '<p a=1/>'],
    ['値のない属性', '<p hidden/>'],
    ['属性の間の空白がない', '<p a="1"b="2"/>'],
    ['属性の重複', '<p a="1" a="2"/>'],
    ['属性値の中の <', '<p a="<"/>'],
    ['閉じない属性値', '<p a="x/>'],
    ['名前付きの実体参照', '<p>&nbsp;</p>'],
    ['閉じない実体参照', '<p>&amp</p>'],
    ['裸の &', '<p>a & b</p>'],
    ['NUL の文字参照', '&#0;'],
    ['サロゲートの文字参照', '&#xD800;'],
    ['範囲外の文字参照', '&#x110000;'],
    ['制御文字', 'a\u0001'],
    ['文字の中の ]]>', 'a ]]> b'],
    ['閉じないコメント', '<!-- a'],
    ['コメントの中の --', '<!-- a -- b -->'],
    ['- で終わるコメント', '<!-- a --->'],
    ['閉じない CDATA 区間', '<![CDATA[a'],
    ['DOCTYPE', '<!DOCTYPE html><p/>'],
    ['処理命令', '<?xml version="1.0"?><p/>'],
    ['数字で始まる要素の名前', '<1p/>'],
    ['接頭辞の付いた要素', '<epub:switch/>'],
    ['宣言のない接頭辞の属性', '<p foo:bar="1"/>'],
    ['EPUB 2.0.1 の epub の接頭辞', '<p epub:type="x"/>', '2.0.1'],
    ['知らない名前空間', '<p xmlns="urn:x"/>'],
  ];
  for (const [label, src, version] of cases) {
    await t.step(label, () => expect(() => parseXhtmlFragment(src, version ?? '3.0')).toThrow(XmlError));
  }
});

Deno.test('XML の断片の誤りの位置', () => {
  const cases: [string, number, number][] = [
    ['<p>\n  &nbsp;</p>', 2, 3],
    ['<p>\n<b>\n</p>', 3, 1],
    ['<div>\n<p>', 2, 1],
    ['a\n\nb\u0001', 3, 2],
  ];
  for (const [src, line, column] of cases) {
    try {
      parseXhtmlFragment(src, '3.0');
      throw new Error(`例外にならない: ${JSON.stringify(src)}`);
    } catch (e) {
      expect(e).toBeInstanceOf(XmlError);
      expect([(e as XmlError).line, (e as XmlError).column], JSON.stringify(src)).toEqual([line, column]);
    }
  }
});

Deno.test('解析した木は位置を持つ', () => {
  const tree = parseXhtmlFragment('a\n<p>\n  <b>x</b></p>', '3.0') as Root;
  const p = tree.children[1] as Element;
  expect(p.position?.start).toMatchObject({ line: 2, column: 1 });
  const b = p.children[1] as Element;
  expect(b.position?.start).toMatchObject({ line: 3, column: 3 });
});

Deno.test('HTML Living Standard から XHTML への変換', async (t) => {
  const cases: [string, string, string][] = [
    ['閉じ忘れの li', '<ul><li>a<li>b</ul>', '<ul><li>a</li><li>b</li></ul>'],
    ['閉じ忘れの p とブロック', '<p>a<div>b</div>', '<p>a</p><div>b</div>'],
    ['誤った入れ子の回復', '<b><i>a</b>c</i>', '<b><i>a</i></b><i>c</i>'],
    ['大文字のタグと属性', '<P CLASS=x>a</P>', '<p class="x">a</p>'],
    [
      '真偽の属性',
      '<details open><summary>s</summary></details>',
      '<details open="open"><summary>s</summary></details>',
    ],
    ['値のない属性', '<p hidden>a</p>', '<p hidden="hidden">a</p>'],
    ['名前付きの文字参照', '&copy;&hellip;&amp;&lt;', '©…&amp;&lt;'],
    ['セミコロンのない文字参照', '&copy 2026', '© 2026'],
    ['属性の中の文字参照', '<a title="&quot;x&quot;" href="#a">a</a>', '<a title="&quot;x&quot;" href="#a">a</a>'],
    [
      'テーブルの tbody の補完',
      '<table><tr><td>a</td></tr></table>',
      '<table><tbody><tr><td>a</td></tr></tbody></table>',
    ],
    [
      'インラインの SVG',
      '<svg viewbox="0 0 1 1"><circle r=1 /></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><circle r="1"/></svg>',
    ],
    [
      'インラインの MathML',
      '<math><mi>x</mi></math>',
      '<math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi></math>',
    ],
    [
      'SVG の中の HTML',
      '<svg><foreignObject><p>a</p></foreignObject></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><p xmlns="http://www.w3.org/1999/xhtml">a</p></foreignObject></svg>',
    ],
    ['style の中身を実体参照にする', '<style>a > b {}</style>', '<style>a &gt; b {}</style>'],
    ['XHTML の名前空間の xmlns は捨てる', '<p xmlns="http://www.w3.org/1999/xhtml">a</p>', '<p>a</p>'],
    ['xml:lang', '<p xml:lang="en">a</p>', '<p xml:lang="en">a</p>'],
    ['lang', '<p lang="en">a</p>', '<p lang="en">a</p>'],
    ['コメント', '<!-- c -->a', '<!-- c -->a'],
    ['空白だけの文字', '<p> </p>\n', '<p> </p>\n'],
    ['ruby', '<ruby>漢<rt>かん</ruby>', '<ruby>漢<rt>かん</rt></ruby>'],
  ];
  for (const [label, src, expected] of cases) {
    await t.step(label, () => expect(html(src)).toBe(expected));
  }
});

Deno.test('XHTML に直せない HTML', async (t) => {
  const cases: [string, string, EpubVersion?][] = [
    ['XML の名前でない属性', '<p a"b=1>x</p>'],
    ['数字で始まる属性', '<p 1a=1>x</p>'],
    ['知らない接頭辞の属性', '<p foo:bar=1>x</p>'],
    ['EPUB 2.0.1 の epub:type', '<p epub:type=x>x</p>', '2.0.1'],
    ['知らない接頭辞の要素', '<foo:bar>x</foo:bar>'],
    ['違う名前空間の xmlns', '<p xmlns="urn:x">x</p>'],
    ['知らない接頭辞の宣言', '<p xmlns:foo="urn:x">x</p>'],
    ['制御文字', '<p>\u0002</p>'],
    ['属性の中の制御文字', '<p title="\u0002">x</p>'],
    ['コメントの中の --', '<!-- a -- b -->'],
    ['- で終わるコメント', '<!--a--->'],
    ['DOCTYPE', '<!doctype html>'],
    ['html', '<html><p>x</p></html>'],
    ['head', '<head></head>'],
    ['body', '<BODY class=x>'],
    ['template', '<template><p>x</p></template>'],
  ];
  for (const [label, src, version] of cases) {
    await t.step(label, () => expect(() => html(src, version ?? '3.0')).toThrow(ConversionError));
  }
});

Deno.test('コメントの中の html や body は誤りにしない', () => {
  expect(html('<!-- <html><body> -->a')).toBe('<!-- <html><body> -->a');
});

Deno.test('HTML の誤りの位置', () => {
  try {
    html('<p>a</p>\n\n  <p a"b=1>x</p>');
    throw new Error('例外にならない');
  } catch (e) {
    expect(e).toBeInstanceOf(ConversionError);
    expect([(e as ConversionError).line, (e as ConversionError).column]).toEqual([3, 3]);
  }
  try {
    html('<p>a</p>\n<body>');
    throw new Error('例外にならない');
  } catch (e) {
    expect([(e as ConversionError).line, (e as ConversionError).column]).toEqual([2, 1]);
  }
});

Deno.test('書き出した XHTML は自前の解析器で読み直せ、同じ結果になる', () => {
  const sources = [
    '<ul><li>a<li>b</ul><p class=x>&copy; <b><i>c</b></i>',
    '<svg viewbox="0 0 1 1"><image xlink:href="a.png"/><foreignObject><p>x</p></foreignObject></svg>',
    '<table><tr><td>a<td>b</table><details open><summary>s</summary></details>',
    '<p epub:type="chapter" xml:lang="en">a<br>b</p><!-- c -->',
  ];
  for (const src of sources) {
    const once = html(src);
    expect(roundTrip(once), src).toBe(once);
  }
});
