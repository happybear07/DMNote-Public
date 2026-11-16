// 데이터베이스 테이블 뷰 (FR-057): 행 = 항목, 열 = 속성. 칸을 그 자리에서 고친다(글 · 숫자 · URL은 입력 칸, 날짜 · 체크는 기본 입력,
// 선택 · 다중 선택은 옵션 메뉴). 열 머리를 누르면 속성 메뉴, 오른쪽 끝을 끌면 열 너비, 행 손잡이를 끌면 순서, 누르면 항목 메뉴.
// 데이터가 바뀌면 통째로 다시 그리되, 입력 중이던 칸의 포커스 · 커서는 같은 자리(data-key)로 되돌린다.
// 캔버스 · 문서 뷰가 함께 쓴다 — CanvasView를 모르고 엔진만 받는다.
import {
  activeDbView, addDbRow, filterDefaults, setDbPropertyWidth, setDbTitle, setDbValue, moveDbRow, viewRows,
  type DatabaseContent, type DbProperty, type DbRow, type DbValue, type DbView, type Engine, type Id,
} from '@dn/engine-core';
import { renderCalendar } from './db-calendar';
import { renderCards } from './db-cards';
import { renderViewBar } from './db-viewbar';
import { chipEl, dbHost, dragWindow, mk as h, openDbMenu, openOptionPicker, openPageButton, openPropMenu, openAddProp, openHiddenProps, openRowMenu, TYPE_ICON } from './db-menus';
import { relationCell, rollupCell } from './db-relation-ui';
import { computedCell, filesCell } from './db-props-ui';
import { renderDbChart, renderTimeline } from './db-timeline';
import { calcFoot } from './db-calc-ui';

export interface DbCtx { engine: Engine; readOnly: boolean; onExit?: () => void }
/** 새 항목 만들기 (값 미리 채우기 · 어느 항목 뒤) — 보드 · 캘린더가 받는다 */
export type NewRow = (extra?: Record<Id, DbValue>, after?: Id | null) => void;

/** 화면 배율 (캔버스 확대 · 축소) — 끌기 거리를 데이터 px로 바꿀 때 */
const zoomOf = (el: HTMLElement) => el.getBoundingClientRect().width / Math.max(1, el.offsetWidth);

export function renderDatabase(el: HTMLElement, c: DatabaseContent, ctx: DbCtx): void {
  // 포커스 · 커서 기억
  const active = document.activeElement as HTMLInputElement | null;
  const focusKey = active && el.contains(active) ? active.dataset.key : undefined;
  const caret = focusKey && typeof active!.selectionStart === 'number' ? [active!.selectionStart, active!.selectionEnd] : null;
  // 아직 저장 안 된 입력 (Enter 직후 다음 칸에 바로 친 글자 등) — 다시 그린 칸에 옮겨 담는다
  const typed = focusKey && active!.tagName === 'INPUT' && active!.type !== 'checkbox' && active!.value !== active!.dataset.orig ? active!.value : null;

  const view = activeDbView(c);
  el.className = `dn-db dn-dbv-${view.kind}${ctx.readOnly ? ' dn-db-ro' : ''}`;

  // 머리: 이름 · 숨긴 속성(표)
  const head = h('div', 'dn-db-head');
  const title = h('input', 'dn-db-title dn-db-ui');
  title.value = c.title ?? '';
  title.dataset.orig = title.value;
  title.placeholder = '제목 없는 데이터베이스';
  title.dataset.key = 'title';
  title.disabled = ctx.readOnly;
  title.addEventListener('change', () => setDbTitle(ctx.engine, c.id, title.value));
  bindKeys(title, ctx);
  head.append(title);
  const more = h('button', 'dn-db-btn dn-db-ui', '⋯');
  more.title = ctx.readOnly || !dbHost() ? '데이터베이스 메뉴 (CSV로 내보내기)' : '데이터베이스 메뉴 (CSV로 내보내기 · 항목 템플릿)';
  more.setAttribute('aria-label', '데이터베이스 메뉴');
  more.addEventListener('click', () => openDbMenu(more, ctx.engine, c.id, ctx.readOnly));
  head.append(more);
  const hidden = c.properties.filter((p) => p.hidden).length;
  if (hidden && !ctx.readOnly && view.kind === 'table') {
    const b = h('button', 'dn-db-btn dn-db-ui', `숨긴 속성 ${hidden}`);
    b.addEventListener('click', () => openHiddenProps(b, ctx.engine, c.id));
    head.append(b);
  }

  const rows = viewRows(c, view);
  const newRow: NewRow = (extra = {}, after) => {
    const r = addDbRow(ctx.engine, c.id, after, { ...filterDefaults(c, view), ...extra });
    if (r.ok && r.value) focusLater(el, `${r.value}:${c.properties[0]?.id}`);
  };
  const body = view.kind === 'table' ? renderTable(c, view, rows, ctx)
    : view.kind === 'calendar' ? renderCalendar(c, view, rows, ctx, newRow)
      : view.kind === 'timeline' ? renderTimeline(c, view, rows, ctx)
        : view.kind === 'chart' ? renderDbChart(c, view, rows)
          : renderCards(c, view, rows, ctx, newRow);

  el.replaceChildren(head, renderViewBar(c, view, ctx), body);
  if (!ctx.readOnly && view.kind !== 'board' && view.kind !== 'calendar' && view.kind !== 'chart') {
    const more = h('button', 'dn-db-new dn-db-ui', '+ 새 항목');
    more.addEventListener('click', () => newRow());
    el.append(more);
  }
  el.dataset.count = String(rows.length);

  if (focusKey) {
    const back = el.querySelector<HTMLInputElement>(`[data-key="${CSS.escape(focusKey)}"]`);
    if (back) {
      if (typed !== null && back.tagName === 'INPUT') back.value = typed;
      back.focus({ preventScroll: true });
      if (caret && typeof back.setSelectionRange === 'function' && back.type === 'text') try { back.setSelectionRange(caret[0]!, caret[1]!); } catch { /* 날짜 칸 등 */ }
    }
  }
}

