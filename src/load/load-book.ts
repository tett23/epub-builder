// ディレクトリから本を読む（ADR 0024）

import type { Element, ElementContent, Nodes as HastNodes, Root as HastRoot } from 'hast';
import { contentDocumentName, WRITING_MODE_DIRECTIONS } from '../epub.ts';
import {
  type Book,
  type BuildOptions,
  type Chapter,
  EPUB_VERSIONS,
  epubInputError,
  type Image,
  type ImageMediaType,
  isEpub3,
  type Metadata,
  type PageProgressionDirection,
  type PrimaryWritingMode,
  type Section,
  type Stylesheet,
} from '../types.ts';
import { encodePath } from '../xml.ts';
import { type SourceFormat, sourceToTree } from './convert.ts';
import { isTomlDateTime, isTomlError, parseToml, type TomlTable } from './toml.ts';
import { conversionError, isConversionError, writeXhtml } from './xhtml-writer.ts';

/** loadBook の警告（ADR 0024） */
export interface LoadWarning {
  /**
   * - `renamed-file`：assets/ のファイル名の空白を `_` に置き換えた
   * - `mathml-in-epub-2`：EPUB 2.0.1 の本文に MathML がある
   * - `ruby-in-epub-2`：EPUB 2.0.1 の本文に ruby 要素がある
   */
  code: 'renamed-file' | 'mathml-in-epub-2' | 'ruby-in-epub-2';
  /** プロジェクトからの相対パス */
  path: string;
  line?: number;
  column?: number;
  message: string;
}

export interface LoadOptions extends BuildOptions {
  /** 警告を受け取る。省略したら console.warn に書く */
  onWarning?: (warning: LoadWarning) => void;
}

function defaultOnWarning(warning: LoadWarning): void {
  const at = warning.line !== undefined ? `:${warning.line}:${warning.column}` : '';
  console.warn(`警告: ${warning.path}${at}: ${warning.message}`);
}

/** EPUB の中のファイル名に空白類を使わないよう、`_` に置き換える（ADR 0024） */
export function replaceSpaces(path: string): string {
  return path.replace(/\s/gu, '_');
}

const DOCUMENT_EXTENSIONS: Record<string, SourceFormat> = { '.md': 'md', '.xhtml': 'xhtml', '.html': 'html' };
const ASSET_TYPES: Record<string, ImageMediaType | 'text/css'> = {
  '.css': 'text/css',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};
/** meta/ の後付けの名前。読み順はこの順（ADR 0024） */
export const BACK_MATTER_NAMES = [
  'afterword',
  'acknowledgments',
  'appendix',
  'bibliography',
  'glossary',
  'index',
  'copyright-page',
] as const;
const META_NAMES = new Set<string>(['cover', 'titlepage', ...BACK_MATTER_NAMES, 'colophon']);
const SERIAL_PREFIX = /^[0-9]+[-_.]/;

/** 符号位置の順で比べる */
export function compareCodePoints(a: string, b: string): number {
  const ai = a[Symbol.iterator]();
  const bi = b[Symbol.iterator]();
  for (;;) {
    const x = ai.next();
    const y = bi.next();
    if (x.done || y.done) return x.done && y.done ? 0 : x.done ? -1 : 1;
    const diff = x.value.codePointAt(0)! - y.value.codePointAt(0)!;
    if (diff !== 0) return diff;
  }
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot) : '';
}

function stemOf(name: string): string {
  const ext = extensionOf(name);
  return ext ? name.slice(0, -ext.length) : name;
}

/** 先頭の連番を除く。残りが空になるなら除かない */
export function stripSerial(name: string): string {
  const stripped = name.replace(SERIAL_PREFIX, '');
  return stripped === '' ? name : stripped;
}

function join(...parts: string[]): string {
  return parts.filter((p) => p !== '').join('/');
}

interface DirEntry {
  /** NFC に正規化した名前 */
  name: string;
  /** ディスク上の名前 */
  diskName: string;
  isDirectory: boolean;
}

