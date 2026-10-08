// ディレクトリから本を読む（ADR 0006）

import type { Element, ElementContent, Nodes as HastNodes, Root as HastRoot } from 'hast';
import { contentDocumentName } from '../epub.ts';
import {
  type Book,
  type BuildOptions,
  type Chapter,
  EpubInputError,
  type Image,
  type ImageMediaType,
  type Metadata,
  type PageProgressionDirection,
  type Stylesheet,
} from '../types.ts';
import { encodePath } from '../xml.ts';
import { type SourceFormat, sourceToTree } from './convert.ts';
import { parseToml, TomlDateTime, TomlError, type TomlTable } from './toml.ts';
import { ConversionError, writeXhtml } from './xhtml-writer.ts';

export type LoadOptions = BuildOptions;

const DOCUMENT_EXTENSIONS: Record<string, SourceFormat> = { '.md': 'md', '.xhtml': 'xhtml', '.html': 'html' };
const ASSET_TYPES: Record<string, ImageMediaType | 'text/css'> = {
  '.css': 'text/css',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};
const META_NAMES = new Set(['cover', 'colophon']);
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
      throw new EpubInputError(
        `拡張子を除いて同じ名前のファイルがある: ${join(dir, other)} と ${join(dir, file.name)}`,
      );
    }
    stems.set(stem, file.name);
  }
}

function toSourceDocument(root: string, path: string, diskPath: string, name: string): SourceDocument {
  const format = DOCUMENT_EXTENSIONS[extensionOf(name)];
  if (format === undefined) throw new EpubInputError(`本文に使えない拡張子のファイル: ${path}`);
  return { path, diskPath: `${root}/${diskPath}`, format, fallbackTitle: stripSerial(stemOf(name)) };
}

