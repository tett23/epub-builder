# ADR 0021: TypeScript でクラスを使わず、誤りと TOML の日時を値と関数で表す

ステータス: 採択

## 文脈

作者の全リポジトリに共通する方針（グローバルの CLAUDE.md）で、TypeScript ではクラスを使わないと定められた。
このリポジトリには、次の九つのクラスがある。

| クラス                                 | 場所                       | 公開               |
| -------------------------------------- | -------------------------- | ------------------ |
| `EpubInputError`（`Error` を継承）     | `src/types.ts`             | `mod.ts` から公開  |
| `TomlDateTime`                         | `src/load/toml.ts`         | `load.ts` から公開 |
| `TomlError`（`Error` を継承）          | `src/load/toml.ts`         | `load.ts` から公開 |
| `Parser`（TOML の解析器）              | `src/load/toml.ts`         | 非公開             |
| `XmlError`（`Error` を継承）           | `src/load/xml-fragment.ts` | 非公開             |
| `FragmentParser`（XML の断片の解析器） | `src/load/xml-fragment.ts` | 非公開             |
| `ConversionError`（`Error` を継承）    | `src/load/xhtml-writer.ts` | 非公開             |
| `Writer`（XHTML の書き出し器）         | `src/load/xhtml-writer.ts` | 非公開             |
| `UsageError`（`Error` を継承）         | `src/cli.ts`               | 非公開             |

公開しているものは、使う側が `instanceof EpubInputError` などで判別している。クラスをやめると、この判別の書き方が変わる。
まだリリースしておらず（`v` のタグがない）、公開 API を変えても影響を受ける利用者はいない。

## 実装すること

### データ構造：誤り

- 誤りは、標準の `Error` のオブジェクトに、種類を表す `name` と、種類ごとの情報を加えた値とする。自前のクラスは作らない
- 種類ごとに、型、作る関数、判別する関数を置く

| 種類         | 型                | 作る関数                                   | 判別する関数               | 加える情報         |
| ------------ | ----------------- | ------------------------------------------ | -------------------------- | ------------------ |
| 入力の誤り   | `EpubInputError`  | `epubInputError(message)`                  | `isEpubInputError(value)`  | なし               |
| TOML の誤り  | `TomlError`       | `tomlError(message, line, column)`         | `isTomlError(value)`       | `line`、`column`   |
| XML の誤り   | `XmlError`        | `xmlError(message, line, column)`          | `isXmlError(value)`        | `line`、`column`   |
| 変換の誤り   | `ConversionError` | `conversionError(message, line?, column?)` | `isConversionError(value)` | `line?`、`column?` |
| 使い方の誤り | `UsageError`      | `usageError(message)`                      | `isUsageError(value)`      | なし               |

- 型は `Error & { name: '<種類>'; ... }` とする。判別する関数は、`Error` のインスタンスであり、`name` が種類の名前であることで判別する
- メッセージ（`message`）は、これまでと同じ文字列とする
- `mod.ts` から `EpubInputError`（型）、`epubInputError`、`isEpubInputError` を、`load.ts` から `TomlError`（型）、`tomlError`、`isTomlError` を公開する。`instanceof EpubInputError` と `instanceof TomlError` は使えなくなる

### データ構造：TOML の日時

- `TomlDateTime` は、クラスでなく、`kind`、`text`、オフセット付きの日時のときの `date` を持つ、変更できない値とする
- 表（`TomlTable`）と区別するため、`Symbol.for('epub-builder.toml-date-time')` をキーとする目印を持たせる。TOML の表は、文字列のキーしか持たないため、目印と重ならない
- 判別する関数 `isTomlDateTime(value)` を公開する。`instanceof TomlDateTime` と `toString()` は使えなくなる（`toString()` の代わりに `text` を使う）

### アルゴリズム：解析器と書き出し器

- TOML の解析器、XML の断片の解析器、XHTML の書き出し器は、クラスの代わりに、状態（読んでいる位置など）を閉じ込めた関数の組とする。解析と書き出しの規則、誤りのメッセージと位置は変えない

### クラスを使わないことの検査

- `src/`、`mod.ts`、`load.ts`、`cli.ts`、`scripts/`、`test/` の TypeScript に、`class` による宣言と式がないことを、テストで調べる

## 実装しないこと

- 誤りの種類ごとの判別を、`name` の文字列のほか（コード番号など）で行うことはしない
- 誤りのメッセージや位置の書き方を変えることはしない
- 標準のクラス（`Error`、`Map`、`TextDecoder` など）を `new` で作ることは禁じない。禁じるのは自前のクラスの定義である
- 依存のライブラリの中のクラスには手を入れない

## テスト設計

- これまでのテストを、`instanceof` による判別から、判別する関数による判別に書き換え、すべて通ること
- 誤りの種類ごとに、作る関数で作った値が、`Error` のインスタンスであること、`name` と加える情報を持つこと、判別する関数で真になり、ほかの種類の判別する関数で偽になること、`throw` して `catch` できること
- `isTomlDateTime` が、日時で真、表、配列、文字列、`null` で偽になること。日時の値を変更できないこと
- TOML の解析器、XML の断片の解析器、XHTML の書き出し器のテスト（これまでのもの）が、書き換えの後も同じ結果で通ること
- `class` の宣言と式がソースにないこと

## トレードオフ

- 公開 API の互換性が壊れる。`instanceof EpubInputError`、`instanceof TomlError`、`instanceof TomlDateTime` を使うコードは、判別する関数に書き換える必要がある
- 判別を `name` の文字列で行うため、ほかのライブラリが同じ `name` の誤りを投げると区別できない
- 解析器を関数の組にするため、状態を持つ変数がクロージャの中に散らばる
