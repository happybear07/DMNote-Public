// 다시 구조화로 상자 바꾸기 (FR-110, apply.ts replace): 고른 상자 · 콘텐츠 · 이어진 화살표를 같은 트랜잭션에서 지우고,
// 바깥 상자와 이어졌던 화살표는 새 결과에서 제목이 같은 상자로 다시 잇는다 — 다시 정리해도 주변 연결이 끊기지 않게.
import { docText, isBound, isTextContent, type BoundArrow, type Engine, type Id, type Tx } from '@dn/engine-core';

/** 바깥과 이어졌던 화살표: 바깥 끝은 그대로, 바뀐 쪽 끝은 그 상자의 제목으로 기억 */
export interface OuterLink { readonly arrow: BoundArrow; readonly end: 'from' | 'to'; readonly title: string }

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
const titleOf = (engine: Engine, id: Id) => norm(docText(engine.contentsOf(id).find(isTextContent)?.doc ?? { type: 'doc', content: [] }).split('\n')[0] ?? '');

/** 고른 상자를 지운다 (이어진 화살표 · 콘텐츠째). 결과: 바깥과 이어졌던 화살표 */
export function dropReplaced(engine: Engine, tx: Tx, rep: ReadonlySet<Id>): OuterLink[] {
  const arrows = new Map<Id, BoundArrow>();
  for (const id of rep) for (const a of engine.arrowsOf(id)) if (isBound(a)) arrows.set(a.id, a); // 빈 곳 화살표(11/09)는 AI 결과와 상관없다
  const outer: OuterLink[] = [];
  for (const a of arrows.values()) {
    const f = rep.has(a.from.blockId), t = rep.has(a.to.blockId);
    if (f !== t) outer.push({ arrow: a, end: f ? 'from' : 'to', title: titleOf(engine, f ? a.from.blockId : a.to.blockId) });
    tx.delete('arrow', a.id);
  }
  for (const id of rep) {
    if (!engine.getBlock(id)) continue;
    for (const c of engine.contentsOf(id)) tx.delete('content', c.id);
    tx.delete('block', id);
  }
  return outer;
}

/** 바깥 화살표를 새 상자(제목이 같은 것)로 다시 잇는다 — 관계 · 라벨 · 모양은 그대로, 묶음 끝은 상자 끝으로. 결과: 다시 이은 수 */
export function relink(tx: Tx, outer: readonly OuterLink[], titles: ReadonlyMap<string, Id>): number {
  let n = 0;
  for (const o of outer) {
    const to = titles.get(o.title);
    if (!o.title || !to) continue;
    const { id: _id, ...rest } = o.arrow;
    tx.createArrow({ ...rest, [o.end]: { blockId: to, side: o.arrow[o.end].side, ...(o.arrow[o.end].t !== undefined ? { t: o.arrow[o.end].t } : {}) } } as never);
    n++;
  }
  return n;
}

export { norm as normTitle };
