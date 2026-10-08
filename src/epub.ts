// EPUB の構成を作る（ADR 0003、ADR 0004）

import { type Book, type BuildOptions, type Chapter, EpubInputError, type EpubVersion, type Section } from './types.ts';
import { encodePath, escapeAttribute, escapeText, hasInvalidXmlChar } from './xml.ts';
import { writeZip, type ZipEntry } from './zip.ts';

const IMAGE_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/svg+xml']);
const RESERVED_PATHS = new Set(['content.opf', 'toc.ncx', 'nav.xhtml']);
const TEXT_DIR = 'text';

interface ContentDocument {
  /** `OEBPS/` からの相対パス */
  path: string;
  id: string;
  title: string;
  body: string;
  stylesheets: string[];
}

interface TocEntry {
  title: string;
  href: string;
  children: TocEntry[];
}

/** 内容文書のファイルの名前を、読み順の番号から作る（ADR 0006） */
export function contentDocumentName(index: number, count: number): string {
  return `${String(index + 1).padStart(Math.max(4, String(count).length), '0')}.xhtml`;
}

/** 本の値の誤りを調べ、誤りがあれば例外とする */
export function validateBook(book: Book, options: BuildOptions): void {
  if (options.version !== '2.0.1' && options.version !== '3.0') {
    throw new EpubInputError(`知らない版: ${String(options.version)}`);
  }
  const { metadata } = book;
  for (const key of ['identifier', 'title', 'language'] as const) {
    if (typeof metadata[key] !== 'string' || metadata[key].trim() === '') {
      throw new EpubInputError(`書誌情報の ${key} がない`);
    }
  }
  for (const author of metadata.authors ?? []) {
    if (typeof author !== 'string' || author.trim() === '') throw new EpubInputError('空の著者がある');
  }
  if (metadata.modified !== undefined && Number.isNaN(metadata.modified.getTime())) {
    throw new EpubInputError('書誌情報の modified が正しい日時でない');
  }
  const strings = [metadata.identifier, metadata.title, metadata.language, metadata.publisher, metadata.description];
  for (const value of [...strings, ...(metadata.authors ?? [])]) {
    if (value !== undefined && hasInvalidXmlChar(value)) {
      throw new EpubInputError(`書誌情報に XML で使えない文字がある: ${JSON.stringify(value)}`);
    }
  }
  if (
    book.pageProgressionDirection !== undefined && book.pageProgressionDirection !== 'ltr' &&
    book.pageProgressionDirection !== 'rtl'
  ) {
    throw new EpubInputError(`知らない頁送りの向き: ${book.pageProgressionDirection}`);
  }

  const seen = new Map<string, string>();
  const checkPath = (path: string) => {
    const segments = path.split('/');
    if (
      path === '' || path.startsWith('/') || path.includes('\\') ||
      segments.some((s) => s === '' || s === '.' || s === '..') || hasInvalidXmlChar(path)
    ) {
      throw new EpubInputError(`正しくないパス: ${JSON.stringify(path)}`);
    }
    if (RESERVED_PATHS.has(path) || segments[0] === TEXT_DIR) {
      throw new EpubInputError(`ライブラリが使うパスと重なる: ${path}`);
    }
    const key = path.normalize('NFC').toLowerCase();
    const other = seen.get(key);
    if (other !== undefined) throw new EpubInputError(`パスが重なる: ${other} と ${path}`);
    seen.set(key, path);
  };
  for (const stylesheet of book.stylesheets ?? []) checkPath(stylesheet.path);
  for (const image of book.images ?? []) {
    checkPath(image.path);
    if (!IMAGE_MEDIA_TYPES.has(image.mediaType)) {
      throw new EpubInputError(`知らないメディアタイプ: ${image.mediaType}（${image.path}）`);
    }
  }
  if (book.coverImage !== undefined && !(book.images ?? []).some((image) => image.path === book.coverImage)) {
    throw new EpubInputError(`表紙の画像がない: ${book.coverImage}`);
  }

  const stylesheetPaths = new Set((book.stylesheets ?? []).map((s) => s.path));
  const checkStylesheets = (paths: string[] | undefined) => {
    for (const path of paths ?? []) {
      if (!stylesheetPaths.has(path)) throw new EpubInputError(`スタイルシートがない: ${path}`);
    }
  };
  checkStylesheets(book.cover?.stylesheets);
  if (book.chapters.length === 0) throw new EpubInputError('本文の章がない');
  const checkChapter = (chapter: Chapter) => {
    if (typeof chapter.title !== 'string' || chapter.title.trim() === '') {
      throw new EpubInputError('題名のない章がある');
    }
    if (hasInvalidXmlChar(chapter.title)) {
      throw new EpubInputError(`章の題名に XML で使えない文字がある: ${JSON.stringify(chapter.title)}`);
    }
    if (chapter.body === undefined && (chapter.children ?? []).length === 0) {
      throw new EpubInputError(`本文も子もない章がある: ${chapter.title}`);
    }
    checkStylesheets(chapter.stylesheets);
    if ((chapter.sections ?? []).length > 0 && chapter.body === undefined) {
      throw new EpubInputError(`本文のない章に節がある: ${chapter.title}`);
    }
    const checkSection = (section: Section) => {
      if (typeof section.title !== 'string' || section.title.trim() === '' || hasInvalidXmlChar(section.title)) {
        throw new EpubInputError(`正しくない節の題名がある: ${chapter.title}`);
      }
      if (typeof section.id !== 'string' || section.id === '' || /[\s#]/.test(section.id)) {
        throw new EpubInputError(`正しくない節の id: ${JSON.stringify(section.id)}（${chapter.title}）`);
      }
      if (!chapter.body!.includes(`id="${escapeAttribute(section.id)}"`)) {
        throw new EpubInputError(`節の id が本文にない: ${section.id}（${chapter.title}）`);
      }
      section.children?.forEach(checkSection);
    };
    chapter.sections?.forEach(checkSection);
    chapter.children?.forEach(checkChapter);
  };
  book.chapters.forEach(checkChapter);
}

function formatModified(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function wrapDocument(doc: ContentDocument, book: Book, version: EpubVersion): string {
  const lang = escapeAttribute(book.metadata.language);
  const links = doc.stylesheets
    .map((path) => `<link rel="stylesheet" type="text/css" href="${escapeAttribute(`../${encodePath(path)}`)}"/>`)
    .join('\n');
  const head = `<head>\n<title>${escapeText(doc.title)}</title>\n${links ? `${links}\n` : ''}</head>`;
  if (version === '2.0.1') {
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${lang}">
${head}
<body>
${doc.body}
</body>
</html>
`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}">
${head}
<body>
${doc.body}
</body>
</html>
`;
}

function contentProperties(body: string): string[] {
  const properties: string[] = [];
  if (/<svg[\s/>]/.test(body)) properties.push('svg');
  if (/<math[\s/>]/.test(body)) properties.push('mathml');
  return properties;
}

function collect(book: Book): { documents: ContentDocument[]; toc: TocEntry[] } {
  const pending: Omit<ContentDocument, 'path' | 'id'>[] = [];
  if (book.cover) {
    pending.push({ title: book.metadata.title, body: book.cover.body, stylesheets: book.cover.stylesheets ?? [] });
  }
  type PendingEntry = {
    title: string;
    index: number | undefined;
    sections: Section[];
    children: PendingEntry[];
  };
  const walk = (chapter: Chapter): PendingEntry => {
    let index: number | undefined;
    if (chapter.body !== undefined) {
      index = pending.length;
      pending.push({ title: chapter.title, body: chapter.body, stylesheets: chapter.stylesheets ?? [] });
    }
    return {
      title: chapter.title,
      index,
      sections: chapter.sections ?? [],
      children: (chapter.children ?? []).map(walk),
    };
  };
  const entries = book.chapters.map(walk);
  const documents = pending.map((doc, i) => {
    const name = contentDocumentName(i, pending.length);
    return { ...doc, path: `${TEXT_DIR}/${name}`, id: `doc-${name.replace(/\.xhtml$/, '')}` };
  });
  const firstIndex = (entry: PendingEntry): number => entry.index ?? firstIndex(entry.children[0]);
  const sectionToToc = (path: string) => (section: Section): TocEntry => ({
    title: section.title,
    href: `${path}#${encodeURIComponent(section.id)}`,
    children: (section.children ?? []).map(sectionToToc(path)),
  });
  // 節を子の章より前に置く（ADR 0008）
  const toToc = (entry: PendingEntry): TocEntry => ({
    title: entry.title,
    href: documents[firstIndex(entry)].path,
    children: [
      ...(entry.index === undefined ? [] : entry.sections.map(sectionToToc(documents[entry.index].path))),
      ...entry.children.map(toToc),
    ],
  });
  return { documents, toc: entries.map(toToc) };
}

function depth(entries: TocEntry[]): number {
  return entries.reduce((max, e) => Math.max(max, 1 + depth(e.children)), 0);
}

function packageDocument(
  book: Book,
  version: EpubVersion,
  documents: ContentDocument[],
  imageIds: Map<string, string>,
  stylesheetIds: Map<string, string>,
  modified: Date,
): string {
  const m = book.metadata;
  const dc: string[] = [
    `<dc:identifier id="bookid">${escapeText(m.identifier)}</dc:identifier>`,
    `<dc:title>${escapeText(m.title)}</dc:title>`,
    `<dc:language>${escapeText(m.language)}</dc:language>`,
  ];
  for (const author of m.authors ?? []) {
    dc.push(
      version === '2.0.1'
        ? `<dc:creator opf:role="aut">${escapeText(author)}</dc:creator>`
        : `<dc:creator>${escapeText(author)}</dc:creator>`,
    );
  }
  if (m.publisher) dc.push(`<dc:publisher>${escapeText(m.publisher)}</dc:publisher>`);
  if (m.description) dc.push(`<dc:description>${escapeText(m.description)}</dc:description>`);
  if (version === '2.0.1') {
    dc.push(`<dc:date opf:event="modification">${modified.toISOString().slice(0, 10)}</dc:date>`);
    if (book.coverImage) dc.push(`<meta name="cover" content="${imageIds.get(book.coverImage)}"/>`);
  } else {
    dc.push(`<meta property="dcterms:modified">${formatModified(modified)}</meta>`);
  }

  const manifest: string[] = [];
  if (version === '3.0') {
    manifest.push('<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>');
  }
  manifest.push('<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>');
  for (const doc of documents) {
    const properties = version === '3.0' ? contentProperties(doc.body) : [];
    const attr = properties.length > 0 ? ` properties="${properties.join(' ')}"` : '';
    manifest.push(`<item id="${doc.id}" href="${doc.path}" media-type="application/xhtml+xml"${attr}/>`);
  }
  for (const stylesheet of book.stylesheets ?? []) {
    const href = escapeAttribute(encodePath(stylesheet.path));
    manifest.push(`<item id="${stylesheetIds.get(stylesheet.path)}" href="${href}" media-type="text/css"/>`);
  }
  for (const image of book.images ?? []) {
    const href = escapeAttribute(encodePath(image.path));
    const cover = version === '3.0' && image.path === book.coverImage ? ' properties="cover-image"' : '';
    manifest.push(`<item id="${imageIds.get(image.path)}" href="${href}" media-type="${image.mediaType}"${cover}/>`);
  }

  const ppd = version === '3.0' && book.pageProgressionDirection
    ? ` page-progression-direction="${book.pageProgressionDirection}"`
    : '';
  const spine = documents.map((doc) => `<itemref idref="${doc.id}"/>`);
  const packageAttrs = version === '2.0.1'
    ? 'version="2.0" unique-identifier="bookid"'
    : `version="3.0" unique-identifier="bookid" xml:lang="${escapeAttribute(m.language)}"`;
  const metadataNs = version === '2.0.1'
    ? 'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf"'
    : 'xmlns:dc="http://purl.org/dc/elements/1.1/"';
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" ${packageAttrs}>
<metadata ${metadataNs}>
${dc.join('\n')}
</metadata>
<manifest>
${manifest.join('\n')}
</manifest>
<spine toc="ncx"${ppd}>
${spine.join('\n')}
</spine>
</package>
`;
}

function ncxDocument(book: Book, toc: TocEntry[]): string {
  // 同じ行き先の navPoint は同じ playOrder にする
  const order = new Map<string, number>();
  const assign = (entries: TocEntry[]) => {
    for (const entry of entries) {
      if (!order.has(entry.href)) order.set(entry.href, order.size + 1);
      assign(entry.children);
    }
  };
  assign(toc);
  let counter = 0;
  const render = (entries: TocEntry[], indent: string): string =>
    entries.map((entry) => {
      const id = `np-${++counter}`;
      const children = entry.children.length > 0 ? `\n${render(entry.children, `${indent}  `)}` : '';
      return `${indent}<navPoint id="${id}" playOrder="${order.get(entry.href)}">
${indent}  <navLabel><text>${escapeText(entry.title)}</text></navLabel>
${indent}  <content src="${entry.href}"/>${children}
${indent}</navPoint>`;
    }).join('\n');
  const m = book.metadata;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd">
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="${escapeAttribute(m.language)}">
<head>
<meta name="dtb:uid" content="${escapeAttribute(m.identifier)}"/>
<meta name="dtb:depth" content="${depth(toc)}"/>
<meta name="dtb:totalPageCount" content="0"/>
<meta name="dtb:maxPageNumber" content="0"/>
</head>
<docTitle><text>${escapeText(m.title)}</text></docTitle>
<navMap>
${render(toc, '')}
</navMap>
</ncx>
`;
}

function navDocument(book: Book, toc: TocEntry[]): string {
  const render = (entries: TocEntry[]): string =>
    `<ol>\n${
      entries.map((entry) => {
        const children = entry.children.length > 0 ? `\n${render(entry.children)}\n` : '';
        return `<li><a href="${entry.href}">${escapeText(entry.title)}</a>${children}</li>`;
      }).join('\n')
    }\n</ol>`;
  const lang = escapeAttribute(book.metadata.language);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}">
<head>
<title>${escapeText(book.metadata.title)}</title>
</head>
<body>
<nav epub:type="toc" id="toc">
${render(toc)}
</nav>
</body>
</html>
`;
}

const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles>
<rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
</rootfiles>
</container>
`;

/** 本を表す値から EPUB のファイルの中身を作る（ADR 0004） */
export async function buildEpub(book: Book, options: BuildOptions): Promise<Uint8Array> {
  validateBook(book, options);
  const { version } = options;
  const modified = book.metadata.modified ?? new Date();
  const { documents, toc } = collect(book);
  const imageIds = new Map((book.images ?? []).map((image, i) => [image.path, `img-${i + 1}`]));
  const stylesheetIds = new Map((book.stylesheets ?? []).map((s, i) => [s.path, `css-${i + 1}`]));
  const encoder = new TextEncoder();
  const text = (name: string, content: string): ZipEntry => ({ name: `OEBPS/${name}`, data: encoder.encode(content) });

  const entries: ZipEntry[] = [
    { name: 'mimetype', data: encoder.encode('application/epub+zip'), store: true },
    { name: 'META-INF/container.xml', data: encoder.encode(CONTAINER) },
    text('content.opf', packageDocument(book, version, documents, imageIds, stylesheetIds, modified)),
    text('toc.ncx', ncxDocument(book, toc)),
  ];
  if (version === '3.0') entries.push(text('nav.xhtml', navDocument(book, toc)));
  for (const doc of documents) entries.push(text(doc.path, wrapDocument(doc, book, version)));
  for (const stylesheet of book.stylesheets ?? []) entries.push(text(stylesheet.path, stylesheet.content));
  for (const image of book.images ?? []) entries.push({ name: `OEBPS/${image.path}`, data: image.data });
  return await writeZip(entries, modified);
}