async function readEntries(dir: string): Promise<DirEntry[]> {
  const entries: DirEntry[] = [];
  for await (const entry of Deno.readDir(dir)) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isSymlink) {
      const stat = await Deno.stat(`${dir}/${entry.name}`);
      entries.push({ name: entry.name.normalize('NFC'), diskName: entry.name, isDirectory: stat.isDirectory });
      continue;
    }
    entries.push({ name: entry.name.normalize('NFC'), diskName: entry.name, isDirectory: entry.isDirectory });
  }
  return entries.sort((a, b) => compareCodePoints(a.name, b.name));
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return false;
    throw e;
  }
}

/** 本文の文書（読み順の一つ） */
interface SourceDocument {
  /** プロジェクトからの相対パス（NFC） */
  path: string;
  diskPath: string;
  format: SourceFormat;
  /** 見出しがないときの題名 */
  fallbackTitle: string;
}

/** 本文の木 */
type BodyNode =
  | { kind: 'document'; doc: SourceDocument }
  | { kind: 'directory'; name: string; index: SourceDocument | undefined; children: BodyNode[] };

function checkStemConflicts(dir: string, files: DirEntry[]): void {
  const stems = new Map<string, string>();
  for (const file of files) {
    const stem = stemOf(file.name);
    const other = stems.get(stem);
    if (other !== undefined) {
      throw epubInputError(
        `拡張子を除いて同じ名前のファイルがある: ${join(dir, other)} と ${join(dir, file.name)}`,
      );
    }
    stems.set(stem, file.name);
  }
}

function toSourceDocument(root: string, path: string, diskPath: string, name: string): SourceDocument {
  const format = DOCUMENT_EXTENSIONS[extensionOf(name)];
  if (format === undefined) throw epubInputError(`本文に使えない拡張子のファイル: ${path}`);
  return { path, diskPath: `${root}/${diskPath}`, format, fallbackTitle: stripSerial(stemOf(name)) };
}

async function readBodyDirectory(root: string, path: string, diskPath: string): Promise<BodyNode[]> {
  const entries = await readEntries(`${root}/${diskPath}`);
  if (entries.length === 0) throw epubInputError(`中身のないディレクトリ: ${path}`);
  const files = entries.filter((e) => !e.isDirectory);
  for (const file of files) {
    if (DOCUMENT_EXTENSIONS[extensionOf(file.name)] === undefined) {
      throw epubInputError(`本文に使えない拡張子のファイル: ${join(path, file.name)}`);
    }
  }
  checkStemConflicts(path, files);
  const nodes: BodyNode[] = [];
  for (const entry of entries) {
    const childPath = join(path, entry.name);
    const childDisk = join(diskPath, entry.diskName);
    if (entry.isDirectory) {
      const children = await readBodyDirectory(root, childPath, childDisk);
      const indexAt = children.findIndex((c) =>
        c.kind === 'document' && stemOf(c.doc.path.split('/').pop()!) === 'index'
      );
      const index = indexAt >= 0 ? (children.splice(indexAt, 1)[0] as { doc: SourceDocument }).doc : undefined;
      nodes.push({ kind: 'directory', name: entry.name, index, children });
    } else {
      nodes.push({ kind: 'document', doc: toSourceDocument(root, childPath, childDisk, entry.name) });
    }
  }
  return nodes;
}

async function readMeta(
  root: string,
): Promise<Partial<Record<string, SourceDocument>>> {
  if (!(await exists(`${root}/meta`))) return {};
  const entries = await readEntries(`${root}/meta`);
  const result: Partial<Record<string, SourceDocument>> = {};
  for (const entry of entries) {
    const path = `meta/${entry.name}`;
    if (entry.isDirectory) throw epubInputError(`meta/ にディレクトリは置けない: ${path}`);
    const stem = stemOf(entry.name);
    if (!META_NAMES.has(stem) || DOCUMENT_EXTENSIONS[extensionOf(entry.name)] === undefined) {
      throw epubInputError(
        `meta/ に置けないファイル: ${path}（${[...META_NAMES].join('、')} の .md、.xhtml、.html）`,
      );
    }
  }
  checkStemConflicts('meta', entries);
  for (const entry of entries) {
    result[stemOf(entry.name)] = toSourceDocument(
      root,
      `meta/${entry.name}`,
      `meta/${entry.diskName}`,
      entry.name,
    );
  }
  return result;
}

