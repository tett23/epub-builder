// XHTML の断片を読む、自前の XML の解析器（ADR 0013）。
// 対象は断片に要るもの（要素、属性、文字、コメント、CDATA 区間、事前定義の実体参照と文字参照）に限る。

import type { Element, ElementContent, Root } from 'hast';
import { h, s } from 'hastscript';
import type { EpubVersion } from '../types.ts';
import { hasInvalidXmlChar } from '../xml.ts';
import { attributePrefixes, NCNAME, NS } from './namespaces.ts';

export class XmlError extends Error {
  constructor(message: string, readonly line: number, readonly column: number) {
    super(`${line}:${column}: ${message}`);
    this.name = 'XmlError';
  }
}

const PREDEFINED: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

interface Point {
  line: number;
  column: number;
  offset: number;
}

interface OpenElement {
  name: string;
  attrs: [string, string][];
  children: ElementContent[];
  namespace: string;
  prefixes: Map<string, string>;
  start: Point;
}

class FragmentParser {
  pos = 0;

  readonly lineStarts: number[] = [0];

  constructor(readonly src: string, readonly version: EpubVersion) {
    for (let i = 0; i < src.length; i++) if (src[i] === '\n') this.lineStarts.push(i + 1);
  }

  point(at = this.pos): Point {
    let low = 0;
    let high = this.lineStarts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (this.lineStarts[mid] <= at) low = mid;
      else high = mid - 1;
    }
    return { line: low + 1, column: at - this.lineStarts[low] + 1, offset: at };
  }

  error(message: string, at = this.pos): never {
    const { line, column } = this.point(at);
    throw new XmlError(message, line, column);
  }

  parse(): Root {
    const prefixes = attributePrefixes(this.version);
    const root: OpenElement = {
      name: '#root',
      attrs: [],
      children: [],
      namespace: NS.xhtml,
      prefixes,
      start: this.point(0),
    };
    const stack: OpenElement[] = [root];
    let text = '';
    let textStart = 0;
    const flush = () => {
      if (text === '') return;
      stack[stack.length - 1].children.push({
        type: 'text',
        value: text,
        position: { start: this.point(textStart), end: this.point() },
      });
      text = '';
    };

    while (this.pos < this.src.length) {
      const c = this.src[this.pos];
      if (c === '<') {
        if (this.src.startsWith('<!--', this.pos)) {
          flush();
          const end = this.src.indexOf('-->', this.pos + 4);
          if (end < 0) this.error('コメントが閉じていない');
          const value = this.src.slice(this.pos + 4, end);
          if (value.includes('--') || value.endsWith('-')) this.error('コメントの中に `--` は書けない');
          this.checkChars(value, this.pos);
          stack[stack.length - 1].children.push({ type: 'comment', value });
          this.pos = end + 3;
          continue;
        }
        if (this.src.startsWith('<![CDATA[', this.pos)) {
          const end = this.src.indexOf(']]>', this.pos + 9);
          if (end < 0) this.error('CDATA 区間が閉じていない');
          if (text === '') textStart = this.pos;
          const value = this.src.slice(this.pos + 9, end);
          this.checkChars(value, this.pos);
          text += value;
          this.pos = end + 3;
          continue;
        }
        if (this.src.startsWith('<!', this.pos)) this.error('DOCTYPE などの宣言は断片の中に書けない');
        if (this.src.startsWith('<?', this.pos)) this.error('処理命令は扱わない');
        flush();
        if (this.src[this.pos + 1] === '/') {
          this.parseEndTag(stack);
        } else {
          this.parseStartTag(stack);
        }
        continue;
      }
      if (c === '&') {
        if (text === '') textStart = this.pos;
        text += this.parseReference();
        continue;
      }
      if (c === '>' && this.src.startsWith(']]>', this.pos - 2)) this.error('文字の中に `]]>` は書けない');
      if (text === '') textStart = this.pos;
      const cp = String.fromCodePoint(this.src.codePointAt(this.pos)!);
      if (hasInvalidXmlChar(cp)) this.error('XML で使えない文字');
      text += cp;
      this.pos += cp.length;
    }
    flush();
    if (stack.length > 1) {
      const open = stack[stack.length - 1];
      this.error(`要素 ${open.name} が閉じていない`, open.start.offset);
    }
    return { type: 'root', children: root.children };
  }

  checkChars(value: string, at: number): void {
    if (hasInvalidXmlChar(value)) this.error('XML で使えない文字', at);
  }

  readName(): string {
    const start = this.pos;
    while (this.pos < this.src.length && !/[\s/>=<"'&]/.test(this.src[this.pos])) this.pos++;
    const name = this.src.slice(start, this.pos);
    const parts = name.split(':');
    if (name === '' || parts.length > 2 || !parts.every((p) => NCNAME.test(p))) {
      this.error(`正しくない名前: ${JSON.stringify(name)}`, start);
    }
    return name;
  }

  skipWs(): boolean {
    const start = this.pos;
    while (/[ \t\r\n]/.test(this.src[this.pos] ?? '')) this.pos++;
    return this.pos > start;
  }

  parseReference(): string {
    const start = this.pos;
    const end = this.src.indexOf(';', this.pos);
    if (end < 0) this.error('実体参照が閉じていない');
    const name = this.src.slice(this.pos + 1, end);
    this.pos = end + 1;
    let value: string | undefined;
    const numeric = /^#(?:x([0-9A-Fa-f]+)|([0-9]+))$/.exec(name);
    if (numeric) {
      const code = numeric[1] !== undefined ? parseInt(numeric[1], 16) : parseInt(numeric[2], 10);
      if (code <= 0x10ffff) value = String.fromCodePoint(code);
      if (value === undefined || hasInvalidXmlChar(value) || (code >= 0xd800 && code <= 0xdfff)) {
        this.error(`XML で使えない文字の参照: &${name};`, start);
      }
      return value;
    }
    value = PREDEFINED[name];
    if (value === undefined) this.error(`事前定義のもの以外の実体参照は使えない: &${name};`, start);
    return value;
  }

  parseStartTag(stack: OpenElement[]): void {
    const start = this.pos;
    this.pos++;
    const name = this.readName();
    const attrs: [string, string][] = [];
    for (;;) {
      const hadWs = this.skipWs();
      const c = this.src[this.pos];
      if (c === undefined) this.error('タグが閉じていない', start);
      if (c === '>' || (c === '/' && this.src[this.pos + 1] === '>')) break;
      if (!hadWs) this.error('属性の前に空白が要る');
      const attrStart = this.pos;
      const attrName = this.readName();
      this.skipWs();
      if (this.src[this.pos] !== '=') this.error('`=` が要る');
      this.pos++;
      this.skipWs();
      const quote = this.src[this.pos];
      if (quote !== '"' && quote !== "'") this.error('属性の値は引用符で囲む');
      this.pos++;
      let value = '';
      for (;;) {
        const ch = this.src[this.pos];
        if (ch === undefined) this.error('属性の値が閉じていない', attrStart);
        if (ch === quote) {
          this.pos++;
          break;
        }
        if (ch === '<') this.error('属性の値に `<` は書けない');
        if (ch === '&') {
          value += this.parseReference();
          continue;
        }
        const cp = String.fromCodePoint(this.src.codePointAt(this.pos)!);
        if (hasInvalidXmlChar(cp)) this.error('XML で使えない文字');
        // 属性値の正規化
        value += /[\t\n\r]/.test(cp) ? ' ' : cp;
        this.pos += cp.length;
      }
      if (attrs.some(([n]) => n === attrName)) this.error(`属性 ${attrName} が重なる`, attrStart);
      attrs.push([attrName, value]);
    }
    const selfClosing = this.src[this.pos] === '/';
    this.pos += selfClosing ? 2 : 1;

    const parent = stack[stack.length - 1];
    const prefixes = new Map(parent.prefixes);
    let namespace = parent.namespace;
    for (const [attrName, value] of attrs) {
      if (attrName === 'xmlns') namespace = value;
      else if (attrName.startsWith('xmlns:')) prefixes.set(attrName.slice(6), value);
    }
    if (name.includes(':')) this.error(`接頭辞の付いた要素は扱わない: ${name}`, start);
    if (namespace !== NS.xhtml && namespace !== NS.svg && namespace !== NS.mathml) {
      this.error(`知らない名前空間: ${namespace}`, start);
    }
    for (const [attrName] of attrs) {
      const prefix = attrName.includes(':') ? attrName.split(':')[0] : undefined;
      if (prefix !== undefined && prefix !== 'xmlns' && !prefixes.has(prefix)) {
        this.error(`知らない接頭辞: ${attrName}`, start);
      }
    }
    const open: OpenElement = { name, attrs, children: [], namespace, prefixes, start: this.point(start) };
    if (selfClosing) {
      parent.children.push(this.toElement(open));
    } else {
      stack.push(open);
    }
  }

  parseEndTag(stack: OpenElement[]): void {
    const start = this.pos;
    this.pos += 2;
    const name = this.readName();
    this.skipWs();
    if (this.src[this.pos] !== '>') this.error('`>` が要る');
    this.pos++;
    const open = stack[stack.length - 1];
    if (stack.length === 1 || open.name !== name) this.error(`終了タグ ${name} が開始タグと合わない`, start);
    stack.pop();
    stack[stack.length - 1].children.push(this.toElement(open));
  }

  toElement(open: OpenElement): Element {
    // 名前空間の宣言は書き出し器が付け直すため、木には残さない
    const properties: Record<string, string> = {};
    for (const [name, value] of open.attrs) {
      if (name === 'xmlns' || name.startsWith('xmlns:')) continue;
      properties[name] = value;
    }
    // hastscript は要素の名前の `.` と `#` をセレクタとして読むため、名前は後から入れる
    const build = open.namespace === NS.svg ? s : h;
    const element = build('x', properties, open.children) as Element;
    element.tagName = open.name;
    element.position = { start: open.start, end: this.point() };
    if (open.namespace === NS.mathml) element.data = { ...element.data, namespace: NS.mathml } as Element['data'];
    return element;
  }
}

/** XHTML の断片を hast に読む。整形式でなければ位置を示す `XmlError` とする */
export function parseXhtmlFragment(src: string, version: EpubVersion): Root {
  return new FragmentParser(src.replace(/\r\n?/g, '\n'), version).parse();
}
