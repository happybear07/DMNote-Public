// 엔진 ⇄ Y.Doc 다리 (FR-095 ~ 097, SYNC.md 2절): 노트 하나 = Y.Doc 하나.
// note · blocks · contents · arrows · strokes 맵, 엔티티마다 Y.Map(필드 → 값, 필드 단위 LWW). 글 상자의 doc은 Y.XmlFragment(글자 단위 병합),
// 묶음 정보 · 댓글 · 데이터베이스 열 · 행은 항목 단위(fields.ts). 삭제는 키를 지우지 않고 묘비(tombstone.ts).
// - 엔진의 로컬 트랜잭션 → Y 트랜잭션(origin LOCAL)
// - 다른 곳에서 온 Y 변경 → 엔진 트랜잭션 하나(origin 'remote', 실행 취소 기록 없음) — reconcile.ts
// - 저장된 Y 기록을 이어 붙일 때 — reopen.ts
// - 높이 측정(origin 'layout')은 Y에 쓰지 않는다 — 기기마다 글꼴 · 폭이 달라 서로 덮어쓴다 (SYNC 13.3 #20 · OD-11)
// - 스키마 버전(10.5): 쓰는 기기는 `meta['v:' + 버전] = true`를 같은 트랜잭션에 쓴다. 문서 버전이 내 버전보다 크면 받기만 하고 로컬 변경은 Y에 쓰지 않는다
import * as Y from 'yjs';
import { isTextContent, newId, SCHEMA_VERSION, type ChangeEvent, type Engine, type Id } from '@dn/engine-core';
import { writeField } from './fields';
import { reconcile } from './reconcile';
import { pushEngine } from './reopen';
import { syncDoc, writeDoc } from './text-y';
import { clearTombstones, hasTombstones, Liveness, TOMB, writeTombstone } from './tombstone';
import { KIND_OF, KINDS, LOCAL, listOf, MAP_OF, putEntity, rootOf, type Kind } from './ymap';

export { LOCAL } from './ymap';
export { yToEntity } from './ymap';

export interface Bridge {
  detach(): void;
  /** 문서가 이 앱보다 새 스키마로 쓰였으면 그 버전 (보기 전용 — 로컬 변경을 Y에 쓰지 않는다), 아니면 null */
  newerSchema(): number | null;
}
/** 다른 곳 변경을 엔진에 반영한 뒤: 바꾼 엔티티 수 · 끝내 들이지 못한(엔진 규칙에 막힌) 수 */
export type OnRemote = (changed: number, rejected: number) => void;

export interface AttachOptions {
  onRemote?: OnRemote;
  /**
   * Y.Doc에 이미 내용이 있을 때 누구를 맞출지 — 'doc'(기본: 엔진을 Y에 맞춤 — 탭 · 파일로 받은 상태) ·
   * 'engine'(저장된 Y 기록을 이어 붙일 때 — reopen.ts, known으로 한쪽에만 있는 엔티티를 가른다)
   */
  prefer?: 'doc' | 'engine';
  /** 지난번 저장 때 엔진 · Y 양쪽에 살아 있던 id (knownIds) */
  known?: ReadonlySet<Id> | null;
  /** 이 기기 id — 묘비 키(`_del:<id>`)와 "이 기기가 지웠나" 판정. 없으면 이 Y.Doc의 clientID */
  device?: string;
  /** 이 앱의 노트 스키마 버전 (기본 engine-core SCHEMA_VERSION — 시험에서 바꿔 본다) */
  schema?: number;
  /** 문서가 이 앱보다 새 스키마로 쓰인 것을 처음 알았을 때 (보기 전용으로 바꾸고 안내) */
  onNewerSchema?: (docVersion: number) => void;
}