interface Asset {
  /** プロジェクトからの相対パス（NFC） */
  path: string;
  /** EPUB の中のパス（空白類を `_` に置き換えたもの） */
  outputPath: string;
  diskPath: string;
  mediaType: ImageMediaType | 'text/css';
}

async function readAssets(root: string, path = 'assets', diskPath = 'assets'): Promise<Asset[]> {
  if (path === 'assets' && !(await exists(`${root}/assets`))) return [];
  const assets: Asset[] = [];
  for (const entry of await readEntries(`${root}/${diskPath}`)) {
    const childPath = `${path}/${entry.name}`;
    const childDisk = `${diskPath}/${entry.diskName}`;
    if (entry.isDirectory) {
      assets.push(...await readAssets(root, childPath, childDisk));
      continue;
    }
    const mediaType = ASSET_TYPES[extensionOf(entry.name)];
    if (mediaType === undefined) {
      throw epubInputError(
        `assets/ に置けない拡張子のファイル: ${childPath}（.css、.jpg、.jpeg、.png、.gif、.svg）`,
      );
    }
    assets.push({ path: childPath, outputPath: replaceSpaces(childPath), diskPath: `${root}/${childDisk}`, mediaType });
  }
  return assets;
}

function expectString(table: TomlTable, key: string): string | undefined {
  const value = table[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw epubInputError(`book.toml の ${key} は文字列で書く`);
  return value;
}

const BOOK_KEYS = new Set([
  'identifier',
  'title',
  'language',
  'authors',
  'publisher',
  'description',
  'modified',
  'page_progression_direction',
  'primary_writing_mode',
  'cover_image',
]);

async function readBookToml(root: string): Promise<{
  metadata: Metadata;
  pageProgressionDirection?: PageProgressionDirection;
  coverImage?: string;
}> {
  const path = `${root}/book.toml`;
  if (!(await exists(path))) throw epubInputError('book.toml がない');
  let table: TomlTable;
  try {
    table = parseToml(new TextDecoder('utf-8', { fatal: true }).decode(await Deno.readFile(path)));
  } catch (e) {
    if (isTomlError(e)) throw epubInputError(`book.toml:${e.message}`);
    if (e instanceof TypeError) throw epubInputError('book.toml が UTF-8 でない');
    throw e;
  }
  for (const key of Object.keys(table)) {
    if (!BOOK_KEYS.has(key)) throw epubInputError(`book.toml に知らないキーがある: ${key}`);
  }
  const metadata: Metadata = { identifier: '', title: '', language: '' };
  for (const key of ['identifier', 'title', 'language'] as const) {
    const value = expectString(table, key);
    if (value === undefined || value.trim() === '') throw epubInputError(`book.toml に ${key} がない`);
    metadata[key] = value;
  }
  metadata.publisher = expectString(table, 'publisher');
  metadata.description = expectString(table, 'description');
  if (table.authors !== undefined) {
    if (!Array.isArray(table.authors) || !table.authors.every((a) => typeof a === 'string')) {
      throw epubInputError('book.toml の authors は文字列の配列で書く');
    }
    metadata.authors = table.authors as string[];
  }
  if (table.modified !== undefined) {
    const modified = table.modified;
    if (!isTomlDateTime(modified) || modified.kind !== 'offset-date-time') {
      throw epubInputError('book.toml の modified はオフセット付きの日時（例 2026-10-09T00:00:00Z）で書く');
    }
    metadata.modified = modified.date;
  }
  const ppd = expectString(table, 'page_progression_direction');
  if (ppd !== undefined && ppd !== 'ltr' && ppd !== 'rtl') {
    throw epubInputError('book.toml の page_progression_direction は "ltr" か "rtl" で書く');
  }
  // Kindle の組み方向。書いていなければ頁送りの向きから決める（ADR 0024）
  const pwm = expectString(table, 'primary_writing_mode');
  if (pwm !== undefined && WRITING_MODE_DIRECTIONS[pwm] === undefined) {
    throw epubInputError(
      'book.toml の primary_writing_mode は "horizontal-lr"、"horizontal-rl"、"vertical-lr"、"vertical-rl" のいずれかで書く',
    );
  }
  if (pwm !== undefined && ppd !== undefined && WRITING_MODE_DIRECTIONS[pwm] !== ppd) {
    throw epubInputError(
      `book.toml の primary_writing_mode ${pwm} と page_progression_direction ${ppd} が食い違う`,
    );
  }
  const primaryWritingMode = (pwm ?? (ppd === 'rtl' ? 'vertical-rl' : ppd === 'ltr' ? 'horizontal-lr' : undefined)) as
    | PrimaryWritingMode
    | undefined;
  if (primaryWritingMode) metadata.primaryWritingMode = primaryWritingMode;
  return { metadata, pageProgressionDirection: ppd, coverImage: expectString(table, 'cover_image') };
}

function hasClass(node: Element, name: string): boolean {
  const className = node.properties.className;
  return Array.isArray(className) && className.includes(name);
}

/** 文書の中の見出しを、文書の順に集める。脚注の欄の中は除く */
function headingElements(tree: HastRoot): Element[] {
  const found: Element[] = [];
  const walk = (node: HastNodes) => {
    if (node.type === 'element') {
      if (hasClass(node, 'footnotes')) return;
      if (/^h[1-6]$/.test(node.tagName)) {
        found.push(node);
        return;
      }
    }
    if ('children' in node) node.children.forEach(walk);
  };
  walk(tree);
  return found;
}

/** 見出しの文字列。ルビの読みと括弧、脚注の参照を除く。空なら undefined */
function headingText(heading: Element): string | undefined {
  const text = (node: ElementContent): string => {
    if (node.type === 'text') return node.value;
    if (node.type !== 'element') return '';
    if (node.tagName === 'rt' || node.tagName === 'rp') return '';
    // EPUB 2.0.1 の括弧書きのルビ（ADR 0024）と、脚注の参照
    if (['rt', 'rp', 'noteref'].some((c) => hasClass(node, c))) return '';
    return node.children.map(text).join('');
  };
  // HTML の空白（ASCII の空白類）だけをまとめる。全角空白などは題名の一部として残す
  const title = heading.children.map(text).join('').replace(/[ \t\n\f\r]+/g, ' ').replace(/^ | $/g, '');
  return title === '' ? undefined : title;
}

/** 文書の題名を、最初の見出しから取り出す */
export function headingTitle(tree: HastRoot): string | undefined {
  const first = headingElements(tree)[0];
  return first ? headingText(first) : undefined;
}

/**
 * 文書の題名に使った最初の見出しを除くすべての見出しを、レベルで入れ子にした節にする（ADR 0024）。
 * id のない見出しには `sec-<番号>` を付ける
 */
export function extractSections(tree: HastRoot, sectionHeadings?: Set<Element>): Section[] {
  const ids = new Set<string>();
  const collectIds = (node: HastNodes) => {
    if (node.type === 'element' && typeof node.properties.id === 'string') ids.add(node.properties.id);
    if ('children' in node) node.children.forEach(collectIds);
  };
  collectIds(tree);
  let serial = 1;
  const root: Section[] = [];
  const stack: { level: number; section: Section }[] = [];
  for (const heading of headingElements(tree).slice(1)) {
    const title = headingText(heading);
    if (title === undefined) continue;
    let id = heading.properties.id;
    if (typeof id !== 'string' || id === '') {
      while (ids.has(`sec-${serial}`)) serial++;
      id = `sec-${serial++}`;
      ids.add(id);
      heading.properties.id = id;
    }
    const level = Number(heading.tagName.slice(1));
    sectionHeadings?.add(heading);
    const section: Section = { title, id };
    while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop();
    const parent = stack[stack.length - 1];
    if (parent) (parent.section.children ??= []).push(section);
    else root.push(section);
    stack.push({ level, section });
  }
  return root;
}

/**
 * 本文の直下の、節にした見出しごとのまとまりを section 要素で囲む（ADR 0024）。
 * 脚注の欄の前で、開いている section をすべて閉じる
 */
export function wrapSections(tree: HastRoot, sectionHeadings: Set<Element>): void {
  const children: HastRoot['children'] = [];
  const stack: { level: number; element: Element }[] = [];
  const append = (node: HastRoot['children'][number]) => {
    const parent = stack[stack.length - 1];
    if (parent) parent.element.children.push(node as ElementContent);
    else children.push(node);
  };
  for (const node of tree.children) {
    if (node.type === 'element' && hasClass(node, 'footnotes')) {
      stack.length = 0;
      children.push(node);
      continue;
    }
    if (node.type === 'element' && sectionHeadings.has(node)) {
      const level = Number(node.tagName.slice(1));
      while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop();
      const section: Element = { type: 'element', tagName: 'section', properties: {}, children: [node] };
      append(section);
      stack.push({ level, element: section });
      continue;
    }
    append(node);
  }
  tree.children = children;
}

/** パスを正規化する。`..` で外に出るなら undefined */
function normalizePath(path: string): string | undefined {
  const out: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (out.length === 0) return undefined;
      out.pop();
    } else {
      out.push(segment);
    }
  }
  return out.join('/');
}

