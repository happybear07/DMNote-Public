// 표 셀 편집 (FR-018 "표 셀 편집"): 셀을 더블클릭하면 그 칸에만 한 줄 에디터(제목 모드 — 글자 서식 · 링크 유지).
// Enter · Tab = 다음 칸(끝이면 행 추가), Esc = 끝. 바뀐 셀은 표 콘텐츠의 rows 필드 하나로 저장 → 실행 취소 한 번에 칸 하나.
// 편집 중에는 셀 위에 작은 도구(행 · 열 추가/삭제)가 뜬다.
import { cellDoc, deleteTableLine, mergeAt, mergeCells, sortedRows, splitCell, tableSortState, toTitleDoc, type Id } from '@dn/engine-core';
import { paintCellSel } from './table-sel';
import { headerCell } from './table-sort-ui';
import { addTableColumn, addTableRow, cellAnchor, cellOrder, saveCell, saveTable, tableOf } from './table-ops';
import { TextEditor } from '@dn/text-pm';
import type { CanvasView } from './canvas-view';

/** sel: Shift+클릭으로 고른 반대쪽 칸 (있으면 그 사각형을 합칠 수 있다) */
export interface CellEdit { blockId: Id; contentId: Id; rowId: Id; colId: Id; editor: TextEditor; tools: HTMLDivElement; sel?: { row: Id; col: Id } }

export function startCellEdit(view: CanvasView, blockId: Id, contentId: Id, rowId: Id, colId: Id): void {
  if (view.readOnly) return;
  const t = tableOf(view.engine, contentId);
  const row = t?.rows.find((r) => r.id === rowId);
  if (!t || !row || !t.columns.some((c) => c.id === colId)) return;
  if (view.editingId) view.endEditing();
  view.engine.breakUndoMerge();
  view.select([blockId]);
  const td = view.world.querySelector<HTMLElement>(`[data-part="${contentId}"] td[data-row="${rowId}"][data-col="${colId}"]`);
  if (!td) return;
  view.editingId = blockId;
  const tools = makeTools(view, contentId);
  const editor = new TextEditor({
    mount: td,
    mode: 'title',
    placeholder: '',
    doc: toTitleDoc(row.cells[colId] ?? cellDoc('')),
    overlay: view.root,
    at: 'end',
    onSteps: () => saveCell(view.engine, contentId, rowId, colId, editor.doc),
    onUndo: () => { view.engine.undo(); },
    onRedo: () => { view.engine.redo(); },
    onEscape: () => { view.endEditing(); view.root.focus({ preventScroll: true }); },
    onExitNext: () => moveCell(view),
    onExitPrev: () => moveCell(view, -1),
  });
  td.classList.add('dn-cell-editing');
  view.cellEdit = { blockId, contentId, rowId, colId, editor, tools };
  td.closest('.dn-table')?.prepend(tools);
  paintCellSel(td.closest('.dn-table'), t, { row: rowId, col: colId }, undefined, tools);
  view.schedule();
  view.notifyUi();
}

export function endCellEdit(view: CanvasView): void {
  const ce = view.cellEdit;
  if (!ce) return;
  view.cellEdit = null;
  ce.editor.destroy();
  ce.tools.remove();
  view.engine.breakUndoMerge();
  // 다음 그리기에서 표 전체를 다시 그린다 (편집하던 칸도 정적 렌더로)
  const m = view.mounted.get(ce.blockId);
  const p = m?.parts.find((x) => x.contentId === ce.contentId);
  if (p) p.rendered = null;
}

/** 편집 중 같은 표의 다른 칸을 Shift+클릭 — 지금 칸과 그 칸 사이 사각형을 고른다 (칸 합치기) */
export function extendCellSel(view: CanvasView, rowId: Id, colId: Id): void {
  const ce = view.cellEdit, t = ce && tableOf(view.engine, ce.contentId);
  if (!ce || !t) return;
  ce.sel = rowId === ce.rowId && colId === ce.colId ? undefined : { row: rowId, col: colId };
  paintCellSel(ce.tools.closest('.dn-table'), t, { row: ce.rowId, col: ce.colId }, ce.sel, ce.tools);
  ce.editor.focus();
}

