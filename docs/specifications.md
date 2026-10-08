# epub-builder の仕様

この文書は、現在の実装が満たす仕様をまとめたものである。
決定の理由は ADR に記録しており、この文書では繰り返さない。

- ADR 0003：対応する仕様と、版ごとの出力の構成
- ADR 0004：公開 API と zip の書き出し
- ADR 0014：ディレクトリから本を読む方法、本文の変換、ルビと脚注、ファイル名の空白、警告、節、部・章・節の意味づけ、landmarks、guide、扉、後付け（ADR 0005 から 0013 を置き換えた）
- ADR 0016：コマンドライン（ADR 0015 を置き換えた）

この文書と ADR が食い違う場合は、ADR を正とする。

## 目次

1. 概要
2. 公開するモジュールと関数
3. 本を表す値（`Book`）
4. EPUB の出力
5. ディレクトリの構成（`loadBook`）
6. 書誌情報（`book.toml`）
7. 並びと読み順
8. 目次
9. 本文の形式と変換
10. ルビ
11. 脚注
12. スタイルシートと画像、参照の書き換え
13. 部・章・節の意味づけ、landmarks、guide
14. 誤りと警告の扱い
15. id と class
16. コマンドライン
17. 扱わないこと
18. 試験

## 1. 概要

EPUB 2.0.1 と EPUB 3.0 のファイルを作る TypeScript のライブラリで、Deno で動く。
使い方は二通りある。

- 本を表す値（`Book`）を組み立てて `buildEpub` に渡す。
- 決まった形に並べたディレクトリを `loadBook` で読んで `Book` を得て、`buildEpub` に渡す。

```ts
import { buildEpub } from './mod.ts';
import { loadBook } from './load.ts';

const book = await loadBook('path/to/project', { version: '3.0' });
await Deno.writeFile('book.epub', await buildEpub(book, { version: '3.0' }));
```

`loadBook` と `buildEpub` には同じ版を渡す。
ルビと脚注の書き出し方は版で違い、`loadBook` の時点で決まるためである。

## 2. 公開するモジュールと関数

| モジュール | 公開するもの                                                                                      | 外部の依存             |
| ---------- | ------------------------------------------------------------------------------------------------- | ---------------------- |
| `mod.ts`   | `buildEpub`、`Book` などの型、`EpubInputError`                                                    | なし                   |
| `load.ts`  | `loadBook`、`LoadOptions`、`LoadWarning`、`parseToml`、`TomlDateTime`、`TomlError`、TOML の値の型 | unified 系のライブラリ |

### `buildEpub(book, options): Promise<Uint8Array>`

- `options.version` は `"2.0.1"` か `"3.0"`。
- EPUB のファイルの中身を返す。ファイルに書くかどうかは呼び出し側が決める。
- 入力に誤りがあれば、EPUB を作る前に `EpubInputError` を投げる。
- 同じ入力からは、同じバイト列を作る。ただし `metadata.modified` を省くと呼んだ時刻を使うため、呼ぶたびに変わる。

### `loadBook(dir, options): Promise<Book>`

- `dir` はプロジェクトのディレクトリ。末尾の `/` はあってもよい。
- `options.version` は `"2.0.1"` か `"3.0"`。
- 誤りがあれば `EpubInputError` を投げる。メッセージは、ファイルのパスと、分かる場合は行と列を先頭に持つ（例：`body/a.xhtml:2:4: 終了タグ p が開始タグと合わない`）。
- `options.onWarning` に関数を渡すと、警告（`LoadWarning`）をその関数で受け取る。渡さなければ `console.warn` に `警告: <パス>[:<行>:<列>]: <メッセージ>` の形で書く。警告では処理を止めない。

```ts
interface LoadWarning {
  code: 'renamed-file' | 'mathml-in-epub-2' | 'ruby-in-epub-2';
  path: string; // プロジェクトからの相対パス（元のファイルの名前）
  line?: number;
  column?: number;
  message: string;
}
```

### `parseToml(src): TomlTable`

- TOML 1.0.0 の文書を解析する。誤りは `TomlError`（`line`、`column` を持つ）を投げる。
- 値の型は次のとおり。

| TOML             | TypeScript                                                                                                                              |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 文字列           | `string`                                                                                                                                |
| 整数             | `number`（安全な整数の範囲）、`bigint`（それを超える 64 ビットの範囲）                                                                  |
| 浮動小数点数     | `number`（`inf`、`nan` を含む）                                                                                                         |
| 真偽値           | `boolean`                                                                                                                               |
| 日時の 4 種      | `TomlDateTime`（`kind` が `offset-date-time`、`local-date-time`、`local-date`、`local-time`。オフセット付きの日時だけが `date` を持つ） |
| 配列             | 配列                                                                                                                                    |
| 表、インライン表 | 通常のオブジェクト                                                                                                                      |

- `__proto__` などの名前のキーも、オブジェクト自身のプロパティとして置く。プロトタイプは変えない。
- 閏秒（`:60`）は書いたとおりの文字列を `text` に残し、`date` は 59 秒の時点にする。

## 3. 本を表す値（`Book`）

```ts
interface Book {
  metadata: {
    identifier: string; // 必須
    title: string; // 必須
    language: string; // 必須
    authors?: string[];
    publisher?: string;
    description?: string;
    modified?: Date; // 省略したら呼んだ時刻
  };
  pageProgressionDirection?: 'ltr' | 'rtl';
  stylesheets?: { path: string; content: string }[];
  images?: { path: string; mediaType: ImageMediaType; data: Uint8Array }[];
  coverImage?: string; // images のいずれかのパス
  cover?: { body: string; epubType?: string; stylesheets?: string[] }; // 表紙の文書
  titlepage?: { body: string; epubType?: string; stylesheets?: string[] }; // 扉の文書
  chapters: Chapter[]; // 一つ以上
}

interface Chapter {
  title: string;
  body?: string; // XHTML の body の中身。省くと文書を持たない項目になる
  epubType?: string; // EPUB 3.0 の body の epub:type（空白で区切った語）
  stylesheets?: string[]; // stylesheets のいずれかのパス
  sections?: Section[]; // 本文の中の節。目次で children より前に置く
  children?: Chapter[];
}

interface Section {
  title: string;
  id: string; // 章の本文の中の、節の見出しの id
  children?: Section[];
}
```

