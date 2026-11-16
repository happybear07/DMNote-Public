// 버전 기록 저장소 (FR-093): 남기기 · 새것부터 목록 · 내용 읽기 · 노트당 한도 정리 · 노트 삭제 시 함께 삭제 · v1 DB에서 올리기
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createTextBlock, deserialize, Engine, newId, serialize } from '@dn/engine-core';
import { IdbNoteStore, MAX_VERSIONS_PER_NOTE } from '../src';

const snap = (title: string, blocks = 1) => {
  const e = new Engine({ note: { id: newId(), title, createdAt: 1, updatedAt: 1 } });
  for (let i = 0; i < blocks; i++) createTextBlock(e, { x: i * 300, y: 0 }, { body: `${title} ${i}` });
  return serialize(e);
};

describe('버전 기록 저장소', () => {
  it('남기기 · 목록(새것부터) · 내용 읽기', async () => {
    const store = await IdbNoteStore.open(`v-${newId()}`);
    await store.saveVersion({ noteId: 'n1', reason: 'auto', title: '첫', blocks: 1, at: 1000 }, snap('첫'));
    await store.saveVersion({ noteId: 'n1', reason: 'close', title: '둘', blocks: 2, at: 2000 }, snap('둘', 2));
    await store.saveVersion({ noteId: 'n2', reason: 'auto', title: '다른 노트', blocks: 1, at: 1500 }, snap('x'));
    const list = await store.listVersions('n1');
    expect(list.map((v) => v.title)).toEqual(['둘', '첫']);
    expect(list[0]).not.toHaveProperty('snapshot');
    const r = deserialize(await store.getVersion('n1', 1000));
    expect(r.ok && r.data.note.title).toBe('첫');
    store.close();
  });

  it(`노트당 ${MAX_VERSIONS_PER_NOTE}개까지 — 오래된 것부터 정리, 노트를 지우면 버전도`, async () => {
    const store = await IdbNoteStore.open(`v-${newId()}`);
    const s = snap('a');
    for (let i = 0; i < MAX_VERSIONS_PER_NOTE + 5; i++) await store.saveVersion({ noteId: 'n1', reason: 'auto', title: `v${i}`, blocks: 1, at: 10_000 + i }, s);
    const list = await store.listVersions('n1');
    expect(list).toHaveLength(MAX_VERSIONS_PER_NOTE);
    expect(list.at(-1)!.title).toBe('v5');
    await store.deleteNote('n1');
    expect(await store.listVersions('n1')).toHaveLength(0);
    store.close();
  });

  it('v1 DB를 열면 versions 저장소가 생긴다 (기존 데이터 유지)', async () => {
    const name = `v-${newId()}`;
    await new Promise<void>((res, rej) => {
      const r = indexedDB.open(name, 1);
      r.onupgradeneeded = () => { const db = r.result; db.createObjectStore('snapshots', { keyPath: 'noteId' }); db.createObjectStore('oplog', { keyPath: ['noteId', 'seq'] }); db.createObjectStore('views', { keyPath: 'noteId' }); db.createObjectStore('backups', { keyPath: ['noteId', 'key'] }).createIndex('by_note', 'noteId'); };
      r.onsuccess = () => { const db = r.result; const tx = db.transaction('snapshots', 'readwrite'); tx.objectStore('snapshots').put({ noteId: 'old', snapshot: snap('옛'), upToSeq: 0 }); tx.oncomplete = () => { db.close(); res(); }; };
      r.onerror = () => rej(r.error);
    });
    const store = await IdbNoteStore.open(name);
    expect(await store.load('old')).not.toBeNull();
    await store.saveVersion({ noteId: 'old', reason: 'manual', title: '옛', blocks: 1 }, snap('옛'));
    expect(await store.listVersions('old')).toHaveLength(1);
    store.close();
  });
});
