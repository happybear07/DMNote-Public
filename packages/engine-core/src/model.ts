// 문서 모델 타입 (ENGINE 3.4). 레코드는 불변 객체이고, 모르는 필드는 그대로 실려 다닌다 (12.4).
// v6 (docs/review/V6-SCHEMA-REVIEW.md): 의미(relation · nodeKind · 묶음 kind)와 모양(style)을 따로, 출처(ai.origin · editedAt)를 남긴다.
// 전부 선택 필드 — 없으면 읽을 때 기본값 (relations.ts · provenance.ts).
import type { BlockComment } from './comments';
import type { OrderKey } from './order';
import type { GroupKind, NodeKind, Relation } from './relations';

export type Id = string;
export type EntityKind = 'block' | 'content' | 'arrow' | 'stroke';

/** AI를 만든 모델 계열 — 학습 데이터 등급(OWN-MODEL 3절)의 기준. ops.ts의 Origin(트랜잭션 출처)과 다른 것 */
export type AiOrigin = 'claude' | 'open_teacher' | 'student';

/** 원문 구절 — 이 상자가 같은 노트의 어느 글(콘텐츠)에서 나왔나. 위치는 그때 문서 기준이라 원문을 고치면 어긋나고, 찾기는 excerpt(글자)로 한다 */
export interface SourceRef { readonly contentId?: Id; readonly from: number; readonly to: number; readonly excerpt?: string }

export interface AiProvenance {
  readonly generated: true;
  readonly runId: string;
  readonly source?: SourceRef;
  /** v6: 모델 계열. 없으면 'claude'로 읽는다 (v5 데이터는 전부 Claude) */
  readonly origin?: AiOrigin;
  readonly provider?: string;
  readonly model?: string;
  readonly promptVersion?: string;
  /** AI 출력 스키마 ('structure.v1' …) */
  readonly schema?: string;
  /** v6: 사람이 이 개체의 의미 필드를 마지막으로 고친 시각 — 없으면 고친 적 없음 (provenance.ts가 자동으로 찍는다) */
  readonly editedAt?: number;
}

/** 묶음 정보 (groups.ts) — 이름 · v6 의미(kind) · 출처 · 모양(괄호) */
export interface GroupMeta {
  readonly name?: string;
  readonly kind?: GroupKind;
  readonly ai?: AiProvenance;
  /** 묶음 테두리 모양: 상자(기본) · 중괄호 · 없음 · 카드(노트형 — 바탕 · 머리 번호 · 이름 · 밑줄, cards.ts) */ readonly bracket?: 'box' | 'brace' | 'none' | 'card';
  /** 카드 바탕색 — 블록 색 이름(blue · yellow · green · pink · gray …), 없으면 기본 카드색 */ readonly tone?: string;
  /** 카드 머리에 번호 (읽는 순서로 1, 2, 3 … — 번호 켠 카드끼리) */ readonly numbered?: boolean;
  /** 문서 뷰 · 인쇄 · 워드에서 글 대신 도식 그림으로 (상자 · 화살표 그대로, engine-dom doc-diagram.ts) */ readonly figure?: boolean;
  /** 도식 모양 (AI 원형, STRUCTURE-GUIDE 2.1 P-03 · P-11 · P-12 · P-23): 시간축 선 · 사분면 십자와 축 · 척도 축 · 벤 타원 — 상자 자리에서 그릴 때마다 계산 (engine-dom group-shapes.ts) */
  readonly shape?: 'timeline' | 'matrix' | 'scale' | 'venn' | 'fishbone';
  /** 축 이름, 원문 그대로 — 사분면은 가로(x) · 세로(y), 척도는 왼쪽 끝(x) · 오른쪽 끝(y) */
  readonly axis?: { readonly x?: string; readonly y?: string };
}

