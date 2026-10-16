# ADR 0029: CI の adr ジョブで adr-guard links と check-status を実行することを、action の入力に明記する

ステータス: 採択

## 文脈

[ADR 0028](0028-align-adr-format-with-global-policy.md) では、ADR を作った後と、ドキュメントを更新した後に `adr-guard links --fix` を実行する手順を決め、実装しないことに「CI で `adr-guard links` を実行することはしない。この ADR では手順として決めるにとどめる」と書いた。

しかし、CI はすでに `adr-guard links` を実行している。

- [ADR 0025](0025-update-adr-guard-to-v0-8-0.md) で、CI の `adr` ジョブを tett23/adr-guard の composite action（v0.8.0）にし、入力 `allow-status: true` と `allow-links: true` を加えた。action は v0.5.0 から、`check-range` の後に作業ツリーで `adr-guard links` を実行する
- いまの action（v0.8.2）の入力 `links` と `check-status` は、どちらも既定が `true` である。`.github/workflows/ci.yml` はこの二つの入力を書いておらず、既定に頼っている
- [ADR 0025](0025-update-adr-guard-to-v0-8-0.md) のテスト設計は、CI の `adr` ジョブで `links` と `check-status` が成功することを求めている

[ADR 0028](0028-align-adr-format-with-global-policy.md) の記述は、この事実と食い違っている。また、`links` と `check-status` を実行するかどうかが action の既定に頼っているため、action の既定が変わると、設定を変えないまま検査が止まりうる。

## 実装すること

- CI の `adr` ジョブで、`adr-guard links`（ADR の参照にリンクがあること）と `adr-guard check-status`（ADR のステータスの行がちょうど 1 つあること）を実行する。これは [ADR 0025](0025-update-adr-guard-to-v0-8-0.md) からの振る舞いであり、この ADR で決定として明記する
- `.github/workflows/ci.yml` の `adr` ジョブの action の入力に、`links: true` と `check-status: true` を書く。ほかの入力（`base`、`head`、`allow-status: true`、`allow-links: true`）と action の版（`tett23/adr-guard@v0.8.2`）は変えない
- ジョブのコメントに、この ADR を加える
- [ADR 0028](0028-align-adr-format-with-global-policy.md) のステータスを `採択→CI での adr-guard links の扱いは[ADR 0029](0029-check-adr-links-in-ci.md)` にする
- 手元の手順（ADR を作った後とドキュメントを更新した後に `adr-guard links --fix` を実行し、`adr-guard links` で確かめる）は [ADR 0028](0028-align-adr-format-with-global-policy.md) のとおりとする。CI の検査は、手順を忘れたときの歯止めとする
- `docs/specifications.md` の ADR の一覧と、`README.md` の開発の節に、CI が ADR の参照のリンクとステータスの行を検査することを書く

## 実装しないこと

- CI で `adr-guard links --fix` を実行してリンクを付けることはしない。CI は検査だけを行い、直すのは手元で行う
- adr-guard の版を上げることはしない
- `links` や `check-status` の検査を止める設定（`false`）は使わない

## テスト設計

- 自動のテストは書けない（GitHub Actions の設定の値の変更である）。実装の後に次を確かめる
  - 変更のプルリクエストの CI で、`adr` ジョブのログに `adr-guard links` と `adr-guard check-status` の実行が出て、ジョブが成功すること
  - 手元で、リンクのない ADR の参照を `README.md` に一時的に書き、`adr-guard links` が終了コード 0 以外で終わることを確かめる（コミットはしない）
  - `.github/workflows/ci.yml` の `adr` ジョブの入力に、`links: true` と `check-status: true` があること

## トレードオフ

- 設定に入力が二つ増える。その代わり、action の既定が変わっても検査が止まらず、設定を読めば何を検査するかが分かる
- リンクのない ADR の参照を書くと、手元で直すまで CI が失敗する

## 参考文献

- tett23/adr-guard の [action.yml（v0.8.2）](https://github.com/tett23/adr-guard/blob/v0.8.2/action.yml)（入力 `links` と `check-status` の既定）
- tett23/adr-guard の [README](https://github.com/tett23/adr-guard/blob/main/README.md)（CI での使い方）
