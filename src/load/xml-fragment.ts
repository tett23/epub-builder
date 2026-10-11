// XHTML の断片を読む、自前の XML の解析器（ADR 0024）。
// 対象は断片に要るもの（要素、属性、文字、コメント、CDATA 区間、事前定義の実体参照と文字参照）に限る。

import type { Element, ElementContent, Root } from 'hast';
import type { EpubVersion } from '../types.ts';
import { hasInvalidXmlChar } from '../xml.ts';
import { hasErrorName, type NamedError, namedError } from '../errors.ts';
import { createElement } from './hast-element.ts';
import { attributePrefixes, NCNAME, NS } from './namespaces.ts';

/** XML の断片の誤り。位置を持つ（ADR 0021） */
export type XmlError = NamedError<'XmlError', { line: number; column: number }>;

/** XML の誤りを作る。メッセージの先頭に位置を付ける */
export function xmlError(message: string, line: number, column: number): XmlError {
  return namedError('XmlError', `${line}:${column}: ${message}`, { line, column });
}

/** XML の誤りかを判別する */
export function isXmlError(value: unknown): value is XmlError {
  return hasErrorName(value, 'XmlError');
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

function createFragmentParser(src: string, version: EpubVersion): { parse: () => Root } {
  let pos = 0;

  const lineStarts: number[] = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') lineStarts.push(i + 1);

  function point(at = pos): Point {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (lineStarts[mid] <= at) low = mid;
      else high = mid - 1;
    }
    return { line: low + 1, column: at - lineStarts[low] + 1, offset: at };
  }

  function error(message: string, at = pos): never {
    const { line, column } = point(at);
    throw xmlError(message, line, column);
  }

  function parse(): Root {
    const prefixes = attributePrefixes(version);
    const root: OpenElement = {
      name: '#root',
      attrs: [],
      children: [],
      namespace: NS.xhtml,
      prefixes,
      start: point(0),
    };
    const stack: OpenElement[] = [root];
    let text = '';
    let textStart = 0;
    const flush = () => {
      if (text === '') return;
      stack[stack.length - 1].children.push({
        type: 'text',
        value: text,
        position: { start: point(textStart), end: point() },
      });
      text = '';
    };

    while (pos < src.length) {
      const c = src[pos];
      if (c === '<') {
        if (src.startsWith('<!--', pos)) {
          flush();
          const end = src.indexOf('-->', pos + 4);
          if (end < 0) error('コメントが閉じていない');
          const value = src.slice(pos + 4, end);
          if (value.includes('--') || value.endsWith('-')) error('コメントの中に `--` は書けない');
          checkChars(value, pos);
          stack[stack.length - 1].children.push({ type: 'comment', value });
          pos = end + 3;
          continue;
        }
        if (src.startsWith('<![CDATA[', pos)) {
          const end = src.indexOf(']]>', pos + 9);
          if (end < 0) error('CDATA 区間が閉じていない');
          if (text === '') textStart = pos;
          const value = src.slice(pos + 9, end);
          checkChars(value, pos);
          text += value;
          pos = end + 3;
          continue;
        }
        if (src.startsWith('<!', pos)) error('DOCTYPE などの宣言は断片の中に書けない');
        if (src.startsWith('<?', pos)) error('処理命令は扱わない');
        flush();
        if (src[pos + 1] === '/') {
          parseEndTag(stack);
        } else {
          parseStartTag(stack);
        }
        continue;
      }
      if (c === '&') {
        if (text === '') textStart = pos;
        text += parseReference();
        continue;
      }
      if (c === '>' && src.startsWith(']]>', pos - 2)) error('文字の中に `]]>` は書けない');
      if (text === '') textStart = pos;
      const cp = String.fromCodePoint(src.codePointAt(pos)!);
      if (hasInvalidXmlChar(cp)) error('XML で使えない文字');
      text += cp;
      pos += cp.length;
    }
    flush();
    if (stack.length > 1) {
      const open = stack[stack.length - 1];
      error(`要素 ${open.name} が閉じていない`, open.start.offset);
    }
    return { type: 'root', children: root.children };
  }

  function checkChars(value: string, at: number): void {
    if (hasInvalidXmlChar(value)) error('XML で使えない文字', at);
  }

  function readName(): string {
    const start = pos;
    while (pos < src.length && !/[\s/>=<"'&]/.test(src[pos])) pos++;
    const name = src.slice(start, pos);
    const parts = name.split(':');
    if (name === '' || parts.length > 2 || !parts.every((p) => NCNAME.test(p))) {
      error(`正しくない名前: ${JSON.stringify(name)}`, start);
    }
    return name;
  }

  function skipWs(): boolean {
    const start = pos;
    while (/[ \t\r\n]/.test(src[pos] ?? '')) pos++;
    return pos > start;
  }

  function parseReference(): string {
    const start = pos;
    const end = src.indexOf(';', pos);
    if (end < 0) error('実体参照が閉じていない');
    const name = src.slice(pos + 1, end);
    pos = end + 1;
    let value: string | undefined;
    const numeric = /^#(?:x([0-9A-Fa-f]+)|([0-9]+))$/.exec(name);
    if (numeric) {
      const code = numeric[1] !== undefined ? parseInt(numeric[1], 16) : parseInt(numeric[2], 10);
      if (code <= 0x10ffff) value = String.fromCodePoint(code);
      if (value === undefined || hasInvalidXmlChar(value) || (code >= 0xd800 && code <= 0xdfff)) {
        error(`XML で使えない文字の参照: &${name};`, start);
      }
      return value;
    }
    value = PREDEFINED[name];
    if (value === undefined) error(`事前定義のもの以外の実体参照は使えない: &${name};`, start);
    return value;
  }

  function parseStartTag(stack: OpenElement[]): void {
    const start = pos;
    pos++;
    const name = readName();
    const attrs: [string, string][] = [];
    for (;;) {
      const hadWs = skipWs();
      const c = src[pos];
      if (c === undefined) error('タグが閉じていない', start);
      if (c === '>' || (c === '/' && src[pos + 1] === '>')) break;
      if (!hadWs) error('属性の前に空白が要る');
      const attrStart = pos;
      const attrName = readName();
      skipWs();
      if (src[pos] !== '=') error('`=` が要る');
      pos++;
      skipWs();
      const quote = src[pos];
      if (quote !== '"' && quote !== "'") error('属性の値は引用符で囲む');
      pos++;
      let value = '';
      for (;;) {
        const ch = src[pos];
        if (ch === undefined) error('属性の値が閉じていない', attrStart);
        if (ch === quote) {
          pos++;
          break;
        }
        if (ch === '<') error('属性の値に `<` は書けない');
        if (ch === '&') {
          value += parseReference();
          continue;
        }
        const cp = String.fromCodePoint(src.codePointAt(pos)!);
        if (hasInvalidXmlChar(cp)) error('XML で使えない文字');
        // 属性値の正規化
        value += /[\t\n\r]/.test(cp) ? ' ' : cp;
        pos += cp.length;
      }
      if (attrs.some(([n]) => n === attrName)) error(`属性 ${attrName} が重なる`, attrStart);
      attrs.push([attrName, value]);
    }
    const selfClosing = src[pos] === '/';
    pos += selfClosing ? 2 : 1;

    const parent = stack[stack.length - 1];
    const prefixes = new Map(parent.prefixes);
    let namespace = parent.namespace;
    for (const [attrName, value] of attrs) {
      if (attrName === 'xmlns') namespace = value;
      else if (attrName.startsWith('xmlns:')) prefixes.set(attrName.slice(6), value);
    }
    if (name.includes(':')) error(`接頭辞の付いた要素は扱わない: ${name}`, start);
    if (namespace !== NS.xhtml && namespace !== NS.svg && namespace !== NS.mathml) {
      error(`知らない名前空間: ${namespace}`, start);
    }
    for (const [attrName] of attrs) {
      const prefix = attrName.includes(':') ? attrName.split(':')[0] : undefined;
      if (prefix !== undefined && prefix !== 'xmlns' && !prefixes.has(prefix)) {
        error(`知らない接頭辞: ${attrName}`, start);
      }
    }
    const open: OpenElement = { name, attrs, children: [], namespace, prefixes, start: point(start) };
    if (selfClosing) {
      parent.children.push(toElement(open));
    } else {
      stack.push(open);
    }
  }

  function parseEndTag(stack: OpenElement[]): void {
    const start = pos;
    pos += 2;
    const name = readName();
    skipWs();
    if (src[pos] !== '>') error('`>` が要る');
    pos++;
    const open = stack[stack.length - 1];
    if (stack.length === 1 || open.name !== name) error(`終了タグ ${name} が開始タグと合わない`, start);
    stack.pop();
    stack[stack.length - 1].children.push(toElement(open));
  }

  function toElement(open: OpenElement): Element {
    // 名前空間の宣言は書き出し器が付け直すため、木には残さない
    const properties: Record<string, string> = {};
    for (const [name, value] of open.attrs) {
      if (name === 'xmlns' || name.startsWith('xmlns:')) continue;
      properties[name] = value;
    }
    const element = createElement(open.name, properties, open.children, open.namespace === NS.svg ? 'svg' : 'html');
    element.position = { start: open.start, end: point() };
    if (open.namespace === NS.mathml) element.data = { ...element.data, namespace: NS.mathml } as Element['data'];
    return element;
  }

  return { parse };
}

/** XHTML の断片を hast に読む。整形式でなければ位置を示す `XmlError` とする */
export function parseXhtmlFragment(src: string, version: EpubVersion): Root {
  return createFragmentParser(src.replace(/\r\n?/g, '\n'), version).parse();
}
