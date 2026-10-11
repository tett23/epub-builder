// TOML 1.0.0 の仕様の例に沿った、正しい文書と誤った文書の網羅
import { expect } from '@std/expect';
import { thrown } from './helpers/errors.ts';
import { isTomlDateTime, parseToml, type TomlDateTime, type TomlTable } from '../load.ts';

/** 日時を文字列にして比べやすくする */
function plain(value: unknown): unknown {
  if (isTomlDateTime(value)) return `${value.kind}:${value.text}`;
  if (Array.isArray(value)) return value.map(plain);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]));
  }
  return value;
}

const valid: [string, string, TomlTable | Record<string, unknown>][] = [
  ['空の文書', '', {}],
  ['コメントと空行だけ', '# a\n\n   # b\n', {}],
  ['BOM', '\uFEFFa = 1', { a: 1 }],
  ['CRLF', 'a = 1\r\nb = "x"\r\n', { a: 1, b: 'x' }],
  ['キーの周りの空白', '  a\t=\t1  # c', { a: 1 }],
  ['数字だけの裸のキー', '1234 = "v"', { '1234': 'v' }],
  ['ハイフンと下線のキー', 'a-b_c = 1', { 'a-b_c': 1 }],
  ['引用符のキー', '"a b" = 1\n\'c.d\' = 2\n"" = 3', { 'a b': 1, 'c.d': 2, '': 3 }],
  ['ドット付きのキーの空白', 'a . b . c = 1', { a: { b: { c: 1 } } }],
  ['数字のドット付きのキー', '3.14159 = "pi"', { '3': { '14159': 'pi' } }],
  ['ドット付きのキーで表を広げる', 'a.b = 1\na.c = 2', { a: { b: 1, c: 2 } }],
  ['エスケープ', String.raw`a = "\b\t\n\f\r\"\\\u0041\U0001F600"`, { a: '\b\t\n\f\r"\\A\u{1F600}' }],
  ['リテラル文字列はエスケープしない', String.raw`a = '\n\u0041'`, { a: '\\n\\u0041' }],
  ['複数行の文字列の最初の改行は捨てる', 'a = """\nx"""', { a: 'x' }],
  ['複数行の文字列の CRLF', 'a = """\r\nx\r\ny"""', { a: 'x\r\ny' }],
  ['行末のバックスラッシュ', 'a = """x \\\n\n   y \\\n z"""', { a: 'x y z' }],
  ['複数行の文字列の中の引用符', 'a = """x""y"""', { a: 'x""y' }],
  ['閉じの前の二つの引用符', 'a = """x"""""', { a: 'x""' }],
  ['複数行のリテラル文字列の閉じの前の引用符', "a = '''x'''''", { a: "x''" }],
  ['複数行のリテラル文字列の最初の改行', "a = '''\nx\\y'''", { a: 'x\\y' }],
  ['タブを含む文字列', 'a = "x\ty"', { a: 'x\ty' }],
  ['整数の符号', 'a = +0\nb = -0\nc = -17', { a: 0, b: -0, c: -17 }],
  ['大きな負の整数', 'a = -9223372036854775808', { a: -9223372036854775808n }],
  ['安全な範囲の整数は number', 'a = 9007199254740991', { a: 9007199254740991 }],
  ['安全な範囲を超える整数は bigint', 'a = 9007199254740992', { a: 9007199254740992n }],
  ['16 進数、8 進数、2 進数', 'a = 0x00ff\nb = 0o0_7\nc = 0b0_1', { a: 255, b: 7, c: 1 }],
  ['浮動小数点数', 'a = 3.1415\nb = -0.0\nc = 1e06\nd = -2E-2\ne = 6.626e-34\nf = 224_617.445_991', {
    a: 3.1415,
    b: -0,
    c: 1e6,
    d: -0.02,
    e: 6.626e-34,
    f: 224617.445991,
  }],
  ['無限大', 'a = inf\nb = +inf\nc = -inf', { a: Infinity, b: Infinity, c: -Infinity }],
  ['真偽値', 'a = true\nb = false', { a: true, b: false }],
  ['小文字の t と z の日時', 'a = 1979-05-27t07:32:00z', { a: 'offset-date-time:1979-05-27T07:32:00Z' }],
  ['小数秒のオフセット付きの日時', 'a = 1979-05-27T00:32:00.999999-07:00', {
    a: 'offset-date-time:1979-05-27T00:32:00.999999-07:00',
  }],
  ['閏年の 2 月 29 日', 'a = 2024-02-29', { a: 'local-date:2024-02-29' }],
  ['小数秒の時刻', 'a = 00:32:00.5', { a: 'local-time:00:32:00.5' }],
  ['日付の後のコメント', 'a = 1979-05-27 # c', { a: 'local-date:1979-05-27' }],
  ['空の配列', 'a = []', { a: [] }],
  ['入れ子の配列', 'a = [[1, 2], ["a", "b"]]', { a: [[1, 2], ['a', 'b']] }],
  ['型の混ざった配列', 'a = [1, "a", 1.5, true, [], {}]', { a: [1, 'a', 1.5, true, [], {}] }],
  ['複数行の配列とコメント', 'a = [\n  1, # one\n  # comment\n  2,\n]', { a: [1, 2] }],
  ['空のインライン表', 'a = {}', { a: {} }],
  ['入れ子のインライン表', 'a = { b = { c = 1 }, d.e = 2 }', { a: { b: { c: 1 }, d: { e: 2 } } }],
  ['インライン表の配列', 'a = [{ b = 1 }, { b = 2 }]', { a: [{ b: 1 }, { b: 2 }] }],
  ['空の表', '[a]', { a: {} }],
  ['表の見出しの空白', '[ a . "b c" . d ]', { a: { 'b c': { d: {} } } }],
  ['暗黙の表を後から定義する', '[a.b.c]\n[a]\nd = 1', { a: { b: { c: {} }, d: 1 } }],
  ['ドット付きのキーの表の下に表を足す', '[a]\nb.c = 1\n[a.b.d]\ne = 2', { a: { b: { c: 1, d: { e: 2 } } } }],
  ['表の配列の入れ子', '[[a]]\n[[a.b]]\nc = 1\n[[a.b]]\nc = 2\n[[a]]', { a: [{ b: [{ c: 1 }, { c: 2 }] }, {}] }],
  ['表の配列の要素の下の表', '[[a]]\n[a.b]\nc = 1', { a: [{ b: { c: 1 } }] }],
  ['根のキーの後の表', 'x = 1\n[t]\ny = 2', { x: 1, t: { y: 2 } }],
  ['コメントの中の引用符と記号', 'a = 1 # "]=[ \'', { a: 1 }],
  ['true で始まる裸のキー', 'trueish = 1', { trueish: 1 }],
  ['inf で始まる裸のキー', 'info = 1\nnan_x = 2', { info: 1, nan_x: 2 }],
];