export interface Note {
  readonly id: Id;
  readonly title: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  /** 캔버스 배경 (FR-041) — 없으면 점 그리드 */
  readonly paper?: Paper;
  /** 노트 아이콘 (FR-070): 이모지 글자 그대로, 또는 'icon:<선 아이콘 이름>' */
  readonly icon?: string;
  /** 커버 이미지 (FR-070) */
  readonly cover?: NoteCover;
  /** 페이지 표시 옵션 (FR-072): 문서 뷰 전체 폭 · 작은 글자 · 편집 잠금(풀기 전까지 보기 전용) */
  readonly page?: NotePage;
  /** 용지 (A4 페이지 캔버스) — 없으면 끝없는 캔버스 */
  readonly sheet?: NoteSheet;
  /** 표지 쪽 (11/03, cover.ts) — 왼쪽 위 자리, 크기는 A4 세로. A4 노트는 1쪽 바로 위, 끝없는 캔버스는 내용 왼쪽 */
  readonly coverPage?: { readonly x: number; readonly y: number };
  /** 쪽 설정 (page-setup.ts): 방향 · 여백 · 머리글 · 바닥글 · 쪽 번호 — 문서 뷰 쪽 보기 · 인쇄 · PDF */
  readonly pageSetup?: PageSetup;
  /** 제목 번호 (toc.ts): 제목 상자 · 제목 1 = 1. · 제목 2 = 1.1 … — 문서 뷰 · 목차 · 인쇄 · 워드 */ readonly headingNumbers?: boolean;
  /** 블록(콘텐츠 묶음) 정보 — 묶음 id → 이름 · 종류 (groups.ts). 이름이 없으면 첫 제목 · 첫 줄 */
  readonly groups?: Readonly<Record<Id, GroupMeta>>;
  /** 노트 역할 (회의록 · 강의 필기 … 또는 사용자가 만든 역할의 id) — 사용자 · 템플릿이 정한 것. 없으면 앱이 제목 · 소제목으로 추정한다(search scope.ts). 노트에 묻기 범위 좁히기에 쓴다 */
  readonly role?: string;
}

/** 블록 배경 (색 이름) */
export interface BlockStyle { readonly color?: string }

/** 용지: A4 · 가로 여부 · 사용자가 늘린 페이지 수 (sheet.ts) */
export interface NoteSheet {
  readonly size: 'a4'; readonly landscape?: boolean; readonly pages?: number;
  /** 쪽마다 방향 (11/03) — 쪽 차례(0부터) → 노트 기본(landscape)과 다른 쪽만 */
  readonly orient?: Readonly<Record<string, 'landscape' | 'portrait'>>;
}

export type PageMargin = 'normal' | 'narrow' | 'moderate' | 'wide';
export type PageNumberPos = 'bottom-center' | 'bottom-right' | 'top-right' | 'none';
/** 쪽 설정 — 없는 값은 기본: A4 세로 · 보통 여백(1인치) · 머리글 · 바닥글 없음 · 쪽 번호 아래 가운데 */
export interface PageSetup {
  readonly landscape?: boolean;
  readonly margin?: PageMargin;
  readonly header?: string;
  readonly footer?: string;
  readonly numbers?: PageNumberPos;
  /** 첫 쪽(표지)에는 머리글 · 바닥글 · 쪽 번호를 보이지 않는다 */
  readonly skipFirst?: boolean;
}

export interface NotePage { readonly fullWidth?: boolean; readonly smallText?: boolean; readonly editLock?: boolean }

/** 커버: 첨부 저장소 해시 · 세로 위치(0 = 위쪽을 보여 줌 ~ 100 = 아래쪽) */
export interface NoteCover { readonly attachment: string; readonly pos: number }

/** 캔버스 배경: 점 · 괘선 · 모눈 · 무지, 간격(월드 px), 바탕색(캔버스 설정 — 없으면 앱 테마를 따름) */
export interface Paper { readonly kind: PaperKind; readonly gap: number; readonly color?: PaperColor }
export type PaperKind = 'dots' | 'lines' | 'grid' | 'none';
export const PAPER_KINDS: readonly PaperKind[] = ['dots', 'lines', 'grid', 'none'];
/** 캔버스 바탕색 (알파 10/31): 흰 종이 · 옥스퍼드(옅은 노란 종이) · 어두운 종이 — 캔버스 안 색만 바뀐다(앱 화면은 테마 그대로) */
export type PaperColor = 'white' | 'oxford' | 'dark';
export const PAPER_COLORS: readonly PaperColor[] = ['white', 'oxford', 'dark'];
export const PAPER_GAPS: readonly number[] = [16, 24, 32, 48];
export const DEFAULT_PAPER: Paper = { kind: 'dots', gap: 32 };

