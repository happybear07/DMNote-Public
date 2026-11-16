// ───────── 그리기 헬퍼 ─────────
import type { Vec2 } from '@dn/engine-core';
import { drawArrow } from './arrow-draw';

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
}

export function dot(ctx: CanvasRenderingContext2D, p: Vec2, r: number, fill: string, stroke: string): void {
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = stroke;
  ctx.stroke();
}

/** 그리는 중인 화살표 미리보기 등 — 실선(또는 파선) + 채운 삼각 */
export function drawArrowLine(ctx: CanvasRenderingContext2D, a: Vec2, b: Vec2, color: string, width: number, dash: boolean): void {
  drawArrow(ctx, [a, b], color, width, { line: dash ? 'dashed' : 'solid', head: 'triangle', tail: 'none' });
}

/** 화살표 라벨 알약: 가운데 m에 카드 바탕 + 테두리 + 흐린 글자. 글꼴 · 정렬은 호출 측이 맞춰 둔다 */
export function drawArrowLabel(ctx: CanvasRenderingContext2D, label: string, m: Vec2, fill: string, border: string, text: string): void {
  const w = ctx.measureText(label).width + 14;
  ctx.fillStyle = fill;
  ctx.strokeStyle = border;
  ctx.lineWidth = 1;
  roundRect(ctx, m.x - w / 2, m.y - 10, w, 20, 10);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = text;
  ctx.fillText(label, m.x, m.y + 0.5);
}
