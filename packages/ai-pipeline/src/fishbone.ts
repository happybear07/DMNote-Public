// 피시본 배치 (P-07, STRUCTURE-GUIDE S-02): 결과(원인 화살표가 가장 많이 모이는 상자) 하나를 오른쪽에, 그 결과로 가는 원인들을
// 등뼈 위아래로 번갈아 왼→오, 원인의 세부 원인은 그 원인 바깥쪽(위 줄은 더 위, 아래 줄은 더 아래)에 쌓는다.
// 등뼈 · 가지 선은 캔버스가 모양 묶음(shape 'fishbone')으로 덧그린다(engine-dom group-shapes.ts). 원인이 둘 미만이면 null(계층형으로).
import type { Vec2 } from '@dn/engine-core';
import type { PresetInput } from './presets';

/** 원인 쪽 관계 — 원인 → 결과 */
export const CAUSAL = new Set(['causes', 'leads-to', 'inhibits', 'correlates']);
const COL = 72, SPINE = 120, STACK = 24;

export function fishboneLayout(input: PresetInput): Map<string, Vec2> | null {
  const size = new Map(input.nodes.map((n) => [n.id, n]));
  const into = new Map<string, string[]>();
  for (const e of input.edges) if (e.relation && CAUSAL.has(e.relation) && size.has(e.from) && size.has(e.to)) into.set(e.to, [...(into.get(e.to) ?? []), e.from]);
  const head = [...into].sort((a, b) => b[1].length - a[1].length)[0];
  if (!head || head[1].length < 2) return null;
  const [headId, causes] = head;
  const order = input.nodes.map((n) => n.id);
  const main = order.filter((id) => causes.includes(id));
  const subs = (c: string) => (into.get(c) ?? []).filter((s) => s !== headId && !main.includes(s));
  const wMax = Math.max(...main.map((c) => size.get(c)!.w)), topH = Math.max(...main.filter((_, i) => i % 2 === 0).map((c) => size.get(c)!.h));
  const spineY = topH + SPINE / 2;
  const pos = new Map<string, Vec2>();
  main.forEach((c, i) => {
    const up = i % 2 === 0, x = Math.floor(i / 2) * (wMax + COL), s = size.get(c)!;
    pos.set(c, { x, y: up ? topH - s.h : spineY + SPINE / 2 });
    // 세부 원인: 위 줄이면 더 위로, 아래 줄이면 더 아래로 쌓는다
    let y = up ? topH - s.h - STACK : spineY + SPINE / 2 + s.h + STACK;
    for (const sub of subs(c)) {
      if (pos.has(sub)) continue;
      const h = size.get(sub)!.h;
      pos.set(sub, { x: x + 24, y: up ? y - h : y });
      y = up ? y - h - STACK : y + h + STACK;
    }
  });
  const cols = Math.ceil(main.length / 2), hs = size.get(headId)!;
  pos.set(headId, { x: cols * (wMax + COL) + 24, y: spineY - hs.h / 2 });
  // 남은 상자는 아래 한 줄
  const bottom = Math.max(...[...pos].map(([id, p]) => p.y + size.get(id)!.h)) + 72;
  let rx = 0;
  for (const id of order) if (!pos.has(id)) { pos.set(id, { x: rx, y: bottom }); rx += size.get(id)!.w + 48; }
  const minY = Math.min(...[...pos.values()].map((p) => p.y)), minX = Math.min(...[...pos.values()].map((p) => p.x));
  for (const [id, p] of pos) pos.set(id, { x: Math.round(p.x - minX), y: Math.round(p.y - minY) });
  return pos;
}
