// 워크스페이스 상태의 모양 · 문구 · 순수 계산 (workspace.ts 계층이 같이 쓴다).
import { blockTextParts, isTextContent, textLines, type Content, type Engine, type NoteCover, type NotePage, type NoteSheet } from '@dn/engine-core';
import type { ArrowMenuRequest, BlockMenuRequest, CanvasNotice, CanvasUiState, CommentRequest, DocUiState, DocZoom, InsertMenuRequest } from '@dn/engine-dom';
import type { Folder, NoteMeta, SaveStatus, Tag } from '@dn/storage-idb';
import type { Account, LoginState } from './account';
import type { OcrState } from './ocr-flow';
import type { Snippet } from './snippets';
import { collectTodos } from './todos';
import type { SttState } from './stt-flow';
import type { AiEditState } from './ai-edit-flow';
import type { QaState } from './qa-flow';
import type { OutlineRow } from './side-outline';
import { chosung } from '@dn/text-pm';
import type { BlockKind, NoteRole } from '@dn/search';
import type { AiRun, AiSettings } from './ai';
import type { UserTemplate } from './templates';
import type { TodoItem } from './todos';
import type { ThemePref } from './theme';

export type NoteSort = 'updated' | 'title' | 'created';
/** home = 서재(모든 노트를 책으로) · me = 내 페이지(오늘 할 일 · 달력 · 저장 · 이번 주 · 태그 — 11/10에 홈에서 옮김) */
export type Page = 'note' | 'trash' | 'todos' | 'home' | 'me' | 'graph';
export type Dialog = { kind: 'consent' } | { kind: 'settings'; reason?: string } | { kind: 'templates' } | { kind: 'import' } | { kind: 'help' } | { kind: 'versions' } | { kind: 'export' }
  /** 그래프 고치기 (넣기 · 두 번 누르기 · 블록 메뉴) — tab 'style'이면 모양(색 · 보기) 탭부터 */
  | { kind: 'chart'; blockId: string; contentId: string; tab?: 'style' }
  /** 내 블록 이름 (SnippetName.tsx) — save: 저장할 상자들(양식 이름) · use: 넣을 내 블록(새 블록 이름) */
  | { kind: 'snippet'; name: string; save?: string[]; use?: string; at?: { x: number; y: number } };
/** 녹음 중 표시 (FR-043) */
export interface RecordingInfo { noteId: string; title: string; elapsedMs: number; paused: boolean; bytes: number }
/** 13 검색 · 빠른 전환 · 명령 팔레트 오버레이 (FR-121 · FR-087) */
export type Overlay = 'search' | 'switch' | 'command' | 'replace';
/** 검색 필터 (FR-122): 태그 · 최근 N일 안에 고친 노트 · 폴더(하위 포함) · 블록 종류 · AI가 만든 블록. 여러 개면 모두 만족 */
export interface SearchFilter { tagId?: string; days?: number; folderId?: string; kind?: BlockKind; ai?: boolean; roleId?: string }

/** 가져오기 선택: 대상 폴더('' 맨 위 · 폴더 id · '__new' 새 폴더) · 모두에 붙일 태그 · 같은 노트가 있을 때 */
export interface ImportOptions { target: string; tag?: string; conflict: 'skip' | 'copy' | 'merge' | 'replace' }

/** 노트를 놓을 자리: 폴더 안 · 다른 노트 아래 · 루트({}) */
/** sheet: 새 노트 용지 (화면의 '새 노트'는 설정값, 없으면 끝없는 캔버스) */
/** cover: 표지 쪽을 넣어 만든다 (11/09 — 화면의 '새 노트'는 늘, ws-base newNotePlace) */
export type NotePlace = { folderId?: string; parentNoteId?: string; sheet?: NoteSheet | null; cover?: boolean };
/** 붙여넣기 후 "구조화하기" 칩을 띄울 최소 길이 (공백 제외) — AI-PROMPTS 5절 최소 20자와 같게 */
export const CHIP_MIN_CHARS = 20;

