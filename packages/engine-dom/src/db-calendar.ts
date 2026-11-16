// 데이터베이스 캘린더 뷰 (FR-059): 날짜 속성 기준으로 한 달 달력에 항목을 놓는다. 항목을 다른 날로 끌면 날짜가 바뀌고,
// 날 칸의 +로 그 날짜의 새 항목을 만든다. 보고 있는 달은 화면 상태(저장하지 않음) — 처음엔 이번 달.
import { calendarProp, setDbValue, type DatabaseContent, type DbRow, type DbView, type Id } from '@dn/engine-core';
import { dragWindow, mk as h, openRowMenu } from './db-menus';
import type { DbCtx, NewRow } from './db-view';

/** 콘텐츠 · 뷰마다 보고 있는 달 (YYYY-MM) */
const months = new Map<string, string>();
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const DOW = ['일', '월', '화', '수', '목', '금', '토'];

export function renderCalendar(c: DatabaseContent, view: DbView, rows: readonly DbRow[], ctx: DbCtx, newRow: NewRow): HTMLElement {
  const dp = calendarProp(c, view);
  if (!dp) return h('div', 'dn-db-none', '캘린더에 쓸 "날짜" 속성이 없어요 — 표 뷰에서 날짜 속성을 추가해 주세요.');
  const key = `${c.id}:${view.id}`;
  const today = ymd(new Date());
  const ym = months.get(key) ?? today.slice(0, 7);
  const [y, m] = ym.split('-').map(Number) as [number, number];
  const name = c.properties[0]!;

  const box = h('div', 'dn-db-cal');
  const nav = h('div', 'dn-db-calnav');
  const go = (delta: number | null) => {
    const d = delta === null ? new Date() : new Date(y, m - 1 + delta, 1);
    months.set(key, `${d.getFullYear()}-${pad(d.getMonth() + 1)}`);
    box.replaceWith(renderCalendar(c, view, rows, ctx, newRow));
  };
  const btn = (t: string, label: string, fn: () => void) => { const b = h('button', 'dn-db-btn dn-db-ui', t); b.setAttribute('aria-label', label); b.addEventListener('click', fn); return b; };
  const undated = rows.filter((r) => typeof r.values[dp.id] !== 'string' || !r.values[dp.id]).length;
  nav.append(h('span', 'dn-db-calmonth', `${y}년 ${m}월`), btn('‹', '이전 달', () => go(-1)), btn('오늘', '이번 달', () => go(null)), btn('›', '다음 달', () => go(1)));
  if (undated) nav.append(h('span', 'dn-db-calnote', `날짜 없음 ${undated}`));
  box.append(nav);

  const grid = h('div', 'dn-db-calgrid');
  for (const d of DOW) grid.append(h('div', 'dn-db-dow', d));
  const first = new Date(y, m - 1, 1);
  const start = new Date(y, m - 1, 1 - first.getDay());
  const byDay = new Map<string, DbRow[]>();
  for (const r of rows) { const v = r.values[dp.id]; if (typeof v === 'string' && v) (byDay.get(v) ?? byDay.set(v, []).get(v)!).push(r); }
  const weeks = Math.ceil((first.getDay() + new Date(y, m, 0).getDate()) / 7);
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const day = ymd(d);
    const cell = h('div', `dn-db-day${d.getMonth() !== m - 1 ? ' out' : ''}${day === today ? ' today' : ''}`);
    cell.dataset.day = day;
    const top = h('div', 'dn-db-dtop');
    top.append(h('span', 'dn-db-dnum', String(d.getDate())));
    if (!ctx.readOnly) {
      const add = h('button', 'dn-db-dadd dn-db-ui', '+');
      add.title = `${m}월 ${d.getDate()}일 새 항목`;
      add.setAttribute('aria-label', `${day} 새 항목`);
      add.addEventListener('click', () => newRow({ [dp.id]: day }));
      top.append(add);
    }
    cell.append(top);
    for (const r of byDay.get(day) ?? []) {
      const it = h('div', 'dn-db-ev dn-db-ui', String(r.values[name.id] ?? '') || '제목 없음');
      it.dataset.row = r.id;
      it.tabIndex = 0;
      if (!ctx.readOnly) dragToDay(it, grid, ctx, c.id, r.id, dp.id);
      cell.append(it);
    }
    grid.append(cell);
  }
  box.append(grid);
  return box;
}

/** 일정 끌기: 놓은 날 칸으로 날짜를 바꾼다. 움직이지 않고 떼면 항목 메뉴 */
function dragToDay(it: HTMLElement, grid: HTMLElement, ctx: DbCtx, cid: Id, rowId: Id, propId: Id): void {
  it.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const x0 = e.clientX, y0 = e.clientY;
    let moved = false, day: string | null = null;
    const cells = () => [...grid.querySelectorAll<HTMLElement>('.dn-db-day')];
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
      moved = true;
      it.classList.add('dn-db-dragging');
      const hit = cells().find((x) => { const r = x.getBoundingClientRect(); return ev.clientX >= r.left && ev.clientX < r.right && ev.clientY >= r.top && ev.clientY < r.bottom; });
      for (const x of cells()) x.classList.toggle('dn-db-drop-col', x === hit);
      day = hit?.dataset.day ?? null;
    };
    dragWindow(move, () => {
      it.classList.remove('dn-db-dragging');
      for (const x of cells()) x.classList.remove('dn-db-drop-col');
      if (!moved) { openRowMenu(it, ctx.engine, cid, rowId); return; }
      if (day) setDbValue(ctx.engine, cid, rowId, propId, day);
    });
  });
}