export type LayoutMode = 'flow' | 'free';

export interface Block {
  readonly id: Id;
  readonly x: number; readonly y: number;
  readonly w: number; readonly h: number;
  /** auto: h = 측정된 콘텐츠 높이. fixed: 사용자가 세로로 키운 최소 높이(minH)를 지킨다 (D6) */
  readonly sizing: 'auto' | 'fixed';
  readonly minH?: number;
  readonly layout: LayoutMode;
  /** 쌓임 순서 전용, 읽기 순서 아님 (D5) */
  readonly z: OrderKey;
  readonly style?: BlockStyle;
  /** 글자 모양 (block-style.ts) — 따로 둔 필드라 동기화 · 실행 취소가 항목마다 따로 */
  readonly fontScale?: number;
  readonly textColor?: string;
  readonly align?: 'center' | 'right' | 'justify';
  /** 글꼴 — 없으면 기본(고딕). 명조 · 고정폭 (block-style.ts FONT_FAMILIES) */
  readonly fontFamily?: 'serif' | 'mono';
  /** 줄 간격 배율 (1.15 · 1.5 · 2 …, 없으면 설정값) */
  readonly lineHeight?: number;
  /** 들여쓰기 단계 (1~8, 한 단계 24px) */
  readonly indent?: number;
  /** 캡션 (caption.ts) — 표 · 그림 블록의 '표 N. …' · '그림 N. …' 글 */
  readonly caption?: string;
  /** 첫 줄 (워드): 양수 = 첫 줄 들여쓰기, 음수 = 내어쓰기(매달린) — 글자(em) 수 */
  readonly firstLine?: number;
  /** 문단 앞 · 뒤 간격 (px) — 상자 안 문단마다 */
  readonly spaceBefore?: number;
  readonly spaceAfter?: number;
  /** 이 상자부터 새 쪽 — 문서 뷰 쪽 보기 · 인쇄 · PDF (doc-edit.ts, Ctrl+Enter) */
  readonly pageBreak?: boolean;
  /** 문서 뷰에서 새 문단 자리만 잡은 빈 상자 — 글이 들어오기 전에는 캔버스에 나타나지 않는다 (공간 색인 밖). 글이 생기면 지워진다 (doc-edit.ts) */
  readonly draft?: boolean;
  /** 묶음 id — 같은 값인 상자들이 한 블록(콘텐츠 묶음)으로 함께 움직인다 (groups.ts) */
  readonly group?: Id;
  readonly ai?: AiProvenance;
  /** 사람이 원문에서 꺼낸 상자의 원문 연결 (source-box.ts) — ai.source와 같은 꼴이지만 AI 표시는 아니다 */
  readonly source?: SourceRef;
  // ── v6 의미 (STRUCTURE-GUIDE 5.3 · 5.4). 글자는 원문 그대로 — 계산하지 않는다 ──
  /** 노드 종류 (주장 · 근거 · 정의 …) — 모양(style.color)과 따로 */
  readonly nodeKind?: NodeKind;
  /** 이 차트 · 표가 붙은 노드 블록 — 느슨한 참조(상대가 없으면 무시) */
  readonly attachTo?: Id;
  readonly status?: 'belief' | 'refuted' | 'before' | 'wrong' | 'deferred';
  readonly emphasis?: 'strong' | 'warning';
  /** 원문이 불확실하게 말함 */
  readonly hedge?: boolean;
  /** 원문 용어로 된 역할 (보조정리 · 가설 · qed …, ≤ 24자) */
  readonly role?: string;
  /** 발화 주체 (≤ 40자) */
  readonly speaker?: string;
  /** 담당 (≤ 40자) */
  readonly owner?: string;
  readonly time?: string;
  readonly start?: string;
  readonly end?: string;
  readonly due?: string;
  /** 기기 사이 동기화 충돌로 되살린 블록 (FR-097) — 사용자가 남기기 · 지우기를 고를 때까지 */
  readonly conflict?: { readonly kind: 'remote-deleted' | 'local-deleted'; readonly at: number };
  /** 댓글 (FR-132) — 본문과 따로, 내보내기에서 빠진다 */
  readonly comments?: readonly BlockComment[];
}

