// 데이터베이스 블록 (FR-055 · 056 · 057, 스키마 v5): 캔버스 위 블록 하나 안의 항목(행) × 속성(열).
// 블록 안에서는 캔버스 좌표가 아니라 행 · 열 구조를 따른다. 값은 속성 타입별로 저장하고(아래 DbValue), 타입을 바꾸면 변환 규칙으로 옮긴다.
// 변환할 수 없는 값은 버리지 않고 행의 `raw[속성 id]`에 원래 값을 남긴다 — 타입을 되돌리면 되살아난다.
// 지금은 행을 콘텐츠 레코드 안 배열로 둔다(동기화가 붙는 P5에서 DATABASE 3.3의 dbRows 엔티티로 나눈다). 모든 변경 = 트랜잭션 하나 = 실행 취소 한 번.
import type { Engine, TxResult } from './engine';
import type { Tx } from './tx';
import type { Vec2 } from './geom';
import { newId } from './id';
import type { Content, Id } from './model';
import { keyBetween, type OrderKey } from './order';
import { dropRelation, unlinkRows, type RollupFn } from './db-relations';
import { dbFiles, defaultStatusOptions, guessGroup, isComputedType, type StatusGroup } from './db-props';

/** relation · rollup (FR-062)은 만들 때 대상을 정해야 해서 타입 바꾸기 목록(DB_PROP_TYPES)에는 없다 — db-relations.ts */
export type DbPropType = 'text' | 'number' | 'select' | 'multiSelect' | 'status' | 'date' | 'checkbox' | 'url' | 'files' | 'formula' | 'created' | 'edited' | 'relation' | 'rollup';
export const DB_PROP_TYPES: readonly DbPropType[] = ['text', 'number', 'select', 'multiSelect', 'status', 'date', 'checkbox', 'url', 'files', 'formula', 'created', 'edited'];
export const DB_TYPE_LABEL: Record<DbPropType, string> = {
  text: '텍스트', number: '숫자', select: '선택', multiSelect: '다중 선택', status: '상태', date: '날짜', checkbox: '체크박스', url: 'URL', files: '파일',
  formula: '수식', created: '만든 때', edited: '고친 때', relation: '관계', rollup: '집계',
};
const isLinkType = (t: DbPropType) => t === 'relation' || t === 'rollup';
/** 선택 옵션 색 (블록 배경색과 같은 이름) */
export const DB_OPTION_COLORS = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'] as const;

/** group: 상태 속성의 묶음 (할 일 · 진행 중 · 완료 — db-props.ts) */
export interface DbOption { readonly id: Id; readonly name: string; readonly color: string; readonly group?: StatusGroup }
export interface DbProperty {
  readonly id: Id;
  readonly name: string;
  readonly type: DbPropType;
  readonly options?: readonly DbOption[];
  /** 열 너비 (px) */
  readonly width?: number;
  readonly hidden?: boolean;
  /** 날짜 속성 알림 (FR-136): 'HH:MM' — 항목마다 그 날짜 이 시각에 알림 */
  readonly remind?: string;
  /** 관계 (FR-062): 같은 노트의 데이터베이스 콘텐츠 id · 그쪽 짝 속성 id. 값 = 그쪽 항목 id[] */
  readonly relation?: { readonly db: Id; readonly pair: Id };
  /** 집계 (FR-062): 이 데이터베이스의 관계 속성 · 그쪽 속성 · 함수. 값은 저장하지 않고 계산 */
  readonly rollup?: { readonly relation: Id; readonly prop: Id; readonly fn: RollupFn };
  /** 수식 (GAP #19, db-formula.ts) */
  readonly formula?: string;
}
/** text · url: string, number: number | null, select: 옵션 id | null, multiSelect: 옵션 id[], date: 'YYYY-MM-DD', checkbox: boolean, relation: 항목 id[] */
export type DbValue = string | number | boolean | null | readonly string[];
export interface DbRow {
  readonly id: Id;
  readonly order: OrderKey;
  readonly values: Readonly<Record<Id, DbValue>>;
  /** 타입 변환으로 옮기지 못한 원래 값 */
  readonly raw?: Readonly<Record<Id, DbValue>>;
  /** 항목 페이지 노트 (FR-063) — 처음 열 때 만든 하위 노트 */
  readonly page?: Id;
  /** 만든 때 · 고친 때 (ms) — '만든 때' · '고친 때' 속성이 보인다 */
  readonly created?: number;
  readonly edited?: number;
}
export interface DatabaseData {
  readonly title?: string;
  readonly properties: readonly DbProperty[];
  readonly rows: readonly DbRow[];
  /** 새 항목 페이지를 만들 때 쓸 템플릿 id (FR-063) */
  readonly pageTemplate?: string;
}
export type DatabaseContent = Content & DatabaseData & { readonly type: 'database' };

