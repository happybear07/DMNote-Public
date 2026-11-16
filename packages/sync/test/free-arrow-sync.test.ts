// 빈 곳 화살표(11/09)가 다른 기기에서 들어올 때: 점 끝은 받아들이고, 같은 상자를 잇거나 끝이 비면 들이지 않는다.
import { describe, expect, it } from 'vitest';
import { fitIncoming } from '../src/normalize';

const arrow = (from: unknown, to: unknown) => ({ id: 'a1', from, to });

describe('fitIncoming — 화살표 끝', () => {
  it('점 끝 · 반쪽 점 끝을 받아들인다', () => {
    expect(fitIncoming('arrow', arrow({ point: { x: 1, y: 2 } }, { point: { x: 30, y: 2 } }))).toBeTruthy();
    expect(fitIncoming('arrow', arrow({ blockId: 'b1', side: 'auto' }, { point: { x: 30, y: 2 } }))).toBeTruthy();
  });
  it('같은 상자를 잇거나 끝이 비면 들이지 않는다', () => {
    expect(fitIncoming('arrow', arrow({ blockId: 'b1', side: 'auto' }, { blockId: 'b1', side: 'auto' }))).toBeUndefined();
    expect(fitIncoming('arrow', arrow({}, { point: { x: 30, y: 2 } }))).toBeUndefined();
    expect(fitIncoming('arrow', arrow({ point: { x: Number.NaN, y: 2 } }, { point: { x: 30, y: 2 } }))).toBeUndefined();
  });
});