- `ImageMediaType` は `image/jpeg`、`image/png`、`image/gif`、`image/svg+xml`。
- スタイルシートと画像のパスは、EPUB の中の `OEBPS/` からの相対パスである。
- `body` は XHTML の `body` の中身（断片）で、`buildEpub` は検査しない。正しい XHTML を渡すのは呼び出し側の責任である。
- 文書を持たない章（`body` を省いた章）は、子を一つ以上持たなければならない。目次では、最初の子孫の文書を指す。
- 節（`Section`）は、章の項目の下に、子の章より前に置き、`<章の文書>#<id>` を指す。

### 値の検査

`buildEpub` は、EPUB を作る前に次を調べ、誤りがあれば `EpubInputError` を投げる。

- 版が `"2.0.1"` か `"3.0"` であること。
- `identifier`、`title`、`language` が空白だけでない文字列であること。著者が空でないこと。
- `modified` が正しい日時であること。
- 書誌情報と章の題名に、XML で使えない文字（制御文字、対にならないサロゲートなど）がないこと。
- `pageProgressionDirection` が `ltr` か `rtl` であること。
- パスが正しいこと。空でない、`/` で始まらない、`\` を含まない、空の区切りや `.`、`..` を含まない。
- パスが、ライブラリの使うパス（`content.opf`、`toc.ncx`、`nav.xhtml`、`text/` の下）と重ならないこと。
- パスが互いに重ならないこと。比べるときは NFC に正規化し、大文字と小文字を区別しない。
- 画像のメディアタイプが上の 4 種であること。
- `coverImage`、章と表紙の `stylesheets` が、存在するパスを指すこと。
- 章が一つ以上あり、題名が空白だけでないこと。
- `epubType` が空白だけでなく、XML で使えない文字を含まないこと。語が語彙にあるかは調べない。
- 節を持つ章が本文を持つこと。節の題名が空白だけでないこと。節の `id` が空でなく、空白類と `#` を含まず、本文の中に `id="<id>"` があること。

## 4. EPUB の出力

### zip の構成

項目は次の順で書く。

1. `mimetype`（内容は `application/epub+zip`、圧縮しない、追加の項目なし）
2. `META-INF/container.xml`（`OEBPS/content.opf` を指す）
3. `OEBPS/content.opf`
4. `OEBPS/toc.ncx`
5. `OEBPS/nav.xhtml`（EPUB 3.0 だけ）
6. `OEBPS/text/` の内容文書（読み順）
7. スタイルシート、画像（`OEBPS/` の下に、`Book` のパスのまま）

zip の書き方は次のとおり。

- 圧縮は deflate。圧縮して小さくならない項目は stored のままにする。
- ファイル名は UTF-8 で書く。ASCII 以外を含む名前にだけ UTF-8 のフラグを立てる。
- 日時は `metadata.modified`（省略したら呼んだ時刻）を、DOS の形式で UTC として書く。1980 年より前は 1980 年にする。
- ZIP64 と暗号化は扱わない。4 GiB を超える場合、または項目が 65535 を超える場合は例外とする。

### 内容文書の名前と ID

- 内容文書は、読み順の番号を 4 桁以上にゼロ詰めした名前（`0001.xhtml`、`0002.xhtml` …）で `OEBPS/text/` に置く。文書が 10000 以上あるときは、桁を文書の数に合わせる。
- 読み順は、表紙（`cover`）、扉（`titlepage`）、章を深さ優先でたどった順（章自身の文書を子より先に）である。
- manifest の ID は、内容文書が `doc-0001` …、スタイルシートが `css-1` …、画像が `img-1` …、NCX が `ncx`、ナビゲーション文書が `nav`。
- パッケージの識別子の ID は `bookid`。

### 版ごとの違い

|                            | EPUB 2.0.1                                   | EPUB 3.0                                                                   |
| -------------------------- | -------------------------------------------- | -------------------------------------------------------------------------- |
| パッケージ文書の `version` | `2.0`                                        | `3.0`                                                                      |
| 更新日時                   | `<dc:date opf:event="modification">`（日付） | `<meta property="dcterms:modified">`（秒まで、UTC）                        |
| 著者                       | `<dc:creator opf:role="aut">`                | `<dc:creator>`                                                             |
| 表紙の画像                 | `<meta name="cover" content="…">`            | `properties="cover-image"`                                                 |
| landmarks、guide           | `guide`（cover、title-page、text、colophon） | ナビゲーション文書の landmarks（cover、titlepage、bodymatter、backmatter） |
| 頁送りの向き               | 書かない                                     | spine の `page-progression-direction`                                      |
| 目次                       | NCX                                          | ナビゲーション文書と NCX                                                   |
| 内容文書                   | XHTML 1.1 の DOCTYPE                         | `<!DOCTYPE html>`、`xmlns:epub` を宣言                                     |
| 内容文書の `properties`    | なし                                         | インラインの SVG を含めば `svg`、MathML を含めば `mathml`                  |
| `body` の `epub:type`      | 書かない                                     | `epubType` を書く                                                          |

- 内容文書の `html` 要素には `xml:lang`（EPUB 3.0 では `lang` も）に書誌情報の言語を書く。
- 内容文書の `title` は、章の題名（表紙と扉は本の題名）とする。
- スタイルシートは、`../` から始まる相対パスの `link` 要素で参照する。パスは区切りごとにパーセントエンコードする。
- 書誌情報、題名、属性の値は、XML の実体参照に直して書く。

### 目次の書き出し

- NCX の `navPoint` の `playOrder` は、行き先（断片識別子を含む）が同じなら同じ値にし、目次に現れる順に 1 から振る。節は同じ文書の中でも行き先が違うため、別の値になる。
- 節の行き先の断片識別子は、`id` をパーセントエンコードして書く。
- `dtb:depth` は目次の入れ子の深さとする。
- ナビゲーション文書は `<nav epub:type="toc" id="toc">` の中に `ol` を入れ子にして書く。見出しは書かない。読み順（spine）には入れない。
- EPUB 3.0 のナビゲーション文書には、目次の後に landmarks を書く（13 節）。
- 表紙と扉は目次に入れない。

## 5. ディレクトリの構成（`loadBook`）

```
<project>/
  book.toml          書誌情報（必須）
  body/              本文（必須）
    01-prologue.md
    02-part1/
      index.md       部の扉（任意）
      01-first.md
      02-second.xhtml
      03-third.html
  meta/              表紙、扉、後付け、奥付（任意）
    cover.md
    titlepage.md
    afterword.md
    colophon.xhtml
  assets/            スタイルシートと画像（任意）
    style.css
    images/cover.jpg
```

