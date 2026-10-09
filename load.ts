/**
 * 決まった形に並べたディレクトリから、`buildEpub` に渡す本を読む（ADR 0019）。
 *
 * 中核のモジュール（`./mod.ts`）と違い、Markdown と HTML の解析に unified 系のライブラリを使う。
 *
 * @module
 */

export { loadBook, type LoadOptions, type LoadWarning } from './src/load/load-book.ts';
export {
  parseToml,
  TomlDateTime,
  type TomlDateTimeKind,
  TomlError,
  type TomlTable,
  type TomlValue,
} from './src/load/toml.ts';