export interface WorkspaceState {
  notes: NoteMeta[];
  trash: NoteMeta[];
  page: Page;
  sort: NoteSort;
  currentId: string | null;
  title: string;
  status: SaveStatus;
  ui: CanvasUiState | null;
  error: string | null;
  toast: Toast | null;
  blockMenu: BlockMenuRequest | null;
  /** 다른 노트로 옮기기 창 (GAP #16) — 옮길 상자들 */
  moveBlocks: string[] | null;
  /** 화살표 메뉴 (오른쪽 클릭 — 관계 종류 · 라벨 · 지우기, v6) */
  arrowMenu: ArrowMenuRequest | null;
  /** 넣기 메뉴 (툴바 ＋ · 빈 곳 오른쪽 클릭 · 캔버스에서 /) */
  insertMenu: InsertMenuRequest | null;
  /** 노트 설정 (11/03, 빈 곳 · 종이 오른쪽 클릭 — NoteMenu.tsx) */
  noteMenu: InsertMenuRequest | null;
  /** 댓글 창 (FR-132) */
  comments: CommentRequest | null;
  /** 옆에 연 노트 (FR-153) — 왼쪽(지금 노트) 몫 비율 */
  side: { noteId: string; ratio: number } | null;
  ai: AiSettings;
  aiRun: AiRun | null;
  /** 03 붙여넣기 → "구조화하기" 칩이 붙은 블록 */
  chip: string | null;
  dialog: Dialog | null;
  /** 이 노트의 할 일 — 완료 / 전체 (FR-033) */
  todos: { done: number; total: number };
  /** 휠 동작 (설정 › 편집, FR-011 · FR-143) */
  wheelMode: 'pan' | 'zoom';
  /** 화면에서 누르는 '새 노트'의 용지 (기본 A4 세로) */
  newNoteSheet: 'a4' | 'a4l' | 'none';
  /** 맞춤법 검사 (설정 › 편집, 기본 켬) */
  spellcheck: boolean;
  /** 블록 글자 크기 · 줄 간격 배율 (설정 › 편집, FR-143) */
  textScale: number;
  lineSpacing: number;
  /** 카메라가 움직일 때마다 증가 — 블록 옆에 붙은 칩 · 카드 위치를 다시 잡는다 */
  camTick: number;
  /** 폴더 (FR-073) · 태그 (FR-074) */
  folders: Folder[];
  tags: Tag[];
  /** 사이드바 태그 필터 — 이 태그가 달린 노트만 */
  tagFilter: string | null;
  /** 펼친 트리 항목 ('f:<폴더>' · 'n:<노트>' · 'tags') — 기기 설정 */
  expanded: Record<string, boolean>;
  overlay: Overlay | null;
  /** 검색 색인을 채우는 중 (앱을 처음 P3로 연 뒤 한 번) */
  indexing: { done: number; total: number } | null;
  /** 최근 연 노트 (빠른 전환 기본 목록) */
  recent: string[];
  /** 앱을 여는 중 — 끝나기 전에는 "노트 없음" 화면을 보이지 않는다 */
  booting: boolean;
  /** 오른쪽 노트 패널 — 노트 정보 (FR-071) · 백링크 (FR-081). 기기 설정 */
  panel: boolean;
  /** 테마 (FR-086) — 기기 설정 */
  theme: ThemePref;
  /** 읽기 모드 (FR-085): 사이드바 · 도구 · 핸들 숨김, 편집 안 됨 */
  readMode: boolean;
  /** 사이드바 접기 (Ctrl+\) — 기기 설정 */
  sidebarHidden: boolean;
  /** 잠금 금고 (FR-144): 없음 · 잠김 · 풀림 */
  vault: 'none' | 'locked' | 'open';
  /** 앱 잠금 (FR-145) — 켜짐 · 비활성 분 · 지금 잠김 */
  appLock: { enabled: boolean; minutes: number };
  appLocked: boolean;
  /** 금고를 풀어야 열 수 있는 노트 (잠긴 노트를 열려고 할 때) */
  unlockFor: string | null;
  /** 같은 노트를 연 다른 탭 수 · 이 탭의 역할 (FR-095 탭 동기화) */
  tabPeers: number;
  tabRole: 'writer' | 'guest' | 'readonly' | null;
  /** 음성 녹음 중 (FR-043) — 시작한 노트 · 경과 · 일시정지 */
  recording: RecordingInfo | null;
  /** 지금 노트의 아이콘 · 커버 (FR-070) */
  look: { icon?: string; cover?: NoteCover; page?: NotePage; sheet?: NoteSheet };
  /** 아래 도구 막대에 고정한 넣기 항목 (사진 · 표 … · 내 블록은 'snip:id') */
  toolbarPins: string[];
  /** 내 블록 — 넣기 메뉴에 저장한 상자 · 블록 사본 (이 기기) */
  snippets: Snippet[];
  /** 문서 뷰 서식 막대 상태 (워드처럼 고치기) · 쪽 보기 */
  docUi: DocUiState | null;
  docPages: boolean;
  /** 문서 뷰 확대: 정한 것(배율 · 쪽 너비 · 한 쪽) · 지금 배율 */
  docZoom: DocZoom;
  docZoomNow: number;
  /** 로그인한 계정 (없으면 로컬 전용) · 열린 로그인 창 단계 (account.ts) */
  account: Account | null;
  login: LoginState | null;
  /** 손글씨 → 글 미리보기 (ocr-flow.ts) */
  ocr: OcrState | null;
  /** 녹음 받아쓰기 (FR-044) */
  stt: SttState | null;
  /** 고른 글 AI 편집 — 작성 도우미 창 (ai-edit-flow.ts) */
  aiEdit: AiEditState | null;
  /** 노트에 묻기 패널 (qa-flow.ts) */
  qa: QaState | null;
  /** 사이드바 '열린 노트' — 탭처럼 연 순서 (ws-side.ts, 기기 설정 openTabs) */
  openTabs: string[];
  /** 사이드바 '이 노트' — 블록 ▸ 콘텐츠 나무 (side-outline.ts) */
  outline: { rows: OutlineRow[]; more: number };
  /** 캔버스 · 문서 뷰 (FR-088) — 기기 설정 */
  viewMode: 'canvas' | 'doc';
  /** 앱을 열 때 처음 화면 (설정 › 편집) */
  startPage: 'last' | 'home';
  /** 앱을 열 때의 보기 (FR-143): 마지막으로 쓴 보기 · 늘 캔버스 · 늘 문서 */
  defaultView: 'last' | 'canvas' | 'doc';
  /** 할 일 모아보기 (FR-137) — 페이지를 열 때 모은다 */
  todoList: TodoItem[] | null;
  todoLoading: boolean;
  /** 가져오기 진행률 (FR-127) */
  importRun: { done: number; total: number } | null;
  /** 마지막으로 모든 노트를 내보낸 시각 (설정 › 데이터) */
  lastExportAt: number | null;
  /** 사용자가 저장한 템플릿 (FR-078) */
  templates: UserTemplate[];
  /** 사용자가 만든 노트 역할 (기본 역할은 @dn/search BUILTIN_ROLES) — 노트에 묻기 범위 좁히기 */
  noteRoles: NoteRole[];
  /** 지금 노트에 블록이 하나도 없다 — 빈 캔버스 안내 (FR-148) */
  emptyCanvas: boolean;
  /** iPad · iPhone 브라우저에서 홈 화면 설치 안내 (FR-148 · D1) */
  installHint: boolean;
  /** "다시 열기" 배너 (ARCHITECTURE 9.3 · MSG-RECOVER-011). later: [나중에]로 닫을 수 있음 */
  reload: { text: string; later?: boolean } | null;
}