/** 표 뷰 (FR-057): 정렬이 걸려 있으면 손으로 순서를 바꾸지 않는다(손잡이는 메뉴만) */
function renderTable(c: DatabaseContent, view: DbView, rows: readonly DbRow[], ctx: DbCtx): HTMLElement {
  const props = c.properties.filter((p) => !p.hidden);
  const sorted = !!view.sorts?.length;
  const wrap = h('div', 'dn-db-scroll');
  const table = h('table', 'dn-db-table');
  const cols = h('colgroup');
  cols.append(h('col', 'dn-db-col-handle'));
  for (const p of props) { const col = h('col'); col.style.width = `${p.width ?? 140}px`; cols.append(col); }
  if (!ctx.readOnly) cols.append(h('col', 'dn-db-col-add'));
  table.append(cols);

  const thead = h('thead');
  const hr = h('tr');
  hr.append(h('th', 'dn-db-th-handle'));
  props.forEach((p, i) => {
    const th = h('th');
    const btn = h('button', 'dn-db-prop dn-db-ui');
    btn.append(h('span', 'dn-db-ticon', TYPE_ICON[p.type]), h('span', 'dn-db-pname', p.name));
    btn.title = `${p.name} — 속성 메뉴`;
    btn.disabled = ctx.readOnly;
    btn.addEventListener('click', () => openPropMenu(btn, ctx.engine, c.id, p.id, i === 0));
    th.append(btn);
    if (!ctx.readOnly) th.append(resizeHandle(th, cols.children[i + 1] as HTMLElement, ctx, c.id, p));
    hr.append(th);
  });
  if (!ctx.readOnly) {
    const th = h('th', 'dn-db-th-add');
    const add = h('button', 'dn-db-add dn-db-ui', '+');
    add.title = '속성 추가';
    add.setAttribute('aria-label', '속성 추가');
    add.addEventListener('click', () => openAddProp(add, ctx.engine, c.id));
    th.append(add);
    hr.append(th);
  }
  thead.append(hr);

  const tbody = h('tbody');
  rows.forEach((r, ri) => {
    const tr = h('tr');
    tr.dataset.row = r.id;
    const hd = h('td', 'dn-db-handle');
    if (!ctx.readOnly) {
      const g = h('button', 'dn-db-grip dn-db-ui', '⋮⋮');
      g.title = sorted ? '항목 메뉴 (정렬 중에는 끌어서 순서를 바꿀 수 없어요)' : '끌어서 순서 바꾸기 · 누르면 항목 메뉴';
      g.setAttribute('aria-label', `항목 ${ri + 1} 메뉴`);
      rowDrag(g, tr, tbody, ctx, c.id, r.id, sorted);
      hd.append(g);
    }
    tr.append(hd);
    props.forEach((p, pi) => {
      const td = h('td');
      td.append(cellEl(ctx, c, r.id, p, r.values[p.id], pi === 0 && ri === rows.length - 1 && !view.filters?.length && !sorted));
      if (pi === 0) { const ob = openPageButton(c.id, r.id, !!r.page); if (ob) { td.classList.add('dn-db-namecell'); td.append(ob); } }
      tr.append(td);
    });
    if (!ctx.readOnly) tr.append(h('td'));
    tbody.append(tr);
  });
  if (!rows.length && c.rows.length) {
    const tr = h('tr');
    const td = h('td', 'dn-db-none', '조건에 맞는 항목이 없어요');
    td.colSpan = props.length + 2;
    tr.append(td);
    tbody.append(tr);
  }
  const foot = calcFoot(c, view, rows, props, ctx); // 열 계산 (GAP #20)
  table.append(thead, tbody, ...(foot ? [foot] : []));
  wrap.append(table);
  return wrap;
}