export function isDatabaseContent(c: Content | undefined): c is DatabaseContent {
  return !!c && c.type === 'database' && Array.isArray((c as DatabaseContent).properties) && Array.isArray((c as DatabaseContent).rows);
}

export const dbRows = (d: DatabaseData): DbRow[] => [...d.rows].sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));

/** 새 데이터베이스: 이름 · 상태(선택) · 날짜, 빈 항목 셋 */
export function makeDatabase(title = ''): DatabaseData {
  const opts = [['할 일', 'gray'], ['진행 중', 'blue'], ['완료', 'green']].map(([name, color]) => ({ id: newId(), name: name!, color: color! }));
  const properties: DbProperty[] = [
    { id: newId(), name: '이름', type: 'text', width: 200 },
    { id: newId(), name: '상태', type: 'select', options: opts, width: 120 },
    { id: newId(), name: '날짜', type: 'date', width: 130 },
  ];
  let order: OrderKey | null = null;
  const rows = [0, 1, 2].map(() => { order = keyBetween(order, null); return { id: newId(), order, values: {} }; });
  return { title, properties, rows };
}

export function emptyValue(t: DbPropType): DbValue {
  return t === 'multiSelect' || t === 'relation' || t === 'files' ? [] : t === 'checkbox' ? false : t === 'number' || t === 'select' || t === 'status' || isComputedType(t) ? null : '';
}

/** 칸 글자 (검색 · 내보내기 · 텍스트 변환) */
export function dbCellText(p: DbProperty, v: DbValue | undefined): string {
  if (v === undefined || v === null) return '';
  const opt = (id: string) => p.options?.find((o) => o.id === id)?.name ?? '';
  switch (p.type) {
    // 관계 · 집계는 다른 데이터베이스를 봐야 한다 — dbCellTextIn(engine, …)
    case 'relation': case 'rollup': case 'formula': case 'created': case 'edited': return '';
    case 'select': case 'status': return typeof v === 'string' ? opt(v) : '';
    case 'files': return dbFiles(v).map((f) => f.name).join(', ');
    case 'multiSelect': return Array.isArray(v) ? v.map(opt).filter(Boolean).join(', ') : '';
    case 'checkbox': return v === true ? '예' : '';
    case 'number': return typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
    default: return typeof v === 'string' ? v : Array.isArray(v) ? v.join(', ') : String(v);
  }
}

const TRUE_WORDS = new Set(['true', 'yes', 'y', '1', 'x', 'o', '예', '네', '완료', '✓', '✔', 'v', 'done']);

/**
 * 타입 변환 규칙 (FR-056). 결과 값과, 새로 만들어야 할 선택 옵션.
 * - 글자로: 지금 보이는 글자 그대로 (선택 → 옵션 이름, 다중 → 쉼표로 이음, 체크 → 예)
 * - 숫자로: 글자에서 숫자를 읽음(쉼표 · 단위 무시), 체크 → 1 / 0. 못 읽으면 변환 불가
 * - 선택 · 다중 선택으로: 글자(다중은 쉼표로 나눔)와 같은 이름의 옵션, 없으면 만든다
 * - 날짜로: YYYY-MM-DD · YYYY.MM.DD · YYYY/MM/DD 를 읽음. 못 읽으면 변환 불가
 * - 체크박스로: 예 · yes · true · 1 · 완료 등은 체크, 숫자는 0이 아니면 체크
 * - URL로: 글자 그대로
 */
