// コマンドラインの入口（ADR 0016）
import { expect } from '@std/expect';
import { main } from '../cli.ts';
import { VERSION } from '../src/version.ts';
import { unzipText } from './helpers/unzip.ts';

interface Run {
  code: number;
  stdout: string[];
  stderr: string[];
}

async function run(...args: string[]): Promise<Run> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await main(args, { stdout: (l) => stdout.push(l), stderr: (l) => stderr.push(l) });
  return { code, stdout, stderr };
}

async function withTemp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await Deno.makeTempDir({ prefix: 'epub-builder-cli-' });
  try {
    return await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

const opfVersion = async (path: string) =>
  /<package [^>]*version="([^"]+)"/.exec((await unzipText(await Deno.readFile(path))).get('OEBPS/content.opf')!)![1];

Deno.test('build', async (t) => {
  await t.step('既定は EPUB 3.0 を <dir の名前>.epub に書く', async () => {
    await withTemp(async (tmp) => {
      const cwd = Deno.cwd();
      const fixture = `${cwd}/test/fixtures/minimal-book`;
      Deno.chdir(tmp);
      try {
        const result = await run('build', fixture);
        expect(result).toEqual({ code: 0, stdout: ['minimal-book.epub'], stderr: [] });
        expect(await opfVersion(`${tmp}/minimal-book.epub`)).toBe('3.0');
      } finally {
        Deno.chdir(cwd);
      }
    });
  });
  await t.step('-o と -e 2.0.1', async () => {
    await withTemp(async (tmp) => {
      const result = await run('build', 'test/fixtures/minimal-book', '-e', '2.0.1', '-o', `${tmp}/a/b.epub`);
      expect(result.code).toBe(0);
      expect(await opfVersion(`${tmp}/a/b.epub`)).toBe('2.0');
    });
  });
  await t.step('all は版を付けた二つのファイルを書く', async () => {
    await withTemp(async (tmp) => {
      const result = await run(
        'build',
        'test/fixtures/minimal-book',
        '--epub-version=all',
        `--output=${tmp}/book.epub`,
      );
      expect(result.stdout).toEqual([`${tmp}/book-2.0.1.epub`, `${tmp}/book-3.0.epub`]);
      expect(await opfVersion(`${tmp}/book-2.0.1.epub`)).toBe('2.0');
      expect(await opfVersion(`${tmp}/book-3.0.epub`)).toBe('3.0');
    });
  });
  await t.step('警告を標準エラー出力に書き、EPUB は作る', async () => {
    await withTemp(async (tmp) => {
      const result = await run('build', 'test/fixtures/edge-book', '-o', `${tmp}/e.epub`);
      expect(result.code).toBe(0);
      expect(result.stderr).toEqual([expect.stringMatching(/^警告: assets\/画像集\/空白 を含む　名前\.png: /)]);
      await Deno.stat(`${tmp}/e.epub`);
    });
  });
  await t.step('all の警告には版を付ける', async () => {
    await withTemp(async (tmp) => {
      const result = await run('build', 'test/fixtures/edge-book', '-e', 'all', '-o', `${tmp}/e.epub`);
      expect(result.stderr.map((l) => l.slice(0, 15))).toEqual(['[2.0.1] 警告: ass', '[3.0] 警告: asset']);
    });
  });
  await t.step('--strict は警告で EPUB を書かずに 1 で終える', async () => {
    await withTemp(async (tmp) => {
      const result = await run('build', 'test/fixtures/edge-book', '-o', `${tmp}/e.epub`, '--strict');
      expect(result.code).toBe(1);
      expect(result.stderr.at(-1)).toBe('誤り: 警告があるため終える（--strict）');
      await expect(Deno.stat(`${tmp}/e.epub`)).rejects.toThrow(Deno.errors.NotFound);
    });
  });
  await t.step('--quiet は警告を出さない', async () => {
    await withTemp(async (tmp) => {
      const result = await run('build', 'test/fixtures/edge-book', '-o', `${tmp}/e.epub`, '-q');
      expect(result.stderr).toEqual([]);
      const strict = await run('build', 'test/fixtures/edge-book', '-o', `${tmp}/f.epub`, '-q', '--strict');
      expect(strict.code).toBe(1);
      expect(strict.stderr).toEqual(['誤り: 警告があるため終える（--strict）']);
    });
  });
  await t.step('入力の誤りは 1 で終え、何も書かない', async () => {
    await withTemp(async (tmp) => {
      const result = await run('build', 'test/invalid-fixtures/broken-link', '-o', `${tmp}/x.epub`);
      expect(result.code).toBe(1);
      expect(result.stderr).toEqual(['誤り: body/a.md:1:1: 指す先のない参照: b.md']);
      await expect(Deno.stat(`${tmp}/x.epub`)).rejects.toThrow(Deno.errors.NotFound);
    });
  });
});

