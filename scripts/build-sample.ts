// フィクスチャ（test/fixtures/sample-book）から、版ごとに EPUB を作る。CI で EPUBCheck に掛けるために使う
import { buildEpub } from '../mod.ts';
import { loadBook } from '../load.ts';

const outDir = Deno.args[0] ?? 'build';
await Deno.mkdir(outDir, { recursive: true });
for (const version of ['2.0.1', '3.0'] as const) {
  const book = await loadBook('test/fixtures/sample-book', { version });
  const path = `${outDir}/sample-book-${version}.epub`;
  await Deno.writeFile(path, await buildEpub(book, { version }));
  console.log(path);
}
