// 관계 · 집계 속성 (FR-062): 같은 노트 안 다른 데이터베이스의 항목을 잇는다 — 양쪽에 짝 속성을 두고 한 트랜잭션으로 함께 고친다(양방향).
// 집계는 저장하지 않고 그릴 때 계산한다: 연결된 항목들의 그 속성 값 → 개수 · 합계 · 평균 · 최소 · 최대 · 체크 수 · 나열.
// 짝이 맞지 않으면(블록을 복사했거나 다른 노트에 붙임) 이쪽만 고친다 — 다른 데이터베이스를 잘못 고치지 않게.
import type { Engine, TxResult } from './engine';
import type { Tx } from './tx';
import { newId } from './id';
import type { Id } from './model';
import { dbCellText, dbRows, dbTableWidth, isDatabaseContent, widenBlock, type DatabaseContent, type DbProperty, type DbRow, type DbValue } from './database';
import { extraCellText } from './db-props';

export type RollupFn = 'count' | 'sum' | 'avg' | 'min' | 'max' | 'checked' | 'list';
export const ROLLUP_FNS: readonly RollupFn[] = ['count', 'sum', 'avg', 'min', 'max', 'checked', 'list'];
export const ROLLUP_LABEL: Record<RollupFn, string> = { count: '개수', sum: '합계', avg: '평균', min: '최소', max: '최대', checked: '체크된 수', list: '값 나열' };
/** 숫자 값이 있어야 하는 집계 */
export const rollupNeedsNumber = (fn: RollupFn) => fn === 'sum' || fn === 'avg' || fn === 'min' || fn === 'max';