Deno.test('TOML 1.0.0 の正しい文書を読める', async (t) => {
  for (const [label, src, expected] of valid) {
    await t.step(label, () => {
      const result = plain(parseToml(src));
      if (Object.values(expected).some((v) => typeof v === 'number' && Number.isNaN(v))) return;
      expect(result).toEqual(expected);
    });
  }
});

Deno.test('nan は NaN になる', () => {
  const doc = parseToml('a = nan\nb = +nan\nc = -nan');
  expect([doc.a, doc.b, doc.c].every((v) => Number.isNaN(v))).toBe(true);
});

Deno.test('-0.0 と +0 を区別する', () => {
  expect(Object.is(parseToml('a = -0.0').a, -0)).toBe(true);
  expect(Object.is(parseToml('a = +0.0').a, 0)).toBe(true);
});

Deno.test('閏秒は 59 秒の時点にする', () => {
  const doc = parseToml('a = 1990-12-31T23:59:60Z');
  const value = doc.a as TomlDateTime;
  expect(value.text).toBe('1990-12-31T23:59:60Z');
  expect(value.date!.toISOString()).toBe('1990-12-31T23:59:59.000Z');
});

const invalid: [string, string][] = [
  ['値のないキー', 'a ='],
  ['キーのない値', '= 1'],
  ['改行をまたぐキーと値', 'a\n= 1'],
  ['空の裸のキー', '. = 1'],
  ['ドットで終わるキー', 'a. = 1'],
  ['二重のドット', 'a..b = 1'],
  ['裸のキーに使えない文字', 'a/b = 1'],
  ['複数行の文字列のキー', '"""a""" = 1'],
  ['キーの重複', 'a = 1\na = 2'],
  ['引用符で書いたキーの重複', 'a = 1\n"a" = 2'],
  ['ドット付きのキーで値を表にする', 'a = 1\na.b = 2'],
  ['表の重複', '[a]\n[a]'],
  ['表とキーの重複', 'a = 1\n[a]'],
  ['ドット付きのキーで定義した表を見出しで定義する', '[a]\nb.c = 1\n[a.b]'],
  ['見出しの表をドット付きのキーで広げる', '[a.b]\n[a]\nb.c = 1'],
  ['インライン表を見出しで広げる', 'a = {}\n[a.b]'],
  ['インライン表をドット付きのキーで広げる', 'a = {b = 1}\na.c = 2'],
  ['インライン表の中のキーの重複', 'a = {b = 1, b = 2}'],
  ['インライン表の中の改行', 'a = {b = 1,\nc = 2}'],
  ['インライン表の最後のカンマ', 'a = {b = 1,}'],
  ['インライン表の先頭のカンマ', 'a = {, b = 1}'],
  ['インライン表が閉じない', 'a = {b = 1'],
  ['静的な配列に表の配列を足す', 'a = []\n[[a]]'],
  ['表を表の配列にする', '[a]\n[[a]]'],
  ['表の配列を表として定義する', '[[a]]\n[a]'],
  ['見出しが閉じない', '[a'],
  ['表の配列の見出しが閉じない', '[[a]'],
  ['空の見出し', '[]'],
  ['見出しの後の値', '[a] b = 1'],
  ['配列のカンマの重複', 'a = [1,,2]'],
  ['配列の先頭のカンマ', 'a = [,1]'],
  ['配列が閉じない', 'a = [1, 2'],
  ['配列の要素の間にカンマがない', 'a = [1 2]'],
  ['知らないエスケープ', String.raw`a = "\e"`],
  ['短い \\u', String.raw`a = "\u004"`],
  ['サロゲートの \\u', String.raw`a = "\uD800"`],
  ['範囲外の \\U', String.raw`a = "\U00110000"`],
  ['文字列の中の改行', 'a = "x\ny"'],
  ['リテラル文字列の中の改行', "a = 'x\ny'"],
  ['文字列の中の制御文字', 'a = "x\u0001"'],
  ['リテラル文字列の中の制御文字', "a = 'x\u007F'"],
  ['コメントの中の制御文字', 'a = 1 # \u0000'],
  ['単独の CR', 'a = 1\rb = 2'],
  ['複数行の文字列の中の単独の CR', 'a = """x\ry"""'],
  ['閉じない複数行の文字列', 'a = """x'],
  ['閉じない複数行のリテラル文字列', "a = '''x"],
  ['閉じの前の引用符が多すぎる', 'a = """x""""""'],
  ['行末でないバックスラッシュの後の空白', 'a = """x\\ y"""'],
  ['先頭のゼロ', 'a = 007'],
  ['符号付きの 16 進数', 'a = +0xff'],
  ['大文字の 0X', 'a = 0XFF'],
  ['先頭の下線', 'a = _1'],
  ['末尾の下線', 'a = 1_'],
  ['二重の下線', 'a = 1__2'],
  ['16 進数の範囲外の文字', 'a = 0xg'],
  ['8 進数の範囲外の文字', 'a = 0o8'],
  ['2 進数の範囲外の文字', 'a = 0b2'],
  ['範囲を超える整数', 'a = 9223372036854775808'],
  ['範囲を下回る整数', 'a = -9223372036854775809'],
  ['小数点で終わる', 'a = 1.'],
  ['小数点で始まる', 'a = .1'],
  ['指数の前の小数点', 'a = 1.e2'],
  ['指数がない', 'a = 1e'],
  ['小数点の前後の下線', 'a = 1_.5'],
  ['大文字の Inf', 'a = Inf'],
  ['大文字の NaN', 'a = NaN'],
  ['大文字の True', 'a = True'],
  ['13 月', 'a = 2024-13-01'],
  ['平年の 2 月 29 日', 'a = 2023-02-29'],
  ['4 月 31 日', 'a = 2024-04-31'],
  ['24 時', 'a = 24:00:00'],
  ['60 分', 'a = 12:60:00'],
  ['61 秒', 'a = 12:00:61'],
  ['秒のない時刻', 'a = 12:00'],
  ['桁の足りない日付', 'a = 2024-1-01'],
  ['範囲外のオフセット', 'a = 2024-01-01T00:00:00+24:00'],
  ['日付と時刻の区切りの二重の空白', 'a = 2024-01-01  00:00:00'],
  ['値の後の文字', 'a = 1 x'],
  ['値の後の別のキー', 'a = 1 b = 2'],
  ['文字列の後の文字', 'a = "x"y'],
  ['裸の文字列の値', 'a = hello'],
];

