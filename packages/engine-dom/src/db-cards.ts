// 데이터베이스 보드 · 갤러리 · 리스트 뷰 (FR-058 · 060): 항목을 카드로.
// 보드: 선택 속성의 옵션마다 한 열(+ "없음"), 열마다 개수 · 새 항목, 카드를 끌어 다른 열에 놓으면 그 값으로 바뀐다(순서와 함께 실행 취소 한 번).
// 카드의 이름은 그 자리에서 고치고, 선택 · 다중 선택 값은 눌러서 고른다. 나머지 속성은 표에서 고친다.
import {
  boardProp, cardProps, dbCellTextIn, moveDbRow, type DatabaseContent, type DbOption, type DbProperty, type DbRow, type DbView, type Id,
} from '@dn/engine-core';
import { chipEl, dragWindow, mk as h, openOptionPicker, openPageButton, openRowMenu } from './db-menus';
import { cellEl, type DbCtx, type NewRow } from './db-view';

export function renderCards(c: DatabaseContent, view: DbView, rows: readonly DbRow[], ctx: DbCtx, newRow: NewRow): HTMLElement {
  const shown = cardProps(c, view);
  if (view.kind === 'board') return renderBoard(c, view, rows, ctx, newRow, shown);
  const box = h('div', view.kind === 'gallery' ? 'dn-db-gallery' : 'dn-db-list');
  for (const r of rows) box.append(card(c, r, ctx, shown, view.kind === 'list'));
  if (!rows.length) box.append(h('div', 'dn-db-none', c.rows.length ? '조건에 맞는 항목이 없어요' : '항목이 없어요'));
  return box;
}

function card(c: DatabaseContent, r: DbRow, ctx: DbCtx, shown: readonly DbProperty[], line: boolean): HTMLElement {
  const el = h('div', line ? 'dn-db-line' : 'dn-db-card');
  el.dataset.row = r.id;
  const name = c.properties[0]!;
  const n = cellEl(ctx, c, r.id, name, r.values[name.id], false);
  n.classList.add('dn-db-cname');
  if (n instanceof HTMLInputElement) n.placeholder = '제목 없음';
  el.append(n);
  const ob = openPageButton(c.id, r.id, !!r.page);
  if (ob) el.append(ob);
  const meta = h('div', 'dn-db-cprops');
  for (const p of shown) {
    const v = r.values[p.id];
    if (p.type === 'select' || p.type === 'multiSelect' || p.type === 'status') {
      const ids = p.type === 'select' || p.type === 'status' ? (typeof v === 'string' ? [v] : []) : Array.isArray(v) ? v : [];
      const opts = ids.map((id) => p.options?.find((o) => o.id === id)).filter((o): o is DbOption => !!o);
      if (!opts.length && ctx.readOnly) continue;
      const b = h('button', 'dn-db-cchips dn-db-ui');
      b.title = p.name;
      b.setAttribute('aria-label', `${p.name} 고르기`);
      b.disabled = ctx.readOnly;
      if (opts.length) for (const o of opts) b.append(chipEl(o)); else b.append(h('span', 'dn-db-cempty', p.name));
      b.addEventListener('click', () => openOptionPicker(b, ctx.engine, c.id, r.id, p.id));
      meta.append(b);
      continue;
    }
    const t = p.type === 'checkbox' ? (v === true ? `☑ ${p.name}` : '') : dbCellTextIn(ctx.engine, c, r, p);
    if (!t) continue;
    const s = h('span', 'dn-db-cval', t);
    s.title = p.name;
    meta.append(s);
  }
  if (meta.childElementCount) el.append(meta);
  return el;
}

