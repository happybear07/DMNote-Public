// 표 칸 고치기 공용 (캔버스 table-edit.ts · 문서 뷰 doc-table.ts): 표 찾기 · 저장 · 행 · 열 추가 · 칸 차례
import { cellDoc, insertAnchor, isTableContent, keyBetween, mergeSpans, newId, sortedRows, type CellRef, type Engine, type Id, type TableContent, type TableRow, type TextDoc } from '@dn/engine-core';

export function tableOf(e: Engine, id: Id): TableContent | null { const c = e.getContent(id); return isTableContent(c) ? c : null; }

export function saveTable(e: Engine, id: Id, patch: Partial<Pick<TableContent, 'rows' | 'columns'>>, label: string, mergeKey?: string): void {
  e.transact((tx) => tx.set('content', id, patch), { origin: 'user', label, ...(mergeKey ? { mergeKey } : {}) });
}

/** 칸 하나의 글 — 칸 하나 고치기 = 실행 취소 한 번 (mergeKey) */
export function saveCell(e: Engine, id: Id, rowId: Id, colId: Id, doc: TextDoc): void {
  const t = tableOf(e, id);
  if (t) saveTable(e, id, { rows: t.rows.map((r) => (r.id === rowId ? { ...r, cells: { ...r.cells, [colId]: doc } } : r)) }, '표 칸 편집', `cell:${id}:${rowId}:${colId}`);
}

/** `after` 행 다음에 빈 행 (없으면 맨 끝). 새 행 id */
export function addTableRow(e: Engine, id: Id, after?: Id): Id | null {
  const t = tableOf(e, id);
  if (!t) return null;
  const rows = sortedRows(t);
  const i = after ? rows.findIndex((r) => r.id === after) : rows.length - 1;
  const row: TableRow = { id: newId(), order: keyBetween(rows[i]?.order ?? null, rows[i + 1]?.order ?? null), cells: Object.fromEntries(t.columns.map((c) => [c.id, cellDoc('')])) };
  saveTable(e, id, { rows: [...t.rows, row] }, '표 행 추가');
  return row.id;
}

/** `after` 열 오른쪽에 새 열 (없으면 맨 끝). 새 열 id */
export function addTableColumn(e: Engine, id: Id, after?: Id): Id | null {
  const t = tableOf(e, id);
  if (!t) return null;
  const col = { id: newId(), name: (t.columns.some((c) => c.name === '새 열') ? `새 열 ${t.columns.filter((c) => c.name.startsWith('새 열')).length + 1}` : '새 열') }; // 번호를 붙이면 끼운 자리와 어긋난다 (CQ-017)
  const i = after ? t.columns.findIndex((c) => c.id === after) + 1 : t.columns.length;
  const rows = t.rows.map((r) => ({ ...r, cells: { ...r.cells, [col.id]: cellDoc('') } }));
  saveTable(e, id, { columns: [...t.columns.slice(0, i), col, ...t.columns.slice(i)], rows }, '표 열 추가');
  return col.id;
}

/** 새 행 · 열 기준: 합친 칸 안이면 그 끝 다음 (DQ-021) */
export function cellAnchor(e: Engine, id: Id, row: Id, col: Id): CellRef {
  const t = tableOf(e, id);
  return t ? insertAnchor(t, { row, col }) : { row, col };
}

/** Tab · Enter로 도는 칸 차례 [행, 열] — 합쳐서 가려진 칸은 뺀다 */
export function cellOrder(t: TableContent): (readonly [Id, Id])[] {
  const { covered } = mergeSpans(t);
  return sortedRows(t).flatMap((r) => t.columns.map((c) => [r.id, c.id] as const)).filter(([r, c]) => !covered.has(`${r}:${c}`));
}
