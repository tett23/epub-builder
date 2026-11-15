# ADR 0032: adr-guard を v0.13.1 に上げ、ADR のステータスの行を新形式に移す

Status: proposed

## 文脈

[ADR 0031](0031-update-adr-guard-to-v0-10-0.md) で、adr-guard を v0.10.0 に上げた。
その後、tett23/adr-guard は v0.11.0、v0.12.0、v0.13.0、v0.13.1 になった。このリポジトリに関わる変更は次のとおり（[リリース v0.11.0](https://github.com/tett23/adr-guard/releases/tag/v0.11.0)、[リリース v0.12.0](https://github.com/tett23/adr-guard/releases/tag/v0.12.0)、[リリース v0.13.0](https://github.com/tett23/adr-guard/releases/tag/v0.13.0)、[リリース v0.13.1](https://github.com/tett23/adr-guard/releases/tag/v0.13.1)）。

- v0.11.0：Codex の PreToolUse hook として動くサブコマンド `adr-guard codex-hook`（tett23/adr-guard の [ADR 0021](https://github.com/tett23/adr-guard/blob/v0.13.1/docs/adr/0021-codex-hook.md)）
- v0.12.0：ステータスの行の新形式と、状態遷移の検査（tett23/adr-guard の [ADR 0022](https://github.com/tett23/adr-guard/blob/v0.13.1/docs/adr/0022-status-transitions.md)）
  - 新形式は `Status: <トークン>` である。トークンは `proposed`、`accepted`、`accepted-pending`、`rejected`、`discarded`、`deprecated` のいずれか、または `superseded [<変更の JSON 配列>]` である。変更は `{"part":<部分名か null>,"by":[<リポジトリのルートからのパス>]}` と書く
  - 追加した ADR と、ステータスの行を書き換えた ADR には、新形式が要る。新しい ADR は、最初のコミットで `Status: proposed` でなければならない
  - pre-commit と `check-range` は、HEAD からの状態遷移を検査する。遷移の違反は `--allow-status`、環境変数 `ADR_GUARD_ALLOW`、コミットのトレーラーでも免除されない
  - 旧形式（`ステータス: 採択` など）の行は、書き換えない限りそのまま読める
  - 旧形式を新形式に書き換える移行スクリプト `scripts/migrate-adr-status` が adr-guard のソースにある。リリースのアーカイブには入らない
  - 修正先を辿るサブコマンド `adr-guard trace`（tett23/adr-guard の [ADR 0023](https://github.com/tett23/adr-guard/blob/v0.13.1/docs/adr/0023-trace-amendments.md)）
- v0.13.0：移行スクリプトの `--dry-run` と、移行できない ADR の全件の数え上げ（tett23/adr-guard の [ADR 0024](https://github.com/tett23/adr-guard/blob/v0.13.1/docs/adr/0024-migration-dry-run-and-error-count.md)）。状態 `superseded-pending`（実装を待つ ADR が修正を受けた状態）、変更の `kind` と `note`、`https://` の修正先、`trace --list` の6列（tett23/adr-guard の [ADR 0025](https://github.com/tett23/adr-guard/blob/v0.13.1/docs/adr/0025-extend-canonical-status-amendments.md)）。旧形式の参照の読み方の拡張（tett23/adr-guard の [ADR 0026](https://github.com/tett23/adr-guard/blob/v0.13.1/docs/adr/0026-read-more-legacy-references.md)、[ADR 0027](https://github.com/tett23/adr-guard/blob/v0.13.1/docs/adr/0027-read-legacy-replaced-status.md)）
- v0.13.1：移行スクリプトが旧形式の行から部分名を作るときに、修飾子（`ADR NNNN` の直前の語）、先頭の「。」、末尾の「→」を残さなくなった。部分名を規則で決められない行は、「部分名を決められません」と報告し、書き換えない（tett23/adr-guard の [ADR 0028](https://github.com/tett23/adr-guard/blob/v0.13.1/docs/adr/0028-fix-legacy-part-names.md)）

手元の adr-guard はすでに v0.13.1 で、pre-commit は新しい ADR に新形式を求める。
いっぽう、このリポジトリの ADR はすべて旧形式のステータスの行を持ち、`test/adr.test.ts` は旧形式の行だけを受けつける（[ADR 0025](0025-update-adr-guard-to-v0-8-0.md)、[ADR 0028](0028-align-adr-format-with-global-policy.md)、[ADR 0030](0030-update-adr-guard-to-v0-8-3.md)）。
そのため、新しい ADR を足すと、adr-guard が求める書き方と、このリポジトリのテストが求める書き方が食い違う。
また、[ADR 0020](0020-adr-workflow-and-adr-guard.md) は、レビューで認められた ADR のステータスを「採択」にしてコミットすると決めている。
v0.13.1 の pre-commit は、最初のコミットが `proposed` でない ADR を拒否するので、この手順には従えない。

## 調査した事項

次は、この ADR の worktree（origin/main から作ったブランチ `adr-guard-v0.13.0`）で実行して確かめた。

- `adr-guard -V` は `adr-guard 0.13.1` を出力した
- `.github/workflows/ci.yml` の `adr` ジョブは `uses: tett23/adr-guard@v0.10.0` で、入力は `base`、`head`、`allow-status: true`、`allow-links: true`、`links: true`、`check-status: true` である。`.githooks/pre-commit` は `exec adr-guard pre-commit --allow-status --allow-links` を実行する。`.claude/settings.json` の hook は `adr-guard claude-hook --allow-status` である
- adr-guard の v0.13.1 のタグはコミット `ab55769152ed0f8a3465ee3435a2df43ab9d067f` を指す。v0.13.1 の `action.yml` の入力は `base`、`head`、`version`、`allow-status`、`allow-links`、`links`、`check-status`、`check-numbers`、`allow-renumber` である
- この ADR を足す前に、`adr-guard links`、`adr-guard check-status`、`adr-guard check-numbers` は、いずれも終了コード 0 で終わった。`deno test --allow-read test/adr.test.ts` は 4 件とも通った
- worktree のルートで、adr-guard の v0.13.1 のソースの `scripts/migrate-adr-status`（ビルドしたもの）を `--dry-run` で実行した。この ADR を足す前は、終了コード 0 で、標準エラーに `移行できる: 31件、移行済み: 0件、移行できない: 0件` を出力した。31 件の内訳は `Status: accepted` が 7 件、`Status: superseded [...]` が 24 件である
- v0.13.1 の移行スクリプトの `--dry-run` が出す新形式のステータスの行は、v0.13.0 の移行スクリプトの出力とすべて同じだった（`diff` で差が無かった）
- 移行スクリプトは、[ADR 0030](0030-update-adr-guard-to-v0-8-3.md) の `採択→adr-guard のバージョンは[ADR 0031](0031-update-adr-guard-to-v0-10-0.md)` を `Status: superseded [{"by":["docs/adr/0031-update-adr-guard-to-v0-10-0.md"],"part":"adr-guard のバージョン"}]` に、[ADR 0028](0028-align-adr-format-with-global-policy.md) の `採択→CI での adr-guard links の扱いは[ADR 0029](0029-check-adr-links-in-ci.md)` を `Status: superseded [{"by":["docs/adr/0029-check-adr-links-in-ci.md"],"part":"CI での adr-guard links の扱い"}]` に書き換える
- この ADR を足した状態で `deno test --allow-read test/adr.test.ts` を実行すると、「すべての ADR のファイル名、見出し、ステータスが決めた書き方である」が、この ADR の `Status: proposed` で失敗した
- worktree を `$TMPDIR` に clone し、移行の手順を試した。この ADR を `Status: proposed` で足したインデックスで、`adr-guard pre-commit --allow-status --allow-links` は終了コード 0 で終わった。それをコミットし、ステータスを `Status: accepted-pending` にしたインデックスでも、終了コード 0 で終わった
- 続けて、移行スクリプトの `--dry-run` は `移行できる: 31件、移行済み: 1件、移行できない: 0件`（移行済みの 1 件はこの ADR）を出力した。`--write` で書き換え、[ADR 0031](0031-update-adr-guard-to-v0-10-0.md)、[ADR 0028](0028-align-adr-format-with-global-policy.md)、[ADR 0030](0030-update-adr-guard-to-v0-8-3.md)、[ADR 0020](0020-adr-workflow-and-adr-guard.md) のステータスの行を「移行」の節の内容にしたインデックスで、pre-commit は終了コード 0 で終わった。旧形式から、変更を 1 つ足した新形式への書き換えも、状態遷移の検査を通った
- そのコミットの後、`--dry-run` は `移行できる: 0件、移行済み: 32件、移行できない: 0件` を出力した。`adr-guard check-status`、`adr-guard links`、`adr-guard check-numbers`、`adr-guard check-range origin/main HEAD --allow-status --allow-links` は、いずれも終了コード 0 で終わった。`^ステータス:` で始まる行は残らなかった。`adr-guard trace --list docs/adr/0020-adr-workflow-and-adr-guard.md` は、[ADR 0031](0031-update-adr-guard-to-v0-10-0.md)、[ADR 0030](0030-update-adr-guard-to-v0-8-3.md)、[ADR 0028](0028-align-adr-format-with-global-policy.md)、[ADR 0020](0020-adr-workflow-and-adr-guard.md) からこの ADR への辺を出した。この試しでは `test/adr.test.ts` を変えていない
- 旧形式の ADR を足した main のコミット 6180e46（[ADR 0031](0031-update-adr-guard-to-v0-10-0.md) を足したもの）で `adr-guard check-range 6180e46^ 6180e46 --allow-status --allow-links` を実行すると、新形式のステータス行を `Status:` と空白 1 つで始めるよう求める診断を出して終了コード 1 で終わった。[ADR 0030](0030-update-adr-guard-to-v0-8-3.md) のステータスを旧形式のまま書き換えたコミット 945d342 でも、同じ診断を出した
- ステータスの書き方とその手順を書いた文書は、`CLAUDE.md` の「ADR」と「ADR の保護」、`README.md` の「開発」、`docs/specifications.md` の冒頭の ADR の一覧と「18. 試験」である

## 実装すること

### adr-guard の版

- `.github/workflows/ci.yml` の `adr` ジョブの action を `uses: tett23/adr-guard@v0.13.1` にする。ほかの入力（`base`、`head`、`allow-status: true`、`allow-links: true`、`links: true`、`check-status: true`）はそのまま。`check-numbers` は action の既定（実行する）に任せる。コメントの ADR 番号にこの ADR を加える
- `.githooks/pre-commit` のコマンド（`exec adr-guard pre-commit --allow-status --allow-links`）は変えない。コメントの ADR 番号にこの ADR を加える
- `README.md` の adr-guard のインストール手順のタグと action の版を v0.13.1 にする。ADR の一覧にこの ADR を加える

### ステータスの書き方

[ADR 0028](0028-align-adr-format-with-global-policy.md) と [ADR 0030](0030-update-adr-guard-to-v0-8-3.md) のステータスの書き方を、次で置き換える。

- ステータスの行は、見出しの次の次の行（3 行目）に置く `Status: <状態>` とする
- 状態は次のいずれかとする

| 状態                              | 意味                                                                       | 旧形式                                              |
| --------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------- |
| `proposed`                        | 提案。レビューを受けたあと、この状態で一度コミットする                     | `提案`                                              |
| `accepted-pending`                | 採択されたが、まだ実装されていない。`adr-guard unimplemented` で一覧できる | `採択（未実装）`                                    |
| `accepted`                        | 採択され、実装を終えた（実装の要らない ADR は採択した時点で `accepted`）   | `採択`                                              |
| `superseded [<変更の JSON 配列>]` | 全部または一部を、後の ADR で置き換えられた                                | `採択→ADR NNNN`、`採択→<置き換えた部分>は ADR NNNN` |
| `rejected`                        | 却下                                                                       | `却下`                                              |
| `discarded`                       | 破棄                                                                       | `破棄`                                              |

- `superseded` の変更は `{"part":<置き換えた部分>,"by":[<置き換えた ADR のパス>]}` とする。全部を置き換えたときは `part` を `null` にする。`part` は空でない文字列か `null`、`by` は `docs/adr/` の ADR のパスを 1 つ以上並べた配列とし、変更の配列は 1 つ以上の変更を持つ
- `deprecated`、`superseded-pending`、変更の `kind` と `note`、`https://` の修正先は使わない

### 手順

[ADR 0020](0020-adr-workflow-and-adr-guard.md) の、採択した ADR をコミットする手順を、次で置き換える。

1. 決定が要る変更は、実装に入る前に ADR を書く。ステータスを `proposed` にし、コミットせずに人間のレビューを受ける
2. レビューで認められたら、`Status: proposed` のままコミットする
3. 続くコミットで、ステータスを `accepted-pending`（実装の要る ADR）か `accepted`（実装の要らない ADR）にする。実装を終えたら `accepted-pending` を `accepted` に変える
4. 決定を覆すときは、新しい ADR を作り、元の ADR のステータスを `superseded [...]` にする

### テスト

- `test/adr.test.ts` のステータスの行の判定を、上の書き方に置き換える。旧形式の行は受けつけない
- 置き換えた ADR のパス（`by`）のファイルが `docs/adr/` にあることを確かめる

### 移行

- worktree のルートで、adr-guard の v0.13.1 のソースの `scripts/migrate-adr-status` を `--dry-run` で実行し、移行できない ADR が 0 件であることを確かめてから、`--write` ですべての ADR のステータスの行を新形式に書き換える
- [ADR 0031](0031-update-adr-guard-to-v0-10-0.md) のステータスを `Status: superseded [{"part":"adr-guard のバージョン","by":["docs/adr/0032-update-adr-guard-to-v0-13-1.md"]}]` にする
- [ADR 0028](0028-align-adr-format-with-global-policy.md) と [ADR 0030](0030-update-adr-guard-to-v0-8-3.md) の移行後の変更の配列の末尾に `{"part":"ステータスの書き方","by":["docs/adr/0032-update-adr-guard-to-v0-13-1.md"]}` を足す
- [ADR 0020](0020-adr-workflow-and-adr-guard.md) の移行後の変更の配列の末尾に `{"part":"採択した ADR をコミットする手順","by":["docs/adr/0032-update-adr-guard-to-v0-13-1.md"]}` を足す

### 文書

- `docs/specifications.md` と `CLAUDE.md` の adr-guard の版、ステータスの書き方、手順の記述を、この ADR に合わせる。pre-commit と CI が状態遷移を検査することを書く。仕様書の ADR の一覧にこの ADR を加える
- `adr-guard links --fix` を実行し、`adr-guard links`、`adr-guard check-status`、`adr-guard check-numbers` が終了コード 0 で終わるようにする

### この ADR を入れる PR

この ADR を `proposed` でコミットすると、いまの `test/adr.test.ts` が失敗する。
そのため、この ADR は、テストと移行の変更と同じ PR で main に入れる。
PR のコミットは、この ADR の提案（`proposed`）、採択（`accepted-pending`）、テストの変更、移行と文書の順に並べ、最後のコミットでこの ADR を `accepted` にする。

## 実装しないこと

- `.claude/settings.json` の hook の変更。v0.13.1 でも `adr-guard claude-hook --allow-status` のままでよい
- Codex の hook（v0.11.0 の `adr-guard codex-hook`）の導入
- `deprecated`、`superseded-pending`、変更の `kind` と `note`、`https://` の修正先の受けつけ。adr-guard は受けつけるが、このリポジトリの書き方は旧形式で使っていた状態に対応するものにそろえる
- 旧形式の行を、移行の後もテストで受けつけること
- 移行スクリプトをこのリポジトリに置くこと。移行は一度だけ行い、adr-guard の v0.13.1 のソースから実行する
- 手元の adr-guard の更新の自動化

## 不変条件

`parseStatus(line)` は、ステータスの行を判定し、書き方に合えば置き換えた ADR のパスの並び（`by` を変更の順に連ねたもの）を返し、合わなければ `undefined` を返す。

1. `line` が `Status:`、空白 1 つ、`proposed`、`accepted-pending`、`accepted`、`rejected`、`discarded` のいずれかだけからなるとき、`parseStatus(line)` は空の並びを返す
2. `line` が `Status: superseded`、空白 1 つ、JSON の配列からなり、配列が 1 つ以上の変更を持ち、各変更がキー `part`（空でない文字列か `null`）と `by`（`docs/adr/NNNN-<kebab-case>.md` の形の文字列を 1 つ以上持つ配列）だけを持つとき、`parseStatus(line)` は各変更の `by` を変更の順に連ねた並びを返す
3. 1 と 2 のどちらにも当たらない `line`（旧形式の行、`deprecated`、`superseded-pending`、空の配列、`kind` や `note` を持つ変更、`https://` の修正先、壊れた JSON、前後の空白を含む行など）では、`parseStatus(line)` は `undefined` を返す
4. `docs/adr/` のすべての ADR で、3 行目に `parseStatus` が `undefined` でない値を返し、返した並びのすべてのパスのファイルが `docs/adr/` にある

| 入力                                                                                                                   | 期待                                                   |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `Status: proposed`                                                                                                     | 空の並び（1）                                          |
| `Status: accepted-pending`                                                                                             | 空の並び（1）                                          |
| `Status: deprecated`                                                                                                   | `undefined`（3）                                       |
| `Status: superseded []`（変更が 0 個）                                                                                 | `undefined`（3）                                       |
| `Status: superseded [{"part":null,"by":["docs/adr/0020-adr-workflow-and-adr-guard.md"]}]`（変更が 1 個、`by` が 1 個） | `["docs/adr/0020-adr-workflow-and-adr-guard.md"]`（2） |
| 変更が 2 個、2 個目の `by` が 2 個                                                                                     | 3 つのパスを変更の順に（2）                            |
| `"by":[]`（`by` が 0 個）                                                                                              | `undefined`（3）                                       |
| `"part":""`                                                                                                            | `undefined`（3）                                       |
| `"kind":"replace"` を足した変更                                                                                        | `undefined`（3）                                       |
| `"by":["https://example.com/adr.md"]`                                                                                  | `undefined`（3）                                       |
| `Status: superseded-pending [...]`                                                                                     | `undefined`（3）                                       |
| `ステータス: 採択`                                                                                                     | `undefined`（3）                                       |
| `Status: accepted` の末尾に空白を 1 つ足した行                                                                         | `undefined`（3）                                       |

## テスト設計

- `test/adr.test.ts` に次を先に書き、いまの実装で失敗することを確かめる。テストの名前に不変条件の番号を入れる
  - 「不変条件1」：1 の 5 つの状態の行が空の並びを返す
  - 「不変条件2」：上の表の変更が 1 個と 2 個の行が、`by` を変更の順に連ねた並びを返す
  - 「不変条件3」：上の表の `undefined` の行と、`ステータス: 採択（未実装）`、`ステータス: 採択→ADR 0020`、`Status: superseded [{"part":null}]`、`Status: superseded {"part":null,"by":["docs/adr/0020-adr-workflow-and-adr-guard.md"]}` が `undefined` を返す
  - 「不変条件4」：すべての ADR のファイル名、見出し、ステータスの行が決めた書き方であり、置き換えた ADR のファイルがある（いまの「すべての ADR のファイル名、見出し、ステータスが決めた書き方である」を置き換える）
- `deno task test`、`deno fmt --check`、`deno lint` が通ること
- 移行スクリプトの `--write` の後に `--dry-run` を実行すると、`移行できる: 0件` で、移行できない ADR が 0 件であること
- `adr-guard links`、`adr-guard check-status`、`adr-guard check-numbers` が終了コード 0 で終わること
- 手元の adr-guard（v0.13.1）で、変更をステージして `.githooks/pre-commit` が通ること
- コミット後、`adr-guard check-range origin/main HEAD --allow-status --allow-links` が終了コード 0 で終わること
- `adr-guard trace --list docs/adr/0028-align-adr-format-with-global-policy.md` と `adr-guard trace --list docs/adr/0020-adr-workflow-and-adr-guard.md` が、この ADR への辺を出すこと
- `.github/workflows/ci.yml` が YAML として読めること
- 変更のプルリクエストの CI で、`adr` ジョブが v0.13.1 の action で実行され、成功すること

## トレードオフ

- adr-guard とこのリポジトリのテストが、同じ書き方を求めるようになる。その代わり、ADR を足すたびに `proposed` のコミットと採択のコミットの 2 つが要る
- 状態遷移の違反は `--allow-status` でも免除されないので、誤ったステータスの書き換えを手元と CI で止められる。その代わり、誤って入れたステータスを戻すには、許された遷移を辿る必要がある
- CI を上げた後は、旧形式のステータスの行で ADR を足すコミットと、旧形式の行を旧形式のまま書き換えるコミットが、CI で失敗する。移行より前に分けたブランチにそのようなコミットがあれば、マージの前にステータスの行を新形式に直す
- 置き換えた部分を JSON の文字列で書くので、ステータスの行は旧形式より読みにくい。`adr-guard trace` で修正の関係を辿れる
- adr-guard が受けつける書き方（`deprecated`、`superseded-pending`、`kind`、`note`、`https://` の修正先）の一部を、このリポジトリのテストは拒否する。書き方はそろうが、adr-guard だけでは検出されない
- この ADR を、テストの変更と同じ PR に入れる必要がある。ADR だけの PR は、CI の Deno のジョブで失敗する

## 参考文献

- tett23/adr-guard [ADR 0021: Codex の PreToolUse hook で、コミット済みのADRと記録の編集を拒否する](https://github.com/tett23/adr-guard/blob/v0.13.1/docs/adr/0021-codex-hook.md)
- tett23/adr-guard [ADR 0022: 状態と遷移を別々の代数的データ型で表す](https://github.com/tett23/adr-guard/blob/v0.13.1/docs/adr/0022-status-transitions.md)
- tett23/adr-guard [ADR 0023: trace で元の決定から修正ADRをたどる](https://github.com/tett23/adr-guard/blob/v0.13.1/docs/adr/0023-trace-amendments.md)
- tett23/adr-guard [ADR 0024: 移行スクリプトに --dry-run を設け、失敗を最後まで数える](https://github.com/tett23/adr-guard/blob/v0.13.1/docs/adr/0024-migration-dry-run-and-error-count.md)
- tett23/adr-guard [ADR 0025: 新形式のステータス行に、実装待ちの修正、補足、注記、別のリポジトリの修正先を加える](https://github.com/tett23/adr-guard/blob/v0.13.1/docs/adr/0025-extend-canonical-status-amendments.md)
- tett23/adr-guard [ADR 0026: 旧形式のステータス行の修正先を、リンク先と裸の番号からも読む](https://github.com/tett23/adr-guard/blob/v0.13.1/docs/adr/0026-read-more-legacy-references.md)
- tett23/adr-guard [ADR 0027: 旧形式の `置換（…）` を、修正を受けた状態として読む](https://github.com/tett23/adr-guard/blob/v0.13.1/docs/adr/0027-read-legacy-replaced-status.md)
- tett23/adr-guard [ADR 0028: 旧形式の部分名から修飾子と区切りの記号を除き、決められない部分名を移行しない](https://github.com/tett23/adr-guard/blob/v0.13.1/docs/adr/0028-fix-legacy-part-names.md)
- tett23/adr-guard [リリース v0.11.0](https://github.com/tett23/adr-guard/releases/tag/v0.11.0)、[リリース v0.12.0](https://github.com/tett23/adr-guard/releases/tag/v0.12.0)、[リリース v0.13.0](https://github.com/tett23/adr-guard/releases/tag/v0.13.0)、[リリース v0.13.1](https://github.com/tett23/adr-guard/releases/tag/v0.13.1)
- tett23/adr-guard の [README](https://github.com/tett23/adr-guard/blob/v0.13.1/README.md)（ステータスの行の新形式、移行スクリプト、`trace`）
