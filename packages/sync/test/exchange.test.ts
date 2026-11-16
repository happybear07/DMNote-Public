// 기기 사이 병합 (FR-097): 공통 기록이 있는 두 기기가 따로 고친 뒤 합치기.
// 지우기 ↔ 고치기는 묘비 규칙(SYNC 13.2)으로 — 지운 쪽이 모르는 편집이 있으면 그 블록은 양쪽에 살아 있고 충돌 표시,
// 고치지 않은 블록 삭제는 그냥 반영, 옮기기만 한 것은 고침이 아님. 키를 지우던 예전 기록은 지문 되살리기(mergeRemote)로
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { blockTextParts, bodyDoc, createTextBlock, deleteEntities, docText, Engine, moveBlocks, newId, resolveConflict, setNoteCover, setText, type Id } from '@dn/engine-core';
import { attach, docAttachments, fingerprints, mergeRemote } from '../src';

const val = <T,>(r: { ok: boolean; value?: T }) => r.value as T;
/** A에서 만든 노트를 B가 받은 상태 (공통 기록) */
function devices() {
  const id = newId();
  const a = new Engine({ note: { id, title: '공유', createdAt: 1, updatedAt: 1 } });
  const ids = ['하나', '둘', '셋'].map((t, i) => val(createTextBlock(a, { x: i * 300, y: 0 }, { body: t })).blockId);
  const da = new Y.Doc();
  attach(a, da);
  const db = new Y.Doc();
  Y.applyUpdate(db, Y.encodeStateAsUpdate(da));
  const b = new Engine({ note: { id, title: '', createdAt: 1, updatedAt: 1 } });
  attach(b, db);
  const base = fingerprints(db);
  return { a, b, da, db, ids, base };
}
const body = (e: Engine, id: string) => blockTextParts(e.contentsOf(id)).bodies[0]!;

describe('기기 사이 병합', () => {
  it('서로 다른 블록 · 같은 문단 변경은 그냥 합쳐지고 충돌 없음', () => {
    const { a, b, da, db, ids, base } = devices();
    setText(a, body(a, ids[0]!).id, bodyDoc('하나 A'));
    setText(b, body(b, ids[1]!).id, bodyDoc('둘 B'));
    const conflicts = mergeRemote(db, Y.encodeStateAsUpdate(da), base);
    expect(conflicts).toEqual([]);
    expect(docText(body(b, ids[0]!).doc)).toBe('하나 A');
    expect(docText(body(b, ids[1]!).doc)).toBe('둘 B');
  });

  it('다른 기기가 지운 블록을 이 기기가 고쳤으면 → 지우지 않고 남김 · 충돌 표시(remote-deleted)', () => {
    const { a, b, da, db, ids, base } = devices();
    deleteEntities(a, [ids[0]!]);
    setText(b, body(b, ids[0]!).id, bodyDoc('하나 — B가 고침'));
    expect(mergeRemote(db, Y.encodeStateAsUpdate(da), base)).toEqual([]); // 묘비 규칙이 판정 — 되살릴 목록이 따로 없다
    expect(b.getBlock(ids[0]!)?.conflict?.kind).toBe('remote-deleted');
    expect(docText(body(b, ids[0]!).doc)).toBe('하나 — B가 고침');
  });

  it('이 기기가 지운 블록을 다른 기기가 고쳤으면 → 다른 기기 내용으로 살아 있음 · 충돌 표시(local-deleted)', () => {
    const { a, b, da, db, ids, base } = devices();
    setText(a, body(a, ids[2]!).id, bodyDoc('셋 — A가 고침'));
    deleteEntities(b, [ids[2]!]);
    expect(b.getBlock(ids[2]!)).toBeUndefined();
    mergeRemote(db, Y.encodeStateAsUpdate(da), base);
    expect(b.getBlock(ids[2]!)?.conflict?.kind).toBe('local-deleted');
    expect(docText(body(b, ids[2]!).doc)).toBe('셋 — A가 고침');
  });

  it('지운 블록 안에 다른 기기가 콘텐츠를 더했으면(R2) 지우지 않고 남김', () => {
    const { a, b, da, db, ids, base } = devices();
    a.transact((tx) => tx.createContent({ blockId: ids[1]!, type: 'text', role: 'body', doc: bodyDoc('A가 더한 줄') } as never), { origin: 'user' });
    deleteEntities(b, [ids[1]!]);
    mergeRemote(db, Y.encodeStateAsUpdate(da), base);
    expect(b.getBlock(ids[1]!)?.conflict).toBeTruthy();
    expect(JSON.stringify([...b.contentsOf(ids[1]!)])).toContain('A가 더한 줄');
  });

  it('충돌 해결이 양쪽으로 간다 — 남기기는 묘비를 지워 보통 블록으로, 지우기는 양쪽에서 사라짐', () => {
    for (const keep of [true, false]) {
      const { a, b, da, db, ids, base } = devices();
      deleteEntities(a, [ids[0]!]);
      setText(b, body(b, ids[0]!).id, bodyDoc('B가 고침'));
      mergeRemote(db, Y.encodeStateAsUpdate(da), base);
      Y.applyUpdate(da, Y.encodeStateAsUpdate(db, Y.encodeStateVector(da)), 'peer');
      expect(a.getBlock(ids[0]!)?.conflict?.kind).toBe('local-deleted'); // 지운 쪽에도 되살아나 보인다
      resolveConflict(b, ids[0]! as Id, keep);
      Y.applyUpdate(da, Y.encodeStateAsUpdate(db, Y.encodeStateVector(da)), 'peer');
      for (const e of [a, b]) {
        if (keep) { expect(e.getBlock(ids[0]!)).toBeDefined(); expect(e.getBlock(ids[0]!)!.conflict).toBeUndefined(); }
        else expect(e.getBlock(ids[0]!)).toBeUndefined();
      }
    }
  });

  it('예전 기록(삭제 = 키 지우기)은 지문 비교로 되살릴 목록을 낸다', () => {
    const { b, da, db, ids, base } = devices();
    // 예전 앱이 지운 것처럼: 다른 기기 Y에서 블록 · 콘텐츠 키를 그냥 지운다
    const old = new Y.Doc();
    Y.applyUpdate(old, Y.encodeStateAsUpdate(da));
    old.transact(() => {
      for (const [cid, m] of old.getMap<Y.Map<unknown>>('contents').entries()) if (m.get('blockId') === ids[0]) old.getMap('contents').delete(cid);
      old.getMap('blocks').delete(ids[0]!);
    });
    setText(b, body(b, ids[0]!).id, bodyDoc('하나 — B가 고침'));
    const conflicts = mergeRemote(db, Y.encodeStateAsUpdate(old), base);
    expect(conflicts.map((c) => [c.blockId, c.kind])).toEqual([[ids[0], 'remote-deleted']]);
    expect(JSON.stringify(conflicts[0]!.bundle)).toContain('B가 고침');
  });

  it('고치지 않은 블록을 지운 것 · 옮기기만 한 것은 충돌 아님', () => {
    const { a, b, da, db, ids, base } = devices();
    deleteEntities(a, [ids[1]!]);
    moveBlocks(b, [ids[1]!], 40, 0);
    const conflicts = mergeRemote(db, Y.encodeStateAsUpdate(da), base);
    expect(conflicts).toEqual([]);
    expect(b.getBlock(ids[1]!)).toBeUndefined();
  });

  it('처음 동기화(기준 없음)는 충돌 판단 없이 합친다', () => {
    const { b, da, db, ids } = devices();
    expect(mergeRemote(db, Y.encodeStateAsUpdate(da), null)).toEqual([]);
    expect(b.getBlock(ids[0]!)).toBeDefined();
  });
});

