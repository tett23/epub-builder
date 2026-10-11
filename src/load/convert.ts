// 本文の三つの形式を hast に読む（ADR 0024）

import type { ElementContent, Nodes as HastNodes, Root as HastRoot } from 'hast';
import type {
  FootnoteDefinition,
  Nodes as MdastNodes,
  Paragraph,
  Parent,
  PhrasingContent,
  Root as MdastRoot,
} from 'mdast';
import { gfmFootnoteFromMarkdown } from 'mdast-util-gfm-footnote';
import { gfmFootnote } from 'micromark-extension-gfm-footnote';
import rehypeParse from 'rehype-parse';
import rehypeRaw from 'rehype-raw';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { type Processor, unified } from 'unified';
import { type EpubVersion, isEpub3 } from '../types.ts';
import { parseRuby } from './ruby.ts';
import { type ConversionError, conversionError } from './xhtml-writer.ts';
import { isXmlError, parseXhtmlFragment } from './xml-fragment.ts';

export type SourceFormat = 'md' | 'xhtml' | 'html';

/** 断片の解析で黙って捨てられる要素を探す */
function findDocumentLevelMarkup(src: string): number | undefined {
  const stripped = src.replace(/<!--[\s\S]*?-->/g, (m) => ' '.repeat(m.length));
  const match = /<!doctype|<\/?(?:html|head|body)(?=[\s/>])/i.exec(stripped);
  return match?.index;
}

function offsetToPoint(src: string, offset: number): { line: number; column: number } {
  const before = src.slice(0, offset);
  const line = before.split('\n').length;
  return { line, column: offset - before.lastIndexOf('\n') };
}

function documentLevelError(src: string, offset: number, base = { line: 1, column: 1 }): ConversionError {
  const p = offsetToPoint(src, offset);
  const line = base.line + p.line - 1;
  const column = p.line === 1 ? base.column + p.column - 1 : p.column;
  return conversionError('断片の中に <!DOCTYPE>、html、head、body は書けない', line, column);
}

function footnoteSyntax(this: Processor) {
  const data = this.data();
  (data.micromarkExtensions ??= []).push(gfmFootnote());
  (data.fromMarkdownExtensions ??= []).push(gfmFootnoteFromMarkdown());
}

const markdownParser = unified().use(remarkParse).use(footnoteSyntax);
const markdownToHast = unified().use(remarkRehype, { allowDangerousHtml: true }).use(rehypeRaw);
const htmlParser = unified().use(rehypeParse, { fragment: true });

function failAt(message: string, node: { position?: { start: { line: number; column: number } } }): never {
  throw conversionError(message, node.position?.start.line, node.position?.start.column);
}

function visit(node: MdastNodes, fn: (node: MdastNodes, parent: Parent | undefined) => void, parent?: Parent) {
  fn(node, parent);
  if ('children' in node) { for (const child of [...node.children]) visit(child as MdastNodes, fn, node); }
}

/** 生の HTML に、断片で捨てられる要素がないか調べる */
function checkRawHtml(tree: MdastRoot): void {
  visit(tree, (node) => {
    if (node.type !== 'html') return;
    const offset = findDocumentLevelMarkup(node.value);
    if (offset !== undefined) throw documentLevelError(node.value, offset, node.position?.start);
  });
}

/** 脚注を、版に合った形の独自のノードに置き換える */
function transformFootnotes(tree: MdastRoot, src: string, version: EpubVersion): string[] {
  const definitions = new Map<string, FootnoteDefinition>();
  visit(tree, (node, parent) => {
    if (node.type !== 'footnoteDefinition') return;
    if (definitions.has(node.identifier)) failAt(`脚注 ${node.label ?? node.identifier} の定義が重なる`, node);
    definitions.set(node.identifier, node);
    parent!.children.splice(parent!.children.indexOf(node), 1);
  });
  for (const definition of definitions.values()) {
    visit(definition, (node) => {
      if (node.type === 'footnoteReference') failAt('脚注の本文の中で脚注を参照することはできない', node);
    });
  }
  // 定義のない参照は micromark では文字のまま残る。
  // エスケープした `\[^x]` を誤りにしないよう、文字のノードの元の書き方で調べる
  visit(tree, (node) => {
    if (node.type !== 'text') return;
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    const raw = start !== undefined && end !== undefined ? src.slice(start, end) : node.value;
    const match = /(?<!\\)\[\^([^\]\s\\]+)\]/.exec(raw);
    if (match) failAt(`定義のない脚注の参照: [^${match[1]}]`, node);
  });

  const order: string[] = [];
  const counts = new Map<string, number>();
  const ids: string[] = [];
  visit(tree, (node, parent) => {
    if (node.type !== 'footnoteReference') return;
    if (!order.includes(node.identifier)) order.push(node.identifier);
    const number = order.indexOf(node.identifier) + 1;
    const count = (counts.get(node.identifier) ?? 0) + 1;
    counts.set(node.identifier, count);
    const id = count === 1 ? `fnref-${number}` : `fnref-${number}-${count}`;
    ids.push(id);
    const properties: Record<string, unknown> = { className: ['noteref'], id, href: `#fn-${number}` };
    if (isEpub3(version)) properties['epub:type'] = 'noteref';
    const replacement = {
      type: 'noteref',
      data: {
        hName: 'sup',
        hChildren: [{ type: 'element', tagName: 'a', properties, children: [{ type: 'text', value: String(number) }] }],
      },
    };
    parent!.children.splice(parent!.children.indexOf(node), 1, replacement as unknown as PhrasingContent);
  });
  for (const [identifier, definition] of definitions) {
    if (!order.includes(identifier)) failAt(`参照されない脚注の定義: ${definition.label ?? identifier}`, definition);
  }
  if (order.length === 0) return ids;

  const notes = order.map((identifier, i) => {
    const number = i + 1;
    const definition = definitions.get(identifier)!;
    const children = [...definition.children];
    const backlink = {
      type: 'footnoteBacklink',
      data: {
        hName: 'a',
        hProperties: { href: `#fnref-${number}` },
        hChildren: [{ type: 'text', value: String(number) }],
      },
    } as unknown as PhrasingContent;
    const first = children[0];
    if (first?.type === 'paragraph') {
      children[0] = { ...first, children: [backlink, { type: 'text', value: ' ' }, ...first.children] } as Paragraph;
    } else {
      children.unshift({ type: 'paragraph', children: [backlink] });
    }
    ids.push(`fn-${number}`);
    const hProperties: Record<string, unknown> = { className: ['footnote'], id: `fn-${number}` };
    if (isEpub3(version)) hProperties['epub:type'] = 'footnote';
    return { type: 'footnoteBody', data: { hName: isEpub3(version) ? 'aside' : 'div', hProperties }, children };
  });
  tree.children.push(
    { type: 'footnotes', data: { hName: 'div', hProperties: { className: ['footnotes'] } }, children: notes } as never,
  );
  return ids;
}

