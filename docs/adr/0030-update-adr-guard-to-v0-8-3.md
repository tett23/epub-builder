# ADR 0030: adr-guard を v0.8.3 に上げ、ステータス「採択（未実装）」を使えるようにする

ステータス: 採択

## 文脈

[ADR 0027](0027-update-adr-guard-to-v0-8-2.md) で、adr-guard を v0.8.2 に上げた。
その後、tett23/adr-guard は v0.8.3 になった。このリポジトリに関わる変更は次のとおり（tett23/adr-guard の [ADR 0016: 採択（未実装）のステータス](https://github.com/tett23/adr-guard/blob/main/docs/adr/0016-accepted-not-implemented-status.md)、[リリース](https://github.com/tett23/adr-guard/releases/tag/v0.8.3)）。

- 新しいステータス `採択（未実装）`（英語は `Accepted (not implemented)`。括弧は全角でも半角でもよい）。採択されたが、まだ実装されていない ADR を表す
- 新しいサブコマンド `adr-guard unimplemented [--status]`。ステータスが `採択（未実装）` の ADR を一覧する

ユーザーの全体の規則でも、ADR のステータスの候補に `採択（未実装）` が加わった。
このリポジトリでは、`test/adr.test.ts` がステータスの行の書き方を検査しており、いまは `採択（未実装）` を拒否する。

手元の adr-guard はすでに v0.8.3 である。

## 実装すること

- ADR のステータスの候補に `採択（未実装）` を加える。採択されたが、まだ実装されていない ADR に使う。実装を終えたら `採択` に変える。このリポジトリでは、括弧は全角だけとし、ほかのステータスと同じく日本語だけを使う
- `test/adr.test.ts` のステータスの行の書き方に `採択（未実装）` を加える
- `.github/workflows/ci.yml` の `adr` ジョブの action を `uses: tett23/adr-guard@v0.8.3` にする。ほかの入力（`base`、`head`、`allow-status: true`、`allow-links: true`、`links: true`、`check-status: true`）はそのまま。コメントの ADR 番号に ADR 0030 を加える
- `.githooks/pre-commit` のコマンド（`exec adr-guard pre-commit --allow-status --allow-links`）は変えない。コメントの ADR 番号に ADR 0030 を加える
- `README.md` の adr-guard のインストール手順のタグと action の版を v0.8.3 にする。ADR の一覧にこの ADR を加える
- `docs/specifications.md` と `CLAUDE.md` の adr-guard の版と、ステータスの候補の記述を、この ADR に合わせる。`adr-guard unimplemented` で未実装の ADR を一覧できることを書く。仕様書の ADR の一覧にこの ADR を加える
- [ADR 0027](0027-update-adr-guard-to-v0-8-2.md) のステータスを `採択→adr-guard のバージョンは[ADR 0030](0030-update-adr-guard-to-v0-8-3.md)` にする
- `adr-guard links --fix --include-committed` を実行し、`adr-guard links` と `adr-guard check-status` が終了コード 0 で終わるようにする

## 実装しないこと

- `.claude/settings.json` の hook の変更。v0.8.3 でも `adr-guard claude-hook --allow-status` のままでよい
- action のほかの入力と、pre-commit hook のコマンドの変更
- 半角の括弧の `採択(未実装)` と、英語のステータス（`Accepted (not implemented)` など）の受けつけ。adr-guard は受けつけるが、このリポジトリの書き方は全角の日本語にそろえる
- CI で `adr-guard unimplemented` を実行すること。未実装の ADR があっても CI は失敗させない
- 手元の adr-guard の更新の自動化

## テスト設計

- `test/adr.test.ts` の「ステータスの行の書き方を判定する」に、次を先に足し、実装の前に失敗することを確かめる
  - 受けつける：`ステータス: 採択（未実装）`
  - 拒否する：`ステータス: 採択(未実装)`、`ステータス: 採択（未実装）→ADR 0020`、`ステータス: 未実装`
- `deno task test`（この ADR のファイル名、見出し、ステータスの行、節の並びと、[ADR 0027](0027-update-adr-guard-to-v0-8-2.md) の新しいステータスの行が決めた書き方であること）、`deno fmt --check`、`deno lint` が通ること
- `adr-guard links` と `adr-guard check-status` が終了コード 0 で終わること
- 手元の adr-guard（v0.8.3）で、変更をステージして `.githooks/pre-commit` が通ること
- コミット後、`adr-guard check-range origin/main HEAD --allow-status --allow-links` が終了コード 0 で終わること
- `.github/workflows/ci.yml` が YAML として読めること
- 変更のプルリクエストの CI で、`adr` ジョブが v0.8.3 の action で実行され、成功すること

## トレードオフ

- ステータスで、採択と実装の済んだことを分けて表せる。`adr-guard unimplemented` で、実装の残る ADR を一覧できる。その代わり、実装を終えたときにステータスを `採択` に変える手間が増え、変え忘れると一覧が実態と食い違う
- adr-guard が受けつける書き方（半角の括弧、英語）の一部を、このリポジトリのテストは拒否する。書き方はそろうが、adr-guard だけでは検出されない
- 手元の adr-guard が v0.8.2 のままだと、`adr-guard unimplemented` を使えない。README のインストール手順のタグを v0.8.3 に上げて補う

## 参考文献

- tett23/adr-guard [ADR 0016: 採択（未実装）のステータス](https://github.com/tett23/adr-guard/blob/main/docs/adr/0016-accepted-not-implemented-status.md)
- tett23/adr-guard [リリース v0.8.3](https://github.com/tett23/adr-guard/releases/tag/v0.8.3)
- tett23/adr-guard の [README](https://github.com/tett23/adr-guard/blob/main/README.md)（ステータスの値と `adr-guard unimplemented`）
