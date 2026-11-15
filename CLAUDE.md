# epub-builder

EPUB 2.0.1 と EPUB 3.0 のファイルを作る TypeScript のライブラリ。Deno で動く。公開リポジトリ（MIT）。概要は README.md を参照。

## ADR

設計上の決定は `docs/adr/` に ADR として記録する（[ADR 0020](docs/adr/0020-adr-workflow-and-adr-guard.md)）。

- 決定が要る変更は、実装に入る前に ADR を書く。ステータスを `proposed` にし、コミットせずに人間のレビューを受ける。認められたら `Status: proposed` のままコミットし、続くコミットでステータスを `accepted-pending`（実装の要る ADR）か `accepted`（実装の要らない ADR）にして、実装に入る。実装を終えたら `accepted-pending` を `accepted` に変える（[ADR 0032](docs/adr/0032-update-adr-guard-to-v0-13-1.md)）
- ファイル名は `NNNN-kebab-case.md`（連番は 4 桁）とする
- 見出しは `# ADR NNNN: <決定を述べる一文>`、その次の次の行（3 行目）に `Status: <状態>` を置く。状態は `proposed`（提案）、`accepted-pending`（採択されたがまだ実装されていない）、`accepted`（採択され、実装を終えた）、`superseded [<変更の JSON 配列>]`（全部または一部を、後の ADR で置き換えられた）、`rejected`（却下）、`discarded`（破棄）のいずれか。`superseded` の変更は `{"part":<置き換えた部分か null>,"by":[<置き換えた ADR のパス>]}` と書く。全部を置き換えたときは `part` を `null` にする。`deprecated`、`superseded-pending`、変更の `kind` と `note`、`https://` の修正先は使わない（[ADR 0032](docs/adr/0032-update-adr-guard-to-v0-13-1.md)）。`accepted-pending` の ADR は `adr-guard unimplemented` で一覧できる。ADR の参照はリンクにする
- 節は「文脈」「実装すること」「実装しないこと」「テスト設計」「トレードオフ」「参考文献」の順とし、参考文献を最後の節にする。参考文献には仕様の調査に使った文献を書き、ない場合は「なし」と書く（[ADR 0027](docs/adr/0027-update-adr-guard-to-v0-8-2.md) 以降。[ADR 0028](docs/adr/0028-align-adr-format-with-global-policy.md)）
- データ構造やアルゴリズムを変えるときはその節を、仕様の検討のログとして残したいことがあるときは「検討の記録」などの節を、テスト設計より前に立てる
- コミット済みの ADR は変更不可。変えてよいのは `Status:` の行と、リンクだけの変更（[ADR 0027](docs/adr/0027-update-adr-guard-to-v0-8-2.md)）。決定を覆すときは、元の ADR の全体を写して改めた新しい ADR を作り、元の ADR のステータスを `superseded [...]` に変える
- コミット前の ADR は自由に直してよい
- ADR を破棄するときは、ステータスを `discarded` にし、経緯と理由を `docs/specifications.md` の「破棄した ADR」に書く。ファイルは残し、番号は欠番にしない（[ADR 0028](docs/adr/0028-align-adr-format-with-global-policy.md)）
- ADR を作った後と、ドキュメント（`README.md`、`docs/specifications.md`、`CLAUDE.md`）を更新した後に、`adr-guard links --fix` を実行し、`adr-guard links` で確かめる
- ADR で仕様が変わったら、`docs/specifications.md` と `README.md` を同じ変更で直す

## 境界

- 公開リポジトリなので、テストのフィクスチャに著作物（小説の本文など）を使わない。合成したデータで作る
- EPUB の仕様に沿うことを優先する。特定のリーダーや配信サービスに固有の拡張は、ADR で決めてから入れる

## ADR の保護

- コミット済み ADR の変更不可は、[tett23/adr-guard](https://github.com/tett23/adr-guard) v0.13.1 で強制されている（[ADR 0020](docs/adr/0020-adr-workflow-and-adr-guard.md)、[ADR 0025](docs/adr/0025-update-adr-guard-to-v0-8-0.md)、[ADR 0026](docs/adr/0026-update-adr-guard-to-v0-8-1.md)、[ADR 0027](docs/adr/0027-update-adr-guard-to-v0-8-2.md)、[ADR 0030](docs/adr/0030-update-adr-guard-to-v0-8-3.md)、[ADR 0031](docs/adr/0031-update-adr-guard-to-v0-10-0.md)、[ADR 0032](docs/adr/0032-update-adr-guard-to-v0-13-1.md)）。Claude Code の hook（`.claude/settings.json`）が Edit / Write を止め、git の pre-commit（`.githooks/pre-commit`）がコミットを拒否し、CI がすべてのコミットを検査する。hook を迂回しない（`--no-verify` を使わない）
- ステータスの行の変更と、リンクだけの変更（リンクのテキストの変更は含まない）は、`--allow-status`、`--allow-links` で許可されている
- 文書（`.md`）の中の ADR の参照（`ADR 0001` の形）には、ADR のファイルへのリンクを付ける。`adr-guard links --fix` で付けられ、`adr-guard links` で確かめられる。ほかのリポジトリの ADR は、`[tett23/adr-guard の ADR 0019](https://github.com/...)` のように、リンクのテキストごと外部リンクにする（`<リポジトリ> ADR NNNN` と書くと、存在しない修飾子として報告される。[ADR 0031](docs/adr/0031-update-adr-guard-to-v0-10-0.md)）
- ADR は、行頭が `Status:` のステータスの行をちょうど 1 つ持つ。`adr-guard check-status` で確かめられる
- 新しい ADR は、最初のコミットで `Status: proposed` とする。pre-commit と CI はステータスの状態遷移を検査し、許されない遷移は `--allow-status` でも拒否する（[ADR 0032](docs/adr/0032-update-adr-guard-to-v0-13-1.md)）
- ADR の番号は重複させない。`adr-guard check-numbers` で確かめられ、CI でも検査する（[ADR 0031](docs/adr/0031-update-adr-guard-to-v0-10-0.md)）
- 監査や計測の記録（`docs/audit/`、`docs/audits/`、`docs/benchmarks/`、`docs/benchmark/` 以下）も、コミット済みのものは変更、削除、移動できない。直すときは新しい記録を作る

## Git

- main への rebase はしない。作業はブランチで行い、no-ff でマージする。ブランチはマージするまで rebase してよい
- `v` で始まるタグはリリースとする。`v0.0.1-rc` のように `-` を含むタグはプレリリースとする

## 実装

- TypeScript でクラスを使わない（[ADR 0021](docs/adr/0021-no-classes.md)）
- ライセンスに問題がなく再実装が容易な依存は、依存に入れずに再実装する。テストは本家を参考に厚く書く
- GitHub Actions は、Node 24 以降で動く最新のメジャー版を使う