interface ReferenceTargets {
  /** 元のパスから、EPUB の中のパスへ */
  images: Map<string, string>;
  assets: Map<string, string>;
  /** 元のパスから、EPUB の中の文書の名前へ */
  documents: Map<string, string>;
}

/** 文書の中の参照を、EPUB の中での相対パスに書き換える */
function rewriteReferences(tree: HastRoot, sourcePath: string, targets: ReferenceTargets): void {
  const sourceDir = sourcePath.split('/').slice(0, -1).join('/');
  const resolve = (value: string, node: Element, kind: 'image' | 'link'): string => {
    if (value.startsWith('#')) return value;
    if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) {
      if (kind === 'image') fail(`外部の画像は使えない: ${value}`, node);
      return value;
    }
    if (value.startsWith('/')) fail(`/ で始まる参照は使えない: ${value}`, node);
    const hashAt = value.indexOf('#');
    const pathPart = hashAt >= 0 ? value.slice(0, hashAt) : value;
    const fragment = hashAt >= 0 ? value.slice(hashAt) : '';
    if (pathPart.includes('?')) fail(`クエリを含む参照は使えない: ${value}`, node);
    let decoded: string;
    try {
      decoded = decodeURIComponent(pathPart);
    } catch {
      fail(`パーセントエンコードが正しくない参照: ${value}`, node);
    }
    const target = normalizePath(join(sourceDir, decoded).normalize('NFC'));
    if (target === undefined) fail(`プロジェクトの外を指す参照: ${value}`, node);
    if (kind === 'image') {
      const image = targets.images.get(target);
      if (image === undefined) fail(`assets/ の下にない画像を指す参照: ${value}`, node);
      return `../${encodePath(image)}`;
    }
    const asset = targets.assets.get(target);
    if (asset !== undefined) return `../${encodePath(asset)}${fragment}`;
    const document = targets.documents.get(target);
    if (document !== undefined) return `${document}${fragment}`;
    fail(`指す先のない参照: ${value}`, node);
  };
  const walk = (node: HastNodes) => {
    if (node.type === 'element') {
      const p = node.properties;
      if (node.tagName === 'img' && typeof p.src === 'string') p.src = resolve(p.src, node, 'image');
      if (node.tagName === 'image') {
        if (typeof p.href === 'string') p.href = resolve(p.href, node, 'image');
        if (typeof p.xLinkHref === 'string') p.xLinkHref = resolve(p.xLinkHref, node, 'image');
      }
      if (node.tagName === 'a' && typeof p.href === 'string') p.href = resolve(p.href, node, 'link');
    }
    if ('children' in node) node.children.forEach(walk);
  };
  walk(tree);
}

