// S4 큰 노트 측정 (SYNC.md 19.5 · R2): 1만 블록 노트의 Y 크기 · 다른 기기에서 받기(applyUpdate) + 첫 attach 시간.
// 기준 기기에서 100ms 이하면 메인 스레드 유지(9.3 · OD-5). 측정만 하므로 평소에는 건너뛰고 DN_BENCH=1일 때만 돈다.
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { bodyDoc, Engine, newId } from '@dn/engine-core';
import { attach } from '../src';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const N = Number(env.DN_BENCH_BLOCKS ?? 10_000);

describe.skipIf(!env.DN_BENCH)('큰 노트 (S4)', () => {
  it(`${N}블록 노트: Y 크기 · 받기 + 첫 attach 시간`, () => {
    const id = newId();
    const a = new Engine({ note: { id, title: '큰 노트', createdAt: 1, updatedAt: 1 } });
    a.transact((tx) => {
      for (let i = 0; i < N; i++) {
        const b = tx.createBlock({ x: (i % 100) * 300, y: Math.floor(i / 100) * 120, w: 260, h: 84 });
        tx.createContent({ blockId: b, type: 'text', role: 'body', doc: bodyDoc(`블록 ${i} — 본문 한 줄과 조금 더 긴 글`) });
      }
    }, { origin: 'load' });
    const da = new Y.Doc();
    let t = performance.now();
    attach(a, da);
    const firstWrite = performance.now() - t;
    const update = Y.encodeStateAsUpdate(da);

    const db = new Y.Doc();
    const b = new Engine({ note: { id, title: '', createdAt: 1, updatedAt: 1 } });
    t = performance.now();
    Y.applyUpdate(db, update);
    const apply = performance.now() - t;
    t = performance.now();
    attach(b, db);
    const attachMs = performance.now() - t;

    const row = { blocks: N, bytes: update.length, kbPerBlock: +(update.length / N / 1024).toFixed(3), firstWriteMs: Math.round(firstWrite), applyMs: Math.round(apply), attachMs: Math.round(attachMs), receiveTotalMs: Math.round(apply + attachMs) };
    console.log('S4 큰 노트', JSON.stringify(row));
    expect([...b.blocks()].length).toBe(N);
  }, 300_000);
});
