// ルビの記法（ADR 0024）。`｜親文字《ルビ》` と、漢字だけの親文字の `漢字《かんじ》`。

export type RubySegment = { type: 'text'; value: string } | { type: 'ruby'; base: string; reading: string };

const KANJI = /^(?:\p{Script=Han}|[々〆〇ヶ])$/u;
const BARS = new Set(['｜', '|']);

function isKanji(char: string): boolean {
  return KANJI.test(char);
}

/** `《` から始まるルビを読む。読めなければ undefined */
function readReading(chars: string[], open: number): { reading: string; end: number } | undefined {
  for (let i = open + 1; i < chars.length; i++) {
    const c = chars[i];
    if (c === '》') {
      if (i === open + 1) return undefined;
      return { reading: chars.slice(open + 1, i).join(''), end: i + 1 };
    }
    if (c === '《' || BARS.has(c)) return undefined;
  }
  return undefined;
}

/** 文字列をルビの記法で区切る */
export function parseRuby(value: string): RubySegment[] {
  const chars = Array.from(value);
  const segments: RubySegment[] = [];
  let buffer: string[] = [];
  const flushText = () => {
    if (buffer.length === 0) return;
    const last = segments[segments.length - 1];
    if (last?.type === 'text') last.value += buffer.join('');
    else segments.push({ type: 'text', value: buffer.join('') });
    buffer = [];
  };

  let i = 0;
  while (i < chars.length) {
    const c = chars[i];
    if (c === '\\' && chars[i + 1] === '《') {
      buffer.push('《');
      i += 2;
      continue;
    }
    if (BARS.has(c)) {
      let j = i + 1;
      while (j < chars.length && chars[j] !== '《' && !BARS.has(chars[j]) && chars[j] !== '》') {
        if (chars[j] === '\\' && chars[j + 1] === '《') break;
        j++;
      }
      if (chars[j] === '《' && j > i + 1) {
        const reading = readReading(chars, j);
        if (reading) {
          flushText();
          segments.push({ type: 'ruby', base: chars.slice(i + 1, j).join(''), reading: reading.reading });
          i = reading.end;
          continue;
        }
      }
      buffer.push(c);
      i++;
      continue;
    }
    if (c === '《') {
      let start = buffer.length;
      while (start > 0 && isKanji(buffer[start - 1])) start--;
      const reading = start < buffer.length ? readReading(chars, i) : undefined;
      if (reading) {
        const base = buffer.splice(start).join('');
        flushText();
        segments.push({ type: 'ruby', base, reading: reading.reading });
        i = reading.end;
        continue;
      }
    }
    buffer.push(c);
    i++;
  }
  flushText();
  return segments;
}
