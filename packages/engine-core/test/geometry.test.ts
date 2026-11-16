// 좌표 변환 왕복 오차 (FR-003) · 올가미 영역 질의 (FR-004).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  createTextBlock, Engine, pointInPolygon, polygonContainsRect, polygonIntersectsRect, screenToWorld, worldToScreen, zoomAt,
  type Camera, type Vec2,
} from '../src';

describe('좌표 변환 (FR-003)', () => {
  it('화면 ↔ 캔버스 왕복 오차 0.01px 이내 (줌 25%~400%, 넓은 좌표 범위)', () => {
    fc.assert(fc.property(
      fc.double({ min: 0.25, max: 4, noNaN: true }),
      fc.double({ min: -1e6, max: 1e6, noNaN: true }), fc.double({ min: -1e6, max: 1e6, noNaN: true }),
      fc.double({ min: 0, max: 4000, noNaN: true }), fc.double({ min: 0, max: 3000, noNaN: true }),
      (zoom, cx, cy, sx, sy) => {
        const cam: Camera = { x: cx, y: cy, zoom };
        const back = worldToScreen(cam, screenToWorld(cam, { x: sx, y: sy }));
        return Math.abs(back.x - sx) <= 0.01 && Math.abs(back.y - sy) <= 0.01;
      },
    ), { numRuns: 2000 });
  });

  it('고정점 줌: 줌 전후로 커서 아래 캔버스 점이 그대로', () => {
    fc.assert(fc.property(
      fc.double({ min: 0.25, max: 4, noNaN: true }), fc.double({ min: 0.25, max: 4, noNaN: true }),
      fc.double({ min: 0, max: 1600, noNaN: true }), fc.double({ min: 0, max: 900, noNaN: true }),
      (z0, z1, sx, sy) => {
        const cam: Camera = { x: 123.5, y: -77.25, zoom: z0 };
        const before = screenToWorld(cam, { x: sx, y: sy });
        const after = screenToWorld(zoomAt(cam, { x: sx, y: sy }, z1), { x: sx, y: sy });
        return Math.abs(before.x - after.x) * z1 <= 0.01 && Math.abs(before.y - after.y) * z1 <= 0.01;
      },
    ), { numRuns: 1000 });
  });
});

describe('올가미 영역 질의 (FR-004)', () => {
  const tri: Vec2[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }];

  it('점 · 사각형 판정', () => {
    expect(pointInPolygon({ x: 10, y: 10 }, tri)).toBe(true);
    expect(pointInPolygon({ x: 80, y: 80 }, tri)).toBe(false);
    expect(polygonContainsRect(tri, { x: 5, y: 5, w: 20, h: 20 })).toBe(true);
    expect(polygonContainsRect(tri, { x: 40, y: 40, w: 30, h: 30 })).toBe(false);
    expect(polygonIntersectsRect(tri, { x: 40, y: 40, w: 30, h: 30 })).toBe(true);
    expect(polygonIntersectsRect(tri, { x: 90, y: 90, w: 10, h: 10 })).toBe(false);
  });

  it('엔진 질의가 전수 검사와 일치 (무작위 블록 · 무작위 다각형)', () => {
    fc.assert(fc.property(
      fc.array(fc.record({ x: fc.integer({ min: -500, max: 500 }), y: fc.integer({ min: -500, max: 500 }), w: fc.integer({ min: 24, max: 200 }), h: fc.integer({ min: 24, max: 200 }) }), { minLength: 1, maxLength: 40 }),
      fc.array(fc.record({ x: fc.integer({ min: -600, max: 600 }), y: fc.integer({ min: -600, max: 600 }) }), { minLength: 3, maxLength: 12 }),
      (rects, poly) => {
        const e = new Engine();
        const ids = rects.map((r) => { const t = createTextBlock(e, r, { w: r.w, h: r.h }); if (!t.ok) throw new Error(); return t.value.blockId; });
        for (const mode of ['contain', 'intersect'] as const) {
          const test = mode === 'contain' ? polygonContainsRect : polygonIntersectsRect;
          const brute = ids.filter((id) => test(poly, e.getBlock(id)!)).sort();
          if (JSON.stringify(e.queryBlocksInPolygon(poly, mode).sort()) !== JSON.stringify(brute)) return false;
        }
        return true;
      },
    ), { numRuns: 150 });
  });
});
