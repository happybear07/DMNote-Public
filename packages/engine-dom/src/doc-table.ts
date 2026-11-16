// 문서 뷰에서 표 고치기 (DOC-QA DQ-005): 칸을 누르면 그 칸에 한 줄 에디터(글자 서식 · 링크 유지), Enter · Tab = 다음 칸(끝이면 행 추가),
// Shift+Tab = 앞 칸, Esc = 끝. 머리글을 누르면 열 이름. 고치는 동안 표 위에 행 · 열 추가 · 지우기. 저장은 캔버스와 같은 표 콘텐츠(rows · columns) —
// 칸 하나 고치기 = 실행 취소 한 번(mergeKey).
import { cellDoc, deleteTableLine, mergeAt, mergeCells, sortedRows, splitCell, tableSortState, toTitleDoc, type Engine, type Id } from '@dn/engine-core';
import { paintCellSel } from './table-sel';
import { headerCell } from './table-sort-ui';
import { addTableColumn, addTableRow, cellAnchor, cellOrder, saveCell, saveTable, tableOf } from './table-ops';
import { TextEditor } from '@dn/text-pm';
import { renderTable } from './rich-render';

export interface DocCell { blockId: Id; contentId: Id; rowId: Id; colId: Id; editor: TextEditor | null; part: HTMLElement; tools: HTMLElement; sel?: { row: Id; col: Id } }

export class DocTable {
  cell: DocCell | null = null;
  constructor(private readonly engine: Engine, private readonly overlay: HTMLElement) {}

  /** 표의 칸 · 머리글을 눌렀을 때. 처리했으면 true */
  down(target: Element): boolean {
    const part = target.closest<HTMLElement>('[data-part]');
    const blockId = target.closest<HTMLElement>('.dn-doc-item')?.dataset.id;
    if (!part || !blockId || !tableOf(this.engine, part.dataset.part!)) return false;
    const td = target.closest<HTMLElement>('td[data-row]'), th = target.closest<HTMLElement>('th[data-col]');
    if (td) { this.open(blockId, part, td.dataset.row!, td.dataset.col!); return true; }
    if (th) { this.rename(part, th.dataset.col!); return true; }
    return false;
  }

  open(blockId: Id, part: HTMLElement, rowId: Id, colId: Id): void {
    const contentId = part.dataset.part!;
    const t = tableOf(this.engine, contentId);
    const row = t?.rows.find((r) => r.id === rowId);
    if (!t || !row) return;
    this.close();
    const td = part.querySelector<HTMLElement>(`td[data-row="${rowId}"][data-col="${colId}"]`);
    if (!td) return;
    this.engine.breakUndoMerge();
    const tools = this.tools(contentId, rowId, colId);
    part.prepend(tools);
    const editor = new TextEditor({
      mount: td, mode: 'title', placeholder: '', doc: toTitleDoc(row.cells[colId] ?? cellDoc('')), overlay: this.overlay, at: 'end',
      onSteps: () => saveCell(this.engine, contentId, rowId, colId, editor.doc),
      onUndo: () => { this.engine.undo(); }, onRedo: () => { this.engine.redo(); },
      onEscape: () => this.close(),
      onExitNext: () => this.move(1),
      onExitPrev: () => this.move(-1),
    });
    td.classList.add('dn-cell-editing');
    this.cell = { blockId, contentId, rowId, colId, editor, part, tools };
    paintCellSel(part, t, { row: rowId, col: colId }, undefined, tools);
  }

  /** 고치는 중 같은 표의 다른 칸을 Shift+클릭 — 그 사이 사각형을 고른다 (칸 합치기). 처리했으면 true */
  extend(target: Element): boolean {
    const c = this.cell, td = target.closest<HTMLElement>('td[data-row]');
    const t = c && tableOf(this.engine, c.contentId);
    if (!c || !t || !td || td.closest('[data-part]') !== c.part) return false;
    c.sel = td.dataset.row === c.rowId && td.dataset.col === c.colId ? undefined : { row: td.dataset.row!, col: td.dataset.col! };
    paintCellSel(c.part, t, { row: c.rowId, col: c.colId }, c.sel, c.tools);
    c.editor?.focus();
    return true;
  }

