// over 캔버스: 선택 · 핸들 · 스냅 안내선 · 마키 · 연결 미리보기 (블록 DOM 위 레이어) + 블록 핸들(⋮⋮) 위치.
import { isBlockEnd, rectFromPoints, type Anchor, type Id, type Rect, type Vec2 } from '@dn/engine-core';
import type { CanvasView } from './canvas-view';
import { CONNECT_R, HANDLE, HANDLE_TOUCH } from './constants';
import { dot, drawArrowLine, roundRect } from './draw-helpers';
import { drawInkOverlay } from './ink-layer';
import { drawGroups, selectedGroup, styleGroupScale } from './groups-view';
import { anchorOnRect, connectPoints, handlePoints, selectsBoxes } from './geometry';

export function drawOver(view: CanvasView): void {
  const ctx = view.ctx(view.over);
  drawInkOverlay(view, ctx);
  const g = view.gesture;
  // 드래그 · 리사이즈 프리뷰: 블록 DOM은 그 블록에만 transform을 건다 (ENGINE 8.4)
  for (const [id, m] of view.mounted) {
    const pr = g.k === 'drag' && g.moved && g.ids.includes(id) ? g.delta : null;
    if (!styleGroupScale(view, id, m.el)) m.el.style.transform = pr ? `translate(${pr.x}px, ${pr.y}px)` : '';
    if (g.k === 'resize' && g.id === id) {
      m.el.style.left = `${g.rect.x}px`; m.el.style.top = `${g.rect.y}px`; m.el.style.width = `${g.rect.w}px`;
      if (g.handle.includes('n') || g.handle.includes('s')) m.el.style.minHeight = `${g.rect.h}px`;
    }
  }
  // 선택 표시
  ctx.lineWidth = 2;
  ctx.strokeStyle = view.theme.accent;
  // 블록(묶음)을 통째로 골랐으면 상자마다가 아니라 묶음 테두리 · 손잡이로 (drawGroups)
  const whole = selectedGroup(view);
  const sel = whole ? [] : [...view.selBlocks].map((id) => view.previewRect(id) ?? view.engine.blockRect(id)).filter((r): r is Rect => !!r);
  drawGroups(view, ctx);
  for (const r of sel) {
    const a = view.toScreen(r);
    roundRect(ctx, a.x - 1, a.y - 1, r.w * view.cam.zoom + 2, r.h * view.cam.zoom + 2, 8 * Math.min(1, view.cam.zoom) + 1);
    ctx.stroke();
  }
  if (sel.length === 1 && !view.editingId && g.k !== 'drag') {
    for (const [, p] of handlePoints(view, sel[0]!)) {
      ctx.fillStyle = view.theme.card;
      const H = view.pointerKind === 'mouse' ? HANDLE : HANDLE_TOUCH; // 손가락 · 펜은 크게 (T6)
      ctx.fillRect(p.x - H / 2, p.y - H / 2, H, H);
      ctx.lineWidth = 1;
      ctx.strokeRect(p.x - H / 2 + 0.5, p.y - H / 2 + 0.5, H - 1, H - 1);
    }
  }
  // 선택된 화살표 끝점
  for (const id of view.selArrows) {
    const a = view.engine.getArrow(id);
    const geo = a && view.engine.arrowGeometry(a);
    if (!geo) continue;
    for (const p of [geo.a, geo.b]) dot(ctx, view.toScreen(p), 4, view.theme.card, view.theme.accent);
  }
  placeGrip(view);
  // 연결 핸들 (마우스를 올린 블록의 네 변 중점 — 골라 두기만 해서는 안 보인다, DS-014 · U-7). 고른 블록 연결점 근처에 오면 hover가 그 블록이 된다(pointer.ts)
  const anchorBlock = g.k === 'none' && !view.editingId && selectsBoxes(view._tool) ? view.hover : null;
  if (anchorBlock) {
    const r = view.engine.blockRect(anchorBlock);
    if (r) for (const [, p] of connectPoints(view, r)) dot(ctx, p, CONNECT_R - 1, view.theme.card, view.theme.accent);
  }
  // 자석 스냅 안내선 (붙는 가장자리)
  if (g.k === 'drag' && g.guides?.length) {
    ctx.save();
    ctx.strokeStyle = view.theme.accent;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    for (const gd of g.guides) {
      const a = view.toScreen(gd.axis === 'x' ? { x: gd.at, y: gd.from } : { x: gd.from, y: gd.at });
      const b = view.toScreen(gd.axis === 'x' ? { x: gd.at, y: gd.to } : { x: gd.to, y: gd.at });
      ctx.beginPath();
      ctx.moveTo(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5);
      ctx.lineTo(Math.round(b.x) + 0.5, Math.round(b.y) + 0.5);
      ctx.stroke();
    }
    ctx.restore();
  }
  // 마키
  if (g.k === 'marquee') {
    const a = view.toScreen(g.start), b = view.toScreen(g.cur);
    const r = rectFromPoints(a, b);
    ctx.fillStyle = 'rgba(76,110,245,0.08)';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.lineWidth = 1;
    ctx.strokeStyle = view.theme.accent;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h);
  }
  // 재연결 미리보기: 고정된 끝에서 커서(또는 대상 블록)까지
  if (g.k === 'reconnect') {
    const fixed = view.engine.getArrow(g.arrow)?.[g.end === 'from' ? 'to' : 'from'];
    if (fixed) drawLinkPreview(view, ctx, fixed, g.target, g.cur, g.end === 'from');
  }
  // 연결 미리보기
  if (g.k === 'connect') drawLinkPreview(view, ctx, g.from, g.target, g.cur, false);
}

