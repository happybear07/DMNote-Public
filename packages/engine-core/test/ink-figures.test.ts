// 손그림(자유 잉크) → 문서: 가까운 획끼리 한 그림, 먼 획은 다른 그림, 자리 순서대로 문서 차례에 끼울 자리, 그림 기준 경로
import { describe, expect, it } from 'vitest';
import { addStroke, createTextBlock, Engine, figurePaths, figureSlot, inkFigures, readingOrder, type TextDoc, type TxResult } from '../src';

const val = <T,>(r: TxResult<T>): T => { if (!r.ok) throw new Error(r.reason); return r.value; };
const line = (e: Engine, x: number, y: number) => val(addStroke(e, { tool: 'pen', color: '#000', width: 2, origin: { x, y }, points: [0, 0, 0.5, 0, 60, 0, 0.5, 10] }));
const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '글' }] }] } as TextDoc;

describe('손그림 → 문서', () => {
  it('가까운 획은 한 그림 · 먼 획은 다른 그림 · 자리 순서', () => {
    const e = new Engine();
    line(e, 0, 500); line(e, 30, 520); // 한 그림
    line(e, 0, 0); // 위쪽 다른 그림
    const f = inkFigures(e);
    expect(f.map((x) => x.ids.length)).toEqual([1, 2]);
    expect(f[1]!.y).toBeLessThan(500);
    const p = figurePaths(e, f[1]!);
    expect(p.paths).toHaveLength(2);
    expect(p.paths[0]!.d.startsWith('M')).toBe(true);
  });

  it('문서 차례: 그림보다 자리가 뒤인 첫 블록 앞, 없으면 맨 끝', () => {
    const e = new Engine();
    val(createTextBlock(e, { x: 0, y: 0 }, { doc }));
    val(createTextBlock(e, { x: 0, y: 400 }, { doc }));
    line(e, 0, 200);
    line(e, 0, 900);
    const order = readingOrder(e.blocks());
    expect(inkFigures(e).map((f) => figureSlot(order, f))).toEqual([1, 2]);
  });
});