// ───────── 텍스트 문서 (ProseMirror JSON, 스키마 'pm-v1') ─────────
// 엔진은 구조를 해석하지 않는다. 적용 · 검증은 TextCodec이 한다 (ENGINE 5.6).
export interface TextMark { readonly type: string; readonly attrs?: Readonly<Record<string, unknown>> }
export interface TextNode {
  readonly type: string;
  readonly attrs?: Readonly<Record<string, unknown>>;
  readonly content?: readonly TextNode[];
  readonly marks?: readonly TextMark[];
  readonly text?: string;
}
export interface TextDoc extends TextNode { readonly type: 'doc'; readonly content: readonly TextNode[] }

/** 텍스트 스텝 적용기. engine-core는 ProseMirror에 의존하지 않고 이 인터페이스만 안다. */
export interface TextCodec {
  readonly id: string;
  /** 스텝(JSON)을 적용한 새 문서와, 새 문서에 적용하면 원래 문서가 되는 역스텝. 실패하면 throw. */
  apply(doc: TextDoc, steps: readonly unknown[]): { doc: TextDoc; inverse: unknown[] };
  /** 스키마상 유효하면 null, 아니면 이유. */
  validate(doc: unknown): string | null;
  /** 스키마에 안 맞는 문서를 맞게 고친다(맞으면 그대로) — 동기화로 합쳐진 문서용 (SYNC 13.4 N7). 없으면 고치지 못한다 */
  repair?(doc: unknown): TextDoc;
}

export interface Frame { readonly x: number; readonly y: number; readonly w: number; readonly h: number }

interface ContentBase {
  readonly id: Id;
  readonly blockId: Id;
  readonly order: OrderKey;
  readonly frame?: Frame;
  readonly ai?: AiProvenance;
}
/**
 * 텍스트 콘텐츠의 역할 = 텍스트 상자의 종류 (스키마 v3). 텍스트 블록은 둘 중 한 종류다.
 * - title: **제목 상자** — 한 줄 제목만. 문서는 문단 하나 (`titleDoc`, 엔진 불변식 I10)
 * - body: **내용 상자** — 리치 텍스트 (ENGINE D8: 텍스트 콘텐츠 하나 = 리치 텍스트 문서 하나)
 * 없으면 body로 읽는다 (모르는 앱이 만든 레코드).
 */
export type TextRole = 'title' | 'body';

/** 텍스트 상자 종류: 제목 상자 · 내용 상자 */
export type BoxKind = 'title' | 'text';

export interface TextContent extends ContentBase {
  readonly type: 'text';
  readonly doc: TextDoc;
  readonly role?: TextRole;
}
/** 이 빌드가 모르는 타입 — 렌더는 자리표시자, 데이터는 보존 */
export interface UnknownContent extends ContentBase {
  readonly type: string;
  readonly [k: string]: unknown;
}
export type Content = TextContent | UnknownContent;

export type Side = 'auto' | 'top' | 'right' | 'bottom' | 'left';
/** 상자에 붙은 화살표 끝 */
export interface BlockAnchor {
  /** 붙은 상자. groupId가 있으면 그 묶음의 대표 상자 */
  readonly blockId: Id;
  readonly side: Side;
  readonly t?: number;
  /** v6: 이 끝이 묶음 전체에 붙음 — 느슨한 참조(묶음이 풀렸거나 blockId가 그 묶음이 아니면 상자 끝으로 읽는다) */
  readonly groupId?: Id;
  readonly point?: undefined;
}
/** 빈 곳의 화살표 끝 (11/09) — 캔버스 아무 데나 긋는 화살표. 상자를 옮겨도 이 끝은 그대로.
 *  상자 끝 필드는 늘 없음(undefined) — 읽기는 되고, 상자 id가 꼭 필요한 곳에서는 isBlockEnd로 가른다 */