- プロジェクトの直下で読むのは `book.toml`、`body/`、`meta/`、`assets/` だけである。ほかのファイルとディレクトリは無視する。
- `body/`、`meta/`、`assets/` の下では、名前が `.` で始まるファイルとディレクトリ（`.DS_Store`、`.gitkeep` など）を無視する。
- ファイルとディレクトリの名前は NFC に正規化して扱う。
- シンボリックリンクは、指す先のファイルやディレクトリとして扱う。
- 拡張子の大文字と小文字は区別する（`.MD`、`.JPG` は使えない）。
- ファイルはすべて UTF-8 で書く。UTF-8 でなければ例外とする。

### `body/`

- 本文のファイルの拡張子は `.md`、`.xhtml`、`.html` のいずれか。ほかの拡張子は例外とする。
- サブディレクトリを作ってよい。深さに制限はない。
- 同じディレクトリに、拡張子を除いて同じ名前のファイルが二つ以上あれば例外とする。
- `body/` がない、本文のファイルが一つもない、中身のないサブディレクトリがある場合は例外とする。

### `meta/`

- 表紙 `cover`、扉 `titlepage`、後付け、奥付 `colophon` を、`.md`、`.xhtml`、`.html` のいずれかで置ける。どれも任意。
- 後付けの名前は次のとおり。読み順は本文の後、奥付の前で、表の順とする。

| 名前              | 後付け     |
| ----------------- | ---------- |
| `afterword`       | あとがき   |
| `acknowledgments` | 謝辞       |
| `appendix`        | 付録       |
| `bibliography`    | 参考文献   |
| `glossary`        | 用語集     |
| `index`           | 索引       |
| `copyright-page`  | 著作権表示 |

- `meta/` の `index` は索引であり、`body/` のディレクトリの `index`（部の扉）とは別の意味である。
- 同じ種類の後付けは一つだけ置ける。表紙、扉、後付け、奥付以外の付き物（前書き、凡例、献辞など）は、本文として `body/` に置く。
- 扉は、置いた文書をそのまま使う。書誌情報から扉を自動で作ることはしない。
- ほかの名前のファイル、サブディレクトリ、拡張子を除いて同じ名前の組があれば例外とする。

### `assets/`

- サブディレクトリを作ってよい。
- 扱う拡張子は次に限る。ほかは例外とする。

| 拡張子          | メディアタイプ  |
| --------------- | --------------- |
| `.css`          | `text/css`      |
| `.jpg`、`.jpeg` | `image/jpeg`    |
| `.png`          | `image/png`     |
| `.gif`          | `image/gif`     |
| `.svg`          | `image/svg+xml` |

- `assets/` の下のファイルは、参照されていなくてもすべて EPUB に入れる。EPUB の中のパスは、プロジェクトからの相対パス（`assets/images/cover.jpg`）とする。

### ファイル名の空白

- `assets/` の下のファイルとディレクトリの名前に含まれる空白類は、一文字ずつ `_` に置き換えて EPUB に入れる（`assets/画像 集/図 1.png` は `assets/画像_集/図_1.png`）。EPUBCheck が空白を含む名前を警告（PKG-010）するためである。
- 空白類は、JavaScript の正規表現の `\s` に合う文字（ASCII の空白とタブ、改行、U+00A0、U+3000 など）とする。
- 本文の中の参照と `book.toml` の `cover_image` は、元の名前で書く。`loadBook` が置き換えた後のパスに書き換える。
- 名前を置き換えたファイルごとに、`renamed-file` の警告を出す。スタイルシートの `url()` は書き換えないため、`url()` で元の名前を指していると参照が切れる。
- 置き換えた結果、二つ以上のファイルが同じパスになる場合（`a b.png` と `a_b.png`、大文字と小文字だけ違うものを含む）は例外とする。
- 本文と `meta/` のファイルの名前は、EPUB の中では読み順の番号になるため、置き換えも警告もしない。
- `buildEpub` は、`Book` のパスを置き換えない。

## 6. 書誌情報（`book.toml`）

```toml
identifier = "urn:uuid:00000000-0000-0000-0000-000000000000"  # 必須
title = "題名"                                                # 必須
language = "ja"                                               # 必須
authors = ["著者"]
publisher = "出版者"
description = "説明"
modified = 2026-10-09T00:00:00Z
page_progression_direction = "rtl"
cover_image = "assets/images/cover.jpg"
```

| キー                         | 型                   | 説明                                                                   |
| ---------------------------- | -------------------- | ---------------------------------------------------------------------- |
| `identifier`                 | 文字列               | 必須。空白だけは不可                                                   |
| `title`                      | 文字列               | 必須                                                                   |
| `language`                   | 文字列               | 必須                                                                   |
| `authors`                    | 文字列の配列         |                                                                        |
| `publisher`                  | 文字列               |                                                                        |
| `description`                | 文字列               |                                                                        |
| `modified`                   | オフセット付きの日時 | タイムゾーンのない日時、日付だけ、時刻だけは例外。省略したら呼んだ時刻 |
| `page_progression_direction` | `"ltr"` か `"rtl"`   | EPUB 3.0 だけで使う                                                    |
| `cover_image`                | 文字列               | プロジェクトからの相対パスで、`assets/` の下の画像を指す               |

- 知らないキーは例外とする。
- 書誌情報の中ではルビの記法を解釈しない。書いた文字のまま使う。

## 7. 並びと読み順

- 同じディレクトリの中のファイルとサブディレクトリは、NFC に正規化した名前を Unicode の符号位置で比べて並べる。
- 数字を数として比べない。`10-` は `2-` より前に来るため、連番の桁はユーザーがそろえる。
- サブディレクトリは、その位置で中身を展開する（深さ優先）。
- サブディレクトリの中の `index`（`.md`、`.xhtml`、`.html`）は、名前の順に関わらず、そのディレクトリの最初の文書とする。`body/` の直下の `index` は普通の文書として扱う。
- 本全体の読み順は、`meta/cover`、`meta/titlepage`、`body/` の文書、`meta/` の後付け（5 節の表の順）、`meta/colophon` の順とする。

## 8. 目次

目次は、ディレクトリの構造（部、章）を上の段とし、その下に各文書の中の見出しを節として入れ子で続ける。

### ディレクトリと文書の項目

- `body/` のファイル一つを、目次の項目一つとする。
- サブディレクトリは子を持つ項目とする。
  - `index` があれば、その文書を項目の行き先とし、子には含めない。
  - なければ、ディレクトリの中の最初の文書（さらに下のディレクトリの中も含む）を行き先とする。
