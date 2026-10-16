# ADR 0027: adr-guard を v0.8.2 に上げ、コミット済み ADR のリンクだけの変更を許可する

ステータス: 採択

## 文脈

[ADR 0026](0026-update-adr-guard-to-v0-8-1.md) で、adr-guard を v0.8.1 に上げた。
その後、tett23/adr-guard は v0.8.2 になった。このリポジトリに関わる変更は次のとおり（tett23/adr-guard の [ADR 0015](https://github.com/tett23/adr-guard/blob/main/docs/adr/0015-allow-link-changes.md)、[リリース](https://github.com/tett23/adr-guard/releases/tag/v0.8.2)）。

- `--allow-links` が、ADR の参照へのリンクの付与に限らず、コミット済み ADR の「リンクだけの変更」を広く許可する。インラインリンクと参照形式のリンクの追加、削除、リンク先の変更、画像のリンク先の変更、リンクの参照定義の行（`[1]: url`）の変更が許可される
- リンクのテキストの変更、画像の追加と削除、自動リンク（`<url>`）と本文の URL の変更は、引き続き拒否する
- 監査や計測の記録（`docs/audit/` など）は、引き続き完全に保護する。`--allow-links` は記録には効かない

このリポジトリは、pre-commit hook と CI で `--allow-links` を付けている（[ADR 0025](0025-update-adr-guard-to-v0-8-0.md)）。v0.8.2 では、コマンドを変えずに、許可される変更の範囲が広がる。

手元の adr-guard はすでに v0.8.2 である。

## 実装すること

- `.github/workflows/ci.yml` の `adr` ジョブの action を `uses: tett23/adr-guard@v0.8.2` にする。ほかの入力（`base`、`head`、`allow-status: true`、`allow-links: true`）はそのまま。コメントの「リンクの付与」を「リンクだけの変更」にし、ADR 番号に ADR 0027 を加える
- `.githooks/pre-commit` のコマンド（`exec adr-guard pre-commit --allow-status --allow-links`）は変えない。コメントの「ADR の参照へのリンクの付与」を「リンクだけの変更」にし、ADR 番号に ADR 0027 を加える
- `README.md` の adr-guard のインストール手順のタグと action の版を v0.8.2 にし、`--allow-links` で許可する変更を「リンクだけの変更」と書く。ADR の一覧にこの ADR を加える
- `docs/specifications.md` と CLAUDE.md の adr-guard の版と、`--allow-links` で許可する変更の記述を、この ADR に合わせる。仕様書の ADR の一覧にこの ADR を加える
- [ADR 0026](0026-update-adr-guard-to-v0-8-1.md) のステータスを `採択→adr-guard のバージョンは[ADR 0027](0027-update-adr-guard-to-v0-8-2.md)` にする
- `adr-guard links --fix --include-committed` を実行し、`adr-guard links` と `adr-guard check-status` が終了コード 0 で終わるようにする

## 実装しないこと

- `.claude/settings.json` の hook の変更。v0.8.2 でも `adr-guard claude-hook --allow-status` のままでよい
- action のほかの入力と、pre-commit hook のコマンドの変更
- コミット済みの ADR の、リンクのほかの変更（リンクのテキスト、画像の追加と削除、自動リンク、本文の URL）。引き続き拒否される
- 手元の adr-guard の更新の自動化

## テスト設計

- `adr-guard links` と `adr-guard check-status` が終了コード 0 で終わること
- `deno task test`（`test/adr.test.ts` で、この ADR のファイル名、見出し、ステータスの行と、[ADR 0026](0026-update-adr-guard-to-v0-8-1.md) の新しいステータスの行が決めた書き方であること）、`deno fmt --check`、`deno lint` が通ること
- 手元の adr-guard（v0.8.2）で、変更をステージして `.githooks/pre-commit` が通ること
- コミット後、`adr-guard check-range origin/main HEAD --allow-status --allow-links` が終了コード 0 で終わること
- `.github/workflows/ci.yml` が YAML として読めること
- 変更のプルリクエストの CI で、`adr` ジョブが v0.8.2 の action で実行され、成功すること

## トレードオフ

- コミット済みの ADR のリンク先を、ステータスの行のほかでも書きかえられるようになる。リンク先の誤りを直しやすくなる一方、リンク先の差し替えで ADR の参照の意味が変わりうる。リンクのテキストは変えられないので、どの ADR や文献を指すかの記述は保たれる
- 手元の adr-guard が v0.8.1 のままだと、リンクだけの変更が手元では拒否され、CI では許可される。README のインストール手順のタグを v0.8.2 に上げて補う

## 参考文献

- tett23/adr-guard [ADR 0015: allow link changes](https://github.com/tett23/adr-guard/blob/main/docs/adr/0015-allow-link-changes.md)
- tett23/adr-guard [リリース v0.8.2](https://github.com/tett23/adr-guard/releases/tag/v0.8.2)
