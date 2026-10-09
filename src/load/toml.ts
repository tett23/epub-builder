// TOML 1.0.0 の解析器（ADR 0019）。外部の依存を持たない。

export type TomlDateTimeKind = 'offset-date-time' | 'local-date-time' | 'local-date' | 'local-time';

/** TOML の日時。オフセット付きの日時だけが時点を表す */
export class TomlDateTime {
  constructor(
    readonly kind: TomlDateTimeKind,
    /** 書いたとおりの文字列（区切りの `T` は大文字にそろえる） */
    readonly text: string,
    /** オフセット付きの日時のときの時点 */
    readonly date?: Date,
  ) {}

  toString(): string {
    return this.text;
  }
}

export type TomlValue = string | number | bigint | boolean | TomlDateTime | TomlValue[] | TomlTable;
export interface TomlTable {
  [key: string]: TomlValue;
}

export class TomlError extends Error {
  constructor(message: string, readonly line: number, readonly column: number) {
    super(`${line}:${column}: ${message}`);
    this.name = 'TomlError';
  }
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
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof TomlDateTime);
}

/** `__proto__` などの名前でもプロトタイプを変えずに、自身のプロパティとして置く */
function setKey(table: TomlTable, key: string, value: TomlValue): void {
  Object.defineProperty(table, key, { value, enumerable: true, writable: true, configurable: true });
}

class Parser {
  pos = 0;
  readonly tables = new WeakMap<TomlTable, TableMeta>();
  /** `[[header]]` で作った配列 */
  readonly arraysOfTables = new WeakSet<TomlValue[]>();
  readonly root: TomlTable = {};

  constructor(readonly src: string) {
    this.tables.set(this.root, { header: true, dotted: false, frozen: false });
  }

  error(message: string, at = this.pos): never {
    let line = 1;
    let column = 1;
    for (let i = 0; i < at && i < this.src.length; i++) {
      if (this.src[i] === '\n') {
        line++;
        column = 1;
      } else {
        column++;
      }
    }
    throw new TomlError(message, line, column);
  }

  peek(offset = 0): string {
    return this.src[this.pos + offset] ?? '';
  }

  eof(): boolean {
    return this.pos >= this.src.length;
  }

  skipWs(): void {
    while (this.peek() === ' ' || this.peek() === '\t') this.pos++;
  }

  skipComment(): void {
    if (this.peek() !== '#') return;
    this.pos++;
    while (!this.eof() && this.peek() !== '\n') {
      const c = this.peek();
      if (c === '\r' && this.peek(1) === '\n') break;
      this.checkChar(c, false);
      this.pos++;
    }
  }

  checkChar(c: string, allowNewline: boolean): void {
    const code = c.codePointAt(0)!;
    if (code === 0x09) return;
    if (allowNewline && (code === 0x0a)) return;
    if (code < 0x20 || code === 0x7f) this.error(`使えない制御文字 U+${code.toString(16).padStart(4, '0')}`);
  }

  /** 行の終わり（空白、コメント、改行か終端）を読む */
  expectLineEnd(): void {
    this.skipWs();
    this.skipComment();
    if (this.eof()) return;
    if (this.peek() === '\n') {
      this.pos++;
      return;
    }
    if (this.peek() === '\r' && this.peek(1) === '\n') {
      this.pos += 2;
      return;
    }
    this.error('行の終わりが要る');
  }

  /** 空白、コメント、改行を読み飛ばす（配列の中で使う） */
  skipWsCommentNewline(): void {
    for (;;) {
      this.skipWs();
      this.skipComment();
      if (this.peek() === '\n') this.pos++;
      else if (this.peek() === '\r' && this.peek(1) === '\n') this.pos += 2;
      else return;
    }
  }

