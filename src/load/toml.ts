// TOML 1.0.0 の解析器（ADR 0024）。外部の依存を持たない。クラスは使わない（ADR 0021）

import { hasErrorName, type NamedError, namedError } from '../errors.ts';

export type TomlDateTimeKind = 'offset-date-time' | 'local-date-time' | 'local-date' | 'local-time';

const TOML_DATE_TIME: unique symbol = Symbol.for('epub-builder.toml-date-time') as never;

/** TOML の日時。オフセット付きの日時だけが時点を表す（ADR 0021） */
export interface TomlDateTime {
  readonly [TOML_DATE_TIME]: true;
  readonly kind: TomlDateTimeKind;
  /** 書いたとおりの文字列（区切りの `T` は大文字にそろえる） */
  readonly text: string;
  /** オフセット付きの日時のときの時点 */
  readonly date?: Date;
}

/** TOML の日時を作る */
export function tomlDateTime(kind: TomlDateTimeKind, text: string, date?: Date): TomlDateTime {
  return Object.freeze({ [TOML_DATE_TIME]: true as const, kind, text, ...(date ? { date } : {}) });
}

/** TOML の日時かを判別する */
export function isTomlDateTime(value: unknown): value is TomlDateTime {
  return typeof value === 'object' && value !== null && (value as Record<symbol, unknown>)[TOML_DATE_TIME] === true;
}

export type TomlValue = string | number | bigint | boolean | TomlDateTime | TomlValue[] | TomlTable;
export interface TomlTable {
  [key: string]: TomlValue;
}

/** TOML の誤り。位置を持つ（ADR 0021） */
export type TomlError = NamedError<'TomlError', { line: number; column: number }>;

/** TOML の誤りを作る。メッセージの先頭に位置を付ける */
export function tomlError(message: string, line: number, column: number): TomlError {
  return namedError('TomlError', `${line}:${column}: ${message}`, { line, column });
}

/** TOML の誤りかを判別する */
export function isTomlError(value: unknown): value is TomlError {
  return hasErrorName(value, 'TomlError');
}

interface TableMeta {
  /** `[header]` で定義した */
  header: boolean;
  /** ドット付きのキーで定義した */
  dotted: boolean;
  /** インライン表（変更できない） */
  frozen: boolean;
}

const BARE_KEY = /[A-Za-z0-9_-]/;
const MAX_INT = 2n ** 63n - 1n;
const MIN_INT = -(2n ** 63n);

function isPlainTable(value: unknown): value is TomlTable {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !isTomlDateTime(value);
}

/** `__proto__` などの名前でもプロトタイプを変えずに、自身のプロパティとして置く */
function setKey(table: TomlTable, key: string, value: TomlValue): void {
  Object.defineProperty(table, key, { value, enumerable: true, writable: true, configurable: true });
}

