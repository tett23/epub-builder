// クラスを使わない（ADR 0021）
import { expect } from '@std/expect';
import { thrown } from './helpers/errors.ts';
import { epubInputError, isEpubInputError } from '../mod.ts';
import { isTomlDateTime, isTomlError, parseToml, tomlDateTime, tomlError } from '../load.ts';
import { isUsageError, usageError } from '../src/cli.ts';
import { conversionError, isConversionError } from '../src/load/xhtml-writer.ts';
import { isXmlError, xmlError } from '../src/load/xml-fragment.ts';

const kinds = [
  { name: 'EpubInputError', make: () => epubInputError('m'), is: isEpubInputError, extra: {} },
  { name: 'TomlError', make: () => tomlError('m', 2, 3), is: isTomlError, extra: { line: 2, column: 3 } },
  { name: 'XmlError', make: () => xmlError('m', 4, 5), is: isXmlError, extra: { line: 4, column: 5 } },
  {
    name: 'ConversionError',
    make: () => conversionError('m', 6, 7),
    is: isConversionError,
    extra: { line: 6, column: 7 },
  },
  { name: 'UsageError', make: () => usageError('m'), is: isUsageError, extra: {} },
];

Deno.test('誤りの種類ごとに、作る関数と判別する関数がそろう', async (t) => {
  for (const kind of kinds) {
    await t.step(kind.name, () => {
      const error = kind.make();
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe(kind.name);
      expect(error).toMatchObject(kind.extra);
      expect(kind.is(error)).toBe(true);
      for (const other of kinds) if (other !== kind) expect(other.is(error), other.name).toBe(false);
      expect(kind.is(new Error('m'))).toBe(false);
      expect(kind.is({ name: kind.name, message: 'm' })).toBe(false);
      expect(kind.is(undefined)).toBe(false);
      // throw して catch した値も判別できる
      expect(kind.is(thrown(() => {
        throw error;
      }))).toBe(true);
    });
  }
});

Deno.test('位置を持つ誤りは、メッセージの先頭に位置を付ける', () => {
  expect(tomlError('誤り', 2, 3).message).toBe('2:3: 誤り');
  expect(xmlError('誤り', 4, 5).message).toBe('4:5: 誤り');
  expect(conversionError('誤り', 6, 7).message).toBe('6:7: 誤り');
  expect(conversionError('誤り').message).toBe('誤り');
  expect(epubInputError('誤り').message).toBe('誤り');
});

Deno.test('TOML の日時は目印で判別し、変更できない', () => {
  const value = parseToml('a = 1979-05-27T07:32:00Z\nb = "1979-05-27T07:32:00Z"\nc = {}\nd = []').a;
  expect(isTomlDateTime(value)).toBe(true);
  const doc = parseToml('b = "x"\nc = {}\nd = []');
  for (const other of [doc.b, doc.c, doc.d, null, undefined, 1]) expect(isTomlDateTime(other)).toBe(false);
  const made = tomlDateTime('local-date', '2026-10-11');
  expect(made).toMatchObject({ kind: 'local-date', text: '2026-10-11' });
  expect('date' in made).toBe(false);
  expect(Object.isFrozen(made)).toBe(true);
  expect(() => {
    (made as { text: string }).text = 'x';
  }).toThrow(TypeError);
});

/** ディレクトリの下の TypeScript のファイルを集める */
async function sources(dir: string): Promise<string[]> {
  const files: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory) {
      if (entry.name !== 'fixtures' && entry.name !== 'invalid-fixtures' && entry.name !== '__snapshots__') {
        files.push(...await sources(path));
      }
    } else if (entry.name.endsWith('.ts')) {
      files.push(path);
    }
  }
  return files;
}

Deno.test('ソースに class の宣言と式がない', async () => {
  const files = [
    'mod.ts',
    'load.ts',
    'cli.ts',
    ...await sources('src'),
    ...await sources('scripts'),
    ...await sources('test'),
  ];
  expect(files.length).toBeGreaterThan(10);
  // class のキーワードに続けて名前、extends、波括弧が来る形を探す。文字列の中の class="…" は当たらない
  const pattern = new RegExp(['\\bcl', 'ass(\\s+[A-Za-z_$][\\w$]*)?(\\s+extends\\s+[^{]+)?\\s*\\{'].join(''));
  for (const file of files) {
    const text = await Deno.readTextFile(file);
    expect(pattern.test(text), file).toBe(false);
  }
});
