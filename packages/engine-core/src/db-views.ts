// 데이터베이스 뷰 (FR-058 · 059 · 060 · 061): 같은 항목을 표 · 보드 · 캘린더 · 갤러리 · 리스트로. 필터 · 정렬 · 그룹 기준은 뷰마다 저장된다.
// 뷰가 없는 데이터베이스(10/04 첫 버전)는 기본 표 뷰 하나가 있는 것으로 읽고, 뷰를 처음 고칠 때 실제로 저장한다.
import type { Engine, TxResult } from './engine';
import type { Tx } from './tx';
import { newId } from './id';
import type { Id } from './model';
import { dbRows, isDatabaseContent, widenBlock, type DatabaseContent, type DatabaseData, type DbProperty, type DbRow, type DbValue } from './database';
import { cellValue, optionGroup, STATUS_GROUPS } from './db-props';
import type { CalcFn } from './db-calc';

export type DbViewKind = 'table' | 'board' | 'calendar' | 'gallery' | 'list' | 'timeline' | 'chart';
export const DB_VIEW_LABEL: Record<DbViewKind, string> = { table: '표', board: '보드', calendar: '캘린더', gallery: '갤러리', list: '리스트', timeline: '타임라인', chart: '차트' };

export type FilterOp =
  | 'contains' | 'notContains' | 'is' | 'isNot' | 'empty' | 'notEmpty'
  | 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'before' | 'after' | 'checked' | 'unchecked';
export interface DbFilter { readonly propId: Id; readonly op: FilterOp; readonly value?: DbValue }
export interface DbSort { readonly propId: Id; readonly dir: 'asc' | 'desc' }
export interface DbView {
  readonly id: Id;
  readonly name: string;
  readonly kind: DbViewKind;
  readonly filters?: readonly DbFilter[];
  /** 필터 조합: 모두(and) · 하나라도(or) */
  readonly match?: 'and' | 'or';
  readonly sorts?: readonly DbSort[];
  /** 보드: 묶을 선택 속성 */
  readonly groupBy?: Id;
  /** 캘린더: 기준 날짜 속성 */
  readonly dateProp?: Id;
  /** 보드 · 갤러리 · 리스트 카드에 보일 속성 (없으면 이름 다음 세 개) */
  readonly cardProps?: readonly Id[];
  /** 타임라인 끝 날짜 속성 (없으면 하루 막대) · 차트 묶을 속성 · 차트 값(숫자 속성 합, 없으면 개수) · 표 열 계산 (GAP #20, db-calc.ts) */
  readonly endProp?: Id;
  readonly chartBy?: Id;
  readonly chartValue?: Id;
  readonly calcs?: Readonly<Record<Id, CalcFn>>;
}
export interface DbViewsData { readonly views?: readonly DbView[]; readonly activeView?: Id }

const DEFAULT_VIEW: DbView = { id: 'default', name: '표', kind: 'table' };

export function dbViews(d: DatabaseData & DbViewsData): readonly DbView[] {
  return d.views?.length ? d.views : [DEFAULT_VIEW];
}
export function activeDbView(d: DatabaseData & DbViewsData): DbView {
  const vs = dbViews(d);
  return vs.find((v) => v.id === d.activeView) ?? vs[0]!;
}

/** 속성 타입별로 쓸 수 있는 조건 */
export function filterOps(p: DbProperty): FilterOp[] {
  switch (p.type) {
    case 'number': return ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'empty', 'notEmpty'];
    case 'select': case 'status': return ['is', 'isNot', 'empty', 'notEmpty'];
    case 'multiSelect': return ['contains', 'notContains', 'empty', 'notEmpty'];
    case 'date': case 'created': case 'edited': return ['is', 'before', 'after', 'empty', 'notEmpty'];
    case 'checkbox': return ['checked', 'unchecked'];
    case 'relation': case 'files': return ['empty', 'notEmpty'];
    case 'rollup': return [];
    default: return ['contains', 'notContains', 'is', 'isNot', 'empty', 'notEmpty'];
  }
}
export const FILTER_OP_LABEL: Record<FilterOp, string> = {
  contains: '포함', notContains: '포함 안 함', is: '같음', isNot: '같지 않음', empty: '비어 있음', notEmpty: '비어 있지 않음',
  eq: '=', ne: '≠', gt: '>', gte: '≥', lt: '<', lte: '≤', before: '이전', after: '이후', checked: '체크됨', unchecked: '체크 안 됨',
};
/** 값을 받지 않는 조건 */
export const opNeedsValue = (op: FilterOp) => !['empty', 'notEmpty', 'checked', 'unchecked'].includes(op);

const isEmpty = (v: DbValue | undefined) => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);

