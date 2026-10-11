// hast の要素を作る（ADR 0023）。hastscript のうち、XML の断片の解析器が使う部分だけを自前で書く。
// 属性の名前と値の扱いは hastscript（create-h.js の addProperty、parsePrimitive）と同じにする

import type { Element, ElementContent, Properties } from 'hast';
import { find, html, normalize, svg } from 'property-information';

/** 空白で区切った値を、空でない語の並びにする（space-separated-tokens の parse と同じ） */
export function parseSpaces(value: string): string[] {
  const input = value.trim();
  return input ? input.split(/[ \t\n\r\f]+/g) : [];
}

/** カンマで区切った値を、前後の空白を除いた語の並びにする（comma-separated-tokens の parse と同じ） */
export function parseCommas(value: string): string[] {
  const tokens: string[] = [];
  let start = 0;
  let index = value.indexOf(',');
  let end = false;
  while (!end) {
    if (index === -1) {
      index = value.length;
      end = true;
    }
    const token = value.slice(start, index).trim();
    if (token || !end) tokens.push(token);
    start = index + 1;
    index = value.indexOf(',', start);
  }
  return tokens;
}

type Info = ReturnType<typeof find>;

function parsePrimitive(info: Info, value: string): string | number | boolean {
  if (info.number && value && !Number.isNaN(Number(value))) return Number(value);
  if ((info.boolean || info.overloadedBoolean) && (value === '' || normalize(value) === normalize(info.property))) {
    return true;
  }
  return value;
}

/**
 * 属性の名前と値（文字列）から、hast の要素を作る。
 * `space` が `svg` なら SVG の、ほかは HTML の属性の対応表を使う
 */
export function createElement(
  tagName: string,
  attributes: Readonly<Record<string, string>>,
  children: ElementContent[],
  space: 'html' | 'svg',
): Element {
  const schema = space === 'svg' ? svg : html;
  const properties: Properties = {};
  for (const [name, value] of Object.entries(attributes)) {
    const info = find(schema, name);
    const list = info.spaceSeparated
      ? parseSpaces(value)
      : info.commaSeparated
      ? parseCommas(value)
      : info.commaOrSpaceSeparated
      ? parseSpaces(parseCommas(value).join(' '))
      : undefined;
    properties[info.property] = list === undefined
      ? parsePrimitive(info, value)
      : list.map((item) => parsePrimitive(info, item) as string | number);
  }
  return { type: 'element', tagName, properties, children };
}
