// 배치 다듬기 (서브 구조화): 이미 놓인 상자들의 자리 · 크기를 다듬는다. AI 구조화가 글에서 구조를 만든다면, 이것은 있는 구조의 모양을 고른다.
// 층은 화살표가 정한다(tidy-layer.ts — 상자를 조금 옮기고 다시 다듬어도 같은 결과): 층마다 줄 맞춤 · 부모는 자식들 가운데 · 간격 고르게
// (화살표 라벨 자리만큼). 한 도식(화살표로 이어진 상자들) 안의 내용 상자는 같은 폭 · 같은 높이로(최소 높이 minH), 제목 상자는 글 폭에 맞게.
// 곧게 맞출 수 없는 화살표(부채꼴)는 꺾은선 — 위→아래면 아래 → 위, 왼→오면 오른쪽 → 왼쪽 끝에서. 덩어리는 첫 상자 자리를 그대로 두고 겹치면 민다.
// 묶음은 안을 먼저 다듬어 한 덩어리로 옮기고, 모양이 곧 뜻인 것(모양 묶음 · 카드 · 고리 · 층 쌓기)은 안을 건드리지 않고 통째로만 옮긴다.
// 순수 함수 — 엔진 · DOM을 모른다(높이 재기 · 라벨 폭은 넘겨받는다). 같은 입력이면 같은 결과.
import type { Engine, TxResult } from './engine';
import { unionRects, type Rect, type Vec2 } from './geom';
import { isBound, type Id, type Side } from './model';
import { GAP_ACROSS, GAP_ALONG, layerLayout, type LayerEdge, type LayerItem } from './tidy-layer';

export interface TidyNode {
  readonly id: Id; readonly x: number; readonly y: number; readonly w: number; readonly h: number;
  /** 상자 위 이름표(노드 종류 태그) 높이 — 그 자리에는 다른 상자를 두지 않는다 */
  readonly top?: number;
  /** 폭을 바꿔도 되는 상자의 가장 좁은 폭(제목 한 줄이 들어가는 폭 · 본문 상자는 지금 폭). 없으면 폭을 바꾸지 않는다 */
  readonly minW?: number;
  /** 같은 도식 안에서 크기를 맞출 내용 상자 (글만 든 본문 상자) */
  readonly uniform?: boolean;
}
export interface TidyEdge {
  /** 화살표 id — 있으면 꺾은선 · 끝 자리를 정해 돌려준다(TidyPlan.routes) */
  readonly id?: Id;
  /** 배치 차례 (관계 뜻): forward = from이 앞 층(기본), reverse = to가 앞 층(일부 · 종류 · 예시 · 뒷받침 …), same = 같은 층 곁에 */
  readonly dir?: 'forward' | 'reverse' | 'same';
  readonly from: Id; readonly to: Id; readonly label?: string;
  /** 곁에 두기만 하는 가상 연결 (차트 · 표를 붙은 노드 곁에) — 흐름 방향을 정할 때는 세지 않는다 */
  readonly soft?: boolean;
}
export interface TidyGroup {
  readonly id: string; readonly members: readonly Id[];
  /** 안을 다듬지 않고 통째로만 옮긴다 (모양 묶음 · 카드) */
  readonly rigid?: boolean;
  /** 테두리 위 이름표 줄 높이 (기본 20) */
  readonly head?: number;
}
export interface TidyInput {
  readonly nodes: readonly TidyNode[];
  readonly edges: readonly TidyEdge[];
  readonly groups?: readonly TidyGroup[];
  /** 폭을 바꾼 상자의 새 높이 (없으면 높이는 그대로) */
  readonly heightAt?: (id: Id, w: number) => number;
  /** 층을 화살표 방향 대신 지금 자리로 (AI 프리셋 배치를 다듬을 때 — 프리셋이 정한 위아래를 지킨다) */
  readonly byPosition?: boolean;
  /** 화살표 라벨 칩 폭 (없으면 글자 수로 추정) */
  readonly labelWidth?: (label: string) => number;
}

