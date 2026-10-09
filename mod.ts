/**
 * EPUB 2.0.1 と EPUB 3.0 のファイルを作る。外部の依存を持たない（ADR 0004）。
 *
 * ディレクトリから本を読むには `./load.ts` の `loadBook` を使う（ADR 0019）。
 *
 * @module
 */

export { buildEpub } from './src/epub.ts';
export * from './src/types.ts';
