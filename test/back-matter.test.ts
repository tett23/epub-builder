// meta/ の後付け（ADR 0024）
import { expect } from '@std/expect';
import { buildEpub } from '../mod.ts';
import { loadBook } from '../load.ts';
import { unzipText } from './helpers/unzip.ts';

async function project<T>(files: Record<string, string>, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await Deno.makeTempDir({ prefix: 'epub-builder-test-' });
  try {
    for (
      const [path, content] of Object.entries({
        'book.toml': 'identifier = "id"\ntitle = "t"\nlanguage = "ja"\n',
        ...files,
      })
    ) {
      await Deno.mkdir(`${dir}/${path.slice(0, path.lastIndexOf('/'))}`, { recursive: true });
      await Deno.writeTextFile(`${dir}/${path}`, content);
    }
    return await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

const ALL = {
  'body/a.md': '# 本文',
  'meta/copyright-page.md': '# 著作権',
  'meta/index.html': '<h1>索引</h1>',
  'meta/glossary.xhtml': '<h1>用語集</h1>',
  'meta/bibliography.md': '# 参考文献',
  'meta/appendix.md': '# 付録\n\n## 付録の節',
  'meta/acknowledgments.md': '# 謝辞',
  'meta/afterword.md': 'あとがきの本文',
  'meta/colophon.md': '# 奥付',
};

Deno.test('後付けを本文の後、奥付の前に、決まった順で読み、目次に入れる', async () => {
  await project(ALL, async (dir) => {
    for (const version of ['2.0.1', '3.0'] as const) {
      const book = await loadBook(dir, { version });
      expect(book.chapters.map((c) => [c.title, c.epubType])).toEqual([
        ['本文', 'bodymatter chapter'],
        ['afterword', 'backmatter afterword'],
        ['謝辞', 'backmatter acknowledgments'],
        ['付録', 'backmatter appendix'],
        ['参考文献', 'backmatter bibliography'],
        ['用語集', 'backmatter glossary'],
        ['索引', 'backmatter index'],
        ['著作権', 'backmatter copyright-page'],
        ['奥付', 'backmatter colophon'],
      ]);
      // 後付けの見出しは節にする
      expect(book.chapters[3].sections).toEqual([{ title: '付録の節', id: 'sec-1' }]);
      const files = await unzipText(await buildEpub(book, { version }));
      const labels = [...files.get('OEBPS/toc.ncx')!.matchAll(/<text>([^<]+)<\/text>/g)].map((m) => m[1]).slice(1);
      expect(labels).toEqual([
        '本文',
        'afterword',
        '謝辞',
        '付録',
        '付録の節',
        '参考文献',
        '用語集',
        '索引',
        '著作権',
        '奥付',
      ]);
    }
  });
});

Deno.test('meta/ の index は索引であり、body/ の index とは別に扱う', async () => {
  await project({ 'body/部/index.md': '# 部', 'body/部/a.md': '# a', 'meta/index.md': '# 索引' }, async (dir) => {
    const book = await loadBook(dir, { version: '3.0' });
    expect(book.chapters.map((c) => [c.title, c.epubType])).toEqual([
      ['部', 'bodymatter part'],
      ['索引', 'backmatter index'],
    ]);
  });
});

Deno.test('本文から後付けへリンクできる', async () => {
  await project(
    { 'body/a.md': '[付録](../meta/appendix.md#x)', 'meta/appendix.md': '<p id="x">付録</p>' },
    async (dir) => {
      expect((await loadBook(dir, { version: '3.0' })).chapters[0].body).toBe('<p><a href="0002.xhtml#x">付録</a></p>');
    },
  );
});

Deno.test('後付けの誤り', async (t) => {
  const cases: Record<string, Record<string, string>> = {
    '知らない名前': { 'meta/preface.md': 'x' },
    '同じ名前の二つの形式': { 'meta/afterword.md': 'x', 'meta/afterword.html': 'x' },
    '英国の綴りの謝辞': { 'meta/acknowledgements.md': 'x' },
    'サブディレクトリ': { 'meta/appendix/a.md': 'x' },
  };
  for (const [label, files] of Object.entries(cases)) {
    await t.step(label, async () => {
      await expect(project({ 'body/a.md': 'a', ...files }, (dir) => loadBook(dir, { version: '3.0' }))).rejects
        .toMatchObject({ name: 'EpubInputError' });
    });
  }
});
