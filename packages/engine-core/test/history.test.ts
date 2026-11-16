// 실행 취소 기록 (알파 10/31 "한 번밖에 안 된다"): 노트를 연 뒤의 작업을 거의 다 되돌리고 다시 실행한다 ·
// 이어 친 글자는 쉬면(1초) 또는 오래 이어지면(4초) 다음 기록으로.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTextBlock, Engine, moveBlocks } from '../src';

afterEach(() => { vi.useRealTimers(); });

describe('실행 취소 기록', () => {
  it('작업 300번을 하나씩 모두 되돌리고 다시 실행한다', () => {
    const e = new Engine();
    const r = createTextBlock(e, { x: 0, y: 0 }, { body: '상자' });
    if (!r.ok) throw new Error('setup');
    const id = r.value.blockId;
    for (let i = 0; i < 300; i++) moveBlocks(e, [id], 1, 0);
    expect(e.getBlock(id)!.x).toBe(300);
    let n = 0;
    while (e.undo()) n++;
    expect(n).toBe(301); // 옮기기 300 + 만들기 1
    expect(e.getBlock(id)).toBeUndefined();
    let m = 0;
    while (e.redo()) m++;
    expect(m).toBe(301);
    expect(e.getBlock(id)!.x).toBe(300);
  });

  it('같은 병합 키라도 처음 기록에서 4초가 지나면 다음 기록으로 — 쉬지 않고 쳐도', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const e = new Engine();
    const r = createTextBlock(e, { x: 0, y: 0 }, { body: '상자' });
    if (!r.ok) throw new Error('setup');
    const id = r.value.blockId;
    e.clearHistory();
    // 0.5초마다 6초 동안 (쉬는 틈은 1초보다 짧다)
    for (let t = 0; t <= 6000; t += 500) {
      vi.setSystemTime(t);
      e.transact((tx) => tx.set('block', id, { x: t + 1 }), { origin: 'user', mergeKey: 'k' });
    }
    expect(e.undo()).toBe(true);
    expect(e.getBlock(id)!.x).toBe(3501); // 4초부터의 것만 되돌림
    expect(e.undo()).toBe(true);
    expect(e.getBlock(id)!.x).toBe(0);
    expect(e.canUndo()).toBe(false);
  });
});
