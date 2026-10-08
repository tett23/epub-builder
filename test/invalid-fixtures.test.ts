// 壊れたプロジェクト（test/invalid-fixtures/）は、決めた理由の例外になる。
// 各ディレクトリの expected-error.txt に、例外のメッセージに含まれるべき文字列を書く
import { expect } from '@std/expect';
import { EpubInputError } from '../mod.ts';
import { loadBook } from '../load.ts';

const root = 'test/invalid-fixtures';

Deno.test('壊れたプロジェクトは、決めた理由の例外になる', async (t) => {
  const names: string[] = [];
  for await (const entry of Deno.readDir(root)) if (entry.isDirectory) names.push(entry.name);
  expect(names.length).toBeGreaterThan(0);
  for (const name of names.sort()) {
    await t.step(name, async () => {
      const expected = (await Deno.readTextFile(`${root}/${name}/expected-error.txt`)).trim();
      for (const version of ['2.0.1', '3.0'] as const) {
        const error = await loadBook(`${root}/${name}`, { version }).then(() => undefined, (e) => e);
        expect(error, `${name} ${version}`).toBeInstanceOf(EpubInputError);
        expect((error as Error).message, `${name} ${version}`).toContain(expected);
      }
    });
  }
});