function fail(message: string, node: Element): never {
  throw conversionError(message, node.position?.start.line, node.position?.start.column);
}

interface ConvertedDocument {
  title: string;
  body: string;
  sections: Section[];
}

/** EPUB 2.0.1 で使えない要素を警告する（ADR 0024） */
function warnEpub2Markup(tree: HastRoot, path: string, onWarning: (warning: LoadWarning) => void): void {
  const walk = (node: HastNodes) => {
    if (node.type === 'element' && (node.tagName === 'math' || node.tagName === 'ruby')) {
      const start = node.position?.start;
      onWarning(
        node.tagName === 'math'
          ? {
            code: 'mathml-in-epub-2',
            path,
            line: start?.line,
            column: start?.column,
            message: 'EPUB 2.0.1 の本文に MathML は書けない。作った EPUB は EPUBCheck で誤りになる',
          }
          : {
            code: 'ruby-in-epub-2',
            path,
            line: start?.line,
            column: start?.column,
            message: 'EPUB 2.0.1 の本文に ruby 要素は書けない。作った EPUB は EPUBCheck で誤りになる',
          },
      );
    }
    if ('children' in node) node.children.forEach(walk);
  };
  walk(tree);
}

async function convert(
  doc: SourceDocument,
  version: BuildOptions['version'],
  targets: ReferenceTargets,
  onWarning: (warning: LoadWarning) => void,
  withSections: boolean,
): Promise<ConvertedDocument> {
  let src: string;
  try {
    src = new TextDecoder('utf-8', { fatal: true }).decode(await Deno.readFile(doc.diskPath));
  } catch (e) {
    if (e instanceof TypeError) throw epubInputError(`${doc.path}: UTF-8 でない`);
    throw e;
  }
  try {
    const tree = sourceToTree(src, doc.format, version);
    rewriteReferences(tree, doc.path, targets);
    if (version === '2.0.1') warnEpub2Markup(tree, doc.path, onWarning);
    // 表紙と扉は目次に入れないため、見出しを節にしない（ADR 0024）
    const sectionHeadings = new Set<Element>();
    const sections = withSections ? extractSections(tree, sectionHeadings) : [];
    if (isEpub3(version)) wrapSections(tree, sectionHeadings);
    return { title: headingTitle(tree) ?? doc.fallbackTitle, body: writeXhtml(tree, version), sections };
  } catch (e) {
    if (isConversionError(e)) {
      const at = e.line !== undefined ? `:${e.line}:${e.column}` : '';
      throw epubInputError(`${doc.path}${at}: ${e.message.replace(/^\d+:\d+: /, '')}`);
    }
    throw e;
  }
}

