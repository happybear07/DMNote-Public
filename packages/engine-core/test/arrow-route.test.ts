// 화살표 경로 · 모양 (v6 2단계): 꺾은선 · 곡선 · 되돌림 점 목록, 라벨 자리, 누르기 판정 · 공간 색인이 휜 경로를 따른다,
// setArrowStyle은 바꾼 것만 저장하고 선을 고르면 v5 dash를 지운다 · null이면 관계 기본으로.
import { describe, expect, it } from 'vitest';
import { createTextBlock, DOCK_GAP, Engine, setArrowStyle, type TextDoc, type TxResult } from '../src';
import { pathMid, routePoints } from '../src/arrow-route';
import { arrowPath, endsTouch, fitAnchors } from '../src/arrow-geom';

const val = <T,>(r: TxResult<T>): T => { if (!r.ok) throw new Error(r.reason); return r.value; };
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }) as TextDoc;

describe('경로 점', () => {
  it('곧은 선 · 꺾은선(가운데서 꺾음) · 곡선 · 되돌림 — 처음과 끝은 a · b', () => {
    const a = { x: 0, y: 0 }, b = { x: 200, y: 100 };
    expect(routePoints(a, b)).toEqual([a, b]);
    expect(routePoints(a, b, 'orthogonal')).toEqual([a, { x: 100, y: 0 }, { x: 100, y: 100 }, b]);
    expect(routePoints(a, { x: 50, y: 300 }, 'orthogonal')[1]).toEqual({ x: 0, y: 150 });
    for (const r of ['curve', 'loop'] as const) {
      const pts = routePoints(a, b, r);
      expect(pts[0]).toEqual(a);
      expect(pts.at(-1)!.x).toBeCloseTo(200);
      expect(pts.at(-1)!.y).toBeCloseTo(100);
    }
    // 되돌림은 곡선보다 더 바깥으로
    const far = (pts: { x: number; y: number }[]) => Math.max(...pts.map((p) => Math.abs((p.x * 100 - p.y * 200) / Math.hypot(200, 100))));
    expect(far(routePoints(a, b, 'loop'))).toBeGreaterThan(far(routePoints(a, b, 'curve')));
  });

  it('라벨 자리 = 경로 길이의 반', () => {
    expect(pathMid([{ x: 0, y: 0 }, { x: 100, y: 0 }])).toEqual({ x: 50, y: 0 });
    expect(pathMid([{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 100 }])).toEqual({ x: 0, y: 100 });
  });
});

describe('휜 경로의 화살표', () => {
  function note() {
    const e = new Engine();
    const a = val(createTextBlock(e, { x: 0, y: 0 }, { doc: doc('가') })).blockId;
    const b = val(createTextBlock(e, { x: 600, y: 0 }, { doc: doc('나') })).blockId;
    let id = '';
    e.transact((tx) => { id = tx.createArrow({ from: { blockId: a, side: 'auto' }, to: { blockId: b, side: 'auto' }, relation: 'causes', style: { dash: true } }); }, { origin: 'user' });
    return { e, id };
  }

  it('곡선으로 바꾸면 휜 곳을 눌러도 잡히고(공간 색인 포함), 곧은 선 자리는 안 잡힌다', () => {
    const { e, id } = note();
    const straight = e.arrowGeometry(e.getArrow(id)!)!;
    val(setArrowStyle(e, [id], { route: 'curve' }));
    const g = e.arrowGeometry(e.getArrow(id)!)!;
    expect(g.pts.length).toBeGreaterThan(2);
    expect(g.mid).not.toEqual(straight.mid);
    expect(e.hitTest(g.mid, 4)).toEqual({ kind: 'arrow', id });
    expect(e.hitTest(straight.mid, 4)).toBeNull();
  });

  it('setArrowStyle: 바꾼 것만 · 선을 고르면 dash 지움 · null이면 비움 · 관계는 그대로 · 실행 취소 한 번', () => {
    const { e, id } = note();
    val(setArrowStyle(e, [id], { line: 'spring', color: 'red' }));
    expect(e.getArrow(id)!.style).toEqual({ line: 'spring', color: 'red' });
    val(setArrowStyle(e, [id], { color: undefined }));
    expect(e.getArrow(id)!.style).toEqual({ line: 'spring' });
    expect(e.getArrow(id)!.relation).toBe('causes');
    e.undo();
    expect(e.getArrow(id)!.style).toEqual({ line: 'spring', color: 'red' });
    val(setArrowStyle(e, [id], null));
    expect(e.getArrow(id)!.style).toBeUndefined();
    expect(e.getArrow(id)!.ai).toBeUndefined();
  });
});

