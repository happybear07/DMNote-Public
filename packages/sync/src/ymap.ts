// 다리의 공용 도우미: 엔티티 종류 이름 · 엔진 레코드 ⇄ 엔티티 Y.Map (bridge · reconcile · reopen이 함께 쓴다)
import * as Y from 'yjs';
import type { Engine, EntityKind, Id, TextDoc } from '@dn/engine-core';
import { fieldNames, readFields, writeField } from './fields';
import { fragmentToDoc, syncDoc, writeDoc } from './text-y';
import { clearTombstones } from './tombstone';

export const LOCAL = Symbol('dn-local');
export const KINDS = ['blocks', 'contents', 'arrows', 'strokes'] as const;
export type Kind = (typeof KINDS)[number];
export const KIND_OF: Record<Kind, EntityKind> = { blocks: 'block', contents: 'content', arrows: 'arrow', strokes: 'stroke' };
export const MAP_OF: Record<string, Kind> = { block: 'blocks', content: 'contents', arrow: 'arrows', stroke: 'strokes' };

const isTextRecord = (v: Record<string, unknown>) => v.type === 'text' && typeof v.doc === 'object';

export const rootOf = (doc: Y.Doc, kind: Kind) => doc.getMap<Y.Map<unknown>>(kind);
export const listOf = (engine: Engine, kind: Kind): Iterable<{ id: Id }> =>
  kind === 'blocks' ? engine.blocks() : kind === 'contents' ? engine.contents() : kind === 'arrows' ? engine.arrows() : engine.strokes();
export const getOf = (engine: Engine, kind: Kind, id: Id) =>
  (kind === 'blocks' ? engine.getBlock(id) : kind === 'contents' ? engine.getContent(id) : kind === 'arrows' ? engine.getArrow(id) : engine.getStroke(id)) as Record<string, unknown> | undefined;

/** 엔티티 Y.Map의 필드를 엔진 레코드에 맞춘다 (바뀐 필드만 — 글 상자 문서는 최소 차이). keep: 건드리지 않을 필드(투영 필드) */
export function writeEntity(m: Y.Map<unknown>, kind: EntityKind, v: Record<string, unknown>, keep?: ReadonlySet<string>): void {
  for (const k of fieldNames(kind, m)) if (!(k in v) && !keep?.has(k)) writeField(m, kind, k, undefined);
  for (const [k, val] of Object.entries(v)) {
    if (k === 'id' || keep?.has(k)) continue;
    if (val === undefined) { writeField(m, kind, k, undefined); continue; }
    const cur = m.get(k);
    if (cur instanceof Y.XmlFragment) { if (k === 'doc') syncDoc(cur, val as TextDoc); continue; }
    if (k === 'doc' && isTextRecord(v)) { const f = new Y.XmlFragment(); m.set('doc', f); writeDoc(f, val as TextDoc); continue; }
    writeField(m, kind, k, val);
  }
}

/**
 * 엔티티를 Y에 넣는다. 묘비로 지워 둔 같은 id가 있으면(실행 취소로 되살림) 새 맵을 만들지 않고 그 맵의 묘비를 지운 뒤 필드를 맞춘다
 * — 새 맵을 만들면 그사이 다른 곳이 그 맵에 쓴 변경이 통째로 사라진다. 새 맵은 먼저 문서에 붙인 뒤 쓴다(붙기 전 맵은 읽을 수 없다).
 */
export function putEntity(root: Y.Map<Y.Map<unknown>>, kind: EntityKind, id: Id, value: Record<string, unknown>): void {
  const old = root.get(id);
  if (old instanceof Y.Map) { clearTombstones(old); writeEntity(old, kind, value); return; }
  const m = new Y.Map<unknown>();
  root.set(id, m);
  writeEntity(m, kind, value);
}

/** Y 엔티티 → 엔진 레코드 (항목 키는 배열 · 레코드로, 빈 목록 필드 · 예약 키는 없음) */
export function yToEntity(kind: EntityKind, id: Id, m: Y.Map<unknown>): Record<string, unknown> {
  return { id, ...readFields(kind, m, fragmentToDoc) };
}
/** 노트 맵 → 노트 필드 */
export const noteFields = (nm: Y.Map<unknown>) => readFields('note', nm, fragmentToDoc);
