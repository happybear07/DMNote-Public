// 데이터베이스 뷰 막대 (FR-058 ~ 061): 뷰 탭(누르면 바꾸기, 지금 뷰를 다시 누르면 설정) · 뷰 추가 · 필터 · 정렬.
// 필터 · 정렬 · 그룹 기준 · 날짜 속성 · 카드 속성은 뷰마다 저장된다.
import {
  addDbView, chartable, DB_VIEW_LABEL, dbViews, deleteDbView, FILTER_OP_LABEL, filterOps, opNeedsValue, setActiveDbView, updateDbView,
  type DatabaseContent, type DbFilter, type DbProperty, type DbSort, type DbValue, type DbView, type DbViewKind, type Engine, type Id,
} from '@dn/engine-core';
import { dbOf, item, mk, popup, sep, TYPE_ICON, xBtn } from './db-menus';
import type { DbCtx } from './db-view';
import { iconElement, type IconName } from '@dn/text-pm';

const KIND_ICON: Record<DbViewKind, IconName> = { table: 'table', board: 'board', calendar: 'calendar', gallery: 'gallery', list: 'list', timeline: 'timeline', chart: 'chart' };

export function renderViewBar(c: DatabaseContent, view: DbView, ctx: DbCtx): HTMLElement {
  const bar = mk('div', 'dn-db-views');
  const tabs = mk('div', 'dn-db-tabs');
  tabs.setAttribute('role', 'tablist');
  for (const v of dbViews(c)) {
    const t = mk('button', `dn-db-tab dn-db-ui${v.id === view.id ? ' on' : ''}`, v.name);
    t.prepend(iconElement(KIND_ICON[v.kind], 14));
    t.setAttribute('role', 'tab');
    t.setAttribute('aria-selected', String(v.id === view.id));
    t.disabled = ctx.readOnly && v.id !== view.id;
    t.title = v.id === view.id ? '뷰 설정' : `${v.name} 뷰로`;
    t.addEventListener('click', () => {
      if (ctx.readOnly) return;
      if (v.id === view.id) openViewMenu(t, ctx.engine, c.id, v.id);
      else setActiveDbView(ctx.engine, c.id, v.id);
    });
    tabs.append(t);
  }
  if (!ctx.readOnly) {
    const add = mk('button', 'dn-db-tab dn-db-ui', '+');
    add.title = '뷰 추가';
    add.setAttribute('aria-label', '뷰 추가');
    add.addEventListener('click', () => popup(add, '뷰 추가', (pop, _a, close) => {
      pop.append(mk('div', 'dn-db-mh', '뷰 추가'));
      for (const k of Object.keys(DB_VIEW_LABEL) as DbViewKind[]) item(pop, DB_VIEW_LABEL[k], () => { addDbView(ctx.engine, c.id, k); close(); }).prepend(iconElement(KIND_ICON[k], 14));
    }));
    tabs.append(add);
  }
  bar.append(tabs);
  if (!ctx.readOnly) {
    const nf = view.filters?.length ?? 0, ns = view.sorts?.length ?? 0;
    const f = mk('button', `dn-db-btn dn-db-ui${nf ? ' on' : ''}`, nf ? `필터 ${nf}` : '필터');
    f.addEventListener('click', () => openFilters(f, ctx.engine, c.id, view.id));
    const s = mk('button', `dn-db-btn dn-db-ui${ns ? ' on' : ''}`, ns ? `정렬 ${ns}` : '정렬');
    s.addEventListener('click', () => openSorts(s, ctx.engine, c.id, view.id));
    bar.append(f, s);
  }
  return bar;
}

const fresh = (engine: Engine, cid: Id, viewId: Id): { d: DatabaseContent; v: DbView } | null => {
  const d = dbOf(engine, cid);
  const v = d && dbViews(d).find((x) => x.id === viewId);
  return d && v ? { d, v } : null;
};

function select(options: readonly [string, string][], value: string, label: string, on: (v: string) => void): HTMLSelectElement {
  const s = mk('select', 'dn-db-sel');
  s.setAttribute('aria-label', label);
  for (const [v, t] of options) { const o = mk('option', '', t); o.value = v; s.append(o); }
  s.value = value;
  s.addEventListener('change', () => on(s.value));
  return s;
}

