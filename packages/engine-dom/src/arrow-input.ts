// 화살표 긋기 (11/09 갈아엎음): 상자에서든 빈 곳에서든 시작하고, 상자 위에 놓으면 그 상자에, 빈 곳에 놓으면 그 점에 끝이 생긴다 —
// 예전처럼 빈 곳에 놓았다고 빈 상자를 만들지 않는다. 고른 화살표의 끝을 끌어 다른 상자로 옮기거나 상자에서 떼어 빈 곳에 두고,
// 점 끝이 있는 화살표는 몸통을 끌어 통째로 옮긴다(상자에 붙은 끝은 그대로).
import { createArrow, endBlock, isBlockEnd, isBound, moveArrowPoints, q, reconnectArrow, type Anchor, type Id, type Vec2 } from '@dn/engine-core';
import type { CanvasView } from './canvas-view';
import { arrowHidden } from './geometry';
import type { Gesture } from './types';

/** 그냥 누른 것과 끈 것을 가르는 거리 (화면 px) */
const MIN_DRAG = 10;
const pointEnd = (w: Vec2): Anchor => ({ point: { x: q(w.x), y: q(w.y) } });

/** 화살표 도구로 누르기: 상자 위면 그 상자에서, 아니면 그 점에서 */
export function startArrow(view: CanvasView, blockId: Id | null, w: Vec2): void {
  view.gesture = { k: 'connect', from: blockId ? { blockId, side: 'auto' } : pointEnd(w), cur: w, target: null, start: w };
}

/** 끄는 동안 놓을 상자 — not(시작 상자 · 다른 끝 상자)은 빼고 */
export function dropTarget(view: CanvasView, w: Vec2, not: Id | undefined): Id | null {
  const hit = view.engine.hitTest(w, 0);
  return hit?.kind === 'block' && hit.id !== not ? hit.id : null;
}

/** 다 그었을 때 — 상자 위면 그 상자에(같은 두 상자를 이미 이었으면 그것을 고름), 빈 곳이면 그 점에. 그냥 눌렀으면 긋지 않는다 */
export function finishConnect(view: CanvasView, g: Extract<Gesture, { k: 'connect' }>, pick: (id: Id) => void): void {
  const fromBlock = endBlock(g.from);
  if (g.target) {
    const same = fromBlock ? view.engine.arrowsOf(fromBlock).find((x) => endBlock(x.from) === fromBlock && endBlock(x.to) === g.target) : undefined;
    if (same) { pick(same.id); return; }
    const r = createArrow(view.engine, g.from, { blockId: g.target, side: 'auto' }, undefined, view.arrowStyle);
    if (r.ok) pick(r.value);
    return;
  }
  // 시작 상자 밖으로 충분히 나갔을 때 · 빈 곳에서 시작했으면 충분히 끌었을 때만
  const z = view.cam.zoom, m = MIN_DRAG / z, r = fromBlock ? view.engine.blockRect(fromBlock) : undefined;
  const far = r ? !(g.cur.x > r.x - m && g.cur.x < r.x + r.w + m && g.cur.y > r.y - m && g.cur.y < r.y + r.h + m)
    : Math.hypot(g.cur.x - g.start.x, g.cur.y - g.start.y) >= m;
  if (!far) return;
  const c = createArrow(view.engine, g.from, pointEnd(g.cur), undefined, view.arrowStyle);
  if (c.ok) pick(c.value);
}

/** 끝을 옮겼을 때 — 다른 상자 위면 거기에, 빈 곳이면 그 점으로(상자에서 떼기). 그냥 눌렀으면 그대로 */
export function finishReconnect(view: CanvasView, g: Extract<Gesture, { k: 'reconnect' }>): void {
  const a = view.engine.getArrow(g.arrow), z = view.cam.zoom;
  if (!a || Math.hypot(g.cur.x - g.start.x, g.cur.y - g.start.y) * z < 4) return;
  if (g.target) {
    if (g.target === endBlock(a[g.end])) return;
    reconnectArrow(view.engine, g.arrow, g.end, { blockId: g.target, side: 'auto' });
  } else {
    const other = a[g.end === 'from' ? 'to' : 'from'];
    if (!isBlockEnd(other) && Math.hypot(other.point.x - g.cur.x, other.point.y - g.cur.y) * z < MIN_DRAG) return; // 길이 0이 된다
    reconnectArrow(view.engine, g.arrow, g.end, pointEnd(g.cur));
  }
  if (arrowHidden(view, g.arrow)) view.host.onNotice?.('arrow-hidden');
}

/** 점 끝이 있는 화살표인가 — 몸통을 끌어 옮길 수 있다 */
export function movableArrow(view: CanvasView, id: Id): boolean {
  const a = view.engine.getArrow(id);
  return !!a && !isBound(a);
}

/** 몸통 끌기 — 점 끝만 따라 움직인다 (끄는 동안의 움직임은 실행 취소 한 번으로 모인다) */
export function dragArrow(view: CanvasView, g: Extract<Gesture, { k: 'amove' }>, w: Vec2): void {
  if (moveArrowPoints(view.engine, g.arrow, { x: w.x - g.last.x, y: w.y - g.last.y }).ok) g.last = w;
}
