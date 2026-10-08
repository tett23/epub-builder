import type { EpubVersion } from '../mod.ts';

/** フィクスチャ（test/fixtures/）と、作る版。EPUB 3.0 にしかない機能を使うものは 3.0 だけを作る */
export const FIXTURES: Record<string, EpubVersion[]> = {
  'sample-book': ['2.0.1', '3.0'],
  'edge-book': ['2.0.1', '3.0'],
  'epub3-book': ['3.0'],
};