export function convertValue(v: DbValue | undefined, from: DbProperty, to: DbPropType, options: DbOption[]): { value: DbValue; lost: boolean } {
  const text = dbCellText(from, v).trim();
  if (!text && v !== 0) return { value: emptyValue(to), lost: false };
  const optionFor = (name: string) => {
    let o = options.find((x) => x.name === name);
    if (!o) { o = { id: newId(), name, color: DB_OPTION_COLORS[options.length % DB_OPTION_COLORS.length]!, ...(to === 'status' ? { group: guessGroup(name) } : {}) }; options.push(o); }
    return o.id;
  };
  switch (to) {
    case 'text': case 'url': return { value: text, lost: false };
    case 'number': {
      if (from.type === 'checkbox') return { value: v === true ? 1 : 0, lost: false };
      const n = Number(text.replace(/[,\s]/g, '').replace(/[^\d.eE+-]+$/, '').replace(/^[^\d.+-]+/, ''));
      return Number.isFinite(n) && /\d/.test(text) ? { value: n, lost: false } : { value: null, lost: true };
    }
    case 'select': case 'status': return { value: optionFor(text.split(',')[0]!.trim()), lost: false };
    case 'multiSelect': return { value: [...new Set(text.split(',').map((s) => s.trim()).filter(Boolean).map(optionFor))], lost: false };
    case 'date': {
      const m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/.exec(text);
      return m ? { value: `${m[1]}-${m[2]!.padStart(2, '0')}-${m[3]!.padStart(2, '0')}`, lost: false } : { value: '', lost: true };
    }
    case 'checkbox': return { value: from.type === 'number' ? Number(v) !== 0 : TRUE_WORDS.has(text.toLowerCase()), lost: false };
    // 관계 · 집계로는 바꾸지 않는다 (setDbPropertyType이 막는다)
    // 파일은 글자에서 만들 수 없고, 계산 속성은 값을 갖지 않는다 — 원래 값은 raw에 남아 되돌리면 살아난다
    case 'files': case 'formula': case 'created': case 'edited': case 'relation': case 'rollup': return { value: emptyValue(to), lost: true };
  }
}

// ───────── 커맨드 ─────────

type Patch = (d: DatabaseContent) => Partial<DatabaseData> | null;

/** 표가 들어갈 블록 너비: 손잡이 칸 + 보이는 열 + 속성 추가 칸 + 블록 안쪽 여백 (db-view · db.css와 같은 값) */
export function dbTableWidth(props: readonly DbProperty[]): number {
  return 22 + props.filter((p) => !p.hidden).reduce((w, p) => w + (p.width ?? 140), 0) + 32 + 28;
}

/** 데이터베이스 콘텐츠 고치기 (트랜잭션 안에서) — 열이 바뀌면 블록 너비도 맞춘다 */
function patchDb(tx: Tx, engine: Engine, contentId: Id, fn: Patch): void {
  const c = engine.getContent(contentId);
  if (!isDatabaseContent(c)) return;
  const patch = fn(c);
  if (!patch) return;
  tx.set('content', contentId, patch as Record<string, unknown>);
  // 열이 늘면 블록도 넓힌다 (줄이지는 않는다) — 캔버스에서 휠은 화면 이동이라 표 안 가로 스크롤에 기대지 않는다
  if (patch.properties) widen(tx, engine, c.blockId, patch.properties);
}
function widen(tx: Tx, engine: Engine, blockId: Id, props: readonly DbProperty[]): void { widenBlock(tx, engine, blockId, dbTableWidth(props)); }
/** 블록을 w 이상으로 (줄이지는 않는다) */
export function widenBlock(tx: Tx, engine: Engine, blockId: Id, w: number): void {
  const b = engine.getBlock(blockId);
  if (b && b.w < w) tx.set('block', blockId, { w: Math.round(w) });
}
const mapProp = (d: DatabaseData, id: Id, f: (p: DbProperty) => DbProperty) => d.properties.map((p) => (p.id === id ? f(p) : p));
const mapRow = (d: DatabaseData, id: Id, f: (r: DbRow) => DbRow) => d.rows.map((r) => (r.id === id ? f(r) : r));

/** 데이터베이스 블록 만들기 (슬래시 메뉴 · 도구) — 결과: 블록 id */
export function createDatabaseBlock(engine: Engine, at: Vec2, title = ''): TxResult<Id> {
  return engine.transact((tx) => {
    const data = makeDatabase(title);
    const b = tx.createBlock({ x: at.x, y: at.y, w: dbTableWidth(data.properties), h: 180 });
    tx.createContent({ blockId: b, type: 'database', ...data } as never);
    return b;
  }, { origin: 'user', label: '데이터베이스 만들기' });
}

