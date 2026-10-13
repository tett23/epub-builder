// ADR の書き方（ADR 0020、ADR 0025）
import { expect } from '@std/expect';

// ADR の参照。リンクのない形と、ADR のファイルへのリンクの形を認める
const REF = String.raw`(?:ADR (\d{4})|\[ADR (\d{4})\]\((\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*\.md)\))`;
// 提案、採択、却下、採択→ADR NNNN（置き換えられた）、採択→<置き換えた部分>は ADR NNNN（一部を置き換えられた）
const STATUS = new RegExp(`^ステータス: (?:提案|採択|却下|採択→${REF}|採択→\\S.*は${REF})$`);

// ステータスの行を調べ、置き換えた先の ADR の番号とリンクの先のファイル名を返す。書き方に合わなければ undefined
const parseStatus = (line: string): { to?: string; href?: string } | undefined => {
  const m = STATUS.exec(line);
  if (!m) return undefined;
  const to = m[1] ?? m[2] ?? m[4] ?? m[5];
  const href = m[3] ?? m[6];
  if (href && to && !href.startsWith(`${to}-`)) return undefined;
  return { to, href };
};

Deno.test('ステータスの行の書き方を判定する', () => {
  const accepted: [string, { to?: string; href?: string }][] = [
    ['ステータス: 提案', {}],
    ['ステータス: 採択', {}],
    ['ステータス: 却下', {}],
    ['ステータス: 採択→ADR 0020', { to: '0020' }],
    [
      'ステータス: 採択→[ADR 0020](0020-adr-workflow-and-adr-guard.md)',
      { to: '0020', href: '0020-adr-workflow-and-adr-guard.md' },
    ],
    [
      'ステータス: 採択→adr-guard のバージョンは[ADR 0025](0025-update-adr-guard-to-v0-8-0.md)',
      { to: '0025', href: '0025-update-adr-guard-to-v0-8-0.md' },
    ],
  ];
  for (const [line, expected] of accepted) expect(parseStatus(line), line).toEqual(expected);

  const rejected = [
    'ステータス: 置換（ADR 0020）',
    'ステータス: 採択→',
    'ステータス: 採択→[ADR 0020]',
    'ステータス: 採択→は[ADR 0020](0020-adr-workflow-and-adr-guard.md)',
    'ステータス: 採択→[ADR 0020](0021-no-classes.md)',
  ];
  for (const line of rejected) expect(parseStatus(line), line).toBeUndefined();
});

Deno.test('すべての ADR のファイル名、見出し、ステータスが決めた書き方である', async () => {
  const names: string[] = [];
  for await (const entry of Deno.readDir('docs/adr')) if (entry.isFile) names.push(entry.name);
  expect(names.length).toBeGreaterThan(0);
  for (const name of names.sort()) {
    expect(name, name).toMatch(/^\d{4}-[a-z0-9]+(-[a-z0-9]+)*\.md$/);
    const lines = (await Deno.readTextFile(`docs/adr/${name}`)).split('\n');
    expect(lines[0], name).toMatch(new RegExp(`^# ADR ${name.slice(0, 4)}: \\S`));
    const status = parseStatus(lines[2]);
    expect(status, `${name}: ${lines[2]}`).toBeDefined();
    // 置き換えた先の ADR と、リンクの先のファイルがあること
    if (status?.to) expect(names.some((n) => n.startsWith(`${status.to}-`)), name).toBe(true);
    if (status?.href) expect(names, name).toContain(status.href);
  }
});
