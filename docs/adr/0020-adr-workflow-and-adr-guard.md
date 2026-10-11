# ADR 0020: ADR の運用を提案、レビュー、コミットの順にし、コミット済みの ADR の保護を tett23/adr-guard に置き換える

ステータス: 採択

## 文脈

この ADR は ADR 0002 を置き換える。

ADR 0002 では、コミット済みの ADR をステータスの行を除いて変更不可とし、epubize から写した判定のスクリプト（`scripts/adr-guard.ts`）を、Claude Code の hook と git の pre-commit hook から呼ぶとした。
その後、作者の全リポジトリに共通する方針（グローバルの CLAUDE.md）が改められ、次のことが定められた。

- ADR は実装に入る前に作る。作った時点ではコミットせず、人間のレビューを受ける
- ステータスは「採択」「採択→変更後の ADR 番号」「提案」「却下」などで書く
- ADR を破棄するときは、経緯と理由を `docs/specifications.md` に書き、破棄した ADR の番号は欠番にする
- コミット済みの ADR を変更不可にする仕組みには、[tett23/adr-guard](https://github.com/tett23/adr-guard) を使う
- GitHub Actions は、Node 24 以降で動く最新のメジャー版を使う

これまでこのリポジトリでは、ADR を実装と同じコミットで追加し（CLAUDE.md の当時の規則）、置き換えた ADR のステータスを `置換（ADR NNNN）` と書いてきた。
また、判定のスクリプトは epubize と二重に持っており、CI では検査していなかった。そのため、`git commit --no-verify` や Web UI での編集を防げなかった。

ADR 0002 の決定のうち、コミット済みの ADR をステータスの行を除いて変更不可にすることは変えない。

## 実装すること

### ADR の運用

- 決定が要る変更は、実装に入る前に ADR を書く。書いた ADR はステータスを「提案」とし、コミットせずに人間のレビューを受ける
- レビューで認められたら、ステータスを「採択」にしてコミットする。そのあとで実装する。ADR と実装を同じコミットにしてもよいが、ADR の中身はレビューを受けたものから変えない
- 認められなかった ADR は、ステータスを「却下」にする。コミットするかどうかはレビューで決める
- ステータスの書き方は次のとおりとする

| ステータス      | 意味                                  |
| --------------- | ------------------------------------- |
| `提案`          | レビューを待っている                  |
| `採択`          | 決定として有効                        |
| `採択→ADR NNNN` | 採択したが、ADR NNNN に置き換えられた |
| `却下`          | 採択しなかった                        |

- コミット済みの ADR のうち、ステータスが `置換（ADR NNNN）` のもの（15 件）を、`採択→ADR NNNN` に書き換える。ステータスの行の変更なので、変更不可の規則に反しない
- ADR を破棄するときは、経緯と理由を `docs/specifications.md` の「破棄した ADR」の節に書き、その ADR の番号は欠番にする。この ADR の時点で破棄した ADR はない
- ADR によって仕様が変わったら、`docs/specifications.md` と `README.md` を同じ変更で直す（これまでどおり）
- リポジトリの CLAUDE.md の「ADR」と「ADR の保護」の節を、この ADR に合わせて書き換える

### コミット済みの ADR の保護

- 判定には tett23/adr-guard（v0.1.0）を使う。対象、規則（ステータスの行のほかは変更、削除、リネームできない）は ADR 0002 と同じである
- 入口は次の三つとする
  - git の pre-commit hook：`.githooks/pre-commit` を `exec adr-guard pre-commit` にする
  - Claude Code の PreToolUse hook（Write、Edit、MultiEdit）：`.claude/settings.json` で `adr-guard claude-hook` を呼ぶ
  - CI：GitHub Actions の新しいジョブで、tett23/adr-guard の composite action（`tett23/adr-guard@v0.1.0`）を使い、push と pull request の範囲のコミットを `check-range` で検査する。範囲のコミットをすべて読むため、`fetch-depth: 0` でチェックアウトする
- ADR 0002 の Bash の後の検査（PostToolUse hook）は、adr-guard に相当する入口がないため、やめる。Bash による変更は、pre-commit hook と CI で検査する
- epubize から写した判定のスクリプト `scripts/adr-guard.ts` と、そのテスト `test/adr-guard.test.ts` を消す。`deno task test` の `--allow-run=git` も、ほかで使わなければ外す
- README の開発の節に、adr-guard を入れる手順（リリースのバイナリか `cargo install`）と、`git config core.hooksPath .githooks` を書く

### GitHub Actions

- GitHub Actions のアクションは、Node 24 以降で動く最新のメジャー版を使う。この ADR の時点では、`actions/checkout@v7`、`denoland/setup-deno@v2`、`actions/setup-java@v6` とする（`actions/setup-java` を v5 から上げる）

## 実装しないこと

- 過去のコミットで ADR と実装を同じコミットに入れたことを、履歴を書き換えて直すことはしない。main への rebase はしない
- コミット済みの ADR の本文に残る、旧い運用の記述（「実装と同じコミットで ADR を追加する」など）は書き換えない。ステータスの行で置き換えを示す
- adr-guard を、このリポジトリのコードとして持つこと（写すこと、サブモジュールにすること）はしない
- adr-guard の pre-commit hook が、adr-guard の入っていない環境でコミットを拒否することへの対策はしない。README に入れる手順を書く

## テスト設計

- adr-guard の判定そのもののテストは、tett23/adr-guard の側にある。このリポジトリでは持たない
- 手で次を確かめる
  - コミット済みの ADR の本文を変えてコミットしようとすると、pre-commit hook が拒否すること
  - コミット済みの ADR の本文を Claude Code の Edit で変えようとすると、hook が止めること
  - ステータスの行だけの変更はコミットできること
- CI の adr-guard のジョブが、このリポジトリの全履歴（ルートのコミットから）で通ること。これまでの ADR の変更はステータスの行だけなので、通るはずである
- すべての ADR のステータスが、上の表の書き方のどれかであること（テストで `docs/adr/*.md` のステータスの行を調べる）

## トレードオフ

- adr-guard は Rust のバイナリで、開発する人がそれぞれ入れる必要がある。入れていないと pre-commit hook でコミットできない
- adr-guard の CI のアクションは Linux（x86_64）のランナーだけに対応する
- Bash による ADR の変更を、実行の直後には検出しなくなる。コミットの時点で検出する
- ADR のレビューを待つ間は実装に入れないため、決定を伴う変更は時間がかかる。その代わり、決定を人間が確かめてから実装する
