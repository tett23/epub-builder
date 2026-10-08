import { expect } from '@std/expect';
import { parseToml, TomlDateTime, TomlError } from '../load.ts';

Deno.test('文字列の 4 種', () => {
  const doc = parseToml(String.raw`
basic = "a\tb\u00e9\U0001F600\"\\"
literal = 'C:\path'
ml = """
one
two \
   three"""
mll = '''
raw \n
'''
quotes = """a""""
`);
  expect(doc.basic).toBe('a\tbé😀"\\');
  expect(doc.literal).toBe('C:\\path');
  expect(doc.ml).toBe('one\ntwo three');
  expect(doc.mll).toBe('raw \\n\n');
  expect(doc.quotes).toBe('a"');
});

Deno.test('整数と浮動小数点数', () => {
  const doc = parseToml(`
a = +99
b = 1_000
c = 0xDEAD_beef
d = 0o755
e = 0b1101
f = -0.01
g = 5e+22
h = -inf
i = nan
j = 9223372036854775807
`);
  expect(doc).toMatchObject({ a: 99, b: 1000, c: 0xdeadbeef, d: 0o755, e: 13, f: -0.01, g: 5e22, h: -Infinity });
  expect(Number.isNaN(doc.i)).toBe(true);
  expect(doc.j).toBe(9223372036854775807n);
});

Deno.test('日時の 4 種', () => {
  const doc = parseToml(`
odt = 1979-05-27T07:32:00-09:00
space = 1979-05-27 07:32:00Z
ldt = 1979-05-27T07:32:00.999
ld = 1979-05-27
lt = 07:32:00
`);
  const odt = doc.odt as TomlDateTime;
  expect(odt.kind).toBe('offset-date-time');
  expect(odt.date!.toISOString()).toBe('1979-05-27T16:32:00.000Z');
  expect((doc.space as TomlDateTime).date!.toISOString()).toBe('1979-05-27T07:32:00.000Z');
  expect((doc.ldt as TomlDateTime).kind).toBe('local-date-time');
  expect((doc.ld as TomlDateTime).kind).toBe('local-date');
  expect((doc.lt as TomlDateTime).kind).toBe('local-time');
});

Deno.test('配列、表、インライン表、表の配列、ドット付きのキー', () => {
  const doc = parseToml(`
arr = [ 1, "two", [3], # comment
  { x = 4 }, ]
site."google.com" = true
[a.b]
c = 1
[a]
d = { e.f = 2 }
[a.b.g]
h = 3
[[p]]
n = 1
[[p]]
n = 2
[p.q]
r = 3
`);
  expect(doc).toEqual({
    arr: [1, 'two', [3], { x: 4 }],
    site: { 'google.com': true },
    a: { b: { c: 1, g: { h: 3 } }, d: { e: { f: 2 } } },
    p: [{ n: 1 }, { n: 2, q: { r: 3 } }],
  });
});

Deno.test('誤った TOML は位置を示す例外になる', () => {
  const invalid = [
    'a = 1\na = 2',
    '[a]\n[a]',
    'a.b = 1\n[a]',
    '[a.b.c]\nz = 1\n[a]\nb.c.t = 2',
    'a = {b = 1}\n[a.c]',
    'a = [1]\n[[a]]',
    'a = {b = 1,}',
    'a = 01',
    'a = 1.',
    'a = "\\x41"',
    'a = 1979-02-30',
    'a = 1 b = 2',
    'a = "no end',
    'a = 9223372036854775808',
    '= 1',
    'a = {\nb = 1}',
    'a = """a""""""',
  ];
  for (const src of invalid) expect(() => parseToml(src), src).toThrow(TomlError);
  expect(() => parseToml('a = 1\nb = ?')).toThrow(/^2:5: /);
});