export function setDbTitle(engine: Engine, cid: Id, title: string): TxResult<void> {
  return engine.transact((tx) => patchDb(tx, engine, cid, (d) => (d.title === title ? null : { title })), { origin: 'user', label: '데이터베이스 이름' });
}

export function setDbValue(engine: Engine, cid: Id, rowId: Id, propId: Id, value: DbValue): TxResult<void> {
  return engine.transact((tx) => patchDb(tx, engine, cid, (d) => {
    const r = d.rows.find((x) => x.id === rowId);
    if (!r || JSON.stringify(r.values[propId] ?? null) === JSON.stringify(value)) return null;
    return { rows: mapRow(d, rowId, (x) => { const raw = { ...x.raw }; delete raw[propId]; return { ...x, values: { ...x.values, [propId]: value }, ...(x.raw ? { raw } : {}), edited: Date.now() }; }) };
  }), { origin: 'user', label: '항목 값 바꾸기' });
}

/** 항목 추가: after(그 항목 바로 뒤) · 없으면 맨 끝. 결과: 새 항목 id */
export function addDbRow(engine: Engine, cid: Id, after?: Id | null, values: Record<Id, DbValue> = {}): TxResult<Id | null> {
  return engine.transact((tx) => {
    const c = engine.getContent(cid);
    if (!isDatabaseContent(c)) return null;
    const rows = dbRows(c);
    const i = after ? rows.findIndex((r) => r.id === after) : rows.length - 1;
    const id = newId();
    const order = keyBetween(rows[i]?.order ?? null, rows[i + 1]?.order ?? null);
    const now = Date.now();
    tx.set('content', cid, { rows: [...c.rows, { id, order, values, created: now, edited: now }] });
    return id;
  }, { origin: 'user', label: '항목 추가' });
}

export function deleteDbRows(engine: Engine, cid: Id, ids: readonly Id[]): TxResult<void> {
  return engine.transact((tx) => {
    unlinkRows(tx, engine, cid, ids); // 관계로 이어진 저쪽 항목에서도 뺀다 (FR-062)
    patchDb(tx, engine, cid, (d) => ({ rows: d.rows.filter((r) => !ids.includes(r.id)) }));
  }, { origin: 'user', label: '항목 삭제' });
}

/** 항목 순서 바꾸기: before 앞으로 (null이면 맨 끝). values: 보드에서 다른 묶음으로 옮길 때 함께 바꿀 값 (한 번에 실행 취소) */
export function moveDbRow(engine: Engine, cid: Id, rowId: Id, before: Id | null, values?: Record<Id, DbValue>): TxResult<void> {
  return engine.transact((tx) => patchDb(tx, engine, cid, (d) => {
    const rows = dbRows(d).filter((r) => r.id !== rowId);
    const j = before ? rows.findIndex((r) => r.id === before) : rows.length;
    if (j < 0) return null;
    const order = keyBetween(rows[j - 1]?.order ?? null, rows[j]?.order ?? null);
    return { rows: mapRow(d, rowId, (r) => ({ ...r, order, ...(values ? { values: { ...r.values, ...values }, edited: Date.now() } : {}) })) };
  }), { origin: 'user', label: values ? '카드 옮기기' : '항목 순서 바꾸기' });
}

export function addDbProperty(engine: Engine, cid: Id, type: DbPropType = 'text', name?: string): TxResult<Id | null> {
  return engine.transact((tx) => {
    const c = engine.getContent(cid);
    if (!isDatabaseContent(c)) return null;
    const id = newId();
    let n = name ?? DB_TYPE_LABEL[type];
    for (let k = 2; !name && c.properties.some((p) => p.name === n); k++) n = `${DB_TYPE_LABEL[type]} ${k}`;
    const properties = [...c.properties, { id, name: n, type, width: 140, ...(type === 'select' || type === 'multiSelect' ? { options: [] } : type === 'status' ? { options: defaultStatusOptions() } : type === 'formula' ? { formula: '' } : {}) }];
    tx.set('content', cid, { properties });
    widen(tx, engine, c.blockId, properties);
    return id;
  }, { origin: 'user', label: '속성 추가' });
}

export function renameDbProperty(engine: Engine, cid: Id, propId: Id, name: string): TxResult<void> {
  const n = name.trim();
  return engine.transact((tx) => patchDb(tx, engine, cid, (d) => (n ? { properties: mapProp(d, propId, (p) => ({ ...p, name: n })) } : null)), { origin: 'user', label: '속성 이름 바꾸기' });
}

