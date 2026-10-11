// コマンドラインの引数の解析（ADR 0024）。@std/cli の parseArgs のテストのうち、扱う機能に当たるものを移した
import { expect } from '@std/expect';
import { type ArgumentSpec, parseArguments } from '../src/args.ts';

const SPEC: ArgumentSpec = {
  string: ['output', 'epub-version', 'title'],
  boolean: ['strict', 'quiet', 'help'],
  alias: { o: 'output', e: 'epub-version', t: 'title', q: 'quiet', h: 'help' },
};

const ok = (args: string[], spec: ArgumentSpec = SPEC) => {
  const result = parseArguments(args, spec);
  if (!result.ok) throw new Error(`解析できない: ${result.message}`);
  return { positional: result.positional, options: result.options };
};
const ng = (args: string[], spec: ArgumentSpec = SPEC) => {
  const result = parseArguments(args, spec);
  if (result.ok) throw new Error(`解析できてしまう: ${JSON.stringify(result)}`);
  return result.message;
};

Deno.test('引数がない', () => {
  expect(ok([])).toEqual({ positional: [], options: {} });
});

Deno.test('位置引数（parseArgs の「parses args」「handles whitespace」）', () => {
  expect(ok(['build', 'my book', ' ', ''])).toEqual({ positional: ['build', 'my book', ' ', ''], options: {} });
});

Deno.test('真偽のオプション（「handles true boolean flag」「handles boolean flag default value」）', () => {
  expect(ok(['--strict']).options).toEqual({ strict: true });
  // 書かなければ値を持たない
  expect('strict' in ok([]).options).toBe(false);
});

Deno.test('短いオプションの別名（「handles alias」「handles boolean and alias」）', () => {
  expect(ok(['-q']).options).toEqual({ quiet: true });
  expect(ok(['-o', 'a.epub']).options).toEqual({ output: 'a.epub' });
  // 結果は長いオプションの名前だけで持つ
  expect('o' in ok(['-o', 'a.epub']).options).toBe(false);
});

Deno.test('値の要るオプションの三つの書き方（「handles long opts」「handles string args」「handles short」）', () => {
  for (const args of [['--output', 'a.epub'], ['--output=a.epub'], ['-o', 'a.epub']]) {
    expect(ok(args).options, args.join(' ')).toEqual({ output: 'a.epub' });
  }
});

Deno.test('= の後の値は = を含んでよく、空白や改行も保つ（「handles newlines in params」）', () => {
  expect(ok(['--title=a=b']).options).toEqual({ title: 'a=b' });
  expect(ok(['--title', 'x\ny']).options).toEqual({ title: 'x\ny' });
  expect(ok(['--title', ' 空白 ']).options).toEqual({ title: ' 空白 ' });
});

Deno.test('値は文字列のまま扱い、数にしない（「handles numbers」に対し、数への変換はしない）', () => {
  expect(ok(['-e', '3.0']).options).toEqual({ 'epub-version': '3.0' });
  expect(ok(['--title', '007']).options).toEqual({ title: '007' });
});

Deno.test('オプションと位置引数を混ぜて書ける（「handles comprehensive」「handles boolean and non-boolean」）', () => {
  expect(ok(['dir', '-e', 'all', '--strict', 'more', '--output=b.epub', '-q'])).toEqual({
    positional: ['dir', 'more'],
    options: { 'epub-version': 'all', strict: true, output: 'b.epub', quiet: true },
  });
});

Deno.test('真偽のオプションは次の引数を値として取らない（「handles boolean and non-boolean」）', () => {
  expect(ok(['--strict', 'dir'])).toEqual({ positional: ['dir'], options: { strict: true } });
});

Deno.test('同じオプションを二度書くと後の値を使う（「handles latest flag boolean」）', () => {
  expect(ok(['-o', 'a.epub', '--output', 'b.epub']).options).toEqual({ output: 'b.epub' });
  expect(ok(['--quiet', '-q']).options).toEqual({ quiet: true });
});

Deno.test('-- の後はすべて位置引数（「handles double dash」「moves args after double dash」「handles value following double hyphen」）', () => {
  expect(ok(['a', '--', '--strict', '-o', 'x', '--'])).toEqual({
    positional: ['a', '--strict', '-o', 'x', '--'],
    options: {},
  });
  expect(ok(['--strict', '--'])).toEqual({ positional: [], options: { strict: true } });
});

Deno.test('- だけの引数は位置引数で、値にもなる（「handles hyphen」）', () => {
  expect(ok(['-'])).toEqual({ positional: ['-'], options: {} });
  expect(ok(['-o', '-']).options).toEqual({ output: '-' });
});

Deno.test('知らないオプションは誤り（「handles string and alias is not unknown」の逆）', () => {
  expect(ng(['--fast'])).toBe('知らないオプション: --fast');
  expect(ng(['-x'])).toBe('知らないオプション: -x');
  expect(ng(['--fast=1'])).toBe('知らないオプション: --fast=1');
  // 別名の名前を長いオプションとして書くことはできない
  expect(ng(['--o', 'a'])).toBe('知らないオプション: --o');
  // 長いオプションの名前を短いオプションとして書くことはできない
  expect(ng(['-output', 'a'])).toBe('知らないオプション: -output');
});

Deno.test('値の要るオプションの値がないのは誤り（「handles empty strings」「handles empty value after equals sign」）', () => {
  expect(ng(['--output'])).toBe('--output に値が要る');
  expect(ng(['-o'])).toBe('--output に値が要る');
  expect(ng(['--output='])).toBe('--output に値が要る');
  expect(ng(['--output', ''])).toBe('--output に値が要る');
  // 次の引数がオプションなら値にしない
  expect(ng(['-o', '--strict'])).toBe('--output に値が要る');
  expect(ng(['-o', '-q'])).toBe('--output に値が要る');
});

Deno.test('真偽のオプションに値を付けるのは誤り（「handles boolean true parsing」に当たる書き方は扱わない）', () => {
  expect(ng(['--strict=true'])).toBe('--strict は値を取らない');
  expect(ng(['--quiet=false'])).toBe('--quiet は値を取らない');
});

Deno.test('扱わない書き方：短いオプションのまとめ書きと否定（「handles multi short」「handles string negatable option」）', () => {
  expect(ng(['-qe', '3.0'])).toBe('知らないオプション: -qe');
  expect(ng(['--no-strict'])).toBe('知らないオプション: --no-strict');
});

Deno.test('Object のプロパティの名前はオプションにならない（「handles flag builtin property」）', () => {
  expect(ng(['--toString'])).toBe('知らないオプション: --toString');
  expect(ng(['-constructor'])).toBe('知らないオプション: -constructor');
  expect(ng(['-__proto__'])).toBe('知らないオプション: -__proto__');
});

Deno.test('定義のない仕様では、オプションはすべて知らないオプション', () => {
  expect(ng(['--help'], {})).toBe('知らないオプション: --help');
  expect(ok(['a'], {})).toEqual({ positional: ['a'], options: {} });
});

Deno.test('引数の配列を変えない', () => {
  const args = ['-o', 'a.epub', 'dir'];
  const copy = [...args];
  ok(args);
  expect(args).toEqual(copy);
});
