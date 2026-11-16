// 묶음 도식 모양 (AI 원형 · STRUCTURE-GUIDE 2.1, Figma P-03 시간축 · P-11 사분면 · P-12 척도): 묶음 meta.shape가 있으면
// 상자 아래(under 캔버스)에 덧그린다 — 시간축은 가로 축선 + 사건마다 축까지 줄기와 점, 사분면은 가운데 십자 점선 + 왼쪽 세로 · 아래 가로 축과 축 이름,
// 척도는 양쪽 화살표 축 + 양 끝 이름, 피시본은 결과까지 가로 등뼈 + 원인마다 비스듬한 가지, 벤은 집합마다 타원(집합 상자 + 그 집합으로 소속 화살표를 보내는 상자들) — 겹친 곳이 교집합. 상자 자리에서 그릴 때마다 계산한다(상자를 옮기면 따라간다) — 저장하는 것은 모양 종류와 원문 축 이름뿐.
import { groupMembers, isBound, type Arrow, type GroupMeta, type Id } from '@dn/engine-core';
import type { CanvasView } from './canvas-view';

/** 화면 그리기 — 상자 자리는 화면 좌표(미리보기 자리 포함) */
export function drawGroupShapes(view: CanvasView, ctx: CanvasRenderingContext2D): void {
  const z = view.cam.zoom;
  paintGroupShapes(ctx, view, (id) => { const r = view.previewRect(id) ?? view.engine.blockRect(id); if (!r) return null; const p = view.toScreen(r); return { x: p.x, y: p.y, w: r.w * z, h: r.h * z }; }, z);
}

/** 모양이 상자 바깥으로 나가는 거리(축 · 축 이름 · 타원) — PNG 영역에 더할 여백. 모양 묶음이 없으면 0 */
export function shapeMargin(view: CanvasView, only: ReadonlySet<Id>): number {
  const meta = view.engine.note.groups;
  if (!meta) return 0;
  for (const [gid, ids] of groupMembers(view.engine)) if (meta[gid]?.shape && ids.every((id) => only.has(id))) return 56;
  return 0;
}

/** 모양 그리기 본체 — PNG 내보내기(snapshot.ts)는 월드 좌표 · 배율 1로, only면 구성원이 모두 그 안에 든 묶음만 */
export function paintGroupShapes(ctx: CanvasRenderingContext2D, view: CanvasView, box: (id: Id) => R | null, z: number, only?: ReadonlySet<Id>): void {
  const meta = view.engine.note.groups;
  if (!meta || !Object.values(meta).some((m) => m?.shape)) return;
  for (const [gid, ids] of groupMembers(view.engine)) {
    const m = meta[gid];
    if (!m?.shape || (only && !ids.every((id) => only.has(id)))) continue;
    const rs = ids.map(box).filter((r): r is R => !!r);
    if (rs.length < 2) continue;
    ctx.save();
    ctx.strokeStyle = ctx.fillStyle = view.theme.muted;
    ctx.lineWidth = 1.5;
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textBaseline = 'top';
    if (m.shape === 'timeline') timeline(ctx, rs, z);
    else if (m.shape === 'matrix') matrix(ctx, rs, z, m.axis);
    else if (m.shape === 'venn') venn(ctx, view, ids, box, z);
    else if (m.shape === 'fishbone') fishbone(ctx, view, ids, box, z);
    else scale(ctx, rs, z, m.axis);
    ctx.restore();
  }
}

type R = { x: number; y: number; w: number; h: number };
const right = (rs: R[]) => Math.max(...rs.map((r) => r.x + r.w)), bottom = (rs: R[]) => Math.max(...rs.map((r) => r.y + r.h));
const left = (rs: R[]) => Math.min(...rs.map((r) => r.x)), top = (rs: R[]) => Math.min(...rs.map((r) => r.y));

function head(ctx: CanvasRenderingContext2D, x: number, y: number, dx: number, dy: number): void {
  const s = 7, l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - ux * s - uy * s * 0.55, y - uy * s + ux * s * 0.55);
  ctx.lineTo(x - ux * s + uy * s * 0.55, y - uy * s - ux * s * 0.55);
  ctx.closePath();
  ctx.fill();
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, dash: number[] = []): void {
  ctx.setLineDash(dash);
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  ctx.setLineDash([]);
}

