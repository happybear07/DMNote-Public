// 문서 순서 (문서 뷰 · 인쇄 · 내보내기 · 목차): 캔버스의 논리 구조를 따른다.
// - 화살표로 이어진 블록들(흐름)은 화살표 방향 차례로 — 시작점부터, 갈래가 여럿이면 가지끼리는 자리 순서(위 → 아래, 왼 → 오).
//   흐름 전체는 그 안에서 자리가 가장 앞선 블록의 자리에 놓인다. 순환은 자리 순서로 끊는다.
// - 한 줄로 이어진 흐름(갈래 없음)은 단계 번호(1, 2, 3 …), 갈래가 있는 흐름(마인드맵 · 트리)은 들여쓰기 단계(depth).
// - 화살표가 없는 블록은 지금처럼 자리 순서. 블록(묶음)은 한 덩어리. 표지 쪽(cover.ts) 안 블록은 빠진다.
// - 관계가 있는 화살표는 읽는 방향으로 (STRUCTURE-GUIDE 4.11): 위계(일부 · 종류 · 예시 …)는 위 → 아래, 뒷받침 · 반박은 주장 → 근거(두괄식) —
//   그런 흐름은 한 줄이어도 들여쓰기. 번호 단계는 관계 없는 화살표 · `next` 사슬만, 인과 같은 다른 관계의 한 줄 흐름은 번호 없이 차례만.
import type { Engine } from './engine';
import { isBound, type Arrow, type Block, type Id } from './model';
import { RELATION_SPEC, type KnownRelation } from './relations';
import { readingOrder } from './toc';
import { coverRect, inCover } from './sheet';

/** 주장 쪽 노드 — 뒷받침 · 반박이 여기로 오면 두괄식(주장 먼저) */
const CLAIMS = new Set(['claim', 'conclusion', 'theorem', 'decision']);
/** 문서에서 화살표와 거꾸로 읽는 관계 — 상위 · 전체가 먼저, 뒷받침 · 반박은 받는 쪽이 주장이면 주장이 먼저 (인과 사슬 속 '뒷받침'은 차례 그대로) */
export function readsBackward(r: Arrow['relation'], toKind?: string): boolean {
  if (!r) return false;
  if (r === 'supports' || r === 'refutes') return !!toKind && CLAIMS.has(toKind);
  return RELATION_SPEC[r as KnownRelation]?.layout === 'reverse';
}
/** 번호 단계가 되는 화살표 — 관계 없음(사용자가 그은 화살표) · 다음 단계 */
const stepArrow = (r: Arrow['relation']): boolean => !r || r === 'next';
const STRENGTH = { step: 0, other: 1, nest: 2 } as const;

export interface DocItem {
  readonly block: Block;
  /** 한 줄 흐름의 단계 번호 (1부터) */
  readonly step?: number;
  /** 갈래 흐름의 들여쓰기 단계 (시작점 0) */
  readonly depth?: number;
  /** 흐름 id (같은 흐름이면 같은 값) — 흐름에 속하지 않으면 없음 */
  readonly flow?: number;
  /** 들여쓴 항목의 부모 블록 (들여쓰기가 이미 그 관계를 보인다) */
  readonly parent?: Id;
}

/**
 * 문서 순서의 단위 (읽는 순서): 블록(묶음)은 한 덩어리, 낱 상자는 하나씩. 묶음 안을 화살표로 잇는 흐름이면(예: 흐름도를 통째로 묶음)
 * 묶음보다 흐름이 구조다 — 화살표가 닿는 상자마다 따로, 화살표 없는 멤버는 바로 앞 상자에 붙는다
 */
export function docUnits(engine: Engine): Block[][] {
  const cover = coverRect(engine.note); // 표지 쪽 안 블록은 본문이 아니다 (11/03)
  const base = readingOrder([...engine.blocks()].filter((b) => !inCover(cover, b)));
  const units: Block[][] = [];
  for (const b of base) {
    const g = b.group && base.filter((x) => x.group === b.group).length >= 2 ? b.group : null;
    const prev = g ? units.findIndex((u) => u[0]!.group === g) : -1;
    if (prev >= 0) units[prev]!.push(b);
    else units.push([b]);
  }
  const arrows = [...engine.arrows()].filter(isBound); // 빈 곳 화살표(11/09)는 흐름이 아니다
  for (let u = units.length - 1; u >= 0; u--) {
    const m = units[u]!;
    if (m.length < 2) continue;
    const ids = new Set(m.map((b) => b.id));
    if (!arrows.some((a) => ids.has(a.from.blockId) && ids.has(a.to.blockId))) continue;
    const linked = new Set(arrows.flatMap((a) => [a.from.blockId, a.to.blockId]));
    const parts: Block[][] = [];
    for (const b of m) { if (linked.has(b.id) || !parts.length) parts.push([b]); else parts[parts.length - 1]!.push(b); }
    units.splice(u, 1, ...parts);
  }
  return units;
}