export function matchFilter(p: DbProperty, v: DbValue | undefined, f: DbFilter): boolean {
  if (f.op === 'empty') return isEmpty(v);
  if (f.op === 'notEmpty') return !isEmpty(v);
  if (f.op === 'checked') return v === true;
  if (f.op === 'unchecked') return v !== true;
  const want = f.value;
  if (want === undefined || want === null || want === '') return true; // 값을 아직 안 넣은 조건은 거르지 않는다
  switch (p.type) {
    case 'number': {
      const a = typeof v === 'number' ? v : NaN, b = Number(want);
      if (!Number.isFinite(a)) return f.op === 'ne';
      return f.op === 'eq' ? a === b : f.op === 'ne' ? a !== b : f.op === 'gt' ? a > b : f.op === 'gte' ? a >= b : f.op === 'lt' ? a < b : a <= b;
    }
    case 'select': case 'status': return f.op === 'is' ? v === want : v !== want;
    case 'multiSelect': { const has = Array.isArray(v) && v.includes(String(want)); return f.op === 'contains' ? has : !has; }
    case 'date': case 'created': case 'edited': {
      if (typeof v !== 'string' || !v) return false;
      const day = v.slice(0, 10); // 만든 때 · 고친 때는 시각까지 — 날짜로 견준다
      return f.op === 'is' ? day === want : f.op === 'before' ? day < String(want) : day > String(want);
    }
    default: {
      const a = String(v ?? '').toLowerCase(), b = String(want).toLowerCase();
      return f.op === 'contains' ? a.includes(b) : f.op === 'notContains' ? !a.includes(b) : f.op === 'is' ? a === b : a !== b;
    }
  }
}

function compareValues(p: DbProperty, a: DbValue | undefined, b: DbValue | undefined): number {
  const ea = isEmpty(a), eb = isEmpty(b);
  if (ea || eb) return ea && eb ? 0 : ea ? 1 : -1; // 빈 값은 늘 뒤로
  switch (p.type) {
    case 'number': return (a as number) - (b as number);
    case 'checkbox': return (a === true ? 1 : 0) - (b === true ? 1 : 0);
    case 'relation': case 'files': return (Array.isArray(a) ? a.length : 0) - (Array.isArray(b) ? b.length : 0);
    // 상태: 묶음(할 일 → 진행 중 → 완료) 차례, 같은 묶음 안은 옵션 차례
    case 'status': { const ix = (id: unknown) => { const i = p.options?.findIndex((o) => o.id === id) ?? -1; return STATUS_GROUPS.indexOf(optionGroup(p.options?.[i])) * 1000 + i; }; return ix(a) - ix(b); }
    case 'formula': return typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), 'ko', { numeric: true });
    case 'select': { const ix = (id: unknown) => p.options?.findIndex((o) => o.id === id) ?? -1; return ix(a) - ix(b); }
    case 'multiSelect': { const ix = (v: unknown) => (Array.isArray(v) ? Math.min(...v.map((id) => p.options?.findIndex((o) => o.id === id) ?? 99)) : 99); return ix(a) - ix(b); }
    default: return String(a).localeCompare(String(b), 'ko', { numeric: true });
  }
}

/** 뷰가 보여 줄 항목: 필터 → 정렬(여러 기준, 같으면 원래 순서) */
export function viewRows(d: DatabaseData, v: DbView): DbRow[] {
  const prop = (id: Id) => d.properties.find((p) => p.id === id);
  const fs = (v.filters ?? []).filter((f) => prop(f.propId));
  let rows = dbRows(d);
  if (fs.length) {
    const ok = (r: DbRow) => {
      const res = fs.map((f) => matchFilter(prop(f.propId)!, cellValue(d, r, prop(f.propId)!), f));
      return v.match === 'or' ? res.some(Boolean) : res.every(Boolean);
    };
    rows = rows.filter(ok);
  }
  const ss = (v.sorts ?? []).filter((s) => prop(s.propId));
  if (ss.length) {
    const idx = new Map(rows.map((r, i) => [r.id, i]));
    rows.sort((a, b) => {
      for (const s of ss) {
        const p = prop(s.propId)!;
        const va = cellValue(d, a, p), vb = cellValue(d, b, p); // 계산 속성(만든 때 · 고친 때 · 수식)도
        const ea = isEmpty(va), eb = isEmpty(vb);
        const c = compareValues(p, va, vb);
        if (c) return ea || eb ? c : s.dir === 'desc' ? -c : c;
      }
      return idx.get(a.id)! - idx.get(b.id)!;
    });
  }
  return rows;
}

