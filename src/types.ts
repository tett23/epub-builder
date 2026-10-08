/** 出す EPUB の版（ADR 0003） */
export type EpubVersion = '2.0.1' | '3.0';

/** 頁送りの向き */
export type PageProgressionDirection = 'ltr' | 'rtl';

/** 扱う画像のメディアタイプ（ADR 0003） */
export type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/svg+xml';

export interface Metadata {
  identifier: string;
  title: string;
  language: string;
  authors?: string[];
  publisher?: string;
  description?: string;
  /** EPUB 3.0 の `dcterms:modified` に使う。省略したら呼んだ時刻 */
  modified?: Date;
}

export interface Stylesheet {
  /** `OEBPS/` からの相対パス */
  path: string;
  content: string;
}

export interface Image {
  /** `OEBPS/` からの相対パス */
  path: string;
  mediaType: ImageMediaType;
  data: Uint8Array;
}

/** 本文の文書。`body` は XHTML の `body` の中身 */
export interface Document {
  body: string;
  /** EPUB 3.0 の body の epub:type（空白で区切った語の並び）。EPUB 2.0.1 では書かない（ADR 0011） */
  epubType?: string;
  /** 適用するスタイルシートのパス。`Book.stylesheets` のいずれか */
  stylesheets?: string[];
}

/**
 * 本文の章。目次の一つの項目になる。
 * `body` を省くと文書を持たない項目になり、行き先は最初の子の文書になる（ADR 0009）。
 */
export interface Chapter {
  title: string;
  body?: string;
  /** EPUB 3.0 の body の epub:type（空白で区切った語の並び）。EPUB 2.0.1 では書かない（ADR 0011） */
  epubType?: string;
  stylesheets?: string[];
  /** 本文の中の節。目次では、章の項目の下に `children` より前に置く（ADR 0009） */
  sections?: Section[];
  children?: Chapter[];
}

/** 章の本文の中の節。目次の項目になり、`<章の文書>#<id>` を指す（ADR 0009） */
export interface Section {
  title: string;
  /** 章の本文の中の、節の見出しの id */
  id: string;
  children?: Section[];
}

export interface Book {
  metadata: Metadata;
  pageProgressionDirection?: PageProgressionDirection;
  stylesheets?: Stylesheet[];
  images?: Image[];
  /** 表紙の画像のパス。`images` のいずれか */
  coverImage?: string;
  /** 表紙の文書。読み順の最初に置き、目次には入れない */
  cover?: Document;
  chapters: Chapter[];
}

export interface BuildOptions {
  version: EpubVersion;
}

/** 入力の誤り */
export class EpubInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EpubInputError';
  }
}
