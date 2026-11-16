// 추정 측정 (EstimateMeasurer, ENGINE 10.3): 화면이 없을 때(테스트 · 헤드리스) 블록 크기 · 제목 한 줄 폭을 글자 수로 어림한다.
// 화면에서는 DomMeasurer(실제 DOM으로 잼)를 넘긴다 — apply.ts ApplyOptions.measure · fit.
import { cellText, DEFAULT_BLOCK_W, sortedRows, type TextDoc, type TextNode } from '@dn/engine-core';
import type { MeasureFn } from './apply';

const LINE_H = 22, PAD = 24, TITLE_H = 28;
/** 제목만 있는 노드의 가장 좁은 폭 — 두세 글자 제목도 상자처럼 보이게 */
export const MIN_TITLE_W = 120;
/** 제목 한 줄 폭 추정 (fit이 없을 때) */
export const estimateFit = (doc: TextDoc): number => textWidth(textOf(doc.content[0] ?? { type: 'paragraph' })) + PAD + 8;

function textWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += /[ᄀ-ᇿ㄰-㆏가-힣぀-ヿ一-鿿]/.test(ch) ? 15 : 8;
  return w;
}
function wrappedLines(s: string, inner: number): number {
  return s.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(textWidth(l) / inner)), 0);
}

export const estimateMeasure: MeasureFn = ({ content, w }) => {
  if (content.type === 'chart') return { w: 360, h: 240 };
  if (content.type === 'divider') return { w, h: 24 };
  if (content.type === 'table') {
    const names = content.columns.map((c) => c.name);
    const rows = sortedRows(content).map((r) => content.columns.map((c) => cellText(r.cells[c.id])));
    const tw = Math.min(720, Math.max(DEFAULT_BLOCK_W, names.length * 140));
    const inner = tw / Math.max(1, names.length) - 16;
    const rowH = (r: readonly string[]) => Math.max(1, ...r.map((c) => wrappedLines(c, inner))) * LINE_H + 10;
    const h = PAD + (content.title ? TITLE_H : 0) + rowH(names) + rows.reduce((s, r) => s + rowH(r), 0);
    return { w: tw, h };
  }
  const inner = w - PAD;
  // 수식 블록은 분수 · 첨자로 글 두 줄쯤
  const lines = content.doc.content.map((n) => (n.type === 'math_block' ? '\n' : textOf(n)));
  const titleLines = wrappedLines(lines[0] ?? '', inner);
  const bodyLines = lines.slice(1).reduce((s, l) => s + wrappedLines(l, inner), 0);
  return { w, h: PAD + titleLines * TITLE_H + bodyLines * LINE_H };
};

function textOf(n: TextNode): string {
  if (n.text !== undefined) return n.text;
  const sep = n.type === 'bullet_list' || n.type === 'ordered_list' ? '\n' : '';
  return (n.content ?? []).map(textOf).join(sep);
}
