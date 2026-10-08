# epub-builder

EPUB 2.0.1 と EPUB 3.0 のファイルを作る TypeScript のライブラリ。Deno で動く。

書誌情報、本文（XHTML）、スタイルシート、画像を渡すと、EPUB のファイル（zip）のバイト列を返す。
実行時の依存は持たない。

まだ実装していない。設計上の決定とその理由は [docs/adr/](docs/adr/) に記録している。

- 対応する仕様と出力の構成：[ADR 0003](docs/adr/0003-epub-2-0-1-and-3-0-output.md)
- 公開 API と zip の作り方：[ADR 0004](docs/adr/0004-public-api-and-zip-writer.md)

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