  parse(): TomlTable {
    if (this.peek() === '﻿') this.pos++;
    let current = this.root;
    while (!this.eof()) {
      this.skipWs();
      const c = this.peek();
      if (c === '#' || c === '\n' || c === '\r' || c === '') {
        this.expectLineEnd();
        continue;
      }
      if (c === '[') {
        if (this.peek(1) === '[') {
          this.pos += 2;
          this.skipWs();
          const start = this.pos;
          const keys = this.parseKey();
          this.skipWs();
          if (this.peek() !== ']' || this.peek(1) !== ']') this.error('`]]` が要る');
          this.pos += 2;
          current = this.openArrayTable(keys, start);
        } else {
          this.pos++;
          this.skipWs();
          const start = this.pos;
          const keys = this.parseKey();
          this.skipWs();
          if (this.peek() !== ']') this.error('`]` が要る');
          this.pos++;
          current = this.openTable(keys, start);
        }
        this.expectLineEnd();
        continue;
      }
      this.parseKeyValue(current, false);
      this.expectLineEnd();
    }
    return this.root;
  }

  meta(table: TomlTable): TableMeta {
    return this.tables.get(table)!;
  }

  newTable(meta: Partial<TableMeta>): TomlTable {
    const table: TomlTable = {};
    this.tables.set(table, { header: false, dotted: false, frozen: false, ...meta });
    return table;
  }

  /** ヘッダの途中のキーをたどる */
  descendForHeader(keys: string[], at: number): TomlTable {
    let table = this.root;
    for (const key of keys) {
      if (!Object.hasOwn(table, key)) {
        const next = this.newTable({});
        setKey(table, key, next);
        table = next;
        continue;
      }
      const value = table[key];
      if (Array.isArray(value)) {
        if (!this.arraysOfTables.has(value)) this.error(`静的な配列 ${key} に表を足せない`, at);
        table = value[value.length - 1] as TomlTable;
      } else if (isPlainTable(value)) {
        if (this.meta(value).frozen) this.error(`インライン表 ${key} は変更できない`, at);
        table = value;
      } else {
        this.error(`${key} は表でない`, at);
      }
    }
    return table;
  }

  openTable(keys: string[], at: number): TomlTable {
    const parent = this.descendForHeader(keys.slice(0, -1), at);
    const last = keys[keys.length - 1];
    if (!Object.hasOwn(parent, last)) {
      const table = this.newTable({ header: true });
      setKey(parent, last, table);
      return table;
    }
    const value = parent[last];
    if (!isPlainTable(value)) this.error(`${keys.join('.')} はすでに表でない値として定義されている`, at);
    const meta = this.meta(value);
    if (meta.header || meta.dotted || meta.frozen) this.error(`表 ${keys.join('.')} を二度定義している`, at);
    meta.header = true;
    return value;
  }

  openArrayTable(keys: string[], at: number): TomlTable {
    const parent = this.descendForHeader(keys.slice(0, -1), at);
    const last = keys[keys.length - 1];
    const table = this.newTable({ header: true });
    if (!Object.hasOwn(parent, last)) {
      const array: TomlValue[] = [table];
      this.arraysOfTables.add(array);
      setKey(parent, last, array);
      return table;
    }
    const value = parent[last];
    if (!Array.isArray(value) || !this.arraysOfTables.has(value)) {
      this.error(`${keys.join('.')} は表の配列でない`, at);
    }
    value.push(table);
    return table;
  }

  parseKeyValue(table: TomlTable, inline: boolean): void {
    const start = this.pos;
    const keys = this.parseKey();
    this.skipWs();
    if (this.peek() !== '=') this.error('`=` が要る');
    this.pos++;
    this.skipWs();
    const value = this.parseValue();
    let target = table;
    for (const key of keys.slice(0, -1)) {
      if (!Object.hasOwn(target, key)) {
        const next = this.newTable({ dotted: true });
        setKey(target, key, next);
        target = next;
        continue;
      }
      const existing = target[key];
      if (!isPlainTable(existing)) this.error(`${key} は表でない`, start);
      const meta = this.meta(existing);
      if (!meta.dotted || (meta.frozen && !inline)) this.error(`${keys.join('.')} を定義できない`, start);
      target = existing;
    }
    const last = keys[keys.length - 1];
    if (Object.hasOwn(target, last)) this.error(`キー ${keys.join('.')} を二度定義している`, start);
    setKey(target, last, value);
  }

