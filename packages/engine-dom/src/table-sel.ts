// 표 칸 고르기 표시 (칸 합치기 · 나누기): 편집 중인 칸 ~ Shift+클릭한 칸 사각형에 dn-cell-sel, 도구 줄의 '칸 합치기' · '칸 나누기' 켜고 끄기.
// 캔버스(table-edit.ts)와 문서 뷰(doc-table.ts)가 같이 쓴다.
import { mergeAt, mergeRect, sortedRows, type CellRef, type TableData } from '@dn/engine-core';

export function paintCellSel(root: Element | null, t: TableData, anchor: CellRef, sel: CellRef | undefined, tools: HTMLElement): void {
  if (!root) return;
  for (const td of root.querySelectorAll('td.dn-cell-sel')) td.classList.remove('dn-cell-sel');
  const r = sel ? mergeRect(t, anchor, sel) : null;
  if (r) {
    const rows = sortedRows(t).map((x) => x.id), cols = t.columns.map((c) => c.id);
    const [r0, r1, c0, c1] = [rows.indexOf(r.r0), rows.indexOf(r.r1), cols.indexOf(r.c0), cols.indexOf(r.c1)];
    for (const td of root.querySelectorAll<HTMLElement>('td[data-row]')) {
      const i = rows.indexOf(td.dataset.row!), j = cols.indexOf(td.dataset.col!);
      if (i >= r0 && i <= r1 && j >= c0 && j <= c1) td.classList.add('dn-cell-sel');
    }
  }
  for (const b of tools.querySelectorAll('button')) {
    if (b.textContent === '칸 합치기') b.disabled = !r;
    if (b.textContent === '칸 나누기') b.disabled = !mergeAt(t, anchor);
  }
}
