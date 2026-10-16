# epub-builder

EPUB 2.0.1、EPUB 3.0、EPUB 3.2 のファイルを作る TypeScript のライブラリ。Deno で動く。

| 版      | 向いている環境                                                       |
| ------- | -------------------------------------------------------------------- |
| `2.0.1` | EPUB 3 に対応しない古い端末やアプリ。ルビは括弧書きになる            |
| `3.0`   | EPUB 3 に対応する端末やアプリ。古いアプリのための目次（NCX）も入れる |
| `3.2`   | EPUB 3 に対応する新しい端末やアプリ。目次は EPUB 3 の形式だけにする  |

迷ったら、すべての版を作って読む環境で試す（CLI の既定）。

書誌情報、本文（XHTML）、スタイルシート、画像を渡すと、EPUB のファイル（zip）のバイト列を返す。
中核のモジュール（`mod.ts`）は実行時の依存を持たない。

決まった形に並べたディレクトリ（`book.toml`、`body/`、`meta/`、`assets/`）から本を読むこともできる（`load.ts`）。
本文は Markdown、XHTML、HTML で書け、Markdown ではルビと脚注を使える。

```ts
import { buildEpub } from './mod.ts';
import { loadBook } from './load.ts';

const book = await loadBook('path/to/project', { version: '3.0' });
await Deno.writeFile('book.epub', await buildEpub(book, { version: '3.0' }));
```

ディレクトリの例は [test/fixtures/sample-book/](test/fixtures/sample-book/) にある。

## コマンドライン

ディレクトリから、コードを書かずに EPUB を作れる。

```bash
deno task install
```

`deno install` で直接入れるときは、`deno.json` の依存を解決するために `--config deno.json` を付ける。

```bash
epub-builder init my-book
```

```bash
epub-builder build my-book
```

| コマンド         | 働き                                                                                                                                |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `build [dir]`    | EPUB を作る。既定で 2.0.1、3.0、3.2 のすべて。`-e 2.0.1`、`-e 3.0`、`-e 3.2` で一つの版だけ（ほかに `-o <path>`、`--strict`、`-q`） |
| `check [dir]`    | EPUB を書かずに、誤りと警告を調べる（既定ですべての版）                                                                             |
| `toc [dir]`      | 目次の木を表示する（既定ですべての版）                                                                                              |
| `init [dir]`     | 新しい本の雛形を作る                                                                                                                |
| `help [command]` | 使い方を表示する                                                                                                                    |
| `version`        | 版を表示する                                                                                                                        |

インストールせずに `deno task cli build my-book` としても動く。

設計上の決定とその理由は [docs/adr/](docs/adr/) に記録している。

- 公開 API と zip の作り方：[ADR 0004](docs/adr/0004-public-api-and-zip-writer.md)
- 現在の仕様のまとめ：[docs/specifications.md](docs/specifications.md)
- 対応する仕様と出力の構成、ディレクトリから本を読む方法、本文の変換、ルビと脚注、ファイル名の空白、警告、節、部・章・節の意味づけ、landmarks、guide、扉、後付け、Kindle の `primary-writing-mode`、EPUB 3.2、コマンドライン：[ADR 0024](docs/adr/0024-epub-3-2.md)
- ADR の運用と保護：[ADR 0020](docs/adr/0020-adr-workflow-and-adr-guard.md)
- adr-guard v0.8.0 への更新と、ADR の参照のリンク、ステータスの書き方、ステータスの行の検査、監査と計測の記録の保護：[ADR 0025](docs/adr/0025-update-adr-guard-to-v0-8-0.md)
- adr-guard v0.8.1 への更新と、ADR と記録のディレクトリの別名の保護：[ADR 0026](docs/adr/0026-update-adr-guard-to-v0-8-1.md)
- adr-guard v0.8.2 への更新と、コミット済み ADR のリンクだけの変更の許可：[ADR 0027](docs/adr/0027-update-adr-guard-to-v0-8-2.md)
- クラスを使わない（誤りと TOML の日時を値で表す）：[ADR 0021](docs/adr/0021-no-classes.md)
- 依存の再実装と、残す依存：[ADR 0023](docs/adr/0023-reimplement-hastscript.md)

## 開発

Deno が必要。

```bash
deno task check   # 型検査
deno task lint
deno task fmt
deno task test
```

コミット済みの ADR は、ステータスの行のほかを変更できない（[ADR 0020](docs/adr/0020-adr-workflow-and-adr-guard.md)）。
これを [tett23/adr-guard](https://github.com/tett23/adr-guard) で強制する。git の pre-commit hook と Claude Code の hook で使うため、adr-guard を入れる。

```bash
cargo install --git https://github.com/tett23/adr-guard --tag v0.8.2
```

リリースのバイナリを使う手順は adr-guard の README にある。
clone した後に一度、git の hook を有効にする。

```bash
git config core.hooksPath .githooks
```

ステータスの行の変更と、リンクだけの変更（リンク先の変更、リンクの追加と削除。リンクのテキストの変更は含まない）は、pre-commit hook と CI の `--allow-status`、`--allow-links`（Claude Code の hook は `adr-guard claude-hook --allow-status`）で許可する（[ADR 0025](docs/adr/0025-update-adr-guard-to-v0-8-0.md)、[ADR 0027](docs/adr/0027-update-adr-guard-to-v0-8-2.md)）。
CI でも、push と pull request のすべてのコミットを adr-guard（`tett23/adr-guard@v0.8.2`）で検査する。

文書（`.md`）の中の ADR の参照（`ADR 0001` の形）には、ADR のファイルへのリンクが要る。リンクが無いと、pre-commit hook と CI でエラーになる。`adr-guard links --fix` で付けられる。

ADR は、行頭が `ステータス:` のステータスの行をちょうど 1 つ持たねばならない。無い ADR と 2 つ以上ある ADR は、pre-commit hook と CI（`adr-guard check-status`）でエラーになる。
監査や計測の記録（`docs/audit/`、`docs/audits/`、`docs/benchmarks/`、`docs/benchmark/` 以下のすべてのファイル）も、コミット済みのものは変更、削除、移動できない。直すときは新しい記録を作る（[ADR 0025](docs/adr/0025-update-adr-guard-to-v0-8-0.md)、[ADR 0026](docs/adr/0026-update-adr-guard-to-v0-8-1.md)）。

## ライセンス

[MIT](LICENSE)
