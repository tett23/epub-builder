// EPUB の構成を作る（ADR 0019、ADR 0004）

import { type Book, type BuildOptions, type Chapter, epubInputError, type EpubVersion, type Section } from './types.ts';
import { encodePath, escapeAttribute, escapeText, hasInvalidXmlChar } from './xml.ts';
import { writeZip, type ZipEntry } from './zip.ts';

const IMAGE_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/svg+xml']);
const RESERVED_PATHS = new Set(['content.opf', 'toc.ncx', 'nav.xhtml']);
const TEXT_DIR = 'text';

/** 組み方向に合う頁送りの向き（ADR 0019） */
export const WRITING_MODE_DIRECTIONS: Record<string, 'ltr' | 'rtl'> = {
  'horizontal-lr': 'ltr',
  'horizontal-rl': 'rtl',
  'vertical-lr': 'ltr',
  'vertical-rl': 'rtl',
};

interface ContentDocument {
  /** `OEBPS/` からの相対パス */
  path: string;
  id: string;
  title: string;
  body: string;
  stylesheets: string[];
  epubType?: string;
}

interface TocEntry {
  title: string;
  href: string;
  children: TocEntry[];
}

/** 内容文書のファイルの名前を、読み順の番号から作る（ADR 0019） */
export function contentDocumentName(index: number, count: number): string {
  return `${String(index + 1).padStart(Math.max(4, String(count).length), '0')}.xhtml`;
}

