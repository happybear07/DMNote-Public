// 펜 획 그리기: 중심선 점열 → 외곽선 다각형(perfect-freehand) → Path2D. 굵기가 필압 · 속도에 따라 매끄럽게 변하고 끝이 가늘어진다.
// 획마다 외곽선을 한 번만 만든다 — 획 기준 좌표(원점 · 배율 전)로 캐시하고 그릴 때 변환만 건다(옮기기 · 크기 조절 · 블록에 묶인 잉크도 재사용).
// 펜 종류(볼펜 · 만년필 · 붓펜)는 외곽선 옵션만 다르다. 마우스 · 손가락은 필압이 없으니 속도로 흉내 낸다.
import { getStroke, type StrokeOptions } from 'perfect-freehand';
import { decodePoints, type PenKind, type Stroke } from '@dn/engine-core';

/** 펜 종류별 외곽선 옵션 (size = 기준 굵기, 필압 0.5에서 그 굵기) */
export const PEN_STYLE: Record<PenKind, Omit<StrokeOptions, 'size' | 'simulatePressure' | 'last'>> = {
  // 볼펜: 거의 일정한 굵기, 끝도 둥글게
  ball: { thinning: 0.18, smoothing: 0.55, streamline: 0.35, start: { cap: true, taper: 0 }, end: { cap: true, taper: 0 } },
  // 만년필: 필압 · 속도에 따라 굵기가 크게 변하고 끝이 살짝 가늘어진다
  fountain: { thinning: 0.6, smoothing: 0.6, streamline: 0.4, start: { cap: true, taper: 0 }, end: { cap: true, taper: 8 } },
  // 붓펜: 가장 크게 변하고 양 끝이 뾰족하다
  brush: { thinning: 0.82, smoothing: 0.65, streamline: 0.45, start: { cap: false, taper: 14 }, end: { cap: false, taper: 22 } },
  // 아래는 고른 종류만 저장하고 질감(흑연 · 왁스 · 번짐 · 납작 펜촉)은 나중 — 지금은 가장 가까운 외곽선
  pencil: { thinning: 0.3, smoothing: 0.5, streamline: 0.3, start: { cap: true, taper: 2 }, end: { cap: true, taper: 4 } },
  'colored-pencil': { thinning: 0.3, smoothing: 0.5, streamline: 0.3, start: { cap: true, taper: 2 }, end: { cap: true, taper: 4 } },
  // 마커: 굵기가 거의 일정하고 끝이 뭉툭하다
  marker: { thinning: 0.05, smoothing: 0.6, streamline: 0.4, start: { cap: true, taper: 0 }, end: { cap: true, taper: 0 } },
  calligraphy: { thinning: 0.7, smoothing: 0.6, streamline: 0.4, start: { cap: false, taper: 4 }, end: { cap: false, taper: 10 } },
  crayon: { thinning: 0.15, smoothing: 0.45, streamline: 0.3, start: { cap: true, taper: 0 }, end: { cap: true, taper: 0 } },
  watercolor: { thinning: 0.75, smoothing: 0.7, streamline: 0.5, start: { cap: false, taper: 10 }, end: { cap: false, taper: 16 } },
};

/** 점열 [x, y, p, t]* (획 기준 좌표) → 외곽선 Path2D */
export function outlinePath(pts: ArrayLike<number>, width: number, pen: PenKind, done: boolean): Path2D {
  const input: [number, number, number][] = [];
  let real = false;
  for (let i = 0; i + 2 < pts.length; i += 4) {
    const p = pts[i + 2]!;
    if (Math.abs(p - 0.5) > 1e-3) real = true;
    input.push([pts[i]!, pts[i + 1]!, p]);
  }
  const outline = getStroke(input, { size: width, ...PEN_STYLE[pen], simulatePressure: !real, last: done });
  const path = new Path2D();
  if (!outline.length) return path;
  path.moveTo(outline[0]![0], outline[0]![1]);
  for (let i = 1; i < outline.length; i++) {
    const [x0, y0] = outline[i]!, [x1, y1] = outline[(i + 1) % outline.length]!;
    path.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
  }
  path.closePath();
  return path;
}

interface Cached { points: string; width: number; pen: PenKind; path: Path2D }
const cache = new Map<string, Cached>();

/** 저장된 획의 외곽선 (캐시) — 획 기준 좌표, 배율 1 */
export function strokePath(s: Stroke): Path2D {
  const pen = s.pen ?? 'ball';
  const c = cache.get(s.id);
  if (c && c.points === s.points && c.width === s.width && c.pen === pen) return c.path;
  if (cache.size > 20000) cache.clear();
  const path = outlinePath(decodePoints(s.points), s.width, pen, true);
  cache.set(s.id, { points: s.points, width: s.width, pen, path });
  return path;
}

/** 화면에 획 하나: cam 변환 + 획 원점 · 배율. color: 보이는 색(theme.ts shownInk — 없으면 저장 색) */
export function fillStroke(ctx: CanvasRenderingContext2D, dpr: number, cam: { x: number; y: number; zoom: number }, s: Stroke, path: Path2D, dx = 0, dy = 0, color = s.color): void {
  const k = dpr * cam.zoom;
  ctx.setTransform(k * s.scale, 0, 0, k * s.scale, k * (s.origin.x + dx - cam.x), k * (s.origin.y + dy - cam.y));
  ctx.fillStyle = color;
  ctx.fill(path);
}
