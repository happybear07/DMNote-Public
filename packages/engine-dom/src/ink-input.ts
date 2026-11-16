// 잉크 입력 (FR-034 · 036 · 040): 펜 · 형광펜 · 지우개 · 올가미 도구의 포인터 처리 + 앱이 부르는 잉크 조작.
// 팜 리젝션: 펜이 긋는 동안 다른 포인터(손바닥 · 손가락)는 무시. '펜으로만 필기'면 손가락은 화면 이동(두 손가락은 확대).
// 마우스 · 트랙패드로도 그릴 수 있다(필압 없음 → 기본 굵기).
import {
  addStroke, bindStrokes, deleteStrokes, isInkContent, unbindInk, type HlKind, type Id, isStroke, lassoStrokes, moveStrokes, type PenKind, recolorStrokes, scaleStrokes, screenToWorld, strokeHit, type Stroke, type Vec2,
} from '@dn/engine-core';
import type { CanvasView } from './canvas-view';
import { HL_WIDTH, PEN_WIDTH, scaleFactor, selectionBounds } from './ink-layer';
import type { Tool } from './types';

export type InkToolName = 'pen' | 'highlighter' | 'eraser' | 'lasso';
export const isInkTool = (t: Tool): t is InkToolName => t === 'pen' || t === 'highlighter' || t === 'eraser' || t === 'lasso';

/** 이 포인터를 무시할까 — 다른 포인터가 긋는 중(손바닥), 또는 펜 전용인데 손가락 */
export function inkIgnores(view: CanvasView, e: PointerEvent): boolean {
  return view.ink.pointerId !== null && e.pointerId !== view.ink.pointerId;
}

/** 잉크 도구로 누르기 — 처리했으면 true (아니면 일반 처리: 손가락 → 화면 이동 등) */
export function inkDown(view: CanvasView, e: PointerEvent, w: Vec2): boolean {
  const tool = view._tool;
  if (!isInkTool(tool) || view.readOnly || e.button !== 0) return false;
  const ink = view.ink;
  // 펜을 처음 받으면 펜 전용을 켠다 — 손바닥이 먼저 닿아도 긋지 않고, 손가락은 화면 이동 · 두 손가락 확대 (T4)
  if (e.pointerType === 'pen' && !ink.penOnly && !ink.penOnlySet) { ink.penOnly = true; view.host.onNotice?.('pen-found'); view.notifyUi(); }
  if (e.pointerType === 'touch' && ink.penOnly) return false;
  ink.pointerId = e.pointerId;
  if (tool === 'pen' || tool === 'highlighter') {
    const hl = tool === 'highlighter';
    ink.wet = {
      tool, origin: w, pts: [0, 0, pressure(e), 0], t0: e.timeStamp,
      color: hl ? ink.hlColor : ink.color, width: hl ? ink.hlWidth : ink.width, pen: ink.pen, hl: ink.hl,
    };
  } else if (tool === 'eraser') {
    ink.erasing.clear();
    erase(view, w);
  } else {
    const r = selectionBounds(view);
    const grip = 8 / view.cam.zoom;
    if (r && Math.abs(w.x - (r.x + r.w)) <= grip && Math.abs(w.y - (r.y + r.h)) <= grip) {
      ink.drag = { mode: 'scale', start: w, delta: { x: 0, y: 0 }, base: { x: r.x + 4, y: r.y + 4, w: r.w - 8, h: r.h - 8 } };
    } else if (r && w.x >= r.x && w.y >= r.y && w.x <= r.x + r.w && w.y <= r.y + r.h) ink.drag = { mode: 'move', start: w, delta: { x: 0, y: 0 } };
    else { ink.selected.clear(); ink.lasso = [w]; }
  }
  view.schedule();
  return true;
}

export function inkMove(view: CanvasView, e: PointerEvent): boolean {
  const ink = view.ink;
  if (ink.pointerId !== e.pointerId) return false;
  const rect = view.root.getBoundingClientRect();
  const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
  for (const ev of events.length ? events : [e]) {
    const w = screenToWorld(view.cam, { x: ev.clientX - rect.left, y: ev.clientY - rect.top });
    if (ink.wet) {
      const n = ink.wet.pts.length;
      const lx = ink.wet.origin.x + ink.wet.pts[n - 4]!, ly = ink.wet.origin.y + ink.wet.pts[n - 3]!;
      // 제자리 떨림은 버린다 (화면 0.5px 미만)
      if (Math.hypot(w.x - lx, w.y - ly) * view.cam.zoom < 0.5) continue;
      if (n === 4 && e.pointerType === 'pen') ink.wet.pts[2] = pressure(ev); // 누를 때 필압 0으로 오는 기기 보정
      ink.wet.pts.push(w.x - ink.wet.origin.x, w.y - ink.wet.origin.y, pressure(ev), ev.timeStamp - ink.wet.t0);
    } else if (view._tool === 'eraser') erase(view, w);
    else if (ink.lasso) { const l = ink.lasso[ink.lasso.length - 1]!; if (Math.hypot(w.x - l.x, w.y - l.y) * view.cam.zoom >= 3) ink.lasso.push(w); }
    else if (ink.drag) ink.drag.delta = { x: w.x - ink.drag.start.x, y: w.y - ink.drag.start.y };
  }
  // 다음 움직임 예측 점 (그리기만 — 펜 끝이 손을 덜 늦게 따라온다)
  if (ink.wet) {
    const pred = typeof e.getPredictedEvents === 'function' ? e.getPredictedEvents() : [];
    const out: number[] = [];
    for (const ev of pred.slice(0, 2)) {
      const w = screenToWorld(view.cam, { x: ev.clientX - rect.left, y: ev.clientY - rect.top });
      out.push(w.x - ink.wet.origin.x, w.y - ink.wet.origin.y, pressure(ev), ev.timeStamp - ink.wet.t0);
    }
    ink.wet.predicted = out;
  }
  view.schedule();
  return true;
}