/** 속성 삭제 — 첫 속성(항목 이름)은 지우지 않는다. 값도 함께 지운다 */
export function deleteDbProperty(engine: Engine, cid: Id, propId: Id): TxResult<void> {
  return engine.transact((tx) => {
    const d0 = engine.getContent(cid);
    if (!isDatabaseContent(d0) || d0.properties[0]?.id === propId) return;
    // 관계면 저쪽 짝 속성도, 이 관계를 쓰는 집계도 함께 (FR-062)
    const drop = new Set([propId, ...dropRelation(tx, engine, cid, propId)]);
    patchDb(tx, engine, cid, (d) => {
      const strip = (o?: Readonly<Record<Id, DbValue>>) => { if (!o) return o; const x = { ...o }; for (const k of drop) delete x[k]; return x; };
      return { properties: d.properties.filter((p) => !drop.has(p.id)), rows: d.rows.map((r) => ({ ...r, values: strip(r.values)!, ...(r.raw ? { raw: strip(r.raw) } : {}) })) };
    });
  }, { origin: 'user', label: '속성 삭제' });
}

/** 속성 순서: to 번째 자리로 (첫 자리는 항목 이름 고정) */
export function moveDbProperty(engine: Engine, cid: Id, propId: Id, to: number): TxResult<void> {
  return engine.transact((tx) => patchDb(tx, engine, cid, (d) => {
    const i = d.properties.findIndex((p) => p.id === propId);
    if (i <= 0) return null;
    const ps = [...d.properties];
    const [p] = ps.splice(i, 1);
    ps.splice(Math.max(1, Math.min(ps.length, to)), 0, p!);
    return { properties: ps };
  }), { origin: 'user', label: '속성 순서 바꾸기' });
}

export function setDbPropertyWidth(engine: Engine, cid: Id, propId: Id, width: number): TxResult<void> {
  const w = Math.round(Math.max(60, Math.min(800, width)));
  return engine.transact((tx) => patchDb(tx, engine, cid, (d) => ({ properties: mapProp(d, propId, (p) => ({ ...p, width: w })) })), { origin: 'user', label: '열 너비' });
}

/** 날짜 속성 알림 시각 (FR-136) — null이면 끈다 */
export function setDbPropertyRemind(engine: Engine, cid: Id, propId: Id, time: string | null): TxResult<void> {
  const v = time && /^\d{2}:\d{2}$/.test(time) ? time : undefined;
  return engine.transact((tx) => patchDb(tx, engine, cid, (d) => ({ properties: mapProp(d, propId, (p) => (p.type === 'date' ? { ...p, remind: v } : p)) })), { origin: 'user', label: v ? '날짜 알림' : '날짜 알림 끄기' });
}

export function setDbPropertyHidden(engine: Engine, cid: Id, propId: Id, hidden: boolean): TxResult<void> {
  return engine.transact((tx) => patchDb(tx, engine, cid, (d) => (d.properties[0]?.id === propId && hidden ? null : { properties: mapProp(d, propId, (p) => ({ ...p, hidden })) })), { origin: 'user', label: hidden ? '열 숨기기' : '열 보이기' });
}

