// 표 → 워드 표(w:tbl): 열 너비 · 머리 행(쪽마다 되풀이) · 머리 열 · 합친 칸(가로 gridSpan · 세로 vMerge).
// 데이터베이스 · 그래프 데이터는 글자 칸만의 표(gridXml)로.
import { mergeSpans, sortedRows, type TableContent } from '@dn/engine-core';
import { esc, px2tw } from './ooxml';
import { textToOoxml, type DocxCtx, type Look } from './docx-text';

const HEAD_FILL = 'F7F7F5';

/** 열 너비(twip): 정한 너비 비율대로, 합이 쓸 수 있는 너비(maxTw)를 넘지 않게 */
function widths(px: readonly (number | undefined)[], totalPx: number, maxTw: number): number[] {
  const known = px.filter((w): w is number => !!w), rest = px.length - known.length;
  const fill = rest ? Math.max(60, (totalPx - known.reduce((a, b) => a + b, 0)) / rest) : 0;
  const raw = px.map((w) => w || fill);
  const k = Math.min(1, maxTw / px2tw(raw.reduce((a, b) => a + b, 0) || 1));
  return raw.map((w) => Math.max(300, Math.round(px2tw(w) * k)));
}

const cell = (w: number, body: string, o: { span?: number; vMerge?: 'restart' | 'cont'; fill?: string } = {}) =>
  `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${o.span && o.span > 1 ? `<w:gridSpan w:val="${o.span}"/>` : ''}${o.vMerge ? `<w:vMerge${o.vMerge === 'restart' ? ' w:val="restart"' : ''}/>` : ''}${o.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${o.fill}"/>` : ''}</w:tcPr>${body || '<w:p/>'}</w:tc>`;

const table = (grid: readonly number[], rows: readonly string[]) =>
  `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="${grid.reduce((a, b) => a + b, 0)}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>`
  + `<w:tblGrid>${grid.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${rows.join('')}</w:tbl>`;

const textPara = (s: string, bold = false) => `<w:p><w:pPr><w:spacing w:after="0"/></w:pPr>${s ? `<w:r>${bold ? '<w:rPr><w:b/><w:bCs/></w:rPr>' : ''}<w:t xml:space="preserve">${esc(s)}</w:t></w:r>` : ''}</w:p>`;

/** 표 콘텐츠 → 워드 표. widthPx: 블록 너비, maxTw: 쪽에서 쓸 수 있는 너비 */
export function tableXml(t: TableContent, widthPx: number, maxTw: number, ctx: DocxCtx, look: Look): string {
  const cols = t.columns, rows = sortedRows(t);
  const grid = widths(cols.map((c) => c.width), widthPx, maxTw);
  const { spans, covered } = mergeSpans(t);
  // 세로로 합친 칸의 아래 칸들: 그 자리에 vMerge 이어 붙이기 (가로 넓이는 같게)
  const rowIdx = new Map(rows.map((r, i) => [r.id, i]));
  const cont = new Map<string, number>();
  for (const [key, s] of spans) {
    const [r, c] = key.split(':') as [string, string];
    for (let k = 1; k < s.rows; k++) { const below = rows[(rowIdx.get(r) ?? 0) + k]; if (below) cont.set(`${below.id}:${c}`, s.cols); }
  }
  const sumW = (i: number, n: number) => grid.slice(i, i + n).reduce((a, b) => a + b, 0);
  const cellLook: Look = { p: {}, r: look.r, scale: look.scale };
  const out: string[] = [];
  if (!t.noHeader) out.push(`<w:tr><w:trPr><w:tblHeader/></w:trPr>${cols.map((c, i) => cell(grid[i]!, textPara(c.name, true), { fill: HEAD_FILL })).join('')}</w:tr>`);
  for (const r of rows) {
    const tcs: string[] = [];
    cols.forEach((c, i) => {
      const key = `${r.id}:${c.id}`, span = spans.get(key), head = !!t.headerCol && i === 0;
      if (cont.has(key)) { const n = cont.get(key)!; tcs.push(cell(sumW(i, n), '', { span: n, vMerge: 'cont', ...(head ? { fill: HEAD_FILL } : {}) })); return; }
      if (covered.has(key)) return;
      const doc = r.cells[c.id];
      const body = doc ? textToOoxml(doc, ctx, head ? { ...cellLook, r: { ...cellLook.r, b: true } } : cellLook).join('') : '';
      tcs.push(cell(sumW(i, span?.cols ?? 1), body, { span: span?.cols, ...(span && span.rows > 1 ? { vMerge: 'restart' as const } : {}), ...(head ? { fill: HEAD_FILL } : {}) }));
    });
    out.push(`<w:tr>${tcs.join('')}</w:tr>`);
  }
  return table(grid, out);
}

/** 글자만 든 표 (데이터베이스 · 그래프 데이터): 첫 줄은 머리 */
export function gridXml(head: readonly string[], rows: readonly (readonly string[])[], widthPx: number, maxTw: number): string {
  const grid = widths(head.map(() => undefined), widthPx, maxTw);
  return table(grid, [
    `<w:tr><w:trPr><w:tblHeader/></w:trPr>${head.map((h, i) => cell(grid[i]!, textPara(h, true), { fill: HEAD_FILL })).join('')}</w:tr>`,
    ...rows.map((r) => `<w:tr>${head.map((_, i) => cell(grid[i]!, textPara(r[i] ?? ''))).join('')}</w:tr>`),
  ]);
}