/** 고정 끝(from)에서 대상 블록(없으면 커서)까지 점선 화살표 + 대상 테두리. reverse면 화살촉이 from 쪽 */
function drawLinkPreview(view: CanvasView, ctx: CanvasRenderingContext2D, from: Anchor, target: Id | null, cur: Vec2, reverse: boolean): void {
  const fr = isBlockEnd(from) ? view.engine.blockRect(from.blockId) : { x: from.point.x, y: from.point.y, w: 0, h: 0 }; // 빈 곳의 점 끝 (11/09)
  if (!fr) return;
  const tr = target ? view.engine.blockRect(target) : undefined;
  const toward = tr ? { x: tr.x + tr.w / 2, y: tr.y + tr.h / 2 } : cur;
  const p1 = view.toScreen(isBlockEnd(from) ? anchorOnRect(fr, from, toward) : from.point);
  const p2 = view.toScreen(tr ? anchorOnRect(tr, { blockId: target!, side: 'auto' }, { x: fr.x + fr.w / 2, y: fr.y + fr.h / 2 }) : cur);
  ctx.setLineDash([5, 4]);
  if (reverse) drawArrowLine(ctx, p2, p1, view.theme.accent, 1.5, false); else drawArrowLine(ctx, p1, p2, view.theme.accent, 1.5, false);
  ctx.setLineDash([]);
  if (!tr) return;
  const s = view.toScreen(tr);
  ctx.strokeStyle = view.theme.accent;
  ctx.lineWidth = 2;
  roundRect(ctx, s.x - 1, s.y - 1, tr.w * view.cam.zoom + 2, tr.h * view.cam.zoom + 2, 9);
  ctx.stroke();
}

/** 블록 핸들: 호버한 블록(없으면 하나만 선택된 블록)의 왼쪽 위 바깥. 제스처 · 편집 · LOD 중에는 숨긴다. */
export function placeGrip(view: CanvasView): void {
  const g = view.gesture;
  const id = view.readOnly || view.lod || view.editingId || !selectsBoxes(view._tool) || (g.k !== 'none' && !(g.k === 'drag' && g.grip))
    ? null
    : view.hover ?? (view.pointerKind !== 'mouse' && view.selBlocks.size === 1 ? [...view.selBlocks][0]! : null); // 마우스는 올렸을 때만(노션처럼), 터치 · 펜은 하나 고른 상자에 (T2)
  const r = id ? (view.previewRect(id) ?? view.engine.blockRect(id)) : undefined;
  if (!id || !r) { view.grip.hidden = true; view.gripId = null; return; }
  const a = view.toScreen(r);
  view.gripId = id;
  view.grip.hidden = false;
  view.grip.style.transform = `translate(${Math.round(a.x - 24)}px, ${Math.round(a.y + 8)}px)`;
}