export function inkUp(view: CanvasView, e: PointerEvent): boolean {
  const ink = view.ink;
  if (ink.pointerId !== e.pointerId) return false;
  ink.pointerId = null;
  if (ink.wet) {
    const w = ink.wet;
    ink.wet = null;
    addStroke(view.engine, { tool: w.tool, color: w.color, width: w.width, origin: w.origin, points: w.pts, pen: w.pen, hl: w.hl });
  } else if (view._tool === 'eraser') {
    const ids = [...ink.erasing];
    ink.erasing.clear();
    if (ids.length) deleteStrokes(view.engine, ids);
  } else if (ink.lasso) {
    const poly = ink.lasso;
    ink.lasso = null;
    for (const id of lassoStrokes(view.engine, poly)) ink.selected.add(id);
  } else if (ink.drag) {
    const drag = ink.drag;
    const f = scaleFactor(view);
    ink.drag = null;
    if (drag.mode === 'scale') { if (f !== 1 && drag.base) scaleStrokes(view.engine, [...ink.selected], f, { x: drag.base.x, y: drag.base.y }); }
    else if (drag.delta.x || drag.delta.y) moveStrokes(view.engine, [...ink.selected], drag.delta.x, drag.delta.y);
  }
  view.schedule();
  view.notifyUi();
  return true;
}

function pressure(e: PointerEvent): number {
  return e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.5;
}

function erase(view: CanvasView, w: Vec2): void {
  const r = 8 / view.cam.zoom;
  for (const s of view.engine.strokes()) {
    if (isStroke(s) && s.parent.kind === 'layer' && !view.ink.erasing.has(s.id) && strokeHit(s, w, r)) view.ink.erasing.add(s.id);
  }
}

/** 키: 고른 잉크 지우기 · 선택 풀기. 처리했으면 true */
export function inkKey(view: CanvasView, e: KeyboardEvent): boolean {
  const ink = view.ink;
  if (!ink.selected.size) return false;
  if (e.key === 'Delete' || e.key === 'Backspace') { deleteSelectedInk(view); e.preventDefault(); return true; }
  if (e.key === 'Escape') { ink.selected.clear(); view.schedule(); view.notifyUi(); return true; }
  return false;
}

// ───────── 앱이 부르는 조작 (잉크 도구 막대) ─────────

/** 펜 · 형광펜 설정 — 굵기는 범위 안으로 (PEN_WIDTH · HL_WIDTH) */
export function setInkStyle(view: CanvasView, style: { color?: string; hlColor?: string; colors?: string[]; hlColors?: string[]; width?: number; hlWidth?: number; pen?: PenKind; hl?: HlKind }): void {
  const clamp = (v: number, r: { min: number; max: number }) => Math.round(Math.min(r.max, Math.max(r.min, v)) * 10) / 10;
  Object.assign(view.ink, style,
    style.width !== undefined ? { width: clamp(style.width, PEN_WIDTH) } : {},
    style.hlWidth !== undefined ? { hlWidth: clamp(style.hlWidth, HL_WIDTH) } : {});
  if (style.color && view.ink.selected.size) recolorSelectedInk(view, style.color);
  view.notifyUi();
}

export function setInkVisibility(view: CanvasView, v: { ink?: boolean; blocks?: boolean; penOnly?: boolean }): void {
  if (v.ink !== undefined) view.ink.show = v.ink;
  if (v.blocks !== undefined) view.ink.showBlocks = v.blocks;
  if (v.penOnly !== undefined) { view.ink.penOnly = v.penOnly; view.ink.penOnlySet = true; }
  view.schedule();
  view.notifyUi();
}

export function deleteSelectedInk(view: CanvasView): void {
  const ids = [...view.ink.selected];
  view.ink.selected.clear();
  if (ids.length) deleteStrokes(view.engine, ids);
  view.schedule();
  view.notifyUi();
}

export function recolorSelectedInk(view: CanvasView, color: string): void {
  const ids = [...view.ink.selected].filter((id) => isStroke(view.engine.getStroke(id) as Stroke | undefined));
  if (ids.length) recolorStrokes(view.engine, ids, color);
}

/** 고른 자유 잉크를 블록으로 묶기 (FR-037) — 걸친 블록에, 없으면 새 블록. 묶은 블록을 고른다 */
export function bindSelectedInk(view: CanvasView): Id | null {
  const ids = [...view.ink.selected];
  if (!ids.length) return null;
  const r = bindStrokes(view.engine, ids);
  if (!r.ok || !r.value) return null;
  view.ink.selected.clear();
  view.select([r.value]);
  view.schedule();
  view.notifyUi();
  return r.value;
}

/** 블록들의 묶인 잉크 풀기 — 지금 보이는 자리의 자유 잉크로. 풀린 획을 올가미 선택으로 */
export function unbindBlockInk(view: CanvasView, blockIds: readonly Id[]): number {
  const freed: Id[] = [];
  view.engine.transact(() => {
    for (const b of blockIds) for (const c of view.engine.contentsOf(b)) {
      if (!isInkContent(c)) continue;
      const r = unbindInk(view.engine, c.id);
      if (r.ok) freed.push(...r.value);
    }
  }, { origin: 'user', label: '잉크 풀기' });
  if (freed.length) { view.select([]); view.setTool('lasso'); for (const id of freed) view.ink.selected.add(id); view.schedule(); view.notifyUi(); }
  return freed.length;
}

export const hasBoundInk = (view: CanvasView, blockIds: readonly Id[]) => blockIds.some((b) => view.engine.contentsOf(b).some(isInkContent));