  parseKey(): string[] {
    const keys: string[] = [];
    for (;;) {
      this.skipWs();
      const c = this.peek();
      if (c === '"') {
        if (this.src.startsWith('"""', this.pos)) this.error('キーに複数行の文字列は使えない');
        keys.push(this.parseBasicString());
      } else if (c === "'") {
        if (this.src.startsWith("'''", this.pos)) this.error('キーに複数行の文字列は使えない');
        keys.push(this.parseLiteralString());
      } else {
        const start = this.pos;
        while (BARE_KEY.test(this.peek())) this.pos++;
        if (start === this.pos) this.error('キーが要る');
        keys.push(this.src.slice(start, this.pos));
      }
      this.skipWs();
      if (this.peek() !== '.') return keys;
      this.pos++;
    }
  }

  parseValue(): TomlValue {
    const c = this.peek();
    if (c === '"') {
      return this.src.startsWith('"""', this.pos) ? this.parseMultilineBasicString() : this.parseBasicString();
    }
    if (c === "'") {
      return this.src.startsWith("'''", this.pos) ? this.parseMultilineLiteralString() : this.parseLiteralString();
    }
    if (c === '[') return this.parseArray();
    if (c === '{') return this.parseInlineTable();
    if (this.src.startsWith('true', this.pos) && !/[A-Za-z0-9_-]/.test(this.peek(4))) {
      this.pos += 4;
      return true;
    }
    if (this.src.startsWith('false', this.pos) && !/[A-Za-z0-9_-]/.test(this.peek(5))) {
      this.pos += 5;
      return false;
    }
    return this.parseNumberOrDate();
  }