function focusLater(el: HTMLElement, key: string): void {
  requestAnimationFrame(() => el.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)?.focus({ preventScroll: true }));
}

/** 칸 하나 */
export function cellEl(ctx: DbCtx, c: DatabaseContent, rowId: Id, p: DbProperty, v: DbValue | undefined, lastName: boolean): HTMLElement {
  const key = `${rowId}:${p.id}`;
  const set = (value: DbValue) => setDbValue(ctx.engine, c.id, rowId, p.id, value);
  // 관계 · 집계 (FR-062)
  if (p.type === 'relation') return relationCell(ctx.engine, ctx.readOnly, c, rowId, p, key);
  if (p.type === 'rollup') return rollupCell(ctx.engine, c, c.rows.find((r) => r.id === rowId), p, key);
  if (p.type === 'checkbox') {
    const box = h('input', 'dn-db-check dn-db-ui');
    box.type = 'checkbox';
    box.checked = v === true;
    box.disabled = ctx.readOnly;
    box.dataset.key = key;
    box.setAttribute('aria-label', p.name);
    box.addEventListener('change', () => set(box.checked));
    return box;
  }
  // 파일 · 계산 속성 (GAP #19)
  if (p.type === 'files') return filesCell(ctx.engine, ctx.readOnly, c, rowId, p, v, key);
  if (p.type === 'formula' || p.type === 'created' || p.type === 'edited') return computedCell(c, rowId, p, key);
  if (p.type === 'select' || p.type === 'multiSelect' || p.type === 'status') {
    const btn = h('button', 'dn-db-chips dn-db-ui');
    btn.dataset.key = key;
    btn.disabled = ctx.readOnly;
    btn.setAttribute('aria-label', `${p.name} 고르기`);
    const ids = p.type === 'select' || p.type === 'status' ? (typeof v === 'string' ? [v] : []) : Array.isArray(v) ? v : [];
    for (const id of ids) { const o = p.options?.find((x) => x.id === id); if (o) btn.append(chipEl(o)); }
    btn.addEventListener('click', () => openOptionPicker(btn, ctx.engine, c.id, rowId, p.id));
    return btn;
  }
  const inp = h('input', `dn-db-input dn-db-ui${p.type === 'number' ? ' dn-db-num' : ''}`);
  inp.type = p.type === 'date' ? 'date' : 'text';
  if (p.type === 'number') inp.inputMode = 'decimal';
  inp.value = v === null || v === undefined ? '' : String(v);
  inp.dataset.orig = inp.value;
  // 빈 날짜 칸은 조용히 (DS-019) — 브라우저의 '연도-월-일' · 달력 아이콘은 올리거나 고를 때만
  if (inp.type === 'date') { const mark = () => inp.classList.toggle('dn-db-empty', !inp.value); mark(); inp.addEventListener('input', mark); }
  inp.disabled = ctx.readOnly;
  inp.dataset.key = key;
  inp.setAttribute('aria-label', p.name);
  const commit = () => {
    if (p.type === 'number') {
      const t = inp.value.trim().replace(/,/g, '');
      const n = t === '' ? null : Number(t);
      if (n !== null && !Number.isFinite(n)) { inp.value = v === null || v === undefined ? '' : String(v); return; }
      set(n);
    } else set(inp.value);
  };
  inp.addEventListener('change', commit);
  bindKeys(inp, ctx, () => {
    // Enter: 아래 칸으로 — 마지막 항목의 이름 칸이면 새 항목
    commit();
    if (lastName) { const r = addDbRow(ctx.engine, c.id); if (r.ok && r.value) focusLater(inp.closest('.dn-db')!, `${r.value}:${p.id}`); return; }
    const tr = inp.closest('tr')?.nextElementSibling as HTMLElement | null;
    const next = tr?.dataset.row ? inp.closest('.dn-db')!.querySelector<HTMLElement>(`[data-key="${CSS.escape(`${tr.dataset.row}:${p.id}`)}"]`) : null;
    if (next) next.focus(); else inp.blur();
  });
  if (p.type === 'url' && typeof v === 'string' && /^https?:\/\//i.test(v)) {
    const box = h('span', 'dn-db-url');
    const a = h('a', 'dn-db-open dn-db-ui', '↗');
    a.href = v; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.title = '새 탭에서 열기';
    box.append(inp, a);
    return box;
  }
  return inp;
}

