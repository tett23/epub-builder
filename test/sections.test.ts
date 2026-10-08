// 文書の中の見出しを節として目次に出す（ADR 0009）
import { expect } from '@std/expect';
import { type Book, buildEpub, EpubInputError, type Section } from '../mod.ts';
import { loadBook } from '../load.ts';
import { sourceToTree } from '../src/load/convert.ts';
import { extractSections, headingTitle } from '../src/load/load-book.ts';
import { writeXhtml } from '../src/load/xhtml-writer.ts';
import type { EpubVersion } from '../src/types.ts';
import { unzipText } from './helpers/unzip.ts';

/** 節を「題名#id」の入れ子の配列にして比べやすくする */
const shape = (sections: Section[]): unknown[] =>
  sections.map((s) => (s.children ? [`${s.title}#${s.id}`, shape(s.children)] : `${s.title}#${s.id}`));

const sections = (src: string, format: 'md' | 'xhtml' | 'html' = 'md', version: EpubVersion = '3.0') => {
  const tree = sourceToTree(src, format, version);
  const result = extractSections(tree);
  return { sections: shape(result), body: writeXhtml(tree, version), title: headingTitle(tree) };
};

Deno.test('見出しのレベルで入れ子にする', async (t) => {
  await t.step('最初の見出しは題名にして節にしない', () => {
    expect(sections('# 題\n\n## 一\n\n## 二').sections).toEqual(['一#sec-1', '二#sec-2']);
  });
  await t.step('深い入れ子', () => {
    expect(sections('# 題\n\n## 一\n\n### 一の一\n\n#### 一の一の一\n\n### 一の二\n\n## 二').sections).toEqual([
      ['一#sec-1', [['一の一#sec-2', ['一の一の一#sec-3']], '一の二#sec-4']],
      '二#sec-5',
    ]);
  });
  await t.step('レベルが飛ぶ見出しは、直前の小さいレベルの子にする', () => {
    expect(sections('# 題\n\n## 一\n\n##### 深い\n\n### 浅い').sections).toEqual([
      ['一#sec-1', ['深い#sec-2', '浅い#sec-3']],
    ]);
  });
  await t.step('題名より小さいレベルの見出しは、文書の直下に置く', () => {
    expect(sections('## 題\n\n### 一\n\n# 大きい\n\n### 二').sections).toEqual([
      '一#sec-1',
      ['大きい#sec-2', ['二#sec-3']],
    ]);
  });
  await t.step('同じレベルの見出しは兄弟にする', () => {
    expect(sections('# 題\n\n# 二つ目の h1\n\n# 三つ目の h1').sections).toEqual([
      '二つ目の h1#sec-1',
      '三つ目の h1#sec-2',
    ]);
  });
  await t.step('見出しが一つだけ、または見出しがない文書には節がない', () => {
    expect(sections('# 題\n\n本文').sections).toEqual([]);
    expect(sections('本文だけ').sections).toEqual([]);
  });
  await t.step('入れ子の要素の中の見出しも節にする', () => {
    expect(sections('<h1>題</h1><div><blockquote><h2>中</h2></blockquote></div>', 'html').sections).toEqual([
      '中#sec-1',
    ]);
  });
});

Deno.test('見出しの id', async (t) => {
  await t.step('id のない見出しに sec-<番号> を付けて書き出す', () => {
    const { body } = sections('# 題\n\n## 一\n\n## 二');
    expect(body).toBe('<h1>題</h1>\n<h2 id="sec-1">一</h2>\n<h2 id="sec-2">二</h2>');
  });
  await t.step('題名の見出しには id を付けない', () => {
    expect(sections('# 題').body).toBe('<h1>題</h1>');
  });
  await t.step('見出しの id はそのまま使う', () => {
    expect(sections('<h1>題</h1><h2 id="a">一</h2><h2>二</h2>', 'html').sections).toEqual(['一#a', '二#sec-1']);
  });
  await t.step('本文にある id を避けて番号を飛ばす', () => {
    const src = '<h1>題</h1><p id="sec-1">x</p><h2>一</h2><h2 id="sec-3">三</h2><h2>四</h2><h2>五</h2>';
    expect(sections(src, 'xhtml').sections).toEqual(['一#sec-2', '三#sec-3', '四#sec-4', '五#sec-5']);
  });
  await t.step('空の id は持たないものとする', () => {
    expect(sections('<h1>題</h1><h2 id="">一</h2>', 'html').sections).toEqual(['一#sec-1']);
  });
});

Deno.test('節にしない見出し', async (t) => {
  await t.step('空の見出しは節にせず、id も付けない', () => {
    const result = sections('# 題\n\n## \n\n<h2><rt>読み</rt></h2>\n\n## 一');
    expect(result.sections).toEqual(['一#sec-1']);
    expect(result.body).toContain('<h2></h2>');
  });
  await t.step('脚注の欄の中の見出しは節にしない', () => {
    expect(sections('# 題\n\n本文[^a]\n\n## 一\n\n[^a]: 注\n\n    ## 注の中の見出し').sections).toEqual([
      '一#sec-1',
    ]);
  });
  await t.step('脚注の欄の中の見出しは題名にもしない', () => {
    expect(sections('本文[^a]\n\n[^a]: 注\n\n    ## 注の中の見出し').title).toBe(undefined);
  });
});

Deno.test('節の題名から、ルビの読みと脚注の参照を除く', () => {
  for (const version of ['2.0.1', '3.0'] as const) {
    expect(sections('# 題\n\n## 第一《だいいち》節[^a]\n\n[^a]: 注', 'md', version).sections).toEqual([
      '第一節#sec-1',
    ]);
  }
  expect(sections('<h1>題</h1><h2>  a\n  b  </h2><h2>全角　空白</h2>', 'html').sections).toEqual([
    'a b#sec-1',
    '全角　空白#sec-2',
  ]);
});

