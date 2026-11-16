// 데이터베이스 타임라인 · 차트 뷰 (GAP #20 — engine-core db-calc.ts):
// 타임라인 — 왼쪽 항목 이름, 오른쪽 날짜 칸 위 가로 막대(시작 ~ 끝). 막대를 끌면 시작 · 끝이 같이 옮겨지고(실행 취소 한 번),
//   오른쪽 끝을 끌면 끝 날짜만(끝 속성이 있을 때). 오늘 줄 · 달 머리. 막대를 누르면 항목 메뉴.
// 차트 — 묶음(선택 · 상태 · 다중 선택 · 체크박스 · 텍스트)별 개수 또는 숫자 속성 합을 가로 막대로(옵션 색).
import { calendarProp, chartable, chartBars, dayIndex, dayString, setDbValue, timelineBars, type DatabaseContent, type DbRow, type DbView } from '@dn/engine-core';
import { CHART_COLORS } from './chart-render';
import { dragWindow, mk as h, openRowMenu } from './db-menus';
import type { DbCtx } from './db-view';

const NAME_W = 160;
/** 선택 옵션 색 이름 → 막대 색 (옵션 칩은 연한 바탕색이라 막대로 쓰면 묻힌다) */
const ACCENT: Record<string, string> = { gray: '#94a3b8', brown: '#b08968', orange: '#fb923c', yellow: '#eab308', green: '#22c55e', blue: '#3b82f6', purple: '#8b5cf6', pink: '#ec4899', red: '#ef4444' };
const MONTH = (i: number) => { const s = dayString(i); return `${+s.slice(5, 7)}월`; };

export function renderTimeline(c: DatabaseContent, view: DbView, rows: readonly DbRow[], ctx: DbCtx): HTMLElement {
  const sp = calendarProp(c, view);
  if (!sp) return h('div', 'dn-db-none', '타임라인에 쓸 "날짜" 속성이 없어요 — 표 뷰에서 날짜 속성을 추가해 주세요.');
  const ep = view.endProp ? c.properties.find((p) => p.id === view.endProp && p.type === 'date') : undefined;
  const { bars, undated } = timelineBars(c, rows, sp, ep);
  const today = dayIndex(new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString());
  const lo = Math.min(today, ...bars.map((b) => b.start)) - 3, hi = Math.max(today, ...bars.map((b) => b.end)) + 3;
  const days = Math.min(366, hi - lo + 1);
  const dw = Math.max(8, Math.min(32, Math.floor(720 / days)));
  const box = h('div', 'dn-db-tl');
  box.style.setProperty('--dw', `${dw}px`);
  // 머리: 달 · 날
  const head = h('div', 'dn-db-tlrow dn-db-tlhead');
  head.append(h('div', 'dn-db-tlname', sp.name + (ep ? ` → ${ep.name}` : '')));
  const scale = h('div', 'dn-db-tllane');
  scale.style.width = `${days * dw}px`;
  for (let i = 0; i < days; i++) {
    const d = lo + i, s = dayString(d);
    if (s.endsWith('-01') || i === 0) { const m = h('span', 'dn-db-tlmonth', MONTH(d)); m.style.left = `${i * dw}px`; scale.append(m); }
    if (dw >= 14 || s.endsWith('1') || s.endsWith('5')) { const t = h('span', `dn-db-tlday${d === today ? ' today' : ''}`, String(+s.slice(8, 10))); t.style.left = `${i * dw}px`; scale.append(t); }
  }
  head.append(scale);
  box.append(head);
  const name = c.properties[0]!;
  for (const b of bars.sort((x, y) => x.start - y.start)) {
    const row = h('div', 'dn-db-tlrow');
    row.append(h('div', 'dn-db-tlname', String(b.row.values[name.id] ?? '') || '이름 없음'));
    const lane = h('div', 'dn-db-tllane');
    lane.style.width = `${days * dw}px`;
    const now = h('div', 'dn-db-tltoday');
    now.style.left = `${(today - lo) * dw + dw / 2}px`;
    const bar = h('div', 'dn-db-tlbar dn-db-ui', String(b.row.values[name.id] ?? ''));
    bar.style.left = `${(b.start - lo) * dw}px`;
    bar.style.width = `${(b.end - b.start + 1) * dw - 2}px`;
    bar.title = `${dayString(b.start)}${b.end > b.start ? ` ~ ${dayString(b.end)}` : ''}`;
    if (!ctx.readOnly) barDrag(bar, ctx, c, b, sp.id, ep?.id, dw);
    lane.append(now, bar);
    row.append(lane);
    box.append(row);
  }
  if (!bars.length) box.append(h('div', 'dn-db-none', `"${sp.name}"이(가) 있는 항목이 없어요`));
  if (undated) box.append(h('div', 'dn-db-calnote', `날짜 없음 ${undated}`));
  const wrap = h('div', 'dn-db-tlwrap');
  wrap.style.setProperty('--name-w', `${NAME_W}px`);
  wrap.append(box);
  return wrap;
}