async function readBodyDirectory(root: string, path: string, diskPath: string): Promise<BodyNode[]> {
  const entries = await readEntries(`${root}/${diskPath}`);
  if (entries.length === 0) throw new EpubInputError(`中身のないディレクトリ: ${path}`);
  const files = entries.filter((e) => !e.isDirectory);
  for (const file of files) {
    if (DOCUMENT_EXTENSIONS[extensionOf(file.name)] === undefined) {
      throw new EpubInputError(`本文に使えない拡張子のファイル: ${join(path, file.name)}`);
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

async function readMeta(root: string): Promise<{ cover?: SourceDocument; colophon?: SourceDocument }> {
  if (!(await exists(`${root}/meta`))) return {};
  const entries = await readEntries(`${root}/meta`);
  const result: { cover?: SourceDocument; colophon?: SourceDocument } = {};
  for (const entry of entries) {
    const path = `meta/${entry.name}`;
    if (entry.isDirectory) throw new EpubInputError(`meta/ にディレクトリは置けない: ${path}`);
    const stem = stemOf(entry.name);
    if (!META_NAMES.has(stem) || DOCUMENT_EXTENSIONS[extensionOf(entry.name)] === undefined) {
      throw new EpubInputError(`meta/ に置けないファイル: ${path}（cover か colophon の .md、.xhtml、.html）`);
    }
  }
  checkStemConflicts('meta', entries);
  for (const entry of entries) {
    result[stemOf(entry.name) as 'cover' | 'colophon'] = toSourceDocument(
      root,
      `meta/${entry.name}`,
      `meta/${entry.diskName}`,
      entry.name,
    );
  }
  return result;
}

interface Asset {
  path: string;
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
      throw new EpubInputError(
        `assets/ に置けない拡張子のファイル: ${childPath}（.css、.jpg、.jpeg、.png、.gif、.svg）`,
      );
    }
    assets.push({ path: childPath, diskPath: `${root}/${childDisk}`, mediaType });
  }
  return assets;
}

function expectString(table: TomlTable, key: string): string | undefined {
  const value = table[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new EpubInputError(`book.toml の ${key} は文字列で書く`);
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
  'cover_image',
]);

async function readBookToml(root: string): Promise<{
  metadata: Metadata;
  pageProgressionDirection?: PageProgressionDirection;
  coverImage?: string;
}> {
  const path = `${root}/book.toml`;
  if (!(await exists(path))) throw new EpubInputError('book.toml がない');
  let table: TomlTable;
  try {
    table = parseToml(new TextDecoder('utf-8', { fatal: true }).decode(await Deno.readFile(path)));
  } catch (e) {
    if (e instanceof TomlError) throw new EpubInputError(`book.toml:${e.message}`);
    if (e instanceof TypeError) throw new EpubInputError('book.toml が UTF-8 でない');
    throw e;
  }
  for (const key of Object.keys(table)) {
    if (!BOOK_KEYS.has(key)) throw new EpubInputError(`book.toml に知らないキーがある: ${key}`);
  }
  const metadata: Metadata = { identifier: '', title: '', language: '' };
  for (const key of ['identifier', 'title', 'language'] as const) {
    const value = expectString(table, key);
    if (value === undefined || value.trim() === '') throw new EpubInputError(`book.toml に ${key} がない`);
    metadata[key] = value;
  }
  metadata.publisher = expectString(table, 'publisher');
  metadata.description = expectString(table, 'description');
  if (table.authors !== undefined) {
    if (!Array.isArray(table.authors) || !table.authors.every((a) => typeof a === 'string')) {
      throw new EpubInputError('book.toml の authors は文字列の配列で書く');
    }
    metadata.authors = table.authors as string[];
  }
  if (table.modified !== undefined) {
    const modified = table.modified;
    if (!(modified instanceof TomlDateTime) || modified.kind !== 'offset-date-time') {
      throw new EpubInputError('book.toml の modified はオフセット付きの日時（例 2026-10-09T00:00:00Z）で書く');
    }
    metadata.modified = modified.date;
  }
  const ppd = expectString(table, 'page_progression_direction');
  if (ppd !== undefined && ppd !== 'ltr' && ppd !== 'rtl') {
    throw new EpubInputError('book.toml の page_progression_direction は "ltr" か "rtl" で書く');
  }
  return { metadata, pageProgressionDirection: ppd, coverImage: expectString(table, 'cover_image') };
}

/** 見出しの題名を取り出す。ルビの読みと括弧、脚注の参照は除く */
export function headingTitle(tree: HastRoot): string | undefined {
  let found: Element | undefined;
  const find = (node: HastNodes) => {
    if (found) return;
    if (node.type === 'element' && /^h[1-6]$/.test(node.tagName)) {
      found = node;
      return;
    }
    if ('children' in node) node.children.forEach(find);
  };
  find(tree);
  if (!found) return undefined;
  const text = (node: ElementContent): string => {
    if (node.type === 'text') return node.value;
    if (node.type !== 'element') return '';
    if (node.tagName === 'rt' || node.tagName === 'rp') return '';
    const className = node.properties.className;
    // EPUB 2.0.1 の括弧書きのルビ（ADR 0006）と、脚注の参照
    if (Array.isArray(className) && ['rt', 'rp', 'noteref'].some((c) => className.includes(c))) return '';
    return node.children.map(text).join('');
  };
  const title = found.children.map(text).join('').replace(/\s+/g, ' ').trim();
  return title === '' ? undefined : title;
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
  images: Set<string>;
  assets: Set<string>;
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
      if (!targets.images.has(target)) fail(`assets/ の下にない画像を指す参照: ${value}`, node);
      return `../${encodePath(target)}`;
    }
    if (targets.assets.has(target)) return `../${encodePath(target)}${fragment}`;
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
  throw new ConversionError(message, node.position?.start.line, node.position?.start.column);
}

interface ConvertedDocument {
  title: string;
  body: string;
}