export function documentOrder(engine: Engine): DocItem[] {
  const units = docUnits(engine);
  const unitOf = new Map<Id, number>();
  units.forEach((m, u) => { for (const b of m) unitOf.set(b.id, u); });
  const arrows = [...engine.arrows()].filter(isBound); // 빈 곳 화살표(11/09)는 흐름이 아니다
  const n = units.length;
  const out = Array.from({ length: n }, () => new Set<number>()), inn = Array.from({ length: n }, () => new Set<number>());
  const kindOf = new Array<'step' | 'nest' | 'other'>(n);
  for (const a of arrows) {
    let f = unitOf.get(a.from.blockId), t = unitOf.get(a.to.blockId);
    if (f === undefined || t === undefined || f === t) continue;
    const back = readsBackward(a.relation, engine.getBlock(a.to.blockId)?.nodeKind);
    if (back) [f, t] = [t, f];
    out[f]!.add(t); inn[t]!.add(f);
    const k = back ? 'nest' : stepArrow(a.relation) ? 'step' : 'other';
    for (const u of [f, t]) if (!kindOf[u] || STRENGTH[k] > STRENGTH[kindOf[u]!]) kindOf[u] = k; // 상자마다 가장 센 화살표 종류
  }
  // 흐름(연결 요소)
  const comp = new Array<number>(n).fill(-1);
  let nc = 0;
  for (let i = 0; i < n; i++) {
    if (comp[i]! >= 0 || (!out[i]!.size && !inn[i]!.size)) continue;
    const stack = [i];
    comp[i] = nc;
    while (stack.length) { const u = stack.pop()!; for (const v of [...out[u]!, ...inn[u]!]) if (comp[v]! < 0) { comp[v] = nc; stack.push(v); } }
    nc++;
  }
  const items: DocItem[] = [];
  const done = new Set<number>();
  for (let i = 0; i < n; i++) {
    if (done.has(i)) continue;
    if (comp[i]! < 0) { done.add(i); for (const b of units[i]!) items.push({ block: b }); continue; }
    const members = [...Array(n).keys()].filter((k) => comp[k] === comp[i]);
    const order = flowSort(members, out, inn);
    const line = members.every((k) => out[k]!.size <= 1 && inn[k]!.size <= 1) && order.length === members.length;
    const nest = members.some((k) => kindOf[k] === 'nest'), steps = members.every((k) => kindOf[k] === 'step');
    const chain = line && !nest && steps, flat = line && !nest && !steps;
    const depth = new Map<number, number>(), parent = new Map<number, number>();
    for (const u of order) {
      const parents = [...inn[u]!].filter((p) => depth.has(p)).sort((a, b) => depth.get(a)! - depth.get(b)!);
      if (parents.length) parent.set(u, parents[0]!);
      depth.set(u, parents.length ? Math.min(4, depth.get(parents[0]!)! + 1) : 0);
    }
    order.forEach((u, s) => {
      done.add(u);
      const p = chain || flat ? undefined : parent.get(u);
      units[u]!.forEach((b, j) => items.push({ block: b, flow: comp[u], ...(chain ? (j === 0 ? { step: s + 1 } : {}) : flat ? {} : { depth: depth.get(u)! }), ...(p !== undefined ? { parent: units[p]![0]!.id } : {}) }));
    });
  }
  return items;
}

/** 위상 정렬 — 갈 수 있는 것 중 자리 순서가 앞선 것부터(깊이 우선: 한 가지를 끝까지 따라간 뒤 다음 가지). 순환은 자리 순서로 끊는다 */
function flowSort(members: number[], out: Set<number>[], inn: Set<number>[]): number[] {
  const left = new Map(members.map((k) => [k, inn[k]!.size]));
  const seen = new Set<number>(), order: number[] = [];
  const visit = (u: number) => {
    seen.add(u);
    order.push(u);
    for (const v of [...out[u]!].sort((a, b) => a - b)) {
      left.set(v, left.get(v)! - 1);
      if (!seen.has(v) && left.get(v)! <= 0) visit(v);
    }
  };
  while (order.length < members.length) {
    // 시작점(들어오는 화살표가 다 처리된 것) 중 자리 순서가 가장 앞선 것, 없으면(순환) 남은 것 중 가장 앞선 것
    const rest = members.filter((k) => !seen.has(k));
    visit(rest.find((k) => left.get(k)! <= 0) ?? rest[0]!);
  }
  return order;
}
