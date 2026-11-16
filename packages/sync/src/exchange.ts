// 기기 사이 동기화의 병합 (FR-096 · 097): 동기화 파일로 받은 다른 기기의 Y 상태를 이 기기의 Y 상태와 합친다.
// 10/09부터 삭제는 묘비라 "지우기 대 고치기"는 묘비 규칙이 판정한다(tombstone.ts). 아래 지문 되살리기는 키를 지우던 예전 기록 · 파일용.
// Yjs 병합에서 "지우기 대 고치기"는 지우기가 이긴다 — 한쪽이 지운 블록을 다른 쪽이 그사이 고쳤다면 그 고친 내용이 사라진다.
// 그래서 마지막 동기화 때 블록마다 내용 지문(base)을 남겨 두고, 병합 뒤 사라진 블록 중 "지운 쪽 반대편에서 지문이 바뀐"(= 고친) 것은
// 고친 쪽 내용을 되살려 충돌 표시를 단다(사용자가 남기기 · 지우기를 고를 때까지 어느 쪽도 지우지 않는다).
import * as Y from 'yjs';
import { canonical, Liveness } from './tombstone';
import { yToEntity } from './ymap';

/** 블록 하나 + 그 블록의 콘텐츠들 (되살리기용) */
export interface BlockBundle { block: Record<string, unknown>; contents: Record<string, unknown>[] }
export type ConflictKind = 'remote-deleted' | 'local-deleted';
export interface Conflict { blockId: string; kind: ConflictKind; bundle: BlockBundle }

/** 살아 있는 블록 → (블록 + 콘텐츠) 묶음. 콘텐츠는 blockId로 찾는다. 묘비로 지워진 것(보류 아님)은 뺀다 */
export function bundles(doc: Y.Doc): Map<string, BlockBundle> {
  const out = new Map<string, BlockBundle>();
  const live = new Liveness(doc);
  const blocks = doc.getMap<Y.Map<unknown>>('blocks'), contents = doc.getMap<Y.Map<unknown>>('contents');
  for (const [id, m] of blocks.entries()) if (live.alive('blocks', id)) out.set(id, { block: yToEntity('block', id, m), contents: [] });
  for (const [id, m] of contents.entries()) {
    if (!live.alive('contents', id)) continue;
    const c = yToEntity('content', id, m);
    out.get(String(c.blockId))?.contents.push(c);
  }
  for (const b of out.values()) b.contents.sort((x, y) => String(x.id).localeCompare(String(y.id)));
  return out;
}

/** 블록의 의미 필드 (노트 v6) — 바꾸면 내용을 고친 것 */
const MEANING = ['nodeKind', 'attachTo', 'status', 'emphasis', 'hedge', 'role', 'speaker', 'owner', 'time', 'start', 'end', 'due'];

function fingerprintOf(b: BlockBundle, stringify: (v: unknown) => string): string {
  const block = b.block as Record<string, unknown>;
  const meaning = MEANING.filter((k) => block[k] !== undefined).map((k) => [k, block[k]]);
  const s = stringify({ c: b.contents.map((c) => { const { order: _o, ...rest } = c; return rest; }), style: b.block.style ?? null, ...(meaning.length ? { m: meaning } : {}) });
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36) + s.length.toString(36);
}

/** 내용 지문 — 위치 · 크기 · 겹침 순서는 빼고(옮기기만 한 건 "고침"으로 보지 않는다) 글 · 콘텐츠 데이터 · 의미만. 키 순서와 무관 */
export const fingerprint = (b: BlockBundle): string => fingerprintOf(b, canonical);

/** 마지막 동기화 이후 고쳤나 — 예전 파일 버전(키 순서를 탄 지문)으로 남긴 base도 맞게 본다 */
const editedSince = (b: BlockBundle, base: string): boolean => fingerprint(b) !== base && fingerprintOf(b, JSON.stringify) !== base;

export function fingerprints(doc: Y.Doc): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, b] of bundles(doc)) out[id] = fingerprint(b);
  return out;
}

