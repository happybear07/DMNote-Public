// 한 필드에 모아 둔 목록 (SYNC 21.2 OD-10): 묶음 정보(note.groups) · 블록 댓글(block.comments) · 데이터베이스 열 · 행(content.properties · rows).
// 통째로 한 값이면 두 기기가 서로 다른 항목을 동시에 고쳤을 때 한쪽만 남는다(필드 단위 LWW).
// 그래서 Y에서는 항목마다 엔티티 맵에 키 하나 — `필드/항목key` → 항목 Y.Map(항목 필드 → 값) — 를 둔다. 항목 · 항목 필드 단위로 병합된다.
// 모음을 담는 그릇을 따로 만들지 않는 이유: 비어 있던 필드에 두 기기가 동시에 첫 항목을 넣으면 그릇 둘이 같은 키를 다퉈 한쪽 그릇이 통째로 진다.
// 순서 있는 목록은 항목 안 '#pos'(분수 위치 키, 같으면 id 순)로 정한다. 데이터베이스 행의 values · raw는 한 단계 더(칸 단위).
// 읽을 때는 엔진이 쓰는 모양(배열 · 레코드) 그대로. 예전 기록(필드에 평범한 값)도 읽고, 다음에 쓸 때 항목 키로 바꾼다.
import * as Y from 'yjs';
import { compareKey, keysBetween, sameValue, type EntityKind } from '@dn/engine-core';

export type FieldKind = EntityKind | 'note';
interface Spec { readonly list: boolean; readonly deep?: readonly string[]; readonly emptyUndefined: boolean }

const SPECS: Partial<Record<FieldKind, Record<string, Spec>>> = {
  note: { groups: { list: false, emptyUndefined: true } },
  block: { comments: { list: true, emptyUndefined: true } },
  content: {
    properties: { list: true, emptyUndefined: false },
    rows: { list: true, deep: ['values', 'raw'], emptyUndefined: false },
  },
};

const POS = '#pos';
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const specOf = (kind: FieldKind, field: string): Spec | undefined => SPECS[kind]?.[field];

/** 이 값을 항목 키로 둘 수 있나 (목록은 id 있는 객체 배열, 레코드는 객체의 객체) */
function fits(spec: Spec, v: unknown): boolean {
  if (spec.list) return Array.isArray(v) && v.every((x) => isObj(x) && typeof x.id === 'string' && !x.id.includes('/'));
  return isObj(v) && Object.entries(v).every(([k, x]) => isObj(x) && !k.includes('/'));
}

/** 엔티티 맵 키 → (필드, 항목 key). 항목 키가 아니면 null */
function splitKey(kind: FieldKind, key: string): { field: string; item: string } | null {
  const i = key.indexOf('/');
  if (i <= 0) return null;
  const field = key.slice(0, i);
  return specOf(kind, field) ? { field, item: key.slice(i + 1) } : null;
}
const itemKeys = (m: Y.Map<unknown>, field: string): string[] => [...m.keys()].filter((k) => k.startsWith(`${field}/`) && m.get(k) instanceof Y.Map);

// ───────── 쓰기 ─────────

function writeDeep(im: Y.Map<unknown>, field: string, v: unknown): void {
  const d = im.get(field);
  if (!isObj(v)) { if (!sameValue(d instanceof Y.Map ? readDeep(d) : d, v)) { if (v === undefined) im.delete(field); else im.set(field, structuredClone(v)); } return; }
  let dm = d;
  if (!(dm instanceof Y.Map)) { dm = new Y.Map<unknown>(); im.set(field, dm); }
  const m = dm as Y.Map<unknown>;
  for (const k of [...m.keys()]) if (!(k in v)) m.delete(k);
  for (const [k, x] of Object.entries(v)) if (!sameValue(m.get(k), x)) m.set(k, structuredClone(x));
}

function writeItem(m: Y.Map<unknown>, key: string, item: Obj, spec: Spec, skipId: boolean, pos?: string): void {
  let im = m.get(key);
  if (!(im instanceof Y.Map)) { im = new Y.Map<unknown>(); m.set(key, im); }
  const y = im as Y.Map<unknown>;
  for (const k of [...y.keys()]) if (k !== POS && !(k in item)) y.delete(k);
  for (const [k, v] of Object.entries(item)) {
    if (skipId && k === 'id') continue;
    if (spec.deep?.includes(k)) writeDeep(y, k, v);
    else if (!sameValue(y.get(k), v)) y.set(k, structuredClone(v));
  }
  if (pos !== undefined && y.get(POS) !== pos) y.set(POS, pos);
}

/** 원하는 순서대로 위치 키를 정한다 — 순서가 그대로인 항목(가장 긴 증가 부분열)은 키를 두고, 새 항목 · 옮긴 항목만 이웃 사이 키를 받는다 */
function positions(m: Y.Map<unknown>, field: string, ids: readonly string[]): string[] {
  const cur = ids.map((id) => { const im = m.get(`${field}/${id}`); const p = im instanceof Y.Map ? im.get(POS) : undefined; return typeof p === 'string' ? p : null; });
  const rank = (i: number) => cur[i]!;
  const idx = ids.map((_, i) => i).filter((i) => cur[i] !== null);
  const keep = longestIncreasing(idx, (a, b) => compareKey(rank(a), rank(b)) || (ids[a]! < ids[b]! ? -1 : 1));
  const out: (string | null)[] = ids.map((_, i) => (keep.has(i) ? cur[i]! : null));
  for (let i = 0; i < ids.length; i++) {
    if (out[i] !== null) continue;
    const lo = i > 0 ? out[i - 1]! : null;
    let j = i + 1;
    while (j < ids.length && out[j] === null) j++;
    const hi = j < ids.length ? out[j]! : null;
    if (lo !== null && hi !== null && compareKey(lo, hi) >= 0) return keysBetween(null, null, ids.length); // 같은 키끼리 사이 — 새로 매긴다
    const fill = keysBetween(lo, hi, j - i);
    for (let k = 0; k < fill.length; k++) out[i + k] = fill[k]!;
  }
  return out as string[];
}

