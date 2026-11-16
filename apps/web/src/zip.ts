// ZIP 만들기 — 노트 내보내기(압축 없는 store)와 워드(docx/zip.ts — 파일마다 deflate)가 같은 묶기(packZip)를 쓴다.
// 의존성 없이 PKZIP 형식만 맞춘다 (파일 이름 UTF-8, 플래그 비트 11). 4GB · 파일 65535개를 넘는 경우(ZIP64)는 다루지 않는다.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((Math.max(d.getFullYear(), 1980) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export interface ZipEntry { path: string; data: Uint8Array | string }

/** 묶을 파일 하나: 원래 바이트(raw — CRC · 원래 크기)와 실제로 넣을 바이트(body). method 0 = 그대로, 8 = deflate */
export interface ZipFile { name: Uint8Array; raw: Uint8Array; body: Uint8Array; method: 0 | 8 }

/** 파일들 → ZIP 바이트 (time · date = DOS 시각) */
export function packZip(files: readonly ZipFile[], time: number, date: number): Uint8Array<ArrayBuffer> {
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const { name, raw, body, method } of files) {
    const crc = crc32(raw);
    const head = new Uint8Array(30 + name.length);
    const h = new DataView(head.buffer);
    h.setUint32(0, 0x04034b50, true);
    h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, method, true);
    h.setUint16(10, time, true); h.setUint16(12, date, true);
    h.setUint32(14, crc, true); h.setUint32(18, body.length, true); h.setUint32(22, raw.length, true);
    h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
    head.set(name, 30);
    local.push(head, body);

    const cen = new Uint8Array(46 + name.length);
    const c = new DataView(cen.buffer);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, method, true);
    c.setUint16(12, time, true); c.setUint16(14, date, true);
    c.setUint32(16, crc, true); c.setUint32(20, body.length, true); c.setUint32(24, raw.length, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    cen.set(name, 46);
    central.push(cen);
    offset += head.length + body.length;
  }
  const cenSize = central.reduce((s, x) => s + x.length, 0);
  const end = new Uint8Array(22);
  const v = new DataView(end.buffer);
  v.setUint32(0, 0x06054b50, true);
  v.setUint16(8, files.length, true); v.setUint16(10, files.length, true);
  v.setUint32(12, cenSize, true); v.setUint32(16, offset, true);
  const out = new Uint8Array(offset + cenSize + 22);
  let at = 0;
  for (const part of [...local, ...central, end]) { out.set(part, at); at += part.length; }
  return out;
}

/** 압축 없는 ZIP (글자 파일 위주라 크기 문제는 작다) */
export function makeZip(entries: readonly ZipEntry[], when = new Date()): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  const { time, date } = dosTime(when);
  return packZip(entries.map((e) => {
    const data = typeof e.data === 'string' ? enc.encode(e.data) : e.data;
    return { name: enc.encode(e.path), raw: data, body: data, method: 0 };
  }), time, date);
}
