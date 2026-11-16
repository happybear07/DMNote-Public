// 캔버스 뷰가 쓰는 타입: 공개 타입(옵션 · UI 상태 · 알림)과 내부 타입(제스처 · 마운트된 블록).
import type { Anchor, Camera, Engine, HlKind, Id, PenKind, Rect, SnapGuide, TextDoc, Vec2 } from '@dn/engine-core';
import type { NoteLinkHost, TextEditor } from '@dn/text-pm';
import type { EmbedHost } from './embed-render';
import type { WebHost } from './web-render';

/** block: 내용 상자 만들기 · title: 제목 상자 만들기 */
/** 선택 도구 세 가지: select = 필기 뺀 콘텐츠(상자), lasso = 필기만, both = 둘 다 */
export type Tool = 'select' | 'block' | 'title' | 'arrow' | 'hand' | 'pen' | 'highlighter' | 'eraser' | 'lasso' | 'both';

export interface CanvasUiState {
  zoom: number;
  tool: Tool;
  selectedBlocks: number;
  selectedArrows: number;
  /** 잉크 도구 설정 · 보이기 · 고른 획 수 (FR-034~036 · 040) */
  ink: { color: string; hlColor: string; colors: string[]; hlColors: string[]; width: number; hlWidth: number; pen: PenKind; hl: HlKind; show: boolean; showBlocks: boolean; penOnly: boolean; selected: number };
  editing: boolean;
  canUndo: boolean;
  canRedo: boolean;
}

export interface CanvasViewOptions {
  engine: Engine;
  container: HTMLElement;
  camera?: Camera;
  onCameraChange?(c: Camera): void;
  /** 읽기 전용 (상위 버전 노트 등, FR-090) — 보기 · 선택 · 팬 · 줌만 허용 */
  readOnly?: boolean;
  /** 사용자에게 알릴 일 (앱이 문구로 바꿔 토스트로 띄운다) */
  onNotice?(code: CanvasNotice): void;
  /** 캔버스에 붙여넣어 블록을 만든 직후 (앱이 "구조화하기" 칩을 띄운다, FR-105) */
  onPasted?(blockId: Id, info: { chars: number; markdown: boolean }): void;
  /** 휠 동작 (설정 › 편집, FR-143) */
  wheelMode?: 'pan' | 'zoom';
  /** 블록 핸들(⋮⋮)을 클릭했을 때 — 앱이 블록 메뉴를 띄운다 (FR-024). 좌표는 핸들 아래 왼쪽 (client px). */
  onBlockMenu?(req: BlockMenuRequest): void;
  /** 슬래시 메뉴의 'AI로 구조화하기' — 편집 중이던 블록 (FR-029) */
  onSlashAi?(blockId: Id): void;
  /** 노트 링크 (FR-080): '[[' · '@' 자동완성과 링크 누르기 */
  noteLinks?: NoteLinkHost;
  /** 첨부 파일 주소 (이미지 블록, FR-018) — 해시 → 화면에 쓸 URL (없으면 null) */
  /** blob: PDF 보기(GAP #22)가 머리 바이트(%PDF-)를 보고 PDF 형식으로 다시 싸서 연다 — 없으면 펼쳐 보기 없음 */
  files?: { url(hash: string): Promise<string | null>; blob?(hash: string): Promise<Blob | null> };
  /** 이미지 붙여넣기 · 끌어 놓기 — 앱이 첨부로 저장하고 이미지 블록을 만든다. at: 월드 좌표 */
  onImages?(files: File[], at: Vec2): void;
  /** 넣기 메뉴 '파일' — 종류와 상관없이 첨부 파일 블록으로 (사진도 원본 파일 그대로). at: 월드 좌표 */
  onFiles?(files: File[], at: Vec2): void;
  /** 넣기 메뉴 (빈 곳 오른쪽 클릭 · 캔버스에서 /) — 앱이 메뉴를 띄우고 고른 것을 insertBlock으로 */
  onInsertMenu?(req: InsertMenuRequest): void;
  /** 노트 설정 (11/03, 빈 곳 · 종이 오른쪽 클릭) — 있으면 넣기 메뉴 대신 이것. 넣기는 그 안의 '여기에 넣기'로 */
  onNoteMenu?(req: InsertMenuRequest): void;
  /** 그 자리에서 고칠 수 없는 콘텐츠(그래프)를 열 때 — 두 번 누르기 · 새로 넣기. 앱이 편집 창을 띄운다. tab 'style' = 모양(색 · 보기) 탭으로 */
  onEditContent?(blockId: Id, contentId: Id, tab?: 'style'): void;
  /** 음성 녹음 시작 (넣기 메뉴 · 슬래시 메뉴) — 녹음기는 앱이 갖는다. at: 녹음 블록을 놓을 월드 좌표 */
  onRecord?(at: Vec2): void;
  /** 댓글 창 (FR-132): 블록 댓글 보기 · 달기. draft는 고른 글에 막 단 표시(그 글에 대한 새 댓글) */
  onComments?(req: CommentRequest): void;
  /** 다른 노트로 옮기기 (/옮기기 · GAP #16) — 앱이 노트 고르기 창을 띄운다 */
  onMoveBlocks?(ids: Id[]): void;
  /** 고른 글 AI 편집 (FR-112) — 앱이 작성 도우미 창을 띄우고 결과를 그 글 칸에 넣는다 */
  onAiEdit?(req: AiEditRequest): void;
  /** 화살표 오른쪽 클릭 — 앱이 화살표 메뉴(관계 종류 · 라벨 · 지우기)를 띄운다 (v6) */
  onArrowMenu?(req: ArrowMenuRequest): void;
  /** 블록 임베드 (FR-082): 원본 블록 읽기 · 열기 */
  embeds?: EmbedHost;
  /** 웹 북마크 (FR-050): 주소의 제목 · 설명 · 그림 모으기 */
  web?: WebHost;
}

