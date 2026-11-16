// 원격 변경 뒤의 실행 취소 (SYNC.md 13.7): 다른 탭 · 기기가 나중에 쓴 값을 덮지 않고, 그쪽이 지운 것 위로 되살리다 실패하지 않는다.
// 원격 변경 = origin 'remote' 트랜잭션(동기화 다리가 쓰는 것과 같다)
import { describe, expect, it } from 'vitest';
import { createTextBlock, deleteEntities, Engine, moveBlocks, setBlockColor, type Id } from '../src';

const remote = (e: Engine, fn: Parameters<Engine['transact']>[0]) => {
  const r = e.transact(fn, { origin: 'remote', undoable: false });
  if (!r.ok) throw new Error(r.reason);
};
function setup() {
  const e = new Engine();
  const r = createTextBlock(e, { x: 0, y: 0 }, { body: '본문' });
  if (!r.ok) throw new Error('setup');
  e.clearHistory();
  return { e, id: r.value.blockId, cid: r.value.contentId };
}

describe('원격 변경 뒤 실행 취소', () => {
  it('내가 옮긴 블록을 다른 곳이 또 옮겼으면 되돌리지 않는다 (다른 곳 값을 존중) — 그 기록은 버린다', () => {
    const { e, id } = setup();
    moveBlocks(e, [id], 100, 0);
    remote(e, (tx) => tx.set('block', id, { x: 300 }));
    expect(e.undo()).toBe(false);
    expect(e.getBlock(id)!.x).toBe(300);
    expect(e.canUndo()).toBe(false);
  });

  it('겹친 연산만 건너뛰고 나머지는 되돌린다 — 일부만 되돌렸다고 알린다', () => {
    const { e, id } = setup();
    const seen: [string, number][] = [];
    e.undoNotice = (k, n) => seen.push([k, n]);
    e.transact((tx) => tx.set('block', id, { x: 50, style: { color: 'blue' } }), { origin: 'user' });
    remote(e, (tx) => tx.set('block', id, { x: 300 }));
    expect(e.undo()).toBe(true);
    expect(e.getBlock(id)!.x).toBe(300); // 다른 곳 값
    expect(e.getBlock(id)!.style).toBeUndefined(); // 내 색 변경은 되돌림
    expect(seen).toEqual([['undo', 1]]);
  });

  it('내가 만든 블록에 다른 곳이 콘텐츠를 더했으면 블록을 지우지 않는다 (되돌리기가 실패하지도 않는다)', () => {
    const e = new Engine();
    const r = createTextBlock(e, { x: 0, y: 0 }, { body: '새 상자' });
    if (!r.ok) throw new Error();
    const id = r.value.blockId;
    remote(e, (tx) => tx.createContent({ blockId: id, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'paragraph' }] } } as never));
    e.undo();
    expect(e.getBlock(id)).toBeTruthy();
    expect(e.contentsOf(id).length).toBe(1); // 내 콘텐츠는 지웠고 다른 곳 콘텐츠는 남음
  });

  it('내가 지운 콘텐츠의 블록을 다른 곳이 지웠으면, 되돌릴 때 콘텐츠를 되살리지 않고 실패하지도 않는다', () => {
    const { e, id, cid } = setup();
    e.transact((tx) => tx.delete('content', cid), { origin: 'user' });
    remote(e, (tx) => tx.delete('block', id));
    expect(() => e.undo()).not.toThrow();
    expect(e.getContent(cid as Id)).toBeUndefined();
    expect(e.getBlock(id)).toBeUndefined();
  });

  it('되돌린 뒤 다른 곳이 그 블록을 바꾸면 다시 실행 기록은 버린다', () => {
    const { e, id } = setup();
    setBlockColor(e, [id], 'red');
    e.undo();
    expect(e.canRedo()).toBe(true);
    remote(e, (tx) => tx.set('block', id, { y: 40 }));
    expect(e.canRedo()).toBe(false);
  });

  it('원격 변경이 없으면 예전과 똑같다 — 삭제 되돌리기 · 다시 실행 왕복', () => {
    const { e, id } = setup();
    const before = JSON.stringify([...e.blocks(), ...e.contents()]);
    deleteEntities(e, [id]);
    expect(e.undo()).toBe(true);
    expect(JSON.stringify([...e.blocks(), ...e.contents()])).toBe(before);
    expect(e.redo()).toBe(true);
    expect(e.getBlock(id)).toBeUndefined();
  });

  it('사이에 원격 변경이 있으면 같은 병합 키라도 기록을 합치지 않는다', () => {
    const { e, id } = setup();
    e.transact((tx) => tx.set('block', id, { x: 10 }), { origin: 'user', mergeKey: 'k' });
    remote(e, (tx) => tx.set('block', id, { y: 99 }));
    e.transact((tx) => tx.set('block', id, { x: 20 }), { origin: 'user', mergeKey: 'k' });
    e.undo();
    expect(e.getBlock(id)!.x).toBe(10); // 두 번째만 되돌림
    e.undo();
    expect(e.getBlock(id)!.x).toBe(0);
    expect(e.getBlock(id)!.y).toBe(99);
  });
});
