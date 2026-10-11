// ADR の書き方（ADR 0020）
import { expect } from '@std/expect';

const STATUS = /^ステータス: (提案|採択|採択→ADR \d{4}|却下)$/;

Deno.test('すべての ADR のファイル名、見出し、ステータスが決めた書き方である', async () => {
  const names: string[] = [];
  for await (const entry of Deno.readDir('docs/adr')) if (entry.isFile) names.push(entry.name);
  expect(names.length).toBeGreaterThan(0);
  for (const name of names.sort()) {
    expect(name, name).toMatch(/^\d{4}-[a-z0-9]+(-[a-z0-9]+)*\.md$/);
    const lines = (await Deno.readTextFile(`docs/adr/${name}`)).split('\n');
    expect(lines[0], name).toMatch(new RegExp(`^# ADR ${name.slice(0, 4)}: \\S`));
    expect(lines[2], name).toMatch(STATUS);
    // 置き換えた先の ADR があること
    const to = /採択→ADR (\d{4})/.exec(lines[2])?.[1];
    if (to) expect(names.some((n) => n.startsWith(`${to}-`)), name).toBe(true);
  }
});