/** 本の値の誤りを調べ、誤りがあれば例外とする */
export function validateBook(book: Book, options: BuildOptions): void {
  if (options.version !== '2.0.1' && options.version !== '3.0') {
    throw epubInputError(`知らない版: ${String(options.version)}`);
  }
  const { metadata } = book;
  for (const key of ['identifier', 'title', 'language'] as const) {
    if (typeof metadata[key] !== 'string' || metadata[key].trim() === '') {
      throw epubInputError(`書誌情報の ${key} がない`);
    }
  }
  for (const author of metadata.authors ?? []) {
    if (typeof author !== 'string' || author.trim() === '') throw epubInputError('空の著者がある');
  }
  if (metadata.modified !== undefined && Number.isNaN(metadata.modified.getTime())) {
    throw epubInputError('書誌情報の modified が正しい日時でない');
  }
  const strings = [metadata.identifier, metadata.title, metadata.language, metadata.publisher, metadata.description];
  for (const value of [...strings, ...(metadata.authors ?? [])]) {
    if (value !== undefined && hasInvalidXmlChar(value)) {
      throw epubInputError(`書誌情報に XML で使えない文字がある: ${JSON.stringify(value)}`);
    }
  }
  if (
    book.pageProgressionDirection !== undefined && book.pageProgressionDirection !== 'ltr' &&
    book.pageProgressionDirection !== 'rtl'
  ) {
    throw epubInputError(`知らない頁送りの向き: ${book.pageProgressionDirection}`);
  }
  const pwm = metadata.primaryWritingMode;
  if (pwm !== undefined) {
    const direction = WRITING_MODE_DIRECTIONS[pwm];
    if (direction === undefined) throw epubInputError(`知らない組み方向: ${String(pwm)}`);
    if (book.pageProgressionDirection !== undefined && book.pageProgressionDirection !== direction) {
      throw epubInputError(`組み方向 ${pwm} と頁送りの向き ${book.pageProgressionDirection} が食い違う`);
    }
  }

  const seen = new Map<string, string>();
  const checkPath = (path: string) => {
    const segments = path.split('/');
    if (
      path === '' || path.startsWith('/') || path.includes('\\') ||
      segments.some((s) => s === '' || s === '.' || s === '..') || hasInvalidXmlChar(path)
    ) {
      throw epubInputError(`正しくないパス: ${JSON.stringify(path)}`);
    }
    if (RESERVED_PATHS.has(path) || segments[0] === TEXT_DIR) {
      throw epubInputError(`ライブラリが使うパスと重なる: ${path}`);
    }
    const key = path.normalize('NFC').toLowerCase();
    const other = seen.get(key);
    if (other !== undefined) throw epubInputError(`パスが重なる: ${other} と ${path}`);
    seen.set(key, path);
  };
  for (const stylesheet of book.stylesheets ?? []) checkPath(stylesheet.path);
  for (const image of book.images ?? []) {
    checkPath(image.path);
    if (!IMAGE_MEDIA_TYPES.has(image.mediaType)) {
      throw epubInputError(`知らないメディアタイプ: ${image.mediaType}（${image.path}）`);
    }
  }
  if (book.coverImage !== undefined && !(book.images ?? []).some((image) => image.path === book.coverImage)) {
    throw epubInputError(`表紙の画像がない: ${book.coverImage}`);
  }

  const stylesheetPaths = new Set((book.stylesheets ?? []).map((s) => s.path));
  const checkStylesheets = (paths: string[] | undefined) => {
    for (const path of paths ?? []) {
      if (!stylesheetPaths.has(path)) throw epubInputError(`スタイルシートがない: ${path}`);
    }
  };
  checkStylesheets(book.cover?.stylesheets);
  checkStylesheets(book.titlepage?.stylesheets);
  const checkEpubType = (epubType: string | undefined) => {
    if (epubType === undefined) return;
    if (typeof epubType !== 'string' || epubType.trim() === '' || hasInvalidXmlChar(epubType)) {
      throw epubInputError(`正しくない epubType: ${JSON.stringify(epubType)}`);
    }
  };
  checkEpubType(book.cover?.epubType);
  checkEpubType(book.titlepage?.epubType);
  if (book.chapters.length === 0) throw epubInputError('本文の章がない');
  const checkChapter = (chapter: Chapter) => {
    if (typeof chapter.title !== 'string' || chapter.title.trim() === '') {
      throw epubInputError('題名のない章がある');
    }
    if (hasInvalidXmlChar(chapter.title)) {
      throw epubInputError(`章の題名に XML で使えない文字がある: ${JSON.stringify(chapter.title)}`);
    }
    if (chapter.body === undefined && (chapter.children ?? []).length === 0) {
      throw epubInputError(`本文も子もない章がある: ${chapter.title}`);
    }
    checkStylesheets(chapter.stylesheets);
    checkEpubType(chapter.epubType);
    if ((chapter.sections ?? []).length > 0 && chapter.body === undefined) {
      throw epubInputError(`本文のない章に節がある: ${chapter.title}`);
    }
    const checkSection = (section: Section) => {
      if (typeof section.title !== 'string' || section.title.trim() === '' || hasInvalidXmlChar(section.title)) {
        throw epubInputError(`正しくない節の題名がある: ${chapter.title}`);
      }
      if (typeof section.id !== 'string' || section.id === '' || /[\s#]/.test(section.id)) {
        throw epubInputError(`正しくない節の id: ${JSON.stringify(section.id)}（${chapter.title}）`);
      }
      if (!chapter.body!.includes(`id="${escapeAttribute(section.id)}"`)) {
        throw epubInputError(`節の id が本文にない: ${section.id}（${chapter.title}）`);
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
${doc.epubType !== undefined ? `<body epub:type="${escapeAttribute(doc.epubType.trim())}">` : '<body>'}
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
    pending.push({
      title: book.metadata.title,
      body: book.cover.body,
      stylesheets: book.cover.stylesheets ?? [],
      epubType: book.cover.epubType,
    });
  }
  if (book.titlepage) {
    pending.push({
      title: book.metadata.title,
      body: book.titlepage.body,
      stylesheets: book.titlepage.stylesheets ?? [],
      epubType: book.titlepage.epubType,
    });
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
      pending.push({
        title: chapter.title,
        body: chapter.body,
        stylesheets: chapter.stylesheets ?? [],
        epubType: chapter.epubType,
      });
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
  // 節を子の章より前に置く（ADR 0019）
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
  // Kindle の組み方向（ADR 0019）
  if (m.primaryWritingMode) dc.push(`<meta name="primary-writing-mode" content="${m.primaryWritingMode}"/>`);
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
${version === '2.0.1' ? guide(book, documents) : ''}</package>
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

/** epub:type の語の並びに、語が含まれるか */
function hasTerm(epubType: string | undefined, term: string): boolean {
  return (epubType ?? '').split(/\s+/).includes(term);
}

/** 後付けの語と、landmarks と guide での表示名と guide の型（ADR 0019）。この順で書く */
const BACK_MATTER: { term: string; ja: string; en: string; guideType: string }[] = [
  { term: 'afterword', ja: 'あとがき', en: 'Afterword', guideType: 'other.afterword' },
  { term: 'acknowledgments', ja: '謝辞', en: 'Acknowledgments', guideType: 'acknowledgements' },
  { term: 'appendix', ja: '付録', en: 'Appendix', guideType: 'other.appendix' },
  { term: 'bibliography', ja: '参考文献', en: 'Bibliography', guideType: 'bibliography' },
  { term: 'glossary', ja: '用語集', en: 'Glossary', guideType: 'glossary' },
  { term: 'index', ja: '索引', en: 'Index', guideType: 'index' },
  { term: 'copyright-page', ja: '著作権表示', en: 'Copyright', guideType: 'copyright-page' },
  { term: 'colophon', ja: '奥付', en: 'Colophon', guideType: 'colophon' },
];

interface NavigationItem {
  /** landmarks の epub:type */
  type: string;
  /** guide の type。guide に書かない項目は undefined */
  guideType?: string;
  doc: ContentDocument;
  label: string;
}

/** landmarks と guide が指す文書を、文書の役割から決める（ADR 0019） */
function navigation(book: Book, documents: ContentDocument[]): NavigationItem[] {
  const ja = /^ja(-|$)/i.test(book.metadata.language);
  const front = (book.cover ? 1 : 0) + (book.titlepage ? 1 : 0);
  const chapterDocs = documents.slice(front);
  const find = (term: string) => chapterDocs.find((d) => hasTerm(d.epubType, term));
  const items: NavigationItem[] = [];
  const add = (type: string, guideType: string | undefined, doc: ContentDocument | undefined, label: string) => {
    if (doc) items.push({ type, guideType, doc, label });
  };
  add('cover', 'cover', book.cover ? documents[0] : undefined, ja ? '表紙' : 'Cover');
  add('titlepage', 'title-page', book.titlepage ? documents[front - 1] : undefined, ja ? '扉' : 'Title Page');
  add('bodymatter', 'text', find('bodymatter') ?? chapterDocs[0], ja ? '本文' : 'Start of Content');
  add('backmatter', undefined, find('backmatter'), ja ? '後付け' : 'Back Matter');
  for (const back of BACK_MATTER) add(back.term, back.guideType, find(back.term), ja ? back.ja : back.en);
  return items;
}

/** landmarks の項目（EPUB 3.0）。toc は書かない。ナビゲーション文書は spine にないため、指すと EPUBCheck で誤り（RSC-011）になる */
function landmarks(book: Book, documents: ContentDocument[]): { type: string; href: string; label: string }[] {
  return navigation(book, documents).map((item) => ({ type: item.type, href: item.doc.path, label: item.label }));
}

/** guide の項目（EPUB 2.0.1）。toc は目次の XHTML の文書がないため書かない */
function guide(book: Book, documents: ContentDocument[]): string {
  const items = navigation(book, documents)
    .filter((item) => item.guideType !== undefined)
    .map((item) =>
      `<reference type="${item.guideType}" title="${escapeAttribute(item.label)}" href="${item.doc.path}"/>`
    );
  return items.length > 0 ? `<guide>\n${items.join('\n')}\n</guide>\n` : '';
}

function navDocument(book: Book, toc: TocEntry[], documents: ContentDocument[]): string {
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
<nav epub:type="landmarks" hidden="">
<ol>
${
    landmarks(book, documents)
      .map((item) => `<li><a epub:type="${item.type}" href="${item.href}">${escapeText(item.label)}</a></li>`)
      .join('\n')
  }
</ol>
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
  if (version === '3.0') entries.push(text('nav.xhtml', navDocument(book, toc, documents)));
  for (const doc of documents) entries.push(text(doc.path, wrapDocument(doc, book, version)));
  for (const stylesheet of book.stylesheets ?? []) entries.push(text(stylesheet.path, stylesheet.content));
  for (const image of book.images ?? []) entries.push({ name: `OEBPS/${image.path}`, data: image.data });
  return await writeZip(entries, modified);
}
