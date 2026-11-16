// 묶음 끝 화살표 (v6, Anchor.groupId): 화살표 끝이 묶음 전체에 붙으면 묶음 둘레(멤버 사각형의 합 + 여백)에서 나가고 들어온다.
// 느슨한 참조 — 묶음이 풀렸거나(멤버 둘 미만) 대표 상자(blockId)가 그 묶음이 아니면 그냥 상자 끝으로 읽는다(자가 치유).
import type { Engine, Tx, TxResult } from './engine';
import { unionRects, type Rect } from './geom';
import { endBlock, isBlockEnd, type Anchor, type Arrow, type BlockAnchor, type Id } from './model';

/** 묶음 둘레 여백 — 캔버스의 묶음 테두리(groups-view PAD)와 같은 값 */
export const GROUP_END_PAD = 8;

/** 이 끝이 실제로 묶음 끝인가 (members: 묶음 id → 상자 id들) */
export function groupEndOf(an: Anchor, members: ReadonlyMap<Id, ReadonlySet<Id>>): ReadonlySet<Id> | null {
  if (!isBlockEnd(an)) return null;
  const g = an.groupId ? members.get(an.groupId) : undefined;
  return g && g.size >= 2 && g.has(an.blockId) ? g : null;
}

/** 끝 사각형: 묶음 끝이면 묶음 둘레, 빈 곳의 점이면 크기 0인 사각형(11/09), 아니면 상자 */
export function endRect(an: Anchor, members: ReadonlyMap<Id, ReadonlySet<Id>>, rect: (id: Id) => Rect | undefined): Rect | undefined {
  if (!isBlockEnd(an)) return { x: an.point.x, y: an.point.y, w: 0, h: 0 };
  const g = groupEndOf(an, members);
  if (!g) return rect(an.blockId);
  const u = unionRects([...g].map(rect).filter((r): r is Rect => !!r));
  return u ? { x: u.x - GROUP_END_PAD, y: u.y - GROUP_END_PAD, w: u.w + 2 * GROUP_END_PAD, h: u.h + 2 * GROUP_END_PAD } : undefined;
}

/** 묶음 끝을 뗀 앵커 (상자 끝으로) */
export function boxEnd(an: BlockAnchor, blockId: Id = an.blockId): BlockAnchor {
  const { groupId: _g, ...rest } = an;
  return { ...rest, blockId };
}

/**
 * 화살표의 한쪽 끝을 묶음 전체에 붙이거나(on) 떼기. 그 끝 상자가 묶음(둘 이상)에 든 경우만. 실행 취소 한 번
 */
export function setArrowGroupEnd(engine: Engine, arrowId: Id, end: 'from' | 'to', on: boolean): TxResult<boolean> {
  return engine.transact((tx) => {
    const a = engine.getArrow(arrowId);
    if (!a) return false;
    const an = a[end];
    if (!isBlockEnd(an)) return false; // 빈 곳의 점 끝
    const g = engine.getBlock(an.blockId)?.group;
    const n = g ? [...engine.blocks()].filter((b) => b.group === g).length : 0;
    if (on && (!g || n < 2)) return false;
    const other = a[end === 'from' ? 'to' : 'from'];
    if (on && isBlockEnd(other) && other.groupId === g && engine.getBlock(other.blockId)?.group === g) return false; // 같은 묶음 둘레끼리는 이을 수 없다
    tx.set('arrow', arrowId, { [end]: on ? { ...boxEnd(an), side: 'auto', groupId: g } : boxEnd(an) });
    return true;
  }, { origin: 'user', label: on ? '묶음 끝으로' : '상자 끝으로' });
}

/**
 * (트랜잭션 안) 묶음을 풀거나 합칠 때 그 묶음 끝 화살표 정리: 풀린 묶음 끝은 상자 끝으로, 합친 묶음은 새 묶음 id로
 */
export function remapGroupEnds(engine: Engine, tx: Tx, from: ReadonlySet<Id>, to?: Id): void {
  for (const a of [...engine.arrows()] as Arrow[]) {
    const patch: Partial<Record<'from' | 'to', Anchor>> = {};
    for (const end of ['from', 'to'] as const) {
      const an = a[end];
      if (!isBlockEnd(an)) continue;
      const g = an.groupId;
      if (g && from.has(g)) patch[end] = to ? { ...an, groupId: to } : boxEnd(an);
    }
    if (patch.from || patch.to) tx.set('arrow', a.id, patch as Record<string, unknown>);
  }
}

/**
 * (트랜잭션 안) 상자들을 지우기 전에: 그 상자가 대표인 묶음 끝 화살표는 묶음에 남는 상자로 대표를 옮긴다.
 * 남는 상자가 하나뿐이면 그 상자 끝으로. 옮긴 화살표 id들을 돌려준다(지우지 말 것)
 */
export function rehomeGroupEnds(engine: Engine, tx: Tx, gone: ReadonlySet<Id>): Set<Id> {
  const kept = new Set<Id>();
  for (const id of gone) {
    for (const a of engine.arrowsOf(id)) {
      const patch: Partial<Record<'from' | 'to', Anchor>> = {};
      let ok = true;
      for (const end of ['from', 'to'] as const) {
        const an = a[end];
        if (!isBlockEnd(an) || !gone.has(an.blockId)) continue;
        const g = an.groupId && engine.getBlock(an.blockId)?.group === an.groupId ? an.groupId : null;
        const rest = g ? [...engine.blocks()].filter((b) => b.group === g && !gone.has(b.id)).map((b) => b.id) : [];
        if (!rest.length) { ok = false; break; }
        patch[end] = rest.length >= 2 ? { ...an, blockId: rest[0]! } : boxEnd(an, rest[0]!);
      }
      if (!ok || (!patch.from && !patch.to)) continue;
      const f = endBlock(patch.from ?? a.from), t = endBlock(patch.to ?? a.to);
      if (f && f === t) continue;
      tx.set('arrow', a.id, patch as Record<string, unknown>);
      kept.add(a.id);
    }
  }
  return kept;
}
