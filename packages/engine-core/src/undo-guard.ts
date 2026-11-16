// 조건부 실행 취소 · 다시 실행 (SYNC.md 13.7): 다른 탭 · 기기의 변경(origin 'remote')이 끼어든 뒤 되돌릴 때,
// 역연산을 조건 없이 적용하면 다른 곳이 나중에 쓴 값을 덮거나, 그쪽이 지운 것을 되살리다 불변식에 걸려 되돌리기 전체가 실패했다.
// 그래서 연산마다 "지금 상태가 내가 남긴 그대로인가"를 보고 맞을 때만 적용한다. 원격 변경이 없으면 결과는 예전과 같다.
//   set     — 지금 값이 이 연산이 바꾸기 전 기대하는 값(되돌리기면 내가 쓴 값)일 때만
//   create  — 아직 없고 부모(블록 · 화살표 끝 블록 · 잉크 부모 콘텐츠)가 살아 있을 때만
//   delete  — 있고, 블록이면 남은 콘텐츠 · 화살표가 없을 때만(다른 곳이 그 블록에 더한 것을 함께 지우지 않게)
//   text    — 이 기록 뒤로 그 콘텐츠에 원격 변경이 없었을 때만 (원격 글은 문서 통째로 들어와 스텝 위치를 옮길 수 없다)
// 적용 순서대로 엔진 상태를 보며 판단한다 — 같은 기록 안 앞 연산의 결과(먼저 지운 콘텐츠 등)를 반영해야 하므로.
import { isBlockEnd, type Arrow, type Content, type EntityKind, type Id } from './model';
import { sameValue, type Op } from './ops';
import type { Tx } from './tx';

/** 판단에 쓰는 엔진 읽기 */
export interface GuardView {
  get(e: EntityKind, id: Id): unknown;
  note(): Record<string, unknown>;
  hasChildren(blockId: Id): boolean;
  /** 이 기록 뒤로 원격 변경이 그 엔티티를 건드렸나 */
  remoteSince(id: Id): boolean;
}

function parentsAlive(op: Op & { k: 'create' }, v: GuardView): boolean {
  const val = op.value as Record<string, unknown>;
  if (op.e === 'content') return !!v.get('block', String((val as unknown as Content).blockId));
  if (op.e === 'arrow') {
    const a = val as unknown as Arrow;
    return [a.from, a.to].every((an) => !isBlockEnd(an) || !!v.get('block', an.blockId)); // 빈 곳의 점 끝은 부모 없음
  }
  if (op.e === 'stroke') {
    const p = val.parent as { kind?: string; contentId?: Id } | undefined;
    return p?.kind !== 'content' || !!v.get('content', String(p.contentId));
  }
  return true;
}

/** 이 연산을 지금 적용해도 되나 */
export function canApply(op: Op, v: GuardView): boolean {
  switch (op.k) {
    case 'set': {
      if (op.e === 'note') return sameValue(v.note()[op.field], op.prev);
      const cur = v.get(op.e, op.id) as Record<string, unknown> | undefined;
      return !!cur && sameValue(cur[op.field], op.prev);
    }
    case 'create': return !v.get(op.e, op.id) && parentsAlive(op, v);
    case 'delete': return !!v.get(op.e, op.id) && (op.e !== 'block' || !v.hasChildren(op.id));
    case 'text': return !!v.get('content', op.id) && !v.remoteSince(op.id);
  }
}

/** 조건이 맞는 연산만 적용한다. 건너뛴 수 */
export function applyGuarded(tx: Tx, ops: readonly Op[], v: GuardView): number {
  let skipped = 0;
  for (const op of ops) {
    if (canApply(op, v)) tx.apply(op);
    else skipped++;
  }
  return skipped;
}