/**
 * ディレクトリから本を読む（ADR 0024）。
 * `options.version` は、ルビと脚注の書き出し方を決めるため、`buildEpub` に渡すものと同じにする。
 */
export async function loadBook(dir: string, options: LoadOptions): Promise<Book> {
  const root = dir.replace(/\/+$/, '');
  if (!EPUB_VERSIONS.includes(options.version)) {
    throw epubInputError(`知らない版: ${String(options.version)}`);
  }
  const { metadata, pageProgressionDirection, coverImage } = await readBookToml(root);
  if (!(await exists(`${root}/body`))) throw epubInputError('body/ がない');
  const body = await readBodyDirectory(root, 'body', 'body');
  const meta = await readMeta(root);
  const assets = await readAssets(root);
  const onWarning = options.onWarning ?? defaultOnWarning;
  const outputPaths = new Map<string, string>();
  for (const asset of assets) {
    const key = asset.outputPath.toLowerCase();
    const other = outputPaths.get(key);
    if (other !== undefined) {
      throw epubInputError(`空白を _ に置き換えると、ファイルのパスが重なる: ${other} と ${asset.path}`);
    }
    outputPaths.set(key, asset.path);
    if (asset.outputPath !== asset.path) {
      onWarning({
        code: 'renamed-file',
        path: asset.path,
        message:
          `EPUB の中では ${asset.outputPath} とする。スタイルシートの url() で元の名前を指していると、参照が切れる`,
      });
    }
  }

  // 読み順：表紙、本文（ディレクトリは index を先に）、奥付
  const spine: SourceDocument[] = [];
  if (meta.cover) spine.push(meta.cover);
  if (meta.titlepage) spine.push(meta.titlepage);
  const flatten = (nodes: BodyNode[]) => {
    for (const node of nodes) {
      if (node.kind === 'document') {
        spine.push(node.doc);
      } else {
        if (node.index) spine.push(node.index);
        flatten(node.children);
      }
    }
  };
  flatten(body);
  for (const name of BACK_MATTER_NAMES) if (meta[name]) spine.push(meta[name]);
  if (meta.colophon) spine.push(meta.colophon);

  const targets: ReferenceTargets = {
    images: new Map(assets.filter((a) => a.mediaType !== 'text/css').map((a) => [a.path, a.outputPath])),
    assets: new Map(assets.map((a) => [a.path, a.outputPath])),
    documents: new Map(spine.map((doc, i) => [doc.path, contentDocumentName(i, spine.length)])),
  };
  const coverImagePath = coverImage === undefined ? undefined : targets.images.get(coverImage.normalize('NFC'));
  if (coverImage !== undefined && coverImagePath === undefined) {
    throw epubInputError(`book.toml の cover_image が assets/ の下の画像を指していない: ${coverImage}`);
  }

  const converted = new Map<SourceDocument, ConvertedDocument>();
  for (const doc of spine) {
    converted.set(
      doc,
      await convert(doc, options.version, targets, onWarning, doc !== meta.cover && doc !== meta.titlepage),
    );
  }

  const stylesheets: Stylesheet[] = [];
  const images: Image[] = [];
  for (const asset of assets) {
    if (asset.mediaType === 'text/css') {
      stylesheets.push({ path: asset.outputPath, content: await Deno.readTextFile(asset.diskPath) });
    } else {
      images.push({ path: asset.outputPath, mediaType: asset.mediaType, data: await Deno.readFile(asset.diskPath) });
    }
  }
  stylesheets.sort((a, b) => compareCodePoints(a.path, b.path));
  const stylesheetPaths = stylesheets.map((s) => s.path);

  // 文書の役割。EPUB 3.0 では body の epub:type に、EPUB 2.0.1 では guide に使う（ADR 0024）
  const role = (epubType: string) => ({ epubType });
  const withSections = (chapter: Chapter, sections: Section[]): Chapter =>
    sections.length > 0 ? { ...chapter, sections } : chapter;
  const toChapter = (node: BodyNode, depth: number): Chapter => {
    if (node.kind === 'document') {
      const doc = converted.get(node.doc)!;
      return withSections(
        { title: doc.title, body: doc.body, ...role('bodymatter chapter'), stylesheets: stylesheetPaths },
        doc.sections,
      );
    }
    const index = node.index ? converted.get(node.index) : undefined;
    return withSections({
      title: index?.title ?? stripSerial(node.name),
      body: index?.body,
      ...(index ? role(depth === 0 ? 'bodymatter part' : 'bodymatter division') : {}),
      stylesheets: stylesheetPaths,
      children: node.children.map((child) => toChapter(child, depth + 1)),
    }, index?.sections ?? []);
  };
  const chapters = body.map((node) => toChapter(node, 0));
  // 後付けは本文の後、奥付の前に置き、目次に入れる（ADR 0024）
  for (const name of BACK_MATTER_NAMES) {
    const source = meta[name];
    if (!source) continue;
    const doc = converted.get(source)!;
    chapters.push(
      withSections(
        { title: doc.title, body: doc.body, ...role(`backmatter ${name}`), stylesheets: stylesheetPaths },
        doc.sections,
      ),
    );
  }
  if (meta.colophon) {
    const doc = converted.get(meta.colophon)!;
    chapters.push(
      withSections(
        { title: doc.title, body: doc.body, ...role('backmatter colophon'), stylesheets: stylesheetPaths },
        doc.sections,
      ),
    );
  }
  const titlepage = meta.titlepage
    ? { body: converted.get(meta.titlepage)!.body, ...role('frontmatter titlepage'), stylesheets: stylesheetPaths }
    : undefined;
  const cover = meta.cover
    ? { body: converted.get(meta.cover)!.body, ...role('frontmatter cover'), stylesheets: stylesheetPaths }
    : undefined;

  return {
    metadata,
    pageProgressionDirection,
    stylesheets,
    images,
    coverImage: coverImagePath,
    cover,
    titlepage,
    chapters,
  };
}