Deno.test('check', async (t) => {
  await t.step('誤りがなければ版ごとに知らせて 0 で終える', async () => {
    expect(await run('check', 'test/fixtures/sample-book', '-e', 'all')).toEqual({
      code: 0,
      stdout: ['2.0.1: 誤りはない', '3.0: 誤りはない'],
      stderr: [],
    });
  });
  await t.step('入力の誤り', async () => {
    const result = await run('check', 'test/invalid-fixtures/toml-unknown-key');
    expect(result.code).toBe(1);
    expect(result.stderr).toEqual(['誤り: book.toml に知らないキーがある: subtitle']);
  });
  await t.step('ディレクトリがない', async () => {
    expect((await run('check', 'test/fixtures/none')).code).toBe(1);
  });
  await t.step('警告と --strict', async () => {
    const warn = await run('check', 'test/fixtures/edge-book');
    expect(warn.code).toBe(0);
    expect(warn.stderr.length).toBe(1);
    expect((await run('check', 'test/fixtures/edge-book', '--strict')).code).toBe(1);
  });
  await t.step('EPUB 3.0 だけの機能を使う本を EPUB 2.0.1 で調べると誤りになる', async () => {
    const result = await run('check', 'test/fixtures/epub3-book', '-e', '2.0.1');
    // epub3-book の epub:type は EPUB 2.0.1 では誤りになる
    expect(result.code).toBe(1);
  });
});

Deno.test('toc は目次の木を題名の入れ子で出す', async () => {
  const result = await run('toc', 'test/fixtures/sections-book');
  expect(result.code).toBe(0);
  expect(result.stdout.slice(0, 6)).toEqual([
    'はじめに',
    '第一部',
    '  第一部の概要',
    '    概要の細目',
    '  第一章',
    '    第一節',
  ]);
  expect(result.stdout.at(-1)).toBe('  発行');
  expect(result.stdout).not.toContain('扉の見出しは目次に入らない');
});

Deno.test('init', async (t) => {
  await t.step('雛形を作り、作った雛形は check と build を通る', async () => {
    await withTemp(async (tmp) => {
      const dir = `${tmp}/新しい本`;
      const result = await run('init', dir);
      expect(result.code).toBe(0);
      expect(result.stdout).toEqual([
        `${dir}/book.toml`,
        `${dir}/body/01-はじめに.md`,
        `${dir}/meta/colophon.md`,
        `${dir}/assets/style.css`,
      ]);
      const toml = await Deno.readTextFile(`${dir}/book.toml`);
      expect(toml).toMatch(/^identifier = "urn:uuid:[0-9a-f-]{36}"\ntitle = "新しい本"\nlanguage = "ja"\n/);
      expect((await run('check', dir, '-e', 'all', '--strict')).code).toBe(0);
      expect((await run('toc', dir)).stdout).toEqual(['はじめに', '  節', '奥付']);
      expect((await run('build', dir, '-e', 'all', '-o', `${tmp}/b.epub`)).code).toBe(0);
    });
  });
  await t.step('--title と --language', async () => {
    await withTemp(async (tmp) => {
      await run('init', `${tmp}/b`, '-t', 'A "quoted" title', '--language', 'en');
      const toml = await Deno.readTextFile(`${tmp}/b/book.toml`);
      expect(toml).toContain('title = "A \\"quoted\\" title"\nlanguage = "en"\n');
      expect((await run('check', `${tmp}/b`)).code).toBe(0);
    });
  });
  await t.step('空でないディレクトリには作らない', async () => {
    await withTemp(async (tmp) => {
      await Deno.writeTextFile(`${tmp}/keep.txt`, 'x');
      const result = await run('init', tmp);
      expect(result.code).toBe(1);
      expect(result.stderr[0]).toMatch(/^誤り: 空でないディレクトリには雛形を作らない/);
      expect([...Deno.readDirSync(tmp)].map((e) => e.name)).toEqual(['keep.txt']);
    });
  });
  await t.step('空のディレクトリには作る', async () => {
    await withTemp(async (tmp) => {
      expect((await run('init', tmp)).code).toBe(0);
    });
  });
});

