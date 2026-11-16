// 관계 · 노드 종류 · 묶음 종류 값 목록과, 관계 → 기본 화살표 모양 (v6, STRUCTURE-GUIDE 4.2 · 5.3 · 5.5 · 5.7).
// 모양 표는 저장하지 않고 여기 한 곳에 둔다 — 그리기 · AI 반영 · 내보내기가 같이 쓰고, 표가 바뀌면 모든 노트가 따라 바뀐다.
// 저장은 너그럽게: 모르는 관계 · 종류 문자열도 보존한다(그리기는 기본 모양). 값 제한은 AI 출력 스키마와 고르기 메뉴가 한다.
import type { Arrow, ArrowHead, ArrowLine, ArrowRoute, ArrowStyle, Block } from './model';

/** 들이는 순서: v1(지금 AI 출력) · 1차 · 2차 (가이드 5.5) */
export const RELATIONS_V1 = ['causes', 'leads-to', 'part-of', 'example-of', 'contrasts', 'supports', 'depends-on', 'next'] as const;
export const RELATIONS_TIER1 = ['refutes', 'implies', 'equivalent', 'kind-of', 'inhibits', 'answers', 'transitions', 'serves', 'becomes', 'flows-to'] as const;
export const RELATIONS_TIER2 = ['subset-of', 'maps-to', 'symbolizes', 'relates', 'sends', 'elaborates', 'solves', 'analogous-to', 'correlates', 'moderates'] as const;
export type KnownRelation = (typeof RELATIONS_V1)[number] | (typeof RELATIONS_TIER1)[number] | (typeof RELATIONS_TIER2)[number];
/** 저장 값 — 알려진 28개 + 모르는 문자열 보존 */
export type Relation = KnownRelation | (string & {});
export const RELATIONS: readonly KnownRelation[] = [...RELATIONS_V1, ...RELATIONS_TIER1, ...RELATIONS_TIER2];

/** 노드 종류 (가이드 5.3) — proof · belief는 종류가 아니다(묶음 kind · status) */
export const NODE_KINDS_V1 = ['concept', 'step', 'option', 'claim', 'evidence', 'question', 'conclusion'] as const;
export const NODE_KINDS_TIER1 = ['definition', 'theorem', 'assumption', 'contradiction', 'rebuttal', 'condition', 'decision', 'action', 'goal', 'event', 'state', 'actor'] as const;
export const NODE_KINDS_TIER2 = ['premise', 'problem', 'rule', 'example', 'risk'] as const;
export type KnownNodeKind = (typeof NODE_KINDS_V1)[number] | (typeof NODE_KINDS_TIER1)[number] | (typeof NODE_KINDS_TIER2)[number];
export type NodeKind = KnownNodeKind | (string & {});
export const NODE_KINDS: readonly KnownNodeKind[] = [...NODE_KINDS_V1, ...NODE_KINDS_TIER1, ...NODE_KINDS_TIER2];

/** 노드 종류별 기본 바탕색 (FR-021, 가이드 4.1 tint — 앱 블록 색과 같은 값). 저장하지 않고 그릴 때. 개념 · 단계 · 주장 등은 기본 */
export const KIND_COLOR: Readonly<Partial<Record<KnownNodeKind, string>>> = {
  conclusion: 'green', question: 'yellow', option: 'purple', evidence: 'gray',
  assumption: 'blue', contradiction: 'red', rebuttal: 'red', condition: 'yellow', decision: 'green', problem: 'orange',
};

/** 블록 바탕색: 사용자가 고른 색 > 노드 종류 기본색 */
export function blockColor(b: Pick<Block, 'style' | 'nodeKind'>): string | undefined {
  return b.style?.color ?? (b.nodeKind ? KIND_COLOR[b.nodeKind as KnownNodeKind] : undefined);
}