- 項目の題名は次の順で決める。
  1. 文書の最初の見出し（`h1` から `h6`、レベルは問わない。脚注の欄の中は除く）の文字列。タグを除き、ルビの読みと括弧（`rt`、`rp`、EPUB 2.0.1 の `class="rt"`、`class="rp"`）と脚注の参照を除く。HTML の空白（ASCII の空白類）の並びは一つの空白にまとめ、前後の空白を除く。全角空白などは残す。空になったら見出しがないものとする。
  2. 見出しがなければ、ファイルの名前から拡張子と先頭の連番を除いたもの。
- `index` のないディレクトリの題名は、ディレクトリの名前から先頭の連番を除いたものとする。
- 先頭の連番は、正規表現 `^[0-9]+[-_.]` に合う部分とする。除くと空になる場合（`01.md`）は除かない。
- 表紙と扉は目次に入れない。後付けは本文の項目の後に読み順に並べ、奥付は目次の最後の項目とする。後付けと奥付の題名も、文書の題名の規則で決める（見出しがなければ `afterword` などのファイルの名前）。

### 節（文書の中の見出し）

- 各文書の項目の下に、その文書の中の見出しを節として続ける。対象は、文書の題名に使った最初の見出しを除く、すべての `h1` から `h6` である。
- 入れ子はレベルで決める。ある見出しは、それより前にある、レベルの数がより小さい見出しのうち最も近いものの子とする。そのような見出しがなければ、文書の項目の直下に置く。レベルが飛んでもよい。
- ディレクトリの `index` の節は、そのディレクトリの項目の下に、子の項目より前に置く。
- 後付けと奥付の見出しも節にする。表紙と扉の見出しは節にしない（`id` も付けない）。
- 脚注の欄（`<div class="footnotes">`）の中の見出しは節にしない。
- 節の題名は、文書の題名と同じ規則で決める。空になる見出しは節にしない。
- 見出しに `id` があれば、それを行き先に使う。なければ、文書ごとに `sec-1`、`sec-2` … を文書の順に付け、本文の見出しに書き出す。本文に同じ `id` があれば、その番号を飛ばす。

例：

```
body/
  01-第一部/
    index.md       # 第一部 / ## 概要
    01-章.md       # 第一章 / ## 第一節 / ### 第一項 / ## 第二節
```

```
第一部                 text/0001.xhtml
├ 概要                 text/0001.xhtml#sec-1
└ 第一章               text/0002.xhtml
  ├ 第一節             text/0002.xhtml#sec-1
  │ └ 第一項           text/0002.xhtml#sec-2
  └ 第二節             text/0002.xhtml#sec-3
```

## 9. 本文の形式と変換

どの形式も、ファイルには `body` の中身（断片）を書く。
三つの形式は、いずれも HTML の構文木（hast）に読み、参照の書き換え、題名と節の取り出しを経て、自前の書き出し器で XHTML に書き出す。

### Markdown（`.md`）

- CommonMark として解釈する（`remark-parse`）。これにルビ（10 節）と脚注（11 節）の記法を加える。
- GFM のほかの記法（表、取り消し線、タスクリスト、自動リンクの拡張）は扱わない。書いた文字のまま出る。
- 生の HTML は、HTML Living Standard の構文として解析し（`rehype-raw`）、`.html` と同じ規則で変換する。

### XHTML（`.xhtml`）

- 自前の XML の解析器で読む。整形式でなければ、位置を示す例外とする。HTML として読み直すことはしない。
- 扱うのは、要素、属性、文字、コメント、CDATA 区間、事前定義の 5 つの実体参照（`&lt;` `&gt;` `&amp;` `&quot;` `&apos;`）、文字参照である。
- DOCTYPE、処理命令、事前定義のもの以外の実体参照（`&nbsp;` など）、接頭辞の付いた要素は例外とする。
- 断片は、既定の名前空間を XHTML とし、`xml:`、`xlink:`、EPUB 3.0 では `epub:` の接頭辞を宣言した中にあるものとして読む。断片の中で名前空間を宣言してもよい。
- 要素の名前空間は XHTML、SVG、MathML のいずれかに限る。

### HTML（`.html`）

- HTML Living Standard の断片の解析で読む（`rehype-parse`）。解析の誤りからの回復は HTML Living Standard の規則に従う（閉じ忘れた要素、引用符のない属性、誤った入れ子、`tbody` の補完など）。
- 名前付きの文字参照は文字に直す。
- `epub:type` のような接頭辞の付いた属性は、宣言済みの接頭辞（`xml`、`xlink`、EPUB 3.0 の `epub`）であれば、その名前空間の属性に直す。

### XHTML への書き出し

- 空要素（`br`、`img`、`hr` など）は `<br/>` の形で閉じる。XHTML のほかの空の要素は `<p></p>` の形で閉じる。SVG と MathML の空の要素は `<rect/>` の形で閉じる。
- 真偽の属性は、`open="open"` のように属性の名前を値として書く。
- SVG と MathML の根の要素に `xmlns` を付ける。SVG の `foreignObject` の中の XHTML の要素にも、XHTML の `xmlns` を付ける。
- `xlink:` の属性を使う要素に、`xmlns:xlink` を宣言する。
- 文字は `&`、`<`、`>` を、属性の値はさらに `"` を、実体参照に直す。

### XHTML に直せないもの

次の場合は、ファイルと位置を示す例外とする。Markdown の中の生の HTML にも当てはめる。

- 要素や属性の名前が XML の名前として正しくない、または知らない接頭辞を持つ。
- 要素の名前空間と違う `xmlns`、知らない接頭辞の宣言がある。
- 名前空間に直した後で、同じ要素に同じ属性が重なる。
- XML 1.0 で使えない文字がある。
- コメントの中身に `--` を含む、または `-` で終わる。
- 断片の中に `<!DOCTYPE>`、`html`、`head`、`body` がある（コメントの中は除く）。
- `template` 要素がある。

## 10. ルビ

Markdown の中だけで解釈する。XHTML と HTML では `ruby` 要素を直接書く。

### 記法

