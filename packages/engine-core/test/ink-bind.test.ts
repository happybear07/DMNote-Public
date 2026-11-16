// 잉크 묶기 · 풀기 (FR-037): 겹치는 블록에 / 새 블록에, 블록과 함께 이동 · 비율 유지, 왕복 무손실, 삭제 · 복제 · 실행 취소 · 직렬화
import { describe, expect, it } from 'vitest';
import {
  addStroke, bindStrokes, boundStrokesWorld, createTextBlock, deleteEntities, deleteStrokes, deserialize, duplicateBlocks, Engine, freeStrokes, isInkContent,
  isStroke, moveBlocks, type TxResult, resizeBlock, serialize, strokeBounds, unbindInk, type Stroke,
} from '../src';

const zig = (x: number, y: number) => ({ tool: 'pen' as const, color: '#000', width: 3, origin: { x, y }, points: [0, 0, 0.5, 0, 20, 15, 0.5, 8, 40, 0, 0.5, 16, 60, 15, 0.5, 24] });
const val = <T,>(r: TxResult<T>): T => { if (!r.ok) throw new Error(r.reason); return r.value; };
const strokes = (e: Engine) => [...e.strokes()].filter(isStroke);
const inkOf = (e: Engine, blockId: string) => e.contentsOf(blockId).find(isInkContent)!;

describe('잉크 묶기 · 풀기', () => {
  it('묶인 획을 다 지우면 빈 잉크 콘텐츠도 같은 트랜잭션에서 지운다 (I4 · SYNC N6) — 하나라도 남으면 그대로, 실행 취소 한 번에 둘 다 돌아옴', () => {
    const e = new Engine();
    const { blockId } = val(createTextBlock(e, { x: 0, y: 0 }, { body: '글', w: 200, h: 80 }))!;
    const a = val(addStroke(e, zig(150, 40)))!, b = val(addStroke(e, zig(160, 50)))!;
    val(bindStrokes(e, [a, b]));
    const ink = inkOf(e, blockId).id;
    deleteStrokes(e, [a]);
    expect(e.getContent(ink)).toBeTruthy();
    deleteStrokes(e, [b]);
    expect(e.getContent(ink)).toBeUndefined();
    expect(e.getBlock(blockId)).toBeTruthy(); // 블록 · 글은 그대로
    e.undo();
    expect(e.getContent(ink)).toBeTruthy();
    expect(e.getStroke(b)).toBeTruthy();
  });

  it('빈 캔버스: 잉크 크기의 새 블록 · 묶인 획은 그 자리 그대로 그려짐', () => {
    const e = new Engine();
    const a = val(addStroke(e, zig(500, 500)))!, b = val(addStroke(e, zig(520, 540)))!;
    const before = [a, b].map((id) => strokeBounds(e.getStroke(id) as Stroke));
    const r = bindStrokes(e, [a, b]);
    const blockId = val(r)!;
    expect(freeStrokes(e)).toHaveLength(0);
    const blk = e.getBlock(blockId)!;
    expect(blk.x).toBeCloseTo(Math.min(before[0]!.x, before[1]!.x));
    const world = boundStrokesWorld(e).map(strokeBounds);
    world.forEach((w, i) => { expect(w.x).toBeCloseTo(before[i]!.x, 6); expect(w.y).toBeCloseTo(before[i]!.y, 6); });
    expect(inkOf(e, blockId).order).toBeTruthy();
    e.undo();
    expect(freeStrokes(e)).toHaveLength(2);
    expect(e.getBlock(blockId)).toBeUndefined();
  });

  it('블록에 걸치면 그 블록에 · 블록을 옮기면 따라가고 너비를 바꾸면 비율 유지', () => {
    const e = new Engine();
    const { blockId } = val(createTextBlock(e, { x: 0, y: 0 }, { body: '글', w: 200, h: 80 }))!;
    const s = val(addStroke(e, zig(150, 40)))!;
    expect(val(bindStrokes(e, [s]))).toBe(blockId);
    expect(e.getBlock(blockId)!.w).toBeGreaterThan(200); // 잉크까지 넓힘
    const w0 = strokeBounds(boundStrokesWorld(e)[0]!);
    moveBlocks(e, [blockId], 100, 50);
    const w1 = strokeBounds(boundStrokesWorld(e)[0]!);
    expect(w1.x - w0.x).toBeCloseTo(100); expect(w1.y - w0.y).toBeCloseTo(50);
    const b = e.getBlock(blockId)!;
    resizeBlock(e, blockId, { x: b.x, y: b.y, w: b.w * 2, h: b.h * 2 }, true);
    const w2 = strokeBounds(boundStrokesWorld(e)[0]!);
    expect(w2.w / w1.w).toBeGreaterThan(1.9);
  });

  it('풀기: 블록이 그대로면 묶기 전 좌표로 무손실 · 다른 내용이 없으면 블록도 지움', () => {
    const e = new Engine();
    const id = val(addStroke(e, zig(333.3, 77.7)))!;
    const orig = e.getStroke(id) as Stroke;
    const blockId = val(bindStrokes(e, [id]))!;
    unbindInk(e, inkOf(e, blockId).id);
    const back = e.getStroke(id) as Stroke;
    expect(back.parent).toEqual({ kind: 'layer' });
    expect(back.origin).toEqual(orig.origin);
    expect(back.scale).toBe(orig.scale);
    expect(e.getBlock(blockId)).toBeUndefined();
  });

  it('블록 삭제 · 복제는 묶인 획도 함께, 직렬화 왕복', () => {
    const e = new Engine();
    const blockId = val(bindStrokes(e, [val(addStroke(e, zig(0, 0)))!, val(addStroke(e, zig(10, 30)))!]))!;
    const dup = val(duplicateBlocks(e, [blockId]))![0]!;
    expect(strokes(e)).toHaveLength(4);
    const copy = deserialize(serialize(e));
    expect(copy.ok && [...new Engine(copy.data).strokes()].length).toBe(4);
    deleteEntities(e, [blockId]);
    expect(strokes(e)).toHaveLength(2);
    expect(strokes(e).every((s) => s.parent.kind === 'content' && s.parent.contentId === inkOf(e, dup).id)).toBe(true);
  });
});