/** 화살표 끝 자리 · 경로 — 곧게 이어지면 auto · 곧은 선, 아니면 꺾은선 */
export interface TidyRoute { readonly from: Side; readonly to: Side; readonly route?: 'orthogonal' }
/** rects: 상자 자리 · 크기, minH: 크기를 맞춘 상자의 최소 높이(null = 지운다), routes: 화살표 id → 끝 자리 · 경로 */
export interface TidyPlan { readonly rects: Map<Id, Rect>; readonly minH: Map<Id, number | null>; readonly routes: Map<Id, TidyRoute> }

/** 덩어리 사이(밀 때) · 부딪힘 판정 여백 · 테두리 여백(groups-view PAD와 같은 값) · 이름표 줄 · 한 폭 단계로 묶는 폭 비율 · 크기를 맞출 가장 넓은 상자 */
const COMPONENT_GAP = 48, HIT_GAP = 8, GROUP_PAD = 8, GROUP_HEAD = 20, WIDTH_SPAN = 1.4, UNIFY_MAX_W = 360;

/** 라벨 칩 폭 추정: 한글 11px · 그 밖 6.5px + 칩 여백 */
export function estimateLabelWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += /[ᄀ-ᇿ㄰-㆏가-힣぀-ヿ一-鿿]/.test(ch) ? 11 : 6.5;
  return Math.ceil(w + 18);
}

interface Item extends LayerItem {
  /** 묶음 · 고정 덩어리면 구성원 사각형(바깥 사각형과 같은 좌표계) */
  readonly members?: ReadonlyMap<Id, Rect>;
  /** 홀로 있는 상자: 이름표 높이 · 다듬은 크기 */
  readonly top?: number; readonly size?: { w: number; h: number };
}

export function tidyLayout(input: TidyInput): Map<Id, Rect> { return tidyPlan(input).rects; }

