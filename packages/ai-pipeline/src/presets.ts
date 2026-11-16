// 도식 원형별 배치 프리셋 (STRUCTURE-GUIDE 2.1 · 2.6, Figma "AI 구조 도식 가이드" P-01~P-23).
// 구조 하나(patterns 항목)의 상자들을 그 원형 모양으로 놓는다: 사슬은 왼→오, 단계 · 증명은 위→아래, 고리는 원,
// 나란히 열 · 대응은 열(같은 기준은 같은 높이), 사분면은 2×2, 방사는 가운데 + 둘레, 레인은 띠, 층 쌓기는 가운데 정렬 층.
// 모양을 정할 수 없으면(묶음 · 축 정보가 없으면) 계층형으로 물러선다. 좌표는 좌상단 (0,0) 기준 상대값, 서로 겹치지 않는다.
import { RELATION_SPEC, type Vec2 } from '@dn/engine-core';
import { bands, framesClash } from './bands';
import { layeredLayout, type LayoutEdge, type LayoutNode } from './layout';
import { vennLayout } from './venn';
import { fishboneLayout } from './fishbone';
import type { StructurePattern } from './structure';

export interface PresetNode extends LayoutNode { readonly order?: number; readonly axis?: { readonly x?: string; readonly y?: string } }
export interface PresetEdge {
  readonly from: string; readonly to: string; readonly relation?: string;
  /** 화살표 라벨 (배치 다듬기의 간격) */ readonly label?: string;
  /** 같은 층에 나란히 (차트 · 표를 붙은 노드 곁에 두는 배치용 가상 엣지) */ readonly same?: boolean;
}
export interface PresetGroup { readonly key: string; readonly title?: string; readonly kind?: string; /** 맨 바깥 묶음 key (앱 묶음 테두리) */ readonly band?: string; readonly members: readonly string[] }
export interface PresetInput {
  /** 이 구조의 상자 — 원문 차례(구조 판별 nodes 순서) */
  readonly nodes: readonly PresetNode[];
  /** 이 구조 안의 엣지 (원래 방향 — 뒤집기 · 같은 층은 관계 표로 프리셋이 정한다) */
  readonly edges: readonly PresetEdge[];
  /** 이 구조 안의 묶음 (열 · 칸 · 레인 · 사분면) */
  readonly groups: readonly PresetGroup[];
  readonly pattern?: StructurePattern;
}
export interface PresetResult { readonly pos: Map<string, Vec2>; /** 폭을 바꾼 상자 (층 쌓기) */ readonly width?: Map<string, number> }

export type Archetype = 'chain' | 'steps' | 'timeline' | 'cycle' | 'loop' | 'tree' | 'fishbone' | 'decision' | 'columns' | 'table' | 'matrix' | 'scale'
  | 'nest' | 'radial' | 'argument' | 'proof' | 'lanes' | 'network' | 'mapping' | 'chart' | 'form' | 'levels' | 'venn';
const ARCHETYPES = new Set<string>(['chain', 'steps', 'timeline', 'cycle', 'loop', 'tree', 'fishbone', 'decision', 'columns', 'table', 'matrix', 'scale',
  'nest', 'radial', 'argument', 'proof', 'lanes', 'network', 'mapping', 'chart', 'form', 'levels', 'venn']);
/** 계층형(화살표 따라 층)으로 그리는 원형 — 같은 상자를 나눠 쓰는 다른 구조와 한 덩어리로 합칠 수 있다 */
const GRAPH = new Set<string>(['chain', 'steps', 'tree', 'fishbone', 'decision', 'argument', 'proof', 'network', 'table', 'chart']);
export const isGraphArchetype = (a: string): boolean => GRAPH.has(a);

type Dir = 'LR' | 'RL' | 'TB' | 'BT';
/** 원형 키 + 방향 힌트: "chain(세로)" → chain · TB, "tree(결론 왼쪽)" → tree · RL, "lanes(가로)" → lanes · LR */
export function parseArchetype(raw: string | undefined): { key?: Archetype; dir?: Dir } {
  const s = (raw ?? '').toLowerCase();
  const key = /[a-z]+/.exec(s)?.[0];
  const dir: Dir | undefined = /\brl\b|결론 왼쪽/.test(s) ? 'RL' : /\btb\b|세로/.test(s) ? 'TB' : /\blr\b|가로/.test(s) ? 'LR' : /\bbt\b/.test(s) ? 'BT' : undefined;
  return { ...(key && ARCHETYPES.has(key) ? { key: key as Archetype } : {}), ...(dir ? { dir } : {}) };
}

