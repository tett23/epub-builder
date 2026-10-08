import type { EpubVersion } from '../types.ts';

export const NS = {
  xhtml: 'http://www.w3.org/1999/xhtml',
  svg: 'http://www.w3.org/2000/svg',
  mathml: 'http://www.w3.org/1998/Math/MathML',
  xlink: 'http://www.w3.org/1999/xlink',
  xml: 'http://www.w3.org/XML/1998/namespace',
  xmlns: 'http://www.w3.org/2000/xmlns/',
  epub: 'http://www.idpf.org/2007/ops',
} as const;

/** 本文の断片の中で、宣言せずに使える属性の接頭辞（`buildEpub` が包む文書で宣言するもの） */
export function attributePrefixes(version: EpubVersion): Map<string, string> {
  const prefixes = new Map<string, string>([['xml', NS.xml], ['xlink', NS.xlink]]);
  if (version === '3.0') prefixes.set('epub', NS.epub);
  return prefixes;
}

const NAME_START =
  'A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\u{10000}-\\u{EFFFF}';
const NAME_CHAR = `${NAME_START}\\-.0-9\\u00B7\\u0300-\\u036F\\u203F-\\u2040`;

/** XML の名前空間での名前（コロンを含まない名前） */
export const NCNAME = new RegExp(`^[${NAME_START}][${NAME_CHAR}]*$`, 'u');