export interface Toast {
  id: number; text: string; action?: { label: string; run: () => void };
  /** 두 번째 단추 — AI 결과를 다른 모양으로 다시 정리 (NOTE-SHEET-PLAN NS-16) */
  alt?: { label: string; run: () => void };
}

export const INITIAL_STATE: WorkspaceState = {
  notes: [], trash: [], page: 'note', sort: 'updated', currentId: null, title: '', status: 'saved', ui: null, error: null, toast: null, blockMenu: null, moveBlocks: null, arrowMenu: null, insertMenu: null, noteMenu: null, comments: null, side: null,
  ai: { consent: false, consentAt: null, consentOld: false, model: '', kinds: [], keyLast4: null, keySource: null, effort: 'medium', autoTag: true }, aiRun: null, chip: null, dialog: null, camTick: 0, wheelMode: 'pan', newNoteSheet: 'a4', spellcheck: true,
  todos: { done: 0, total: 0 }, textScale: 1, lineSpacing: 1,
  folders: [], tags: [], tagFilter: null, expanded: {}, overlay: null, indexing: null, recent: [], booting: true, reload: null,
  panel: false, emptyCanvas: false, installHint: false, templates: [], noteRoles: [], lastExportAt: null, importRun: null, todoList: null, todoLoading: false, startPage: 'last', defaultView: 'last', viewMode: 'canvas', readMode: false, sidebarHidden: false, vault: 'none', appLock: { enabled: false, minutes: 5 }, appLocked: false, unlockFor: null, tabPeers: 0, tabRole: null, recording: null, look: {}, openTabs: [], outline: { rows: [], more: 0 }, toolbarPins: [], snippets: [], docUi: null, docPages: true, docZoom: 1, docZoomNow: 1, account: null, login: null, ocr: null, stt: null, aiEdit: null, qa: null, theme: 'system',
};

