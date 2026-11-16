// 작은 ZIP 쓰기 (docx = ZIP): 파일마다 deflate(브라우저 CompressionStream, 없으면 그대로 저장) 뒤 ../zip.ts의 packZip으로 묶는다.
// 읽기는 ../unzip.ts. ZIP64 · 암호 · 주석은 쓰지 않는다 — 노트 한 개 문서라 4GB에 닿지 않는다.
import { packZip, type ZipEntry, type ZipFile } from '../zip';

async function deflate(d: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream !== 'function' || d.length < 64) return null;
  try {
    const s = new Blob([d as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(s).arrayBuffer());
  } catch { return null; }
}

/** 파일들 → ZIP 바이트 */
export async function zip(entries: readonly ZipEntry[]): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const files: ZipFile[] = [];
  for (const e of entries) {
    const raw = typeof e.data === 'string' ? enc.encode(e.data) : e.data;
    const packed = await deflate(raw);
    const name = enc.encode(e.path);
    files.push(packed && packed.length < raw.length ? { name, raw, body: packed, method: 8 } : { name, raw, body: raw, method: 0 });
  }
  // 날짜: 1980-01-01 00:00 (DOS) — 같은 노트는 같은 파일이 나오게
  return packZip(files, 0, (1 << 5) | 1);
}
