// PDF 파일 만들기 (FR-131): 쪽마다 그린 JPEG 그림을 쪽에 꽉 채운 PDF 1.4 — 라이브러리 없이 직접 쓴다.
// 그림 위에 보이지 않는 글자 층(pdf-text.ts가 잰 줄 · 자리, 빈 글꼴 + ToUnicode — pdf-font.ts)을 깔아 글자를 고르고 · 찾고 · 복사할 수 있고,
// 제목 책갈피(Outlines) · 웹 링크 · 상호 참조 · 목차 링크도 넣는다. 제목은 문서 정보(Title)에 UTF-16으로.
import { blankTrueType, toUnicodeCMap } from './pdf-font';

export interface PdfRect { readonly x: number; readonly y: number; readonly w: number; readonly h: number }
/** 한 줄 조각 — 자리는 쪽 왼쪽 위 기준 CSS px */
export interface PdfTextRun extends PdfRect { readonly text: string }
/** 링크: 웹 주소(href) 또는 문서 안 자리(dest: 쪽 번호 0부터 · 위에서 y CSS px) */
export interface PdfLink extends PdfRect { readonly href?: string; readonly dest?: { readonly page: number; readonly y: number } }
export interface PdfOutline { readonly title: string; readonly level: number; readonly page: number; readonly y: number }
export interface PdfPage {
  readonly jpeg: Uint8Array;
  /** 그림 픽셀 크기 */
  readonly w: number; readonly h: number;
  /** 쪽 크기 (CSS px) — 글자 층 · 링크 자리를 pt로 바꿀 때 */
  readonly pw?: number;
  readonly text?: readonly PdfTextRun[];
  readonly links?: readonly PdfLink[];
}

/** A4 (포인트) */
export const A4_PT = { w: 595.28, h: 841.89 } as const;

/** 한글 제목 → PDF 글자열 <FEFF…> (UTF-16BE 16진) */
function pdfText(s: string): string {
  let hex = 'FEFF';
  for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
  return `<${hex}>`;
}

const num = (n: number) => String(Math.round(n * 100) / 100);

