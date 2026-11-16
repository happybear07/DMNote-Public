// 배포 QA E: 이전 버전 데이터에서 올라오기 · 다른 탭과의 버전 충돌 (docs/RELEASE-QA.md).
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { blockTextParts, docText, newId, SCHEMA_VERSION } from '@dn/engine-core';
import { IdbNoteStore, MetaStore, openNote } from '../src';

/** 옛 앱이 만든 dn-app (v1 · v2) — 그때의 업그레이드 코드 그대로 */
function openOld(name: string, version: 1 | 2, fill: (db: IDBDatabase) => void): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(name, version);
    r.onupgradeneeded = (e) => {
      const db = r.result;
      if (e.oldVersion < 1) {
        const s = db.createObjectStore('notes_meta', { keyPath: 'id' });
        s.createIndex('by_updated', 'updatedAt');
        s.createIndex('by_deleted', 'deletedAt');
        db.createObjectStore('settings', { keyPath: 'key' });
      }
      if (version >= 2 && e.oldVersion < 2) db.createObjectStore('secrets', { keyPath: 'name' });
    };
    r.onsuccess = () => {
      const db = r.result;
      fill(db);
      resolve(db);
    };
    r.onerror = () => reject(r.error);
  });
}

const put = (db: IDBDatabase, store: string, value: unknown) => new Promise<void>((res, rej) => {
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(value);
  tx.oncomplete = () => res();
  tx.onerror = () => rej(tx.error);
});

const para = (t: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });
const meta0 = { title: '옛 노트', createdAt: 1, updatedAt: 2, schemaVersion: 1 as const };

describe('dn-app 이전 버전에서 v3로 올라오기 (FR-090)', () => {
  it('v1: 노트 메타 · 설정이 그대로 · 새 스토어(폴더 · 태그 · 검색)가 생김', async () => {
    const name = `up1-${Math.random()}`;
    const old = await openOld(name, 1, () => {});
    await put(old, 'notes_meta', { ...meta0, id: 'n1' });
    await put(old, 'settings', { key: 'noteSort', value: 'title', scope: 'device', updatedAt: 1 });
    old.close();
    const m = await MetaStore.open(name);
    expect((await m.list()).map((n) => n.title)).toEqual(['옛 노트']);
    expect(await m.getSetting('noteSort')).toBe('title');
    expect(await m.listFolders()).toEqual([]);
    expect(await m.listTags()).toEqual([]);
    await m.putFolder({ id: 'f1', name: '폴더', createdAt: 1, updatedAt: 1 });
    expect(await m.patch('n1', { folderId: 'f1', tagIds: ['t1'] })).toMatchObject({ folderId: 'f1' });
  });

  it('v2: 암호화된 API 키가 v3에서도 풀림', async () => {
    const name = `up2-${Math.random()}`;
    // v2 시절 setSecret과 같은 방식(추출 불가 AES-GCM 키를 같은 스토어에)으로 저장
    const kek = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, new TextEncoder().encode('sk-ant-old-key-9999'));
    const old = await openOld(name, 2, () => {});
    await put(old, 'secrets', { name: '__kek', key: kek });
    await put(old, 'secrets', { name: 'anthropic-api-key', iv, data, meta: { last4: '9999' }, updatedAt: 1 });
    await put(old, 'notes_meta', { ...meta0, id: 'n1' });
    old.close();
    const m = await MetaStore.open(name);
    expect(await m.getSecret('anthropic-api-key')).toBe('sk-ant-old-key-9999');
    expect(await m.secretMeta('anthropic-api-key')).toEqual({ last4: '9999' });
    expect(await m.list()).toHaveLength(1);
  });

  it('스냅샷 schemaVersion 2 노트도 열리고 v3로 다시 저장됨', async () => {
    const store = await IdbNoteStore.open(`up-n-${Math.random()}`);
    const noteId = newId(), b1 = newId(), t1 = newId(), c1 = newId();
    const v2 = {
      schemaVersion: 2, engine: { textSchema: 'pm-v1' }, note: { id: noteId, title: 'v2 노트', createdAt: 1, updatedAt: 1 },
      blocks: { [b1]: { id: b1, x: 0, y: 0, w: 260, h: 84, sizing: 'auto', layout: 'flow', z: 'a0' } },
      contents: {
        [t1]: { id: t1, blockId: b1, order: 'a0', type: 'text', role: 'title', doc: para('제목줄') },
        [c1]: { id: c1, blockId: b1, order: 'a1', type: 'text', role: 'body', doc: para('본문줄') },
      },
      arrows: {}, strokes: {},
    };
    await store.compact(noteId, v2 as never, 0);
    const r = await openNote(store, noteId);
    if (!r.ok) throw new Error(r.reason);
    const parts = blockTextParts(r.engine.contentsOf(b1));
    expect(docText(parts.bodies[0]!.doc)).toBe('제목줄\n본문줄');
    const saved = await store.load(noteId);
    expect((saved!.snapshot as { schemaVersion: number }).schemaVersion).toBe(SCHEMA_VERSION);
  });
});

describe('다른 탭과의 버전 충돌 (배포 QA E2)', () => {
  it('옛 버전 연결이 열려 있으면 실패하지 않고 blocked를 알린 뒤, 닫히면 이어서 열림', async () => {
    const name = `blk-${Math.random()}`;
    const old = await openOld(name, 2, () => {});
    old.onversionchange = null; // 옛 앱은 비켜 주지 않는다
    let blocked = 0;
    const opening = MetaStore.open(name, { blocked: () => { blocked++; } });
    await new Promise((r) => setTimeout(r, 50));
    expect(blocked).toBe(1);
    old.close();
    const m = await opening;
    expect(await m.listFolders()).toEqual([]);
  });

  it('새 버전이 DB를 올리려 하면 열린 연결은 알린 뒤 닫아 길을 비켜 줌', async () => {
    const name = `vc-${Math.random()}`;
    let changed = 0;
    await MetaStore.open(name, { versionChange: () => { changed++; } });
    const upgraded = await new Promise<string>((resolve) => {
      const r = indexedDB.open(name, 99);
      r.onblocked = () => resolve('blocked');
      r.onsuccess = () => { r.result.close(); resolve('ok'); };
      r.onerror = () => resolve('error');
    });
    expect(upgraded).toBe('ok');
    expect(changed).toBe(1);
  });

  it('IdbNoteStore도 같은 방식으로 비켜 줌', async () => {
    const name = `vcn-${Math.random()}`;
    let changed = 0;
    await IdbNoteStore.open(name, { versionChange: () => { changed++; } });
    const upgraded = await new Promise<string>((resolve) => {
      const r = indexedDB.open(name, 99);
      r.onblocked = () => resolve('blocked');
      r.onsuccess = () => { r.result.close(); resolve('ok'); };
    });
    expect(upgraded).toBe('ok');
    expect(changed).toBe(1);
  });
});
