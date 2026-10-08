# epub-builder

EPUB 2.0.1 と EPUB 3.0 のファイルを作る TypeScript のライブラリ。Deno で動く。公開リポジトリ（MIT）。概要は README.md を参照。

## ADR

設計上の決定は `docs/adr/` に ADR として記録する。

- 後から理由を問われうる決定をしたら、実装と同じコミットで ADR を追加する
- ファイル名は `NNNN-kebab-case.md`（連番は 4 桁）とする
- 見出しは `# ADR NNNN: <決定を述べる一文>`、その下に `ステータス: 採択` を置く
- 節は「文脈」「実装すること」「実装しないこと」「テスト設計」「トレードオフ」とする
- コミット済みの ADR は変更不可。変えてよいのは `ステータス:` の行だけ。決定を覆すときは新しい ADR を追加し、元の ADR のステータスを `置換（ADR NNNN）` に変える
- コミット前の ADR は自由に直してよい。書き上げてからコミットする

## 境界

- 公開リポジトリなので、テストのフィクスチャに著作物（小説の本文など）を使わない。合成したデータで作る
- EPUB の仕様に沿うことを優先する。特定のリーダーや配信サービスに固有の拡張は、ADR で決めてから入れる

## ADR の保護

- コミット済み ADR の変更不可は hook で強制されている（ADR 0002）。Claude Code の hook（`.claude/settings.json`）が Edit / Write を止め、Bash の後に違反を差し戻す。git の pre-commit（`.githooks/pre-commit`）がコミットを拒否する。hook を迂回しない（`--no-verify` を使わない）
- hook の判定は `scripts/adr-guard.ts`。テストは `deno task test`
