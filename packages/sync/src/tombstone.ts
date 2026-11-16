// 묘비 (SYNC.md 13.2, OD-1): 엔티티를 지울 때 Y 키를 지우지 않고 그 엔티티 맵에 `_del:<기기id>` → 묘비를 쓴다.
// 묘비에는 지운 기기가 그 순간 본 내용의 해시를 적는다. 그래서 "지운 쪽이 모르는 편집"을 Y 상태만으로 알 수 있다:
//   R1 내용 — 같은 삭제(tx)로 지운 엔티티 중 하나라도 지금 내용이 어느 묘비의 해시와도 다르면(= 지운 뒤 다른 곳이 고침)
//   R2 구조 — 지운 블록 · 콘텐츠를 부모로 가리키는, 묘비 없는 자식이 있으면(= 지운 뒤 다른 곳이 그 안에 더함)
// 이면 그 삭제 묶음은 보류(pending) — 묶음 전체가 살아 있고 충돌 표시가 붙는다. 아니면 지운 것(엔진에서 숨김).
// 키를 지우는 방식은 서버 실시간 동기화에서 편집을 잃는 순서가 있었다(13.2.1). 판정은 Y 상태만의 순수 함수라 모든 기기가 같다.
import * as Y from 'yjs';
import type { EntityKind } from '@dn/engine-core';
import { readFields } from './fields';
import { fragmentToDoc } from './text-y';

export const TOMB = '_del:';
export interface Tombstone { readonly v: 1; readonly tx: string; readonly at: number; readonly hash: string }

/** 내용 해시에서 뺄 필드 — 옮기기 · 크기 · 겹침 순서만 바꾼 것은 고침으로 보지 않는다(OD-2), conflict는 투영 */
const MASK: Partial<Record<EntityKind, readonly string[]>> = { block: ['x', 'y', 'w', 'h', 'z', 'conflict'], content: ['order'] };

const isTomb = (v: unknown): v is Tombstone => !!v && typeof v === 'object' && (v as Tombstone).v === 1 && typeof (v as Tombstone).tx === 'string';

export function tombstonesOf(m: Y.Map<unknown>): Tombstone[] {
  const out: Tombstone[] = [];
  for (const [k, v] of m.entries()) if (k.startsWith(TOMB) && isTomb(v)) out.push(v);
  return out;
}
export const hasTombstones = (m: Y.Map<unknown>): boolean => [...m.keys()].some((k) => k.startsWith(TOMB));
export function clearTombstones(m: Y.Map<unknown>): void { for (const k of [...m.keys()]) if (k.startsWith(TOMB)) m.delete(k); }

/** cyrb53 (시드 2개 = 106비트) — 동기 계산, 기기마다 같은 값 */
function cyrb53(s: string, seed: number): string {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
/** 키를 정렬해 직렬화 — 같은 내용이면 기기 · 읽는 순서와 상관없이 같은 문자열 (묘비 해시 · 동기화 파일 지문) */
export const canonical = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, (x as Record<string, unknown>)[k]])) : x));

/** 엔티티의 지금 내용 해시 (묘비 키 · 마스크 필드 제외) */
export function recordHash(kind: EntityKind, m: Y.Map<unknown>): string {
  const rec = readFields(kind, m, fragmentToDoc);
  for (const k of Object.keys(rec)) if (k.startsWith('_') || MASK[kind]?.includes(k)) delete rec[k];
  const s = canonical(rec);
  return cyrb53(s, 0) + cyrb53(s, 1);
}

/** 이 기기의 묘비를 쓴다 — 지금 내용 해시와 함께 */
export function writeTombstone(kind: EntityKind, m: Y.Map<unknown>, device: string, tx: string, at: number): void {
  const t: Tombstone = { v: 1, tx, at, hash: recordHash(kind, m) };
  m.set(TOMB + device, t);
}

const MAPS = { blocks: 'block', contents: 'content', arrows: 'arrow', strokes: 'stroke' } as const;
type MapName = keyof typeof MAPS;
interface Member { kind: EntityKind; id: string; m: Y.Map<unknown>; tombs: Tombstone[] }

