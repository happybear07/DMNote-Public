// 교차 · 벤 배치 (P-23, STRUCTURE-GUIDE S-69 — 도형 대신 "영역 칸 나란히"): 항목이 어느 집합에 드는지(일부 · 종류 · ⊂ 화살표 → 집합 노드)로
// 영역을 나눠 열로 놓는다 — 집합이 둘이면 [A만] [둘 다] [B만], 집합 노드는 자기 영역 열 위에. 캔버스는 집합마다 타원을 덧그려 겹침을 보인다(group-shapes.ts).
import type { Vec2 } from '@dn/engine-core';
import type { PresetInput } from './presets';

/** 소속을 나타내는 관계 — 항목 → 집합 */
export const MEMBERSHIP = new Set(['part-of', 'subset-of', 'kind-of', 'example-of', 'elaborates']);
const GAP = 32, COL_GAP = 96, HEAD_GAP = 56;

export function vennLayout(input: PresetInput): Map<string, Vec2> | null {
  const ids = new Set(input.nodes.map((n) => n.id)), size = new Map(input.nodes.map((n) => [n.id, n]));
  const sets = new Map<string, Set<string>>(); // 항목 → 든 집합들
  for (const e of input.edges) {
    if (!e.relation || !MEMBERSHIP.has(e.relation) || !ids.has(e.from) || !ids.has(e.to)) continue;
    sets.set(e.from, (sets.get(e.from) ?? new Set()).add(e.to));
  }
  const order = input.nodes.map((n) => n.id);
  const setIds = order.filter((id) => !sets.has(id) && [...sets.values()].some((s) => s.has(id)));
  if (setIds.length < 2 || setIds.length > 3) return null;
  // 영역 = 든 집합의 조합. 열 차례: 집합이 둘이면 A만 · 둘 다 · B만, 셋이면 홑 영역 → 겹친 영역
  const keyOf = (id: string) => setIds.filter((s) => sets.get(id)!.has(s)).join('|');
  const regionKeys = setIds.length === 2 ? [setIds[0]!, setIds.join('|'), setIds[1]!]
    : [...setIds, ...[...new Set(order.filter((id) => sets.has(id) && !setIds.includes(id)).map(keyOf))].filter((k) => k.includes('|'))];
  const cols = regionKeys.map((k) => ({ head: setIds.includes(k) ? k : undefined, items: order.filter((id) => sets.has(id) && !setIds.includes(id) && keyOf(id) === k) }));
  const rest = order.filter((id) => !sets.has(id) && !setIds.includes(id));
  const headH = Math.max(...setIds.map((s) => size.get(s)!.h));
  const pos = new Map<string, Vec2>();
  let x = 0;
  for (const c of cols) {
    const w = Math.max(160, ...[c.head, ...c.items].filter((v): v is string => !!v).map((id) => size.get(id)!.w));
    if (c.head) pos.set(c.head, { x, y: 0 });
    let y = headH + HEAD_GAP;
    for (const id of c.items) { pos.set(id, { x, y }); y += size.get(id)!.h + GAP; }
    if (c.head || c.items.length) x += w + COL_GAP;
  }
  // 어느 집합에도 안 이어진 상자는 아래 한 줄
  const bottom = Math.max(0, ...[...pos].map(([id, p]) => p.y + size.get(id)!.h)) + 72;
  let rx = 0;
  for (const id of rest) { pos.set(id, { x: rx, y: bottom }); rx += size.get(id)!.w + 48; }
  return pos;
}
