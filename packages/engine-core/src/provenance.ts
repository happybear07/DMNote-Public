// 출처 (v6, docs/OWN-MODEL.md 3절 · docs/review/V6-SCHEMA-REVIEW.md 1.5): 사람이 AI가 만든 개체의 "의미"를 고치면
// 그 개체의 ai.editedAt에 시각을 찍는다 — 같은 트랜잭션 안이라 실행 취소 · 로그 · 동기화에 한 번에 실린다.
// 학습 데이터 등급(human · claude · claude_edited …)은 저장하지 않고 여기서 계산한다(한 사실을 두 곳에 적지 않게).
import type { Engine, Tx } from './engine';
import type { AiOrigin, AiProvenance, EntityKind, Id } from './model';
import type { Op } from './ops';

/** 같은 개체를 계속 고칠 때 다시 찍는 간격 — "마지막으로 사람이 손댄 때" */
export const EDIT_STAMP_MS = 60_000;

/** 고침으로 세는 의미 필드. 자리 · 크기 · 색 · 글자 모양은 고침이 아니다 (diff.ts와 같은 기준) */
const MEANING: Readonly<Partial<Record<EntityKind, ReadonlySet<string>>>> = {
  block: new Set(['nodeKind', 'group', 'attachTo', 'status', 'emphasis', 'hedge', 'role', 'speaker', 'owner', 'time', 'start', 'end', 'due']),
  arrow: new Set(['relation', 'label', 'from', 'to', 'symbol', 'negated', 'sign', 'order', 'reply', 'prob']),
};
/** 콘텐츠는 자리 · 차례만 빼고 전부(글 스텝 포함) */
const CONTENT_LAYOUT = new Set(['frame', 'order', 'ai']);

function meaningful(op: Op): boolean {
  if (op.k === 'text') return true;
  if (op.k !== 'set' || op.e === 'note' || op.field === 'ai') return false;
  if (op.e === 'content') return !CONTENT_LAYOUT.has(op.field);
  return !!MEANING[op.e]?.has(op.field);
}

/**
 * (Engine.transact 안, 사람 출처 트랜잭션에서만) 이번 연산 중 AI 개체의 의미를 바꾼 것에 editedAt을 찍는다.
 * get: 지금 상태의 레코드 (이번 트랜잭션에서 지워졌으면 undefined)
 */
export function stampEdits(tx: Tx, ops: readonly Op[], get: (e: EntityKind, id: Id) => { readonly ai?: AiProvenance } | undefined, now: number): void {
  const done = new Set<string>();
  for (const op of [...ops]) {
    if (op.e === 'note' || !meaningful(op)) continue;
    const key = `${op.e}:${op.id}`;
    if (done.has(key)) continue;
    done.add(key);
    const ai = get(op.e, op.id)?.ai;
    if (!ai || (ai.editedAt !== undefined && now - ai.editedAt < EDIT_STAMP_MS)) continue;
    tx.set(op.e, op.id, { ai: { ...ai, editedAt: now } });
  }
}

/** 학습 데이터 출처 라벨 (OWN-MODEL 3절) — ai 없음 = 사람, 고쳤으면 *_edited */
export type DataOrigin = 'human' | AiOrigin | `${AiOrigin}_edited`;

export function dataOrigin(x: { readonly ai?: AiProvenance } | undefined): DataOrigin {
  const ai = x?.ai;
  if (!ai) return 'human';
  const o = ai.origin ?? 'claude';
  return ai.editedAt !== undefined ? `${o}_edited` : o;
}

/** 블록 단위: 블록 · 콘텐츠 중 AI가 만든 것이 있으면 그 모델 계열, 하나라도 사람이 고쳤으면 *_edited */
export function blockDataOrigin(engine: Engine, blockId: Id): DataOrigin {
  const b = engine.getBlock(blockId);
  const ais = [b?.ai, ...engine.contentsOf(blockId).map((c) => c.ai)].filter((x): x is AiProvenance => !!x);
  if (!ais.length) return 'human';
  const o = ais[0]!.origin ?? 'claude';
  return ais.some((x) => x.editedAt !== undefined) ? `${o}_edited` : o;
}
