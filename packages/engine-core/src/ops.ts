// 원자 연산과 역연산 (ENGINE 5.1~5.2).
import type { EntityKind, Id } from './model';

export type Op =
  | { readonly k: 'create'; readonly e: EntityKind; readonly id: Id; readonly value: unknown }
  | { readonly k: 'delete'; readonly e: EntityKind; readonly id: Id; readonly prev: unknown }
  | { readonly k: 'set'; readonly e: EntityKind | 'note'; readonly id: Id; readonly field: string;
      readonly value: unknown; readonly prev: unknown }
  /** 텍스트 콘텐츠의 doc에 ProseMirror 스텝(JSON) 적용. inverse는 적용 후 문서에 대한 역스텝 (5.6) */
  | { readonly k: 'text'; readonly e: 'content'; readonly id: Id; readonly steps: readonly unknown[]; readonly inverse: readonly unknown[] };

export function invert(op: Op): Op {
  switch (op.k) {
    case 'create': return { k: 'delete', e: op.e, id: op.id, prev: op.value };
    case 'delete': return { k: 'create', e: op.e, id: op.id, value: op.prev };
    case 'set': return { k: 'set', e: op.e, id: op.id, field: op.field, value: op.prev, prev: op.value };
    case 'text': return { k: 'text', e: 'content', id: op.id, steps: op.inverse, inverse: op.steps };
  }
}

export function invertAll(ops: readonly Op[]): Op[] {
  const out: Op[] = [];
  for (let i = ops.length - 1; i >= 0; i--) out.push(invert(ops[i]!));
  return out;
}

export type Origin = 'user' | 'text' | 'ai' | 'undo' | 'redo' | 'layout' | 'migration' | 'remote' | 'load';

/** 값 비교: 원시값은 ===, 객체는 구조 비교 (set 생략 판단용). */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}
