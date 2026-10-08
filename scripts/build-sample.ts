// フィクスチャ（test/fixtures/）から、版ごとに EPUB を作る。CI で EPUBCheck に掛けるために使う
import { buildEpub } from '../mod.ts';
import { loadBook } from '../load.ts';
import { FIXTURES } from '../test/fixtures.ts';

const outDir = Deno.args[0] ?? 'build';
await Deno.mkdir(outDir, { recursive: true });
for (const [name, versions] of Object.entries(FIXTURES)) {
  for (const version of versions) {
    const book = await loadBook(`test/fixtures/${name}`, { version });
    const path = `${outDir}/${name}-${version}.epub`;
    await Deno.writeFile(path, await buildEpub(book, { version }));
    console.log(path);
  }
}
