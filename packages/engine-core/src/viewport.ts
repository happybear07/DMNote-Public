// 카메라 · 좌표 변환 (ENGINE 6장). screen = (world - camera.xy) * zoom.
import { clamp, type Rect, type Vec2 } from './geom';

export interface Camera { readonly x: number; readonly y: number; readonly zoom: number }

export const MIN_ZOOM = 0.25; // FR-011 25% ~ 400% (UX-FLOW K8)
export const MAX_ZOOM = 4;

export function worldToScreen(c: Camera, p: Vec2): Vec2 {
  return { x: (p.x - c.x) * c.zoom, y: (p.y - c.y) * c.zoom };
}

export function screenToWorld(c: Camera, p: Vec2): Vec2 {
  return { x: p.x / c.zoom + c.x, y: p.y / c.zoom + c.y };
}

/** 화면 점 `at` 아래의 월드 점이 고정되도록 줌 (6.3 고정점 줌). */
export function zoomAt(c: Camera, at: Vec2, zoom: number): Camera {
  const z = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
  const w = screenToWorld(c, at);
  return { x: w.x - at.x / z, y: w.y - at.y / z, zoom: z };
}

export function panBy(c: Camera, dxScreen: number, dyScreen: number): Camera {
  return { x: c.x - dxScreen / c.zoom, y: c.y - dyScreen / c.zoom, zoom: c.zoom };
}

export function visibleWorldRect(c: Camera, viewport: { w: number; h: number }): Rect {
  return { x: c.x, y: c.y, w: viewport.w / c.zoom, h: viewport.h / c.zoom };
}

/** 사각형 전체가 보이도록 (6.4). 최대 100%까지만 확대. */
export function fitRect(r: Rect, viewport: { w: number; h: number }, padding = 64): Camera {
  const zw = (viewport.w - padding * 2) / Math.max(r.w, 1);
  const zh = (viewport.h - padding * 2) / Math.max(r.h, 1);
  const zoom = clamp(Math.min(zw, zh, 1), MIN_ZOOM, MAX_ZOOM);
  return {
    x: r.x + r.w / 2 - viewport.w / 2 / zoom,
    y: r.y + r.h / 2 - viewport.h / 2 / zoom,
    zoom,
  };
}

/** 줌 단계 (버튼 · 단축키용). */
export const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

export function nextZoomStep(z: number, dir: 1 | -1): number {
  if (dir > 0) return ZOOM_STEPS.find((s) => s > z + 1e-6) ?? MAX_ZOOM;
  return [...ZOOM_STEPS].reverse().find((s) => s < z - 1e-6) ?? MIN_ZOOM;
}
