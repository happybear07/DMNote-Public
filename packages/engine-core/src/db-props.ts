// 데이터베이스 속성 더하기 (GAP #19 — 노션 상태 · 수식 · 파일 · 만든 때 · 고친 때):
// - 상태: 선택처럼 옵션 하나, 옵션마다 묶음(할 일 · 진행 중 · 완료) — 보드 · 정렬이 묶음 차례를 따른다
// - 파일: 첨부 저장소의 해시 목록 ('해시:이름' 글자 — 값 형식(DbValue)을 넓히지 않으려고)
// - 만든 때 · 고친 때: 항목의 created · edited (항목 추가 · 값 바꾸기 때 적는다, 그 전 항목은 비어 있다)
// - 수식: db-formula.ts. 계산 속성(만든 때 · 고친 때 · 수식)은 값을 저장하지 않고 그릴 때 계산한다
import type { Engine, TxResult } from './engine';
import type { DatabaseContent, DatabaseData, DbOption, DbProperty, DbPropType, DbRow, DbValue } from './database';
import { isDatabaseContent } from './database';
import { evalFormula, FormulaError, formulaText, parseFormula, type FormulaValue } from './db-formula';
import type { Id } from './model';
import { newId } from './id';

export type StatusGroup = 'todo' | 'doing' | 'done';
export const STATUS_GROUPS: readonly StatusGroup[] = ['todo', 'doing', 'done'];
export const STATUS_GROUP_LABEL: Record<StatusGroup, string> = { todo: '할 일', doing: '진행 중', done: '완료' };

export function defaultStatusOptions(): DbOption[] {
  return [['시작 전', 'gray', 'todo'], ['진행 중', 'blue', 'doing'], ['완료', 'green', 'done']].map(([name, color, group]) => ({ id: newId(), name: name!, color: color!, group: group as StatusGroup }));
}
/** 옵션 이름으로 묶음 짐작 (선택 → 상태로 바꿀 때 · 새 옵션) */
export function guessGroup(name: string): StatusGroup {
  return /완료|끝|마침|done|complete|closed|닫힘/i.test(name) ? 'done' : /진행|하는 중|검토|doing|progress|review/i.test(name) ? 'doing' : 'todo';
}
export const optionGroup = (o: DbOption | undefined): StatusGroup => o?.group ?? 'todo';

/** 계산 속성 — 값을 저장하지 않는다 (집계 rollup 포함) */
export const isComputedType = (t: DbPropType) => t === 'created' || t === 'edited' || t === 'formula' || t === 'rollup';

export interface DbFile { readonly hash: string; readonly name: string }
export const fileValue = (f: DbFile) => `${f.hash}:${f.name}`;
export function dbFiles(v: DbValue | undefined): DbFile[] {
  if (!Array.isArray(v)) return [];
  return v.map((s) => { const i = s.indexOf(':'); return i > 0 ? { hash: s.slice(0, i), name: s.slice(i + 1) || '파일' } : null; }).filter((f): f is DbFile => !!f);
}

const pad = (n: number) => String(n).padStart(2, '0');
/** 'YYYY-MM-DD HH:MM' (없으면 빈 글자) */
export function stampText(ms: number | undefined): string {
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 칸 값 (필터 · 정렬 · 수식): 저장한 값, 만든 때 · 고친 때 · 수식은 계산 */
export function cellValue(d: DatabaseData, row: DbRow, p: DbProperty): DbValue {
  if (p.type === 'created') return stampText(row.created);
  if (p.type === 'edited') return stampText(row.edited ?? row.created);
  if (p.type === 'formula') { const r = formulaResult(d, row, p); return 'error' in r ? null : r.value; }
  return row.values[p.id] ?? null;
}

const parsed = new Map<string, ReturnType<typeof parseFormula> | FormulaError>();
/** 수식 계산 — 값 또는 오류 메시지 */
export function formulaResult(d: DatabaseData, row: DbRow, p: DbProperty, depth = 0): { value: FormulaValue } | { error: string } {
  const src = p.formula?.trim();
  if (!src) return { value: null };
  let tree = parsed.get(src);
  if (!tree) { try { tree = parseFormula(src); } catch (e) { tree = e instanceof FormulaError ? e : new FormulaError('수식을 읽을 수 없어요'); } if (parsed.size > 500) parsed.clear(); parsed.set(src, tree); }
  if (tree instanceof FormulaError) return { error: tree.message };
  if (depth > 6) return { error: '수식이 서로를 너무 깊이 불러요' };
  const t = tree;
  try {
    return { value: evalFormula(t, (name) => {
      const q = d.properties.find((x) => x.name === name);
      if (!q) throw new FormulaError(`없는 속성: ${name}`);
      if (q.id === p.id) throw new FormulaError('자기 자신은 부를 수 없어요');
      return formulaInput(d, row, q, depth + 1);
    }) };
  } catch (e) { return { error: e instanceof FormulaError ? e.message : '계산할 수 없어요' }; }
}

/** 수식 안에서 본 속성 값: 숫자 · 체크 그대로, 선택 · 상태는 옵션 이름, 다중 선택 · 파일은 쉼표로 이은 이름, 관계는 개수 */
function formulaInput(d: DatabaseData, row: DbRow, q: DbProperty, depth: number): FormulaValue {
  if (q.type === 'formula') { const r = formulaResult(d, row, q, depth); if ('error' in r) throw new FormulaError(`${q.name}: ${r.error}`); return r.value; }
  const v = cellValue(d, row, q);
  const opt = (id: unknown) => q.options?.find((o) => o.id === id)?.name ?? '';
  switch (q.type) {
    case 'number': return typeof v === 'number' ? v : null;
    case 'checkbox': return v === true;
    case 'select': case 'status': return opt(v);
    case 'multiSelect': return Array.isArray(v) ? v.map(opt).filter(Boolean).join(', ') : '';
    case 'files': return dbFiles(v).map((f) => f.name).join(', ');
    case 'relation': return Array.isArray(v) ? v.length : 0;
    case 'rollup': return null;
    default: return typeof v === 'string' ? v : v === null ? '' : String(v);
  }
}

/** 계산 속성 · 새 속성의 칸 글자 (db-relations dbCellTextIn이 부른다) */
export function extraCellText(d: DatabaseData, row: DbRow, p: DbProperty): string | null {
  if (p.type === 'created' || p.type === 'edited') return String(cellValue(d, row, p) ?? '');
  if (p.type === 'formula') { const r = formulaResult(d, row, p); return 'error' in r ? '#오류' : formulaText(r.value); }
  return null;
}

/** 수식 바꾸기 */
export function setDbFormula(engine: Engine, cid: Id, propId: Id, formula: string): TxResult<void> {
  return engine.transact((tx) => {
    const c = engine.getContent(cid);
    if (!isDatabaseContent(c) || !c.properties.some((p) => p.id === propId && p.type === 'formula')) return tx.fail('수식 속성이 아니에요');
    tx.set('content', cid, { properties: c.properties.map((p) => (p.id === propId ? { ...p, formula } : p)) });
  }, { origin: 'user', label: '수식 바꾸기' });
}

/** 항목에 파일 더하기 · 빼기 (값 바꾸기와 같이 고친 때를 적는다) */
export function dbFilesWith(c: DatabaseContent, rowId: Id, propId: Id, add: readonly DbFile[], remove?: string): string[] {
  const cur = dbFiles(c.rows.find((r) => r.id === rowId)?.values[propId]);
  return [...cur.filter((f) => f.hash !== remove), ...add.filter((f) => !cur.some((x) => x.hash === f.hash))].map(fileValue);
}
