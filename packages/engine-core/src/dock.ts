// 블록 도킹 — 자유 배치를 지키면서 겹치지 않게, 가까이 가면 레고처럼 착 붙게.
// 원칙(사용자 결정 10/02): 멀리 두면 완전 자유 배치 · 근처로 끌면 자석 스냅 · 겹치게 놓으면 가장 가까운 빈 자리로 붙인다.
// 다른 블록은 움직이지 않는다 — 사용자가 놓은 자리를 앱이 바꾸지 않는다(노션식 쌓기와 다른 점).
// 예외 하나(사용자 결정 11/02, AT-020): 글이 늘어 상자가 커지면 닿는 아래 상자만 레고처럼 함께 내린다(flowBelow).
// 모두 순수 계산이다 — 엔진은 읽기만 하고, 결과(좌표)를 커맨드가 트랜잭션으로 반영한다.
import type { Engine } from './engine';
import { q, type Rect, type Vec2 } from './geom';
import type { Id } from './model';

/** 붙은 상자 사이 간격 (월드 px) — 레고 이음매 */
export const DOCK_GAP = 16;

type Reader = Pick<Engine, 'queryBlocks' | 'blockRect'>;

/** 두 사각형이 겹치는가 (경계가 맞닿는 것은 겹침이 아님) */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  const e = 0.5;
  return a.x < b.x + b.w - e && b.x < a.x + a.w - e && a.y < b.y + b.h - e && b.y < a.y + a.h - e;
}

/** `r`과 겹치는 블록들 (제외 목록 빼고) */
function overlapping(reader: Reader, r: Rect, exclude: ReadonlySet<Id>): { id: Id; rect: Rect }[] {
  const out: { id: Id; rect: Rect }[] = [];
  for (const id of reader.queryBlocks(r)) {
    if (exclude.has(id)) continue;
    const br = reader.blockRect(id);
    if (br && rectsOverlap(br, r)) out.push({ id, rect: br });
  }
  return out;
}

/** `r` 자리에 다른 블록이 없는가 */
export function isFree(reader: Reader, r: Rect, exclude: ReadonlySet<Id> = new Set()): boolean {
  return overlapping(reader, r, exclude).length === 0;
}

/** 겹친 블록 B 주변에 `r`을 붙일 수 있는 자리들 (아래 · 오른쪽 · 위 · 왼쪽, 그리고 B와 가장자리를 맞춘 변형) */
function dockCandidates(r: Rect, b: Rect, gap: number): Vec2[] {
  return [
    { x: r.x, y: b.y + b.h + gap }, { x: b.x, y: b.y + b.h + gap },          // 아래 (제자리 x · 왼쪽 맞춤)
    { x: b.x + b.w + gap, y: r.y }, { x: b.x + b.w + gap, y: b.y },          // 오른쪽 (제자리 y · 위 맞춤)
    { x: r.x, y: b.y - gap - r.h }, { x: b.x, y: b.y - gap - r.h },          // 위
    { x: b.x - gap - r.w, y: r.y }, { x: b.x - gap - r.w, y: b.y },          // 왼쪽
  ];
}

/**
 * `r`이 다른 블록과 겹치면 가장 가까운 "붙는 자리"를 찾는다 (겹친 블록의 아래 · 옆, 간격 DOCK_GAP).
 * 붙는 자리도 막혀 있으면 그 자리에서 다시 붙는 자리를 찾는다(최대 4단계) — 모여 있는 블록 가장자리에 이어 붙는다.
 */
