// 의미 고치기 (v6): 화살표 관계 종류 · 블록 노드 종류. 사람이 고친 값이 학습 라벨(H0 · H1)이 된다 — 모양(style)은 건드리지 않는다.
// 사람 출처 트랜잭션이라 AI 개체면 ai.editedAt이 함께 찍힌다(provenance.ts). 실행 취소 한 번.
import type { Engine, TxResult } from './engine';
import type { Arrow, ArrowStyle, Block, Id } from './model';
import type { GROUP_KINDS, KnownNodeKind, KnownRelation, NodeKind, Relation } from './relations';

/** 관계 이름 (고르기 메뉴 · 내보내기) */
export const RELATION_LABEL: Readonly<Record<KnownRelation, string>> = {
  next: '다음 단계', 'leads-to': '이어짐', causes: '원인 → 결과', 'part-of': '일부', 'example-of': '예시', contrasts: '대조', supports: '뒷받침', 'depends-on': '의존',
  refutes: '반박', implies: '함의 ⇒', equivalent: '동치 ⇔', 'kind-of': '종류', inhibits: '억제', answers: '답', transitions: '전이', serves: '목적(위해)', becomes: '바뀜', 'flows-to': '흐름',
  'subset-of': '부분집합 ⊂', 'maps-to': '대응', symbolizes: '상징', relates: '관련', sends: '보냄', elaborates: '구체화', solves: '해결', 'analogous-to': '비유 ≈', correlates: '상관', moderates: '조절',
};

/** 노드 종류 이름 */
export const NODE_KIND_LABEL: Readonly<Record<KnownNodeKind, string>> = {
  concept: '개념', step: '단계', option: '선택지', claim: '주장', evidence: '근거', question: '질문', conclusion: '결론',
  definition: '정의', theorem: '정리', assumption: '가정', contradiction: '모순', rebuttal: '반박', condition: '조건', decision: '결정', action: '할 일', goal: '목표', event: '사건', state: '상태', actor: '행위자',
  premise: '전제', problem: '문제', rule: '규칙', example: '예', risk: '위험',
};

/** 묶음 종류 이름 (가이드 5.7) */
export const GROUP_KIND_LABEL: Readonly<Record<(typeof GROUP_KINDS)[number], string>> = {
  whole: '전체', set: '집합', case: '경우', proof: '증명', premises: '전제 묶음 ∧', layer: '층', lane: '레인', place: '장소', path: '경로',
  column: '열', section: '구역', slot: '칸', agenda: '안건', paragraph: '문단', phase: '단계', couple: '짝', frame: '틀',
};

/** 블록 상태 · 역할 · 발화자 · 담당 · 시점 (v6, 가이드 4.5 · 4.12 — 글자는 원문 그대로). '' · false면 지움 */
export type BlockMeta = Partial<Pick<Block, 'status' | 'emphasis' | 'hedge' | 'role' | 'speaker' | 'owner' | 'time' | 'start' | 'end' | 'due'>>;
const META_MAX: Partial<Record<keyof BlockMeta, number>> = { role: 24, speaker: 40, owner: 40 };
export function setBlockMeta(engine: Engine, ids: readonly Id[], patch: BlockMeta): TxResult<void> {
  return engine.transact((tx) => {
    for (const id of ids) {
      const b = engine.getBlock(id);
      if (!b) continue;
      const p: Record<string, unknown> = {};
      for (const [k, raw] of Object.entries(patch) as [keyof BlockMeta, unknown][]) {
        let v = typeof raw === 'string' ? raw.trim().slice(0, META_MAX[k] ?? 80) : raw;
        if (v === '' || v === false) v = undefined;
        if (b[k] !== v) p[k] = v;
      }
      if (Object.keys(p).length) tx.set('block', id, p);
    }
  }, { origin: 'user', label: '블록 상태' });
}

/** 화살표들의 관계 종류 (undefined = 미정으로 되돌림) */
export function setArrowRelation(engine: Engine, ids: readonly Id[], relation: Relation | undefined): TxResult<void> {
  return engine.transact((tx) => {
    for (const id of ids) if (engine.getArrow(id) && engine.getArrow(id)!.relation !== relation) tx.set('arrow', id, { relation });
  }, { origin: 'user', label: '관계 종류' });
}

/** 블록들의 노드 종류 (undefined = 없앰) */
export function setNodeKind(engine: Engine, ids: readonly Id[], kind: NodeKind | undefined): TxResult<void> {
  return engine.transact((tx) => {
    for (const id of ids) if (engine.getBlock(id) && engine.getBlock(id)!.nodeKind !== kind) tx.set('block', id, { nodeKind: kind });
  }, { origin: 'user', label: '노드 종류' });
}

/** 화살표 기호 (v6 3단계): ∴ ∵ ↺ ↩ 같은 기호 칩 · 성립하지 않음(⇏) · 극성(+ −) · 번호 · 응답 — 의미라서 출처 도장이 찍힌다. undefined면 지움 */
export type ArrowMarks = Partial<Pick<Arrow, 'symbol' | 'negated' | 'sign' | 'order' | 'reply'>>;
export function setArrowMarks(engine: Engine, ids: readonly Id[], patch: ArrowMarks): TxResult<void> {
  return engine.transact((tx) => {
    for (const id of ids) {
      const a = engine.getArrow(id);
      if (!a) continue;
      const p: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(patch)) if (a[k as keyof ArrowMarks] !== v) p[k] = v === false || v === '' ? undefined : v;
      if (Object.keys(p).length) tx.set('arrow', id, p);
    }
  }, { origin: 'user', label: '화살표 기호' });
}

/**
 * 화살표 모양 (v6 2단계): 바꾼 것만 style에 남긴다 — null이면 관계 기본 모양으로(색도 비움).
 * 선(line)을 고르면 v5 호환 dash는 지운다(같은 뜻을 두 곳에 두지 않게). 모양은 의미가 아니라 출처 도장은 찍히지 않는다
 */
export function setArrowStyle(engine: Engine, ids: readonly Id[], patch: Partial<ArrowStyle> | null): TxResult<void> {
  return engine.transact((tx) => {
    for (const id of ids) {
      const a = engine.getArrow(id);
      if (!a) continue;
      let next: Record<string, unknown> | undefined;
      if (patch) {
        next = { ...a.style, ...patch };
        if (patch.line) delete next.dash;
        for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
        if (!Object.keys(next).length) next = undefined;
      }
      tx.set('arrow', id, { style: next });
    }
  }, { origin: 'user', label: '화살표 모양' });
}