/** 막대 끌기: 가운데 = 옮기기(시작 · 끝 같이), 오른쪽 끝 6px = 끝만. 날 단위로 붙는다. 움직이지 않고 떼면 항목 메뉴 */
function barDrag(bar: HTMLElement, ctx: DbCtx, c: DatabaseContent, b: { row: DbRow; start: number; end: number }, startId: string, endId: string | undefined, dw: number): void {
  bar.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const r = bar.getBoundingClientRect(), zoom = r.width / Math.max(1, bar.offsetWidth);
    const edge = !!endId && e.clientX > r.right - 6 * zoom;
    const x0 = e.clientX, left0 = bar.offsetLeft, w0 = bar.offsetWidth;
    let dd = 0;
    dragWindow((ev) => {
      dd = Math.round((ev.clientX - x0) / zoom / dw);
      if (edge) bar.style.width = `${Math.max(dw - 2, w0 + dd * dw)}px`;
      else bar.style.left = `${left0 + dd * dw}px`;
    }, () => {
      if (!dd) { openRowMenu(bar, ctx.engine, c.id, b.row.id); return; }
      ctx.engine.transact(() => {
        if (edge && endId) setDbValue(ctx.engine, c.id, b.row.id, endId, dayString(Math.max(b.start, b.end + dd)));
        else {
          setDbValue(ctx.engine, c.id, b.row.id, startId, dayString(b.start + dd));
          if (endId && b.row.values[endId]) setDbValue(ctx.engine, c.id, b.row.id, endId, dayString(b.end + dd));
        }
      }, { origin: 'user', label: edge ? '끝 날짜 바꾸기' : '날짜 옮기기' });
    });
  });
}

export function renderDbChart(c: DatabaseContent, view: DbView, rows: readonly DbRow[]): HTMLElement {
  const by = c.properties.find((p) => p.id === view.chartBy && chartable(p)) ?? c.properties.find((p) => p.type === 'status' || p.type === 'select') ?? c.properties.find(chartable);
  if (!by) return h('div', 'dn-db-none', '차트로 묶을 속성(선택 · 상태 · 체크박스 …)이 없어요');
  const sum = view.chartValue ? c.properties.find((p) => p.id === view.chartValue && p.type === 'number') : undefined;
  const data = chartBars(c, rows, by, sum);
  const box = h('div', 'dn-db-chart');
  box.append(h('div', 'dn-db-charthead', `${by.name}별 ${sum ? `${sum.name} 합계` : '항목 수'}`));
  const max = Math.max(1, ...data.map((d) => d.value)), total = data.reduce((s, d) => s + d.value, 0);
  for (const d of data) {
    const row = h('div', 'dn-db-chartrow');
    const bar = h('div', 'dn-db-chartbar');
    bar.style.width = `${Math.max(2, (d.value / max) * 100)}%`;
    // 옵션 색(연한 바탕색)의 진한 쪽으로 — 막대가 바탕에 묻히지 않게, 색 없는 묶음은 그래프 색 차례로
    bar.style.background = d.color ? ACCENT[d.color] ?? CHART_COLORS[0]! : CHART_COLORS[data.indexOf(d) % CHART_COLORS.length]!;
    const val = h('span', 'dn-db-chartval');
    val.append(h('b', '', d.value.toLocaleString('ko-KR')), h('small', '', ` ${total ? Math.round((d.value / total) * 100) : 0}%`));
    row.append(h('span', 'dn-db-chartlabel', d.label), h('div', 'dn-db-charttrack'), val);
    row.querySelector('.dn-db-charttrack')!.append(bar);
    box.append(row);
  }
  if (!data.length) box.append(h('div', 'dn-db-none', '항목이 없어요'));
  return box;
}
