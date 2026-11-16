import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { MetaStore } from '../src';

describe('MetaStore 비밀값 (SECURITY 4절)', () => {
  it('암호화해 저장하고 복호화해 돌려준다 · 평문은 저장소에 없다', async () => {
    const name = `m-${Math.random()}`;
    const m = await MetaStore.open(name);
    await m.setSecret('anthropic', 'sk-ant-secret-1234', { last4: '1234' });
    expect(await m.getSecret('anthropic')).toBe('sk-ant-secret-1234');
    expect(await m.secretMeta('anthropic')).toEqual({ last4: '1234' });
    // 원시 레코드에 평문이 없어야 한다
    const raw = await new Promise<unknown>((res) => {
      const r = indexedDB.open(name);
      r.onsuccess = () => { const g = r.result.transaction('secrets').objectStore('secrets').get('anthropic'); g.onsuccess = () => res(g.result); };
    });
    expect(JSON.stringify(raw)).not.toContain('sk-ant');
    await m.deleteSecret('anthropic');
    expect(await m.getSecret('anthropic')).toBeUndefined();
  });

  it('휴지통 만료 대상', async () => {
    const m = await MetaStore.open(`m-${Math.random()}`);
    const base = { title: '', createdAt: 0, updatedAt: 0, schemaVersion: 1 as const };
    await m.put({ ...base, id: 'old', deletedAt: 1 });
    await m.put({ ...base, id: 'new', deletedAt: 100 });
    await m.put({ ...base, id: 'live' });
    expect(await m.expired(50)).toEqual(['old']);
  });
});