/** 캔버스 알림 문구 (MESSAGES 3.10) */
export const NOTICE: Record<CanvasNotice, string> = {
  'paste-scrubbed': '붙여넣은 내용에서 실행될 수 있는 코드를 빼고 넣었어요. 글자와 서식은 그대로예요.',
  'paste-unsupported': '이 형식은 붙여넣을 수 없어요. 텍스트나 이미지로 복사해 주세요.',
  'paste-image': '이미지 붙여넣기는 이미지 블록이 생기면 지원해요. 지금은 텍스트만 넣을 수 있어요.',
  'paste-table-cut': '표가 커서 500행 · 30열까지만 붙였어요. 나머지는 CSV로 가져오기를 써 주세요.',
  'link-copied': '블록 링크를 복사했어요. 다른 노트 캔버스에 붙여넣으면 그 블록이 임베드돼요.',
  'link-copy-failed': '링크를 복사하지 못했어요. 브라우저의 클립보드 권한을 확인해 주세요.',
  'table-sort-merged': '여러 행에 걸쳐 합친 칸이 있는 표는 정렬할 수 없어요. 칸을 나눈 뒤 정렬해 주세요.',
  'arrow-hidden': '붙어 있는 상자 사이 화살표는 화면에서 숨겨요. 상자를 떼면 라벨과 함께 다시 보여요.',
  'pen-found': '펜을 찾았어요 — 이제 펜으로만 쓰고 손가락은 화면 이동 · 확대예요. 필기 막대의 펜 전용 단추로 끌 수 있어요.',
};

export const SAVE_FAILED = '변경 내용을 저장하지 못했어요. 화면의 내용은 그대로 있으니 창을 닫지 말아 주세요. 곧 다시 저장할게요.';
export const STORAGE_FULL = '저장 공간이 가득 찼어요. 마지막으로 저장된 내용까지는 안전하고, 그 뒤의 변경은 지금 화면에만 있어요. 공간을 비우면 저절로 다시 저장해요.';

export const TRASH_DAYS = 30;
export const DAY = 86_400_000;

/** 목록에 보이는 이름: 제목 → 첫 블록 첫 줄 → '제목 없음' (FR-069) */
export function displayTitle(n: NoteMeta): string {
  return n.title.trim() || n.preview || '제목 없음';
}

/** 방금 · N분 전 · N시간 전 · 어제 · N일 전 · 날짜 */
export function ago(t: number, now = Date.now()): string {
  const s = Math.max(0, now - t) / 1000;
  if (s < 60) return '방금';
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  if (s < 2 * 86400) return '어제';
  if (s < 30 * 86400) return `${Math.floor(s / 86400)}일 전`;
  return new Date(t).toLocaleDateString('ko-KR');
}

/** 태그마다 붙은 노트 수 (사이드바 태그 · 내 페이지 태그 카드) */
export function tagCounts(notes: readonly NoteMeta[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const n of notes) for (const t of n.tagIds ?? []) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
}

/** 노트 이름 일치: 부분 문자열 또는 초성 (빠른 전환 · 노트 링크 자동완성) */
export function nameMatch(n: NoteMeta, q: string): boolean {
  const t = displayTitle(n).toLowerCase().replace(/\s+/g, '');
  const k = q.toLowerCase().replace(/\s+/g, '');
  return t.includes(k) || chosung(t).includes(k);
}

