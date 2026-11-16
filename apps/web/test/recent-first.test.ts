// 찾는 말이 없을 때의 노트 목록 (빠른 전환 · 노트 링크 · 다른 노트로 옮기기가 같이 쓴다)
import { describe, expect, it } from 'vitest';
import type { NoteMeta } from '@dn/storage-idb';
import { recentFirst } from '../src/ws-model';

const note = (id: string): NoteMeta => ({ id, title: id, createdAt: 0, updatedAt: 0, schemaVersion: 1 }) as NoteMeta;

describe('recentFirst', () => {
  const notes = ['a', 'b', 'c', 'd'].map(note);

  it('최근 연 노트를 연 차례로 먼저, 나머지는 목록 차례 — 겹치지 않게', () => {
    expect(recentFirst(notes, ['c', 'a']).map((n) => n.id)).toEqual(['c', 'a', 'b', 'd']);
  });

  it('최근 목록에만 있는(지운) 노트는 건너뛴다', () => {
    expect(recentFirst(notes, ['x', 'd']).map((n) => n.id)).toEqual(['d', 'a', 'b', 'c']);
  });

  it('최근이 비면 목록 그대로', () => {
    expect(recentFirst(notes, []).map((n) => n.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});
