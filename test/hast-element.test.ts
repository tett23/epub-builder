// hast の要素を作る（ADR 0023）。期待する木は、置き換える前の hastscript 9.0.1 が作ったものを書いた
import { expect } from '@std/expect';
import type { ElementContent } from 'hast';
import { createElement, parseCommas, parseSpaces } from '../src/load/hast-element.ts';

Deno.test('空白で区切った値（space-separated-tokens と同じ）', () => {
  expect(parseSpaces(' a  b\tc\nd ')).toEqual(['a', 'b', 'c', 'd']);
  expect(parseSpaces('')).toEqual([]);
  expect(parseSpaces('   ')).toEqual([]);
  // 全角空白は区切りにしない
  expect(parseSpaces('a　b')).toEqual(['a　b']);
});

Deno.test('カンマで区切った値（comma-separated-tokens と同じ）', () => {
  expect(parseCommas('a, b ,c')).toEqual(['a', 'b', 'c']);
  expect(parseCommas('')).toEqual([]);
  expect(parseCommas('a,,b')).toEqual(['a', '', 'b']);
  // 最後の空の語は捨てる
  expect(parseCommas('a,')).toEqual(['a']);
  expect(parseCommas(',a')).toEqual(['', 'a']);
});

Deno.test('hastscript と同じ木を作る', async (t) => {
  const cases: [string, 'html' | 'svg', string, Record<string, string>, Record<string, unknown>][] = [
    [
      'class の複数の値、data-*、xml:lang',
      'html',
      'p',
      { class: ' a  b ', 'data-x-y': '1', 'xml:lang': 'en', id: 'i' },
      {
        className: ['a', 'b'],
        dataXY: '1',
        xmlLang: 'en',
        id: 'i',
      },
    ],
    ['真偽と数の属性', 'html', 'details', { open: '', hidden: 'hidden', tabindex: '3', 'aria-hidden': 'true' }, {
      open: true,
      hidden: true,
      tabIndex: 3,
      ariaHidden: 'true',
    }],
    ['srcset は分けない、width は数', 'html', 'img', { srcset: 'a.png 1x, b.png 2x', alt: '', width: '10' }, {
      srcSet: 'a.png 1x, b.png 2x',
      alt: '',
      width: 10,
    }],
    ['カンマ区切りと空白区切り、真偽', 'html', 'input', {
      accept: 'image/png, image/jpeg',
      'accept-charset': 'utf-8 latin1',
      checked: 'checked',
      value: '',
    }, { accept: ['image/png', 'image/jpeg'], acceptCharset: ['utf-8', 'latin1'], checked: true, value: '' }],
    ['headers と rel は配列、colspan は数', 'html', 'td', { headers: 'h1 h2', colspan: '2', rel: 'x' }, {
      headers: ['h1', 'h2'],
      colSpan: 2,
      rel: ['x'],
    }],
    ['SVG の大文字と小文字を含む属性と xlink:href', 'svg', 'svg', {
      viewBox: '0 0 1 1',
      'xlink:href': 'a.png',
      'stroke-width': '2',
      class: 'c d',
    }, { viewBox: '0 0 1 1', xLinkHref: 'a.png', strokeWidth: '2', className: ['c', 'd'] }],
    ['SVG の width は数にしない、xml:space', 'svg', 'image', { href: 'a.png', width: '50', 'xml:space': 'preserve' }, {
      href: 'a.png',
      width: '50',
      xmlSpace: 'preserve',
    }],
    ['知らない属性と style はそのまま', 'html', 'p', { 'epub:type': 'chapter', style: 'color: red' }, {
      'epub:type': 'chapter',
      style: 'color: red',
    }],
    ['download は真偽、rel は配列', 'html', 'a', { href: '#x', download: '', rel: 'noopener noreferrer' }, {
      href: '#x',
      download: true,
      rel: ['noopener', 'noreferrer'],
    }],
  ];
  for (const [label, space, tagName, attributes, properties] of cases) {
    await t.step(label, () => {
      expect(createElement(tagName, attributes, [], space)).toEqual({
        type: 'element',
        tagName,
        properties,
        children: [],
      });
    });
  }
});

Deno.test('要素の名前の . と # をセレクタとして読まない', () => {
  expect(createElement('my.el#x', {}, [], 'html').tagName).toBe('my.el#x');
});

Deno.test('子をそのまま持つ', () => {
  const children: ElementContent[] = [{ type: 'text', value: 'a' }];
  expect(createElement('p', {}, children, 'html').children).toBe(children);
});

Deno.test('属性がなければ空のプロパティ', () => {
  expect(createElement('br', {}, [], 'html').properties).toEqual({});
});
