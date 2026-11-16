// 잠금 금고 · 잠긴 노트 암호화 (FR-144 · FR-146): 비밀번호 확인 · 바꾸기, 잠그면 IDB 원본 어디에도 글자가 평문으로 없음,
// 금고가 잠기면 못 읽음, 잠긴 채 고친 것도 암호화로 이어 쓰기, 풀면 평문으로 되돌림, 버전도 함께
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { blockTextParts, createTextBlock, docText, Engine, newId, serialize, setText, bodyDoc } from '@dn/engine-core';
import { changeVaultPassword, createVault, IdbNoteStore, openNote, openVault, VaultLockedError } from '../src';

const SECRET = '비밀 계획 문서 ABC-123';

/** IDB의 모든 저장소 원본을 JSON으로 — 평문이 남았는지 찾는다 (ArrayBuffer는 내용 대신 길이만) */
async function rawDump(name: string): Promise<string> {
  const db = await new Promise<IDBDatabase>((res, rej) => { const r = indexedDB.open(name); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const out: unknown[] = [];
  for (const s of ['snapshots', 'oplog', 'versions', 'backups']) {
    const all = await new Promise<unknown[]>((res) => { const r = db.transaction(s).objectStore(s).getAll(); r.onsuccess = () => res(r.result); });
    out.push(all);
  }
  db.close();
  return JSON.stringify(out, (_k, v) => (v instanceof ArrayBuffer ? `<${v.byteLength}>` : v instanceof Uint8Array ? `<iv>` : v));
}

describe('잠금 금고', () => {
  it('비밀번호: 맞으면 열리고 틀리면 null, 바꾸면 새 비밀번호로만', async () => {
    const { record } = await createVault('first-pass', 1000);
    expect(await openVault(record, 'wrong')).toBeNull();
    const c = await openVault(record, 'first-pass');
    const sealed = await c!.seal({ a: SECRET });
    const next = await changeVaultPassword(record, 'first-pass', 'second-pass');
    expect(next).not.toBeNull();
    expect(await changeVaultPassword(record, 'nope', 'x')).toBeNull();
    expect(await openVault(next!, 'first-pass')).toBeNull();
    const c2 = await openVault(next!, 'second-pass');
    expect(await c2!.open(sealed)).toEqual({ a: SECRET }); // 같은 데이터 키 — 노트를 다시 암호화하지 않아도 된다
  });

  it('잠그기 → 원본에 평문 없음 · 금고 잠기면 못 읽음 · 잠긴 채 고친 것도 암호화 · 풀기', async () => {
    const name = `vault-${newId()}`;
    let store = await IdbNoteStore.open(name);
    const { cipher } = await createVault('pw', 1000);
    store.setVault(cipher);
    // 평문 노트 하나 (편집 로그 + 버전 포함)
    const e = new Engine({ note: { id: newId(), title: '계획', createdAt: 1, updatedAt: 1 } });
    const id = e.note.id;
    await store.compact(id, serialize(e), 0);
    const opened = await openNote(store, id);
    if (!opened.ok) throw new Error('open');
    const { blockId } = createTextBlock(opened.engine, { x: 0, y: 0 }, { body: SECRET }).value as { blockId: string };
    await opened.session.flush();
    await store.saveVersion({ noteId: id, reason: 'manual', title: '계획', blocks: 1 }, serialize(opened.engine));
    expect(await rawDump(name)).toContain(SECRET);

    await store.setNoteLocked(id, true, serialize(opened.engine));
    expect(await rawDump(name)).not.toContain(SECRET);
    // 잠긴 채 고치기 → 로그도 암호문
    const cid = blockTextParts(opened.engine.contentsOf(blockId)).bodies[0]!.id;
    setText(opened.engine, cid, bodyDoc(`${SECRET} 추가`));
    await opened.session.flush();
    expect(await rawDump(name)).not.toContain('추가');
    await opened.session.dispose();

    // 새로 열기: 금고가 잠기면 못 읽음
    store.close();
    store = await IdbNoteStore.open(name);
    await expect(openNote(store, id)).rejects.toBeInstanceOf(VaultLockedError);
    store.setVault(cipher);
    const again = await openNote(store, id);
    if (!again.ok) throw new Error('reopen');
    const body = blockTextParts(again.engine.contentsOf(blockId)).bodies[0]!;
    expect(docText(body.doc)).toBe(`${SECRET} 추가`);
    expect((await store.listVersions(id)).length).toBe(1);
    const ver = await store.getVersion(id, (await store.listVersions(id))[0]!.at);
    expect(JSON.stringify(ver)).toContain(SECRET);

    // 풀기 → 평문으로
    await store.setNoteLocked(id, false, serialize(again.engine));
    await again.session.dispose();
    store.setVault(null);
    store.close();
    store = await IdbNoteStore.open(name);
    const plain = await openNote(store, id);
    expect(plain.ok).toBe(true);
    expect(await rawDump(name)).toContain(SECRET);
    if (plain.ok) await plain.session.dispose();
    store.close();
  });

  it('동기화 노트를 잠그면 저장된 Y 기록도 암호문으로, 풀면 평문으로 (known · base 그대로)', async () => {
    const name = `vault-sync-${newId()}`;
    const store = await IdbNoteStore.open(name);
    const { cipher } = await createVault('pw', 1000);
    store.setVault(cipher);
    const e = new Engine({ note: { id: newId(), title: '동기화 노트', createdAt: 1, updatedAt: 1 } });
    const id = e.note.id;
    await store.compact(id, serialize(e), 0);
    const update = new TextEncoder().encode(SECRET); // 내용은 상관없다 — 바이트가 평문으로 남는지만 본다
    await store.putSync({ noteId: id, update, base: { b1: 'fp' }, syncedAt: 5, known: ['b1'] });
    const raw = async () => {
      const db = await new Promise<IDBDatabase>((res, rej) => { const r = indexedDB.open(name); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const v = await new Promise<Record<string, unknown>>((res) => { const r = db.transaction('ysync').objectStore('ysync').get(id); r.onsuccess = () => res(r.result); });
      db.close();
      return v;
    };
    expect((await raw()).update).toBeInstanceOf(Uint8Array);

    await store.setNoteLocked(id, true, serialize(e));
    const sealed = await raw();
    expect(sealed.update).toBeUndefined();
    expect(sealed.known).toBeUndefined();
    expect(sealed.sealed).toBeTruthy();
    const read = await store.getSync(id);
    expect(new TextDecoder().decode(read!.update)).toBe(SECRET);
    expect(read!.known).toEqual(['b1']);

    await store.setNoteLocked(id, false, serialize(e));
    const back = await raw();
    expect(back.sealed).toBeUndefined();
    expect(new TextDecoder().decode(back.update as Uint8Array)).toBe(SECRET);
    expect(back.known).toEqual(['b1']);
    expect(back.base).toEqual({ b1: 'fp' });
    store.close();
  });
});
