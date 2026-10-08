/**
 * ディレクトリから EPUB を作るコマンドラインの入口（ADR 0016）。
 *
 * ```sh
 * deno run --allow-read --allow-write cli.ts build my-book
 * ```
 *
 * @module
 */

import { main } from './src/cli.ts';

export { main };

if (import.meta.main) Deno.exit(await main(Deno.args));