describe('동기화 파일 첨부', () => {
  it('Y 기록에서 이미지 · 파일 · 커버 해시를 모은다 (같은 해시는 한 번, 다른 콘텐츠의 필드는 무시)', () => {
    const e = new Engine();
    const doc = new Y.Doc();
    attach(e, doc);
    e.transact((tx) => {
      const b = tx.createBlock({ x: 0, y: 0, w: 200, h: 100 });
      tx.createContent({ blockId: b, type: 'image', attachment: 'h-img', natural: { w: 1, h: 1 } } as never);
      const c = tx.createBlock({ x: 0, y: 200, w: 200, h: 60 });
      tx.createContent({ blockId: c, type: 'file', attachment: 'h-file', name: 'a.pdf', mime: 'application/pdf', size: 3 } as never);
      const d = tx.createBlock({ x: 0, y: 300, w: 200, h: 60 });
      tx.createContent({ blockId: d, type: 'file', attachment: 'h-img', name: 'same.png', mime: 'image/png', size: 3 } as never);
    }, { origin: 'user' });
    setNoteCover(e, { attachment: 'h-cover', pos: 40 });
    expect(docAttachments(doc).sort()).toEqual(['h-cover', 'h-file', 'h-img']);
  });
});

describe('노트 v6 의미 필드', () => {
  it('다른 기기가 지운 블록의 노드 종류를 이 기기가 바꿨으면 고침으로 본다 · 의미 필드가 없으면 지문이 예전과 같다', () => {
    const { a, b, da, db, ids, base } = devices();
    const before = fingerprints(db)[ids[1]!];
    deleteEntities(a, [ids[0]!]);
    b.transact((tx) => tx.set('block', ids[0]!, { nodeKind: 'claim' }), { origin: 'user' });
    mergeRemote(db, Y.encodeStateAsUpdate(da), base);
    expect(b.getBlock(ids[0]!)?.conflict?.kind).toBe('remote-deleted');
    expect(fingerprints(db)[ids[1]!]).toBe(before);
  });
});