export interface PointAnchor {
  readonly point: { readonly x: number; readonly y: number };
  readonly blockId?: undefined; readonly side?: undefined; readonly t?: undefined; readonly groupId?: undefined;
}
/** 화살표 끝: 상자에 붙은 끝 또는 빈 곳의 점 */
export type Anchor = BlockAnchor | PointAnchor;
export const isBlockEnd = (a: Anchor): a is BlockAnchor => typeof (a as BlockAnchor).blockId === 'string';
/** 저장된 값이 올바른 화살표 끝인가 — 빈 글자가 아닌 상자 id, 또는 유한한 점 (가져오기 · 동기화 · 검증) */
export function validEnd(a: unknown): a is Anchor {
  const x = a as { blockId?: unknown; point?: { x?: unknown; y?: unknown } } | null | undefined;
  if (!x || typeof x !== 'object') return false;
  if (typeof x.blockId === 'string') return x.blockId.length > 0;
  return !!x.point && Number.isFinite(x.point.x as number) && Number.isFinite(x.point.y as number);
}
/** 그 끝이 붙은 상자 (점 끝이면 undefined) */
export const endBlock = (a: Anchor): Id | undefined => (isBlockEnd(a) ? a.blockId : undefined);

/** 화살표 모양 (v6) — 선 · 끝 모양 · 굵기 · 경로. 의미(relation)와 따로, 사용자가 바꾼 것만 저장한다 */
/** curl = 가운데서 한 번 감김, spring = 길이만큼 계속 감김 */
export type ArrowLine = 'solid' | 'dashed' | 'dotted' | 'double' | 'wavy' | 'curl' | 'spring';
export type ArrowHead = 'none' | 'triangle' | 'chevron' | 'open-triangle' | 'diamond' | 'open-diamond' | 'bar' | 'dot';
export type ArrowRoute = 'straight' | 'orthogonal' | 'curve' | 'loop';
export interface ArrowStyle {
  readonly color?: string;
  /** v5 호환 — v6부터는 line. 읽기: line ?? (dash ? 'dashed' : 관계 기본) */
  readonly dash?: boolean;
  readonly line?: ArrowLine;
  /** 도착(to) 쪽 끝 */
  readonly head?: ArrowHead;
  /** 출발(from) 쪽 끝 — 양방향 */
  readonly tail?: ArrowHead;
  readonly width?: 1 | 1.5 | 2;
  readonly route?: ArrowRoute;
}

export interface Arrow {
  readonly id: Id;
  readonly from: Anchor;
  readonly to: Anchor;
  /** 원문 구절 (STRUCTURE-GUIDE 4.3) — 기호는 symbol에 */
  readonly label?: string;
  readonly style?: ArrowStyle;
  readonly ai?: AiProvenance;
  // ── v6 의미 (STRUCTURE-GUIDE 5.5 · 5.6) ──
  /** 관계 종류 — 없으면 "미정"(지금 모양 그대로). 모르는 값도 보존한다 */
  readonly relation?: Relation;
  /** 기호 칩 (∴ ∵ ↺ ↩ 1:N …) */
  readonly symbol?: string;
  /** 성립하지 않음 (⇏) */
  readonly negated?: boolean;
  /** 극성 — 원문이 말할 때만 */
  readonly sign?: '+' | '-';
  /** 메시지 · 단계 번호 */
  readonly order?: number;
  /** 응답 메시지 */
  readonly reply?: boolean;
  /** 원문 확률 ("2/5" …) */
  readonly prob?: string;
}
/** 양 끝이 다 상자에 붙은 화살표 — 문서 순서 · 흐름 · 관계 · 내보내기는 이것만 본다 (빈 곳 화살표는 캔버스 그림) */
export type BoundArrow = Arrow & { readonly from: BlockAnchor; readonly to: BlockAnchor };
export const isBound = (a: Arrow): a is BoundArrow => isBlockEnd(a.from) && isBlockEnd(a.to);

/** 잉크(P4)는 아직 해석하지 않고 보존만 한다. */
export interface StrokeRecord { readonly id: Id; readonly [k: string]: unknown }

export function isTextContent(c: Content): c is TextContent {
  return c.type === 'text' && typeof (c as TextContent).doc === 'object';
}
