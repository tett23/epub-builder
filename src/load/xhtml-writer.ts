// hast を XHTML の構文で書き出す、自前の書き出し器（ADR 0024）。
// XHTML に直せないものは、位置を示す `ConversionError` とする。

import type { Element, Nodes, Properties } from 'hast';
import { find, html, svg } from 'property-information';
import type { EpubVersion } from '../types.ts';
import { escapeAttribute, escapeText, hasInvalidXmlChar } from '../xml.ts';
import { hasErrorName, type NamedError, namedError } from '../errors.ts';
import { attributePrefixes, NCNAME, NS } from './namespaces.ts';

/** XHTML に直せないものの誤り。分かれば位置を持つ（ADR 0021） */
export type ConversionError = NamedError<'ConversionError', { line?: number; column?: number }>;

/** 変換の誤りを作る。位置があればメッセージの先頭に付ける */
export function conversionError(message: string, line?: number, column?: number): ConversionError {
  return namedError('ConversionError', line !== undefined ? `${line}:${column}: ${message}` : message, {
    line,
    column,
  });
}

/** 変換の誤りかを判別する */
export function isConversionError(value: unknown): value is ConversionError {
  return hasErrorName(value, 'ConversionError');
}

const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

/** 書き出し器が名前空間の宣言を付ける接頭辞 */
const DECLARED_BY_WRITER: Record<string, string> = { xlink: NS.xlink };

function fail(message: string, node: Nodes): never {
  const start = node.position?.start;
  throw conversionError(message, start?.line, start?.column);
}

interface Context {
  /** この要素の名前空間 */
  namespace: string;
  /** 祖先で宣言した既定の名前空間 */
  defaultNamespace: string;
  /** 祖先で宣言した接頭辞 */
  declared: Set<string>;
}

function attributeValue(value: Properties[string], info: ReturnType<typeof find>): string | undefined {
  if (value === null || value === undefined || value === false) return undefined;
  if (typeof value === 'number' && Number.isNaN(value)) return undefined;
  if (value === true) return info.boolean || info.overloadedBoolean ? info.attribute : '';
  if (Array.isArray(value)) return value.join(info.commaSeparated ? ', ' : ' ');
  return String(value);
}

function createWriter(version: EpubVersion): { write: (node: Nodes, context: Context) => string } {
  const prefixes = attributePrefixes(version);

  function write(node: Nodes, context: Context): string {
    switch (node.type) {
      case 'root':
        return node.children.map((child) => write(child, context)).join('');
      case 'text':
        if (hasInvalidXmlChar(node.value)) fail('XML で使えない文字がある', node);
        return escapeText(node.value);
      case 'comment':
        if (node.value.includes('--') || node.value.endsWith('-')) {
          fail('コメントの中身に `--` を含む、または `-` で終わる', node);
        }
        if (hasInvalidXmlChar(node.value)) fail('XML で使えない文字がある', node);
        return `<!--${node.value}-->`;
      case 'doctype':
        fail('断片の中に DOCTYPE は書けない', node);
        break;
      case 'element':
        return element(node, context);
      default:
        fail(`扱えないノード: ${(node as { type: string }).type}`, node);
    }
  }

  function element(node: Element, context: Context): string {
    const name = node.tagName;
    if (!NCNAME.test(name)) {
      fail(name.includes(':') ? `知らない接頭辞を持つ要素: ${name}` : `XML の名前として正しくない要素: ${name}`, node);
    }
    if (name === 'template') fail('template は扱わない', node);

    let namespace = context.namespace;
    if (name === 'svg' && namespace !== NS.svg) namespace = NS.svg;
    else if (name === 'math' && namespace !== NS.mathml) namespace = NS.mathml;
    const schema = namespace === NS.svg ? svg : html;
    const declared = new Set(context.declared);

    const attrs: string[] = [];
    if (namespace !== context.defaultNamespace) attrs.push(`xmlns="${namespace}"`);
    const names = new Set<string>();
    for (const [key, raw] of Object.entries(node.properties)) {
      const info = find(schema, key);
      const value = attributeValue(raw, info);
      if (value === undefined) continue;
      const attr = info.attribute;
      if (attr === 'xmlns') {
        if (value !== namespace) fail(`要素の名前空間と違う xmlns: ${value}`, node);
        continue;
      }
      if (attr.startsWith('xmlns:')) {
        const prefix = attr.slice(6);
        if (prefixes.get(prefix) !== value) fail(`知らない接頭辞の宣言: ${attr}`, node);
        continue;
      }
      const parts = attr.split(':');
      if (parts.length > 2 || !parts.every((p) => NCNAME.test(p))) {
        fail(`XML の名前として正しくない属性: ${attr}`, node);
      }
      if (parts.length === 2) {
        const prefix = parts[0];
        if (!prefixes.has(prefix)) fail(`知らない接頭辞を持つ属性: ${attr}`, node);
        if (prefix in DECLARED_BY_WRITER && !declared.has(prefix)) {
          attrs.push(`xmlns:${prefix}="${DECLARED_BY_WRITER[prefix]}"`);
          declared.add(prefix);
        }
      }
      if (names.has(attr)) fail(`属性 ${attr} が重なる`, node);
      names.add(attr);
      if (hasInvalidXmlChar(value)) fail('XML で使えない文字がある', node);
      attrs.push(`${attr}="${escapeAttribute(value)}"`);
    }

    const open = attrs.length > 0 ? `<${name} ${attrs.join(' ')}` : `<${name}`;
    // SVG の foreignObject の中身は XHTML に戻る
    const childNamespace = namespace === NS.svg && name === 'foreignObject' ? NS.xhtml : namespace;
    const inner = node.children
      .map((child) => write(child, { namespace: childNamespace, defaultNamespace: namespace, declared }))
      .join('');
    if (inner === '') {
      if (namespace !== NS.xhtml || VOID_ELEMENTS.has(name)) return `${open}/>`;
      return `${open}></${name}>`;
    }
    if (namespace === NS.xhtml && VOID_ELEMENTS.has(name)) fail(`空要素 ${name} は中身を持てない`, node);
    return `${open}>${inner}</${name}>`;
  }

  return { write };
}

/** hast を、XHTML の `body` の中身として書き出す */
export function writeXhtml(tree: Nodes, version: EpubVersion): string {
  return createWriter(version).write(tree, { namespace: NS.xhtml, defaultNamespace: NS.xhtml, declared: new Set() });
}