/** 시간축: 사건이 위아래 두 줄이면 그 사이, 한 줄이면 아래에 가로 축선 → 사건마다 축까지 줄기 · 점 */
function timeline(ctx: CanvasRenderingContext2D, rs: R[], z: number): void {
  const cy = rs.map((r) => r.y + r.h / 2), mid = (Math.min(...cy) + Math.max(...cy)) / 2;
  const up = rs.filter((r) => r.y + r.h / 2 < mid - 1), down = rs.filter((r) => r.y + r.h / 2 >= mid - 1);
  const y = up.length && down.length ? (bottom(up) + top(down)) / 2 : bottom(rs) + 20 * z;
  const x0 = left(rs) - 24 * z, x1 = right(rs) + 32 * z;
  line(ctx, x0, y, x1, y);
  head(ctx, x1, y, 1, 0);
  for (const r of rs) {
    const cx = r.x + r.w / 2, edge = r.y + r.h / 2 < y ? r.y + r.h : r.y;
    line(ctx, cx, edge, cx, y);
    ctx.beginPath(); ctx.arc(cx, y, 3.5, 0, Math.PI * 2); ctx.fill();
  }
}

/** 가장 넓은 빈틈의 가운데 (상자들을 한 축으로 펼쳤을 때) — 사분면 칸 사이 */
function split(rs: R[], axis: 'x' | 'y'): number {
  const s = axis === 'x' ? (r: R) => [r.x, r.x + r.w] as const : (r: R) => [r.y, r.y + r.h] as const;
  const spans = rs.map(s).sort((a, b) => a[0] - b[0]);
  let best = -1, at = (spans[0]![0] + Math.max(...spans.map((x) => x[1]))) / 2, end = spans[0]![1];
  for (const [a, b] of spans.slice(1)) { if (a - end > best) { best = a - end; at = (a + end) / 2; } end = Math.max(end, b); }
  return at;
}

/** 사분면: 칸 사이 십자 점선 + 왼쪽 세로 축(위로) · 아래 가로 축(오른쪽으로)과 원문 축 이름 */
function matrix(ctx: CanvasRenderingContext2D, rs: R[], z: number, axis?: GroupMeta['axis']): void {
  const pad = 16 * z, x0 = left(rs) - pad, x1 = right(rs) + pad, y0 = top(rs) - pad, y1 = bottom(rs) + pad;
  const sx = split(rs, 'x'), sy = split(rs, 'y');
  ctx.globalAlpha = 0.7;
  line(ctx, sx, y0, sx, y1, [5, 4]);
  line(ctx, x0, sy, x1, sy, [5, 4]);
  ctx.globalAlpha = 1;
  const ax = x0 - 10 * z, ay = y1 + 10 * z;
  line(ctx, ax, ay, ax, y0 - 8 * z); head(ctx, ax, y0 - 8 * z, 0, -1);
  line(ctx, ax, ay, x1 + 8 * z, ay); head(ctx, x1 + 8 * z, ay, 1, 0);
  if (axis?.y) { ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText(axis.y, ax + 6, y0 - 6 * z); }
  if (axis?.x) { ctx.textAlign = 'right'; ctx.textBaseline = 'top'; ctx.fillText(axis.x, x1 + 8 * z, ay + 5); }
}

/** 척도: 상자 줄 아래 양쪽 화살표 축 + 양 끝 이름(원문 극) */
function scale(ctx: CanvasRenderingContext2D, rs: R[], z: number, axis?: GroupMeta['axis']): void {
  const y = bottom(rs) + 22 * z, x0 = left(rs) - 8 * z, x1 = right(rs) + 8 * z;
  line(ctx, x0, y, x1, y);
  head(ctx, x0, y, -1, 0); head(ctx, x1, y, 1, 0);
  ctx.textBaseline = 'top';
  if (axis?.x) { ctx.textAlign = 'left'; ctx.fillText(axis.x, x0, y + 6); }
  if (axis?.y) { ctx.textAlign = 'right'; ctx.fillText(axis.y, x1, y + 6); }
}

const MEMBERSHIP = new Set(['part-of', 'subset-of', 'kind-of', 'example-of', 'elaborates']);
const VENN_TONES = ['#4c6ef5', '#d9730d', '#2b8a3e'];