/** 가장 긴 증가 부분열 (cmp 기준)의 원소 집합 */
function longestIncreasing(xs: readonly number[], cmp: (a: number, b: number) => number): Set<number> {
  const tails: number[] = [], prev = new Map<number, number>();
  for (const x of xs) {
    let lo = 0, hi = tails.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cmp(tails[mid]!, x) < 0) lo = mid + 1; else hi = mid; }
    if (lo > 0) prev.set(x, tails[lo - 1]!);
    tails[lo] = x;
  }
  const out = new Set<number>();
  for (let x: number | undefined = tails[tails.length - 1]; x !== undefined; x = prev.get(x)) out.add(x);
  return out;
}

/**
 * 엔티티 Y.Map의 필드 하나를 v로 맞춘다. 항목 필드는 바뀐 항목 · 항목 필드만 쓰고, undefined면 항목을 지운다.
 * (값을 처음 넣는 엔티티도 이걸로 — 새 Y.Map에 써도 된다)
 */
export function writeField(m: Y.Map<unknown>, kind: FieldKind, field: string, v: unknown): void {
  const spec = specOf(kind, field);
  if (spec && (v === undefined || fits(spec, v))) {
    if (m.has(field)) m.delete(field); // 예전 기록의 통째 값
    const have = new Set(itemKeys(m, field));
    if (spec.list) {
      const list = (v ?? []) as Obj[];
      const ids = list.map((x) => String(x.id));
      const pos = positions(m, field, ids);
      list.forEach((x, i) => { const k = `${field}/${ids[i]}`; have.delete(k); writeItem(m, k, x, spec, true, pos[i]); });
    } else {
      for (const [k, x] of Object.entries((v ?? {}) as Record<string, Obj>)) { const key = `${field}/${k}`; have.delete(key); writeItem(m, key, x, spec, false); }
    }
    for (const k of have) m.delete(k);
    return;
  }
  if (spec) for (const k of itemKeys(m, field)) m.delete(k); // 항목으로 둘 수 없는 값 — 통째로
  if (v === undefined) { if (m.has(field)) m.delete(field); return; }
  const cur = m.get(field);
  if (!sameValue(cur instanceof Y.AbstractType ? cur.toJSON() : cur, v)) m.set(field, structuredClone(v));
}

// ───────── 읽기 ─────────

function readDeep(d: Y.Map<unknown>): Obj {
  const out: Obj = {};
  for (const k of [...d.keys()].sort()) out[k] = structuredClone(d.get(k));
  return out;
}

function readItem(im: Y.Map<unknown>, spec: Spec, id?: string): Obj {
  const out: Obj = id !== undefined ? { id } : {};
  for (const k of [...im.keys()].sort()) {
    if (k === POS) continue;
    const v = im.get(k);
    out[k] = v instanceof Y.Map && spec.deep?.includes(k) ? readDeep(v) : structuredClone(v);
  }
  return out;
}

function readItems(m: Y.Map<unknown>, field: string, spec: Spec): unknown {
  const keys = itemKeys(m, field);
  if (!keys.length) return spec.emptyUndefined ? undefined : spec.list ? [] : {};
  const n = field.length + 1;
  if (!spec.list) {
    const out: Record<string, Obj> = {};
    for (const k of keys.map((x) => x.slice(n)).sort()) out[k] = readItem(m.get(`${field}/${k}`) as Y.Map<unknown>, spec);
    return out;
  }
  const items = keys.map((k) => { const im = m.get(k) as Y.Map<unknown>; const p = im.get(POS); return { id: k.slice(n), im, pos: typeof p === 'string' ? p : null }; });
  items.sort((a, b) => (a.pos === null ? (b.pos === null ? 0 : 1) : b.pos === null ? -1 : compareKey(a.pos, b.pos)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return items.map((x) => readItem(x.im, spec, x.id));
}

/**
 * 엔티티 Y.Map → 엔진 레코드의 필드들 (id 빼고). 항목 키는 배열 · 레코드로 모으고, 비면 필드 없음.
 * text: 글 상자 doc(Y.XmlFragment) 읽기 — 다리가 넘긴다
 */
export function readFields(kind: FieldKind, m: Y.Map<unknown>, text: (f: Y.XmlFragment) => unknown): Obj {
  const out: Obj = {};
  const listed = new Set<string>();
  for (const [k, v] of m.entries()) {
    if (k.startsWith('_')) continue; // 예약 키(묘비 `_del:` — tombstone.ts)는 필드가 아니다
    const sk = splitKey(kind, k);
    if (sk) { listed.add(sk.field); continue; }
    out[k] = v instanceof Y.XmlFragment ? text(v) : v instanceof Y.AbstractType ? v.toJSON() : structuredClone(v);
  }
  for (const field of listed) {
    const v = readItems(m, field, specOf(kind, field)!);
    if (v === undefined) delete out[field]; else out[field] = v; // 항목 키가 예전 통째 값보다 우선
  }
  return out;
}

/** 엔티티 Y.Map에 있는 (논리) 필드 이름들 — 항목 키는 필드 이름 하나로 */
export function fieldNames(kind: FieldKind, m: Y.Map<unknown>): Set<string> {
  const out = new Set<string>();
  for (const k of m.keys()) if (!k.startsWith('_')) out.add(splitKey(kind, k)?.field ?? k);
  return out;
}