export function imagesToPdf(pages: readonly PdfPage[], title = '', outline: readonly PdfOutline[] = []): Blob {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let len = 0;
  const push = (d: Uint8Array | string) => { const b = typeof d === 'string' ? enc.encode(d) : d; parts.push(b); len += b.length; };
  const obj = (id: number, ...body: (Uint8Array | string)[]) => { offsets[id] = len; push(`${id} 0 obj\n`); for (const b of body) push(b); push('\nendobj\n'); };
  const stream = (id: number, data: string, extra = '') => obj(id, `<< /Length ${enc.encode(data).length}${extra} >>\nstream\n${data}\nendstream`);
  let next = 1;
  const alloc = () => next++;
  const CATALOG = alloc(), PAGES = alloc(), INFO = alloc();
  const pg = pages.map((p) => {
    const [W, H] = p.w > p.h ? [A4_PT.h, A4_PT.w] : [A4_PT.w, A4_PT.h]; // 가로 쪽 (쪽 설정)
    return { p, W, H, s: W / (p.pw ?? W), page: alloc(), contents: alloc(), image: alloc(), links: (p.links ?? []).map(alloc) };
  });
  const font = pages.some((p) => p.text?.length) ? { type0: alloc(), cid: alloc(), desc: alloc(), file: alloc(), map: alloc() } : null;
  const outRoot = outline.length ? alloc() : 0;
  const outIds = outline.map(alloc);
  // 글자 → 글자 번호(CID): 문서에 나온 차례대로 1부터
  const cids = new Map<number, number>();
  const hex = (s: string) => {
    let h = '';
    for (const ch of s) {
      const cp = ch.codePointAt(0)!;
      let c = cids.get(cp);
      if (c === undefined && cids.size < 0xfffe) { c = cids.size + 1; cids.set(cp, c); }
      h += (c ?? 0).toString(16).padStart(4, '0');
    }
    return h;
  };
  const dest = (d: { page: number; y: number }) => { const t = pg[Math.min(pg.length - 1, Math.max(0, d.page))]!; return `[${t.page} 0 R /XYZ 0 ${num(t.H - Math.max(0, d.y - 12) * t.s)} null]`; };

  // 머리: 버전 + 이진 파일 표시(128 이상 바이트 넷)
  push('%PDF-1.4\n');
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  obj(CATALOG, `<< /Type /Catalog /Pages ${PAGES} 0 R${outRoot ? ` /Outlines ${outRoot} 0 R /PageMode /UseOutlines` : ''} >>`);
  obj(PAGES, `<< /Type /Pages /Count ${pages.length} /Kids [${pg.map((x) => `${x.page} 0 R`).join(' ')}] >>`);
  obj(INFO, `<< /Title ${pdfText(title)} /Producer (DamianNote) >>`);
  for (const { p, W, H, s, page, contents, image, links } of pg) {
    let draw = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
    // 보이지 않는 글자(3 Tr): 줄 높이를 글자 크기로, 글자 수 × 크기가 잰 폭과 같도록 가로 배율(Tz)
    if (font && p.text?.length) {
      const lines = ['BT 3 Tr'];
      for (const r of p.text) {
        const n = [...r.text].length, fs = r.h * s;
        if (!n || fs <= 0) continue;
        lines.push(`/F1 ${num(fs)} Tf ${num(((r.w * s) / (n * fs)) * 100)} Tz 1 0 0 1 ${num(r.x * s)} ${num(H - (r.y + r.h * 0.8) * s)} Tm <${hex(r.text)}> Tj`);
      }
      lines.push('ET');
      draw += `\n${lines.join('\n')}`;
    }
    const res = `/XObject << /Im0 ${image} 0 R >>${font ? ` /Font << /F1 ${font.type0} 0 R >>` : ''}`;
    obj(page, `<< /Type /Page /Parent ${PAGES} 0 R /MediaBox [0 0 ${W} ${H}] /Resources << ${res} >> /Contents ${contents} 0 R${links.length ? ` /Annots [${links.map((i) => `${i} 0 R`).join(' ')}]` : ''} >>`);
    stream(contents, draw);
    obj(image, `<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`, p.jpeg, '\nendstream');
    (p.links ?? []).forEach((l, i) => {
      const rect = `[${num(l.x * s)} ${num(H - (l.y + l.h) * s)} ${num((l.x + l.w) * s)} ${num(H - l.y * s)}]`;
      const action = l.href ? `/A << /S /URI /URI (${l.href.replace(/[\\()]/g, '\\$&')}) >>` : l.dest ? `/Dest ${dest(l.dest)}` : '';
      obj(links[i]!, `<< /Type /Annot /Subtype /Link /Rect ${rect} /Border [0 0 0] ${action} >>`);
    });
  }
  if (font) {
    obj(font.type0, `<< /Type /Font /Subtype /Type0 /BaseFont /DamianNoteText /Encoding /Identity-H /DescendantFonts [${font.cid} 0 R] /ToUnicode ${font.map} 0 R >>`);
    obj(font.cid, `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /DamianNoteText /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${font.desc} 0 R /DW 1000 /CIDToGIDMap /Identity >>`);
    obj(font.desc, `<< /Type /FontDescriptor /FontName /DamianNoteText /Flags 4 /FontBBox [0 -200 1000 800] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 /FontFile2 ${font.file} 0 R >>`);
    const ttf = blankTrueType();
    obj(font.file, `<< /Length ${ttf.length} /Length1 ${ttf.length} >>\nstream\n`, ttf, '\nendstream');
    stream(font.map, toUnicodeCMap(cids));
  }
  // 책갈피: 단계로 나무를 만든다 (모두 펼친 채)
  if (outRoot) {
    const parent: number[] = [], kids = new Map<number, number[]>([[-1, []]]);
    const stack: number[] = [];
    outline.forEach((o, i) => {
      while (stack.length && outline[stack[stack.length - 1]!]!.level >= o.level) stack.pop();
      const pi = stack.length ? stack[stack.length - 1]! : -1;
      parent[i] = pi;
      (kids.get(pi) ?? kids.set(pi, []).get(pi)!).push(i);
      stack.push(i);
    });
    const count = (i: number): number => (kids.get(i) ?? []).reduce((a, k) => a + 1 + count(k), 0);
    const ref = (i: number) => (i < 0 ? outRoot : outIds[i]!);
    const top = kids.get(-1)!;
    obj(outRoot, `<< /Type /Outlines /First ${ref(top[0]!)} 0 R /Last ${ref(top[top.length - 1]!)} 0 R /Count ${count(-1)} >>`);
    outline.forEach((o, i) => {
      const sib = kids.get(parent[i]!)!, at = sib.indexOf(i), ch = kids.get(i) ?? [];
      const links = [at > 0 ? `/Prev ${ref(sib[at - 1]!)} 0 R` : '', at < sib.length - 1 ? `/Next ${ref(sib[at + 1]!)} 0 R` : '',
        ch.length ? `/First ${ref(ch[0]!)} 0 R /Last ${ref(ch[ch.length - 1]!)} 0 R /Count ${count(i)}` : ''].filter(Boolean).join(' ');
      obj(outIds[i]!, `<< /Title ${pdfText(o.title)} /Parent ${ref(parent[i]!)} 0 R ${links} /Dest ${dest(o)} >>`);
    });
  }
  const xref = len;
  push(`xref\n0 ${next}\n0000000000 65535 f \n`);
  for (let id = 1; id < next; id++) push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${next} /Root ${CATALOG} 0 R /Info ${INFO} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts as BlobPart[], { type: 'application/pdf' });
}