/** 뷰 설정: 이름 · 보드 기준 · 캘린더 날짜 · 카드 속성 · 삭제 */
function openViewMenu(anchor: HTMLElement, engine: Engine, cid: Id, viewId: Id): void {
  popup(anchor, '뷰 설정', (pop, again, close) => {
    const x = fresh(engine, cid, viewId);
    if (!x) { close(); return; }
    const { d, v } = x;
    const name = mk('input', 'dn-db-pin');
    name.value = v.name;
    name.dataset.k = 'vname';
    name.setAttribute('aria-label', '뷰 이름');
    const save = () => { const n = name.value.trim(); if (n && n !== v.name) updateDbView(engine, cid, viewId, { name: n }, '뷰 이름'); };
    name.addEventListener('change', save);
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { save(); close(); } });
    pop.append(name);
    const byType = (t: DbProperty['type']) => d.properties.filter((p) => p.type === t || (t === 'select' && p.type === 'status')).map((p): [string, string] => [p.id, p.name]);
    const pick = (head: string, label: string, t: DbProperty['type'], cur: string | undefined, patch: (id: string) => Partial<DbView>, none: string) => {
      sep(pop, head);
      const opts = byType(t);
      pop.append(opts.length ? select(opts, cur ?? opts[0]![0], label, (id) => { updateDbView(engine, cid, viewId, patch(id)); again(); }) : mk('div', 'dn-db-hint', none));
    };
    if (v.kind === 'board') pick('묶을 속성 (선택)', '묶을 속성', 'select', v.groupBy, (id) => ({ groupBy: id }), '선택 속성이 없어요 — 표에서 속성을 추가해 주세요');
    if (v.kind === 'calendar' || v.kind === 'timeline') pick(v.kind === 'timeline' ? '시작 날짜' : '날짜 속성', '날짜 속성', 'date', v.dateProp, (id) => ({ dateProp: id }), '날짜 속성이 없어요 — 표에서 속성을 추가해 주세요');
    // 타임라인 끝 · 차트 묶음 · 값 (GAP #20) — '없음'을 고를 수 있는 칸
    const opt = (head: string, label: string, list: DbProperty[], cur: string | undefined, none: string, patch: (id: string | undefined) => Partial<DbView>) => {
      sep(pop, head);
      pop.append(select([['', none], ...list.map((p): [string, string] => [p.id, p.name])], cur ?? '', label, (id) => { updateDbView(engine, cid, viewId, patch(id || undefined)); again(); }));
    };
    if (v.kind === 'timeline') opt('끝 날짜', '끝 날짜 속성', d.properties.filter((p) => p.type === 'date' && p.id !== v.dateProp), v.endProp, '없음 (하루 막대)', (id) => ({ endProp: id }));
    if (v.kind === 'chart') {
      opt('묶을 속성', '차트 묶을 속성', d.properties.filter(chartable), v.chartBy, '자동 (상태 · 선택)', (id) => ({ chartBy: id }));
      opt('막대 값', '차트 값', d.properties.filter((p) => p.type === 'number'), v.chartValue, '항목 수', (id) => ({ chartValue: id }));
    }
    if (v.kind === 'board' || v.kind === 'gallery' || v.kind === 'list') {
      sep(pop, '카드에 보일 속성');
      const shown = v.cardProps ?? d.properties.slice(1, 4).filter((p) => !p.hidden).map((p) => p.id);
      for (const p of d.properties.slice(1)) {
        const on = shown.includes(p.id);
        const b = item(pop, `${on ? '☑' : '☐'}  ${TYPE_ICON[p.type]} ${p.name}`, () => {
          updateDbView(engine, cid, viewId, { cardProps: on ? shown.filter((id) => id !== p.id) : [...shown, p.id] }, '카드 속성');
          again();
        });
        b.setAttribute('aria-checked', String(on));
      }
    }
    if (dbViews(d).length > 1) { sep(pop); item(pop, '뷰 삭제', () => { deleteDbView(engine, cid, viewId); close(); }, 'danger'); }
  });
}