/** 묶음 종류 (가이드 5.7) */
export const GROUP_KINDS = ['whole', 'set', 'case', 'proof', 'premises', 'layer', 'lane', 'place', 'path', 'column', 'section', 'slot', 'agenda', 'paragraph', 'phase', 'couple', 'frame'] as const;
export type GroupKind = (typeof GROUP_KINDS)[number] | (string & {});

/** 관계 색 — 테마 토큰 이름 (가이드 4.4 relation/*, 그리기 2단계) */
export type RelationTone = 'purple' | 'orange' | 'green' | 'blue' | 'red' | 'brown' | 'secondary' | 'tertiary' | 'primary';

export interface RelationSpec {
  readonly line: ArrowLine;
  readonly head: ArrowHead;
  readonly tail?: ArrowHead;
  readonly width: 1 | 1.5 | 2;
  readonly tone: RelationTone;
  /** 라벨이 없을 때 보일 칩 */
  readonly chip?: { readonly ko: string; readonly en: string };
  /** 배치 방향 (AI 반영): 앞 → 뒤 · 뒤 → 앞 · 같은 줄 */
  readonly layout: 'forward' | 'reverse' | 'same';
  /** 방향 없는 관계 */
  readonly symmetric?: boolean;
}

const spec = (line: ArrowLine, head: ArrowHead, width: 1 | 1.5 | 2, tone: RelationTone, layout: RelationSpec['layout'], chip?: [string, string], more: Partial<RelationSpec> = {}): RelationSpec =>
  ({ line, head, width, tone, layout, ...(chip ? { chip: { ko: chip[0], en: chip[1] } } : {}), ...more });

/** 관계 없음(미정) = 지금까지의 모양 */
export const DEFAULT_ARROW: RelationSpec = spec('solid', 'triangle', 1.5, 'secondary', 'forward');

/** 관계 → 기본 모양 (가이드 4.2). 2차 관계는 가까운 1차 선 + 칩 */
export const RELATION_SPEC: Readonly<Record<KnownRelation, RelationSpec>> = {
  next: spec('solid', 'triangle', 1.5, 'purple', 'forward'),
  'leads-to': spec('solid', 'chevron', 1.5, 'secondary', 'forward', ['이어짐', 'leads to']),
  causes: spec('solid', 'triangle', 2, 'orange', 'forward', ['유발', 'causes']),
  'part-of': spec('solid', 'open-diamond', 1.5, 'tertiary', 'reverse', ['일부', 'part of']),
  'example-of': spec('dashed', 'chevron', 1.5, 'tertiary', 'reverse', ['예시', 'example of']),
  contrasts: spec('dashed', 'none', 1.5, 'blue', 'same', ['대조', 'vs'], { symmetric: true }),
  supports: spec('solid', 'triangle', 1.5, 'green', 'forward', ['뒷받침', 'supports']),
  'depends-on': spec('dotted', 'chevron', 1.5, 'blue', 'reverse', ['의존', 'depends on']),
  refutes: spec('dashed', 'triangle', 1.5, 'red', 'forward', ['✕ 반박', '✕ refutes']),
  implies: spec('double', 'chevron', 1.5, 'primary', 'forward', ['⇒', '⇒']),
  equivalent: spec('double', 'chevron', 1.5, 'primary', 'same', ['⇔', '⇔'], { tail: 'chevron', symmetric: true }),
  'kind-of': spec('solid', 'open-triangle', 1.5, 'tertiary', 'reverse', ['종류', 'kind of']),
  inhibits: spec('solid', 'bar', 2, 'primary', 'forward', ['억제', 'inhibits']),
  answers: spec('solid', 'chevron', 1.5, 'secondary', 'reverse', ['답', 'answers']),
  transitions: spec('solid', 'chevron', 1.5, 'secondary', 'forward'),
  serves: spec('solid', 'chevron', 1.5, 'secondary', 'forward', ['위해', 'for']),
  becomes: spec('solid', 'triangle', 1.5, 'secondary', 'forward', ['변경', 'becomes']),
  'flows-to': spec('solid', 'triangle', 2, 'brown', 'forward'),
  'subset-of': spec('solid', 'open-diamond', 1.5, 'tertiary', 'reverse', ['⊂', '⊂']),
  'maps-to': spec('solid', 'chevron', 1.5, 'secondary', 'forward', ['대응', 'maps to']),
  symbolizes: spec('solid', 'chevron', 1.5, 'secondary', 'forward', ['상징', 'symbolizes']),
  relates: spec('solid', 'none', 1, 'tertiary', 'same', undefined, { symmetric: true }),
  sends: spec('solid', 'triangle', 1.5, 'secondary', 'forward'),
  elaborates: spec('solid', 'open-diamond', 1.5, 'tertiary', 'reverse', ['구체적으로', 'elaborates']),
  solves: spec('solid', 'chevron', 1.5, 'green', 'forward', ['해결', 'solves']),
  'analogous-to': spec('dotted', 'none', 1.5, 'tertiary', 'same', ['≈', '≈'], { symmetric: true }),
  correlates: spec('dashed', 'none', 1.5, 'blue', 'same', ['상관', 'correlates'], { symmetric: true }),
  moderates: spec('dotted', 'chevron', 1.5, 'blue', 'forward', ['조절', 'moderates']),
};

