// 표 뷰 아래 열 계산 줄 (GAP #20 — 노션 Calculate): 열마다 '계산'을 눌러 개수 · 합 · 평균 · 체크 비율 …을 고른다.
// 계산은 지금 보기의 항목(필터 뒤)으로 — 뷰마다 저장. 보기 전용이면 고른 계산만 보인다.
import { CALC_LABEL, calcOptions, columnCalc, updateDbView, type CalcFn, type DatabaseContent, type DbProperty, type DbRow, type DbView } from '@dn/engine-core';
import { item, mk as h, popup, sep } from './db-menus';
import type { DbCtx } from './db-view';

export function calcFoot(c: DatabaseContent, view: DbView, rows: readonly DbRow[], props: readonly DbProperty[], ctx: DbCtx): HTMLTableSectionElement | null {
  const calcs = view.calcs ?? {};
  if (ctx.readOnly && !Object.keys(calcs).length) return null;
  const tf = h('tfoot');
  const tr = h('tr', 'dn-db-calcrow');
  tr.append(h('td'));
  for (const p of props) {
    const td = h('td');
    const fn = calcs[p.id];
    const b = h('button', `dn-db-calc dn-db-ui${fn ? ' on' : ''}`);
    if (fn) b.append(h('span', 'dn-db-calcname', CALC_LABEL[fn]), h('span', 'dn-db-calcval', columnCalc(c, rows, p, fn)));
    else b.textContent = '계산';
    b.title = `${p.name} 열 계산`;
    b.disabled = ctx.readOnly;
    b.addEventListener('click', () => popup(b, `${p.name} 계산`, (pop, _again, close) => {
      pop.append(h('div', 'dn-db-mh', `${p.name} — 계산`));
      const set = (next: CalcFn | null) => {
        const all = { ...calcs };
        if (next) all[p.id] = next; else delete all[p.id];
        updateDbView(ctx.engine, c.id, view.id, { calcs: all }, '열 계산');
        close();
      };
      for (const o of calcOptions(p)) item(pop, `${CALC_LABEL[o]}${o === fn ? '  ✓' : ''}`, () => set(o), o === fn ? 'on' : '');
      if (fn) { sep(pop); item(pop, '계산 없음', () => set(null)); }
    }));
    td.append(b);
    tr.append(td);
  }
  if (!ctx.readOnly) tr.append(h('td'));
  tf.append(tr);
  return tf;
}