function bindKeys(inp: HTMLInputElement, ctx: DbCtx, onEnter?: () => void): void {
  inp.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (e.key === 'Enter') { e.preventDefault(); if (onEnter) onEnter(); else inp.blur(); }
    else if (e.key === 'Escape') { e.preventDefault(); inp.blur(); ctx.onExit?.(); }
  });
}

/** 열 너비: 머리 오른쪽 끝을 끈다 (끄는 동안은 화면만, 놓으면 저장) */
function resizeHandle(th: HTMLElement, col: HTMLElement, ctx: DbCtx, cid: Id, p: DbProperty): HTMLElement {
  const grip = h('span', 'dn-db-resize dn-db-ui');
  grip.title = '끌어서 열 너비 조절';
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    const z = zoomOf(th), x0 = e.clientX, w0 = p.width ?? 140;
    let w = w0;
    const move = (ev: PointerEvent) => { w = Math.max(60, Math.min(800, w0 + (ev.clientX - x0) / z)); col.style.width = `${w}px`; };
    dragWindow(move, () => { if (Math.round(w) !== w0) setDbPropertyWidth(ctx.engine, cid, p.id, w); });
  });
  return grip;
}

/** 행 손잡이: 끌면 순서 바꾸기(놓은 자리 앞), 움직이지 않고 떼면 항목 메뉴 */
function rowDrag(g: HTMLElement, tr: HTMLElement, tbody: HTMLElement, ctx: DbCtx, cid: Id, rowId: Id, locked = false): void {
  g.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    const y0 = e.clientY;
    let moved = false, before: string | null | undefined;
    const rows = () => [...tbody.querySelectorAll<HTMLElement>('tr[data-row]')];
    const move = (ev: PointerEvent) => {
      if (locked || (!moved && Math.abs(ev.clientY - y0) < 4)) return;
      moved = true;
      tr.classList.add('dn-db-dragging');
      const list = rows().filter((x) => x !== tr);
      const hit = list.find((x) => { const r = x.getBoundingClientRect(); return ev.clientY < r.top + r.height / 2; });
      before = hit ? hit.dataset.row! : null;
      for (const x of rows()) x.classList.toggle('dn-db-drop', x === hit);
      tbody.classList.toggle('dn-db-drop-end', !hit);
    };
    dragWindow(move, () => {
      tr.classList.remove('dn-db-dragging'); tbody.classList.remove('dn-db-drop-end');
      for (const x of rows()) x.classList.remove('dn-db-drop');
      if (!moved) { openRowMenu(g, ctx.engine, cid, rowId); return; }
      if (before !== undefined && before !== rowId) moveDbRow(ctx.engine, cid, rowId, before);
    });
  });
}