/** 화살표 칩 글자 (v6 3단계): [번호] ⇏ 기호 라벨 ± — 라벨(원문 구절)과 기호를 따로 저장하고 보일 때만 잇는다 */
export function arrowChip(a: Pick<Arrow, 'label'> & Partial<Pick<Arrow, 'symbol' | 'negated' | 'sign' | 'order'>>): string {
  const n = a.order;
  const parts = [
    n !== undefined ? (n >= 1 && n <= 20 ? String.fromCharCode(0x2460 + n - 1) : `${n}.`) : '',
    a.negated ? '⇏' : '', a.symbol ?? '', a.label ?? '', a.sign === '+' ? '+' : a.sign === '-' ? '−' : '',
  ];
  return parts.filter(Boolean).join(' ');
}

export function isKnownRelation(r: unknown): r is KnownRelation {
  return typeof r === 'string' && Object.prototype.hasOwnProperty.call(RELATION_SPEC, r);
}

export function relationSpec(r: Relation | undefined): RelationSpec {
  return isKnownRelation(r) ? RELATION_SPEC[r] : DEFAULT_ARROW;
}

/** 그릴 모양: 사용자가 바꾼 모양(style) > 관계 기본 > 미정 기본. v5의 dash는 line이 없을 때만 */
export interface EffectiveArrowStyle {
  readonly line: ArrowLine;
  readonly head: ArrowHead;
  readonly tail: ArrowHead;
  readonly width: 1 | 1.5 | 2;
  readonly route: ArrowRoute;
  /** 사용자가 고른 색 (없으면 테마 · 관계 색) */
  readonly color?: string;
  readonly tone: RelationTone;
}
export function effectiveStyle(a: Pick<Arrow, 'relation' | 'style'> & Partial<Pick<Arrow, 'negated' | 'reply'>>): EffectiveArrowStyle {
  const s: ArrowStyle = a.style ?? {};
  // 성립하지 않음(⇏)은 반박 모양(가이드 4.2 보조 모양), 응답 메시지는 파선(S-52)
  const base = a.negated ? RELATION_SPEC.refutes : relationSpec(a.relation);
  const p = a.reply && !a.negated ? { ...base, line: 'dashed' as const } : base;
  return {
    line: s.line ?? (s.dash ? 'dashed' : p.line),
    head: s.head ?? p.head,
    tail: s.tail ?? p.tail ?? 'none',
    width: s.width ?? p.width,
    route: s.route ?? 'straight',
    ...(s.color ? { color: s.color } : {}),
    tone: p.tone,
  };
}
