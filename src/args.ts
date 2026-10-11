// コマンドラインの引数の解析（ADR 0022）。@std/cli の parseArgs のうち、CLI が使う機能だけを自前で書く

export interface ArgumentSpec {
  /** 値の要る長いオプションの名前 */
  string?: string[];
  /** 真偽の長いオプションの名前 */
  boolean?: string[];
  /** 短いオプションの名前から、長いオプションの名前へ */
  alias?: Record<string, string>;
}

export type ParsedArguments =
  | { ok: true; positional: string[]; options: Record<string, string | boolean> }
  | { ok: false; message: string };

/**
 * 引数を解析する。扱うのは、長いオプションと短いオプション（長いオプションの別名）、
 * `--name value`・`--name=value`・`-n value` の値、真偽のオプション、位置引数（`--` の後はすべて位置引数）。
 * 同じオプションを二度書いたときは後の値を使う。短いオプションのまとめ書きと否定（`--no-name`）は扱わない
 */
export function parseArguments(args: readonly string[], spec: ArgumentSpec): ParsedArguments {
  const strings = new Set(spec.string ?? []);
  const booleans = new Set(spec.boolean ?? []);
  const alias = spec.alias ?? {};
  const positional: string[] = [];
  const options: Record<string, string | boolean> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') {
      positional.push(...args.slice(i + 1));
      break;
    }
    if (arg === '-' || !arg.startsWith('-')) {
      positional.push(arg);
      continue;
    }
    const long = arg.startsWith('--');
    const body = arg.slice(long ? 2 : 1);
    const eq = long ? body.indexOf('=') : -1;
    const written = eq >= 0 ? body.slice(0, eq) : body;
    const name = long ? written : Object.hasOwn(alias, written) ? alias[written] : undefined;
    if (name === undefined || (!strings.has(name) && !booleans.has(name))) {
      return { ok: false, message: `知らないオプション: ${arg}` };
    }
    if (booleans.has(name)) {
      if (eq >= 0) return { ok: false, message: `--${name} は値を取らない` };
      options[name] = true;
      continue;
    }
    const inline = eq >= 0 ? body.slice(eq + 1) : undefined;
    const next = args[i + 1];
    const value = inline ?? (next !== undefined && (next === '-' || !next.startsWith('-')) ? next : undefined);
    if (value === undefined || value === '') return { ok: false, message: `--${name} に値が要る` };
    if (inline === undefined) i++;
    options[name] = value;
  }
  return { ok: true, positional, options };
}
