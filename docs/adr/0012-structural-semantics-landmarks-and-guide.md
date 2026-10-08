# ADR 0012: 部・章・節の構造を、EPUB 3.0 では本文の `epub:type`、見出しごとの `section` 要素、landmarks で、EPUB 2.0.1 では guide で表す

ステータス: 置換（ADR 0013）

## 文脈

この ADR は ADR 0011 を置き換える。
ADR 0011 は ADR 0010 の全体を写して EPUB 3.0 の `landmarks` を加えたもので、EPUB 2.0.1 の `guide` は作らないとした。
しかし、EPUB 2.0.1 にしか対応しないリーダーでも、表紙や本文の始まりへ移れるようにしたい。OPF 2.0.1 の `guide` は、`landmarks` と同じ役目を持つ。
そこで、ADR 0011 の決定に `guide` を加え、決定の全体をこの ADR に写す。
`guide` に文書の役割が要るため、ADR 0011 では EPUB 3.0 だけで付けていた `loadBook` の `epubType` を、EPUB 2.0.1 でも付けるように改める。ほかの決定の中身は変えない。

ADR 0010 では、EPUB 3 の `landmarks` を作らないとした。
しかし、文書の役割（表紙、本文、後付け）を `epub:type` で付けるようになったため、それをもとに、リーダーが表紙や本文の始まりへ移れる `landmarks` を作れる（ADR 0011）。

ADR 0009 では、ディレクトリの構造（部、章）と文書の中の見出し（節）から目次を作るとした。
しかし、本文の文書そのものには、どれが部の扉で、どれが章で、どこからどこまでが節かという構造が書かれていない。
EPUB 3.0 では、構造の意味を `epub:type`（EPUB 3 Structural Semantics Vocabulary）で示せ、HTML の `section` 要素で節のまとまりを表せる。
リーダーや支援技術は、これを使って文書の役割を読み取れる。

EPUB 2.0.1（OPS 2.0.1）の本文には `epub:type` も `section` 要素もない。

## 実装すること

### 本を表す値

- 章（`Chapter`）と表紙の文書（`cover`）に、文書の役割を表す `epubType` を持てるようにする。値は、空白で区切った `epub:type` の語の並びとする
- `buildEpub` は、EPUB 3.0 では、`epubType` を内容文書の `body` 要素の `epub:type` 属性に書く。EPUB 2.0.1 では属性を書かず、`guide` を作るためにだけ使う
- `buildEpub` は、`epubType` が空白だけでないこと、XML で使えない文字を含まないことを調べ、満たさなければ例外とする。語が語彙にあるかは調べない

### loadBook が付ける役割

`loadBook` は、渡した版に関わらず、次の `epubType` を付ける。

| 文書                                             | `epubType`            |
| ------------------------------------------------ | --------------------- |
| 表紙（`meta/cover`）                             | `frontmatter cover`   |
| `body/` の直下のディレクトリの `index`（部の扉） | `bodymatter part`     |
| それより深いディレクトリの `index`               | `bodymatter division` |
| `body/` のほかの文書                             | `bodymatter chapter`  |
| 奥付（`meta/colophon`）                          | `backmatter colophon` |

EPUB 2.0.1 では、`buildEpub` が `epubType` を本文に書かないため、本文は変わらない。`guide` にだけ使う。

### 節の section 要素

- `loadBook` に `version: "3.0"` を渡したとき、本文の直下（ほかの要素の中でない位置）にある見出しのうち、ADR 0009 で節にしたものごとに、その見出しから始まるまとまりを `section` 要素で囲む
  - まとまりは、その見出しから、同じかより小さいレベルの数の、次の節の見出しの前までとする
  - 入れ子は見出しのレベルで決める。`h2` の節の中に `h3` の節を入れる
  - 文書の題名に使った見出しと、それより前の内容は、`section` で囲まない
  - 脚注の欄（`<div class="footnotes">`）の前で、開いている `section` をすべて閉じる
- 節の `id` は、ADR 0009 のとおり見出しの要素に置き、`section` 要素には付けない。目次の行き先は変わらない
- ほかの要素の中にある見出し（`div` や `blockquote` の中など）は、目次の節にはなる（ADR 0009）が、`section` で囲まない。まとまりの範囲が要素の境界をまたぐためである
- `section` 要素に `epub:type` は付けない
- `version: "2.0.1"` では囲まない

### landmarks

- `buildEpub` は、EPUB 3.0 では、ナビゲーション文書に、目次の `nav` の後に `<nav epub:type="landmarks" hidden="">` を書く。EPUB 2.0.1 では書かない
- 項目は次の順とし、行き先がある項目だけを書く

| 項目の `epub:type` | 行き先                                                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `cover`            | 表紙の文書（`book.cover`）                                                                                              |
| `bodymatter`       | `epubType` に `bodymatter` を含む最初の章の文書。そのような章がなければ、最初の章の文書（表紙を除く読み順の最初の文書） |
| `backmatter`       | `epubType` に `backmatter` を含む最初の章の文書                                                                         |

