// 고른 필기 → 그림 (손글씨 인식 FR-038): 흰 바탕에 검은 잉크, 둘레 여백, 긴 변 maxSide 이하(작은 글씨는 키워서).
// 형광펜 획은 글씨가 아니라 뺀다.
import { isStroke, strokeBounds, unionRects, type Id, type Rect, type Stroke } from '@dn/engine-core';
import type { CanvasView } from './canvas-view';
import { fillStroke, strokePath } from './ink-render';

export interface InkImage { readonly base64: string; readonly w: number; readonly h: number; /** 그린 영역 (월드 좌표) */ readonly bounds: Rect; readonly ids: readonly Id[] }

export async function inkImage(view: CanvasView, ids: readonly Id[], maxSide = 1568): Promise<InkImage | null> {
  const strokes = ids.map((id) => view.engine.getStroke(id) as Stroke | undefined).filter((s): s is Stroke => isStroke(s) && s.tool !== 'highlighter');
  if (!strokes.length) return null;
  const pad = 16;
  const r = unionRects(strokes.map(strokeBounds))!;
  const bounds = { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 };
  // 글씨가 작으면 2배까지 키워 또렷하게, 크면 상한에 맞춰 줄인다
  const k = Math.min(2, maxSide / Math.max(bounds.w, bounds.h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bounds.w * k)); c.height = Math.max(1, Math.round(bounds.h * k));
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  const cam = { x: bounds.x, y: bounds.y, zoom: k };
  for (const s of strokes) fillStroke(ctx, 1, cam, { ...s, color: '#111' }, strokePath(s));
  const url = c.toDataURL('image/png');
  return { base64: url.slice(url.indexOf(',') + 1), w: c.width, h: c.height, bounds, ids: strokes.map((s) => s.id) };
}
