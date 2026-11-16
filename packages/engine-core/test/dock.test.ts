// 블록 도킹 — 자유 배치 + 겹침 없음 + 가까이 가면 착 붙기 (사용자 결정 10/02: 다른 블록은 움직이지 않는다).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  applyMeasuredHeights, createTextBlock, DOCK_GAP, duplicateBlocks, Engine, findDockSpot, fitResize, isFree, rectsOverlap, snapRect,
  type Id, type Rect,
} from '../src';

const mk = (e: Engine, r: Rect): Id => { const t = createTextBlock(e, r, { w: r.w, h: r.h }); if (!t.ok) throw new Error(); return t.value.blockId; };
const rect = (e: Engine, id: Id): Rect => e.blockRect(id)!;
const noOverlaps = (e: Engine) => {
  const bs = [...e.blocks()];
  for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) if (rectsOverlap(bs[i]!, bs[j]!)) return false;
  return true;
};

describe('findDockSpot · 겹치게 놓으면 가장 가까운 빈 자리에 붙인다', () => {
  it('빈 자리면 그대로 (자유 배치)', () => {
    const e = new Engine();
    mk(e, { x: 0, y: 0, w: 200, h: 100 });
    expect(findDockSpot(e, { x: 400, y: 0, w: 100, h: 50 })).toEqual({ x: 400, y: 0 });
  });

  it('겹치면 겹친 블록의 한 변에 간격 16으로 붙는다', () => {
    const e = new Engine();
    const A = rect(e, mk(e, { x: 0, y: 0, w: 200, h: 100 }));
    const p = findDockSpot(e, { x: 20, y: 30, w: 200, h: 80 });
    expect(rectsOverlap({ ...p, w: 200, h: 80 }, A)).toBe(false);
    const docked = p.y === A.y + A.h + DOCK_GAP || p.x === A.x + A.w + DOCK_GAP || p.y === A.y - DOCK_GAP - 80 || p.x === A.x - DOCK_GAP - 200;
    expect(docked).toBe(true);
  });

  it('무작위로 몰려 있어도 결과는 항상 빈 자리', () => {
    fc.assert(fc.property(
      fc.array(fc.record({ x: fc.integer({ min: 0, max: 600 }), y: fc.integer({ min: 0, max: 600 }) }), { minLength: 1, maxLength: 25 }),
      fc.record({ x: fc.integer({ min: 0, max: 600 }), y: fc.integer({ min: 0, max: 600 }) }),
      (pts, at) => {
        const e = new Engine();
        for (const p of pts) mk(e, { ...p, w: 160, h: 60 });
        const s = findDockSpot(e, { ...at, w: 160, h: 60 });
        return isFree(e, { ...s, w: 160, h: 60 });
      },
    ), { numRuns: 200 });
  });
});

