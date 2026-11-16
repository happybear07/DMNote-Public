// ZIP 읽기 — 가져오기용. 무압축(store)과 deflate(브라우저 내장 DecompressionStream)만. 암호 · ZIP64는 다루지 않는다.

export interface UnzipEntry { path: string; data: Uint8Array }

export async function unzip(buf: Uint8Array): Promise<UnzipEntry[]> {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // 끝에서 중앙 디렉터리 끝(EOCD) 서명 찾기 (뒤에 주석이 붙을 수 있다)
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ZIP 파일이 아니에요');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out: UnzipEntry[] = [];
  const utf8 = new TextDecoder('utf-8');
  for (let i = 0; i < count; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('ZIP 목록이 손상됐어요');
    const flags = v.getUint16(p + 8, true);
    const method = v.getUint16(p + 10, true);
    const size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true), extra = v.getUint16(p + 30, true), comment = v.getUint16(p + 32, true);
    const off = v.getUint32(p + 42, true);
    const rawName = buf.subarray(p + 46, p + 46 + nameLen);
    // 비트 11이 없어도 요즘 도구는 대개 UTF-8로 쓴다 — 깨지면 그대로 둔다
    const path = utf8.decode(rawName);
    p += 46 + nameLen + extra + comment;
    if (path.endsWith('/') || flags & 1) continue; // 폴더 항목 · 암호 걸린 파일
    const lName = v.getUint16(off + 26, true), lExtra = v.getUint16(off + 28, true);
    const start = off + 30 + lName + lExtra;
    const raw = buf.subarray(start, start + size);
    if (method === 0) out.push({ path, data: raw });
    else if (method === 8) out.push({ path, data: await inflate(raw) });
  }
  return out;
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
