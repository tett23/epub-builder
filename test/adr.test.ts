// ADR の書き方（ADR 0020、ADR 0025、ADR 0028、ADR 0030、ADR 0032）
import { expect } from '@std/expect';

// 置き換えた ADR のパス。リポジトリのルートからの docs/adr/ の ADR
const ADR_PATH = /^docs\/adr\/\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
// 変更を持たない状態（ADR 0032）
const PLAIN_STATES = new Set(['proposed', 'accepted-pending', 'accepted', 'rejected', 'discarded']);
const PREFIX = 'Status: ';
const SUPERSEDED = 'Status: superseded ';

type Change = { part: string | null; by: string[] };

// キー part（空でない文字列か null）と by（ADR のパスを 1 つ以上持つ配列）だけを持つ変更か
const isChange = (value: unknown): value is Change => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  if (keys.length !== 2 || keys[0] !== 'by' || keys[1] !== 'part') return false;
  const { part, by } = value as Record<string, unknown>;
  return (part === null || (typeof part === 'string' && part !== '')) &&
    Array.isArray(by) && by.length > 0 && by.every((path) => typeof path === 'string' && ADR_PATH.test(path));
};

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

// ステータスの行を調べ、置き換えた ADR のパスを変更の順に返す。書き方に合わなければ undefined（ADR 0032）
const parseStatus = (line: string): string[] | undefined => {
  if (line.startsWith(PREFIX) && PLAIN_STATES.has(line.slice(PREFIX.length))) return [];
  if (!line.startsWith(SUPERSEDED)) return undefined;
  const json = line.slice(SUPERSEDED.length);
  if (!json.startsWith('[') || !json.endsWith(']')) return undefined;
  const changes = parseJson(json);
  if (!Array.isArray(changes) || changes.length === 0 || !changes.every(isChange)) return undefined;
  return changes.flatMap((change) => change.by);
};

const ADR_0020 = 'docs/adr/0020-adr-workflow-and-adr-guard.md';
const ADR_0021 = 'docs/adr/0021-no-classes.md';
const ADR_0023 = 'docs/adr/0023-reimplement-hastscript.md';

Deno.test('不変条件1: proposed、accepted-pending、accepted、rejected、discarded の行は空の並びを返す', () => {
  for (const state of ['proposed', 'accepted-pending', 'accepted', 'rejected', 'discarded']) {
    expect(parseStatus(`Status: ${state}`), state).toEqual([]);
  }
});

Deno.test('不変条件2: superseded の行は、各変更の by を変更の順に連ねた並びを返す', () => {
  expect(parseStatus(`Status: superseded [{"part":null,"by":["${ADR_0020}"]}]`)).toEqual([ADR_0020]);
  expect(
    parseStatus(
      `Status: superseded [{"part":"ステータスの書き方","by":["${ADR_0020}"]},{"part":"クラス","by":["${ADR_0021}","${ADR_0023}"]}]`,
    ),
  ).toEqual([ADR_0020, ADR_0021, ADR_0023]);
});

Deno.test('不変条件3: 1 と 2 のどちらにも当たらない行は undefined を返す', () => {
  const rejected = [
    'Status: deprecated',
    'Status: superseded []',
    'Status: superseded [{"part":null,"by":[]}]',
    `Status: superseded [{"part":"","by":["${ADR_0020}"]}]`,
    `Status: superseded [{"part":null,"by":["${ADR_0020}"],"kind":"replace"}]`,
    `Status: superseded [{"part":null,"by":["${ADR_0020}"],"note":"注記"}]`,
    'Status: superseded [{"part":null,"by":["https://example.com/adr.md"]}]',
    `Status: superseded-pending [{"part":null,"by":["${ADR_0020}"]}]`,
    'ステータス: 採択',
    'ステータス: 採択（未実装）',
    'ステータス: 採択→ADR 0020',
    'Status: accepted ',
    ' Status: accepted',
    'Status:  accepted',
    `Status: superseded [{"part":null,"by":["${ADR_0020}"]}] `,
    'Status: superseded [{"part":null}]',
    `Status: superseded {"part":null,"by":["${ADR_0020}"]}`,
    `Status: superseded [{"part":null,"by":["${ADR_0020}"]}`,
    'Status: superseded [{"part":null,"by":["docs/adr/20-short.md"]}]',
    'Status: superseded [{"part":null,"by":[1]}]',
    'Status: superseded [null]',
  ];
  for (const line of rejected) expect(parseStatus(line), line).toBeUndefined();
});