function createParser(src: string): { parse: () => TomlTable } {
  let pos = 0;
  const tables = new WeakMap<TomlTable, TableMeta>();
  /** `[[header]]` で作った配列 */
  const arraysOfTables = new WeakSet<TomlValue[]>();
  const root: TomlTable = {};

  tables.set(root, { header: true, dotted: false, frozen: false });

  function error(message: string, at = pos): never {
    let line = 1;
    let column = 1;
    for (let i = 0; i < at && i < src.length; i++) {
      if (src[i] === '\n') {
        line++;
        column = 1;
      } else {
        column++;
      }
    }
    throw tomlError(message, line, column);
  }

  function peek(offset = 0): string {
    return src[pos + offset] ?? '';
  }

  function eof(): boolean {
    return pos >= src.length;
  }

  function skipWs(): void {
    while (peek() === ' ' || peek() === '\t') pos++;
  }

  function skipComment(): void {
    if (peek() !== '#') return;
    pos++;
    while (!eof() && peek() !== '\n') {
      const c = peek();
      if (c === '\r' && peek(1) === '\n') break;
      checkChar(c, false);
      pos++;
    }
  }

  function checkChar(c: string, allowNewline: boolean): void {
    const code = c.codePointAt(0)!;
    if (code === 0x09) return;
    if (allowNewline && (code === 0x0a)) return;
    if (code < 0x20 || code === 0x7f) error(`使えない制御文字 U+${code.toString(16).padStart(4, '0')}`);
  }

  /** 行の終わり（空白、コメント、改行か終端）を読む */
  function expectLineEnd(): void {
    skipWs();
    skipComment();
    if (eof()) return;
    if (peek() === '\n') {
      pos++;
      return;
    }
    if (peek() === '\r' && peek(1) === '\n') {
      pos += 2;
      return;
    }
    error('行の終わりが要る');
  }

  /** 空白、コメント、改行を読み飛ばす（配列の中で使う） */
  function skipWsCommentNewline(): void {
    for (;;) {
      skipWs();
      skipComment();
      if (peek() === '\n') pos++;
      else if (peek() === '\r' && peek(1) === '\n') pos += 2;
      else return;
    }
  }

  function parse(): TomlTable {
    if (peek() === '﻿') pos++;
    let current = root;
    while (!eof()) {
      skipWs();
      const c = peek();
      if (c === '#' || c === '\n' || c === '\r' || c === '') {
        expectLineEnd();
        continue;
      }
      if (c === '[') {
        if (peek(1) === '[') {
          pos += 2;
          skipWs();
          const start = pos;
          const keys = parseKey();
          skipWs();
          if (peek() !== ']' || peek(1) !== ']') error('`]]` が要る');
          pos += 2;
          current = openArrayTable(keys, start);
        } else {
          pos++;
          skipWs();
          const start = pos;
          const keys = parseKey();
          skipWs();
          if (peek() !== ']') error('`]` が要る');
          pos++;
          current = openTable(keys, start);
        }
        expectLineEnd();
        continue;
      }
      parseKeyValue(current, false);
      expectLineEnd();
    }
    return root;
  }

  function metaOf(table: TomlTable): TableMeta {
    return tables.get(table)!;
  }

  function newTable(meta: Partial<TableMeta>): TomlTable {
    const table: TomlTable = {};
    tables.set(table, { header: false, dotted: false, frozen: false, ...meta });
    return table;
  }

  /** ヘッダの途中のキーをたどる */
  function descendForHeader(keys: string[], at: number): TomlTable {
    let table = root;
    for (const key of keys) {
      if (!Object.hasOwn(table, key)) {
        const next = newTable({});
        setKey(table, key, next);
        table = next;
        continue;
      }
      const value = table[key];
      if (Array.isArray(value)) {
        if (!arraysOfTables.has(value)) error(`静的な配列 ${key} に表を足せない`, at);
        table = value[value.length - 1] as TomlTable;
      } else if (isPlainTable(value)) {
        if (metaOf(value).frozen) error(`インライン表 ${key} は変更できない`, at);
        table = value;
      } else {
        error(`${key} は表でない`, at);
      }
    }
    return table;
  }

  function openTable(keys: string[], at: number): TomlTable {
    const parent = descendForHeader(keys.slice(0, -1), at);
    const last = keys[keys.length - 1];
    if (!Object.hasOwn(parent, last)) {
      const table = newTable({ header: true });
      setKey(parent, last, table);
      return table;
    }
    const value = parent[last];
    if (!isPlainTable(value)) error(`${keys.join('.')} はすでに表でない値として定義されている`, at);
    const meta = metaOf(value);
    if (meta.header || meta.dotted || meta.frozen) error(`表 ${keys.join('.')} を二度定義している`, at);
    meta.header = true;
    return value;
  }

  function openArrayTable(keys: string[], at: number): TomlTable {
    const parent = descendForHeader(keys.slice(0, -1), at);
    const last = keys[keys.length - 1];
    const table = newTable({ header: true });
    if (!Object.hasOwn(parent, last)) {
      const array: TomlValue[] = [table];
      arraysOfTables.add(array);
      setKey(parent, last, array);
      return table;
    }
    const value = parent[last];
    if (!Array.isArray(value) || !arraysOfTables.has(value)) {
      error(`${keys.join('.')} は表の配列でない`, at);
    }
    value.push(table);
    return table;
  }

  function parseKeyValue(table: TomlTable, inline: boolean): void {
    const start = pos;
    const keys = parseKey();
    skipWs();
    if (peek() !== '=') error('`=` が要る');
    pos++;
    skipWs();
    const value = parseValue();
    let target = table;
    for (const key of keys.slice(0, -1)) {
      if (!Object.hasOwn(target, key)) {
        const next = newTable({ dotted: true });
        setKey(target, key, next);
        target = next;
        continue;
      }
      const existing = target[key];
      if (!isPlainTable(existing)) error(`${key} は表でない`, start);
      const meta = metaOf(existing);
      if (!meta.dotted || (meta.frozen && !inline)) error(`${keys.join('.')} を定義できない`, start);
      target = existing;
    }
    const last = keys[keys.length - 1];
    if (Object.hasOwn(target, last)) error(`キー ${keys.join('.')} を二度定義している`, start);
    setKey(target, last, value);
  }

  function parseKey(): string[] {
    const keys: string[] = [];
    for (;;) {
      skipWs();
      const c = peek();
      if (c === '"') {
        if (src.startsWith('"""', pos)) error('キーに複数行の文字列は使えない');
        keys.push(parseBasicString());
      } else if (c === "'") {
        if (src.startsWith("'''", pos)) error('キーに複数行の文字列は使えない');
        keys.push(parseLiteralString());
      } else {
        const start = pos;
        while (BARE_KEY.test(peek())) pos++;
        if (start === pos) error('キーが要る');
        keys.push(src.slice(start, pos));
      }
      skipWs();
      if (peek() !== '.') return keys;
      pos++;
    }
  }

  function parseValue(): TomlValue {
    const c = peek();
    if (c === '"') {
      return src.startsWith('"""', pos) ? parseMultilineBasicString() : parseBasicString();
    }
    if (c === "'") {
      return src.startsWith("'''", pos) ? parseMultilineLiteralString() : parseLiteralString();
    }
    if (c === '[') return parseArray();
    if (c === '{') return parseInlineTable();
    if (src.startsWith('true', pos) && !/[A-Za-z0-9_-]/.test(peek(4))) {
      pos += 4;
      return true;
    }
    if (src.startsWith('false', pos) && !/[A-Za-z0-9_-]/.test(peek(5))) {
      pos += 5;
      return false;
    }
    return parseNumberOrDate();
  }

  function parseEscape(): string {
    const start = pos;
    pos++; // バックスラッシュ
    const c = peek();
    pos++;
    switch (c) {
      case 'b':
        return '\b';
      case 't':
        return '\t';
      case 'n':
        return '\n';
      case 'f':
        return '\f';
      case 'r':
        return '\r';
      case '"':
        return '"';
      case '\\':
        return '\\';
      case 'u':
      case 'U': {
        const length = c === 'u' ? 4 : 8;
        const hex = src.slice(pos, pos + length);
        if (!new RegExp(`^[0-9A-Fa-f]{${length}}$`).test(hex)) error('正しくない Unicode のエスケープ', start);
        const code = parseInt(hex, 16);
        if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
          error('Unicode のスカラー値でないエスケープ', start);
        }
        pos += length;
        return String.fromCodePoint(code);
      }
      default:
        error('正しくないエスケープ', start);
    }
  }

  function parseBasicString(): string {
    pos++;
    let out = '';
    for (;;) {
      if (eof()) error('文字列が閉じていない');
      const c = peek();
      if (c === '"') {
        pos++;
        return out;
      }
      if (c === '\\') {
        out += parseEscape();
        continue;
      }
      if (c === '\n' || c === '\r') error('文字列の中に改行は書けない');
      checkChar(c, false);
      out += c;
      pos++;
    }
  }

  function parseLiteralString(): string {
    pos++;
    const start = pos;
    for (;;) {
      if (eof()) error('文字列が閉じていない');
      const c = peek();
      if (c === "'") {
        const value = src.slice(start, pos);
        pos++;
        return value;
      }
      if (c === '\n' || c === '\r') error('文字列の中に改行は書けない');
      checkChar(c, false);
      pos++;
    }
  }

  /** 複数行の文字列の、開きの直後の改行を読み飛ばす */
  function skipFirstNewline(): void {
    if (peek() === '\n') pos++;
    else if (peek() === '\r' && peek(1) === '\n') pos += 2;
  }

  /** 複数行の文字列の閉じ。閉じの前に引用符が 2 つまで続いてよい */
  function closeMultiline(quote: string): string | undefined {
    if (!src.startsWith(quote.repeat(3), pos)) return undefined;
    let extra = 0;
    while (peek(3 + extra) === quote && extra < 2) extra++;
    if (peek(3 + extra) === quote) error('引用符が多すぎる');
    pos += 3 + extra;
    return quote.repeat(extra);
  }

  function parseMultilineBasicString(): string {
    pos += 3;
    skipFirstNewline();
    let out = '';
    for (;;) {
      if (eof()) error('文字列が閉じていない');
      const closing = closeMultiline('"');
      if (closing !== undefined) return out + closing;
      const c = peek();
      if (c === '\\') {
        // 行末のバックスラッシュ：空白と改行を読み飛ばす
        let p = pos + 1;
        while (src[p] === ' ' || src[p] === '\t') p++;
        if (src[p] === '\n' || (src[p] === '\r' && src[p + 1] === '\n')) {
          pos = p;
          while (/^[ \t\n]$/.test(peek()) || (peek() === '\r' && peek(1) === '\n')) {
            pos += peek() === '\r' ? 2 : 1;
          }
          continue;
        }
        out += parseEscape();
        continue;
      }
      if (c === '\r') {
        if (peek(1) !== '\n') error('単独の CR は書けない');
        out += '\r\n';
        pos += 2;
        continue;
      }
      checkChar(c, true);
      out += c;
      pos++;
    }
  }

  function parseMultilineLiteralString(): string {
    pos += 3;
    skipFirstNewline();
    let out = '';
    for (;;) {
      if (eof()) error('文字列が閉じていない');
      const closing = closeMultiline("'");
      if (closing !== undefined) return out + closing;
      const c = peek();
      if (c === '\r') {
        if (peek(1) !== '\n') error('単独の CR は書けない');
        out += '\r\n';
        pos += 2;
        continue;
      }
      checkChar(c, true);
      out += c;
      pos++;
    }
  }

  function parseArray(): TomlValue[] {
    pos++;
    const array: TomlValue[] = [];
    for (;;) {
      skipWsCommentNewline();
      if (peek() === ']') {
        pos++;
        return array;
      }
      array.push(parseValue());
      skipWsCommentNewline();
      if (peek() === ',') {
        pos++;
        continue;
      }
      if (peek() === ']') {
        pos++;
        return array;
      }
      error('`,` か `]` が要る');
    }
  }

  function parseInlineTable(): TomlTable {
    pos++;
    const table = newTable({ frozen: true });
    skipWs();
    if (peek() === '}') {
      pos++;
      return table;
    }
    for (;;) {
      skipWs();
      parseKeyValue(table, true);
      skipWs();
      if (peek() === ',') {
        pos++;
        skipWs();
        if (peek() === '}') error('インライン表の最後に `,` は書けない');
        continue;
      }
      if (peek() === '}') {
        pos++;
        freeze(table);
        return table;
      }
      error('`,` か `}` が要る');
    }
  }

  /** インライン表の中でドット付きのキーが作った表も変更できなくする */
  function freeze(table: TomlTable): void {
    const meta = metaOf(table);
    meta.frozen = true;
    for (const value of Object.values(table)) {
      if (isPlainTable(value) && tables.has(value)) freeze(value);
    }
  }

  function parseNumberOrDate(): TomlValue {
    const start = pos;
    while (/[0-9A-Za-z_+\-.:]/.test(peek())) pos++;
    let token = src.slice(start, pos);
    // 日付と時刻の区切りの空白
    if (/^\d{4}-\d{2}-\d{2}$/.test(token) && peek() === ' ' && /\d/.test(peek(1))) {
      const save = pos;
      pos++;
      const timeStart = pos;
      while (/[0-9A-Za-z_+\-.:]/.test(peek())) pos++;
      const time = src.slice(timeStart, pos);
      if (/^\d{2}:\d{2}/.test(time)) token = `${token}T${time}`;
      else pos = save;
    }
    if (token === '') error('値が要る', start);
    return classify(token, start);
  }

  function classify(token: string, at: number): TomlValue {
    if (/^[+-]?(inf|nan)$/.test(token)) {
      if (token.endsWith('nan')) return NaN;
      return token.startsWith('-') ? -Infinity : Infinity;
    }
    if (/^0x[0-9A-Fa-f](_?[0-9A-Fa-f])*$/.test(token)) return integer(BigInt(token.replace(/_/g, '')), at);
    if (/^0o[0-7](_?[0-7])*$/.test(token)) return integer(BigInt(token.replace(/_/g, '')), at);
    if (/^0b[01](_?[01])*$/.test(token)) return integer(BigInt(token.replace(/_/g, '')), at);
    if (/^[+-]?(0|[1-9](_?\d)*)$/.test(token)) return integer(BigInt(token.replace(/_/g, '')), at);
    if (/^[+-]?(0|[1-9](_?\d)*)(\.\d(_?\d)*)?([eE][+-]?\d(_?\d)*)?$/.test(token)) {
      return Number(token.replace(/_/g, ''));
    }
    const parsed = dateTime(token, at);
    if (parsed) return parsed;
    error(`正しくない値: ${token}`, at);
  }

  function integer(value: bigint, at: number): number | bigint {
    if (value > MAX_INT || value < MIN_INT) error('64 ビットの整数の範囲を超える', at);
    return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value;
  }

  function dateTime(token: string, at: number): TomlDateTime | undefined {
    const date = /^(\d{4})-(\d{2})-(\d{2})/;
    const time = /(\d{2}):(\d{2}):(\d{2})(\.\d+)?/;
    const full = new RegExp(`${date.source}[Tt]${time.source}([Zz]|[+-]\\d{2}:\\d{2})?$`);
    const m = full.exec(token);
    if (m) {
      checkDate(+m[1], +m[2], +m[3], at);
      checkTime(+m[4], +m[5], +m[6], at);
      const text = token.replace(/t/, 'T').replace(/z$/, 'Z');
      if (!m[8]) return tomlDateTime('local-date-time', text);
      if (m[8] !== 'Z' && m[8] !== 'z') {
        const [h, mm] = m[8].slice(1).split(':').map(Number);
        if (h > 23 || mm > 59) error('正しくないオフセット', at);
      }
      // 閏秒は Date で表せないため 59 秒に丸める
      const iso = text.replace(/:60(\.\d+)?(?=Z|[+-]|$)/, ':59$1');
      return tomlDateTime('offset-date-time', text, new Date(iso));
    }
    const d = new RegExp(`${date.source}$`).exec(token);
    if (d) {
      checkDate(+d[1], +d[2], +d[3], at);
      return tomlDateTime('local-date', token);
    }
    const t = new RegExp(`^${time.source}$`).exec(token);
    if (t) {
      checkTime(+t[1], +t[2], +t[3], at);
      return tomlDateTime('local-time', token);
    }
    return undefined;
  }

  function checkDate(year: number, month: number, day: number, at: number): void {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (month < 1 || month > 12 || day < 1 || day > days[month - 1]) error('正しくない日付', at);
  }

  function checkTime(hour: number, minute: number, second: number, at: number): void {
    if (hour > 23 || minute > 59 || second > 60) error('正しくない時刻', at);
  }

  return { parse };
}

/** TOML の文書を解析する。誤りは位置を示す `TomlError` とする */
export function parseToml(src: string): TomlTable {
  // 改行を含む値の判定を単純にするため、CRLF はそのまま扱う
  return createParser(src).parse();
}