  parseEscape(): string {
    const start = this.pos;
    this.pos++; // バックスラッシュ
    const c = this.peek();
    this.pos++;
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
        const hex = this.src.slice(this.pos, this.pos + length);
        if (!new RegExp(`^[0-9A-Fa-f]{${length}}$`).test(hex)) this.error('正しくない Unicode のエスケープ', start);
        const code = parseInt(hex, 16);
        if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
          this.error('Unicode のスカラー値でないエスケープ', start);
        }
        this.pos += length;
        return String.fromCodePoint(code);
      }
      default:
        this.error('正しくないエスケープ', start);
    }
  }

  parseBasicString(): string {
    this.pos++;
    let out = '';
    for (;;) {
      if (this.eof()) this.error('文字列が閉じていない');
      const c = this.peek();
      if (c === '"') {
        this.pos++;
        return out;
      }
      if (c === '\\') {
        out += this.parseEscape();
        continue;
      }
      if (c === '\n' || c === '\r') this.error('文字列の中に改行は書けない');
      this.checkChar(c, false);
      out += c;
      this.pos++;
    }
  }

  parseLiteralString(): string {
    this.pos++;
    const start = this.pos;
    for (;;) {
      if (this.eof()) this.error('文字列が閉じていない');
      const c = this.peek();
      if (c === "'") {
        const value = this.src.slice(start, this.pos);
        this.pos++;
        return value;
      }
      if (c === '\n' || c === '\r') this.error('文字列の中に改行は書けない');
      this.checkChar(c, false);
      this.pos++;
    }
  }

  /** 複数行の文字列の、開きの直後の改行を読み飛ばす */
  skipFirstNewline(): void {
    if (this.peek() === '\n') this.pos++;
    else if (this.peek() === '\r' && this.peek(1) === '\n') this.pos += 2;
  }

  /** 複数行の文字列の閉じ。閉じの前に引用符が 2 つまで続いてよい */
  closeMultiline(quote: string): string | undefined {
    if (!this.src.startsWith(quote.repeat(3), this.pos)) return undefined;
    let extra = 0;
    while (this.peek(3 + extra) === quote && extra < 2) extra++;
    if (this.peek(3 + extra) === quote) this.error('引用符が多すぎる');
    this.pos += 3 + extra;
    return quote.repeat(extra);
  }

  parseMultilineBasicString(): string {
    this.pos += 3;
    this.skipFirstNewline();
    let out = '';
    for (;;) {
      if (this.eof()) this.error('文字列が閉じていない');
      const closing = this.closeMultiline('"');
      if (closing !== undefined) return out + closing;
      const c = this.peek();
      if (c === '\\') {
        // 行末のバックスラッシュ：空白と改行を読み飛ばす
        let p = this.pos + 1;
        while (this.src[p] === ' ' || this.src[p] === '\t') p++;
        if (this.src[p] === '\n' || (this.src[p] === '\r' && this.src[p + 1] === '\n')) {
          this.pos = p;
          while (/^[ \t\n]$/.test(this.peek()) || (this.peek() === '\r' && this.peek(1) === '\n')) {
            this.pos += this.peek() === '\r' ? 2 : 1;
          }
          continue;
        }
        out += this.parseEscape();
        continue;
      }
      if (c === '\r') {
        if (this.peek(1) !== '\n') this.error('単独の CR は書けない');
        out += '\r\n';
        this.pos += 2;
        continue;
      }
      this.checkChar(c, true);
      out += c;
      this.pos++;
    }
  }

  parseMultilineLiteralString(): string {
    this.pos += 3;
    this.skipFirstNewline();
    let out = '';
    for (;;) {
      if (this.eof()) this.error('文字列が閉じていない');
      const closing = this.closeMultiline("'");
      if (closing !== undefined) return out + closing;
      const c = this.peek();
      if (c === '\r') {
        if (this.peek(1) !== '\n') this.error('単独の CR は書けない');
        out += '\r\n';
        this.pos += 2;
        continue;
      }
      this.checkChar(c, true);
      out += c;
      this.pos++;
    }
  }

  parseArray(): TomlValue[] {
    this.pos++;
    const array: TomlValue[] = [];
    for (;;) {
      this.skipWsCommentNewline();
      if (this.peek() === ']') {
        this.pos++;
        return array;
      }
      array.push(this.parseValue());
      this.skipWsCommentNewline();
      if (this.peek() === ',') {
        this.pos++;
        continue;
      }
      if (this.peek() === ']') {
        this.pos++;
        return array;
      }
      this.error('`,` か `]` が要る');
    }
  }

  parseInlineTable(): TomlTable {
    this.pos++;
    const table = this.newTable({ frozen: true });
    this.skipWs();
    if (this.peek() === '}') {
      this.pos++;
      return table;
    }
    for (;;) {
      this.skipWs();
      this.parseKeyValue(table, true);
      this.skipWs();
      if (this.peek() === ',') {
        this.pos++;
        this.skipWs();
        if (this.peek() === '}') this.error('インライン表の最後に `,` は書けない');
        continue;
      }
      if (this.peek() === '}') {
        this.pos++;
        this.freeze(table);
        return table;
      }
      this.error('`,` か `}` が要る');
    }
  }

  /** インライン表の中でドット付きのキーが作った表も変更できなくする */
  freeze(table: TomlTable): void {
    const meta = this.meta(table);
    meta.frozen = true;
    for (const value of Object.values(table)) {
      if (isPlainTable(value) && this.tables.has(value)) this.freeze(value);
    }
  }

  parseNumberOrDate(): TomlValue {
    const start = this.pos;
    while (/[0-9A-Za-z_+\-.:]/.test(this.peek())) this.pos++;
    let token = this.src.slice(start, this.pos);
    // 日付と時刻の区切りの空白
    if (/^\d{4}-\d{2}-\d{2}$/.test(token) && this.peek() === ' ' && /\d/.test(this.peek(1))) {
      const save = this.pos;
      this.pos++;
      const timeStart = this.pos;
      while (/[0-9A-Za-z_+\-.:]/.test(this.peek())) this.pos++;
      const time = this.src.slice(timeStart, this.pos);
      if (/^\d{2}:\d{2}/.test(time)) token = `${token}T${time}`;
      else this.pos = save;
    }
    if (token === '') this.error('値が要る', start);
    return this.classify(token, start);
  }

  classify(token: string, at: number): TomlValue {
    if (/^[+-]?(inf|nan)$/.test(token)) {
      if (token.endsWith('nan')) return NaN;
      return token.startsWith('-') ? -Infinity : Infinity;
    }
    if (/^0x[0-9A-Fa-f](_?[0-9A-Fa-f])*$/.test(token)) return this.integer(BigInt(token.replace(/_/g, '')), at);
    if (/^0o[0-7](_?[0-7])*$/.test(token)) return this.integer(BigInt(token.replace(/_/g, '')), at);
    if (/^0b[01](_?[01])*$/.test(token)) return this.integer(BigInt(token.replace(/_/g, '')), at);
    if (/^[+-]?(0|[1-9](_?\d)*)$/.test(token)) return this.integer(BigInt(token.replace(/_/g, '')), at);
    if (/^[+-]?(0|[1-9](_?\d)*)(\.\d(_?\d)*)?([eE][+-]?\d(_?\d)*)?$/.test(token)) {
      return Number(token.replace(/_/g, ''));
    }
    const dateTime = this.dateTime(token, at);
    if (dateTime) return dateTime;
    this.error(`正しくない値: ${token}`, at);
  }

  integer(value: bigint, at: number): number | bigint {
    if (value > MAX_INT || value < MIN_INT) this.error('64 ビットの整数の範囲を超える', at);
    return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value;
  }

  dateTime(token: string, at: number): TomlDateTime | undefined {
    const date = /^(\d{4})-(\d{2})-(\d{2})/;
    const time = /(\d{2}):(\d{2}):(\d{2})(\.\d+)?/;
    const full = new RegExp(`${date.source}[Tt]${time.source}([Zz]|[+-]\\d{2}:\\d{2})?$`);
    const m = full.exec(token);
    if (m) {
      this.checkDate(+m[1], +m[2], +m[3], at);
      this.checkTime(+m[4], +m[5], +m[6], at);
      const text = token.replace(/t/, 'T').replace(/z$/, 'Z');
      if (!m[8]) return new TomlDateTime('local-date-time', text);
      if (m[8] !== 'Z' && m[8] !== 'z') {
        const [h, mm] = m[8].slice(1).split(':').map(Number);
        if (h > 23 || mm > 59) this.error('正しくないオフセット', at);
      }
      // 閏秒は Date で表せないため 59 秒に丸める
      const iso = text.replace(/:60(\.\d+)?(?=Z|[+-]|$)/, ':59$1');
      return new TomlDateTime('offset-date-time', text, new Date(iso));
    }
    const d = new RegExp(`${date.source}$`).exec(token);
    if (d) {
      this.checkDate(+d[1], +d[2], +d[3], at);
      return new TomlDateTime('local-date', token);
    }
    const t = new RegExp(`^${time.source}$`).exec(token);
    if (t) {
      this.checkTime(+t[1], +t[2], +t[3], at);
      return new TomlDateTime('local-time', token);
    }
    return undefined;
  }

  checkDate(year: number, month: number, day: number, at: number): void {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (month < 1 || month > 12 || day < 1 || day > days[month - 1]) this.error('正しくない日付', at);
  }

  checkTime(hour: number, minute: number, second: number, at: number): void {
    if (hour > 23 || minute > 59 || second > 60) this.error('正しくない時刻', at);
  }
}

/** TOML の文書を解析する。誤りは位置を示す `TomlError` とする */
export function parseToml(src: string): TomlTable {
  // 改行を含む値の判定を単純にするため、CRLF はそのまま扱う
  return new Parser(src).parse();
}