Deno.test('不変条件4: すべての ADR のファイル名、見出し、ステータスが決めた書き方で、置き換えた ADR のファイルがある', async () => {
  const names: string[] = [];
  for await (const entry of Deno.readDir('docs/adr')) if (entry.isFile) names.push(entry.name);
  expect(names.length).toBeGreaterThan(0);
  for (const name of names.sort()) {
    expect(name, name).toMatch(/^\d{4}-[a-z0-9]+(-[a-z0-9]+)*\.md$/);
    const lines = (await Deno.readTextFile(`docs/adr/${name}`)).split('\n');
    expect(lines[0], name).toMatch(new RegExp(`^# ADR ${name.slice(0, 4)}: \\S`));
    const paths = parseStatus(lines[2]);
    expect(paths, `${name}: ${lines[2]}`).toBeDefined();
    for (const path of paths ?? []) expect(names, `${name}: ${path}`).toContain(path.slice('docs/adr/'.length));
  }
});

// ADR 0027 以降が持つ節。この順に並び、参考文献が最後の節（ADR 0028）
const REQUIRED_SECTIONS = ['文脈', '実装すること', '実装しないこと', 'テスト設計', 'トレードオフ', '参考文献'];

// 節の並びを調べ、書き方に合わなければ理由を返す
const checkSections = (text: string): string | undefined => {
  const headings = [...text.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim());
  let next = 0;
  for (const heading of headings) {
    if (heading === REQUIRED_SECTIONS[next]) next++;
    else if (REQUIRED_SECTIONS.includes(heading)) return `節「${heading}」の位置が違う`;
  }
  if (next < REQUIRED_SECTIONS.length) return `節「${REQUIRED_SECTIONS[next]}」がない`;
  if (headings.at(-1) !== '参考文献') return '参考文献が最後の節でない';
  // 最後の「## 参考文献」の見出しの行の次から、文書の終わりまで
  const references = text.slice(text.lastIndexOf('## 参考文献') + '## 参考文献'.length).trim();
  if (references === '') return '参考文献が空';
  return undefined;
};

Deno.test('節の並びを判定する', () => {
  const doc = (...sections: string[]) => sections.map((s) => `## ${s}\n\n中身\n`).join('\n');
  expect(checkSections(doc(...REQUIRED_SECTIONS))).toBeUndefined();
  // 必須の節の間に別の節があってよい
  expect(
    checkSections(
      doc(
        '文脈',
        '実装すること',
        'データ構造',
        '検討の記録',
        '実装しないこと',
        'テスト設計',
        'トレードオフ',
        '参考文献',
      ),
    ),
  )
    .toBeUndefined();
  // 参考文献は「なし」でよい
  expect(checkSections(doc(...REQUIRED_SECTIONS.slice(0, 5)) + '\n## 参考文献\n\nなし\n')).toBeUndefined();
  expect(checkSections(doc(...REQUIRED_SECTIONS.slice(0, 5)))).toBe('節「参考文献」がない');
  expect(checkSections(doc(...REQUIRED_SECTIONS, '付録'))).toBe('参考文献が最後の節でない');
  expect(checkSections(doc('実装すること', '文脈', '実装しないこと', 'テスト設計', 'トレードオフ', '参考文献'))).toBe(
    '節「実装すること」の位置が違う',
  );
  expect(checkSections(doc(...REQUIRED_SECTIONS.slice(0, 5)) + '\n## 参考文献\n\n')).toBe('参考文献が空');
});

Deno.test('ADR 0027 以降の ADR は、決めた節をこの順に持ち、参考文献で終わる', async () => {
  const names: string[] = [];
  for await (const entry of Deno.readDir('docs/adr')) if (entry.isFile) names.push(entry.name);
  const targets = names.filter((name) => Number(name.slice(0, 4)) >= 27).sort();
  expect(targets.length).toBeGreaterThan(0);
  for (const name of targets) {
    expect(checkSections(await Deno.readTextFile(`docs/adr/${name}`)), name).toBeUndefined();
  }
});