/**
 * 文字列のノードの中のルビの記法を置き換える。
 * EPUB 3.0 では ruby 要素、EPUB 2.0.1 では括弧書きの span とする（OPS 2.0.1 は ruby 要素を持たないため。ADR 0024）
 */
function transformRuby(tree: MdastRoot, version: EpubVersion): void {
  visit(tree, (node, parent) => {
    if (node.type !== 'text' || !parent) return;
    const segments = parseRuby(node.value);
    if (segments.length === 1 && segments[0].type === 'text') {
      node.value = segments[0].value;
      return;
    }
    const replacement = segments.map((segment) => {
      if (segment.type === 'text') return { type: 'text', value: segment.value };
      const text = (value: string): ElementContent => ({ type: 'text', value });
      if (version === '2.0.1') {
        const span = (className: string, value: string): ElementContent => ({
          type: 'element',
          tagName: 'span',
          properties: { className: [className] },
          children: [text(value)],
        });
        return {
          type: 'ruby',
          data: {
            hName: 'span',
            hProperties: { className: ['ruby'] },
            hChildren: [span('rb', segment.base), span('rp', '（'), span('rt', segment.reading), span('rp', '）')],
          },
        };
      }
      const el = (tagName: string, value: string): ElementContent => ({
        type: 'element',
        tagName,
        properties: {},
        children: [text(value)],
      });
      return {
        type: 'ruby',
        data: {
          hName: 'ruby',
          hChildren: [text(segment.base), el('rp', '（'), el('rt', segment.reading), el('rp', '）')],
        },
      };
    });
    parent.children.splice(parent.children.indexOf(node), 1, ...(replacement as PhrasingContent[]));
  });
}

/** 生成した ID が、ユーザーの書いた ID と重ならないか調べる */
function checkGeneratedIds(tree: HastRoot, generated: string[]): void {
  const seen = new Map<string, number>();
  const walk = (node: HastNodes) => {
    if (node.type === 'element') {
      const id = node.properties.id;
      if (typeof id === 'string') seen.set(id, (seen.get(id) ?? 0) + 1);
    }
    if ('children' in node) node.children.forEach(walk);
  };
  walk(tree);
  for (const id of generated) {
    if ((seen.get(id) ?? 0) > 1) throw conversionError(`脚注の ID ${id} が、本文に書いた ID と重なる`);
  }
}

function markdownToTree(src: string, version: EpubVersion): HastRoot {
  const mdast = markdownParser.parse(src) as MdastRoot;
  checkRawHtml(mdast);
  const ids = transformFootnotes(mdast, src, version);
  transformRuby(mdast, version);
  const hast = markdownToHast.runSync(mdast) as HastRoot;
  checkGeneratedIds(hast, ids);
  return hast;
}

function htmlToTree(src: string): HastRoot {
  const offset = findDocumentLevelMarkup(src);
  if (offset !== undefined) throw documentLevelError(src, offset);
  return htmlParser.runSync(htmlParser.parse(src)) as HastRoot;
}

/** 本文のファイルの中身を、形式に合わせて hast に読む */
export function sourceToTree(src: string, format: SourceFormat, version: EpubVersion): HastRoot {
  switch (format) {
    case 'md':
      return markdownToTree(src, version);
    case 'html':
      return htmlToTree(src);
    case 'xhtml':
      try {
        return parseXhtmlFragment(src, version);
      } catch (e) {
        if (isXmlError(e)) throw conversionError(e.message.replace(/^\d+:\d+: /, ''), e.line, e.column);
        throw e;
      }
  }
}