/** 원형이 정한 방향 (Figma 원형 프레임) — 고정이면 원문 판별의 방향보다 앞선다 */
const FIXED: Partial<Record<Archetype, Dir>> = { steps: 'TB', proof: 'TB', argument: 'BT' };
const DEFAULT: Partial<Record<Archetype, Dir>> = { chain: 'LR', tree: 'TB', fishbone: 'LR', decision: 'LR', network: 'LR', table: 'LR', chart: 'LR' };

const vennPos = (input: PresetInput): PresetResult | null => { const pos = vennLayout(input); return pos ? { pos } : null; };

/** 상자 사이 · 열 사이 · 묶음 줄 사이(묶음 테두리 · 이름 자리) */
const GAP = 32, COL_GAP = 120, ROW_GAP = 72;

export function runPreset(a: Archetype, input: PresetInput, hint?: Dir): PresetResult {
  const dir = FIXED[a] ?? input.pattern?.direction ?? hint ?? DEFAULT[a] ?? 'LR';
  switch (a) {
    case 'cycle': case 'loop': return { pos: ring(input, cycleOrder(input)) };
    case 'radial': return radial(input);
    case 'timeline': return { pos: timeline(input) };
    case 'venn': return input.groups.length >= 2 ? columns(input)! : (vennPos(input) ?? columns(input) ?? layered(input, 'LR'));
    case 'columns': case 'nest': case 'mapping': return columns(input) ?? layered(input, 'LR');
    case 'matrix': return matrix(input) ?? columns(input) ?? layered(input, 'LR');
    case 'form': return form(input);
    case 'lanes': return lanes(input, dir === 'TB' || dir === 'BT' ? 'TB' : 'LR') ?? layered(input, 'LR');
    case 'levels': return levels(input);
    case 'scale': return { pos: row(input.nodes) };
    case 'argument': return layered(input, 'BT', { refutes: 'same' });
    case 'steps': case 'proof': return wrapRows(layered(input, 'TB'), input.nodes);
    case 'fishbone': { const pos = fishboneLayout(input); return pos ? { pos } : layered(input, dir); }
    default: return layered(input, dir);
  }
}

// ───────── 계층형 (사슬 · 단계 · 트리 · 증명 · 논증 · 분기 · 관계망) ─────────

function layoutEdges(edges: readonly PresetEdge[], over: Record<string, 'same' | 'forward' | 'reverse'> = {}): LayoutEdge[] {
  return edges.map((e) => {
    const how = e.same ? 'same' : (e.relation && over[e.relation]) ?? (e.relation ? RELATION_SPEC[e.relation as keyof typeof RELATION_SPEC]?.layout : undefined);
    return how === 'reverse' ? { from: e.to, to: e.from } : how === 'same' ? { from: e.from, to: e.to, sameLayer: true } : { from: e.from, to: e.to };
  }).filter((e) => e.from !== e.to);
}

function layered(input: PresetInput, dir: Dir, over?: Record<string, 'same' | 'forward' | 'reverse'>): PresetResult {
  const le = layoutEdges(input.edges, over), lr = dir === 'LR' || dir === 'RL';
  let pos = layeredLayout({ nodes: input.nodes, edges: le, direction: lr ? 'LR' : 'TB' });
  // 묶음 테두리가 겹치면 묶음마다 띠로 (bands.ts)
  if (input.groups.length && framesClash(pos, input.nodes, input.groups)) pos = bands(pos, input.nodes, input.groups, new Set(le.flatMap((e) => [e.from, e.to])), lr);
  if (dir === 'BT' || dir === 'RL') mirror(pos, input.nodes, dir === 'BT' ? 'y' : 'x');
  return { pos };
}

/** 위→아래 단계가 7층을 넘으면 다음 열로 이어 쓴다 (STRUCTURE-GUIDE 2.6 "단계 7(TB)") — 열마다 고르게.
 *  둘째 열은 아래→위(ㄹ자)로 — 첫 열 끝에서 둘째 열 처음으로 가는 화살표가 짧은 가로선이 되게(대각선으로 그림을 가로지르지 않게) */