/** 값 입력 (조건의 오른쪽) */
function valueInput(p: DbProperty, f: DbFilter, on: (v: DbValue) => void): HTMLElement | null {
  if (!opNeedsValue(f.op)) return null;
  if (p.type === 'select' || p.type === 'multiSelect' || p.type === 'status') {
    return select([['', '— 옵션 —'], ...(p.options ?? []).map((o): [string, string] => [o.id, o.name])], typeof f.value === 'string' ? f.value : '', '값', (v) => on(v || null));
  }
  const inp = mk('input', 'dn-db-pin dn-db-fv');
  inp.type = p.type === 'date' ? 'date' : p.type === 'number' ? 'number' : 'text';
  inp.value = f.value === undefined || f.value === null ? '' : String(f.value);
  inp.placeholder = '값';
  inp.setAttribute('aria-label', '값');
  inp.addEventListener('change', () => on(p.type === 'number' ? (inp.value === '' ? null : Number(inp.value)) : inp.value));
  return inp;
}

function openFilters(anchor: HTMLElement, engine: Engine, cid: Id, viewId: Id): void {
  popup(anchor, '필터', (pop, again, close) => {
    const x = fresh(engine, cid, viewId);
    if (!x) { close(); return; }
    const { d, v } = x;
    const fs = [...(v.filters ?? [])];
    const set = (next: DbFilter[], match = v.match) => { updateDbView(engine, cid, viewId, { filters: next, ...(match ? { match } : {}) }, '필터'); again(); };
    pop.append(mk('div', 'dn-db-mh', '필터'));
    if (fs.length > 1) {
      pop.append(select([['and', '모든 조건을 만족'], ['or', '하나라도 만족']], v.match ?? 'and', '조건 조합', (m) => set(fs, m as 'and' | 'or')));
    }
    fs.forEach((f, i) => {
      const p = d.properties.find((x) => x.id === f.propId);
      if (!p) return;
      const row = mk('div', 'dn-db-frow');
      row.append(select(d.properties.filter((x) => filterOps(x).length).map((x): [string, string] => [x.id, x.name]), p.id, '속성', (id) => {
        const np = d.properties.find((x) => x.id === id)!;
        fs[i] = { propId: id, op: filterOps(np)[0]! };
        set(fs);
      }));
      row.append(select(filterOps(p).map((o): [string, string] => [o, FILTER_OP_LABEL[o]]), f.op, '조건', (op) => { fs[i] = { ...f, op: op as DbFilter['op'] }; set(fs); }));
      const vi = valueInput(p, f, (value) => { fs[i] = { ...f, value }; set(fs); });
      if (vi) row.append(vi);
      row.append(xBtn('조건 지우기', '조건 지우기', () => { fs.splice(i, 1); set(fs); }));
      pop.append(row);
    });
    const first = d.properties[0]!;
    item(pop, '+ 조건 추가', () => set([...fs, { propId: first.id, op: filterOps(first)[0]! }]));
  });
}

function openSorts(anchor: HTMLElement, engine: Engine, cid: Id, viewId: Id): void {
  popup(anchor, '정렬', (pop, again, close) => {
    const x = fresh(engine, cid, viewId);
    if (!x) { close(); return; }
    const { d, v } = x;
    const ss = [...(v.sorts ?? [])];
    const set = (next: DbSort[]) => { updateDbView(engine, cid, viewId, { sorts: next }, '정렬'); again(); };
    pop.append(mk('div', 'dn-db-mh', '정렬 (위 기준부터)'));
    ss.forEach((s, i) => {
      const row = mk('div', 'dn-db-frow');
      row.append(select(d.properties.filter((p) => p.type !== 'rollup').map((p): [string, string] => [p.id, p.name]), s.propId, '속성', (id) => { ss[i] = { ...s, propId: id }; set(ss); }));
      row.append(select([['asc', '오름차순'], ['desc', '내림차순']], s.dir, '방향', (dir) => { ss[i] = { ...s, dir: dir as 'asc' | 'desc' }; set(ss); }));
      row.append(xBtn('정렬 지우기', '정렬 지우기', () => { ss.splice(i, 1); set(ss); }));
      pop.append(row);
    });
    const unused = d.properties.find((p) => p.type !== 'rollup' && !ss.some((s) => s.propId === p.id));
    if (unused) item(pop, '+ 정렬 추가', () => set([...ss, { propId: unused.id, dir: 'asc' }]));
  });
}
