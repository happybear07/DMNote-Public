// 빈 곳 화살표 (11/09): 끝이 상자가 아니라 캔버스의 점일 수 있다 — 그리기 · 옮기기 · 복사 · 저장 · 삭제 · 불변식.
// 흐름(문서 순서)에는 들어가지 않는다 — 상자 둘을 이은 것만 관계다.
import { describe, expect, it } from 'vitest';
import {
  blockClip, createArrow, createTextBlock, deleteEntities, deserialize, documentOrder, Engine, isBlockEnd, isBound, moveArrowPoints, moveBlocks,
  pasteBlockClip, reconnectArrow, serialize, type TextDoc, type TxResult,
} from '../src';

const val = <T,>(r: TxResult<T>): T => { if (!r.ok) throw new Error(r.reason); return r.value; };
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }) as TextDoc;

function note() {
  const e = new Engine();
  const a = val(createTextBlock(e, { x: 0, y: 0 }, { doc: doc('가') }));
  const b = val(createTextBlock(e, { x: 0, y: 400 }, { doc: doc('나') }));
  e.clearHistory();
  return { e, a: a.blockId, b: b.blockId };
}

describe('빈 곳 화살표', () => {
  it('두 끝이 모두 점이어도 그려지고, 눌러 고를 수 있고, 문서 순서에는 안 들어간다', () => {
    const { e } = note();
    const id = val(createArrow(e, { point: { x: 600, y: 100 } }, { point: { x: 900, y: 100 } }));
    const g = e.arrowGeometry(e.getArrow(id)!)!;
    expect(g.a).toEqual({ x: 600, y: 100 });
    expect(g.b).toEqual({ x: 900, y: 100 });
    expect(e.hitTest({ x: 750, y: 101 })).toEqual({ kind: 'arrow', id });
    expect(isBound(e.getArrow(id)!)).toBe(false);
    expect(documentOrder(e).length).toBe(2); // 상자 둘만
  });

  it('길이 0인 점 화살표는 그리지 않는다', () => {
    const { e } = note();
    const id = val(createArrow(e, { point: { x: 600, y: 100 } }, { point: { x: 600, y: 100 } }));
    expect(e.arrowGeometry(e.getArrow(id)!)).toBeUndefined();
  });

  it('한 끝만 상자면 그 상자를 옮길 때 따라가고, 점 끝은 그대로', () => {
    const { e, a } = note();
    const id = val(createArrow(e, { blockId: a, side: 'auto' }, { point: { x: 800, y: 50 } }));
    const before = e.arrowGeometry(e.getArrow(id)!)!;
    expect(before.b).toEqual({ x: 800, y: 50 });
    val(moveBlocks(e, [a], 0, 100));
    const after = e.arrowGeometry(e.getArrow(id)!)!;
    expect(after.b).toEqual({ x: 800, y: 50 });
    expect(after.a.y).not.toBe(before.a.y);
    expect(e.arrowsOf(a).map((x) => x.id)).toEqual([id]);
  });

  it('몸통 옮기기: 점 끝만 움직이고, 이어 끈 움직임은 실행 취소 한 번에 돌아간다', () => {
    const { e, a } = note();
    const id = val(createArrow(e, { blockId: a, side: 'auto' }, { point: { x: 800, y: 50 } }));
    e.breakUndoMerge();
    val(moveArrowPoints(e, id, { x: 10, y: 5 }));
    val(moveArrowPoints(e, id, { x: 10, y: 5 }));
    const ar = e.getArrow(id)!;
    expect(ar.to).toEqual({ point: { x: 820, y: 60 } });
    expect(ar.from).toEqual({ blockId: a, side: 'auto' });
    e.undo();
    expect(e.getArrow(id)!.to).toEqual({ point: { x: 800, y: 50 } });
  });

  it('끝을 상자에서 떼어 점으로 · 점에서 다시 상자로', () => {
    const { e, a, b } = note();
    const id = val(createArrow(e, { blockId: a, side: 'auto' }, { blockId: b, side: 'auto' }));
    val(reconnectArrow(e, id, 'to', { point: { x: 700, y: 700 } }));
    expect(e.arrowsOf(b)).toEqual([]);
    expect(isBlockEnd(e.getArrow(id)!.to)).toBe(false);
    val(reconnectArrow(e, id, 'to', { blockId: b, side: 'auto' }));
    expect(e.arrowsOf(b).map((x) => x.id)).toEqual([id]);
  });

  it('상자를 지우면 그 상자에 붙은 반쪽 화살표도 같이 지워진다', () => {
    const { e, a } = note();
    const id = val(createArrow(e, { blockId: a, side: 'auto' }, { point: { x: 800, y: 50 } }));
    val(deleteEntities(e, [a]));
    expect(e.getArrow(id)).toBeUndefined();
    e.undo();
    expect(e.getArrow(id)?.to).toEqual({ point: { x: 800, y: 50 } });
  });

  it('복사 · 붙여넣기: 고른 상자에서 빈 곳을 가리키는 화살표는 점 끝을 같은 거리만큼 옮겨 붙인다', () => {
    const { e, a } = note();
    val(createArrow(e, { blockId: a, side: 'auto' }, { point: { x: 800, y: 50 } }));
    const clip = blockClip(e, [a]);
    expect(clip.arrows).toHaveLength(1);
    const [na] = val(pasteBlockClip(e, clip, { x: 1000, y: 1000 }));
    const pasted = e.arrowsOf(na!);
    expect(pasted).toHaveLength(1);
    expect(pasted[0]!.to).toEqual({ point: { x: 1800, y: 1050 } });
  });

  it('저장 → 열기에서 점 끝이 그대로 남는다', () => {
    const { e, a } = note();
    const id = val(createArrow(e, { blockId: a, side: 'auto' }, { point: { x: 800, y: 50 } }));
    const free = val(createArrow(e, { point: { x: 10, y: 900 } }, { point: { x: 300, y: 900 } }));
    const r = deserialize(JSON.parse(JSON.stringify(serialize(e))));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const e2 = new Engine(r.data);
    expect(e2.getArrow(id)?.to).toEqual({ point: { x: 800, y: 50 } });
    expect(e2.getArrow(free)?.from).toEqual({ point: { x: 10, y: 900 } });
  });

  it('끝이 상자도 점도 아니면 커밋을 막는다', () => {
    const { e } = note();
    const r = e.transact((tx) => tx.createArrow({ from: {} as never, to: { point: { x: 1, y: 1 } } }), { origin: 'user' });
    expect(r.ok).toBe(false);
  });
});
