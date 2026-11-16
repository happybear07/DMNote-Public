// 화살표 그리기 (v6): 경로(엔진 arrowGeometry().pts — 곧은 선 · 꺾은선 · 곡선 · 되돌림)를 따라
// 선(실선 · 파선 · 점선 · 이중선 · 물결 · 한 번 감김 · 용수철) × 끝 모양(삼각 · 꺾쇠 · 빈 삼각 · 마름모 · 빈 마름모 · T막대 · 점 · 없음), 양 끝 따로.
// 모양은 engine-core effectiveStyle(사용자 모양 > 관계 기본)이 정하고, 여기는 그리기만. 캔버스 · PNG 내보내기 · 그리기 미리보기가 같이 쓴다.
import type { ArrowHead, ArrowLine, Vec2 } from '@dn/engine-core';

export interface ArrowLook { readonly line: ArrowLine; readonly head: ArrowHead; readonly tail: ArrowHead }

const SIZE = 8;

/** 끝 모양이 차지하는 길이 — 선을 그만큼 줄여 끝 모양 안으로 들어가지 않게 */
function inset(h: ArrowHead): number {
  switch (h) {
    case 'none': case 'bar': case 'chevron': return 0;
    case 'dot': return 6;
    case 'diamond': case 'open-diamond': return SIZE * 1.7;
    default: return SIZE * 0.85;
  }
}

const dist = (p: Vec2, q: Vec2) => Math.hypot(q.x - p.x, q.y - p.y);

/** 경로 앞에서 s0, 뒤에서 s1만큼 잘라 낸 점 목록 */
function trim(pts: readonly Vec2[], s0: number, s1: number): Vec2[] {
  const cut = (list: Vec2[], s: number): Vec2[] => {
    let left = s;
    while (list.length > 2 && dist(list[0]!, list[1]!) <= left) { left -= dist(list[0]!, list[1]!); list.shift(); }
    const [p, q] = [list[0]!, list[1]!], d = dist(p, q) || 1, t = Math.min(0.95, left / d);
    list[0] = { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
    return list;
  };
  return cut(cut([...pts], s0).reverse(), s1).reverse();
}

/** 경로를 step 간격으로 따라가며 f(점, 단위 방향, 거리, 전체 길이)가 내놓은 점들 */
function along(pts: readonly Vec2[], step: number, f: (p: Vec2, u: Vec2, s: number, len: number) => Vec2): Vec2[] {
  const segs = pts.slice(1).map((q, i) => ({ p: pts[i]!, q, d: dist(pts[i]!, q) }));
  const len = segs.reduce((m, x) => m + x.d, 0);
  const out: Vec2[] = [];
  let i = 0, base = 0;
  for (let s = 0; s <= len + 1e-6; s += step) {
    while (i < segs.length - 1 && s > base + segs[i]!.d) { base += segs[i]!.d; i++; }
    const g = segs[i]!, t = g.d ? Math.min(1, (s - base) / g.d) : 0, u = g.d ? { x: (g.q.x - g.p.x) / g.d, y: (g.q.y - g.p.y) / g.d } : { x: 1, y: 0 };
    out.push(f({ x: g.p.x + (g.q.x - g.p.x) * t, y: g.p.y + (g.q.y - g.p.y) * t }, u, s, len));
  }
  return out;
}

/** 끝으로 갈수록 0 — 물결 · 용수철이 끝 모양에 매끄럽게 닿게 */
const taper = (s: number, len: number) => Math.min(1, s / 6, (len - s) / 6);

/** 물결: 진폭 a · 파장 l */
const wave = (pts: readonly Vec2[], a: number, l: number) => along(pts, 1, (p, u, s, len) => {
  const o = a * taper(s, len) * Math.sin((2 * Math.PI * s) / l);
  return { x: p.x - u.y * o, y: p.y + u.x * o };
});

/**
 * 한 번 감김: 경로 가운데 2r 구간에서만 고리 하나. 뒤로 r·sinθ, 옆으로 1.1r(1 − cosθ) (θ = 0 → 2π) — 양 끝에서 옆 변위 · 기울기가 0이라
 * 경로에 매끄럽게 붙고, 꼭대기에서 뒤로 가며(π > 1) 올라간 줄과 교차해 고리가 된다. 고리는 길이의 8%(최소 r · 최대 26),
 * 짧은 화살표는 길이의 1/5까지 줄인다
 */
const curl = (pts: readonly Vec2[], r: number) => along(pts, 0.5, (p, u, s, len) => {
  const a = Math.min(len / 5, Math.max(r, Math.min(26, len * 0.08))), m = len / 2;
  if (Math.abs(s - m) >= a) return p;
  const th = (Math.PI * (s - m + a)) / a;
  const back = a * Math.sin(th), side = -1.1 * a * (1 - Math.cos(th));
  return { x: p.x + u.x * back - u.y * side, y: p.y + u.y * back + u.x * side };
});

/** 용수철(코일): 늘어난 사이클로이드 — 고리 반지름 d가 한 바퀴 길이/2π보다 커서 고리가 생긴다 */
const coil = (pts: readonly Vec2[], d: number, pitch: number) => along(pts, 0.5, (p, u, s, len) => {
  const k = d * taper(s, len), th = (2 * Math.PI * s) / pitch;
  const back = -k * Math.sin(th), side = k * Math.cos(th) - k;
  return { x: p.x + u.x * back - u.y * side, y: p.y + u.y * back + u.x * side };
});

function stroke(ctx: CanvasRenderingContext2D, pts: readonly Vec2[]): void {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.stroke();
}

/** 이중선 한쪽: 꼭짓점마다 앞뒤 방향의 평균 수직으로 off만큼 */
function offset(pts: readonly Vec2[], off: number): Vec2[] {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)]!, b = pts[Math.min(pts.length - 1, i + 1)]!, d = dist(a, b) || 1;
    return { x: p.x - ((b.y - a.y) / d) * off, y: p.y + ((b.x - a.x) / d) * off };
  });
}