describe('글이 늘면 닿는 아래 상자만 레고처럼 (AT-020 — 사용자 결정 11/02)', () => {
  it('붙은 아래 상자들이 줄줄이 내려가 이음매 그대로 · 옆 상자는 그대로', () => {
    const e = new Engine();
    const a = mk(e, { x: 0, y: 0, w: 200, h: 80 });
    const b = mk(e, { x: 0, y: 96, w: 200, h: 80 });
    const c = mk(e, { x: 40, y: 192, w: 200, h: 60 });
    const side = mk(e, { x: 216, y: 0, w: 120, h: 150 });
    applyMeasuredHeights(e, new Map([[a, 200]]));
    expect(rect(e, b)).toEqual({ x: 0, y: 216, w: 200, h: 80 });
    expect(rect(e, c).y).toBe(312);
    expect(rect(e, side)).toEqual({ x: 216, y: 0, w: 120, h: 150 });
    expect(noOverlaps(e)).toBe(true);
  });

  it('멀리 둔 상자는 닿을 때만, 이음매만큼 떨어지게', () => {
    const e = new Engine();
    const a = mk(e, { x: 0, y: 0, w: 200, h: 80 });
    const far = mk(e, { x: 0, y: 300, w: 200, h: 80 });
    applyMeasuredHeights(e, new Map([[a, 150]]));
    expect(rect(e, far).y).toBe(300);
    applyMeasuredHeights(e, new Map([[a, 320]]));
    expect(rect(e, far).y).toBe(320 + DOCK_GAP);
  });

  it('줄면 내린 만큼만 되돌림 — 처음부터 붙여 둔 상자는 당기지 않음', () => {
    const e = new Engine();
    const a = mk(e, { x: 0, y: 0, w: 200, h: 80 });
    const b = mk(e, { x: 0, y: 96, w: 200, h: 80 });
    const c = mk(e, { x: 0, y: 192, w: 200, h: 80 });
    applyMeasuredHeights(e, new Map([[a, 140]]));
    expect([rect(e, b).y, rect(e, c).y]).toEqual([156, 252]);
    applyMeasuredHeights(e, new Map([[a, 80]]));
    expect([rect(e, b).y, rect(e, c).y]).toEqual([96, 192]);
    applyMeasuredHeights(e, new Map([[a, 50]])); // 처음보다 더 줄어도 사용자가 놓은 자리는 그대로
    expect([rect(e, b).y, rect(e, c).y]).toEqual([96, 192]);
  });

  it('밀린 뒤 사용자가 옮겼거나, 다른 상자에도 붙어 있으면 되돌리지 않음', () => {
    const e = new Engine();
    const a = mk(e, { x: 0, y: 0, w: 200, h: 80 });
    const b = mk(e, { x: 0, y: 96, w: 200, h: 80 });
    applyMeasuredHeights(e, new Map([[a, 140]]));
    e.transact((tx) => tx.set('block', b, { y: 170 }), { origin: 'user' });
    applyMeasuredHeights(e, new Map([[a, 80]]));
    expect(rect(e, b).y).toBe(170);

    const e2 = new Engine();
    const l = mk(e2, { x: 0, y: 0, w: 100, h: 80 });
    const r = mk(e2, { x: 116, y: 0, w: 100, h: 140 });
    const wide = mk(e2, { x: 0, y: 156, w: 216, h: 60 }); // l · r 둘 다 아래 — r에 붙어 있다
    applyMeasuredHeights(e2, new Map([[l, 200]]));
    expect(rect(e2, wide).y).toBe(216);
    applyMeasuredHeights(e2, new Map([[r, 200]]));
    applyMeasuredHeights(e2, new Map([[l, 80]]));
    expect(rect(e2, wide).y).toBe(216);
  });

  it('무작위로 놓고 키워도 겹침이 새로 생기지 않음', () => {
    fc.assert(fc.property(
      fc.array(fc.record({ x: fc.integer({ min: 0, max: 8 }), y: fc.integer({ min: 0, max: 8 }) }), { minLength: 2, maxLength: 12 }),
      fc.integer({ min: 0, max: 11 }), fc.integer({ min: 20, max: 400 }),
      (cells, pick, grow) => {
        const e = new Engine();
        const ids: Id[] = [];
        for (const c of cells) { const r = { x: c.x * 120, y: c.y * 100, w: 100, h: 80 }; if (isFree(e, r)) ids.push(mk(e, r)); }
        const a = ids[pick % ids.length]!;
        applyMeasuredHeights(e, new Map([[a, 80 + grow]]));
        return noOverlaps(e);
      },
    ), { numRuns: 200 });
  });
});

describe('snapRect · 가까이 가면 착 붙기', () => {
  it('아래에 붙기 + 왼쪽 맞춤으로 끌어당기고 안내선을 준다', () => {
    const e = new Engine();
    mk(e, { x: 100, y: 100, w: 200, h: 80 });
    const s = snapRect(e, { x: 104, y: 100 + 80 + DOCK_GAP + 5, w: 150, h: 60 }, new Set(), 10);
    expect([s.x, s.y]).toEqual([100, 100 + 80 + DOCK_GAP]);
    expect(s.guides.map((g) => g.axis).sort()).toEqual(['x', 'y']);
  });

  it('오른쪽에 붙기 + 위 맞춤', () => {
    const e = new Engine();
    mk(e, { x: 100, y: 100, w: 200, h: 80 });
    const s = snapRect(e, { x: 300 + DOCK_GAP + 6, y: 97, w: 150, h: 60 }, new Set(), 10);
    expect([s.x, s.y]).toEqual([300 + DOCK_GAP, 100]);
  });

  it('멀면 그대로 (자유 배치)', () => {
    const e = new Engine();
    mk(e, { x: 100, y: 100, w: 200, h: 80 });
    const s = snapRect(e, { x: 500, y: 500, w: 100, h: 50 }, new Set(), 10);
    expect([s.x, s.y, s.guides.length]).toEqual([500, 500, 0]);
  });
});

