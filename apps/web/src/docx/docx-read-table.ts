// 워드 표(w:tbl) 읽기: 열 너비(tblGrid) · 머리 행(쪽마다 되풀이하거나 첫 줄이 모두 굵게) · 합친 칸(gridSpan · vMerge) → 칸 글 문서.
// 칸 안의 표(겹친 표)는 글만 남긴다. 아래 XML 도우미(이름 · 속성은 앞붙이 무시)는 docx-read.ts도 쓴다.
import type { TextNode } from '@dn/engine-core';

export interface DocxTable {
  columns: { name: string; width?: number }[];
  /** 데이터 행 × 열 — 칸마다 글 문서 */
  rows: TextNode[][];
  /** 합친 칸 (행 · 열 번호, 데이터 행 기준) */
  merges: { r0: number; c0: number; r1: number; c1: number }[];
  noHeader: boolean;
}

export const kids = (el: Element | null | undefined, name: string): Element[] => (el ? [...el.children].filter((c) => c.localName === name) : []);
export const kid = (el: Element | null | undefined, name: string): Element | null => (el ? [...el.children].find((c) => c.localName === name) ?? null : null);
export const at = (el: Element | null | undefined, name: string): string | null => { if (!el) return null; for (const a of el.attributes) if (a.localName === name) return a.value; return null; };
const textOf = (n: TextNode): string => (n.text ?? '') + (n.content ?? []).map(textOf).join(n.type === 'doc' ? '\n' : '');
const allBold = (n: TextNode): boolean => {
  const texts: TextNode[] = [];
  const walk = (x: TextNode) => { if (x.type === 'text' && x.text?.trim()) texts.push(x); (x.content ?? []).forEach(walk); };
  walk(n);
  return texts.length > 0 && texts.every((t) => t.marks?.some((m) => m.type === 'strong'));
};
const EMPTY = (): TextNode => ({ type: 'doc', content: [{ type: 'paragraph' }] } as TextNode);

interface Cell { doc: TextNode; text: string; bold: boolean; span: number; vm: 'restart' | 'cont' | null; c: number }

export function readTable(tbl: Element, para: (p: Element) => TextNode | null): DocxTable {
  const grid = kids(kid(tbl, 'tblGrid'), 'gridCol').map((g) => Number(at(g, 'w')) || 0);
  const trs = kids(tbl, 'tr');
  const rows: Cell[][] = trs.map((tr) => {
    let c = Number(at(kid(kid(tr, 'trPr'), 'gridBefore'), 'val') ?? 0);
    return kids(tr, 'tc').map((tc) => {
      const pr = kid(tc, 'tcPr'), span = Math.max(1, Number(at(kid(pr, 'gridSpan'), 'val') ?? 1) || 1), v = kid(pr, 'vMerge');
      // 칸 안 문단 (겹친 표 · 콘텐츠 칸 안 문단도 글로)
      const ps = [...tc.getElementsByTagNameNS('*', 'p')].filter((p) => p.closest('tc') === tc || !p.parentElement?.closest('tbl')?.isSameNode(tbl));
      const content = ps.map(para).filter((x): x is TextNode => !!x);
      const doc = content.length ? ({ type: 'doc', content } as TextNode) : EMPTY();
      const cell: Cell = { doc, text: textOf(doc).trim(), bold: allBold(doc), span, vm: v ? (at(v, 'val') === 'restart' ? 'restart' : 'cont') : null, c };
      c += span;
      return cell;
    });
  });
  const ncols = Math.max(grid.length, ...rows.map((r) => (r.length ? r.at(-1)!.c + r.at(-1)!.span : 0)), 1);
  const first = rows[0] ?? [];
  const header = rows.length > 1 && (!!kid(kid(trs[0], 'trPr'), 'tblHeader') || (first.length > 0 && first.every((c) => !c.text || c.bold) && first.some((c) => c.text)));
  const names = Array.from({ length: ncols }, (_, k) => {
    const h = header ? first.find((c) => c.c === k) : undefined;
    return h?.text.replace(/\s+/g, ' ') || `열 ${k + 1}`;
  });
  const data = header ? rows.slice(1) : rows;
  const out: TextNode[][] = data.map((r) => {
    const docs = Array.from({ length: ncols }, EMPTY);
    for (const cell of r) if (cell.vm !== 'cont' && cell.c < ncols) docs[cell.c] = cell.doc;
    return docs;
  });
  const merges: DocxTable['merges'] = [];
  data.forEach((r, ri) => {
    for (const cell of r) {
      if (cell.vm === 'cont') continue;
      let r1 = ri;
      if (cell.vm === 'restart') while (data[r1 + 1]?.some((x) => x.c === cell.c && x.vm === 'cont')) r1++;
      const c1 = Math.min(ncols - 1, cell.c + cell.span - 1);
      if (r1 > ri || c1 > cell.c) merges.push({ r0: ri, c0: cell.c, r1, c1 });
    }
  });
  return {
    columns: names.map((name, k) => ({ name, ...(grid[k] ? { width: Math.round(grid[k]! / 15) } : {}) })),
    rows: out, merges, noHeader: !header,
  };
}
