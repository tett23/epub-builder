// Kindle の primary-writing-mode（ADR 0019）
import { expect } from '@std/expect';
import { type Book, buildEpub, type PrimaryWritingMode } from '../mod.ts';
import { loadBook } from '../load.ts';
import { unzipText } from './helpers/unzip.ts';

const book = (primaryWritingMode?: PrimaryWritingMode, ppd?: 'ltr' | 'rtl'): Book => ({
  metadata: { identifier: 'id', title: 't', language: 'ja', modified: new Date(0), primaryWritingMode },
  pageProgressionDirection: ppd,
  chapters: [{ title: 'a', body: '<p>a</p>' }],
});

const opf = async (b: Book, version: '2.0.1' | '3.0') =>
  (await unzipText(await buildEpub(b, { version }))).get('OEBPS/content.opf')!;

Deno.test('buildEpub は、どちらの版でも primary-writing-mode を書く', async () => {
  for (const version of ['2.0.1', '3.0'] as const) {
    for (const mode of ['horizontal-lr', 'horizontal-rl', 'vertical-lr', 'vertical-rl'] as const) {
      expect(await opf(book(mode), version)).toContain(`<meta name="primary-writing-mode" content="${mode}"/>`);
    }
    expect(await opf(book(), version)).not.toContain('primary-writing-mode');
  }
});

Deno.test('buildEpub は、知らない組み方向と、頁送りの向きと食い違う組み方向を例外にする', async () => {
  await expect(buildEpub(book('vertical' as PrimaryWritingMode), { version: '3.0' })).rejects.toMatchObject({
    name: 'EpubInputError',
  });
  await expect(buildEpub(book('vertical-rl', 'ltr'), { version: '3.0' })).rejects.toThrow(
    '組み方向 vertical-rl と頁送りの向き ltr が食い違う',
  );
  await expect(buildEpub(book('horizontal-lr', 'rtl'), { version: '2.0.1' })).rejects.toMatchObject({
    name: 'EpubInputError',
  });
  // 合う組み合わせ
  await buildEpub(book('vertical-rl', 'rtl'), { version: '3.0' });
  await buildEpub(book('horizontal-rl', 'rtl'), { version: '3.0' });
  await buildEpub(book('vertical-lr', 'ltr'), { version: '3.0' });
});

async function load(toml: string): Promise<Book> {
  const dir = await Deno.makeTempDir({ prefix: 'epub-builder-test-' });
  try {
    await Deno.writeTextFile(`${dir}/book.toml`, `identifier = "id"\ntitle = "t"\nlanguage = "ja"\n${toml}`);
    await Deno.mkdir(`${dir}/body`);
    await Deno.writeTextFile(`${dir}/body/a.md`, 'a');
    return await loadBook(dir, { version: '3.0' });
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test('loadBook は primary_writing_mode を読み、ないときは頁送りの向きから決める', async () => {
  expect((await load('primary_writing_mode = "horizontal-rl"\n')).metadata.primaryWritingMode).toBe('horizontal-rl');
  expect((await load('page_progression_direction = "rtl"\n')).metadata.primaryWritingMode).toBe('vertical-rl');
  expect((await load('page_progression_direction = "ltr"\n')).metadata.primaryWritingMode).toBe('horizontal-lr');
  expect((await load('')).metadata.primaryWritingMode).toBe(undefined);
  const both = await load('primary_writing_mode = "horizontal-rl"\npage_progression_direction = "rtl"\n');
  expect(both.metadata.primaryWritingMode).toBe('horizontal-rl');
  // 組み方向から頁送りの向きは決めない
  expect((await load('primary_writing_mode = "vertical-rl"\n')).pageProgressionDirection).toBe(undefined);
});

Deno.test('loadBook は、知らない組み方向と、頁送りの向きと食い違う組み方向を例外にする', async () => {
  await expect(load('primary_writing_mode = "tb-rl"\n')).rejects.toThrow('primary_writing_mode は');
  await expect(load('primary_writing_mode = 1\n')).rejects.toMatchObject({ name: 'EpubInputError' });
  await expect(load('primary_writing_mode = "vertical-rl"\npage_progression_direction = "ltr"\n')).rejects.toThrow(
    'book.toml の primary_writing_mode vertical-rl と page_progression_direction ltr が食い違う',
  );
});
