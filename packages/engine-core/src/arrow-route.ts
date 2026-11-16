// 화살표 경로 (v6 2단계): 곧은 선 · 꺾은선 · 곡선 · 되돌림. 끝점(a · b)은 arrow-geom이 정하고, 여기서는 그 사이 점 목록을 만든다.
// 그리기 · 누르기 판정 · 공간 색인 · 라벨 자리가 같은 점 목록을 쓴다 — 화면에 보이는 곳을 누르면 그 화살표가 잡힌다.
import type { Vec2 } from './geom';
import type { ArrowRoute } from './model';

const bezier2 = (a: Vec2, c: Vec2, b: Vec2, t: number): Vec2 => ({ x: (1 - t) ** 2 * a.x + 2 * (1 - t) * t * c.x + t * t * b.x, y: (1 - t) ** 2 * a.y + 2 * (1 - t) * t * c.y + t * t * b.y });
const bezier3 = (a: Vec2, c1: Vec2, c2: Vec2, b: Vec2, t: number): Vec2 => {
  const u = 1 - t;
  return { x: u ** 3 * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t ** 3 * b.x, y: u ** 3 * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t ** 3 * b.y };
};

/** a → b 경로의 점 목록 (처음 a, 끝 b). first: 꺾은선의 첫 줄기 — 'v'(위 · 아래 끝에서 나감) · 'h'(왼 · 오른 끝), 없으면 긴 쪽 */
export function routePoints(a: Vec2, b: Vec2, route: ArrowRoute = 'straight', first?: 'h' | 'v'): Vec2[] {
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len; // 진행 방향 왼쪽
  switch (route) {
    case 'orthogonal': {
      // 가로가 길면 가로 → 세로 → 가로, 아니면 세로 → 가로 → 세로 (가운데서 꺾음)
      if (first ? first === 'h' : Math.abs(dx) >= Math.abs(dy)) { const mx = a.x + dx / 2; return [a, { x: mx, y: a.y }, { x: mx, y: b.y }, b]; }
      const my = a.y + dy / 2;
      return [a, { x: a.x, y: my }, { x: b.x, y: my }, b];
    }
    case 'curve': {
      const c = { x: (a.x + b.x) / 2 + nx * len * 0.25, y: (a.y + b.y) / 2 + ny * len * 0.25 };
      return Array.from({ length: 21 }, (_, i) => bezier2(a, c, b, i / 20));
    }
    case 'loop': {
      // 바깥으로 크게 돌아 들어오는 경로 (되돌림 ↺ · 반복)
      const out = Math.max(60, len * 0.6);
      const c1 = { x: a.x + nx * out - dx * 0.25, y: a.y + ny * out - dy * 0.25 };
      const c2 = { x: b.x + nx * out + dx * 0.25, y: b.y + ny * out + dy * 0.25 };
      return Array.from({ length: 29 }, (_, i) => bezier3(a, c1, c2, b, i / 28));
    }
    default: return [a, b];
  }
}

/** 점 목록 길이의 반 지점 (라벨 자리) */
export function pathMid(pts: readonly Vec2[]): Vec2 {
  const seg = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i]!.x, p.y - pts[i]!.y));
  let left = seg.reduce((s, x) => s + x, 0) / 2;
  for (let i = 0; i < seg.length; i++) {
    if (left <= seg[i]! || i === seg.length - 1) {
      const t = seg[i]! ? Math.min(1, left / seg[i]!) : 0, p = pts[i]!, q = pts[i + 1]!;
      return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
    }
    left -= seg[i]!;
  }
  return pts[0]!;
}