- `｜親文字《ルビ》`。`｜`（U+FF5C）の代わりに `|`（U+007C）でもよい。
- 親文字が漢字だけなら `漢字《かんじ》` と書ける。親文字は、`《` の直前から前に続く漢字の並びとする。漢字は、Unicode の `Script=Han` の文字（補助平面を含む）と、`々`、`〆`、`〇`、`ヶ`。
- 次の場合はルビとせず、書いたとおりの文字として出す。
  - 親文字かルビが空のとき
  - `｜` の後に `《…》` が続かないとき
  - `｜` と `《` の間に `｜`、`|`、`》` があるとき
  - ルビの中に `《`、`｜`、`|` を含むとき
  - `》` で閉じないとき
- `\《` は `《` という文字になる。
- 記法は一つの文字列のノードの中だけで解釈する。強調やリンクをまたぐ親文字は書けない。コードスパン、コードブロック、画像の代替文字、生の HTML の中は解釈しない。
- 親文字の全体にルビの全体を付ける（グループルビ）。

### 書き出し方

| 版         | 書き出し                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| EPUB 3.0   | `<ruby>漢字<rp>（</rp><rt>かんじ</rt><rp>）</rp></ruby>`                                                                                   |
| EPUB 2.0.1 | `<span class="ruby"><span class="rb">漢字</span><span class="rp">（</span><span class="rt">かんじ</span><span class="rp">）</span></span>` |

EPUB 2.0.1 では `ruby` 要素を書けないため（OPS 2.0.1 はルビのモジュールを含まない）、括弧書きの文字になる。
スタイルシートで `.ruby .rp { display: none; }` などとすれば、括弧を隠せる。
XHTML と HTML に直接書いた `ruby` 要素（Markdown の中の生の HTML を含む）は、EPUB 2.0.1 のために書き換えない。
EPUB 2.0.1 では、例外にせず `ruby-in-epub-2` の警告を要素ごとに出し、要素をそのまま出す（作った EPUB は EPUBCheck で誤りになる）。

### EPUB 2.0.1 の MathML

EPUB 2.0.1 の本文に MathML の `math` 要素があれば、例外にせず `mathml-in-epub-2` の警告を要素ごとに出し、要素をそのまま出す（作った EPUB は EPUBCheck で誤りになる）。
EPUB 3.0 では警告しない。

## 11. 脚注

Markdown の中だけで解釈する。

### 記法

GFM の脚注の記法で書く。

```markdown
本文[^ラベル]。

[^ラベル]: 注の本文。

    二段落目は字下げして続ける。
```

- ラベルは大文字と小文字を区別しない。
- 定義はリストや引用の中にあってもよい。

### 番号と配置

- 脚注は文書ごとに扱う。番号は文書ごとに 1 から、最初に参照した順に振る。ラベルの文字列は表示しない。
- 注の本文は、文書の末尾に `<div class="footnotes">` としてまとめて置く。
- 一つの注を二度以上参照してよい。注の本文からの戻りのリンクは最初の参照を指す。
- ID は、注の本文が `fn-<番号>`、参照が `fnref-<番号>`、二度目以降の参照が `fnref-<番号>-<回数>`。
- 番号のリンクは、注の本文の最初の段落の先頭に置く。最初が段落でなければ、番号のリンクだけの段落を先頭に足す。

### 書き出し方

| 版         | 参照                                                                                | 注の本文                                                                                              |
| ---------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| EPUB 3.0   | `<sup><a class="noteref" id="fnref-1" href="#fn-1" epub:type="noteref">1</a></sup>` | `<aside class="footnote" id="fn-1" epub:type="footnote"><p><a href="#fnref-1">1</a> 本文</p></aside>` |
| EPUB 2.0.1 | `<sup><a class="noteref" id="fnref-1" href="#fn-1">1</a></sup>`                     | `<div class="footnote" id="fn-1"><p><a href="#fnref-1">1</a> 本文</p></div>`                          |

### 誤り

次の場合は例外とする。

- 定義のない参照（エスケープした `\[^x]` とコードの中は除く）
- 参照されない定義
- 同じラベルの定義が二つ以上ある
- 注の本文の中の脚注の参照
- 生成する ID と、本文に書いた ID が重なる

## 12. スタイルシートと画像、参照の書き換え

### スタイルシート

- `assets/` の下のすべての `.css` を、すべての内容文書（表紙、扉、本文、後付け、奥付）に適用する。
- 順は、パスの符号位置の順とする。
- スタイルシートの中身は解析も書き換えもしない。ディレクトリの構成を保つため、`url()` の相対パスはそのまま使える。

### 参照の書き換え

`loadBook` は、文書の中の次の参照を、元のファイルの位置からの相対パスとして解決し、EPUB の中での位置からの相対パスに書き換える。

| 要素と属性                             | 指してよいもの                                      | 書き換えた後                                   |
| -------------------------------------- | --------------------------------------------------- | ---------------------------------------------- |
| `img` の `src`                         | `assets/` の下の画像                                | `../assets/…`（空白類は `_` に置き換えた名前） |
| SVG の `image` の `href`、`xlink:href` | `assets/` の下の画像                                | `../assets/…`                                  |
| `a` の `href`                          | `assets/` の下のファイル                            | `../assets/…`                                  |
| `a` の `href`                          | `body/`、`meta/` の文書（元のファイルの名前で書く） | `0003.xhtml` など                              |

- 断片識別子（`#…`）は保つ。指す先が文書の中にあるかは確かめない。
- パスはパーセントエンコードを解いてから解決し、NFC に正規化する。書き換えた後は、区切りごとにパーセントエンコードする。
- `#` だけの参照は書き換えない。
- `a` の `href` で、スキームを持つもの（`https:`、`mailto:`、`tel:` など）は書き換えない。
- 次の場合は例外とする。
  - `img` と SVG の `image` で、スキームを持つもの（外部の画像、`data:`）
  - `/` で始まる参照（`//` で始まるものを含む）
  - クエリ（`?`）を含む参照
  - パーセントエンコードが正しくない参照
  - プロジェクトの外を指す参照
  - 画像の参照で、`assets/` の下の画像でないものを指すもの
  - 指す先のファイルがない参照、ディレクトリを指す参照
- 上に挙げた要素と属性以外の参照（`srcset`、`style` 属性の `url()`、SVG の `a` の `xlink:href` など）は書き換えない。

## 13. 部・章・節の意味づけ、landmarks、guide

EPUB 3.0 では、構造の意味を `epub:type` と `section` 要素で本文に書き、ナビゲーション文書に landmarks を書く。
EPUB 2.0.1 の本文には `epub:type` も `section` 要素もないため、本文は変えず、パッケージ文書に guide を書く。

### 文書の役割