/** 속성 타입 바꾸기 — 모든 항목 값을 변환 규칙으로 옮기고, 못 옮긴 값은 raw에 남긴다(되돌리면 raw에서 먼저 되살림) */
export function setDbPropertyType(engine: Engine, cid: Id, propId: Id, type: DbPropType): TxResult<void> {
  return engine.transact((tx) => patchDb(tx, engine, cid, (d) => {
    const p = d.properties.find((x) => x.id === propId);
    if (!p || p.type === type || isLinkType(p.type) || isLinkType(type) || (d.properties[0]?.id === propId && type !== 'text' && type !== 'url' && type !== 'number')) return null;
    // 상태로: 선택 옵션은 이름으로 묶음을 짐작해 그대로, 옵션이 없으면 기본 셋
    const options = [...(type === 'select' || type === 'multiSelect' ? p.options ?? [] : type === 'status' ? (p.options?.length ? p.options.map((o) => ({ ...o, group: o.group ?? guessGroup(o.name) })) : defaultStatusOptions()) : [])];
    const rows = d.rows.map((r) => {
      const prev = r.raw?.[propId];
      const src = prev !== undefined && prev !== null && prev !== '' ? { v: prev, from: { ...p, type: rawType(prev) } } : { v: r.values[propId], from: p };
      const { value, lost } = convertValue(src.v, src.from, type, options);
      const raw = { ...r.raw };
      if (lost) raw[propId] = src.v ?? null; else delete raw[propId];
      const { raw: _old, ...rest } = r;
      return { ...rest, values: { ...r.values, [propId]: value }, ...(Object.keys(raw).length ? { raw } : {}) };
    });
    const np: DbProperty = { id: p.id, name: p.name, type, ...(p.width ? { width: p.width } : {}), ...(p.hidden ? { hidden: true } : {}), ...(options.length || type === 'select' || type === 'multiSelect' || type === 'status' ? { options } : {}), ...(type === 'formula' ? { formula: p.formula ?? '' } : {}) };
    return { properties: mapProp(d, propId, () => np), rows };
  }), { origin: 'user', label: '속성 타입 바꾸기' });
}
const rawType = (v: DbValue): DbPropType => (typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'checkbox' : 'text');

// 선택 옵션 (FR-056 "옵션 목록과 색상 관리")
export function addDbOption(engine: Engine, cid: Id, propId: Id, name: string, color?: string): TxResult<Id | null> {
  return engine.transact((tx) => {
    const c = engine.getContent(cid);
    const p = isDatabaseContent(c) ? c.properties.find((x) => x.id === propId) : undefined;
    const n = name.trim();
    if (!c || !isDatabaseContent(c) || !p || !n) return null;
    const hit = p.options?.find((o) => o.name === n);
    if (hit) return hit.id;
    const id = newId();
    const opts = p.options ?? [];
    tx.set('content', cid, { properties: mapProp(c, propId, (x) => ({ ...x, options: [...opts, { id, name: n, color: color ?? DB_OPTION_COLORS[opts.length % DB_OPTION_COLORS.length]!, ...(p.type === 'status' ? { group: guessGroup(n) } : {}) }] })) });
    return id;
  }, { origin: 'user', label: '옵션 추가' });
}

export function updateDbOption(engine: Engine, cid: Id, propId: Id, optionId: Id, patch: { name?: string; color?: string; group?: StatusGroup }): TxResult<void> {
  return engine.transact((tx) => patchDb(tx, engine, cid, (d) => ({
    properties: mapProp(d, propId, (p) => ({ ...p, options: (p.options ?? []).map((o) => (o.id === optionId ? { ...o, ...patch, ...(patch.name !== undefined ? { name: patch.name.trim() || o.name } : {}) } : o)) })),
  })), { origin: 'user', label: '옵션 바꾸기' });
}

/** 옵션 삭제 — 그 옵션을 고른 값도 비운다 */
export function deleteDbOption(engine: Engine, cid: Id, propId: Id, optionId: Id): TxResult<void> {
  return engine.transact((tx) => patchDb(tx, engine, cid, (d) => ({
    properties: mapProp(d, propId, (p) => ({ ...p, options: (p.options ?? []).filter((o) => o.id !== optionId) })),
    rows: d.rows.map((r) => {
      const v = r.values[propId];
      if (v === optionId) return { ...r, values: { ...r.values, [propId]: null } };
      if (Array.isArray(v) && v.includes(optionId)) return { ...r, values: { ...r.values, [propId]: v.filter((x) => x !== optionId) } };
      return r;
    }),
  })), { origin: 'user', label: '옵션 삭제' });
}

/** 항목 페이지 연결 (FR-063) */
export function setDbRowPage(engine: Engine, cid: Id, rowId: Id, noteId: Id | null): TxResult<void> {
  return engine.transact((tx) => patchDb(tx, engine, cid, (d) => ({
    rows: mapRow(d, rowId, (r) => { const { page: _p, ...rest } = r; return noteId ? { ...rest, page: noteId } : rest; }),
  })), { origin: 'user', label: '항목 페이지' });
}

/** 항목 페이지 템플릿 (없으면 빈 페이지) */
export function setDbPageTemplate(engine: Engine, cid: Id, templateId: string | null): TxResult<void> {
  return engine.transact((tx) => patchDb(tx, engine, cid, () => ({ pageTemplate: templateId ?? undefined })), { origin: 'user', label: '항목 템플릿' });
}