const MAX_ROWS = 7;
function wrapRows(r: PresetResult, nodes: readonly LayoutNode[]): PresetResult {
  const ys = [...new Set([...r.pos.values()].map((p) => p.y))].sort((a, b) => a - b);
  if (ys.length <= MAX_ROWS) return r;
  const per = Math.ceil(ys.length / Math.ceil(ys.length / MAX_ROWS));
  const size = new Map(nodes.map((n) => [n.id, n]));
  const colW = Math.max(...[...r.pos].map(([id, p]) => p.x + size.get(id)!.w)) + COL_GAP;
  const rowY = ys.slice(0, per).map((y) => y - ys[0]!);
  const pos = new Map<string, Vec2>();
  for (const [id, p] of r.pos) {
    const row = ys.indexOf(p.y), col = Math.floor(row / per), k = row - col * per;
    pos.set(id, { x: p.x + col * colW, y: rowY[col % 2 ? per - 1 - k : k]! });
  }
  return { pos };
}

/** 뒤집기 (논증: 결론 위 · 근거 아래, 이슈 트리: 결론 왼쪽) — 연결 없는 상자는 아래 격자 그대로 */
function mirror(pos: Map<string, Vec2>, nodes: readonly LayoutNode[], axis: 'x' | 'y'): void {
  const size = new Map(nodes.map((n) => [n.id, n]));
  const max = Math.max(0, ...[...pos].map(([id, p]) => p[axis] + (axis === 'x' ? size.get(id)!.w : size.get(id)!.h)));
  for (const [id, p] of pos) pos.set(id, axis === 'x' ? { x: max - p.x - size.get(id)!.w, y: p.y } : { x: p.x, y: max - p.y - size.get(id)!.h });
}

// ───────── 원 (고리 · 되먹임 고리 · 방사) ─────────

/** 고리 차례: 첫 상자에서 화살표를 따라가고, 남은 것은 원문 차례로 */
function cycleOrder(input: PresetInput): string[] {
  const ids = input.nodes.map((n) => n.id), idx = new Map(ids.map((id, i) => [id, i]));
  const out: string[] = [], seen = new Set<string>();
  let cur: string | undefined = ids[0];
  while (cur && !seen.has(cur)) {
    out.push(cur); seen.add(cur);
    cur = input.edges.filter((e) => e.from === cur && idx.has(e.to) && !seen.has(e.to)).sort((a, b) => idx.get(a.to)! - idx.get(b.to)!)[0]?.to;
    if (!cur) cur = ids.find((id) => !seen.has(id));
  }
  return out;
}

/** 12시에서 시계 방향으로 타원 위에 — 겹치면 반지름을 키운다. center가 있으면 가운데에 */
function ring(input: PresetInput, order: readonly string[], center?: string): Map<string, Vec2> {
  const size = new Map(input.nodes.map((n) => [n.id, n]));
  const n = order.length;
  const wMax = Math.max(0, ...order.map((id) => size.get(id)!.w)), hMax = Math.max(0, ...order.map((id) => size.get(id)!.h));
  const c = center ? size.get(center)! : undefined;
  let rx = Math.max(n > 1 ? (wMax + GAP) / (2 * Math.sin(Math.PI / Math.max(n, 2))) : 0, c ? (c.w + wMax) / 2 + GAP : 0, 140);
  let ry = Math.max(rx * 0.7, c ? (c.h + hMax) / 2 + GAP : 0, hMax + GAP);
  const place = () => {
    const pos = new Map<string, Vec2>();
    if (c) pos.set(c.id, { x: -c.w / 2, y: -c.h / 2 });
    order.forEach((id, i) => {
      const t = -Math.PI / 2 + (2 * Math.PI * i) / n, s = size.get(id)!;
      pos.set(id, { x: rx * Math.cos(t) - s.w / 2, y: ry * Math.sin(t) - s.h / 2 });
    });
    return pos;
  };
  let pos = place();
  for (let k = 0; k < 40 && overlaps(pos, size); k++) { rx *= 1.12; ry *= 1.12; pos = place(); }
  return normalize(pos);
}