Deno.test('TOML 1.0.0 の誤った文書は例外になる', async (t) => {
  for (const [label, src] of invalid) {
    await t.step(label, () => {
      expect(thrown(() => parseToml(src))).toMatchObject({ name: 'TomlError' });
    });
  }
});

Deno.test('例外は行と列を持つ', () => {
  const cases: [string, number, number][] = [
    ['a = 1\nb = 2\nb = 3', 3, 1],
    ['[a]\nx = "\\q"', 2, 6],
    ['a = [\n  1,\n  2 3]', 3, 5],
  ];
  for (const [src, line, column] of cases) {
    try {
      parseToml(src);
      throw new Error(`例外にならない: ${src}`);
    } catch (e) {
      expect(e).toMatchObject({ name: 'TomlError' });
      expect([(e as { line?: number; column?: number }).line, (e as { line?: number; column?: number }).column], src)
        .toEqual([line, column]);
    }
  }
});

Deno.test('表は通常のオブジェクトで、プロトタイプの名前をキーにできる', () => {
  const doc = parseToml('__proto__ = 1\nconstructor = 2\n[toString]\nx = 1');
  expect(Object.keys(doc)).toEqual(['__proto__', 'constructor', 'toString']);
  expect(doc.constructor).toBe(2);
  expect(({} as Record<string, unknown>).x).toBe(undefined);
});