- 項目の表示名は、書誌情報の言語で決める。言語が `ja` か `ja-` で始まるときは「表紙」「本文」「後付け」、それ以外は「Cover」「Start of Content」「Back Matter」とする
- `hidden` を付け、リーダーが本文として表示しないようにする
- 目次（`toc`）の項目は書かない。ナビゲーション文書は読み順（spine）に入れない（ADR 0009）ため、landmarks から指すと EPUBCheck で誤り（RSC-011）になる
- `loadBook` の役割（`epubType`）は上の表のとおりなので、`loadBook` で読んだ本では、表紙、本文の最初の文書、奥付が landmarks に入る

### guide

- `buildEpub` は、EPUB 2.0.1 では、パッケージ文書の `spine` の後に `<guide>` を書く。EPUB 3.0 では書かない
- 項目は次の順とし、行き先がある項目だけを書く

| `reference` の `type` | 行き先                                        |
| --------------------- | --------------------------------------------- |
| `cover`               | 表紙の文書（`book.cover`）                    |
| `text`                | landmarks の `bodymatter` と同じ文書          |
| `colophon`            | `epubType` に `colophon` を含む最初の章の文書 |

- `title` は、書誌情報の言語で決める。言語が `ja` か `ja-` で始まるときは「表紙」「本文」「奥付」、それ以外は「Cover」「Start of Content」「Colophon」とする
- 目次（`toc`）の項目は書かない。OPF 2.0.1 の `guide` は XHTML の文書を指すものだが、EPUB 2.0.1 では目次を NCX だけで持ち、目次の XHTML の文書がないためである
- `loadBook` で読んだ本では、表紙、本文の最初の文書、奥付が `guide` に入る

## 実装しないこと

- EPUB 2.0.1 で、`div` などを使って構造を表すことはしない
- `epub:type` の語を、本文の内容（「プロローグ」「あとがき」などの題名）から推し量ることはしない
- `book.toml` やファイルの名前で、文書の役割を指定する手段は持たない
- landmarks と `guide` の表示名を設定で変える手段は持たない。日本語と英語のほかの言語でも英語で書く
- landmarks の `cover`、`bodymatter`、`backmatter`、`guide` の `cover`、`text`、`colophon` のほかの項目（`toc`、`titlepage`、`index` など）は書かない
- XHTML や HTML に直接書いた `section` 要素や `epub:type` を、書き換えたり取り除いたりすることはしない。直接書いた `section` の中の見出しは、ほかの要素の中の見出しとして扱う

## テスト設計

- `buildEpub` が、EPUB 3.0 では `epubType` を `body` の `epub:type` に書き、EPUB 2.0.1 では書かないこと
- `buildEpub` が、空白だけの `epubType` と XML で使えない文字を含む `epubType` を例外にすること
- `loadBook` が、どちらの版でも、表紙、部の扉、深いディレクトリの扉、章、奥付に、表のとおりの `epubType` を付けること
- 節の `section` 要素
  - 見出しのレベルによる入れ子と、レベルが飛ぶ場合
  - 文書の題名とそれより前の内容が囲まれないこと
  - 脚注の欄が `section` の外に出ること
  - ほかの要素の中の見出しが囲まれず、目次の節には残ること
  - 空の見出しなど、節にしない見出しが `section` を始めないこと
  - EPUB 2.0.1 では囲まないこと
- landmarks
  - EPUB 3.0 のナビゲーション文書に、表紙、本文、後付けの項目が、この順で、行き先がある項目だけ書かれること。目次の項目がないこと
  - `bodymatter` を含む章がないとき、最初の章の文書を本文の始まりにすること
  - 言語が `ja` のときと、それ以外のときの表示名
  - EPUB 2.0.1 では書かないこと
- guide
  - EPUB 2.0.1 のパッケージ文書に、表紙、本文、奥付の項目が、この順で、行き先がある項目だけ書かれること。目次の項目がないこと
  - `bodymatter` を含む章がないとき、最初の章の文書を本文の始まりにすること
  - 言語が `ja` のときと、それ以外のときの `title`
  - EPUB 3.0 では書かないこと
- フィクスチャから作った EPUB が、どちらの版でも EPUBCheck を誤りも警告もなく通ること

## トレードオフ

- EPUB 2.0.1 と EPUB 3.0 で、本文の構造が違う。同じ原稿でも、EPUB 3.0 には `section` 要素が加わる
- 見出しの直後から次の見出しまでを機械的に囲むため、原稿の意図と違うまとまりになることがある。たとえば、節の後に節に属さない段落を置きたい場合は表せない
- 役割の語は、ディレクトリの深さと文書の種類だけで決める。プロローグやあとがきも `chapter` になる
- landmarks の表示名は日本語と英語だけで、ほかの言語の本では英語になる
- landmarks と `guide` から目次へ移ることはできない。リーダーは目次をナビゲーション文書の `toc` や NCX から出す
- `loadBook` の `epubType` が EPUB 2.0.1 でも付くため、EPUB 2.0.1 を作るときに `book` の値を見ると、本文に書かれない `epubType` を持っている
- `section` で囲むため、`body > h2 + p` のように、本文の直下の要素の並びを前提にしたスタイルシートのセレクタは、EPUB 3.0 では効かなくなる