`Book` の章、表紙、扉の `epubType` を、EPUB 3.0 では内容文書の `body` 要素の `epub:type` に書く。EPUB 2.0.1 では本文に書かず、guide を作るためにだけ使う。
`loadBook` は、渡した版に関わらず、次の値を付ける。

| 文書                                             | `epub:type`                                        |
| ------------------------------------------------ | -------------------------------------------------- |
| 表紙（`meta/cover`）                             | `frontmatter cover`                                |
| 扉（`meta/titlepage`）                           | `frontmatter titlepage`                            |
| `body/` の直下のディレクトリの `index`（部の扉） | `bodymatter part`                                  |
| それより深いディレクトリの `index`               | `bodymatter division`                              |
| `body/` のほかの文書                             | `bodymatter chapter`                               |
| 後付け（`meta/afterword` など）                  | `backmatter <名前>`（`backmatter afterword` など） |
| 奥付（`meta/colophon`）                          | `backmatter colophon`                              |

- `index` のないディレクトリの項目は文書を持たないため、役割も持たない。
- 役割の語を、題名（「プロローグ」など）から推し量ることはしない。

### 節の section 要素

`loadBook` は、`version: "3.0"` のとき、本文の直下にある節の見出し（8 節で節にしたもの）ごとに、その見出しから始まるまとまりを `section` 要素で囲む。

- まとまりは、その見出しから、同じかより小さいレベルの数の、次の節の見出しの前までとする。入れ子はレベルで決める。
- 文書の題名に使った見出しと、それより前の内容は囲まない。
- 脚注の欄（`<div class="footnotes">`）の前で、開いている `section` をすべて閉じる。
- 節の `id` は見出しに置き、`section` には付けない。`section` に `epub:type` は付けない。
- ほかの要素の中の見出し（直接書いた `section`、`div`、`blockquote` の中など）は囲まない。目次の節にはなる。
- 空の見出しなど、節にしない見出しは `section` を始めない。

例：

```html
<body epub:type="bodymatter chapter">
  <h1>第一章</h1>
  <p>導入。</p>
  <section>
    <h2 id="sec-1">第一節</h2>
    <p>本文。</p>
    <section>
      <h3 id="sec-2">第一項</h3>
      <p>本文。</p>
    </section>
  </section>
  <div class="footnotes">…</div>
</body>
```

### landmarks

`buildEpub` は、EPUB 3.0 のナビゲーション文書に、目次の後に `<nav epub:type="landmarks" hidden="">` を書く。EPUB 2.0.1 では書かない。

| 項目              | 行き先                                                                  | 表示名（`ja`） | 表示名（ほか）   |
| ----------------- | ----------------------------------------------------------------------- | -------------- | ---------------- |
| `cover`           | 表紙の文書                                                              | 表紙           | Cover            |
| `titlepage`       | 扉の文書                                                                | 扉             | Title Page       |
| `bodymatter`      | `epubType` に `bodymatter` を含む最初の章の文書。なければ最初の章の文書 | 本文           | Start of Content |
| `backmatter`      | `epubType` に `backmatter` を含む最初の章の文書                         | 後付け         | Back Matter      |
| `afterword`       | `epubType` に `afterword` を含む最初の章の文書                          | あとがき       | Afterword        |
| `acknowledgments` | 同じく `acknowledgments`                                                | 謝辞           | Acknowledgments  |
| `appendix`        | 同じく `appendix`                                                       | 付録           | Appendix         |
| `bibliography`    | 同じく `bibliography`                                                   | 参考文献       | Bibliography     |
| `glossary`        | 同じく `glossary`                                                       | 用語集         | Glossary         |
| `index`           | 同じく `index`                                                          | 索引           | Index            |
| `copyright-page`  | 同じく `copyright-page`                                                 | 著作権表示     | Copyright        |
| `colophon`        | 同じく `colophon`                                                       | 奥付           | Colophon         |

- 行き先がある項目だけを、この順で書く。
- 表示名は、書誌情報の言語が `ja` か `ja-` で始まるときに日本語、それ以外は英語とする。
- 目次（`toc`）の項目は書かない。ナビゲーション文書は spine に入れないため、landmarks から指すと EPUBCheck で誤り（RSC-011）になる。
- `loadBook` で読んだ本では、表紙、扉、本文の最初の文書、後付けのそれぞれ、奥付が入る。

### guide

`buildEpub` は、EPUB 2.0.1 のパッケージ文書に、`spine` の後に `<guide>` を書く。EPUB 3.0 では書かない。

| `type`             | 行き先                                         | `title`（`ja`） | `title`（ほか）  |
| ------------------ | ---------------------------------------------- | --------------- | ---------------- |
| `cover`            | 表紙の文書                                     | 表紙            | Cover            |
| `title-page`       | 扉の文書                                       | 扉              | Title Page       |
| `text`             | landmarks の `bodymatter` と同じ文書           | 本文            | Start of Content |
| `other.afterword`  | `epubType` に `afterword` を含む最初の章の文書 | あとがき        | Afterword        |
| `acknowledgements` | 同じく `acknowledgments`                       | 謝辞            | Acknowledgments  |
| `other.appendix`   | 同じく `appendix`                              | 付録            | Appendix         |
| `bibliography`     | 同じく `bibliography`                          | 参考文献        | Bibliography     |
| `glossary`         | 同じく `glossary`                              | 用語集          | Glossary         |
| `index`            | 同じく `index`                                 | 索引            | Index            |
| `copyright-page`   | 同じく `copyright-page`                        | 著作権表示      | Copyright        |
| `colophon`         | 同じく `colophon`                              | 奥付            | Colophon         |

- 行き先がある項目だけを、この順で書く。項目が一つもなければ `guide` を書かない。
- OPF 2.0.1 の guide の型にない後付け（あとがき、付録）は `other.` を付けた型にする。謝辞の型は OPF 2.0.1 の綴り（`acknowledgements`）とする。
- `title` は、書誌情報の言語が `ja` か `ja-` で始まるときに日本語、それ以外は英語とする。
- 目次（`toc`）の項目は書かない。guide は XHTML の文書を指すものだが、EPUB 2.0.1 では目次を NCX だけで持つため。
- `loadBook` で読んだ本では、表紙、扉、本文の最初の文書、後付けのそれぞれ、奥付が入る。

例：

```xml
<guide>
<reference type="cover" title="表紙" href="text/0001.xhtml"/>
<reference type="title-page" title="扉" href="text/0002.xhtml"/>
<reference type="text" title="本文" href="text/0003.xhtml"/>
<reference type="colophon" title="奥付" href="text/0009.xhtml"/>
</guide>
```

