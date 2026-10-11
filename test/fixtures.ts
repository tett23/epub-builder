import type { EpubVersion } from '../mod.ts';

/** フィクスチャ（test/fixtures/）と、作る版。EPUB 3 にしかない機能を使うものは 3.0 と 3.2 だけを作る */
export const FIXTURES: Record<string, EpubVersion[]> = {
  'sample-book': ['2.0.1', '3.0', '3.2'],
  'edge-book': ['2.0.1', '3.0', '3.2'],
  'epub3-book': ['3.0', '3.2'],
  'novel-book': ['2.0.1', '3.0', '3.2'],
  'large-book': ['2.0.1', '3.0', '3.2'],
  'tech-book': ['2.0.1', '3.0', '3.2'],
  'minimal-book': ['2.0.1', '3.0', '3.2'],
  'mixed-format-book': ['2.0.1', '3.0', '3.2'],
  'sections-book': ['2.0.1', '3.0', '3.2'],
};