/** 보드 기준 속성 (지정이 없으면 첫 선택 속성) · 캘린더 날짜 속성 (없으면 첫 날짜 속성) */
const boardable = (p: DbProperty) => p.type === 'select' || p.type === 'status';
export const boardProp = (d: DatabaseData, v: DbView) => d.properties.find((p) => p.id === v.groupBy && boardable(p)) ?? d.properties.find(boardable);
export const calendarProp = (d: DatabaseData, v: DbView) => d.properties.find((p) => p.id === v.dateProp && p.type === 'date') ?? d.properties.find((p) => p.type === 'date');
export const cardProps = (d: DatabaseData, v: DbView): DbProperty[] =>
  v.cardProps ? v.cardProps.map((id) => d.properties.find((p) => p.id === id)).filter((p): p is DbProperty => !!p) : d.properties.slice(1, 4).filter((p) => !p.hidden);

// ───────── 커맨드 ─────────

type ViewsFn = (views: DbView[], d: DatabaseContent & DbViewsData) => { views: DbView[]; activeView?: Id } | null;
function patchViews(tx: Tx, engine: Engine, cid: Id, fn: ViewsFn): void {
  const c = engine.getContent(cid);
  if (!isDatabaseContent(c)) return;
  const d = c as DatabaseContent & DbViewsData;
  const r = fn(dbViews(d).map((v) => ({ ...v })), d);
  if (!r) return;
  tx.set('content', cid, { views: r.views, activeView: r.activeView ?? activeDbView(d).id });
  // 보드 · 캘린더는 넓게 — 블록을 열 수만큼 넓힌다 (줄이지는 않는다)
  const now = r.views.find((x) => x.id === (r.activeView ?? activeDbView(d).id));
  if (now?.kind === 'board') widenBlock(tx, engine, d.blockId, 28 + ((boardProp(d, now)?.options?.length ?? 0) + 1) * 230);
  if (now?.kind === 'calendar') widenBlock(tx, engine, d.blockId, 28 + 7 * 96);
  if (now?.kind === 'timeline') widenBlock(tx, engine, d.blockId, 900);
}
const opt = (label: string) => ({ origin: 'user' as const, label });

export function addDbView(engine: Engine, cid: Id, kind: DbViewKind): TxResult<void> {
  return engine.transact((tx) => patchViews(tx, engine, cid, (views) => {
    const n = views.filter((v) => v.kind === kind).length;
    const v: DbView = { id: newId(), name: n ? `${DB_VIEW_LABEL[kind]} ${n + 1}` : DB_VIEW_LABEL[kind], kind };
    return { views: [...views, v], activeView: v.id };
  }), opt('뷰 추가'));
}
export function setActiveDbView(engine: Engine, cid: Id, viewId: Id): TxResult<void> {
  return engine.transact((tx) => patchViews(tx, engine, cid, (views, d) => (activeDbView(d).id === viewId || !views.some((v) => v.id === viewId) ? null : { views, activeView: viewId })), opt('뷰 바꾸기'));
}
/** 뷰 설정 바꾸기 (이름 · 필터 · 정렬 · 그룹 · 날짜 · 카드 속성) */
export function updateDbView(engine: Engine, cid: Id, viewId: Id, patch: Partial<Omit<DbView, 'id'>>, label = '뷰 설정'): TxResult<void> {
  return engine.transact((tx) => patchViews(tx, engine, cid, (views) => ({ views: views.map((v) => (v.id === viewId ? { ...v, ...patch } : v)) })), opt(label));
}
export function deleteDbView(engine: Engine, cid: Id, viewId: Id): TxResult<void> {
  return engine.transact((tx) => patchViews(tx, engine, cid, (views, d) => {
    if (views.length <= 1) return null;
    const rest = views.filter((v) => v.id !== viewId);
    return { views: rest, activeView: activeDbView(d).id === viewId ? rest[0]!.id : activeDbView(d).id };
  }), opt('뷰 삭제'));
}

/** 필터가 걸린 뷰에서 새 항목을 만들 때 미리 채울 값 — 만들자마자 사라지지 않게 (모두(and) 조건의 '같음 · 포함 · 체크'만) */
export function filterDefaults(d: DatabaseData, v: DbView): Record<Id, DbValue> {
  if (v.match === 'or') return {};
  const out: Record<Id, DbValue> = {};
  for (const f of v.filters ?? []) {
    const p = d.properties.find((x) => x.id === f.propId);
    if (!p) continue;
    if (f.op === 'checked') out[p.id] = true;
    else if (f.value === undefined || f.value === null || f.value === '') continue;
    else if (p.type === 'multiSelect' && f.op === 'contains') out[p.id] = [String(f.value)];
    else if ((f.op === 'is' && p.type !== 'multiSelect') || (f.op === 'contains' && (p.type === 'text' || p.type === 'url'))) out[p.id] = f.value;
    else if (f.op === 'eq' && p.type === 'number') out[p.id] = Number(f.value);
  }
  return out;
}
