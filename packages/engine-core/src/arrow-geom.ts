// 화살표 끝점 계산. 앵커(blockId · side · t)와 블록 사각형에서 기하를 유도한다 (ENGINE 3.4 Anchor).
// 빈 곳의 점 끝(11/09)은 엔진이 크기 0인 사각형 + side 'auto'로 바꿔 넘긴다(engine.ts arrowGeometry) — 'auto'면 그 점이 곧 끝점.
import { rectBoundaryToward, rectCenter, type Rect, type Vec2 } from './geom';
import { DOCK_GAP } from './dock';
import type { BlockAnchor as Anchor, Side } from './model';

/** a · b: 끝점, mid: 라벨 자리, pts: 그리는 경로(곧은 선이면 [a, b] — 꺾은선 · 곡선은 arrow-route.ts) */
export interface ArrowPath { readonly a: Vec2; readonly b: Vec2; readonly mid: Vec2; readonly pts: readonly Vec2[] }

const GAP = 2;

export function anchorPoint(r: Rect, anchor: Anchor, other: Vec2): Vec2 {
  const t = anchor.t ?? 0.5;
  switch (anchor.side) {
    case 'top': return { x: r.x + r.w * t, y: r.y - GAP };
    case 'bottom': return { x: r.x + r.w * t, y: r.y + r.h + GAP };
    case 'left': return { x: r.x - GAP, y: r.y + r.h * t };
    case 'right': return { x: r.x + r.w + GAP, y: r.y + r.h * t };
    case 'auto': {
      const p = rectBoundaryToward(r, other);
      const c = rectCenter(r);
      const d = Math.hypot(p.x - c.x, p.y - c.y) || 1;
      return { x: p.x + ((p.x - c.x) / d) * GAP, y: p.y + ((p.y - c.y) / d) * GAP };
    }
  }
}

/** 두 끝 상자가 붙어 있나 — 사이가 가로 · 세로 모두 붙이기 간격(DOCK_GAP) 이하(겹침 포함). 이때는 화살표를 그리지 않는다(10/29) */
export function endsTouch(a: Rect, b: Rect): boolean {
  const gx = Math.max(b.x - a.x - a.w, a.x - b.x - b.w), gy = Math.max(b.y - a.y - a.h, a.y - b.y - b.h);
  return Math.max(gx, gy) <= DOCK_GAP + 0.5;
}

/** side 변에서 나간 선이 다른 끝(o)으로 가며 제 상자 쪽으로 되돌아 들어가지 않나 */
const faces = (side: Side, p: Vec2, o: Vec2) =>
  side === 'bottom' ? o.y >= p.y : side === 'top' ? o.y <= p.y : side === 'right' ? o.x >= p.x : side === 'left' ? o.x <= p.x : true;

/** 정해 둔 변이 상대 상자를 등지면(아래 변에서 나가는데 상대가 옆 · 위에 있음 — 상자를 옮긴 뒤) 서로 마주 보는 변으로 그린다.
 *  저장된 앵커는 그대로라 다시 그 자리로 옮기면 정한 변으로 돌아온다. 두 상자가 겹치면(자기 자신 · 묶음 안) 그대로 */
export function fitAnchors(from: Rect, fa: Anchor, to: Rect, ta: Anchor): readonly [Anchor, Anchor] {
  if (fa.side === 'auto' && ta.side === 'auto') return [fa, ta];
  const { a, b } = arrowPath(from, fa, to, ta);
  if (faces(fa.side, a, b) && faces(ta.side, b, a)) return [fa, ta];
  const gx = Math.max(to.x - from.x - from.w, from.x - to.x - to.w), gy = Math.max(to.y - from.y - from.h, from.y - to.y - to.h);
  if (gx <= 0 && gy <= 0) return [fa, ta];
  const [sf, st]: [Side, Side] = gx >= gy ? (to.x > from.x ? ['right', 'left'] : ['left', 'right']) : to.y > from.y ? ['bottom', 'top'] : ['top', 'bottom'];
  const set = (an: Anchor, side: Side): Anchor => (an.groupId ? { blockId: an.blockId, side, groupId: an.groupId } : { blockId: an.blockId, side });
  return [set(fa, sf), set(ta, st)];
}

export function arrowPath(from: Rect, fromAnchor: Anchor, to: Rect, toAnchor: Anchor): ArrowPath {
  const fc = rectCenter(from), tc = rectCenter(to);
  const fTarget = toAnchor.side === 'auto' ? tc : anchorPoint(to, toAnchor, fc);
  const a = anchorPoint(from, fromAnchor, fTarget);
  const b = anchorPoint(to, toAnchor, fromAnchor.side === 'auto' ? fc : a);
  return { a, b, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, pts: [a, b] };
}
