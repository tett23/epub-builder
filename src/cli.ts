// コマンドラインの入口の処理（ADR 0018）

import { parseArgs } from '@std/cli/parse-args';
import { basename, resolve } from 'node:path';
import { buildEpub } from './epub.ts';
import { hasErrorName, type NamedError, namedError } from './errors.ts';
import { loadBook, type LoadWarning } from './load/load-book.ts';
import { type Book, type Chapter, epubInputError, type EpubVersion, isEpubInputError, type Section } from './types.ts';
import { VERSION } from './version.ts';

export interface Io {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

const defaultIo: Io = {
  stdout: (line) => console.log(line),
  stderr: (line) => console.error(line),
};

const EXIT_OK = 0;
const EXIT_INPUT = 1;
const EXIT_USAGE = 2;

/** 使い方の誤り（ADR 0021） */
export type UsageError = NamedError<'UsageError'>;

export function usageError(message: string): UsageError {
  return namedError('UsageError', message);
}

export function isUsageError(value: unknown): value is UsageError {
  return hasErrorName(value, 'UsageError');
}

const HELP: Record<string, string> = {
  '': `epub-builder ${VERSION}
ディレクトリから EPUB 2.0.1 と EPUB 3.0 のファイルを作る。

使い方:
  epub-builder <command> [options]

コマンド:
  build [dir]      ディレクトリから EPUB を作る（既定で 2.0.1 と 3.0 の両方）
  check [dir]      EPUB を書かずに、誤りと警告を調べる（既定で両方の版）
  toc [dir]        目次の木を表示する（既定で両方の版）
  init [dir]       新しい本の雛形を作る
  help [command]   使い方を表示する
  version          版を表示する

dir を省いたときは、今のディレクトリを使う。
コマンドごとの使い方は epub-builder help <command> で表示する。

オプション:
  -h, --help       使い方を表示する
  -V, --version    版を表示する`,
  build: `使い方:
  epub-builder build [dir] [options]

ディレクトリ（book.toml、body/、meta/、assets/）から EPUB を作る。
既定では EPUB 2.0.1 と EPUB 3.0 の両方を作る。

オプション:
  -e, --epub-version <v>  作る版。2.0.1、3.0、all（両方）のいずれか。既定は all
  -o, --output <path>     出力するファイル。既定は <dir の名前>.epub
                          両方の版を作るときは、拡張子の前に版を付けた二つのファイルを書く
                          （book.epub なら book-2.0.1.epub と book-3.0.epub）
      --strict            警告を誤りとして扱い、EPUB を書かずに終了コード 1 で終える
  -q, --quiet             警告を表示しない
  -h, --help              この使い方を表示する

例:
  epub-builder build my-book                  my-book-2.0.1.epub と my-book-3.0.epub を作る
  epub-builder build my-book -e 3.0           my-book.epub（EPUB 3.0）だけを作る
  epub-builder build my-book -o out/book.epub out/book-2.0.1.epub と out/book-3.0.epub を作る`,
  check: `使い方:
  epub-builder check [dir] [options]

EPUB を書かずに、ディレクトリを読み込んで、誤りと警告を調べる。
EPUBCheck は呼ばない。

オプション:
  -e, --epub-version <v>  調べる版。2.0.1、3.0、all（両方）のいずれか。既定は all
      --strict            警告を誤りとして扱い、終了コード 1 で終える
  -q, --quiet             警告を表示しない
  -h, --help              この使い方を表示する`,
  toc: `使い方:
  epub-builder toc [dir] [options]

目次の木を、題名の入れ子で表示する。表紙と扉は目次に入らない。
両方の版を扱うときは、版ごとに「EPUB <版>」の行の下に字下げして表示する。

オプション:
  -e, --epub-version <v>  目次を作る版。2.0.1、3.0、all（両方）のいずれか。既定は all
  -h, --help              この使い方を表示する`,
  init: `使い方:
  epub-builder init [dir] [options]

新しい本の雛形（book.toml、body/、meta/、assets/）を作る。
dir がなければ作る。dir が空でなければ、上書きを避けるため何もしない。

オプション:
  -t, --title <title>     題名。既定はディレクトリの名前
  -l, --language <lang>   言語。既定は ja
  -h, --help              この使い方を表示する`,
  help: `使い方:
  epub-builder help [command]

全体か、コマンドごとの使い方を表示する。`,
  version: `使い方:
  epub-builder version

版を表示する。`,
};

const COMMANDS = ['build', 'check', 'toc', 'init', 'help', 'version'];

interface Parsed {
  positional: string[];
  options: Record<string, unknown>;
}

function parse(
  args: string[],
  spec: { string?: string[]; boolean?: string[]; alias?: Record<string, string> },
): Parsed {
  const known = new Set([...(spec.string ?? []), ...(spec.boolean ?? []), ...Object.keys(spec.alias ?? {})]);
  const options = parseArgs(args, {
    string: spec.string,
    boolean: [...(spec.boolean ?? []), 'help'],
    alias: { ...spec.alias, h: 'help' },
    unknown: (arg) => {
      if (arg.startsWith('-') && !known.has(arg.replace(/^-+/, '').replace(/=.*$/, ''))) {
        throw usageError(`知らないオプション: ${arg}`);
      }
      return true;
    },
  });
  for (const name of spec.string ?? []) {
    if (name in options && (options[name] === '' || typeof options[name] !== 'string')) {
      throw usageError(`--${name} に値が要る`);
    }
  }
  return { positional: options._.map(String), options };
}

/** --epub-version の値を版の並びにする。省けば両方の版（ADR 0018） */
function versions(value: unknown): EpubVersion[] {
  if (value === undefined || value === 'all') return ['2.0.1', '3.0'];
  if (value === '2.0.1' || value === '3.0') return [value];
  throw usageError(`知らない版: ${String(value)}（2.0.1、3.0、all のいずれか）`);
}

function singleDir(positional: string[]): string {
  if (positional.length > 1) throw usageError(`余分な引数: ${positional.slice(1).join(' ')}`);
  return positional[0] ?? '.';
}

function formatWarning(warning: LoadWarning): string {
  const at = warning.line !== undefined ? `:${warning.line}:${warning.column}` : '';
  return `警告: ${warning.path}${at}: ${warning.message}`;
}

/** 版ごとに読み込み、警告を集める。--strict なら警告を誤りにする */
async function loadAll(
  dir: string,
  targets: EpubVersion[],
  options: Record<string, unknown>,
  io: Io,
): Promise<{ version: EpubVersion; book: Book }[] | undefined> {
  const books: { version: EpubVersion; book: Book }[] = [];
  let warned = false;
  for (const version of targets) {
    const book = await loadBook(dir, {
      version,
      onWarning: (warning) => {
        warned = true;
        if (!options.quiet) {
          io.stderr(targets.length > 1 ? `[${version}] ${formatWarning(warning)}` : formatWarning(warning));
        }
      },
    });
    books.push({ version, book });
  }
  if (warned && options.strict) {
    io.stderr('誤り: 警告があるため終える（--strict）');
    return undefined;
  }
  return books;
}

function outputPaths(dir: string, output: unknown, targets: EpubVersion[]): string[] {
  const base = typeof output === 'string' ? output : `${basename(resolve(dir))}.epub`;
  if (targets.length === 1) return [base];
  const stem = base.endsWith('.epub') ? base.slice(0, -5) : base;
  return targets.map((version) => `${stem}-${version}.epub`);
}

async function build(args: string[], io: Io): Promise<number> {
  const { positional, options } = parse(args, {
    string: ['epub-version', 'output'],
    boolean: ['strict', 'quiet'],
    alias: { e: 'epub-version', o: 'output', q: 'quiet' },
  });
  if (options.help) return help(['build'], io);
  const dir = singleDir(positional);
  const targets = versions(options['epub-version']);
  const books = await loadAll(dir, targets, options, io);
  if (!books) return EXIT_INPUT;
  const paths = outputPaths(dir, options.output, targets);
  // すべての版を作ってから書く。途中で誤りがあれば何も書かない
  const outputs: { path: string; data: Uint8Array }[] = [];
  for (const [i, { version, book }] of books.entries()) {
    outputs.push({ path: paths[i], data: await buildEpub(book, { version }) });
  }
  for (const { path, data } of outputs) {
    const parent = resolve(path, '..');
    await Deno.mkdir(parent, { recursive: true });
    await Deno.writeFile(path, data);
    io.stdout(path);
  }
  return EXIT_OK;
}

async function check(args: string[], io: Io): Promise<number> {
  const { positional, options } = parse(args, {
    string: ['epub-version'],
    boolean: ['strict', 'quiet'],
    alias: { e: 'epub-version', q: 'quiet' },
  });
  if (options.help) return help(['check'], io);
  const dir = singleDir(positional);
  const targets = versions(options['epub-version']);
  const books = await loadAll(dir, targets, options, io);
  if (!books) return EXIT_INPUT;
  for (const { version, book } of books) {
    await buildEpub(book, { version });
    io.stdout(`${version}: 誤りはない`);
  }
  return EXIT_OK;
}

function renderToc(chapters: Chapter[]): string[] {
  const lines: string[] = [];
  const section = (s: Section, depth: number) => {
    lines.push(`${'  '.repeat(depth)}${s.title}`);
    s.children?.forEach((child) => section(child, depth + 1));
  };
  const chapter = (c: Chapter, depth: number) => {
    lines.push(`${'  '.repeat(depth)}${c.title}`);
    c.sections?.forEach((s) => section(s, depth + 1));
    c.children?.forEach((child) => chapter(child, depth + 1));
  };
  chapters.forEach((c) => chapter(c, 0));
  return lines;
}

async function toc(args: string[], io: Io): Promise<number> {
  const { positional, options } = parse(args, { string: ['epub-version'], alias: { e: 'epub-version' } });
  if (options.help) return help(['toc'], io);
  const dir = singleDir(positional);
  const targets = versions(options['epub-version']);
  for (const version of targets) {
    const book = await loadBook(dir, { version, onWarning: () => {} });
    const lines = renderToc(book.chapters);
    if (targets.length === 1) {
      for (const line of lines) io.stdout(line);
    } else {
      // 両方の版を扱うときは、版ごとの見出しの下に字下げして出す
      io.stdout(`EPUB ${version}`);
      for (const line of lines) io.stdout(`  ${line}`);
    }
  }
  return EXIT_OK;
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

async function init(args: string[], io: Io): Promise<number> {
  const { positional, options } = parse(args, {
    string: ['title', 'language'],
    alias: { t: 'title', l: 'language' },
  });
  if (options.help) return help(['init'], io);
  const dir = singleDir(positional);
  try {
    for await (const _ of Deno.readDir(dir)) {
      throw epubInputError(`空でないディレクトリには雛形を作らない: ${dir}`);
    }
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  const title = typeof options.title === 'string' ? options.title : basename(resolve(dir));
  const language = typeof options.language === 'string' ? options.language : 'ja';
  const files: Record<string, string> = {
    'book.toml': `identifier = "urn:uuid:${crypto.randomUUID()}"
title = ${tomlString(title)}
language = ${tomlString(language)}
# authors = ["著者"]
# publisher = "出版者"
# description = "説明"
# modified = 2026-01-01T00:00:00Z
# page_progression_direction = "rtl"
# primary_writing_mode = "vertical-rl"
# cover_image = "assets/cover.jpg"
`,
    'body/01-はじめに.md': `# はじめに

本文を Markdown で書く。漢字《かんじ》や｜振り仮名《ふりがな》のルビと、脚注[^1]が使える。

## 節

見出しは目次の節になる。

[^1]: 脚注の本文。
`,
    'meta/colophon.md': `# 奥付

${title}
`,
    'assets/style.css': `@page { margin-top: 5pt; margin-bottom: 5pt; }
html, body {
  line-break: strict;
  -epub-line-break: strict;
  -webkit-line-break: strict;
}
/* 本文の行間は指定しない。Kindle は本文の行間を読者の設定で決め、ガイドラインも本文に line-height を書かないよう求めている */
body { text-align: justify; margin: 0 5pt; padding: 0; }
p { margin: 0; padding: 0; }
ruby > rt { font-size: 0.33em !important; text-align: start; }
/* 見出しは本文より一回り大きい程度にとどめる */
h1 { font-size: 1.4em; line-height: 1.5; }
h2 { font-size: 1.2em; line-height: 1.5; }
h3, h4, h5, h6 { font-size: 1em; line-height: 1.5; }
.footnotes { margin-top: 2em; font-size: 0.9em; }
.noteref { font-size: 0.7em; }
/* EPUB 2.0.1 ではルビが括弧書きになる。括弧を隠すには次を使う */
.ruby .rp { display: none; }
/* 縦書きにするには次を使う */
/* html, body { -epub-writing-mode: vertical-rl; -webkit-writing-mode: vertical-rl; writing-mode: vertical-rl; } */
`,
  };
  for (const [path, content] of Object.entries(files)) {
    const full = `${dir}/${path}`;
    await Deno.mkdir(resolve(full, '..'), { recursive: true });
    await Deno.writeTextFile(full, content, { createNew: true });
    io.stdout(full);
  }
  return EXIT_OK;
}

function help(args: string[], io: Io): number {
  const [command, ...rest] = args;
  if (rest.length > 0) throw usageError(`余分な引数: ${rest.join(' ')}`);
  if (command === undefined) {
    io.stdout(HELP['']);
    return EXIT_OK;
  }
  if (!(command in HELP) || command === '') throw usageError(`知らないコマンド: ${command}`);
  io.stdout(HELP[command]);
  return EXIT_OK;
}

function version(args: string[], io: Io): number {
  const { positional, options } = parse(args, {});
  if (options.help) return help(['version'], io);
  if (positional.length > 0) throw usageError(`余分な引数: ${positional.join(' ')}`);
  io.stdout(VERSION);
  return EXIT_OK;
}

/** コマンドラインの引数を処理し、終了コードを返す */
export async function main(args: string[], io: Io = defaultIo): Promise<number> {
  const [command, ...rest] = args;
  try {
    if (command === undefined) throw usageError('コマンドが要る');
    if (command === '-h' || command === '--help') return help([], io);
    if (command === '-V' || command === '--version') return version([], io);
    if (!COMMANDS.includes(command)) throw usageError(`知らないコマンド: ${command}`);
    switch (command) {
      case 'build':
        return await build(rest, io);
      case 'check':
        return await check(rest, io);
      case 'toc':
        return await toc(rest, io);
      case 'init':
        return await init(rest, io);
      case 'help':
        return help(rest, io);
      default:
        return version(rest, io);
    }
  } catch (e) {
    if (isUsageError(e)) {
      io.stderr(`使い方の誤り: ${e.message}`);
      io.stderr('');
      io.stderr(HELP[COMMANDS.includes(command ?? '') && command !== 'help' ? command! : '']);
      return EXIT_USAGE;
    }
    if (isEpubInputError(e)) {
      io.stderr(`誤り: ${e.message}`);
      return EXIT_INPUT;
    }
    if (e instanceof Deno.errors.NotFound || e instanceof Deno.errors.PermissionDenied) {
      io.stderr(`誤り: ${e.message}`);
      return EXIT_INPUT;
    }
    throw e;
  }
}