/**
 * 한 번의 판정 동안 쓰는 Y 상태 색인 — 묘비가 있는 엔티티 · 삭제 묶음(tx) · 부모 → 자식.
 * 묘비가 있는 엔티티를 처음 물을 때만 문서를 한 번 훑는다(묘비가 없는 엔티티는 키만 보고 바로 답한다).
 */
export class Liveness {
  private built = false;
  private readonly byTx = new Map<string, Member[]>();
  private readonly tombed = new Map<string, Member>();
  private readonly children = new Map<string, Y.Map<unknown>[]>();
  private readonly memo = new Map<string, boolean>();

  constructor(private readonly doc: Y.Doc, private readonly device?: string) {}

  private build(): void {
    if (this.built) return;
    this.built = true;
    for (const name of Object.keys(MAPS) as MapName[]) {
      for (const [id, m] of this.doc.getMap<Y.Map<unknown>>(name).entries()) {
        if (!(m instanceof Y.Map)) continue;
        const parent = name === 'contents' ? m.get('blockId') : name === 'strokes' ? (m.get('parent') as { contentId?: unknown } | undefined)?.contentId : undefined;
        if (typeof parent === 'string') { const l = this.children.get(parent) ?? []; l.push(m); this.children.set(parent, l); }
        const tombs = tombstonesOf(m);
        if (!tombs.length) continue;
        const mem: Member = { kind: MAPS[name], id, m, tombs };
        this.tombed.set(`${name}:${id}`, mem);
        for (const t of tombs) { const l = this.byTx.get(t.tx) ?? []; if (!l.includes(mem)) l.push(mem); this.byTx.set(t.tx, l); }
      }
    }
  }

  /** 이 삭제 묶음이 보류인가 (R1 · R2) */
  pending(tx: string): boolean {
    this.build();
    const hit = this.memo.get(tx);
    if (hit !== undefined) return hit;
    const members = this.byTx.get(tx) ?? [];
    let p = members.some((e) => { const h = recordHash(e.kind, e.m); return !e.tombs.some((t) => t.hash === h); });
    if (!p) p = members.some((e) => (this.children.get(e.id) ?? []).some((c) => !hasTombstones(c)));
    this.memo.set(tx, p);
    return p;
  }

  /** Y에 있고, 묘비가 없거나 보류 중인 삭제 묶음에 들어 있으면 살아 있다 */
  alive(name: MapName, id: string): boolean {
    const m = this.doc.getMap<Y.Map<unknown>>(name).get(id);
    if (!(m instanceof Y.Map)) return false;
    if (!hasTombstones(m)) return true;
    this.build();
    const e = this.tombed.get(`${name}:${id}`);
    return !e || e.tombs.some((t) => this.pending(t.tx));
  }

  /** 보류 중인 블록이면 충돌 표시(투영 — Y에 쓰지 않는다). 이 기기의 묘비가 있으면 "이 기기가 지웠는데 다른 곳이 고침" */
  conflictOf(id: string): { kind: 'local-deleted' | 'remote-deleted'; at: number } | null {
    const m = this.doc.getMap<Y.Map<unknown>>('blocks').get(id);
    if (!(m instanceof Y.Map) || !hasTombstones(m)) return null;
    this.build();
    const e = this.tombed.get(`blocks:${id}`);
    if (!e) return null;
    const txs = e.tombs.map((t) => t.tx).filter((tx) => this.pending(tx));
    if (!txs.length) return null;
    const group = txs.flatMap((tx) => this.byTx.get(tx) ?? []);
    const mine = !!this.device && group.some((g) => g.m.has(TOMB + this.device));
    const at = Math.max(...group.flatMap((g) => g.tombs.filter((t) => txs.includes(t.tx)).map((t) => t.at)));
    return { kind: mine ? 'local-deleted' : 'remote-deleted', at };
  }

  /** 이 블록이 든 보류 묶음의 모든 구성원 — 남기기(묘비 지우기)용 */
  pendingGroupOf(id: string): Y.Map<unknown>[] {
    this.build();
    const e = this.tombed.get(`blocks:${id}`);
    if (!e) return [];
    const out = new Set<Y.Map<unknown>>();
    for (const t of e.tombs) if (this.pending(t.tx)) for (const g of this.byTx.get(t.tx) ?? []) out.add(g.m);
    return [...out];
  }
}