/** p에 끝 모양 하나 — ang: 선이 p로 들어오는 방향 */
function drawEnd(ctx: CanvasRenderingContext2D, p: Vec2, ang: number, kind: ArrowHead, color: string): void {
  if (kind === 'none') return;
  const at = (d: number, t = 0) => ({ x: p.x - Math.cos(ang + t) * d, y: p.y - Math.sin(ang + t) * d });
  ctx.beginPath();
  let fill = false;
  if (kind === 'triangle' || kind === 'open-triangle') {
    const l = at(SIZE, -0.42), r = at(SIZE, 0.42);
    ctx.moveTo(p.x, p.y); ctx.lineTo(l.x, l.y); ctx.lineTo(r.x, r.y); ctx.closePath();
    fill = kind === 'triangle';
  } else if (kind === 'chevron') {
    const l = at(SIZE, -0.5), r = at(SIZE, 0.5);
    ctx.moveTo(l.x, l.y); ctx.lineTo(p.x, p.y); ctx.lineTo(r.x, r.y);
  } else if (kind === 'diamond' || kind === 'open-diamond') {
    const l = at(SIZE * 0.95, -0.5), r = at(SIZE * 0.95, 0.5), back = at(SIZE * 1.7);
    ctx.moveTo(p.x, p.y); ctx.lineTo(l.x, l.y); ctx.lineTo(back.x, back.y); ctx.lineTo(r.x, r.y); ctx.closePath();
    fill = kind === 'diamond';
  } else if (kind === 'bar') {
    const nx = -Math.sin(ang) * SIZE * 0.7, ny = Math.cos(ang) * SIZE * 0.7;
    ctx.moveTo(p.x + nx, p.y + ny); ctx.lineTo(p.x - nx, p.y - ny);
  } else if (kind === 'dot') {
    const c = at(3);
    ctx.arc(c.x, c.y, 3, 0, Math.PI * 2);
    fill = true;
  }
  if (fill) { ctx.fillStyle = color; ctx.fill(); } else ctx.stroke();
}

/** 경로(pts, 처음 = 출발 · 끝 = 도착)를 따라 화살표 한 개 */
export function drawArrow(ctx: CanvasRenderingContext2D, pts: readonly Vec2[], color: string, width: number, look: ArrowLook): void {
  if (pts.length < 2) return;
  const n = pts.length;
  const endAng = Math.atan2(pts[n - 1]!.y - pts[n - 2]!.y, pts[n - 1]!.x - pts[n - 2]!.x);
  const startAng = Math.atan2(pts[0]!.y - pts[1]!.y, pts[0]!.x - pts[1]!.x);
  const path = trim(pts, inset(look.tail), inset(look.head));
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.setLineDash(look.line === 'dashed' ? [6, 4] : look.line === 'dotted' ? [1, 3.5] : []);
  ctx.lineCap = look.line === 'dotted' ? 'round' : 'butt';
  if (look.line === 'double') { const off = Math.max(1.5, width); stroke(ctx, offset(path, off)); stroke(ctx, offset(path, -off)); }
  else if (look.line === 'wavy') stroke(ctx, wave(path, 2.4 + width * 0.6, 10));
  else if (look.line === 'curl') stroke(ctx, curl(path, 8 + width * 2));
  else if (look.line === 'spring') stroke(ctx, coil(path, 3.5 + width, 10));
  else stroke(ctx, path);
  ctx.setLineDash([]);
  ctx.lineCap = 'butt';
  ctx.lineWidth = Math.max(1.25, width);
  drawEnd(ctx, pts[n - 1]!, endAng, look.head, color);
  drawEnd(ctx, pts[0]!, startAng, look.tail, color);
}