const VKEY = 'v:';
/** 문서 스키마 버전 = Y `meta`의 `v:n` 키 중 가장 큰 n (키 합집합이라 줄지 않는다). 표시가 없으면 0 (표시 전 기록) */
export function docSchema(doc: Y.Doc): number {
  let v = 0;
  for (const k of doc.getMap<unknown>('meta').keys()) if (k.startsWith(VKEY)) { const n = Number(k.slice(VKEY.length)); if (Number.isInteger(n) && n > v) v = n; }
  return v;
}

/** Y와 엔진 양쪽에 다 살아 있는 엔티티 id — 동기화 상태를 저장할 때 함께 적어 두면 다음에 이어 붙일 때 "이쪽이 지운 것"과 "아직 안 들어온 것"을 가른다 */
export function knownIds(engine: Engine, doc: Y.Doc): Set<Id> {
  const out = new Set<Id>();
  const live = new Liveness(doc);
  for (const kind of KINDS) for (const x of listOf(engine, kind)) if (live.alive(kind, x.id)) out.add(x.id);
  return out;
}

/** 엔진과 Y.Doc을 잇는다. Y.Doc이 비어 있으면 엔진 내용을 쓰고(처음), 아니면 prefer에 따라 맞춘다 */
export function attach(engine: Engine, doc: Y.Doc, opts: AttachOptions = {}): Bridge {
  const { onRemote, prefer = 'doc', known, onNewerSchema } = opts;
  const device = opts.device ?? String(doc.clientID);
  const noteMap = doc.getMap<unknown>('note');
  const mine = opts.schema ?? SCHEMA_VERSION;
  const meta = doc.getMap<unknown>('meta');
  const mark = () => { if (!meta.has(VKEY + mine)) meta.set(VKEY + mine, true); };
  let newer: number | null = null;
  const checkSchema = () => {
    if (newer !== null) return;
    const v = docSchema(doc);
    if (v > mine) { newer = v; onNewerSchema?.(v); }
  };
  if (!noteMap.has('id')) {
    doc.transact(() => {
      for (const [k, v] of Object.entries(engine.note)) if (v !== undefined) writeField(noteMap, 'note', k, v);
      for (const kind of KINDS) for (const x of listOf(engine, kind)) putEntity(rootOf(doc, kind), KIND_OF[kind], x.id, x as unknown as Record<string, unknown>);
      mark();
    }, LOCAL);
  } else if (prefer === 'engine') {
    const pull = pushEngine(engine, doc, known ?? null, device, newId());
    if (pull.size) { const r = reconcile(engine, doc, pull, false, device); onRemote?.(r.changed, r.rejected); }
  } else {
    const r = reconcile(engine, doc, null, true, device);
    if (r.rejected) onRemote?.(r.changed, r.rejected);
  }

  checkSchema();

  // 엔진 → Y (높이 측정은 쓰지 않는다 · 새 스키마 문서에는 쓰지 않는다)
  const offEngine = engine.subscribe((e: ChangeEvent) => {
    if (e.origin === 'remote' || e.origin === 'load' || e.origin === 'layout') return;
    checkSchema();
    if (newer !== null) return;
    doc.transact(() => {
      mark();
      const texts = new Set<Id>();
      const live = new Liveness(doc, device);
      const now = Date.now();
      for (const op of e.ops) {
        if (op.e === 'note') { if (op.k === 'set') writeField(noteMap, 'note', op.field, op.value); continue; }
        const root = rootOf(doc, MAP_OF[op.e]!);
        if (op.k === 'create') putEntity(root, op.e, op.id, op.value as Record<string, unknown>);
        else if (op.k === 'delete') { const m = root.get(op.id); if (m) writeTombstone(op.e, m, device, e.txId, now); }
        else if (op.k === 'text' || (op.k === 'set' && op.e === 'content' && op.field === 'doc')) texts.add(op.id);
        else if (op.k === 'set') {
          const m = root.get(op.id);
          if (!m) continue;
          // 보류 중인 삭제 묶음의 충돌 표시는 투영 — 사용자가 "남기기"로 지우면 그 묶음의 묘비를 지운다(13.2.4). Y에는 쓰지 않는다
          if (op.e === 'block' && op.field === 'conflict' && hasTombstones(m) && live.conflictOf(op.id)) {
            if (op.value === undefined) for (const g of live.pendingGroupOf(op.id)) clearTombstones(g);
            continue;
          }
          writeField(m, op.e, op.field, op.value);
        }
      }
      for (const id of texts) {
        const c = engine.getContent(id);
        const ym = rootOf(doc, 'contents').get(id);
        if (!c || !ym || !isTextContent(c)) continue;
        let f = ym.get('doc');
        if (!(f instanceof Y.XmlFragment)) { f = new Y.XmlFragment(); ym.set('doc', f); writeDoc(f as Y.XmlFragment, c.doc); }
        else syncDoc(f, c.doc);
      }
    }, LOCAL);
  });

  // Y → 엔진: 바뀐 엔티티만 다시 맞춘다. 묘비가 걸린 변경이면(묘비가 생기거나 지워짐, 묘비 있는 엔티티 · 그 자식이 바뀜)
  // 삭제 묶음 판정이 다른 엔티티의 살아 있음까지 바꾸므로 전부 다시 맞춘다
  const onTx = (tr: Y.Transaction) => {
    if (tr.origin === LOCAL) return;
    checkSchema();
    const touched = new Map<Kind, Set<Id>>();
    let noteTouched = false, tombs = false;
    for (const type of tr.changedParentTypes.keys()) {
      let t: Y.AbstractType<Y.YEvent<any>> | null = type; // eslint-disable-line @typescript-eslint/no-explicit-any
      let child: Y.AbstractType<Y.YEvent<any>> | null = null; // eslint-disable-line @typescript-eslint/no-explicit-any
      while (t && t._item) { child = t; t = t.parent as typeof t; }
      if (!t) continue;
      if ((t as unknown) === noteMap) { noteTouched = true; continue; }
      const kind = KINDS.find((k) => (rootOf(doc, k) as unknown) === t);
      if (!kind) continue;
      const set = touched.get(kind) ?? new Set<Id>();
      if (child) { const key = child._item?.parentSub; if (key) set.add(key); }
      // 맵 자체의 키가 바뀌었으면(생성 · 삭제) 그 키들
      for (const k of tr.changed.get(t) ?? []) if (k) set.add(k);
      if ([...(tr.changed.get(type) ?? [])].some((k) => k?.startsWith(TOMB))) tombs = true;
      touched.set(kind, set);
    }
    if (!tombs) tombs = touchesTombstones(doc, touched);
    if (touched.size || noteTouched) {
      // (주의: onRemote?.(reconcile(…))로 쓰면 onRemote가 없을 때 reconcile이 아예 불리지 않는다 — 인자도 단락 평가)
      const r = reconcile(engine, doc, tombs ? null : touched, noteTouched || tombs, device);
      onRemote?.(r.changed, r.rejected);
    }
  };
  doc.on('afterTransaction', onTx);
  return { detach: () => { offEngine(); doc.off('afterTransaction', onTx); }, newerSchema: () => newer };
}

/** 바뀐 엔티티나 그 부모(콘텐츠의 블록 · 잉크의 콘텐츠)에 묘비가 있나 */
function touchesTombstones(doc: Y.Doc, touched: Map<Kind, Set<Id>>): boolean {
  for (const [kind, ids] of touched) {
    for (const id of ids) {
      const m = rootOf(doc, kind).get(id);
      if (!(m instanceof Y.Map)) continue;
      if (hasTombstones(m)) return true;
      const parent = kind === 'contents' ? rootOf(doc, 'blocks').get(String(m.get('blockId')))
        : kind === 'strokes' ? rootOf(doc, 'contents').get(String((m.get('parent') as { contentId?: unknown } | undefined)?.contentId)) : undefined;
      if (parent instanceof Y.Map && hasTombstones(parent)) return true;
    }
  }
  return false;
}