/** 다음 칸(마지막 칸이면 행을 하나 더) · 앞 칸 (Shift+Tab) */
function moveCell(view: CanvasView, dir: 1 | -1 = 1): void {
  const ce = view.cellEdit;
  const t = ce && tableOf(view.engine, ce.contentId);
  if (!ce || !t) return;
  const cells = cellOrder(t);
  let next = cells[cells.findIndex(([r, c]) => r === ce.rowId && c === ce.colId) + dir];
  const { blockId, contentId } = ce;
  if (!next && dir > 0) {
    const row = addTableRow(view.engine, contentId); // 맨 끝에
    if (row) next = [row, t.columns[0]!.id];
  }
  view.endEditing();
  if (next) startCellEdit(view, blockId, contentId, next[0], next[1]);
}

// ───────── 열 이름 ─────────

interface HeaderEdit { contentId: Id; colId: Id; input: HTMLInputElement; finish: (keep: boolean) => void }
/** 뷰마다 지금 고치는 열 이름 하나 (표가 통째로 다시 그려지면 mount가 입력 칸을 새 머리글에 다시 넣는다) */
const headerEdits = new WeakMap<CanvasView, HeaderEdit>();

/** 표를 다시 그린 뒤: 고치던 열 이름 입력 칸을 새 머리글에 다시 넣는다 (열이 사라졌으면 그만둔다) */
export function restoreHeaderEdit(view: CanvasView, contentId: Id, el: HTMLElement): void {
  const he = headerEdits.get(view);
  if (!he || he.contentId !== contentId || el.contains(he.input)) return;
  const th = el.querySelector<HTMLElement>(`th[data-col="${he.colId}"]`);
  if (!th) { he.finish(false); return; }
  const { selectionStart, selectionEnd } = he.input;
  th.replaceChildren(he.input);
  he.input.focus({ preventScroll: true });
  he.input.setSelectionRange(selectionStart, selectionEnd);
}

/** 다른 편집 · 보기 전용으로 바뀔 때: 고치던 열 이름을 저장하고 끝낸다 */
export function endHeaderEdit(view: CanvasView): void {
  headerEdits.get(view)?.finish(true);
}

/**
 * 열 이름 고치기 (머리글 두 번 누르기 · 새 표): 그 머리글 칸에 입력 상자. 바꾼 이름은 끝낼 때 한 번 저장(실행 취소 한 번).
 * Enter = 저장하고 그 열 첫 칸으로 · Tab / Shift+Tab = 다음 · 이전 열 이름(끝이면 첫 칸) · Esc = 그대로 두고 끝 · 다른 곳 누르기 = 저장.
 */
export function startHeaderEdit(view: CanvasView, blockId: Id, contentId: Id, colId: Id): void {
  if (view.readOnly) return;
  const t = tableOf(view.engine, contentId);
  const col = t?.columns.find((c) => c.id === colId);
  const th = view.world.querySelector<HTMLElement>(`[data-part="${contentId}"] th[data-col="${colId}"]`);
  if (!t || !col || !th) return;
  if (view.editingId) view.endEditing();
  endHeaderEdit(view);
  view.select([blockId]);
  const input = document.createElement('input');
  input.className = 'dn-th-input';
  input.value = col.name;
  input.setAttribute('aria-label', '열 이름');
  th.replaceChildren(input);
  input.focus({ preventScroll: true });
  input.select();
  let done = false;
  const firstCell = (cid: Id) => {
    const cur = tableOf(view.engine, contentId);
    const row = cur && sortedRows(cur)[0];
    if (row) startCellEdit(view, blockId, contentId, row.id, cid);
  };
  const finish = (keep: boolean, next?: () => void) => {
    if (done) return;
    done = true;
    if (headerEdits.get(view)?.input === input) headerEdits.delete(view);
    const name = input.value.trim();
    const cur = tableOf(view.engine, contentId);
    if (keep && cur && name && name !== col.name) {
      saveTable(view.engine, contentId, { columns: cur.columns.map((c) => (c.id === colId ? { ...c, name } : c)) }, '표 열 이름');
    }
    // 입력 칸이 지금 있는 머리글(표가 다시 그려졌으면 새 머리글)에 이름을 돌려놓는다 — 저장했으면 다음 그리기도 새 이름
    const cell = input.parentElement ?? th;
    headerCell(cell, keep && name ? name : col.name, cur ? tableSortState(cur, colId) : null);
    // 저장하면 다음 그리기에서 표가 다시 그려진다 — 그 뒤에 다음 칸을 연다
    if (next) requestAnimationFrame(() => requestAnimationFrame(next));
    else view.root.focus({ preventScroll: true });
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.isComposing) return;
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    else if (e.key === 'Enter') { e.preventDefault(); finish(true, () => firstCell(colId)); }
    else if (e.key === 'Tab') {
      e.preventDefault();
      const cols = tableOf(view.engine, contentId)?.columns ?? [];
      const nx = cols[cols.findIndex((c) => c.id === colId) + (e.shiftKey ? -1 : 1)];
      finish(true, () => (nx ? startHeaderEdit(view, blockId, contentId, nx.id) : firstCell(cols[0]!.id)));
    }
  });
  input.addEventListener('pointerdown', (e) => e.stopPropagation());
  // 다른 곳을 누르면 저장. 표가 다시 그려지며 잠깐 떨어진 경우(mount가 다시 넣고 포커스)는 저장하지 않는다 —
  // 그리기 도중에 트랜잭션을 돌리면 그 변경의 다시 그리기 표시가 그리기 끝에서 지워진다
  input.addEventListener('blur', () => queueMicrotask(() => { if (document.activeElement !== input) finish(true); }));
  headerEdits.set(view, { contentId, colId, input, finish: (keep) => finish(keep) });
}