const book = (chapters: Book['chapters']): Book => ({
  metadata: { identifier: 'id', title: 't', language: 'ja', modified: new Date('2026-01-01T00:00:00Z') },
  chapters,
});

Deno.test('buildEpub は節を目次に書く', async () => {
  const b = book([
    {
      title: '部',
      body: '<h1>部</h1><h2 id="p1">部の節</h2>',
      sections: [{ title: '部の節', id: 'p1' }],
      children: [{
        title: '章',
        body: '<h1>章</h1><h2 id="s1">節</h2><h3 id="s2">項</h3>',
        sections: [{ title: '節', id: 's1', children: [{ title: '項', id: 's2' }] }],
      }],
    },
  ]);
  for (const version of ['2.0.1', '3.0'] as const) {
    const files = await unzipText(await buildEpub(b, { version }));
    const ncx = files.get('OEBPS/toc.ncx')!;
    const order = [
      ...ncx.matchAll(/playOrder="(\d+)">\s*<navLabel><text>([^<]+)<\/text><\/navLabel>\s*<content src="([^"]+)"/g),
    ]
      .map((m) => [m[2], m[1], m[3]]);
    // 節は子の章より前に並び、playOrder は目次の順に振る
    expect(order).toEqual([
      ['部', '1', 'text/0001.xhtml'],
      ['部の節', '2', 'text/0001.xhtml#p1'],
      ['章', '3', 'text/0002.xhtml'],
      ['節', '4', 'text/0002.xhtml#s1'],
      ['項', '5', 'text/0002.xhtml#s2'],
    ]);
    expect(ncx).toContain('<meta name="dtb:depth" content="4"/>');
    if (version === '3.0') {
      const nav = files.get('OEBPS/nav.xhtml')!;
      expect(nav).toMatch(
        /<a href="text\/0001.xhtml">部<\/a>\s*<ol>\s*<li><a href="text\/0001.xhtml#p1">部の節<\/a><\/li>\s*<li><a href="text\/0002.xhtml">章<\/a>/,
      );
    }
  }
});

Deno.test('節の id は断片識別子としてエンコードする', async () => {
  const b = book([{ title: '章', body: '<h2 id="節-1">節</h2>', sections: [{ title: '節', id: '節-1' }] }]);
  const files = await unzipText(await buildEpub(b, { version: '3.0' }));
  expect(files.get('OEBPS/nav.xhtml')).toContain(`href="text/0001.xhtml#${encodeURIComponent('節-1')}"`);
});

Deno.test('buildEpub は節の誤りを例外にする', async (t) => {
  const cases: [string, Book['chapters']][] = [
    ['本文のない章の節', [{ title: '章', sections: [{ title: '節', id: 'a' }], children: [{ title: 'c', body: '' }] }]],
    ['空の id', [{ title: '章', body: '<h2 id="">x</h2>', sections: [{ title: '節', id: '' }] }]],
    ['空白を含む id', [{ title: '章', body: '<h2 id="a b">x</h2>', sections: [{ title: '節', id: 'a b' }] }]],
    ['本文にない id', [{ title: '章', body: '<h2>x</h2>', sections: [{ title: '節', id: 'none' }] }]],
    ['子の節の本文にない id', [{
      title: '章',
      body: '<h2 id="a">x</h2>',
      sections: [{ title: '節', id: 'a', children: [{ title: '項', id: 'b' }] }],
    }]],
    ['空の題名', [{ title: '章', body: '<h2 id="a">x</h2>', sections: [{ title: ' ', id: 'a' }] }]],
  ];
  for (const [label, chapters] of cases) {
    await t.step(label, async () => {
      await expect(buildEpub(book(chapters), { version: '3.0' })).rejects.toThrow(EpubInputError);
    });
  }
});

Deno.test('loadBook は index の節を子より前に、奥付の節を目次に入れ、表紙の見出しを入れない', async () => {
  const dir = await Deno.makeTempDir({ prefix: 'epub-builder-test-' });
  try {
    const files: Record<string, string> = {
      'book.toml': 'identifier = "id"\ntitle = "t"\nlanguage = "ja"\n',
      'body/部/index.md': '# 部\n\n## 扉の節',
      'body/部/章.md': '# 章\n\n## 章の節',
      'meta/cover.md': '# 表紙\n\n## 表紙の節',
      'meta/colophon.md': '# 奥付\n\n## 奥付の節',
    };
    for (const [path, content] of Object.entries(files)) {
      await Deno.mkdir(`${dir}/${path.slice(0, path.lastIndexOf('/'))}`, { recursive: true }).catch(() => {});
      await Deno.writeTextFile(`${dir}/${path}`, content);
    }
    const loaded = await loadBook(dir, { version: '3.0' });
    expect(loaded.chapters[0]).toMatchObject({ title: '部', sections: [{ title: '扉の節', id: 'sec-1' }] });
    expect(loaded.chapters[0].children![0].sections).toEqual([{ title: '章の節', id: 'sec-1' }]);
    expect(loaded.chapters[1].sections).toEqual([{ title: '奥付の節', id: 'sec-1' }]);
    expect(loaded.cover!.body).toBe('<h1>表紙</h1>\n<h2>表紙の節</h2>');
    const nav = (await unzipText(await buildEpub(loaded, { version: '3.0' }))).get('OEBPS/nav.xhtml')!;
    expect(nav.indexOf('扉の節')).toBeLessThan(nav.indexOf('>章<'));
    expect(nav).not.toContain('表紙');
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