/** 벤: 묶음 안에서 소속 화살표를 받는 상자 = 집합. 집합마다 (집합 상자 + 그 집합에 드는 상자들)을 감싸는 옅은 타원 */
function venn(ctx: CanvasRenderingContext2D, view: CanvasView, ids: readonly Id[], box: (id: Id) => R | null, z: number): void {
  const inside = new Set(ids), members = new Map<Id, Id[]>();
  for (const id of ids) for (const a of view.engine.arrowsOf(id).filter(isBound)) {
    if (a.from.blockId !== id || !inside.has(a.to.blockId) || !a.relation || !MEMBERSHIP.has(a.relation)) continue;
    members.set(a.to.blockId, [...(members.get(a.to.blockId) ?? []), id]);
  }
  [...members].slice(0, 3).forEach(([set, items], i) => {
    const rs = [set, ...items].map(box).filter((r): r is R => !!r);
    if (!rs.length) return;
    const pad = 18 * z, x0 = left(rs) - pad, x1 = right(rs) + pad, y0 = top(rs) - pad, y1 = bottom(rs) + pad;
    ctx.beginPath();
    ctx.ellipse((x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2 * 1.08, (y1 - y0) / 2 * 1.12, 0, 0, Math.PI * 2);
    ctx.globalAlpha = 0.07; ctx.fillStyle = VENN_TONES[i]!; ctx.fill();
    ctx.globalAlpha = 0.6; ctx.strokeStyle = VENN_TONES[i]!; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.globalAlpha = 1;
  });
}

const CAUSAL = new Set(['causes', 'leads-to', 'inhibits', 'correlates']);

/** 피시본 머리(결과): 묶음 안에서 원인 화살표를 가장 많이 받는 상자, 그 원인들 */
export function fishboneHead(view: CanvasView, ids: readonly Id[]): { head: Id; causes: Id[] } | null {
  const inside = new Set(ids), into = new Map<Id, Id[]>();
  for (const id of ids) for (const a of view.engine.arrowsOf(id).filter(isBound)) {
    if (a.from.blockId === id && inside.has(a.to.blockId) && a.relation && CAUSAL.has(a.relation)) into.set(a.to.blockId, [...(into.get(a.to.blockId) ?? []), id]);
  }
  const best = [...into].sort((a, b) => b[1].length - a[1].length)[0];
  return best && best[1].length >= 2 ? { head: best[0], causes: best[1] } : null;
}

/** 피시본: 결과까지 가로 등뼈(화살촉) + 원인마다 등뼈로 비스듬히 내려오는 가지 */
function fishbone(ctx: CanvasRenderingContext2D, view: CanvasView, ids: readonly Id[], box: (id: Id) => R | null, z: number): void {
  const fb = fishboneHead(view, ids), h = fb && box(fb.head);
  if (!fb || !h) return;
  const cs = fb.causes.map(box).filter((r): r is R => !!r);
  const y = h.y + h.h / 2, x0 = left(cs) - 24 * z;
  ctx.strokeStyle = ctx.fillStyle = '#d9730d';
  ctx.lineWidth = 2;
  line(ctx, x0, y, h.x - 4, y);
  head(ctx, h.x - 2, y, 1, 0);
  ctx.lineWidth = 1.5;
  for (const r of cs) {
    const above = r.y + r.h / 2 < y, sx = r.x + r.w / 2, sy = above ? r.y + r.h : r.y;
    line(ctx, sx, sy, sx + Math.abs(y - sy) * 0.6, y);
  }
}

/** 모양이 이미 보이는 화살표인가 — 시간축 안의 차례(next), 벤 안의 소속(일부 · 종류 · ⊂ …), 피시본의 원인 → 결과. 캔버스 · PNG가 옅게 그린다.
 *  heads: 한 번 그릴 때 피시본 머리를 묶음마다 한 번만 찾도록 그리는 쪽이 넘기는 메모 */
export function quietArrow(view: CanvasView, a: Arrow, heads: Map<string, Id | undefined>): boolean {
  if (!isBound(a)) return false; // 빈 곳 화살표는 모양 묶음과 상관없다
  const g = view.engine.getBlock(a.from.blockId)?.group;
  const shape = g && g === view.engine.getBlock(a.to.blockId)?.group ? view.engine.note.groups?.[g]?.shape : undefined;
  if (shape === 'timeline') return !a.relation || a.relation === 'next';
  if (shape === 'fishbone') {
    if (!heads.has(g!)) heads.set(g!, fishboneHead(view, groupMembers(view.engine).get(g!) ?? [])?.head);
    return a.to.blockId === heads.get(g!);
  }
  return shape === 'venn' && !!a.relation && MEMBERSHIP.has(a.relation);
}
