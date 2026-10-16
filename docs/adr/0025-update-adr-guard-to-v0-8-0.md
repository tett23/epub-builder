# ADR 0025: adr-guard を v0.8.0 に上げ、ステータスの行の変更とリンクの付与を許可し、ADR の参照をリンクにする

ステータス: 採択→adr-guard のバージョンは[ADR 0026](0026-update-adr-guard-to-v0-8-1.md)、ステータスの書き方は[ADR 0028](0028-align-adr-format-with-global-policy.md)

## 文脈

[ADR 0020](0020-adr-workflow-and-adr-guard.md) で、コミット済みの ADR の保護に tett23/adr-guard（v0.1.0）を使うとした。
git の pre-commit hook は `exec adr-guard pre-commit`、Claude Code の hook（`.claude/settings.json`）は `adr-guard claude-hook`、CI は `tett23/adr-guard@v0.1.0` の composite action である。

その後、tett23/adr-guard は v0.8.0 まで更新された。このリポジトリに関わる変更は次のとおり。

- v0.4.0 から、文書（`.md`）の中の ADR の参照（`ADR 0001` の形）に、ADR のファイルへのリンクを求める（`adr-guard links`、tett23/adr-guard の [ADR 0009](https://github.com/tett23/adr-guard/blob/main/docs/adr/0009-require-links-for-adr-references.md)）。`adr-guard links --fix` でリンクを付けられる。コミット済みの ADR にリンクを付けるだけの変更は、`--allow-links` を付けたときだけ許可する
- v0.5.0 から、コミット済みの ADR のステータスの行の変更も、`--allow-status` を付けたときだけ許可する（tett23/adr-guard の [ADR 0010](https://github.com/tett23/adr-guard/blob/main/docs/adr/0010-allow-status-option.md)）
- v0.5.0 から、action は `check-range` の後に作業ツリーで `adr-guard links` を実行する。入力 `allow-status`、`allow-links` で `check-range` にオプションを付ける
- v0.6.0 から、どの深さの `docs/adr/`、`docs/<モジュール>/adr/` も保護の対象になる（tett23/adr-guard の [ADR 0011](https://github.com/tett23/adr-guard/blob/main/docs/adr/0011-nested-adr-directories.md)）。このリポジトリの ADR は `docs/adr/` だけなので、影響はない
- v0.7.0 から、ADR は行頭が `ステータス:` か `Status:` のステータスの行を、ちょうど 1 つ持たねばならない。無い ADR と 2 つ以上ある ADR は、pre-commit hook と `adr-guard check-status` で違反になる。action も既定で `check-status` を実行する（入力 `check-status: false` で止められる）。`--allow-status` を付けると、ステータスの行が無かった ADR への 1 行の追加も許可される（tett23/adr-guard の [ADR 0012](https://github.com/tett23/adr-guard/blob/main/docs/adr/0012-status-line-and-status-adt.md)）
- v0.8.0 から、どの深さの `docs/` でも、`docs/audit/` と `docs/benchmarks/` のコミット済みのファイル（監査や計測の記録）は、変更、削除、移動できない。`--allow-status` と `--allow-links` は記録には効かない（tett23/adr-guard の [ADR 0013](https://github.com/tett23/adr-guard/blob/main/docs/adr/0013-protect-audit-and-benchmark-records.md)）

手元の adr-guard はすでに v0.8.0 である。いまの pre-commit hook はオプションを付けていないため、ADR を採択したときに古い ADR のステータスを `採択→ADR NNNN` に変えるコミットが止まる。
また、このリポジトリの文書には、リンクのない ADR の参照が 359 か所ある（CLAUDE.md、`docs/specifications.md`、コミット済みの ADR）。このまま action を v0.8.0 に上げると、`links` の検査で CI が失敗する。
一方、すべての ADR は 3 行目に `ステータス:` の行をちょうど 1 つ持つため、`adr-guard check-status` は終了コード 0 で終わる。ステータスの行を足す移行は要らない。
また、このリポジトリには `docs/audit/` と `docs/benchmarks/` がない。保護の対象が増えても、いまの作業は変わらない。

リンクを付けると、ADR のステータスの行と見出しにもリンクが入る（例：`ステータス: 採択→[ADR 0020](0020-adr-workflow-and-adr-guard.md)`）。
[ADR 0020](0020-adr-workflow-and-adr-guard.md) で決めたステータスの書き方と、それを調べるテスト（`test/adr.test.ts`）は、リンクのない形だけを認めている。
また、この ADR は [ADR 0020](0020-adr-workflow-and-adr-guard.md) の一部（adr-guard のバージョンとオプション）だけを置き換えるが、その書き方（`採択→…は[ADR NNNN](...)`）も認めていない。

## 実装すること

### adr-guard の更新

- `.github/workflows/ci.yml` の `adr` ジョブの action を `uses: tett23/adr-guard@v0.8.0` にし、入力 `allow-status: true` と `allow-links: true` を加える。`actions/checkout@v7`、`fetch-depth: 0`、`persist-credentials: false` はそのまま。`links` と `check-status` の検査は既定のまま有効にする（`check-status: false` は付けない）
- `.githooks/pre-commit` を `exec adr-guard pre-commit --allow-status --allow-links` にし、コメントを内容に合わせて直す
- `.claude/settings.json` の hook を `adr-guard claude-hook --allow-status` にする
- `README.md` の開発の節の adr-guard のインストール手順のタグを v0.8.0 にし、ステータスの行の変更とリンクだけの変更が許可されること、ADR の参照にはリンクが要ること（`adr-guard links --fix` で付けられること）、ADR にはステータスの行がちょうど 1 つ要ること、`docs/audit/` と `docs/benchmarks/` のコミット済みの記録も変更できないことを書く
- `docs/specifications.md` と CLAUDE.md の ADR の運用と保護の記述を、この ADR に合わせる

### ADR の参照のリンク

- `adr-guard links --fix --include-committed` で、コミット済みの ADR も含めて、文書の中の ADR の参照をリンクにする。`adr-guard links` が終了コード 0 で終わるようにする
- リンクの付与のほかに、コミット済みの ADR は変えない（ステータスの行の変更を除く）

### ステータスの書き方

[ADR 0020](0020-adr-workflow-and-adr-guard.md) の表に、次の書き方を加える。ADR の参照はリンクにしてよい（`adr-guard links` の検査ではリンクが要る）。

| ステータス                               | 意味                                                           |
| ---------------------------------------- | -------------------------------------------------------------- |
| `採択→[ADR NNNN](...)`                   | 採択したが、ADR NNNN に置き換えられた                          |
| `採択→<置き換えた部分>は[ADR NNNN](...)` | 採択したが、一部（置き換えた部分）が ADR NNNN に置き換えられた |

- ステータスの行は、これまでどおり見出しの 2 行後に 1 つだけ置く。adr-guard v0.7.0 の検査（ステータスの行がちょうど 1 つ）とも合う
- `test/adr.test.ts` を、これらの書き方を認めるように直す。置き換えた先の ADR があることと、リンクの先のファイルがあることを調べる
- [ADR 0020](0020-adr-workflow-and-adr-guard.md) のステータスを `採択→adr-guard のバージョン、hook と CI のオプション、ステータスの書き方は[ADR 0025](0025-update-adr-guard-to-v0-8-0.md)` にする

## 実装しないこと

- action の指定方法の変更。これまでどおりバージョンのタグで指定する
- 全体の設定（`~/.claude/settings.json`）の hook の変更。各自の環境で行う
- 手元の adr-guard の更新の自動化
- コミット済みの ADR の本文の、リンクの付与のほかの書き換え（旧いバージョンやオプションの記述を含む）
- 見出しの書き方の変更。自分自身の番号（`# ADR NNNN:`）にはリンクが付かないため、いまのテストのままで通る
- `docs/audit/` や `docs/benchmarks/` の新設。記録を置くときに、v0.8.0 の保護がそのまま効く
- ステータスの行の英語の見出し（`Status:`）の採用。このリポジトリでは `ステータス:` だけを使う

## テスト設計

- 先に `test/adr.test.ts` に、ステータスの行の判定の例を加えて失敗させる
  - 認める：`提案`、`採択`、`却下`、`採択→ADR 0020`、`採択→[ADR 0020](0020-adr-workflow-and-adr-guard.md)`、`採択→adr-guard のバージョンは[ADR 0025](0025-update-adr-guard-to-v0-8-0.md)`
  - 認めない：`置換（ADR 0020）`、`採択→`、`採択→[ADR 0020]`、`採択→は[ADR 0020](0020-adr-workflow-and-adr-guard.md)`
  - `docs/adr/*.md` のすべてについて、置き換えた先の ADR とリンクの先のファイルがあること
- `adr-guard links` と `adr-guard check-status` が終了コード 0 で終わること
- `deno task test`、`deno fmt --check`、`deno lint` が通ること
- 手元の adr-guard（v0.8.0）で、変更をステージして `.githooks/pre-commit` が通ること（コミットはしない）。コミット済みの ADR の本文を一時的に変えてステージすると拒否されること
- `.github/workflows/ci.yml` が YAML として読めること
- 変更のプルリクエストの CI で、`adr` ジョブが v0.8.0 の action で実行され、`check-range --allow-status --allow-links`、`links`、`check-status` が成功すること

## トレードオフ

- pre-commit hook に `--allow-status` と `--allow-links` を付けるため、手元の adr-guard が v0.5.0 より古いと、引数の誤り（終了コード 64）でコミットが止まる。v0.7.0 より古いと、ステータスの行の検査が手元では行われず、CI で初めて違反に気づく。README のインストール手順のタグを v0.8.0 に上げて補う
- ステータスの行の変更とリンクの付与を許可するかどうかが、hook と action の設定から読み取れるようになる。その分、設定に付けるオプションが増える
- リンクの付与で、コミット済みの ADR の差分が大きくなる（約 340 か所）。リンクだけの変更なので、ほかの変更と分けたコミットにしてレビューしやすくする
- ステータスの行が長くなり、書き方の検査（テスト）が少し複雑になる
- `docs/audit/` と `docs/benchmarks/` の記録は、誤記でも直せなくなる。直すときは新しい記録を作る