describe('정한 변이 상대를 등지면 (10/28 — 예시 노트 "응답 스키마 검증 → 캔버스 반영"을 옆으로 옮기면 선이 상자 뒤로 거꾸로)', () => {
  const R = { w: 200, h: 40 };
  const A = { x: 0, y: 0, ...R };
  it('아래 → 위로 정한 화살표: 위아래에 있으면 그대로, 옆에 두면 오른 변 → 왼 변(저장은 그대로)', () => {
    const fa = { blockId: 'a', side: 'bottom' as const }, ta = { blockId: 'b', side: 'top' as const };
    expect(fitAnchors(A, fa, { x: 30, y: 120, ...R }, ta)).toEqual([fa, ta]);
    const [f, t] = fitAnchors(A, fa, { x: 260, y: 0, ...R }, ta);
    expect([f.side, t.side]).toEqual(['right', 'left']);
    const p = arrowPath(A, f, { x: 260, y: 0, ...R }, t);
    expect(p.a).toEqual({ x: 202, y: 20 });
    expect(p.b).toEqual({ x: 258, y: 20 });
    // 위로 올리면 위 변 → 아래 변
    expect(fitAnchors(A, fa, { x: 0, y: -200, ...R }, ta).map((x) => x.side)).toEqual(['top', 'bottom']);
  });
  it('엔진: 꺾은선도 바뀐 변을 따라 첫 줄기를 정한다 · 겹친 상자는 그대로', () => {
    const e = new Engine();
    const a = val(createTextBlock(e, { x: 0, y: 0 }, { doc: doc('가') })).blockId;
    const b = val(createTextBlock(e, { x: 400, y: 10 }, { doc: doc('나') })).blockId;
    let id = '';
    e.transact((tx) => { id = tx.createArrow({ from: { blockId: a, side: 'bottom' }, to: { blockId: b, side: 'top' }, style: { route: 'orthogonal' } }); }, { origin: 'user' });
    const g = e.arrowGeometry(e.getArrow(id)!)!;
    expect(g.pts.slice(0, 2).every((p) => Math.abs(p.y - g.a.y) < 1e-9)).toBe(true); // 가로로 나간다
    expect(g.a.x).toBeGreaterThan(e.blockRect(a)!.x + e.blockRect(a)!.w);
    expect(e.getArrow(id)!.from.side).toBe('bottom');
    expect(fitAnchors(A, { blockId: 'a', side: 'right' }, A, { blockId: 'a', side: 'top' }).map((x) => x.side)).toEqual(['right', 'top']);
  });
});

describe('붙여 둔 상자 사이 화살표는 숨긴다 (10/29 사용자 요청 — 라벨은 그대로 두고)', () => {
  it('붙이기 간격(16) 안이면 그리기 · 누르기 · 공간 색인에서 빠지고, 떼면 라벨과 함께 돌아온다', () => {
    const e = new Engine();
    const a = val(createTextBlock(e, { x: 0, y: 0 }, { doc: doc('가') })).blockId;
    const b = val(createTextBlock(e, { x: 600, y: 0 }, { doc: doc('나') })).blockId;
    let id = '';
    e.transact((tx) => { id = tx.createArrow({ from: { blockId: a, side: 'auto' }, to: { blockId: b, side: 'auto' }, label: '그래서' }); }, { origin: 'user' });
    const far = e.arrowGeometry(e.getArrow(id)!)!;
    expect(e.hitTest(far.mid, 4)).toEqual({ kind: 'arrow', id });
    const ra = e.blockRect(a)!;
    e.transact((tx) => tx.set('block', b, { x: ra.x + ra.w + DOCK_GAP }), { origin: 'user' });
    expect(e.arrowGeometry(e.getArrow(id)!)).toBeUndefined();
    expect(e.queryArrows({ x: -1000, y: -1000, w: 4000, h: 4000 })).toEqual([]);
    expect(e.getArrow(id)!.label).toBe('그래서');
    e.transact((tx) => tx.set('block', b, { x: ra.x + ra.w + 60 }), { origin: 'user' });
    expect(e.arrowGeometry(e.getArrow(id)!)).toBeDefined();
    expect(e.queryArrows({ x: -1000, y: -1000, w: 4000, h: 4000 })).toEqual([id]);
  });
  it('endsTouch: 겹침 · 옆 · 아래 · 대각선 16 안은 붙음, 17은 떨어짐', () => {
    const A = { x: 0, y: 0, w: 100, h: 40 };
    expect(endsTouch(A, { x: 50, y: 10, w: 100, h: 40 })).toBe(true);
    expect(endsTouch(A, { x: 116, y: 0, w: 100, h: 40 })).toBe(true);
    expect(endsTouch(A, { x: 0, y: 56, w: 100, h: 40 })).toBe(true);
    expect(endsTouch(A, { x: 110, y: 50, w: 100, h: 40 })).toBe(true);
    expect(endsTouch(A, { x: 117, y: 0, w: 100, h: 40 })).toBe(false);
    expect(endsTouch(A, { x: 0, y: 57, w: 100, h: 40 })).toBe(false);
  });
});
