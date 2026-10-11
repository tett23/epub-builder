# ADR 0023: hastscript を使わず、hast の要素を作る処理を自前で書き、依存を残すものと再実装するものを分ける

ステータス: 採択

## 文脈

作者の全リポジトリに共通する方針（グローバルの CLAUDE.md）で、ライセンスに問題がなく再実装が容易な依存は、依存に入れずに再実装すると定められた。必要な機能が限られる場合は、必要な機能だけを実装してよい。
ADR 0019 でも、unified 系のライブラリのうち、使う部分が小さく、テストで同じ結果になることを確かめられるものは再実装するとしている。

このリポジトリの実行時の依存は次のとおりである（開発時だけのものを除く）。

| 依存                                                                     | 使い方                                         | ライセンス |
| ------------------------------------------------------------------------ | ---------------------------------------------- | ---------- |
| `@std/cli`                                                               | CLI の引数の解析                               | MIT        |
| `unified`、`remark-parse`、`remark-rehype`、`rehype-raw`、`rehype-parse` | Markdown と HTML の解析                        | MIT        |
| `micromark-extension-gfm-footnote`、`mdast-util-gfm-footnote`            | 脚注の記法の解析                               | MIT        |
| `property-information`                                                   | hast の属性名と属性の対応                      | MIT        |
| `hastscript`                                                             | 自前の XML の断片の解析器で、hast の要素を作る | MIT        |

`@std/cli` は ADR 0022 で再実装する。この ADR では、残りの依存を見直す。

## 実装すること

- `hastscript` を依存から外す。XML の断片の解析器（`src/load/xml-fragment.ts`）で hast の要素を作る処理を、自前で書く
  - 属性の名前を hast のプロパティの名前にする対応（`class` を `className`、`xlink:href` を `xLinkHref` など）は、`property-information` の `find` を使う
  - `class` のように空白で区切った値を持つ属性は、`property-information` の情報（`spaceSeparated`、`commaSeparated`）にしたがって配列にする
  - SVG の要素では SVG の、ほかでは HTML の属性の対応表を使う
  - これまで `hastscript` で作っていた木と同じ木を作る
- 次の依存は残す。理由はそれぞれ次のとおり
  - `unified`、`remark-parse`、`remark-rehype`、`rehype-raw`、`rehype-parse`：CommonMark と HTML Living Standard の解析は小さくなく、再実装は容易でない（ADR 0019）
  - `micromark-extension-gfm-footnote`、`mdast-util-gfm-footnote`：micromark の構文の拡張であり、`remark-parse` と組で使う。単独で再実装すると、`remark-parse` との結び付きを自前で持つことになる
  - `property-information`：HTML と SVG の属性の対応表であり、`rehype-parse` が作る hast と同じ対応を使う必要がある。表を写すと、`rehype-parse` との食い違いが起きうる
- 開発時だけの依存（`@std/expect`、`@std/testing`）は、方針の対象（実行時の依存）に当たらないため残す
- `deno.json` の `imports` から `hastscript` を消す

## 実装しないこと

- unified 系の解析器、脚注の拡張、`property-information` の再実装はしない
- `hastscript` のセレクタの書き方（`h('div.foo')`）や子の正規化など、使っていない機能は実装しない

## テスト設計

- 自前の要素の作り方で、これまでの XML の断片の解析器のテストがすべて通ること
- `hastscript` で作った木と自前で作った木が同じになることを、代表的な場合（`class` の複数の値、`data-*`、`xml:lang`、`xlink:href`、SVG の大文字と小文字を含む属性、名前に `.` を含む要素）で確かめる。比べる相手として、テストの中でだけ `hastscript` を使うことはしない。期待する木をテストに書く

## トレードオフ

- 要素を作る処理を自前で持つため、hast の仕様が変わったときに追従する必要がある
- `property-information` に依存したままのため、実行時の依存は一つしか減らない
