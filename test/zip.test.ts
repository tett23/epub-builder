import { expect } from '@std/expect';
import { crc32, writeZip } from '../src/zip.ts';
import { unzip } from './helpers/unzip.ts';

const encode = (s: string) => new TextEncoder().encode(s);

Deno.test('crc32 は既知の値と一致する', () => {
  expect(crc32(encode('123456789'))).toBe(0xcbf43926);
  expect(crc32(new Uint8Array())).toBe(0);
});

Deno.test('writeZip は項目を渡した順に書き、読み戻せる', async () => {
  const long = encode('あいうえお'.repeat(200));
  const zip = await writeZip([
    { name: 'mimetype', data: encode('application/epub+zip'), store: true },
    { name: 'a/長い.txt', data: long },
    { name: 'short', data: encode('x') },
  ], new Date('2026-10-09T00:00:00Z'));
  const entries = await unzip(zip);
  expect(entries.map((e) => e.name)).toEqual(['mimetype', 'a/長い.txt', 'short']);
  expect(entries[0].method).toBe(0);
  expect(entries[0].extraLength).toBe(0);
  expect(entries[0].flags).toBe(0);
  // 圧縮で小さくなる項目は deflate、大きくなる項目は stored
  expect(entries[1].method).toBe(8);
  expect(entries[1].flags & 0x0800).toBe(0x0800);
  expect(entries[2].method).toBe(0);
  expect(entries[1].data).toEqual(long);
  for (const entry of entries) expect(entry.crc).toBe(crc32(entry.data));
});

Deno.test('mimetype はファイルの先頭に圧縮せずに置かれる', async () => {
  const zip = await writeZip([{ name: 'mimetype', data: encode('application/epub+zip'), store: true }], new Date());
  expect(new TextDecoder().decode(zip.subarray(30, 38))).toBe('mimetype');
  expect(new TextDecoder().decode(zip.subarray(38, 58))).toBe('application/epub+zip');
});