function radial(input: PresetInput): PresetResult {
  // 가운데 = 이 구조 안에서 화살표가 가장 많은 상자 (같으면 원문에서 먼저 나온 것)
  const deg = (id: string) => input.edges.filter((e) => e.from === id || e.to === id).length;
  const center = input.nodes.reduce<PresetNode | undefined>((best, n) => (!best || deg(n.id) > deg(best.id) ? n : best), undefined);
  if (!center || input.nodes.length < 3) return layered(input, 'LR');
  return { pos: ring(input, input.nodes.filter((n) => n !== center).map((n) => n.id), center.id) };
}

// ───────── 줄 (시간축 · 척도) ─────────

function byOrder(nodes: readonly PresetNode[]): PresetNode[] {
  return nodes.map((n, i) => ({ n, i })).sort((a, b) => (a.n.order ?? Infinity) - (b.n.order ?? Infinity) || a.i - b.i).map((x) => x.n);
}

/** 가로 축에 사건을 위아래로 엇갈려 (P-03) — 넷 미만이면 한 줄 */
function timeline(input: PresetInput): Map<string, Vec2> {
  const ns = byOrder(input.nodes);
  if (ns.length < 4) return row(ns);
  const wMax = Math.max(...ns.map((n) => n.w)), top = Math.max(...ns.filter((_, i) => i % 2 === 0).map((n) => n.h));
  const step = Math.max((wMax + GAP) / 2, 140);
  return new Map(ns.map((n, i) => [n.id, { x: i * step, y: i % 2 === 0 ? top - n.h : top + 64 }]));
}

function row(nodes: readonly PresetNode[]): Map<string, Vec2> {
  let x = 0;
  const pos = new Map<string, Vec2>();
  for (const n of byOrder(nodes)) { pos.set(n.id, { x, y: 0 }); x += n.w + 48; }
  return pos;
}

// ───────── 열 (나란히 열 · 대응 · 교차 · 포함 중첩) ─────────

/** 열 = 묶음(없으면 화살표의 앞쪽 · 뒤쪽). 다른 열과 이어진 상자는 상대와 같은 줄에, 열에 안 든 상자는 아래 가운데 */
function columns(input: PresetInput): PresetResult | null {
  const ids = new Set(input.nodes.map((n) => n.id));
  let cols = input.groups.map((g) => g.members.filter((m) => ids.has(m))).filter((m) => m.length);
  if (cols.length < 2) {
    // 묶음이 없으면 짝 화살표로: 대조 · 유추처럼 나란히 놓는 관계(없으면 모든 화살표)의 앞쪽이 왼쪽 열, 뒤쪽이 오른쪽 열 — 정-반은 위에 나란히, 합은 아래로
    const same = input.edges.filter((e) => e.relation && RELATION_SPEC[e.relation as keyof typeof RELATION_SPEC]?.layout === 'same');
    const pairs = same.length ? same : input.edges;
    const order = (xs: string[]) => input.nodes.map((n) => n.id).filter((id) => xs.includes(id));
    const left = order(pairs.map((e) => e.from)), right = order(pairs.map((e) => e.to)).filter((id) => !left.includes(id));
    if (!left.length || !right.length) return null;
    cols = [left, right];
  }
  const size = new Map(input.nodes.map((n) => [n.id, n]));
  const rowOf = new Map<string, number>();
  cols.forEach((col, ci) => {
    const taken = new Set<number>();
    const linked = (id: string) => input.edges.flatMap((e) => (e.from === id ? [e.to] : e.to === id ? [e.from] : [])).map((o) => rowOf.get(o)).find((r) => r !== undefined && !taken.has(r));
    const later: string[] = [];
    for (const id of col) {
      const r = ci ? linked(id) : undefined;
      if (r !== undefined) { rowOf.set(id, r); taken.add(r); } else later.push(id);
    }
    let next = 0;
    for (const id of later) { while (taken.has(next)) next++; rowOf.set(id, next); taken.add(next); }
  });
  const rows = Math.max(0, ...rowOf.values()) + 1;
  const placed = cols.flat();
  const rowH = Array.from({ length: rows }, (_, r) => Math.max(0, ...placed.filter((id) => rowOf.get(id) === r).map((id) => size.get(id)!.h)));
  const rowY = rowH.map((_, r) => rowH.slice(0, r).reduce((s, h) => s + h + GAP, 0));
  const pos = new Map<string, Vec2>();
  let x = 0;
  for (const col of cols) {
    const w = Math.max(...col.map((id) => size.get(id)!.w));
    for (const id of col) pos.set(id, { x, y: rowY[rowOf.get(id)!]! });
    x += w + COL_GAP;
  }
  // 열에 안 든 상자 (정-반-합의 합, 견해 대립의 결론): 아래 가운데에 한 줄
  const loose = input.nodes.filter((n) => !rowOf.has(n.id));
  if (loose.length) {
    const width = x - COL_GAP, total = loose.reduce((s, n) => s + n.w, 0) + (loose.length - 1) * 48;
    let lx = Math.max(0, (width - total) / 2);
    const ly = rowY.at(-1)! + rowH.at(-1)! + ROW_GAP;
    for (const n of loose) { pos.set(n.id, { x: lx, y: ly }); lx += n.w + 48; }
  }
  return { pos };
}

