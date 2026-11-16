// 저장된 Y 기록을 이어 붙일 때 (SYNC.md 2.3 · 6.1): 필드는 엔진 기준으로 Y에 쓰고, 한쪽에만 살아 있는 엔티티는 known으로 가른다.
//   Y에만 살아 있음 — known에 있으면 이 기기가 지운 것(Y에 묘비), 없으면 아직 엔진에 안 들어온 것(엔진으로 들임)
//   엔진에만 있음    — known에 있으면 다른 곳에서 지운 것(엔진에서도 지움), 없으면 이 기기가 새로 만든 것(Y에 넣음)
//   known이 없으면(예전 기록) 지우지 않고 들인다 — 잃지 않는 쪽
import * as Y from 'yjs';
import { sameValue, type Engine, type Id } from '@dn/engine-core';
import { fieldNames, writeField } from './fields';
import { Liveness, writeTombstone } from './tombstone';
import { KIND_OF, KINDS, LOCAL, listOf, noteFields, putEntity, rootOf, writeEntity, type Kind } from './ymap';

/** 돌려주는 것: 엔진으로 들여야 할 엔티티(아직 안 들어온 것 · 다른 곳에서 지운 것) */
export function pushEngine(engine: Engine, doc: Y.Doc, known: ReadonlySet<Id> | null, device: string, txId: string): Map<Kind, Set<Id>> {
  const pull = new Map<Kind, Set<Id>>();
  const toPull = (kind: Kind, id: Id) => { const s = pull.get(kind) ?? new Set<Id>(); s.add(id); pull.set(kind, s); };
  const live = new Liveness(doc, device);
  const now = Date.now();
  doc.transact(() => {
    const nm = doc.getMap<unknown>('note');
    const note = engine.note as unknown as Record<string, unknown>;
    const inY = noteFields(nm);
    for (const [k, v] of Object.entries(note)) if (!sameValue(inY[k], v)) writeField(nm, 'note', k, v);
    for (const k of fieldNames('note', nm)) if (!(k in note) && inY[k] !== undefined) writeField(nm, 'note', k, undefined);
    for (const kind of KINDS) {
      const root = rootOf(doc, kind);
      const ek = KIND_OF[kind];
      const have = new Map<Id, Record<string, unknown>>();
      for (const x of listOf(engine, kind)) have.set(x.id, x as unknown as Record<string, unknown>);
      for (const id of [...root.keys()]) {
        if (have.has(id) || !live.alive(kind, id)) continue;
        if (known?.has(id)) writeTombstone(ek, root.get(id)!, device, txId, now); // 이 기기가 지웠다
        else toPull(kind, id); // 아직 엔진에 안 들어왔다 — 들인다
      }
      for (const [id, v] of have) {
        const m = root.get(id);
        if (!(m instanceof Y.Map) || !live.alive(kind, id)) {
          if (known?.has(id)) toPull(kind, id); // 다른 곳에서 지웠다 — 엔진에서도 지운다
          else putEntity(root, ek, id, v); // 이 기기에서 만들었다(되살렸다)
          continue;
        }
        // 보류 중인 삭제 묶음의 충돌 표시는 투영이라 Y에 쓰지 않는다
        writeEntity(m, ek, v, kind === 'blocks' && live.conflictOf(id) ? new Set(['conflict']) : undefined);
      }
    }
  }, LOCAL);
  return pull;
}