export function tidyPlan(input: TidyInput): TidyPlan {
  const nodes = new Map(input.nodes.map((n) => [n.id, n]));
  const labelW = input.labelWidth ?? estimateLabelWidth;
  const groups = (input.groups ?? []).map((g) => ({ ...g, members: g.members.filter((m) => nodes.has(m)) })).filter((g) => g.members.length >= 2);
  const inGroup = new Map<Id, (typeof groups)[number]>();
  for (const g of groups) for (const m of g.members) if (!inGroup.has(m)) inGroup.set(m, g);
  const free = input.nodes.filter((n) => !inGroup.has(n.id));
  const auto = shapedSets(free, input.edges);
  const fixed = new Set([...groups.filter((g) => g.rigid).flatMap((g) => g.members), ...auto.flat()]);

  // 1) 폭 · 높이 — 폭 단계는 한 도식(화살표로 이어진 상자들) 안에서만. 내용 상자는 같은 폭 · 같은 높이
  const loose = free.filter((n) => !fixed.has(n.id));
  const widths = new Map<Id, number>(), unified = new Map<Id, { w: number; h: number }>(), minH = new Map<Id, number | null>();
  for (const comp of components(loose, input.edges.map((e) => ({ a: e.from, b: e.to })))) {
    const ns = comp.map((id) => nodes.get(id)!);
    for (const [id, w] of fitWidths(ns)) widths.set(id, w);
    const uni = ns.filter((n) => n.uniform && (widths.get(n.id) ?? n.w) <= UNIFY_MAX_W);
    if (uni.length >= 2) {
      const w = Math.max(...uni.map((n) => widths.get(n.id) ?? n.w));
      const h = Math.max(...uni.map((n) => (input.heightAt ? input.heightAt(n.id, w) : n.h)));
      for (const n of uni) { unified.set(n.id, { w, h }); minH.set(n.id, Math.round(h)); }
    }
    for (const n of ns) if (n.uniform && !unified.has(n.id)) minH.set(n.id, null); // 맞추지 않은 상자는 예전에 맞춘 최소 높이를 지운다
  }
  for (const n of input.nodes) if (inGroup.has(n.id) && !fixed.has(n.id)) { const w = fitWidths([n]).get(n.id); if (w !== undefined) widths.set(n.id, w); }
  const size = new Map(input.nodes.map((n) => {
    const u = unified.get(n.id);
    if (u) return [n.id, u];
    const w = widths.get(n.id) ?? n.w;
    return [n.id, { w, h: w !== n.w && input.heightAt ? input.heightAt(n.id, w) : n.h }];
  }));
  const outer = (n: TidyNode, s = size.get(n.id)!): Rect => ({ x: n.x, y: n.y - (n.top ?? 0), w: s.w, h: s.h + (n.top ?? 0) });

  // 2) 덩어리(item): 묶음 · 고정 모양 · 홀로 있는 상자
  const items: Item[] = [];
  const itemOf = new Map<Id, string>();
  const unit = (id: string, rects: Map<Id, Rect>, pad: number, head: number) => {
    const u = unionRects([...rects.keys()].map((m) => { const n = nodes.get(m)!, r = rects.get(m)!; return { ...r, y: r.y - (n.top ?? 0), h: r.h + (n.top ?? 0) }; }))!;
    items.push({ id, x: u.x - pad, y: u.y - pad - head, w: u.w + 2 * pad, h: u.h + 2 * pad + head, members: rects });
    for (const m of rects.keys()) itemOf.set(m, id);
  };
  for (const g of groups) {
    const ms = g.members.map((m) => nodes.get(m)!);
    const inner = g.rigid
      ? new Map(ms.map((n) => [n.id, { x: n.x, y: n.y, w: n.w, h: n.h }]))
      : tidyLayout({ nodes: ms.map((n) => ({ ...n, ...size.get(n.id)!, minW: undefined })), edges: input.edges.filter((e) => inGroup.get(e.from) === g && inGroup.get(e.to) === g), labelWidth: labelW });
    unit(`g:${g.id}`, inner, GROUP_PAD, g.head ?? GROUP_HEAD);
  }
  auto.forEach((ids, k) => unit(`s:${k}`, new Map(ids.map((id) => { const n = nodes.get(id)!; return [id, { x: n.x, y: n.y, w: n.w, h: n.h }]; })), 0, 0));
  for (const n of free) {
    if (itemOf.has(n.id)) continue;
    items.push({ id: n.id, ...outer(n), top: n.top ?? 0, size: size.get(n.id)! });
    itemOf.set(n.id, n.id);
  }

  // 3) 덩어리 사이 화살표 → 이어진 것끼리 한 무리
  const links: LayerEdge[] = [];
  const seen = new Set<string>();
  for (const e of input.edges) {
    const [a, b] = e.dir === 'reverse' ? [itemOf.get(e.to), itemOf.get(e.from)] : [itemOf.get(e.from), itemOf.get(e.to)];
    const soft = e.soft || e.dir === 'same';
    if (!a || !b || a === b) continue;
    const key = `${a}\u0000${b}\u0000${e.label ?? ''}\u0000${soft ? 1 : 0}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ a, b, ...(e.label ? { label: labelW(e.label) } : {}), ...(soft ? { soft: true } : {}) });
  }
  const comps = components(items, links);
  const byItem = new Map(items.map((it) => [it.id, it]));
  const placed = new Map<string, Vec2>();
  const lonely = comps.every((c) => c.length === 1);
  const flowOf = new Map<string, boolean>(); // 덩어리(여럿) 안 상자 → 왼→오 흐름인가
  const local = comps.map((c) => {
    const its = c.map((id) => byItem.get(id)!);
    if (c.length > 1) {
      const r = layerLayout(its, links.filter((l) => c.includes(l.a)), input.byPosition);
      for (const id of c) flowOf.set(id, r.lr);
      return { its, pos: r.pos, root: r.root };
    }
    return { its, pos: new Map([[its[0]!.id, { x: 0, y: 0 }]]), root: its[0]!.id };
  });
  if (lonely && items.length > 1) {
    const pos = gridLayout(items);
    const o = unionRects(items)!;
    for (const it of items) { const p = pos.get(it.id)!; placed.set(it.id, { x: o.x + p.x, y: o.y + p.y }); }
  } else packComponents(local, placed);

  // 4) 새 자리 → 상자 사각형
  const out = new Map<Id, Rect>();
  for (const it of items) {
    const p = placed.get(it.id)!;
    if (it.members) {
      const dx = p.x - it.x, dy = p.y - it.y;
      for (const [m, r] of it.members) out.set(m, round({ x: r.x + dx, y: r.y + dy, w: r.w, h: r.h }));
    } else out.set(it.id, round({ x: p.x, y: p.y + it.top!, w: it.size!.w, h: it.size!.h }));
  }

  // 5) 화살표: 도식 안 홀로 있는 상자끼리, 흐름을 따라가는 것만 — 가운데가 맞으면 곧은 선, 아니면 꺾은선
  const routes = new Map<Id, TidyRoute>();
  for (const e of input.edges) {
    const lr = flowOf.get(e.from);
    if (!e.id || e.soft || lr === undefined || itemOf.get(e.from) !== e.from || itemOf.get(e.to) !== e.to || flowOf.get(e.to) !== lr) continue;
    const a = out.get(e.from)!, b = out.get(e.to)!;
    // 뒤 층으로 가는 화살표(앞 → 뒤)와 앞 층으로 가는 화살표(근거 → 주장처럼 위로) 둘 다 — 같은 층끼리는 그대로
    const forward = lr ? b.x >= a.x + a.w : b.y >= a.y + a.h, back = lr ? a.x >= b.x + b.w : a.y >= b.y + b.h;
    if (!forward && !back) continue;
    const straight = lr ? Math.abs(a.y + a.h / 2 - b.y - b.h / 2) <= 1 : Math.abs(a.x + a.w / 2 - b.x - b.w / 2) <= 1;
    const [out1, in1]: [Side, Side] = lr ? (forward ? ['right', 'left'] : ['left', 'right']) : forward ? ['bottom', 'top'] : ['top', 'bottom'];
    routes.set(e.id, straight ? { from: 'auto', to: 'auto' } : { from: out1, to: in1, route: 'orthogonal' });
  }
  return { rects: out, minH, routes };
}

/** 폭 단계: 넓은 것부터, 단계 폭이 그 상자의 가장 좁은 폭 × 1.4 안이면 같은 단계 — 비슷한 상자는 같은 폭, 훨씬 좁은 제목 상자는 따로 */
function fitWidths(nodes: readonly TidyNode[]): Map<Id, number> {
  const out = new Map<Id, number>();
  let rest = nodes.filter((n) => n.minW !== undefined).sort((a, b) => b.minW! - a.minW! || (a.id < b.id ? -1 : 1));
  while (rest.length) {
    const w = rest[0]!.minW!;
    const take = new Set(rest.filter((n) => w <= n.minW! * WIDTH_SPAN).map((n) => n.id));
    for (const id of take) out.set(id, Math.round(w));
    rest = rest.filter((n) => !take.has(n.id));
  }
  return out;
}

/** 모양이 곧 뜻인 상자 무리 (화살표로만 이어진 묶음 밖 상자들): 고리(모두 들어오고 나가는 화살표가 하나씩) · 층 쌓기(가운데 정렬로 쌓이고 폭이 한쪽으로 커짐) */
function shapedSets(free: readonly TidyNode[], edges: readonly TidyEdge[]): Id[][] {
  const ids = new Set(free.map((n) => n.id));
  const es = edges.filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);
  const out: Id[][] = [];
  for (const c of components(free.map((n) => ({ id: n.id })), es.map((e) => ({ a: e.from, b: e.to })))) {
    if (c.length < 3) continue;
    const set = new Set(c), mine = es.filter((e) => set.has(e.from));
    const ins = new Map(c.map((id) => [id, 0])), outs = new Map(c.map((id) => [id, 0]));
    for (const e of mine) { outs.set(e.from, outs.get(e.from)! + 1); ins.set(e.to, ins.get(e.to)! + 1); }
    const ring = mine.length === c.length && c.every((id) => ins.get(id) === 1 && outs.get(id) === 1);
    // 층 쌓기: 가운데 정렬 · 폭이 같은 걸음으로 커지거나 작아짐 · 층 사이가 촘촘함(다듬은 세로 사슬은 간격이 넓어 여기에 들지 않는다)
    const ns = c.map((id) => free.find((n) => n.id === id)!).sort((a, b) => a.y - b.y);
    const mid = (n: TidyNode) => n.x + n.w / 2;
    const steps = ns.slice(1).map((n, i) => n.w - ns[i]!.w);
    const pyramid = ns.every((n) => Math.abs(mid(n) - mid(ns[0]!)) <= 4) && Math.abs(steps[0]!) >= 16 && steps.every((d) => Math.abs(d - steps[0]!) <= 2)
      && ns.slice(1).every((n, i) => n.y - (n.top ?? 0) - (ns[i]!.y + ns[i]!.h) <= 32);
    if (ring || pyramid) out.push(c);
  }
  return out;
}

function components(items: readonly { readonly id: string }[], links: readonly { readonly a: string; readonly b: string }[]): string[][] {
  const parent = new Map(items.map((it) => [it.id, it.id]));
  const find = (v: string): string => { let r = v; while (parent.get(r) !== r) r = parent.get(r)!; parent.set(v, r); return r; };
  for (const l of links) if (parent.has(l.a) && parent.has(l.b)) parent.set(find(l.a), find(l.b));
  const by = new Map<string, string[]>();
  for (const it of items) { const r = find(it.id); by.set(r, [...(by.get(r) ?? []), it.id]); }
  return [...by.values()];
}

/** 화살표 없는 상자만 고른 때: 줄(세로로 겹치는 것끼리)을 읽어 줄 · 칸을 고르게. 줄마다 칸 수가 같으면 칸도 맞춘다 */
function gridLayout(items: readonly Item[]): Map<string, Vec2> {
  const rows: Item[][] = [];
  let end = -Infinity;
  for (const it of [...items].sort((a, b) => a.y - b.y || a.x - b.x)) {
    if (rows.length && end - it.y >= it.h / 4) rows.at(-1)!.push(it);
    else { rows.push([it]); end = -Infinity; }
    end = Math.max(end, it.y + it.h);
  }
  for (const r of rows) r.sort((a, b) => a.x - b.x);
  const cols = rows.every((r) => r.length === rows[0]!.length) ? rows[0]!.length : 0;
  const colW = Array.from({ length: cols }, (_, k) => Math.max(...rows.map((r) => r[k]!.w)));
  const pos = new Map<string, Vec2>();
  let y = 0;
  for (const r of rows) {
    // 줄 안은 가운데 높이를 맞춘다 — 위만 맞추면 키 큰 상자 때문에 다시 다듬을 때 줄이 갈린다
    const rowH = Math.max(...r.map((it) => it.h));
    let x = 0;
    r.forEach((it, k) => {
      const cw = cols ? colW[k]! : it.w;
      pos.set(it.id, { x: x + (cw - it.w) / 2, y: y + (rowH - it.h) / 2 });
      x += cw + GAP_ACROSS;
    });
    y += rowH + GAP_ALONG;
  }
  return pos;
}

/**
 * 덩어리마다 첫 상자(root)를 지금 자리에 그대로 — 다른 상자를 옮겨 놓고 다듬어도 도식이 통째로 따라가지 않게. 먼저 놓은 덩어리와
 * 겹치면 원래 그 오른쪽에 있었으면 오른쪽으로, 아니면 아래로 민다
 */
function packComponents(local: readonly { its: readonly Item[]; pos: Map<string, Vec2>; root: string }[], placed: Map<string, Vec2>): void {
  const boxes = local.map((c) => {
    const orig = unionRects(c.its)!;
    const root = c.its.find((it) => it.id === c.root)!, rp = c.pos.get(c.root)!;
    const w = Math.max(...c.its.map((it) => c.pos.get(it.id)!.x + it.w)), h = Math.max(...c.its.map((it) => c.pos.get(it.id)!.y + it.h));
    return { c, orig, x: root.x - rp.x, y: root.y - rp.y, w, h };
  }).sort((a, b) => a.orig.y - b.orig.y || a.orig.x - b.orig.x);
  const done: { r: Rect; orig: Rect }[] = [];
  // 부딪힘은 좁게(8px — 사용자가 붙여 둔 제목과 도식은 그대로), 밀 때는 넓게(48px) — 한 번 민 덩어리를 다시 다듬을 때 또 밀지 않게
  const hits = (a: Rect, b: Rect) => a.x < b.x + b.w + HIT_GAP && b.x < a.x + a.w + HIT_GAP && a.y < b.y + b.h + HIT_GAP && b.y < a.y + a.h + HIT_GAP;
  for (const b of boxes) {
    let r: Rect = { x: b.x, y: b.y, w: b.w, h: b.h };
    for (let k = 0; k < done.length * 2 + 2; k++) {
      const hit = done.find((d) => hits(r, d.r));
      if (!hit) break;
      r = b.orig.x >= hit.orig.x + hit.orig.w ? { ...r, x: hit.r.x + hit.r.w + COMPONENT_GAP } : { ...r, y: hit.r.y + hit.r.h + COMPONENT_GAP };
    }
    done.push({ r, orig: b.orig });
    for (const it of b.c.its) { const p = b.c.pos.get(it.id)!; placed.set(it.id, { x: r.x + p.x, y: r.y + p.y }); }
  }
}

const round = (r: Rect): Rect => ({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) });

/**
 * 다듬은 자리 · 크기 · 화살표를 한 번에 반영 (실행 취소 한 번). 바뀐 상자만 쓴다. 화살표는 곧은 선 · 꺾은선인 것만 —
 * 사용자가 고른 곡선 · 되돌림, 묶음에 붙은 끝은 그대로
 */
export function applyTidy(engine: Engine, plan: ReadonlyMap<Id, Rect> | TidyPlan, label = '배치 다듬기'): TxResult<number> {
  const p: TidyPlan = plan instanceof Map ? { rects: plan as Map<Id, Rect>, minH: new Map(), routes: new Map() } : plan as TidyPlan;
  return engine.transact((tx) => {
    let n = 0;
    for (const [id, r] of p.rects) {
      const b = engine.getBlock(id);
      if (!b) continue;
      const mh = p.minH.get(id), minH = b.sizing !== 'auto' || mh === undefined ? b.minH : mh ?? undefined;
      if (b.x === r.x && b.y === r.y && b.w === r.w && b.h === r.h && minH === b.minH) continue;
      tx.set('block', id, { x: r.x, y: r.y, w: r.w, ...(b.sizing === 'auto' ? { h: r.h, minH } : {}) });
      n++;
    }
    for (const [id, rt] of p.routes) {
      const a = engine.getArrow(id);
      const route = a?.style?.route;
      if (!a || !isBound(a) || a.from.groupId || a.to.groupId || (route && route !== 'straight' && route !== 'orthogonal')) continue;
      if (a.from.side === rt.from && a.to.side === rt.to && a.from.t === undefined && a.to.t === undefined && (route ?? 'straight') === (rt.route ?? 'straight')) continue;
      const { route: _r, ...rest } = a.style ?? {};
      const style = rt.route ? { ...rest, route: rt.route } : Object.keys(rest).length ? rest : undefined;
      tx.set('arrow', id, { from: { blockId: a.from.blockId, side: rt.from }, to: { blockId: a.to.blockId, side: rt.to }, style });
    }
    return n;
  }, { origin: 'user', label });
}
