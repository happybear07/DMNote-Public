// 블록 만들기: 새 블록 자리 · 상자 도구로 누르기. (빈 곳으로 화살표를 놓아도 상자를 만들지 않는다 — 11/09, arrow-input.ts)
import {
  createTextBlock, findDockSpot, q, sheetFits, DEFAULT_BLOCK_H, DEFAULT_BLOCK_W, DEFAULT_TITLE_H, DEFAULT_TITLE_W,
  type BoxKind, type Rect, type Vec2,
} from '@dn/engine-core';
import type { CanvasView } from './canvas-view';
import { clampNewRect } from './sheet-view';

/** 새 블록 자리: 원하는 자리가 비어 있으면 그대로, 겹치면 가장 가까운 블록 옆 · 아래에 붙인다 */
export function placeNew(view: CanvasView, r: Rect): Vec2 {
  // 용지(A4)면 종이 폭 안에서 찾고, 붙인 자리도 종이 안으로
  const p = findDockSpot(view.engine, clampNewRect(view, r), undefined, undefined, sheetFits(view.engine));
  const c = clampNewRect(view, { ...r, x: p.x, y: p.y });
  return { x: q(c.x), y: q(c.y) };
}

export function createBlockAt(view: CanvasView, p: Vec2, kind: BoxKind = 'text'): void {
  const size = kind === 'title' ? { w: DEFAULT_TITLE_W, h: DEFAULT_TITLE_H } : { w: DEFAULT_BLOCK_W, h: DEFAULT_BLOCK_H };
  const r = createTextBlock(view.engine, placeNew(view, { x: p.x, y: p.y, ...size }), { kind });
  if (!r.ok) return;
  view.select([r.value.blockId]);
  view.startEditing(r.value.blockId, 'start');
}
