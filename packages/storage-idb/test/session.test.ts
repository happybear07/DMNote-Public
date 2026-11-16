import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  blockTextParts, createArrow, createTextBlock, deleteEntities, docText, Engine, moveBlocks, newId, SCHEMA_VERSION, serialize, setText, textDoc,
} from '@dn/engine-core';
import { createNote, IdbNoteStore, openNote } from '../src';

const snap = (e: Engine) => { const s = serialize(e); return JSON.stringify({ ...s, note: { ...s.note, updatedAt: 0 } }); };

describe('자동 저장 · 열기 (FR-089)', () => {
  it('로그만 있는 상태 → 다시 열면 같은 문서', async () => {
    const store = await IdbNoteStore.open(`t-${Math.random()}`);
    const e = new Engine();
    const s = await createNote(store, e);
    const a = createTextBlock(e, { x: 0, y: 0 }, { title: '하나' });
    const b = createTextBlock(e, { x: 400, y: 0 }, { title: '둘' });
    if (!a.ok || !b.ok) throw new Error();
    createArrow(e, { blockId: a.value.blockId, side: 'auto' }, { blockId: b.value.blockId, side: 'auto' });
    setText(e, a.value.contentId, textDoc('하나!', '본문'));
    moveBlocks(e, [b.value.blockId], 10, 20);
    await s.flush();
    const r = await openNote(store, e.note.id);
    if (!r.ok) throw new Error(r.reason);
    expect(snap(r.engine)).toBe(snap(e));
  });

  it('압축 후 추가 편집 → 스냅샷 + 남은 로그로 복원', async () => {
    const store = await IdbNoteStore.open(`t-${Math.random()}`);
    const e = new Engine();
    const s = await createNote(store, e);
    const ids: string[] = [];
    for (let i = 0; i < 20; i++) { const r = createTextBlock(e, { x: i * 300, y: 0 }); if (r.ok) ids.push(r.value.blockId); }
    await s.compact();
    deleteEntities(e, ids.slice(0, 5));
    moveBlocks(e, ids.slice(5, 8), -40, 40);
    // 압축 직전에 큐에 남은 변경이 이중 적용되지 않는지
    const pendingEdit = createTextBlock(e, { x: 0, y: 900 });
    expect(pendingEdit.ok).toBe(true);
    await s.compact();
    moveBlocks(e, ids.slice(10, 12), 5, 5);
    await s.flush();
    const r = await openNote(store, e.note.id);
    if (!r.ok) throw new Error(r.reason);
    expect(r.warning).toBeUndefined();
    expect(snap(r.engine)).toBe(snap(e));
  });

  it('상위 버전 스냅샷은 읽기 전용으로 열고 저장하지 않는다 (FR-090)', async () => {
    const store = await IdbNoteStore.open(`t-${Math.random()}`);
    const e = new Engine();
    createTextBlock(e, { x: 0, y: 0 }, { title: '미래' });
    const snap99 = { ...serialize(e), schemaVersion: 99, futureField: { a: 1 } };
    await store.compact(e.note.id, snap99, 0);
    const r = await openNote(store, e.note.id);
    if (!r.ok) throw new Error(r.reason);
    expect(r.session.readonly).toBe(true);
    expect(r.warning).toContain('읽기 전용');
    createTextBlock(r.engine, { x: 300, y: 0 });
    await r.session.flush();
    const again = await store.load(e.note.id);
    expect(again?.log).toHaveLength(0);
    expect((again?.snapshot as { schemaVersion: number }).schemaVersion).toBe(99);
  });

  it('구버전(v1) 스냅샷 + 구버전 로그 → 로그를 먼저 재생한 뒤 마이그레이션 · 원본 백업 · 최신 버전으로 재저장 (FR-090)', async () => {
    const store = await IdbNoteStore.open(`t-${Math.random()}`);
    const noteId = newId(), b1 = newId(), c1 = newId();
    const v1 = {
      schemaVersion: 1, engine: { textSchema: 'pm-v1' }, note: { id: noteId, title: '옛 노트', createdAt: 1, updatedAt: 1 },
      blocks: { [b1]: { id: b1, x: 0, y: 0, w: 260, h: 84, sizing: 'auto', layout: 'flow', z: 'a0' } },
      contents: { [c1]: { id: c1, blockId: b1, order: 'a0', type: 'text', doc: textDoc('옛 제목', '옛 본문') } },
      arrows: {}, strokes: {},
    };
    await store.compact(noteId, v1 as never, 0);
    // v1 시절 로그: 블록 이동
    await store.appendLog([{ noteId, seq: 1, txId: 't1', origin: 'user', at: 1, schemaVersion: 1, ops: [{ k: 'set', e: 'block', id: b1, field: 'x', value: 40, prev: 0 }] }]);
    const r = await openNote(store, noteId);
    if (!r.ok) throw new Error(r.reason);
    expect(r.engine.getBlock(b1)!.x).toBe(40);
    // v1 → v3: 제목 + 본문이 있던 블록은 내용 상자 하나로 (글자 그대로)
    const parts = blockTextParts(r.engine.contentsOf(b1));
    expect(parts.title).toBeUndefined();
    expect(docText(parts.bodies[0]!.doc)).toBe('옛 제목\n옛 본문');
    const saved = await store.load(noteId);
    expect((saved!.snapshot as { schemaVersion: number }).schemaVersion).toBe(SCHEMA_VERSION);
    expect(saved!.log).toHaveLength(0);
    // 다시 열면 정상 경로 — 같은 상태
    const again = await openNote(store, noteId);
    if (!again.ok) throw new Error(again.reason);
    expect(snap(again.engine)).toBe(snap(r.engine));
  });

  it('쓰기 실패(저장 공간 부족) → 편집이 더 없어도 저절로 다시 저장 (배포 QA E4)', async () => {
    const store = await IdbNoteStore.open(`t-${Math.random()}`);
    const e = new Engine();
    const s = await createNote(store, e);
    const append = store.appendLog.bind(store);
    let full = true;
    store.appendLog = (r) => (full ? Promise.reject(new DOMException('quota', 'QuotaExceededError')) : append(r));
    const err = console.error; console.error = () => {};
    try {
      createTextBlock(e, { x: 0, y: 0 }, { title: '공간 부족 중' });
      await s.flush();
      expect(s.status).toBe('error');
      expect((s.lastError as DOMException).name).toBe('QuotaExceededError');
      full = false;
      await new Promise((r) => setTimeout(r, 1300));
      expect(s.status).toBe('saved');
      expect(s.lastError).toBeNull();
    } finally { console.error = err; }
    const r = await openNote(store, e.note.id);
    if (!r.ok) throw new Error(r.reason);
    expect(snap(r.engine)).toBe(snap(e));
  });

  it('없는 노트는 not-found', async () => {
    const store = await IdbNoteStore.open(`t-${Math.random()}`);
    expect(await openNote(store, 'x'.repeat(22))).toEqual({ ok: false, reason: 'not-found' });
  });
});