/**
 * local(이 기기, 지금) ← remote(다른 기기 파일)를 합친다. local은 그 자리에서 바뀐다.
 * base: 마지막 동기화 때 블록 지문 (없으면 처음 — 충돌 판단 없이 그냥 합친다)
 * 결과: 충돌(되살려야 할 블록) 목록 — 되살리기 · 표시는 부르는 쪽(엔진)에서
 */
export function mergeRemote(local: Y.Doc, remoteUpdate: Uint8Array, base: Record<string, string> | null): Conflict[] {
  const before = bundles(local);
  const remoteDoc = new Y.Doc();
  Y.applyUpdate(remoteDoc, remoteUpdate);
  const theirs = bundles(remoteDoc);
  remoteDoc.destroy();
  Y.applyUpdate(local, remoteUpdate, 'sync-file');
  if (!base) return [];
  const after = bundles(local);
  const out: Conflict[] = [];
  const keys = local.getMap('blocks');
  for (const id of new Set([...before.keys(), ...theirs.keys()])) {
    // 키가 남아 있으면 묘비로 지운 것 — 고친 쪽 판정은 묘비 규칙(tombstone.ts R1 · R2)이 이미 했다. 여기는 키가 사라진 예전 방식만
    if (after.has(id) || keys.has(id) || !(id in base)) continue;
    const mine = before.get(id), other = theirs.get(id);
    // 다른 기기가 지웠는데 이 기기는 고쳤다
    if (mine && !other && editedSince(mine, base[id]!)) out.push({ blockId: id, kind: 'remote-deleted', bundle: mine });
    // 이 기기가 지웠는데 다른 기기는 고쳤다
    else if (other && !mine && editedSince(other, base[id]!)) out.push({ blockId: id, kind: 'local-deleted', bundle: other });
  }
  return out;
}

// ───────── 동기화 파일 ─────────

export interface SyncFileNote { id: string; title: string; update: string }
/** 첨부 파일 하나 (내용 해시 · 형식 · base64) */
export interface SyncFileAttachment { hash: string; mime: string; data: string }
export interface SyncFile {
  /** 2: 목록 필드가 항목 키(fields.ts). 3: 삭제가 묘비(tombstone.ts). 예전 앱은 자기가 모르는 버전을 거절한다(잘못 읽지 않게) */
  app: 'DamianNote'; kind: 'sync'; v: 1 | 2 | 3 | 4; device: string; exportedAt: string; notes: SyncFileNote[];
  /** v4(10/19): 내보낸 앱의 노트 스키마 버전 (OD-15) — 이 앱보다 크면 가져오지 않는다 */
  schema?: number;
  /** 노트가 쓰는 첨부(이미지 · 파일 · 녹음 · 커버) — 받는 기기에 없으면 넣는다. 예전 파일에는 없다 */
  attachments?: SyncFileAttachment[];
}

/** Y 기록에서 이 노트가 쓰는 첨부 해시 (이미지 · 파일 콘텐츠의 attachment, 노트 커버) */
export function docAttachments(doc: Y.Doc): string[] {
  const out = new Set<string>();
  for (const m of doc.getMap<Y.Map<unknown>>('contents').values()) {
    const a = m.get('attachment'), t = m.get('type');
    if (typeof a === 'string' && (t === 'image' || t === 'file')) out.add(a);
  }
  const cover = doc.getMap<unknown>('note').get('cover') as { attachment?: unknown } | undefined;
  if (cover && typeof cover.attachment === 'string') out.add(cover.attachment);
  return [...out];
}

export const toB64 = (u: Uint8Array): string => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
export const fromB64 = (s: string): Uint8Array => { const b = atob(s); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };

export function isSyncFile(x: unknown): x is SyncFile {
  const f = x as SyncFile;
  return !!f && f.app === 'DamianNote' && f.kind === 'sync' && (f.v === 1 || f.v === 2 || f.v === 3 || f.v === 4) && Array.isArray(f.notes);
}