describe('복제 도킹', () => {
  it('dock: 사본 묶음이 원본과 겹치지 않고 상대 배치를 유지한다', () => {
    const e = new Engine();
    const a = mk(e, { x: 0, y: 0, w: 200, h: 80 });
    const b = mk(e, { x: 216, y: 0, w: 200, h: 80 });
    const r = duplicateBlocks(e, [a, b], 24, { dock: true });
    if (!r.ok) throw new Error();
    const [ca, cb] = r.value.map((id) => rect(e, id));
    expect(cb!.x - ca!.x).toBe(216);
    expect(noOverlaps(e)).toBe(true);
  });
});

describe('fitResize · 크기 조절은 이웃 상자를 덮지 않는다 (10/29 — 붙여 둔 상자를 키우면 옆 상자가 가려지던 것)', () => {
  const setup = () => {
    const e = new Engine();
    const a = mk(e, { x: 0, y: 0, w: 200, h: 60 });
    return { e, a, s: rect(e, a), ex: new Set([a]) };
  };
  it('붙은 옆 상자 쪽으로는 안 커지고, 떨어진 상자면 이음매(16) 앞까지 · 다른 상자는 그대로', () => {
    const { e, s, ex } = setup();
    const b = mk(e, { x: 200 + DOCK_GAP, y: 0, w: 200, h: 60 });
    expect(fitResize(e, s, { ...s, w: 260 }, ex)).toEqual(s);
    expect(rect(e, b)).toEqual({ x: 216, y: 0, w: 200, h: 60 });
    const f = setup(), far = mk(f.e, { x: 300, y: 0, w: 100, h: 60 });
    expect(fitResize(f.e, f.s, { ...f.s, w: 400 }, f.ex).w).toBe(300 - DOCK_GAP);
    expect(rect(f.e, far).x).toBe(300);
  });
  it('아래 · 왼쪽 · 위도 같다, 줄이기는 그대로 둔다', () => {
    const { e, s, ex } = setup();
    mk(e, { x: 0, y: 60 + DOCK_GAP, w: 200, h: 60 });
    mk(e, { x: -200 - DOCK_GAP, y: 0, w: 200, h: 60 });
    expect(fitResize(e, s, { ...s, h: 120 }, ex)).toEqual(s);
    expect(fitResize(e, s, { ...s, x: -40, w: 240 }, ex)).toEqual(s);
    expect(fitResize(e, s, { ...s, w: 150, h: 40 }, ex)).toEqual({ ...s, w: 150, h: 40 });
  });
  it('대각선으로 키우면 덜 잘리는 변 하나만 멈춘다 · 처음부터 가까운 축(8)은 그 변을 안 움직이면 상관없다', () => {
    const { e, s, ex } = setup();
    mk(e, { x: 216, y: 76, w: 100, h: 100 });
    expect(fitResize(e, s, { ...s, w: 250, h: 100 }, ex)).toEqual({ ...s, w: 200, h: 100 });
    const f = setup();
    mk(f.e, { x: 208, y: 0, w: 100, h: 200 });
    expect(fitResize(f.e, f.s, { ...f.s, h: 150 }, f.ex)).toEqual({ ...f.s, h: 150 });
    expect(fitResize(f.e, f.s, { ...f.s, w: 230 }, f.ex)).toEqual(f.s);
  });
  it('속성: 처음에 안 겹친 상자와는 바꾼 뒤에도 안 겹친다', () => {
    fc.assert(fc.property(
      fc.array(fc.record({ x: fc.integer({ min: -400, max: 400 }), y: fc.integer({ min: -400, max: 400 }), w: fc.integer({ min: 40, max: 200 }), h: fc.integer({ min: 30, max: 160 }) }), { maxLength: 6 }),
      fc.record({ dl: fc.integer({ min: -100, max: 300 }), dt: fc.integer({ min: -100, max: 300 }), dr: fc.integer({ min: -100, max: 300 }), db: fc.integer({ min: -100, max: 300 }) }),
      (others, d) => {
        const e = new Engine();
        const a = mk(e, { x: 0, y: 0, w: 200, h: 100 }), s = rect(e, a);
        const ids = others.map((r) => mk(e, r)).filter((id) => !rectsOverlap(rect(e, id), s));
        const r = { x: -d.dl, y: -d.dt, w: Math.max(60, 200 + d.dl + d.dr), h: Math.max(40, 100 + d.dt + d.db) };
        const c = fitResize(e, s, r, new Set([a]));
        return ids.every((id) => !rectsOverlap(rect(e, id), c));
      },
    ), { numRuns: 300 });
  });
});
