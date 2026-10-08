// テスト用の zip の読み戻し

export interface UnzippedEntry {
  name: string;
  method: number;
  flags: number;
  crc: number;
  extraLength: number;
  data: Uint8Array;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(
    new DecompressionStream('deflate-raw'),
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** 中央ディレクトリを読み、項目を中央ディレクトリの順に返す */
export async function unzip(zip: Uint8Array): Promise<UnzippedEntry[]> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const endAt = zip.length - 22;
  if (view.getUint32(endAt, true) !== 0x06054b50) throw new Error('中央ディレクトリの終わりがない');
  const count = view.getUint16(endAt + 10, true);
  let p = view.getUint32(endAt + 16, true);
  const decoder = new TextDecoder();
  const entries: UnzippedEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error('中央ディレクトリの項目がない');
    const method = view.getUint16(p + 10, true);
    const crc = view.getUint32(p + 16, true);
    const compressedSize = view.getUint32(p + 20, true);
    const nameLength = view.getUint16(p + 28, true);
    const offset = view.getUint32(p + 42, true);
    const name = decoder.decode(zip.subarray(p + 46, p + 46 + nameLength));
    if (view.getUint32(offset, true) !== 0x04034b50) throw new Error('ローカルヘッダがない');
    const flags = view.getUint16(offset + 6, true);
    const localNameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const start = offset + 30 + localNameLength + extraLength;
    const raw = zip.subarray(start, start + compressedSize);
    const data = method === 8 ? await inflateRaw(raw) : raw.slice();
    entries.push({ name, method, flags, crc, extraLength, data });
    p += 46 + nameLength + view.getUint16(p + 30, true) + view.getUint16(p + 32, true);
  }
  return entries;
}

export async function unzipText(zip: Uint8Array): Promise<Map<string, string>> {
  const decoder = new TextDecoder();
  return new Map((await unzip(zip)).map((e) => [e.name, decoder.decode(e.data)]));
}