  /** 다음 · 앞 칸 (마지막 칸 다음이면 행 추가) */
  private move(dir: 1 | -1): void {
    const c = this.cell, t = c && tableOf(this.engine, c.contentId);
    if (!c || !t) return;
    const cells = cellOrder(t);
    let next = cells[cells.findIndex(([r, col]) => r === c.rowId && col === c.colId) + dir];
    if (!next && dir > 0) { const id = addTableRow(this.engine, c.contentId); if (id) next = [id, t.columns[0]!.id]; } // 맨 끝에
    const { blockId, part } = c;
    this.close();
    if (next) this.open(blockId, this.redraw(part), next[0], next[1]);
  }

  /** 표를 지금 데이터로 다시 그려 칸을 맞춘다 (행 · 열이 바뀐 뒤) */
  private redraw(part: HTMLElement): HTMLElement {
    const t = tableOf(this.engine, part.dataset.part!);
    if (t) renderTable(t, part);
    return part;
  }

  close(): void {
    const c = this.cell;
    if (!c) return;
    this.cell = null;
    c.editor?.destroy();
    c.tools.remove();
    this.engine.breakUndoMerge();
    this.redraw(c.part);
  }

  /** 열 이름: 머리글 자리에 입력 칸 — Enter · 다른 곳 누르기 = 저장, Esc = 그만 */
  private rename(part: HTMLElement, colId: Id): void {
    this.close();
    const contentId = part.dataset.part!;
    const t = tableOf(this.engine, contentId), col = t?.columns.find((x) => x.id === colId);
    const th = part.querySelector<HTMLElement>(`th[data-col="${colId}"]`);
    if (!t || !col || !th) return;
    const input = Object.assign(document.createElement('input'), { className: 'dn-th-input', value: col.name });
    input.setAttribute('aria-label', '열 이름');
    th.replaceChildren(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (keep: boolean) => {
      if (done) return;
      done = true;
      const name = input.value.trim(), cur = tableOf(this.engine, contentId);
      if (keep && cur && name && name !== col.name) saveTable(this.engine, contentId, { columns: cur.columns.map((x) => (x.id === colId ? { ...x, name } : x)) }, '표 열 이름');
      else headerCell(th, col.name, cur ? tableSortState(cur, colId) : null);
    };
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.isComposing) return; if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.preventDefault(); finish(false); } });
    input.addEventListener('mousedown', (e) => e.stopPropagation());
    input.addEventListener('blur', () => finish(true));
  }

  /** 고치는 동안 표 위의 작은 도구: 행 · 열 추가 · 지우기 */
  private tools(contentId: Id, rowId: Id, colId: Id): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'dn-table-tools dn-ui';
    const btn = (label: string, run: () => void) => {
      const b = Object.assign(document.createElement('button'), { type: 'button', textContent: label });
      b.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
      b.addEventListener('click', () => { const c = this.cell; run(); if (c) { this.close(); const t = tableOf(this.engine, contentId); const r = t && (t.rows.find((x) => x.id === rowId) ?? sortedRows(t)[0]); const col = t && (t.columns.find((x) => x.id === colId) ?? t.columns[0]); if (r && col) this.open(c.blockId, this.redraw(c.part), r.id, col.id); } });
      bar.append(b);
    };
    // 합친 칸 안이면 그 끝 다음에 (DQ-021)
    const anchor = () => cellAnchor(this.engine, contentId, rowId, colId);
    btn('+ 아래에 행', () => { addTableRow(this.engine, contentId, anchor().row); });
    btn('+ 오른쪽에 열', () => { addTableColumn(this.engine, contentId, anchor().col); });
    // 행 · 열 지우기 — 합친 칸을 맞춘다 (DQ-022)
    btn('행 지우기', () => { deleteTableLine(this.engine, contentId, 'row', rowId); });
    // 칸 합치기 (Shift+클릭으로 고른 사각형) · 나누기 (합친 칸에서) — 끝나면 왼쪽 위 칸을 다시 연다
    btn('칸 합치기', () => { const c = this.cell; if (c?.sel) { const r = mergeCells(this.engine, contentId, { row: rowId, col: colId }, c.sel); if (r.ok) { rowId = r.value.row; colId = r.value.col; } } });
    btn('칸 나누기', () => { const t = tableOf(this.engine, contentId); if (t && mergeAt(t, { row: rowId, col: colId })) splitCell(this.engine, contentId, { row: rowId, col: colId }); });
    btn('열 지우기', () => { deleteTableLine(this.engine, contentId, 'col', colId); });
    return bar;
  }
}
