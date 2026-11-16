// 좌표 · 사각형 기본 연산. 저장되는 좌표는 1/64 px 격자 (ENGINE 3.3).

export interface Vec2 { readonly x: number; readonly y: number }
export interface Size { readonly w: number; readonly h: number }
export interface Rect extends Vec2, Size {}

export const WORLD_LIMIT = 10_000_000;
export const MIN_SIZE = 24;

/** 1/64 px 격자 스냅. 양자화된 값끼리의 덧셈 · 뺄셈은 double로 정확하다. */
export function q(v: number): number {
  const s = Math.round(v * 64) / 64;
  return Object.is(s, -0) ? 0 : s;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function rectCenter(r: Rect): Vec2 {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
}

export function rectContains(r: Rect, p: Vec2): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

export function rectFromPoints(a: Vec2, b: Vec2): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

export function unionRects(rs: readonly Rect[]): Rect | null {
  if (rs.length === 0) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rs) {
    x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1);
  const cx = a.x + t * dx, cy = a.y + t * dy;
  return Math.hypot(p.x - cx, p.y - cy);
}

/** 사각형 중심에서 `toward` 방향으로 뻗은 선이 경계와 만나는 점. */
export function rectBoundaryToward(r: Rect, toward: Vec2): Vec2 {
  const c = rectCenter(r);
  const dx = toward.x - c.x, dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const hw = r.w / 2, hh = r.h / 2;
  const sx = dx === 0 ? Infinity : hw / Math.abs(dx);
  const sy = dy === 0 ? Infinity : hh / Math.abs(dy);
  const s = Math.min(sx, sy);
  return { x: c.x + dx * s, y: c.y + dy * s };
}

// ───────── 다각형 (올가미 선택, FR-004) ─────────

/** 짝홀 규칙 점-다각형 판정. 다각형은 닫힌 것으로 본다(마지막 점 → 첫 점). */
export function pointInPolygon(p: Vec2, poly: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function segmentsCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const o = (p: Vec2, q2: Vec2, r: Vec2) => Math.sign((q2.x - p.x) * (r.y - p.y) - (q2.y - p.y) * (r.x - p.x));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}

function rectCorners(r: Rect): Vec2[] {
  return [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }];
}

/** 사각형이 다각형 안에 완전히 들어가는가 (모서리 4개가 안 · 변이 교차하지 않음) */
export function polygonContainsRect(poly: readonly Vec2[], r: Rect): boolean {
  if (poly.length < 3) return false;
  const cs = rectCorners(r);
  if (!cs.every((c) => pointInPolygon(c, poly))) return false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    for (let k = 0; k < 4; k++) if (segmentsCross(poly[i]!, poly[j]!, cs[k]!, cs[(k + 1) % 4]!)) return false;
  }
  return true;
}

/** 사각형과 다각형이 겹치는가 (한쪽 점이 다른 쪽 안 · 또는 변 교차) */
export function polygonIntersectsRect(poly: readonly Vec2[], r: Rect): boolean {
  if (poly.length < 3) return false;
  const cs = rectCorners(r);
  if (cs.some((c) => pointInPolygon(c, poly)) || poly.some((p) => rectContains(r, p))) return true;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    for (let k = 0; k < 4; k++) if (segmentsCross(poly[i]!, poly[j]!, cs[k]!, cs[(k + 1) % 4]!)) return true;
  }
  return false;
}

export function polygonBounds(poly: readonly Vec2[]): Rect | null {
  return unionRects(poly.map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 })));
}

export function isFiniteRect(r: Rect): boolean {
  return [r.x, r.y, r.w, r.h].every((v) => Number.isFinite(v) && Math.abs(v) <= WORLD_LIMIT);
}