/** 찾는 말이 없을 때의 노트 목록: 최근 연 노트 먼저(연 차례), 나머지는 목록 차례 (빠른 전환 · 노트 링크 · 다른 노트로 옮기기) */
export function recentFirst(notes: readonly NoteMeta[], recent: readonly string[]): NoteMeta[] {
  const byId = new Map(notes.map((n) => [n.id, n])), seen = new Set(recent);
  return [...recent.map((id) => byId.get(id)).filter((n): n is NoteMeta => !!n), ...notes.filter((n) => !seen.has(n.id))];
}

/** 노트 정렬 고르기 (사이드바 폴더 · 서재 책 차례가 같은 설정) */
export const SORT_LABEL: Record<NoteSort, string> = { updated: '최근 수정순', title: '이름순', created: '생성순' };

export function sortNotes(list: NoteMeta[], sort: NoteSort): NoteMeta[] {
  const out = [...list];
  if (sort === 'title') out.sort((a, b) => displayTitle(a).localeCompare(displayTitle(b), 'ko'));
  else if (sort === 'created') out.sort((a, b) => b.createdAt - a.createdAt);
  else out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

/** 글자 수(공백 제외) · 낱말 수(띄어쓰기로 나눈 수) — 노트 정보와 문서 상태 줄이 같은 셈 */
export const textCount = (s: string) => ({ chars: s.replace(/\s/g, '').length, words: s.split(/\s+/).filter(Boolean).length });

/** 노트 정보 (FR-071): 블록 · 화살표 수, 글자 수(공백 제외) · 낱말 수 */
export function noteStats(engine: Engine): { blocks: number; arrows: number; chars: number; words: number } {
  let chars = 0, words = 0;
  for (const c of engine.contents()) {
    if (!isTextContent(c)) continue;
    for (const line of textLines(c.doc)) { const n = textCount(line); chars += n.chars; words += n.words; }
  }
  return { blocks: engine.blockCount, arrows: [...engine.arrows()].length, chars, words };
}

/** 노트의 할 일 항목 수 — 모아보기와 같은 규칙(AI 요약이 베낀 할 일은 한 번만, todos.ts) */
export function countTodos(engine: Engine): { done: number; total: number } {
  const items = collectTodos(engine);
  return { done: items.filter((x) => x.checked).length, total: items.length };
}

/** 읽기 순서(위 → 아래, 왼쪽 → 오른쪽)로 첫 블록의 첫 비어 있지 않은 줄 */
export function firstLine(engine: Engine): string {
  const blocks = [...engine.blocks()].sort((a, b) => a.y - b.y || a.x - b.x);
  for (const b of blocks) {
    const line = blockFirstLine(engine.contentsOf(b.id));
    if (line) return line.slice(0, 80);
  }
  return '';
}

/** 블록의 첫 비어 있지 않은 줄 (제목 → 본문 순, 앞뒤 공백 뺌). 없으면 '' */
export function blockFirstLine(contents: readonly Content[]): string {
  const { title, bodies } = blockTextParts(contents);
  return [title, ...bodies].flatMap((c) => (c ? textLines(c.doc) : [])).find((l) => l.trim())?.trim() ?? '';
}

/**
 * 노트 편집 잠금 (SYNC 3절, Web Locks `dn-note:<id>`). 저장 로그 키가 [noteId, seq]라 두 탭이 같은 노트를 쓰면
 * 같은 seq로 서로 덮어써 편집이 사라진다 — 잠금을 쥔 탭만 편집하고 나머지는 읽기 전용.
 * 잡으면 해제 함수, 다른 탭이 쥐고 있으면 null. Web Locks가 없는 브라우저는 예전처럼 편집(잠금 없음).
 */
export function tryLockNote(id: string): Promise<(() => void) | null> {
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (!locks) return Promise.resolve(() => {});
  return new Promise((resolve) => {
    void locks.request(`dn-note:${id}`, { ifAvailable: true }, (lock) => {
      if (!lock) { resolve(null); return; }
      return new Promise<void>((release) => resolve(() => release()));
    });
  });
}