const dbOf = (engine: Engine, cid: Id): DatabaseContent | null => { const c = engine.getContent(cid); return isDatabaseContent(c) ? c : null; };
const idsOf = (v: DbValue | undefined): Id[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** 같은 노트의 다른 데이터베이스 (관계 대상 고르기) */
export function relationTargets(engine: Engine, cid: Id): { id: Id; title: string }[] {
  const out: { id: Id; title: string }[] = [];
  for (const b of engine.blocks()) for (const c of engine.contentsOf(b.id)) if (isDatabaseContent(c) && c.id !== cid) out.push({ id: c.id, title: dbTitle(c) });
  return out;
}
export const dbTitle = (d: DatabaseContent) => d.title?.trim() || '제목 없는 데이터베이스';

/** 항목 이름 (첫 속성의 글자) */
export function dbRowName(d: DatabaseContent, row: DbRow): string {
  const p = d.properties[0];
  return (p ? dbCellText(p, row.values[p.id]) : '').trim() || '이름 없음';
}

function uniqueName(d: DatabaseContent, base: string): string {
  let n = base;
  for (let k = 2; d.properties.some((p) => p.name === n); k++) n = `${base} ${k}`;
  return n;
}

/** 짝 속성 — 저쪽 속성이 이쪽을 가리킬 때만 */
export function relationPair(engine: Engine, cid: Id, p: DbProperty): { b: DatabaseContent; pb: DbProperty } | null {
  if (p.type !== 'relation' || !p.relation) return null;
  const b = dbOf(engine, p.relation.db);
  const pb = b?.properties.find((x) => x.id === p.relation!.pair);
  return b && pb?.relation?.db === cid && pb.relation.pair === p.id ? { b, pb } : null;
}

/** 관계 속성 추가: 이쪽 · 저쪽에 짝 속성 (이름은 서로의 데이터베이스 이름). 결과: 이쪽 속성 id */
export function addDbRelation(engine: Engine, cid: Id, targetCid: Id, name?: string): TxResult<Id | null> {
  return engine.transact((tx) => {
    const a = dbOf(engine, cid), b = dbOf(engine, targetCid);
    if (!a || !b || cid === targetCid) return null;
    const pa = newId(), pb = newId();
    const propsA = [...a.properties, { id: pa, name: name?.trim() || uniqueName(a, dbTitle(b)), type: 'relation' as const, width: 180, relation: { db: targetCid, pair: pb } }];
    const propsB = [...b.properties, { id: pb, name: uniqueName(b, dbTitle(a)), type: 'relation' as const, width: 180, relation: { db: cid, pair: pa } }];
    tx.set('content', cid, { properties: propsA });
    tx.set('content', targetCid, { properties: propsB });
    widenBlock(tx, engine, a.blockId, dbTableWidth(propsA));
    widenBlock(tx, engine, b.blockId, dbTableWidth(propsB));
    return pa;
  }, { origin: 'user', label: '관계 추가' });
}

/** 관계 값: 이쪽 항목이 잇는 저쪽 항목들 = rowIds. 짝 속성 값도 함께 (한 번에 실행 취소) */
export function setDbRelation(engine: Engine, cid: Id, rowId: Id, propId: Id, rowIds: readonly Id[]): TxResult<void> {
  return engine.transact((tx) => {
    const a = dbOf(engine, cid);
    const p = a?.properties.find((x) => x.id === propId);
    const row = a?.rows.find((r) => r.id === rowId);
    if (!a || !p || p.type !== 'relation' || !row) return;
    const next = [...new Set(rowIds)], prev = idsOf(row.values[propId]);
    if (prev.length === next.length && prev.every((x, i) => x === next[i])) return;
    tx.set('content', cid, { rows: a.rows.map((r) => (r.id === rowId ? { ...r, values: { ...r.values, [propId]: next } } : r)) });
    const pair = relationPair(engine, cid, p);
    if (!pair) return;
    const add = new Set(next.filter((x) => !prev.includes(x))), del = new Set(prev.filter((x) => !next.includes(x)));
    tx.set('content', pair.b.id, {
      rows: pair.b.rows.map((r) => {
        if (!add.has(r.id) && !del.has(r.id)) return r;
        const cur = idsOf(r.values[pair.pb.id]).filter((x) => x !== rowId);
        return { ...r, values: { ...r.values, [pair.pb.id]: add.has(r.id) ? [...cur, rowId] : cur } };
      }),
    });
  }, { origin: 'user', label: '관계 바꾸기' });
}

/** 저쪽 데이터베이스들을 한 번에 고치기 — 같은 데이터베이스를 여러 관계가 가리켜도 고친 것이 겹쳐 쌓이게 */
function pending(engine: Engine) {
  const m = new Map<Id, { rows: DbRow[]; props: DbProperty[] }>();
  const of = (id: Id) => { let x = m.get(id); if (!x) { const d = dbOf(engine, id)!; x = { rows: [...d.rows], props: [...d.properties] }; m.set(id, x); } return x; };
  const flush = (tx: Tx) => { for (const [id, x] of m) tx.set('content', id, { rows: x.rows, properties: x.props }); };
  return { of, flush };
}

/** 항목을 지울 때 (deleteDbRows 안): 저쪽 짝 값에서 이 항목들을 뺀다 */
export function unlinkRows(tx: Tx, engine: Engine, cid: Id, ids: readonly Id[]): void {
  const a = dbOf(engine, cid);
  if (!a) return;
  const gone = new Set(ids), w = pending(engine);
  let any = false;
  for (const p of a.properties) {
    const pair = relationPair(engine, cid, p);
    if (!pair) continue;
    const x = w.of(pair.b.id);
    x.rows = x.rows.map((r) => { const cur = idsOf(r.values[pair.pb.id]), keep = cur.filter((id) => !gone.has(id)); if (keep.length === cur.length) return r; any = true; return { ...r, values: { ...r.values, [pair.pb.id]: keep } }; });
  }
  if (any) w.flush(tx);
}

/** 관계 속성을 지울 때 (deleteDbProperty 안): 저쪽 짝 속성과 그 짝을 쓰는 집계도 지운다. 이쪽에서 함께 지울 집계 id를 돌려준다 */
export function dropRelation(tx: Tx, engine: Engine, cid: Id, propId: Id): Id[] {
  const a = dbOf(engine, cid);
  const p = a?.properties.find((x) => x.id === propId);
  if (!a || !p || p.type !== 'relation') return [];
  const pair = relationPair(engine, cid, p);
  if (pair) {
    const pb = pair.pb.id;
    const strip = (v: Readonly<Record<Id, DbValue>>) => { const o = { ...v }; delete o[pb]; return o; };
    tx.set('content', pair.b.id, {
      properties: pair.b.properties.filter((x) => x.id !== pb && x.rollup?.relation !== pb),
      rows: pair.b.rows.map((r) => (r.values[pb] === undefined ? r : { ...r, values: strip(r.values) })),
    });
  }
  return a.properties.filter((x) => x.rollup?.relation === propId).map((x) => x.id);
}

// ───────── 집계 ─────────

/** 집계 속성 추가: 첫 관계 · 그쪽 이름 속성 · 개수로 시작 */
export function addDbRollup(engine: Engine, cid: Id, name = '집계'): TxResult<Id | null> {
  return engine.transact((tx) => {
    const a = dbOf(engine, cid);
    if (!a) return null;
    const rel = a.properties.find((x) => x.type === 'relation' && x.relation);
    const b = rel?.relation ? dbOf(engine, rel.relation.db) : null;
    const id = newId();
    const props = [...a.properties, { id, name: uniqueName(a, name), type: 'rollup' as const, width: 120, rollup: { relation: rel?.id ?? '', prop: b?.properties[0]?.id ?? '', fn: 'count' as RollupFn } }];
    tx.set('content', cid, { properties: props });
    widenBlock(tx, engine, a.blockId, dbTableWidth(props));
    return id;
  }, { origin: 'user', label: '집계 추가' });
}

/** 집계 설정 바꾸기 — 관계를 바꾸면 그쪽 첫 속성으로 */
export function setDbRollup(engine: Engine, cid: Id, propId: Id, patch: { relation?: Id; prop?: Id; fn?: RollupFn }): TxResult<void> {
  return engine.transact((tx) => {
    const a = dbOf(engine, cid);
    const p = a?.properties.find((x) => x.id === propId);
    if (!a || !p || p.type !== 'rollup') return;
    const cur = p.rollup ?? { relation: '', prop: '', fn: 'count' as RollupFn };
    const next = { ...cur, ...patch };
    if (patch.relation && patch.relation !== cur.relation && !patch.prop) {
      const rel = a.properties.find((x) => x.id === patch.relation);
      const b = rel?.relation ? dbOf(engine, rel.relation.db) : null;
      next.prop = b?.properties[0]?.id ?? '';
    }
    tx.set('content', cid, { properties: a.properties.map((x) => (x.id === propId ? { ...x, rollup: next } : x)) });
  }, { origin: 'user', label: '집계 설정' });
}

/** 집계 값 (저장하지 않음): 숫자 · 나열 글자, 셀 수 없으면 null */
export function rollupValue(engine: Engine, d: DatabaseContent, row: DbRow, p: DbProperty): number | string | null {
  const r = p.rollup;
  if (p.type !== 'rollup' || !r) return null;
  const rel = d.properties.find((x) => x.id === r.relation);
  const b = rel?.type === 'relation' && rel.relation ? dbOf(engine, rel.relation.db) : null;
  if (!rel || !b) return null;
  const ids = new Set(idsOf(row.values[rel.id]));
  const linked = dbRows(b).filter((x) => ids.has(x.id));
  if (r.fn === 'count') return linked.length;
  const tp = b.properties.find((x) => x.id === r.prop);
  if (!tp) return null;
  if (r.fn === 'checked') return linked.filter((x) => x.values[tp.id] === true).length;
  if (r.fn === 'list') return linked.map((x) => dbCellText(tp, x.values[tp.id])).filter(Boolean).join(', ');
  const nums = linked.map((x) => x.values[tp.id]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (!nums.length) return null;
  const sum = nums.reduce((s, v) => s + v, 0);
  return r.fn === 'sum' ? sum : r.fn === 'avg' ? sum / nums.length : r.fn === 'min' ? Math.min(...nums) : Math.max(...nums);
}

const fmtNum = (v: number) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100));

/** 칸 글자 — 관계는 연결된 항목 이름, 집계는 계산한 값 (검색 · 내보내기 · 카드 · 항목 페이지) */
export function dbCellTextIn(engine: Engine, d: DatabaseContent, row: DbRow, p: DbProperty): string {
  if (p.type === 'relation') {
    const b = p.relation ? dbOf(engine, p.relation.db) : null;
    if (!b) return '';
    return idsOf(row.values[p.id]).map((id) => b.rows.find((r) => r.id === id)).filter((r): r is DbRow => !!r).map((r) => dbRowName(b, r)).join(', ');
  }
  if (p.type === 'rollup') { const v = rollupValue(engine, d, row, p); return v === null ? '' : typeof v === 'number' ? fmtNum(v) : v; }
  return extraCellText(d, row, p) ?? dbCellText(p, row.values[p.id]);
}