## 14. 誤りと警告の扱い

- 誤りや曖昧さは黙って解決せず、`EpubInputError` を投げる。
- `loadBook` の誤りは、ファイルのパスと、分かる場合は `行:列` を先頭に付ける。
- 例外になる場合の一覧は、各節と `test/invalid-fixtures/` にある。
- 警告は、処理を止めずに `onWarning`（省略したら `console.warn`）で知らせる。警告になるのは次の三つである。

| `code`             | 場合                                              |
| ------------------ | ------------------------------------------------- |
| `renamed-file`     | `assets/` のファイル名の空白類を `_` に置き換えた |
| `mathml-in-epub-2` | EPUB 2.0.1 の本文に MathML がある                 |
| `ruby-in-epub-2`   | EPUB 2.0.1 の本文に `ruby` 要素がある             |

- 警告を誤りとして扱いたい場合は、`onWarning` の中で例外を投げる。
- 作った EPUB が EPUBCheck で誤りも警告もないことは、`mathml-in-epub-2` と `ruby-in-epub-2` の警告が出ない入力に対してだけ保証する。

## 15. id と class

### ライブラリが付ける id

| 場所                      | id                                    | 付け方                                                |
| ------------------------- | ------------------------------------- | ----------------------------------------------------- |
| パッケージ文書            | `bookid`                              | `dc:identifier` に付け、`unique-identifier` から指す  |
| パッケージ文書の manifest | `nav`、`ncx`                          | ナビゲーション文書（EPUB 3.0）と NCX                  |
| パッケージ文書の manifest | `doc-0001`、`doc-0002` …              | 内容文書。番号は文書の名前（`text/0001.xhtml`）と同じ |
| パッケージ文書の manifest | `css-1`、`css-2` …                    | スタイルシート。`Book.stylesheets` の順               |
| パッケージ文書の manifest | `img-1`、`img-2` …                    | 画像。`Book.images` の順                              |
| NCX                       | `np-1`、`np-2` …                      | `navPoint`。目次に現れる順                            |
| ナビゲーション文書        | `toc`                                 | 目次の `nav`                                          |
| 本文（Markdown の脚注）   | `fnref-<番号>`、`fnref-<番号>-<回数>` | 脚注の参照。二度目以降の参照に回数を付ける            |
| 本文（Markdown の脚注）   | `fn-<番号>`                           | 注の本文                                              |
| 本文（節の見出し）        | `sec-1`、`sec-2` …                    | `id` のない節の見出し。文書ごとに文書の順で付ける     |

- 本文の id は、文書（内容文書）ごとに一意であればよい。番号は文書ごとに 1 から振る。
- 脚注の id が、本文に書いた id と重なれば例外とする。
- 節の id は、本文に書いた id と重なる番号を飛ばす（`sec-1` があれば `sec-2` から付ける）。
- 題名に使った見出しと、表紙と扉の見出しには id を付けない。

### 本文に書いた id

- 書いたとおりに残し、書き換えない。
- 見出しに書いた id は、そのまま節の行き先に使う。
- 同じ文書の中で id が重なっていても、脚注の id との重なりのほかは調べない（EPUBCheck で誤りになる）。
- ほかの文書へのリンクの断片識別子（`02-second.md#scene-2` の `scene-2`）が、指す文書にあるかは調べない。

### ライブラリが付ける class

| class            | 要素                                     | 付ける場合                                        |
| ---------------- | ---------------------------------------- | ------------------------------------------------- |
| `noteref`        | `a`                                      | 脚注の参照（`sup` の中）                          |
| `footnotes`      | `div`                                    | 文書の末尾の、注の本文をまとめた欄                |
| `footnote`       | `aside`（EPUB 3.0）、`div`（EPUB 2.0.1） | 一つの注の本文                                    |
| `ruby`           | `span`                                   | EPUB 2.0.1 の Markdown のルビの全体               |
| `rb`、`rt`、`rp` | `span`                                   | EPUB 2.0.1 の Markdown のルビの親文字、読み、括弧 |

- `section` 要素と `body` 要素には class を付けない。役割は `epub:type` で示す（EPUB 3.0）。
- スタイルシートでは、たとえば次のように使える。

```css
.footnotes {
  margin-top: 2em;
  font-size: 0.9em;
}
.noteref {
  font-size: 0.7em;
}
.ruby .rp {
  display: none;
} /* EPUB 2.0.1 の括弧を隠す */
.ruby .rt {
  font-size: 0.5em;
}
```

### ライブラリが意味を読み取る class

次の class は、本文に書いた HTML や XHTML の要素に付けても、ライブラリが付けたものと同じに扱う。ほかの目的に使わない。

| class       | 扱い                                                                                                                                            |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `footnotes` | この class の要素の中の見出しは、題名にも節にもしない。EPUB 3.0 では、本文の直下にこの要素があると、その前で開いている `section` をすべて閉じる |
| `noteref`   | この class の要素の文字を、題名と節の題名から除く                                                                                               |
| `rt`、`rp`  | この class の要素の文字を、題名と節の題名から除く（`rt`、`rp` 要素と同じ）                                                                      |

## 16. コマンドライン

`cli.ts` が入口である。`deno task install`（`deno install -g -f --allow-read --allow-write --config deno.json -n epub-builder cli.ts`）で `epub-builder` というコマンドとして入れられ、`deno task cli <command>` でも動く。

### コマンド

| コマンド         | 働き                                                                                                                         |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `build [dir]`    | ディレクトリから EPUB を作り、ファイルに書く                                                                                 |
| `check [dir]`    | EPUB を書かずに、読み込みと `buildEpub` の検査だけを行い、誤りと警告を出す。誤りがなければ版ごとに `<版>: 誤りはない` を出す |
| `toc [dir]`      | 目次の木を、題名を二つの空白で字下げした入れ子で出す（表紙と扉は入らない）                                                   |
| `init [dir]`     | 新しい本の雛形を作る                                                                                                         |
| `help [command]` | 全体か、コマンドごとの使い方を出す                                                                                           |
| `version`        | CLI の版を出す                                                                                                               |

- `dir` を省くと、今のディレクトリを使う。

### オプション

