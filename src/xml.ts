/** XML の文字データとして書くために実体参照に直す */
export function escapeText(value: string): string {
  return value.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}

/** XML の属性値として書くために実体参照に直す */
export function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, '&quot;');
}

/** XML 1.0 の文字として使えない文字を含むか */
export function hasInvalidXmlChar(value: string): boolean {
  // deno-lint-ignore no-control-regex
  return /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
    .test(value);
}

/** パスを `/` で区切り、区切りごとにパーセントエンコードして URL の参照にする */
export function encodePath(path: string): string {
  return path.split('/').map((segment) => encodeURIComponent(segment)).join('/');
}
