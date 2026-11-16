// 데이터베이스 보기 더하기 (GAP #20 — 노션 열 계산 · 타임라인 · 차트): 표 아래 열마다 계산(개수 · 합 · 평균 · 체크 비율 …),
// 타임라인(시작 · 끝 날짜로 가로 막대), 차트(묶음별 개수 · 합 막대). 계산은 지금 보기(필터 뒤 항목)로 — 저장하는 것은 뷰 설정뿐.
import { dbFiles, cellValue, optionGroup } from './db-props';
import type { DatabaseData, DbProperty, DbRow, DbValue } from './database';

export type CalcFn = 'count' | 'empty' | 'unique' | 'filled' | 'sum' | 'avg' | 'median' | 'min' | 'max' | 'range' | 'checked' | 'unchecked' | 'checkedPct' | 'earliest' | 'latest' | 'donePct';
export const CALC_LABEL: Record<CalcFn, string> = {
  count: '값 있는 수', empty: '빈 칸 수', unique: '서로 다른 값', filled: '채운 비율', sum: '합계', avg: '평균', median: '가운데 값', min: '최소', max: '최대', range: '범위',
  checked: '체크된 수', unchecked: '체크 안 된 수', checkedPct: '체크 비율', earliest: '가장 이른', latest: '가장 늦은', donePct: '완료 비율',
};

/** 속성 타입별로 고를 수 있는 계산 */
export function calcOptions(p: DbProperty): CalcFn[] {
  const base: CalcFn[] = ['count', 'empty', 'unique', 'filled'];
  switch (p.type) {
    case 'number': case 'rollup': return [...base, 'sum', 'avg', 'median', 'min', 'max', 'range'];
    case 'checkbox': return ['checked', 'unchecked', 'checkedPct'];
    case 'date': case 'created': case 'edited': return [...base, 'earliest', 'latest'];
    case 'status': return [...base, 'donePct'];
    default: return base;
  }
}

const blank = (v: DbValue | undefined) => v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length);
const fmt = (n: number) => (Number.isInteger(n) ? n.toLocaleString('ko-KR') : (Math.round(n * 100) / 100).toLocaleString('ko-KR'));
const pct = (a: number, b: number) => `${b ? Math.round((a / b) * 100) : 0}%`;

/** 열 계산 글자 (빈 결과는 '—') */
export function columnCalc(d: DatabaseData, rows: readonly DbRow[], p: DbProperty, fn: CalcFn): string {
  const vs = rows.map((r) => cellValue(d, r, p));
  const filled = vs.filter((v) => !blank(v));
  switch (fn) {
    case 'count': return fmt(filled.length);
    case 'empty': return fmt(vs.length - filled.length);
    case 'filled': return pct(filled.length, vs.length);
    case 'unique': return fmt(new Set(filled.map((v) => (Array.isArray(v) ? [...v].sort().join('|') : String(v)))).size);
    case 'checked': return fmt(vs.filter((v) => v === true).length);
    case 'unchecked': return fmt(vs.filter((v) => v !== true).length);
    case 'checkedPct': return pct(vs.filter((v) => v === true).length, vs.length);
    case 'donePct': return pct(vs.filter((v) => optionGroup(p.options?.find((o) => o.id === v)) === 'done' && !blank(v)).length, vs.length);
    case 'earliest': case 'latest': {
      const ds = filled.map(String).sort();
      return ds.length ? (fn === 'earliest' ? ds[0]! : ds.at(-1)!) : '—';
    }
    default: {
      const ns = filled.filter((v): v is number => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
      if (!ns.length) return '—';
      const sum = ns.reduce((s, x) => s + x, 0);
      const mid = ns.length % 2 ? ns[(ns.length - 1) / 2]! : (ns[ns.length / 2 - 1]! + ns[ns.length / 2]!) / 2;
      return fmt(fn === 'sum' ? sum : fn === 'avg' ? sum / ns.length : fn === 'median' ? mid : fn === 'min' ? ns[0]! : fn === 'max' ? ns.at(-1)! : ns.at(-1)! - ns[0]!);
    }
  }
}

// ───────── 타임라인 ─────────

const DAY = 86400000;
export const dayIndex = (s: string) => Math.round(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / DAY);
export const dayString = (i: number) => new Date(i * DAY).toISOString().slice(0, 10);

export interface TimelineBar { readonly row: DbRow; readonly start: number; readonly end: number }
/** 시작(날짜 속성) · 끝(있으면, 시작보다 앞이면 시작) — 날 번호. 날짜 없는 항목은 수만 */
export function timelineBars(d: DatabaseData, rows: readonly DbRow[], startProp: DbProperty, endProp?: DbProperty): { bars: TimelineBar[]; undated: number } {
  const bars: TimelineBar[] = [];
  let undated = 0;
  for (const r of rows) {
    const s = cellValue(d, r, startProp);
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(s)) { undated++; continue; }
    const e = endProp ? cellValue(d, r, endProp) : null;
    const a = dayIndex(s), b = typeof e === 'string' && /^\d{4}-\d{2}-\d{2}/.test(e) ? dayIndex(e) : a;
    bars.push({ row: r, start: a, end: Math.max(a, b) });
  }
  return { bars, undated };
}

// ───────── 차트 ─────────

export interface ChartBar { readonly key: string; readonly label: string; readonly value: number; readonly color?: string }
/** 묶음별 값: 선택 · 상태 · 다중 선택(옵션마다) · 체크박스(예 · 아니요), 값은 개수 또는 숫자 속성 합 */
export function chartBars(d: DatabaseData, rows: readonly DbRow[], by: DbProperty, sumOf?: DbProperty): ChartBar[] {
  const add = new Map<string, number>();
  const val = (r: DbRow) => { if (!sumOf) return 1; const v = cellValue(d, r, sumOf); return typeof v === 'number' && Number.isFinite(v) ? v : 0; };
  for (const r of rows) {
    const v = cellValue(d, r, by);
    const keys = by.type === 'checkbox' ? [v === true ? 'yes' : 'no'] : by.type === 'files' ? [dbFiles(v).length ? 'yes' : 'no']
      : Array.isArray(v) ? (v.length ? v.map(String) : ['']) : [blank(v) ? '' : String(v)];
    for (const k of keys) add.set(k, (add.get(k) ?? 0) + val(r));
  }
  const out: ChartBar[] = [];
  if (by.type === 'checkbox') for (const [k, label] of [['yes', '예'], ['no', '아니요']] as const) { if (add.has(k)) out.push({ key: k, label, value: add.get(k)! }); }
  else if (by.options) {
    for (const o of by.options) if (add.has(o.id)) out.push({ key: o.id, label: o.name, value: add.get(o.id)!, color: o.color });
  } else for (const [k, v] of add) if (k) out.push({ key: k, label: k, value: v });
  if (add.has('')) out.push({ key: '', label: '없음', value: add.get('')! });
  return out;
}

/** 차트로 묶을 수 있는 속성 */
export const chartable = (p: DbProperty) => p.type === 'select' || p.type === 'status' || p.type === 'multiSelect' || p.type === 'checkbox' || p.type === 'text';