| オプション                 | コマンド                | 働き                                                                                                                                                                                   |
| -------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-e`、`--epub-version <v>` | `build`、`check`、`toc` | 版。`2.0.1`、`3.0`、`all`（両方。`toc` では使えない）。既定は `3.0`                                                                                                                    |
| `-o`、`--output <path>`    | `build`                 | 出力するファイル。既定は `<dir の名前>.epub`（今のディレクトリ）。`all` では拡張子の前に版を付けた二つのファイル（`book-2.0.1.epub`、`book-3.0.epub`）。親のディレクトリがなければ作る |
| `--strict`                 | `build`、`check`        | 警告を誤りとして扱う。`build` では EPUB を書かない                                                                                                                                     |
| `-q`、`--quiet`            | `build`、`check`        | 警告を出さない                                                                                                                                                                         |
| `-t`、`--title <title>`    | `init`                  | 題名。既定はディレクトリの名前                                                                                                                                                         |
| `-l`、`--language <lang>`  | `init`                  | 言語。既定は `ja`                                                                                                                                                                      |
| `-h`、`--help`             | すべて                  | 使い方を出す                                                                                                                                                                           |
| `-V`、`--version`          | （コマンドの代わり）    | CLI の版を出す                                                                                                                                                                         |

### 出力と終了コード

- 結果（作ったファイルのパス、`check` の結果、目次、使い方、版）は標準出力に書く。
- 警告は標準エラー出力に `警告: <パス>[:<行>:<列>]: <メッセージ>` の形で書く。`all` では先頭に `[<版>]` を付ける。
- 入力の誤りは標準エラー出力に `誤り: <メッセージ>` の形で書く。
- 使い方の誤りは標準エラー出力に `使い方の誤り: <メッセージ>` と、そのコマンド（または全体）の使い方を書く。

| 終了コード | 場合                                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------------------- |
| 0          | 成功                                                                                                       |
| 1          | 入力の誤り（ディレクトリやファイルがない場合を含む）、`--strict` での警告、空でないディレクトリへの `init` |
| 2          | 使い方の誤り（コマンドがない、知らないコマンドやオプション、知らない版、値のないオプション、余分な引数）   |

- `build` で `all` を指定したときは、両方の版を作り終えてからファイルを書く。どちらかで誤りがあれば何も書かない。

### init が作る雛形

| ファイル              | 中身                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------ |
| `book.toml`           | `identifier`（`urn:uuid:` とランダムな UUID）、`title`、`language`。ほかのキーは注釈で示す |
| `body/01-はじめに.md` | 見出し、ルビ、脚注、節の例                                                                 |
| `meta/colophon.md`    | 奥付の例                                                                                   |
| `assets/style.css`    | 脚注と、EPUB 2.0.1 のルビの括弧のためのスタイル                                            |

- `dir` がなければ作る。`dir` が空でなければ、何も作らずに入力の誤りとする。

## 17. 扱わないこと

- 固定レイアウト、EPUB 3.1 以降に固有の機能、音声、動画、メディアオーバーレイ、スクリプト、フォントの難読化
- 特定のリーダーや配信サービスに固有の拡張
- EPUB を読むこと、書き換えること
- ストリームでの書き出し、ZIP64
- landmarks と guide に、表に挙げたほかの項目（`toc`、`preface` など）を書くこと、landmarks と guide の表示名の設定
- 表に挙げたほかの付き物（前書き、凡例、献辞など）を `meta/` に置くこと、同じ種類の後付けを二つ以上置くこと
- 書誌情報から扉を自動で作ること
- EPUB 2.0.1 で `div` などを使って部・章・節の構造を表すこと、`book.toml` やファイルの名前で文書の役割を指定すること
- 直接書いた `section` 要素や `epub:type` を書き換えたり取り除いたりすること
- 目次のページを読み順に入れること
- 目次を設定で明示すること、見出しの位置で文書を分割すること、節にする見出しのレベルを選ぶこと、見出しの番号付け
- GFM の表などの拡張記法、モノルビ、熟語ルビ、両側ルビ、後注
- 文書ごとにスタイルシートを選ぶこと
- フォント、音声、動画を `assets/` に置くこと
- 変換した XHTML が、版ごとの仕様（使える要素や属性）に合うかの検査。MathML と `ruby` 要素の警告（14 節）を除く
- 空白以外の、EPUBCheck が誤りや警告にするファイル名の文字（`"`、`*`、`:`、`<`、`>`、`?`、`\`、`|` など）の置き換えや検査
- `buildEpub` での警告
- CLI からの EPUBCheck の呼び出し、ファイルの変更の見張り（watch）、設定ファイルや環境変数によるオプション、色付きの出力

## 18. 試験

- `deno task test` で単体テストを走らせる。
- `test/fixtures/` のフィクスチャは、すべて合成したデータで、著作物を含まない。
  - `sample-book`：ADR の要素を一通り含む（表紙、扉、奥付を含む）
  - `edge-book`：深い入れ子、HTML の表と文字参照、インラインの SVG、JPEG、GIF、PNG、ASCII 以外の名前、実体参照が要る書誌情報
  - `epub3-book`：MathML と `epub:type`（EPUB 3.0 だけ）
  - `novel-book`：縦書き、rtl、三部構成の長編。ルビと脚注を多く含む。扉とあとがきを含む
  - `large-book`：151 の文書
  - `tech-book`：横書き、ltr、英語の技術書。コード、表、参照形式のリンク、章をまたぐリンク。後付け（謝辞、付録、参考文献、用語集、索引、著作権表示）を含む
  - `minimal-book`：必須のものだけ
  - `mixed-format-book`：同じ内容を三つの形式で書いたもの
  - `sections-book`：文書の中の見出しの節（深い入れ子、レベルの飛び、`id` の衝突、空の見出し、`index` と奥付の節）と、EPUB 3.0 の `section` と `epub:type`（部の扉、入れ子の扉）
- フィクスチャと作る版の一覧は `test/fixtures.ts` にある。テストは、一覧とディレクトリが合うことを確かめる。
- `test/__snapshots__/` に、各フィクスチャから作った EPUB の中身を記録している。出力を変えたときは `deno test --allow-read --allow-write --allow-run=git,unzip test/fixtures.test.ts -- --update` で更新し、差分を確かめる。
- `edge-book` には空白類を含む名前の画像を置き、置き換えた EPUB が EPUBCheck を通ることを確かめる。
- `test/invalid-fixtures/` の壊れたプロジェクトは、`expected-error.txt` の文字列を含む例外になることを、両方の版で確かめる。
- CI は、整形、lint、型検査、テストに加え、`deno task build:sample` で全フィクスチャから EPUB を作り、EPUBCheck に `--failonwarnings` を付けて掛ける。誤りも警告もないことを求める。
