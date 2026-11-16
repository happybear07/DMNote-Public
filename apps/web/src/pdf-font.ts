// PDF 글자 층의 글꼴 (pdf.ts): 쪽 그림 위에 깐 보이지 않는 글자(그리기 방식 3)는 모양이 필요 없다 — 빈 글리프 하나뿐인
// 아주 작은 TrueType 글꼴을 넣고(뷰어가 "글꼴 없음" 경고를 띄우지 않게), 글자 → 유니코드 대응표(ToUnicode)로 고르기 · 찾기 · 복사가 되게 한다.

/** 빈 글리프(.notdef) 하나뿐인 TrueType 글꼴 — 필수 표(head · hhea · maxp · hmtx · loca · glyf) + post */
export function blankTrueType(): Uint8Array {
  const T = (n: number, fill: (v: DataView) => void) => { const b = new Uint8Array(n); fill(new DataView(b.buffer)); return b; };
  const tables: Record<string, Uint8Array> = {
    head: T(54, (v) => {
      v.setUint32(0, 0x10000); v.setUint32(4, 0x10000); v.setUint32(12, 0x5f0f3cf5); v.setUint16(16, 0x000b); v.setUint16(18, 1000);
      v.setInt16(38, -200); v.setInt16(40, 1000); v.setInt16(42, 800); v.setUint16(46, 8); v.setInt16(48, 2); // indexToLocFormat 0 (짧은 loca)
    }),
    hhea: T(36, (v) => { v.setUint32(0, 0x10000); v.setInt16(4, 800); v.setInt16(6, -200); v.setUint16(10, 1000); v.setInt16(18, 1); v.setUint16(34, 1); }),
    maxp: T(32, (v) => { v.setUint32(0, 0x10000); v.setUint16(4, 1); v.setUint16(14, 2); }),
    hmtx: T(4, (v) => v.setUint16(0, 1000)),
    loca: T(4, (v) => v.setUint16(2, 6)), // 글리프 0: 0 ~ 12바이트 (짧은 형식은 2로 나눈 값)
    glyf: T(12, () => {}), // 윤곽 0개 · 상자 0 · 명령 길이 0
    post: T(32, (v) => { v.setUint32(0, 0x30000); v.setInt16(8, -100); v.setInt16(10, 50); }),
  };
  const tags = Object.keys(tables).sort();
  const n = tags.length, pad4 = (x: number) => (x + 3) & ~3;
  let size = 12 + 16 * n;
  const at: number[] = [];
  for (const t of tags) { at.push(size); size += pad4(tables[t]!.length); }
  const out = new Uint8Array(size), v = new DataView(out.buffer);
  const sum = (from: number, len: number) => { let s = 0; for (let i = 0; i < pad4(len); i += 4) s = (s + v.getUint32(from + i)) >>> 0; return s; };
  const sel = Math.floor(Math.log2(n));
  v.setUint32(0, 0x10000); v.setUint16(4, n); v.setUint16(6, 16 << sel); v.setUint16(8, sel); v.setUint16(10, n * 16 - (16 << sel));
  tags.forEach((t, i) => {
    const data = tables[t]!;
    out.set(data, at[i]!);
    const e = 12 + 16 * i;
    for (let k = 0; k < 4; k++) v.setUint8(e + k, t.charCodeAt(k));
    v.setUint32(e + 4, sum(at[i]!, data.length)); v.setUint32(e + 8, at[i]!); v.setUint32(e + 12, data.length);
  });
  v.setUint32(at[tags.indexOf('head')]! + 8, (0xb1b0afba - sum(0, size)) >>> 0); // 글꼴 전체 검사합 맞추기
  return out;
}

/** 유니코드 코드 포인트 → UTF-16BE 16진 */
function utf16Hex(cp: number): string {
  if (cp <= 0xffff) return cp.toString(16).padStart(4, '0');
  const c = cp - 0x10000;
  return ((0xd800 + (c >> 10)).toString(16) + (0xdc00 + (c & 0x3ff)).toString(16)).padStart(8, '0');
}

/** 글자 번호(CID) → 유니코드 대응표 (ToUnicode CMap) */
export function toUnicodeCMap(cids: ReadonlyMap<number, number>): string {
  const rows = [...cids].map(([cp, cid]) => `<${cid.toString(16).padStart(4, '0')}> <${utf16Hex(cp)}>`);
  const blocks: string[] = [];
  for (let i = 0; i < rows.length; i += 100) blocks.push(`${Math.min(100, rows.length - i)} beginbfchar\n${rows.slice(i, i + 100).join('\n')}\nendbfchar`);
  return ['/CIDInit /ProcSet findresource begin', '12 dict begin', 'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def', '/CMapName /Adobe-Identity-UCS def', '/CMapType 2 def',
    '1 begincodespacerange', '<0000> <FFFF>', 'endcodespacerange', ...blocks, 'endcmap', 'CMapName currentdict /CMap defineresource pop', 'end', 'end'].join('\n');
}