/** inBounds: 놓을 수 있는 범위 (용지 A4 등) — 밖인 자리는 건너뛰고 계속 찾는다 */
export function findDockSpot(reader: Reader, r: Rect, exclude: ReadonlySet<Id> = new Set(), gap = DOCK_GAP, inBounds: (r: Rect) => boolean = () => true): Vec2 {
  if (inBounds(r) && isFree(reader, r, exclude)) return { x: r.x, y: r.y };
  let frontier: Vec2[] = [{ x: r.x, y: r.y }];
  const seen = new Set<string>();
  let best = null as { p: Vec2; d: number } | null;
  for (let depth = 0; depth < 4 && frontier.length; depth++) {
    const next: Vec2[] = [];
    for (const p of frontier) {
      const at = { ...r, x: p.x, y: p.y };
      for (const o of overlapping(reader, at, exclude)) {
        for (const c of dockCandidates(at, o.rect, gap)) {
          const key = `${q(c.x)},${q(c.y)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const d = Math.hypot(c.x - r.x, c.y - r.y);
          if (best && d >= best.d) continue;
          if (inBounds({ ...r, x: c.x, y: c.y }) && isFree(reader, { ...r, x: c.x, y: c.y }, exclude)) best = { p: c, d };
          else next.push(c);
        }
      }
    }
    if (best) break;
    frontier = next.slice(0, 64);
  }
  return best ? { x: q(best.p.x), y: q(best.p.y) } : spiral(reader, r, exclude, gap, inBounds);
}

function spiral(reader: Reader, r: Rect, exclude: ReadonlySet<Id>, gap: number, inBounds: (r: Rect) => boolean): Vec2 {
  const step = Math.max(40, gap * 3);
  for (let ring = 1; ring <= 60; ring++) {
    const d = ring * step;
    for (const [dx, dy] of [[0, d], [d, 0], [0, -d], [-d, 0], [d, d], [-d, d], [d, -d], [-d, -d]] as const) {
      const c = { ...r, x: r.x + dx, y: r.y + dy };
      if (inBounds(c) && isFree(reader, c, exclude)) return { x: q(c.x), y: q(c.y) };
    }
  }
  return { x: r.x, y: r.y };
}

export interface SnapGuide { readonly axis: 'x' | 'y'; readonly at: number; readonly from: number; readonly to: number }

/**
 * 자석 스냅: 끌고 있는 사각형 `r`의 가장자리를 주변 블록의 가장자리 · 붙는 자리(간격 DOCK_GAP)에 맞춘다.
 * `threshold`는 월드 단위(화면 px ÷ 줌). 멀면 그대로(자유 배치). 맞춘 축마다 안내선을 돌려준다.
 */
export function snapRect(reader: Reader, r: Rect, exclude: ReadonlySet<Id>, threshold: number, gap = DOCK_GAP): { x: number; y: number; guides: SnapGuide[] } {
  const pad = threshold + gap;
  const near = reader.queryBlocks({ x: r.x - pad, y: r.y - pad, w: r.w + 2 * pad, h: r.h + 2 * pad });
  let bestX = null as { v: number; d: number; at: number; o: Rect } | null;
  let bestY = null as { v: number; d: number; at: number; o: Rect } | null;
  for (const id of near) {
    if (exclude.has(id)) continue;
    const o = reader.blockRect(id);
    if (!o) continue;
    // 옆에 붙기는 세로로 마주 볼 때만, 위아래 붙기는 가로로 마주 볼 때만 (멀리 떨어진 블록에 줄 맞춤으로 끌려가지 않게)
    const facingV = r.y < o.y + o.h + gap && o.y < r.y + r.h + gap;
    const facingH = r.x < o.x + o.w + gap && o.x < r.x + r.w + gap;
    const xs: [number, number][] = [];
    if (facingV) xs.push([o.x + o.w + gap, o.x + o.w + gap / 2], [o.x - gap - r.w, o.x - gap / 2]);
    if (facingH) xs.push([o.x, o.x], [o.x + o.w - r.w, o.x + o.w]);
    for (const [v, at] of xs) { const d = Math.abs(v - r.x); if (d <= threshold && (!bestX || d < bestX.d)) bestX = { v, d, at, o }; }
    const ys: [number, number][] = [];
    if (facingH) ys.push([o.y + o.h + gap, o.y + o.h + gap / 2], [o.y - gap - r.h, o.y - gap / 2]);
    if (facingV) ys.push([o.y, o.y], [o.y + o.h - r.h, o.y + o.h]);
    for (const [v, at] of ys) { const d = Math.abs(v - r.y); if (d <= threshold && (!bestY || d < bestY.d)) bestY = { v, d, at, o }; }
  }
  // 붙는 자리가 이미 다른 블록에 막혀 있으면 그 축의 스냅은 버린다 — 끄는 동안 보이는 자리 = 놓았을 때 자리
  const free = (x: number, y: number) => isFree(reader, { ...r, x, y }, exclude);
  if (bestX && bestY && !free(bestX.v, bestY.v)) {
    if (free(bestX.v, r.y)) bestY = null; else if (free(r.x, bestY.v)) bestX = null; else { bestX = null; bestY = null; }
  }
  if (bestX && !bestY && !free(bestX.v, r.y)) bestX = null;
  if (bestY && !bestX && !free(r.x, bestY.v)) bestY = null;
  const x = bestX ? bestX.v : r.x, y = bestY ? bestY.v : r.y;
  const guides: SnapGuide[] = [];
  if (bestX) guides.push({ axis: 'x', at: bestX.at, from: Math.min(y, bestX.o.y), to: Math.max(y + r.h, bestX.o.y + bestX.o.h) });
  if (bestY) guides.push({ axis: 'y', at: bestY.at, from: Math.min(x, bestY.o.x), to: Math.max(x + r.w, bestY.o.x + bestY.o.w) });
  return { x: q(x), y: q(y), guides };
}

/** 레고 밀기로 내려 둔 상자 → 내린 거리 · 내린 뒤 y. 글이 줄면 그만큼까지만 되돌린다(사용자가 그 뒤 옮겼으면 y가 달라 잊는다) */
export type PushDebt = Map<Id, { by: number; y: number }>;

/**
 * 글이 늘어 높이가 바뀐 상자 아래를 레고처럼 (AT-020 — 사용자 결정 11/02, ADR-0014의 예외).
 * 늘면: 늘어난 상자가 이음매(gap) 안으로 닿는 아래 상자(가로로 겹치는 것)를 이음매만큼 떨어지게 내리고, 그 아래도 줄줄이.
 * 줄면: 이음매로 붙어 있고 앞서 내려 둔 상자만 내린 만큼까지 다시 올린다 — 다른 상자에도 붙어 있거나 올릴 자리가 막혔으면 그대로.
 * 옆 · 위 상자, 처음부터 겹쳐 있던 상자는 그대로. at: 이번에 바뀐 자리 — 여러 상자를 한 번에 잴 때 이어 쓰고, 옮길 자리를 여기에 넣는다
 */
export function flowBelow(reader: Reader, id: Id, before: Rect, h: number, at: Map<Id, Rect>, debt: PushDebt, gap = DOCK_GAP): void {
  const e = 0.5;
  const rect = (i: Id) => at.get(i) ?? reader.blockRect(i);
  const xOver = (a: Rect, b: Rect) => a.x < b.x + b.w - e && b.x < a.x + a.w - e;
  // 공간 색인은 옮기기 전 자리 — 이번에 옮긴 상자는 바뀐 자리로 다시 거른다
  const near = (r: Rect): { id: Id; r: Rect }[] => [...new Set([...reader.queryBlocks(r), ...at.keys()])].flatMap((i) => {
    const m = rect(i);
    return m && m.x <= r.x + r.w && r.x <= m.x + m.w && m.y <= r.y + r.h && r.y <= m.y + m.h ? [{ id: i, r: m }] : [];
  });
  // 아래 상자인가는 옮기기 전 자리로 — 줄줄이 내리다 앞 상자가 뒤 상자 아래로 가도 순서가 뒤집히지 않게(되부름이 늘 아래로만 간다)
  const below = (o: Id, src: Id) => { const o0 = reader.blockRect(o), s0 = reader.blockRect(src); return !!o0 && !!s0 && o0.y >= s0.y + s0.h - e; };
  const push = (src: Id, a: Rect, oldBottom: number): void => {
    const bottom = a.y + a.h;
    for (const { id: oid } of near({ x: a.x, y: oldBottom - e, w: a.w, h: bottom + gap - oldBottom + e })) {
      const r = rect(oid)!, dy = bottom + gap - r.y; // 지금 자리 — 앞의 줄줄이 밀기가 이미 옮겼을 수 있다
      if (oid === src || !xOver(a, r) || !below(oid, src) || dy <= e) continue;
      const n = { ...r, y: q(r.y + dy) }, d = debt.get(oid);
      at.set(oid, n);
      debt.set(oid, { by: (d && Math.abs(d.y - r.y) < e ? d.by : 0) + n.y - r.y, y: n.y });
      push(oid, n, r.y + r.h);
    }
  };
  const pull = (src: Id, a: Rect, oldBottom: number): void => {
    const freed = oldBottom - a.y - a.h, seam = (top: number, p: Rect) => Math.abs(p.y + p.h + gap - top) <= 1;
    for (const { id: oid } of near({ x: a.x, y: oldBottom + gap - 1, w: a.w, h: 2 })) {
      const r = rect(oid)!;
      if (oid === src || !xOver(a, r) || !below(oid, src) || Math.abs(r.y - oldBottom - gap) > 1) continue;
      const d = debt.get(oid);
      if (!d || Math.abs(d.y - r.y) > e) { debt.delete(oid); continue; } // 사용자가 놓은 자리
      if (near({ x: r.x, y: r.y - gap - 1, w: r.w, h: 2 }).some((p) => p.id !== src && p.id !== oid && xOver(p.r, r) && seam(r.y, p.r))) continue;
      const k = Math.min(freed, d.by), n = { ...r, y: q(r.y - k) };
      if (k <= e || near(n).some((p) => p.id !== oid && rectsOverlap(p.r, n))) continue;
      at.set(oid, n);
      if (d.by - k > e) debt.set(oid, { by: d.by - k, y: n.y }); else debt.delete(oid);
      pull(oid, n, r.y + r.h);
    }
  };
  const a0 = { x: before.x, y: before.y, w: before.w, h };
  at.set(id, a0);
  if (h > before.h) push(id, a0, before.y + before.h);
  else if (h < before.h) pull(id, a0, before.y + before.h);
}

/**
 * 크기 조절이 다른 상자를 덮지 않게 (10/29 — 붙여 둔 상자를 키우면 옆 상자가 가려져 바뀐 것처럼 보이던 것): 바꾼 변이
 * 이웃 상자의 이음매(gap) 안으로 들어가면 그 앞에서 멈춘다. s = 처음 사각형, r = 바라는 사각형. 다른 상자는 움직이지 않는다.
 * 처음부터 겹쳐 있던 상자 · 처음부터 gap보다 가까웠던 축은 따지지 않는다(그 변을 움직이지 않으면 그대로)
 */
export function fitResize(reader: Reader, s: Rect, r: Rect, exclude: ReadonlySet<Id>, gap = DOCK_GAP): Rect {
  const e = 0.5, sR = s.x + s.w, sB = s.y + s.h;
  const ux = Math.min(s.x, r.x), uy = Math.min(s.y, r.y);
  const near = reader.queryBlocks({ x: ux - gap, y: uy - gap, w: Math.max(sR, r.x + r.w) - ux + 2 * gap, h: Math.max(sB, r.y + r.h) - uy + 2 * gap });
  let c = r;
  for (const id of near) {
    const o = exclude.has(id) ? undefined : reader.blockRect(id);
    if (!o) continue;
    const gx = (a: Rect) => Math.max(o.x - a.x - a.w, a.x - o.x - o.w), gy = (a: Rect) => Math.max(o.y - a.y - a.h, a.y - o.y - o.h);
    if (gx(s) < -e && gy(s) < -e) continue;
    const hits = (a: Rect) => (gy(a) < -e && gx(a) < Math.min(gap, gx(s)) - e) || (gx(a) < -e && gy(a) < Math.min(gap, gy(s)) - e);
    if (!hits(c)) continue;
    // 이 상자 쪽으로 움직인 변마다 이음매 앞까지 — 하나로 풀리면 덜 잘리는 쪽, 아니면 모두
    const R = c.x + c.w, B = c.y + c.h, cuts: Rect[] = [];
    if (R > sR && o.x >= sR - e) cuts.push({ ...c, w: Math.max(sR, o.x - gap) - c.x });
    if (c.x < s.x && o.x + o.w <= s.x + e) { const l = Math.min(s.x, o.x + o.w + gap); cuts.push({ ...c, x: l, w: R - l }); }
    if (B > sB && o.y >= sB - e) cuts.push({ ...c, h: Math.max(sB, o.y - gap) - c.y });
    if (c.y < s.y && o.y + o.h <= s.y + e) { const t = Math.min(s.y, o.y + o.h + gap); cuts.push({ ...c, y: t, h: B - t }); }
    const ok = cuts.filter((a) => !hits(a));
    c = ok.length ? ok.reduce((m, a) => (a.w * a.h > m.w * m.h ? a : m))
      : cuts.reduce((m, a) => { const x = Math.max(m.x, a.x), y = Math.max(m.y, a.y); return { x, y, w: Math.min(m.x + m.w, a.x + a.w) - x, h: Math.min(m.y + m.h, a.y + a.h) - y }; }, c);
  }
  return c;
}