/** editing: 글 편집 중에 연 메뉴 (잘라내기 · 복사 · 붙여넣기를 함께) */
/** 블록 메뉴: 고른 상자들 · 띄울 자리(client px) · 글 편집 중 · 문서 뷰에서 열었나(닫으면 초점을 문서로) */
export interface BlockMenuRequest { ids: Id[]; x: number; y: number; editing?: boolean; doc?: boolean }
/** 화살표 메뉴: 고른 화살표들 · 띄울 자리(client px) */
export interface ArrowMenuRequest { ids: Id[]; x: number; y: number }
export interface CommentRequest { blockId: Id; x: number; y: number; draft?: { anchor: Id; quote: string } }
/** 고른 글 AI 편집: 글 칸 · 고른 범위(문서 위치) · 고를 때의 문서(바뀌었으면 넣지 않는다) · 창을 띄울 자리(client px) */
export interface AiEditRequest { contentId: Id; from: number; to: number; doc: TextDoc; x: number; y: number }
/** x · y: 메뉴를 띄울 자리(client px) · at: 넣을 월드 좌표(없으면 화면 가운데) */
export interface InsertMenuRequest { x: number; y: number; at?: Vec2 }

/** paste-scrubbed: 붙여넣은 HTML에서 실행될 수 있는 코드를 뺐다 · paste-unsupported: 붙여넣을 수 없는 형식 · paste-image: 이미지(이미지 블록은 P2) */
export type CanvasNotice = 'paste-scrubbed' | 'paste-unsupported' | 'paste-image' | 'paste-table-cut' | 'link-copied' | 'link-copy-failed' | 'table-sort-merged' | 'arrow-hidden' | 'pen-found';

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export type Gesture =
  | { k: 'none' }
  | { k: 'pan'; last: Vec2 }
  | { k: 'drag'; ids: Id[]; start: Vec2; delta: Vec2; moved: boolean; grip?: boolean; guides?: SnapGuide[]; ink?: boolean; /** 끌지 않고 떼면 초점을 줄 입력 칸 (데이터베이스 제목) */ click?: HTMLInputElement }
  /** 블록(묶음) 크기 조절: anchor(반대쪽 모서리) 기준 같은 배율 f */
  | { k: 'gscale'; ids: Id[]; start: Rect; anchor: Vec2; f: number }
  | { k: 'resize'; id: Id; handle: Handle; start: Rect; startW: Vec2; rect: Rect }
  | { k: 'marquee'; start: Vec2; cur: Vec2; additive: boolean; base: Set<Id>; inkBase?: Set<Id>; within?: ReadonlySet<Id> }
  /** 화살표 긋기 · 끝 옮기기 (arrow-input.ts) — start: 누른 자리(그냥 누른 것과 끈 것 가르기) */
  | { k: 'connect'; from: Anchor; cur: Vec2; target: Id | null; start: Vec2 }
  | { k: 'reconnect'; arrow: Id; end: 'from' | 'to'; cur: Vec2; target: Id | null; start: Vec2 }
  /** 빈 곳 화살표 몸통 끌기 — 점 끝만 움직인다 */
  | { k: 'amove'; arrow: Id; last: Vec2 }
  | { k: 'pinch'; dist: number; mid: Vec2 };

/** 블록 안 칸 하나 (제목 · 본문 · 모르는 콘텐츠) — 정적 렌더 또는 에디터가 들어간다 */
export interface Part {
  el: HTMLDivElement;
  contentId: Id;
  role: 'title' | 'body' | 'other';
  /** 마지막으로 정적 렌더한 문서 (같으면 다시 그리지 않음) */
  rendered: unknown;
}

export interface Mounted {
  el: HTMLDivElement;
  parts: Part[];
  editor: TextEditor | null;
  /** 에디터가 붙은 칸의 콘텐츠 id */
  editingPart: Id | null;
}

export type EditAt = { clientX: number; clientY: number } | 'start' | 'end';