async function convert(
  doc: SourceDocument,
  version: BuildOptions['version'],
  targets: ReferenceTargets,
): Promise<ConvertedDocument> {
  let src: string;
  try {
    src = new TextDecoder('utf-8', { fatal: true }).decode(await Deno.readFile(doc.diskPath));
  } catch (e) {
    if (e instanceof TypeError) throw new EpubInputError(`${doc.path}: UTF-8 でない`);
    throw e;
  }
  try {
    const tree = sourceToTree(src, doc.format, version);
    rewriteReferences(tree, doc.path, targets);
    return { title: headingTitle(tree) ?? doc.fallbackTitle, body: writeXhtml(tree, version) };
  } catch (e) {
    if (e instanceof ConversionError) {
      const at = e.line !== undefined ? `:${e.line}:${e.column}` : '';
      throw new EpubInputError(`${doc.path}${at}: ${e.message.replace(/^\d+:\d+: /, '')}`);
    }
    throw e;
  }
}

/**
 * ディレクトリから本を読む（ADR 0006）。
 * `options.version` は、ルビと脚注の書き出し方を決めるため、`buildEpub` に渡すものと同じにする。
 */
export async function loadBook(dir: string, options: LoadOptions): Promise<Book> {
  const root = dir.replace(/\/+$/, '');
  if (options.version !== '2.0.1' && options.version !== '3.0') {
    throw new EpubInputError(`知らない版: ${String(options.version)}`);
  }
  const { metadata, pageProgressionDirection, coverImage } = await readBookToml(root);
  if (!(await exists(`${root}/body`))) throw new EpubInputError('body/ がない');
  const body = await readBodyDirectory(root, 'body', 'body');
  const meta = await readMeta(root);
  const assets = await readAssets(root);

  // 読み順：表紙、本文（ディレクトリは index を先に）、奥付
  const spine: SourceDocument[] = [];
  if (meta.cover) spine.push(meta.cover);
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
  if (meta.colophon) spine.push(meta.colophon);

  const targets: ReferenceTargets = {
    images: new Set(assets.filter((a) => a.mediaType !== 'text/css').map((a) => a.path)),
    assets: new Set(assets.map((a) => a.path)),
    documents: new Map(spine.map((doc, i) => [doc.path, contentDocumentName(i, spine.length)])),
  };
  if (coverImage !== undefined && !targets.images.has(coverImage.normalize('NFC'))) {
    throw new EpubInputError(`book.toml の cover_image が assets/ の下の画像を指していない: ${coverImage}`);
  }

  const converted = new Map<SourceDocument, ConvertedDocument>();
  for (const doc of spine) converted.set(doc, await convert(doc, options.version, targets));

  const stylesheets: Stylesheet[] = [];
  const images: Image[] = [];
  for (const asset of assets) {
    if (asset.mediaType === 'text/css') {
      stylesheets.push({ path: asset.path, content: await Deno.readTextFile(asset.diskPath) });
    } else {
      images.push({ path: asset.path, mediaType: asset.mediaType, data: await Deno.readFile(asset.diskPath) });
    }
  }
  stylesheets.sort((a, b) => compareCodePoints(a.path, b.path));
  const stylesheetPaths = stylesheets.map((s) => s.path);

  const toChapter = (node: BodyNode): Chapter => {
    if (node.kind === 'document') {
      const doc = converted.get(node.doc)!;
      return { title: doc.title, body: doc.body, stylesheets: stylesheetPaths };
    }
    const index = node.index ? converted.get(node.index) : undefined;
    return {
      title: index?.title ?? stripSerial(node.name),
      body: index?.body,
      stylesheets: stylesheetPaths,
      children: node.children.map(toChapter),
    };
  };
  const chapters = body.map(toChapter);
  if (meta.colophon) {
    const doc = converted.get(meta.colophon)!;
    chapters.push({ title: doc.title, body: doc.body, stylesheets: stylesheetPaths });
  }

  return {
    metadata,
    pageProgressionDirection,
    stylesheets,
    images,
    coverImage: coverImage?.normalize('NFC'),
    cover: meta.cover ? { body: converted.get(meta.cover)!.body, stylesheets: stylesheetPaths } : undefined,
    chapters,
  };
}