/** 편집 중 셀 위 도구 줄 */
function makeTools(view: CanvasView, contentId: Id): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'dn-table-tools';
  el.contentEditable = 'false';
  const btn = (label: string, run: (ce: CellEdit) => void) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); });
    b.addEventListener('click', (e) => {
      e.preventDefault();
      const ce = view.cellEdit;
      if (ce && ce.contentId === contentId) run(ce);
    });
    el.appendChild(b);
  };
  const reopen = (ce: CellEdit, rowId: Id | null, colId: Id | null) => {
    const { blockId } = ce;
    view.endEditing();
    const t = tableOf(view.engine, contentId);
    const r = rowId ?? sortedRows(t!)[0]?.id, c = colId ?? t?.columns[0]?.id;
    if (t && r && c) startCellEdit(view, blockId, contentId, r, c);
  };
  // 새 행 · 열은 합친 칸 안이면 그 끝 다음에 (cellAnchor), 지우기는 합친 칸을 맞춘다 (engine-core deleteTableLine)
  const anchor = (ce: CellEdit) => cellAnchor(view.engine, contentId, ce.rowId, ce.colId);
  btn('＋ 행', (ce) => reopen(ce, addTableRow(view.engine, contentId, anchor(ce).row), ce.colId));
  btn('＋ 열', (ce) => reopen(ce, ce.rowId, addTableColumn(view.engine, contentId, anchor(ce).col)));
  btn('행 삭제', (ce) => { deleteTableLine(view.engine, contentId, 'row', ce.rowId); reopen(ce, null, ce.colId); });
  btn('열 삭제', (ce) => { deleteTableLine(view.engine, contentId, 'col', ce.colId); reopen(ce, ce.rowId, null); });
  // 칸 합치기 (Shift+클릭으로 고른 사각형) · 나누기 (합친 칸에서)
  // 표가 통째로 다시 그려지므로(칸을 떼었다 붙이면 포커스가 빠져 편집이 끝난다) 다시 그린 뒤에 그 칸을 연다
  const later = (ce: CellEdit, row: Id, col: Id) => { const { blockId } = ce; view.endEditing(); requestAnimationFrame(() => requestAnimationFrame(() => startCellEdit(view, blockId, contentId, row, col))); };
  btn('칸 합치기', (ce) => { if (!ce.sel) return; const r = mergeCells(view.engine, contentId, { row: ce.rowId, col: ce.colId }, ce.sel); later(ce, r.ok ? r.value.row : ce.rowId, r.ok ? r.value.col : ce.colId); });
  btn('칸 나누기', (ce) => { const t = tableOf(view.engine, contentId); if (!t || !mergeAt(t, { row: ce.rowId, col: ce.colId })) return; splitCell(view.engine, contentId, { row: ce.rowId, col: ce.colId }); later(ce, ce.rowId, ce.colId); });
  return el;
}