// ───────── 칸 (사분면 · 고정 틀) ─────────

/** 고정 틀 (P-21): 칸 이름(slots)이 있거나 칸 묶음(slot)이면 칸 격자(IRAC · SOAP · 오답 노트),
 *  안건처럼 같은 틀이 되풀이되면(S-57) 묶음마다 한 줄 — 줄 안은 왼→오 흐름(논의 → 결정 → 할 일), 줄은 위→아래 */
function form(input: PresetInput): PresetResult {
  if (!input.groups.length) return layered(input, 'LR'); // 칸이 없으면 흐름대로
  const slotted = !!input.pattern?.slots?.length || input.groups.filter((g) => g.kind === 'slot').length * 2 > input.groups.length;
  // 회의록(S-57) 칸은 논의 → 결정 → 실행 항목 한 줄, 나머지 틀(IRAC · SOAP …)은 2열 격자
  return { pos: slotted ? slotGrid(input.groups, input, input.pattern?.id === 'S-57' ? Math.min(4, input.groups.length) : 2) : groupRows(input) };
}

/** 묶음마다 한 줄(그 안은 계층형 왼→오), 묶음에 안 든 상자는 마지막 줄 */
function groupRows(input: PresetInput): Map<string, Vec2> {
  const ids = new Set(input.nodes.map((n) => n.id)), size = new Map(input.nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const rows = input.groups.map((g) => g.members.filter((m) => ids.has(m) && !seen.has(m) && (seen.add(m), true)));
  rows.push(input.nodes.map((n) => n.id).filter((id) => !seen.has(id)));
  const pos = new Map<string, Vec2>();
  let y = 0;
  for (const ms of rows.filter((r) => r.length)) {
    const set = new Set(ms);
    const sub = layered({ nodes: input.nodes.filter((n) => set.has(n.id)), edges: input.edges.filter((e) => set.has(e.from) && set.has(e.to)), groups: [] }, 'LR').pos;
    for (const [id, p] of sub) pos.set(id, { x: p.x, y: y + p.y });
    y += Math.max(...ms.map((id) => sub.get(id)!.y + size.get(id)!.h)) + ROW_GAP;
  }
  return pos;
}

/** 2×2: 묶음이 넷 안팎이면 묶음을 칸으로, 아니면 상자의 축 값(axis.x · axis.y)으로 */
function matrix(input: PresetInput): PresetResult | null {
  if (input.groups.length >= 2) return { pos: slotGrid(input.groups, input) };
  const withAxis = input.nodes.filter((n) => n.axis?.x || n.axis?.y);
  if (withAxis.length < 2) return null;
  // 축 화살표는 오른쪽 · 위로 커진다 — 낮은 값(부정 · 낮음)은 가로 왼쪽 · 세로 아래 (같으면 원문 차례)
  const xs = [...new Set(withAxis.map((n) => n.axis?.x ?? ''))].sort((a, b) => Number(!isLow(a)) - Number(!isLow(b)));
  const ys = [...new Set(withAxis.map((n) => n.axis?.y ?? ''))].sort((a, b) => Number(isLow(a)) - Number(isLow(b)));
  const cells = ys.flatMap((y) => xs.map((x) => ({ key: `${y}|${x}`, members: withAxis.filter((n) => (n.axis?.x ?? '') === x && (n.axis?.y ?? '') === y).map((n) => n.id) })));
  const rest = input.nodes.filter((n) => !withAxis.includes(n)).map((n) => n.id);
  return { pos: slotGrid([...cells, ...(rest.length ? [{ key: 'rest', members: rest }] : [])], input, xs.length) };
}

/** 축 값이 낮은 쪽인가 — 부정 · 낮음 · 적음 말 ("긴급하지 않음", "낮음", "low") */
const isLow = (v: string): boolean => /않|아니|없|낮|적음|작|약함|^비|\b(?:low|not|non|less|no)\b/i.test(v);

/** 칸 격자: 칸마다 구성원을 위→아래로 쌓고, 칸은 cols열로 (빈 칸도 자리를 지킨다) */
function slotGrid(slots: readonly PresetGroup[], input: PresetInput, cols = 2): Map<string, Vec2> {
  const size = new Map(input.nodes.map((n) => [n.id, n]));
  const ordered = orderSlots(slots, input.pattern?.slots);
  const dims = ordered.map((s) => {
    const ms = s.members.filter((m) => size.has(m));
    return { ms, w: Math.max(200, ...ms.map((m) => size.get(m)!.w)), h: ms.reduce((t, m) => t + size.get(m)!.h + GAP, 0) - (ms.length ? GAP : 0) };
  });
  const colW = Array.from({ length: cols }, (_, c) => Math.max(0, ...dims.filter((_, i) => i % cols === c).map((d) => d.w)));
  const rowH = Array.from({ length: Math.ceil(dims.length / cols) }, (_, r) => Math.max(60, ...dims.slice(r * cols, r * cols + cols).map((d) => d.h)));
  const pos = new Map<string, Vec2>();
  dims.forEach((d, i) => {
    const c = i % cols, r = Math.floor(i / cols);
    let y = rowH.slice(0, r).reduce((s, h) => s + h + ROW_GAP, 0);
    const x = colW.slice(0, c).reduce((s, w) => s + w + COL_GAP, 0);
    for (const m of d.ms) { pos.set(m, { x, y }); y += size.get(m)!.h + GAP; }
  });
  return dropLooseBelow(pos, input.nodes, ordered);
}

/** 칸 이름(slots) 차례대로 — 묶음 제목에 칸 이름이 들어 있으면 그 자리로 */
function orderSlots(groups: readonly PresetGroup[], slots?: readonly string[]): PresetGroup[] {
  if (!slots?.length) return [...groups];
  const rank = (g: PresetGroup) => { const t = (g.title ?? '').toLowerCase(); const i = slots.findIndex((s) => t.includes(s.toLowerCase()) || (t && s.toLowerCase().includes(t))); return i < 0 ? slots.length : i; };
  return groups.map((g, i) => ({ g, i })).sort((a, b) => rank(a.g) - rank(b.g) || a.i - b.i).map((x) => x.g);
}

/** 어느 칸에도 안 든 상자는 격자 아래 한 줄로 */
function dropLooseBelow(pos: Map<string, Vec2>, nodes: readonly PresetNode[], slots: readonly PresetGroup[]): Map<string, Vec2> {
  const inSlot = new Set(slots.flatMap((s) => s.members));
  const loose = nodes.filter((n) => !inSlot.has(n.id));
  if (!loose.length) return pos;
  const size = new Map(nodes.map((n) => [n.id, n]));
  const bottom = Math.max(0, ...[...pos].filter(([id]) => inSlot.has(id)).map(([id, p]) => p.y + size.get(id)!.h));
  let x = 0;
  for (const n of loose) { pos.set(n.id, { x, y: bottom + ROW_GAP }); x += n.w + 48; }
  return pos;
}

// ───────── 레인 · 층 ─────────

/** 레인 = 묶음(행위자 · 부서). 상자는 화살표 차례(위상 순서)로 칸을 받는다 — 가로 레인은 행, 세로 레인은 열 */
function lanes(input: PresetInput, dir: 'LR' | 'TB'): PresetResult | null {
  if (!input.groups.length) return null;
  const ids = input.nodes.map((n) => n.id), size = new Map(input.nodes.map((n) => [n.id, n]));
  const laneOf = new Map<string, number>();
  input.groups.forEach((g, i) => g.members.forEach((m) => { if (size.has(m) && !laneOf.has(m)) laneOf.set(m, i); }));
  const extra = ids.filter((id) => !laneOf.has(id));
  extra.forEach((id) => laneOf.set(id, input.groups.length));
  const step = topoOrder(ids, input.edges);
  const lanesN = input.groups.length + (extra.length ? 1 : 0);
  const thick = Array.from({ length: lanesN }, (_, l) => Math.max(0, ...ids.filter((id) => laneOf.get(id) === l).map((id) => (dir === 'LR' ? size.get(id)!.h : size.get(id)!.w))));
  const cell = Math.max(...ids.map((id) => (dir === 'LR' ? size.get(id)!.w : size.get(id)!.h))) + (dir === 'LR' ? 64 : 48);
  const pos = new Map<string, Vec2>();
  for (const id of ids) {
    const l = laneOf.get(id)!, across = thick.slice(0, l).reduce((s, t) => s + t + (dir === 'LR' ? ROW_GAP : COL_GAP), 0), along = step.get(id)! * cell;
    pos.set(id, dir === 'LR' ? { x: along, y: across } : { x: across, y: along });
  }
  return { pos };
}

/** 화살표 차례 (같은 차례는 원문 차례) — 레인의 칸 번호. 같은 칸에 둘이 오지 않게 원문 차례로 한 칸씩 */
function topoOrder(ids: readonly string[], edges: readonly PresetEdge[]): Map<string, number> {
  const idx = new Map(ids.map((id, i) => [id, i]));
  const indeg = new Map(ids.map((id) => [id, 0]));
  const es = edges.filter((e) => idx.has(e.from) && idx.has(e.to) && e.from !== e.to);
  for (const e of es) indeg.set(e.to, indeg.get(e.to)! + 1);
  const out = new Map<string, number>();
  const ready = ids.filter((id) => indeg.get(id) === 0);
  let k = 0;
  while (out.size < ids.length) {
    if (!ready.length) ready.push(ids.find((id) => !out.has(id))!); // 고리: 원문에서 먼저 나온 것부터
    ready.sort((a, b) => idx.get(a)! - idx.get(b)!);
    const v = ready.shift()!;
    if (out.has(v)) continue;
    out.set(v, k++);
    for (const e of es) if (e.from === v) { indeg.set(e.to, indeg.get(e.to)! - 1); if (indeg.get(e.to) === 0 && !out.has(e.to)) ready.push(e.to); }
  }
  return out;
}

/** 층 쌓기 (P-22): 위→아래 가운데 정렬, 아래로 갈수록 넓게(피라미드) — 퍼널(S-64)은 좁게. orderFrom 'bottom'이면 첫 상자가 맨 아래 */
function levels(input: PresetInput): PresetResult {
  const ns = byOrder(input.nodes);
  if (input.pattern?.orderFrom === 'bottom') ns.reverse();
  const shrink = input.pattern?.id === 'S-64';
  const base = Math.max(...ns.map((n) => n.w));
  const width = new Map(ns.map((n, i) => [n.id, Math.round(shrink ? base + (ns.length - 1 - i) * 48 : base + i * 48)]));
  const full = Math.max(...width.values());
  const pos = new Map<string, Vec2>();
  let y = 0;
  for (const n of ns) { pos.set(n.id, { x: (full - width.get(n.id)!) / 2, y }); y += n.h + 24; }
  return { pos, width };
}

// ───────── 도우미 ─────────

function overlaps(pos: Map<string, Vec2>, size: Map<string, LayoutNode>, gap = 16): boolean {
  const r = [...pos].map(([id, p]) => ({ ...p, w: size.get(id)!.w, h: size.get(id)!.h }));
  for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) {
    const a = r[i]!, b = r[j]!;
    if (a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap) return true;
  }
  return false;
}

function normalize(pos: Map<string, Vec2>): Map<string, Vec2> {
  const mx = Math.min(...[...pos.values()].map((p) => p.x)), my = Math.min(...[...pos.values()].map((p) => p.y));
  for (const [id, p] of pos) pos.set(id, { x: Math.round(p.x - mx), y: Math.round(p.y - my) });
  return pos;
}
