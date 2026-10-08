# epub-builder

EPUB 2.0.1 と EPUB 3.0 のファイルを作る TypeScript のライブラリ。Deno で動く。

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
epub-builder build my-book -e all
```

| コマンド         | 働き                                                               |
| ---------------- | ------------------------------------------------------------------ |
| `build [dir]`    | EPUB を作る（`-e 2.0.1\|3.0\|all`、`-o <path>`、`--strict`、`-q`） |
| `check [dir]`    | EPUB を書かずに、誤りと警告を調べる                                |
| `toc [dir]`      | 目次の木を表示する                                                 |
| `init [dir]`     | 新しい本の雛形を作る                                               |
| `help [command]` | 使い方を表示する                                                   |
| `version`        | 版を表示する                                                       |

インストールせずに `deno task cli build my-book` としても動く。

設計上の決定とその理由は [docs/adr/](docs/adr/) に記録している。

- 対応する仕様と出力の構成：[ADR 0003](docs/adr/0003-epub-2-0-1-and-3-0-output.md)
- 公開 API と zip の作り方：[ADR 0004](docs/adr/0004-public-api-and-zip-writer.md)
- 現在の仕様のまとめ：[docs/specifications.md](docs/specifications.md)
- ディレクトリから本を読む方法、本文の変換、ルビと脚注、ファイル名の空白、警告、節、部・章・節の意味づけ、landmarks、guide、扉、後付け：[ADR 0014](docs/adr/0014-back-matter.md)
- コマンドライン：[ADR 0016](docs/adr/0016-command-line-interface.md)

## 開発

Deno が必要。

```bash
deno task check   # 型検査
deno task lint
deno task fmt
deno task test
```

clone した後に一度、コミット済み ADR の変更を拒否する git の hook を有効にする。

```bash
git config core.hooksPath .githooks
```

コミット済みの ADR は、ステータス行以外を変更できない([ADR 0002](docs/adr/0002-immutable-adrs.md))。

## ライセンス

[MIT](LICENSE)
