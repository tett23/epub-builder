# ADR 0031: adr-guard を v0.10.0 に上げ、ADR の番号の重複と修飾子付きの参照を検査する

ステータス: 採択

## 文脈

[ADR 0030](0030-update-adr-guard-to-v0-8-3.md) で、adr-guard を v0.8.3 に上げた。
その後、tett23/adr-guard は v0.9.0、v0.9.1、v0.10.0 になった。このリポジトリに関わる変更は次のとおり（[リリース v0.9.0](https://github.com/tett23/adr-guard/releases/tag/v0.9.0)、[リリース v0.9.1](https://github.com/tett23/adr-guard/releases/tag/v0.9.1)、[リリース v0.10.0](https://github.com/tett23/adr-guard/releases/tag/v0.10.0)）。

- v0.9.0：新しいサブコマンド `adr-guard check-numbers`。同じディレクトリで番号が重複した ADR を報告する。action は既定でこれを実行し（入力 `check-numbers`）、重複があると CI が失敗する。重複を直す `adr-guard renumber [--dry-run]` と、番号の付け替えを許す `--allow-renumber`（`pre-commit` と `check-range`。action の入力 `allow-renumber`、既定は false）も加わった（tett23/adr-guard の [ADR 0018: 重複したADRの番号の修復](https://github.com/tett23/adr-guard/blob/main/docs/adr/0018-repair-duplicate-adr-numbers.md)）
- v0.9.1：`renumber` の誤報の修正
- v0.10.0：修飾子付きの ADR の参照。`ADR NNNN` の直前の語（空白 1 つ）が修飾子になる。`/` を含む語はディレクトリ、`-` を含む語はモジュール（`docs/<モジュール>/adr/`）、それ以外の語はそのモジュールが存在するときだけ修飾子とする。修飾子はリンクのテキストに含める。`links` と pre-commit は、ディレクトリや ADR が存在しない修飾子付きの参照、リンク先が修飾子の ADR と異なるリンク、リンクの外に出た修飾子を報告し、`links --fix` で直せるものは直す。シンボリックリンクの `.md` は検査しない（tett23/adr-guard の [ADR 0019: モジュールで修飾したADRの参照](https://github.com/tett23/adr-guard/blob/main/docs/adr/0019-module-qualified-adr-references.md)、[ADR 0020: シンボリックリンクの文書を飛ばす](https://github.com/tett23/adr-guard/blob/main/docs/adr/0020-skip-symlinked-documents.md)）

このリポジトリの ADR は `docs/adr/` だけにあり、モジュールの ADR は無い。
手元の adr-guard はすでに v0.10.0 である。v0.10.0 で `adr-guard links --fix --include-committed` を実行しても、書きかわる文書は無く、`adr-guard links`、`adr-guard check-status`、`adr-guard check-numbers` は終了コード 0 で終わる。

## 実装すること

- `.github/workflows/ci.yml` の `adr` ジョブの action を `uses: tett23/adr-guard@v0.10.0` にする。ほかの入力（`base`、`head`、`allow-status: true`、`allow-links: true`、`links: true`、`check-status: true`）はそのまま。`check-numbers` は action の既定（実行する）に任せる。コメントの ADR 番号にこの ADR を加える
- `.githooks/pre-commit` のコマンド（`exec adr-guard pre-commit --allow-status --allow-links`）は変えない。コメントの ADR 番号にこの ADR を加える
- `README.md` の adr-guard のインストール手順のタグと action の版を v0.10.0 にする。CI が ADR の番号の重複も検査すること（`adr-guard check-numbers`）と、修飾子付きの参照の規則を書く。ADR の一覧にこの ADR を加える
- `docs/specifications.md` と `CLAUDE.md` の adr-guard の版と、検査の記述を、この ADR に合わせる。仕様書の ADR の一覧にこの ADR を加える
- [ADR 0030](0030-update-adr-guard-to-v0-8-3.md) のステータスを `採択→adr-guard のバージョンは[ADR 0031](0031-update-adr-guard-to-v0-10-0.md)` にする
- `adr-guard links --fix --include-committed` を実行し、`adr-guard links`、`adr-guard check-status`、`adr-guard check-numbers` が終了コード 0 で終わるようにする

## 実装しないこと

- `.claude/settings.json` の hook の変更。v0.10.0 でも `adr-guard claude-hook --allow-status` のままでよい
- `--allow-renumber` と action の入力 `allow-renumber` の有効化。番号の付け替えは、要るときに ADR で決める
- action の `check-numbers` を無効にすること
- モジュールの ADR のディレクトリを作ること
- 手元の adr-guard の更新の自動化

## テスト設計

- `deno task test`（この ADR のファイル名、見出し、ステータスの行、節の並びと、[ADR 0030](0030-update-adr-guard-to-v0-8-3.md) の新しいステータスの行が決めた書き方であること）、`deno fmt --check`、`deno lint` が通ること
- `adr-guard links`、`adr-guard check-status`、`adr-guard check-numbers` が終了コード 0 で終わること
- 手元の adr-guard（v0.10.0）で、変更をステージして `.githooks/pre-commit` が通ること
- コミット後、`adr-guard check-range origin/main HEAD --allow-status --allow-links` が終了コード 0 で終わること
- `.github/workflows/ci.yml` が YAML として読めること
- 変更のプルリクエストの CI で、`adr` ジョブが v0.10.0 の action で実行され、成功すること

## トレードオフ

- ブランチを並行して ADR を足したときの番号の重複を、CI で検出できる。その代わり、重複したブランチは、マージの前に番号を付け替える手間が要る
- 修飾子付きの参照の検査で、ほかのリポジトリやモジュールの ADR を指す参照の誤りも検出できる。その代わり、ほかのリポジトリの ADR を `<リポジトリ> ADR NNNN` の形で書くと、存在しない修飾子として報告される。ほかのリポジトリの ADR は、リンクのテキストごと外部リンクにして書く
- 手元の adr-guard が v0.10.0 より古いと、`adr-guard check-numbers` を使えず、手元と CI で結果が食い違う。README のインストール手順のタグを v0.10.0 に上げて補う

## 参考文献

- tett23/adr-guard [ADR 0018: 重複したADRの番号の修復](https://github.com/tett23/adr-guard/blob/main/docs/adr/0018-repair-duplicate-adr-numbers.md)
- tett23/adr-guard [ADR 0019: モジュールで修飾したADRの参照](https://github.com/tett23/adr-guard/blob/main/docs/adr/0019-module-qualified-adr-references.md)
- tett23/adr-guard [ADR 0020: シンボリックリンクの文書を飛ばす](https://github.com/tett23/adr-guard/blob/main/docs/adr/0020-skip-symlinked-documents.md)
- tett23/adr-guard [リリース v0.9.0](https://github.com/tett23/adr-guard/releases/tag/v0.9.0)、[リリース v0.9.1](https://github.com/tett23/adr-guard/releases/tag/v0.9.1)、[リリース v0.10.0](https://github.com/tett23/adr-guard/releases/tag/v0.10.0)
- tett23/adr-guard の [README](https://github.com/tett23/adr-guard/blob/main/README.md)（`check-numbers`、`renumber`、修飾子付きの参照）
