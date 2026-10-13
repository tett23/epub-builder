# ADR 0026: adr-guard を v0.8.1 に上げ、ADR と記録のディレクトリの別名も保護する

ステータス: 採択

## 文脈

[ADR 0025](0025-update-adr-guard-to-v0-8-0.md) で、adr-guard を v0.8.0 に上げた。
その後、tett23/adr-guard は v0.8.1 になった。このリポジトリに関わる変更は次のとおり（tett23/adr-guard の [ADR 0014](https://github.com/tett23/adr-guard/blob/main/docs/adr/0014-directory-name-variants.md)、[リリース](https://github.com/tett23/adr-guard/releases/tag/v0.8.1)）。

- ADR のディレクトリとして、`adr` のほか `adrs`、`decisions`、`decision` も保護する。ステータスの行の検査とリンクの検査もかかる
- 記録のディレクトリとして、`docs/audit/`、`docs/benchmarks/` のほか `docs/audits/`、`docs/benchmark/` も保護する

このリポジトリには、新しく保護される名前のディレクトリ（`adrs`、`decisions`、`decision`、`audits`、`benchmark`）はない。追跡しているファイルにも、追跡していないディレクトリにもない。
ADR は `docs/adr/` だけで、記録は置いていない。保護の対象が増えても、いまの作業は変わらない。

手元の adr-guard はすでに v0.8.1 である。

## 実装すること

- `.github/workflows/ci.yml` の `adr` ジョブの action を `uses: tett23/adr-guard@v0.8.1` にする。ほかの入力（`base`、`head`、`allow-status: true`、`allow-links: true`）はそのまま。記録のディレクトリに触れるコメントに `docs/audits`、`docs/benchmark` を加え、ADR 番号に ADR 0026 を加える
- `.githooks/pre-commit` のコマンド（`exec adr-guard pre-commit --allow-status --allow-links`）は変えない。コメントの記録のディレクトリに `docs/audits`、`docs/benchmark` を加え、ADR 番号に ADR 0026 を加える
- `README.md` の adr-guard のインストール手順のタグと action の版を v0.8.1 にし、保護される記録のディレクトリに `docs/audits/` と `docs/benchmark/` を加える。ADR の一覧にこの ADR を加える
- `docs/specifications.md` と CLAUDE.md の adr-guard の版と、保護される記録のディレクトリの記述を、この ADR に合わせる。仕様書の ADR の一覧にこの ADR を加える
- [ADR 0025](0025-update-adr-guard-to-v0-8-0.md) のステータスを `採択→adr-guard のバージョンは[ADR 0026](0026-update-adr-guard-to-v0-8-1.md)` にする

## 実装しないこと

- `.claude/settings.json` の hook の変更。v0.8.1 でも `adr-guard claude-hook --allow-status` のままでよい
- action のほかの入力と、pre-commit hook のコマンドの変更
- ADR のディレクトリの別名（`adrs`、`decisions`、`decision`）の採用。このリポジトリの ADR は `docs/adr/` だけに置く
- `docs/audit/`、`docs/audits/`、`docs/benchmarks/`、`docs/benchmark/` の新設。記録を置くときに、v0.8.1 の保護がそのまま効く
- 手元の adr-guard の更新の自動化

## テスト設計

- `adr-guard links` と `adr-guard check-status` が終了コード 0 で終わること
- `deno task test`（`test/adr.test.ts` で、この ADR のファイル名、見出し、ステータスの行と、[ADR 0025](0025-update-adr-guard-to-v0-8-0.md) の新しいステータスの行が決めた書き方であること）、`deno fmt --check`、`deno lint` が通ること
- 手元の adr-guard（v0.8.1）で、変更をステージして `.githooks/pre-commit` が通ること（コミットはしない）
- `.github/workflows/ci.yml` が YAML として読めること
- 変更のプルリクエストの CI で、`adr` ジョブが v0.8.1 の action で実行され、成功すること

## トレードオフ

- 手元の adr-guard が v0.8.0 のままだと、`docs/audits/` と `docs/benchmark/` の記録は手元では保護されず、CI で初めて違反に気づく。README のインストール手順のタグを v0.8.1 に上げて補う
- `adrs`、`decisions`、`decision`、`audits`、`benchmark` の名前のディレクトリを、ADR や記録のほかの目的で `docs/` などに作れなくなる（作ると保護や検査の対象になる）。いまはそのようなディレクトリはない