function renderBoard(c: DatabaseContent, view: DbView, rows: readonly DbRow[], ctx: DbCtx, newRow: NewRow, shown: DbProperty[]): HTMLElement {
  const gp = boardProp(c, view);
  if (!gp) return h('div', 'dn-db-none', '보드로 묶을 "선택" 속성이 없어요 — 표 뷰에서 선택 속성을 추가해 주세요.');
  const board = h('div', 'dn-db-board');
  const groups: { opt: DbOption | null; rows: DbRow[] }[] = [...(gp.options ?? []).map((o) => ({ opt: o, rows: [] as DbRow[] })), { opt: null, rows: [] }];
  for (const r of rows) {
    const v = r.values[gp.id];
    (groups.find((g) => g.opt && g.opt.id === v) ?? groups.at(-1)!).rows.push(r);
  }
  const fields = shown.filter((p) => p.id !== gp.id);
  for (const g of groups) {
    if (!g.opt && !g.rows.length && groups.length > 1) continue; // 빈 "없음" 열은 감춘다
    const col = h('div', 'dn-db-bcol');
    col.dataset.group = g.opt?.id ?? '';
    const head = h('div', 'dn-db-bhead');
    head.append(g.opt ? chipEl(g.opt) : h('span', 'dn-db-chip dn-db-nochip', `${gp.name} 없음`), h('span', 'dn-db-bcount', String(g.rows.length)));
    col.append(head);
    for (const r of g.rows) {
      const cd = card(c, r, ctx, fields, false);
      if (!ctx.readOnly) cardDrag(cd, board, ctx, c, gp, r.id);
      col.append(cd);
    }
    if (!ctx.readOnly) {
      const add = h('button', 'dn-db-new dn-db-ui', '+ 새 항목');
      add.addEventListener('click', () => newRow({ [gp.id]: g.opt?.id ?? null }));
      col.append(add);
    }
    board.append(col);
  }
  return board;
}

/** 카드 끌기: 놓은 열의 값으로 · 놓은 카드 앞으로. 움직이지 않고 떼면 항목 메뉴(이름 칸 · 선택 칩을 누른 건 제외) */
function cardDrag(cd: HTMLElement, board: HTMLElement, ctx: DbCtx, c: DatabaseContent, gp: DbProperty, rowId: Id): void {
  cd.classList.add('dn-db-ui', 'dn-db-drag');
  cd.addEventListener('pointerdown', (e) => {
    const t = e.target as HTMLElement;
    if (e.button !== 0 || t.closest('input, button, a')) return;
    e.preventDefault(); e.stopPropagation();
    const x0 = e.clientX, y0 = e.clientY;
    let moved = false, target: { group: string; before: Id | null } | null = null;
    const ghost = cd.cloneNode(true) as HTMLElement;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
      if (!moved) { moved = true; cd.classList.add('dn-db-dragging'); ghost.className = 'dn-db-card dn-db-ghost'; ghost.style.width = `${cd.getBoundingClientRect().width}px`; document.body.append(ghost); }
      ghost.style.left = `${ev.clientX + 6}px`; ghost.style.top = `${ev.clientY + 6}px`;
      const cols = [...board.querySelectorAll<HTMLElement>('.dn-db-bcol')];
      const col = cols.find((x) => { const r = x.getBoundingClientRect(); return ev.clientX >= r.left && ev.clientX <= r.right; });
      for (const x of board.querySelectorAll('.dn-db-drop, .dn-db-drop-col')) x.classList.remove('dn-db-drop', 'dn-db-drop-col');
      if (!col) { target = null; return; }
      const cards = [...col.querySelectorAll<HTMLElement>('.dn-db-card')].filter((x) => x !== cd);
      const hit = cards.find((x) => { const r = x.getBoundingClientRect(); return ev.clientY < r.top + r.height / 2; });
      if (hit) hit.classList.add('dn-db-drop'); else col.classList.add('dn-db-drop-col');
      target = { group: col.dataset.group ?? '', before: hit?.dataset.row ?? null };
    };
    dragWindow(move, () => {
      ghost.remove();
      cd.classList.remove('dn-db-dragging');
      for (const x of board.querySelectorAll('.dn-db-drop, .dn-db-drop-col')) x.classList.remove('dn-db-drop', 'dn-db-drop-col');
      if (!moved) { openRowMenu(cd, ctx.engine, c.id, rowId); return; }
      if (!target) return;
      const value = target.group || null;
      const cur = c.rows.find((r) => r.id === rowId)?.values[gp.id] ?? null;
      if (target.before === rowId) return;
      moveDbRow(ctx.engine, c.id, rowId, target.before, value !== cur ? { [gp.id]: value } : undefined);
    });
  });
}