Deno.test('help', async (t) => {
  await t.step('全体の使い方', async () => {
    for (const args of [['help'], ['-h'], ['--help']]) {
      const result = await run(...args);
      expect(result.code).toBe(0);
      expect(result.stdout[0]).toContain(`epub-builder ${VERSION}`);
      for (const command of ['build', 'check', 'toc', 'init', 'help', 'version']) {
        expect(result.stdout[0]).toContain(`  ${command} `);
      }
    }
  });
  await t.step('コマンドごとの使い方', async () => {
    for (const command of ['build', 'check', 'toc', 'init', 'help', 'version']) {
      const viaHelp = await run('help', command);
      expect(viaHelp.code).toBe(0);
      expect(viaHelp.stdout[0]).toContain(`epub-builder ${command}`);
      if (command !== 'help') {
        expect((await run(command, '--help')).stdout).toEqual(viaHelp.stdout);
        expect((await run(command, '-h')).stdout).toEqual(viaHelp.stdout);
      }
    }
    expect((await run('help', 'build')).stdout[0]).toContain('--epub-version');
  });
  await t.step('知らないコマンドの使い方', async () => {
    const result = await run('help', 'nope');
    expect(result.code).toBe(2);
    expect(result.stderr[0]).toBe('使い方の誤り: 知らないコマンド: nope');
  });
});

Deno.test('version', async () => {
  for (const args of [['version'], ['-V'], ['--version']]) {
    expect(await run(...args)).toEqual({ code: 0, stdout: [VERSION], stderr: [] });
  }
});

Deno.test('使い方の誤りは 2 で終え、使い方を標準エラー出力に出す', async (t) => {
  const cases: [string, string[], string][] = [
    ['コマンドなし', [], 'コマンドが要る'],
    ['知らないコマンド', ['make'], '知らないコマンド: make'],
    ['知らないオプション', ['build', '--fast'], '知らないオプション: --fast'],
    ['知らない短いオプション', ['check', '-x'], '知らないオプション: -x'],
    ['知らない版', ['build', '-e', '3.3'], '知らない版: 3.3（2.0.1、3.0、all のいずれか）'],
    ['toc の all', ['toc', '-e', 'all'], '知らない版: all（2.0.1、3.0 のいずれか）'],
    ['値のないオプション', ['build', '-o'], '--output に値が要る'],
    ['余分な引数', ['check', 'a', 'b'], '余分な引数: b'],
    ['version の余分な引数', ['version', 'x'], '余分な引数: x'],
  ];
  for (const [label, args, message] of cases) {
    await t.step(label, async () => {
      const result = await run(...args);
      expect(result.code).toBe(2);
      expect(result.stdout).toEqual([]);
      expect(result.stderr[0]).toBe(`使い方の誤り: ${message}`);
      expect(result.stderr.at(-1)).toContain('使い方');
    });
  }
  await t.step('コマンドの誤りでは、そのコマンドの使い方を出す', async () => {
    const result = await run('build', '--fast');
    expect(result.stderr.at(-1)).toContain('epub-builder build');
  });
});
