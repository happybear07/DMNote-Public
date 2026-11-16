// 새로 넣기 (넣기 메뉴 · 슬래시 메뉴 · 빈 곳 오른쪽 클릭): 표 · 그래프 · 데이터베이스 · 사진 · 파일, 그리고
// 수식 · 코드 · 할 일처럼 서식으로 시작하는 글 상자를 만들고 바로 고칠 수 있게 연다(표는 첫 열 이름, 그래프는 데이터 창, 글은 에디터).
// 자리: 지정한 월드 좌표(오른쪽 클릭한 곳) → 편집하던 블록 바로 아래 → 화면 가운데 순. 겹치면 가장 가까운 빈자리(placeNew).
import { addDbView, createDatabaseBlock, createEmbedBlock, createTextBlock, createWebBlock, deleteEntities, isBlankDoc, isTextContent, parseBlockLink, makeChart, screenToWorld, webBlockSize, DEFAULT_BLOCK_H, DEFAULT_BLOCK_W, DEFAULT_TITLE_H, DEFAULT_TITLE_W, DOCK_GAP, type Id, type TxResult, type Vec2, type WebView, BUTTON_SIZE, createButtonBlock, createTabsBlock, createDivider, DIVIDER_THICK } from '@dn/engine-core';
import type { FormatCommand } from '@dn/text-pm';
import { pickTableSize, sizedTable, tableBlockSize, type TableSize } from './table-picker';
import type { CanvasView } from './canvas-view';
import { placeNew } from './create';
import { startHeaderEdit } from './table-edit';

/** 서식으로 시작하는 내용 상자 → 에디터 명령 (슬래시 메뉴와 같은 명령) */
const TEXT_CMD: Partial<Record<InsertKind, FormatCommand>> = {
  math: 'math', code: 'code_block', task: 'task', bullet: 'bullet', ordered: 'ordered', callout: 'callout', quote: 'quote', toggle: 'toggle', divider: 'divider',
};

const INSERT_KINDS = [
  'text', 'title', 'image', 'video', 'audio', 'file', 'record', 'table', 'chart', 'database', 'db-board', 'db-calendar', 'db-gallery', 'db-list', 'db-timeline', 'db-chart', 'columns-2', 'columns-3', 'columns-4', 'columns-5', 'toc', 'button', 'tabs', 'embed', 'bookmark', 'web-embed', 'math', 'code', 'task', 'bullet', 'ordered', 'callout', 'quote', 'toggle', 'divider', 'line-h', 'line-v',
] as const;
export type InsertKind = (typeof INSERT_KINDS)[number];

export function isInsertKind(s: string): s is InsertKind { return (INSERT_KINDS as readonly string[]).includes(s); }

export interface InsertWhere {
  /** 이 월드 좌표에 (왼쪽 위) */
  at?: Vec2;
  /** 이 블록 바로 아래에 */
  below?: Id;
  /** 표: 고른 크기 (없으면 크기 고르기 창부터) */
  size?: TableSize;
  /** 크기 고르기 창을 띄울 화면 좌표 */
  anchor?: { x: number; y: number };
  /** 열 나누기: 나눌 전체 폭 (문서 뷰는 지금 문단 폭) */
  width?: number;
}

/** 만든 블록을 고르고 (focus면 키보드도 캔버스로) 그 id */
function selectNew(view: CanvasView, r: TxResult<Id>, focus: boolean): Id | null {
  if (!r.ok) return null;
  view.select([r.value]);
  if (focus) view.root.focus({ preventScroll: true });
  return r.value;
}

/** 새 블록 왼쪽 위 자리 */
function spot(view: CanvasView, w: number, h: number, where: InsertWhere): Vec2 {
  if (where.at) return placeNew(view, { x: where.at.x, y: where.at.y, w, h });
  const src = where.below ? view.engine.getBlock(where.below) : undefined;
  if (src) return placeNew(view, { x: src.x, y: src.y + src.h + DOCK_GAP, w, h });
  const c = screenToWorld(view.cam, { x: view.size.w / 2, y: view.size.h / 2 });
  return placeNew(view, { x: c.x - w / 2, y: c.y - h / 2, w, h });
}

/**
 * 노션 /2열 ~ /5열: 빈 글 상자 n개를 한 줄에 나란히 — 같은 줄의 상자는 문서 뷰에서 좌우 칸이 된다(FR-049, doc-columns.ts).
 * 폭은 기준(문서 문단 폭 · 아래에 넣을 상자 폭)을 n으로 나눈다. 비어 있어도 남는다(초안 아님 — 칸 모양을 지키게). 첫 칸 id
 */
function insertColumns(view: CanvasView, n: number, where: InsertWhere): Id | null {
  const e = view.engine, src = where.below ? e.getBlock(where.below) : undefined;
  const total = Math.max(n * 140, where.width ?? src?.w ?? DEFAULT_BLOCK_W * 2);
  const w = Math.floor((total - DOCK_GAP * (n - 1)) / n);
  const p = spot(view, total, DEFAULT_BLOCK_H, where);
  const r = e.transact((tx) => Array.from({ length: n }, (_, i) => {
    const blockId = tx.createBlock({ x: p.x + i * (w + DOCK_GAP), y: p.y, w, h: DEFAULT_BLOCK_H });
    tx.createContent({ blockId, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'paragraph' }] } });
    return blockId;
  }), { origin: 'user', label: `${n}열` });
  if (!r.ok) return null;
  view.select(r.value);
  if (!where.at) view.startEditing(r.value[0]!, 'start'); // 문서 뷰(at)는 문서 쪽에서 연다
  return r.value[0]!;
}

/** 붙여넣은 주소 › 북마크 · 임베드 (FR-050): 주소만 있던 글 상자가 비었으면 그 자리를 대신하고, 아니면 바로 아래에 */
export function insertWeb(view: CanvasView, url: string, v: WebView, from: Id): Id | null {
  const e = view.engine, src = e.getBlock(from);
  if (!src || view.readOnly) return null;
  const blank = takeBlank(view, from);
  const size = webBlockSize(url, v);
  const r = createWebBlock(e, blank ? placeNew(view, { x: src.x, y: src.y, ...size }) : spot(view, size.w, size.h, { below: from }), url, v);
  if (!r.ok) return null;
  view.select([r.value.blockId]);
  return r.value.blockId;
}

/**
 * 빈 글 상자에서 고른 넣기(슬래시 /표 · /목차 · 붙여넣기 › 북마크 …)는 노션처럼 그 상자 자리를 대신한다 — 상자를 지우고 true.
 * 글이 있거나, 화살표 · 묶음에 걸린 상자는 그대로 두고 false (그때는 바로 아래에 넣는다). 편집은 끝낸다
 */
function takeBlank(view: CanvasView, from: Id): boolean {
  const e = view.engine, src = e.getBlock(from);
  const blank = !!src && !src.group && !e.arrowsOf(from).length && e.contentsOf(from).every((c) => isTextContent(c) && isBlankDoc(c.doc));
  view.endEditing();
  if (blank) deleteEntities(e, [from]);
  return blank;
}

/** 슬래시 메뉴의 넣기: 빈 상자에서면 그 자리에, 글이 있으면 바로 아래에. 새 블록 id (파일 고르기 등은 null) */
export function insertFromSlash(view: CanvasView, kind: InsertKind, from: Id): Id | null {
  const src = view.engine.getBlock(from);
  if (!src || view.readOnly) return null;
  const cols = kind.startsWith('columns-');
  if (!takeBlank(view, from)) return insertBlock(view, kind, { below: from });
  const id = insertBlock(view, kind, { at: { x: src.x, y: src.y }, ...(cols ? { width: src.w } : {}) });
  if (id && cols) view.startEditing(id, 'start'); // 열 나누기: 첫 칸에서 바로 쓴다 (at이 있으면 insertBlock은 열지 않는다)
  return id;
}

/** 막 만든 웹 블록의 주소 칸으로 (다음 그리기 뒤) */
export function focusWebInput(at: () => HTMLElement | undefined): void {
  requestAnimationFrame(() => requestAnimationFrame(() => at()?.querySelector<HTMLInputElement>('.dn-web-input input')?.focus()));
}

/** 파일 고르기 창. 고르지 않고 닫으면 아무 일도 없다 */
function pickFiles(accept: string, done: (files: File[]) => void): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  if (accept) input.accept = accept;
  input.hidden = true;
  const cleanup = () => input.remove();
  input.addEventListener('change', () => { const f = [...(input.files ?? [])]; cleanup(); if (f.length) done(f); });
  input.addEventListener('cancel', cleanup);
  document.body.appendChild(input);
  input.click();
}

/**
 * 블록 하나를 넣고 고칠 준비까지. 새 블록 id (사진 · 파일은 고르기 창이 끝난 뒤 앱이 만들어서 null).
 * 블록 만들기는 실행 취소 한 번 — 서식 글 상자는 만들기 + 서식 두 단계다(슬래시 메뉴로 바꾼 것과 같게).
 */
export function insertBlock(view: CanvasView, kind: InsertKind, where: InsertWhere = {}): Id | null {
  if (view.readOnly) return null;
  view.endEditing();
  const e = view.engine;
  if (kind === 'image' || kind === 'file' || kind === 'video' || kind === 'audio') {
    const at = spot(view, 320, 200, where);
    // 동영상 · 오디오는 파일 블록 — 앱이 재생 블록으로 그린다
    pickFiles(kind === 'file' ? '' : `${kind}/*`, (files) => (kind === 'image' ? view.host.onImages : view.host.onFiles)?.(files, at));
    return null;
  }
  if (kind === 'record') { view.host.onRecord?.(spot(view, 360, 112, where)); return null; }
  if (kind === 'embed') {
    // 블록 링크를 받아 그 블록 임베드 (블록 메뉴 › 블록 링크 복사 → 여기에 붙여넣기)
    const link = window.prompt('임베드할 블록의 링크를 붙여넣어 주세요 (블록 메뉴 › 블록 링크 복사)');
    const ref = link ? parseBlockLink(link) : null;
    if (!ref) { if (link) view.host.onNotice?.('paste-unsupported'); return null; }
    return selectNew(view, createEmbedBlock(e, spot(view, 360, 120, where), ref), false);
  }
  if (kind === 'bookmark' || kind === 'web-embed') {
    // 웹 북마크 · 임베드 (FR-050 · FR-051): 주소 넣기 칸이 있는 블록 — 칸에 바로 쓴다(문서 뷰에서는 문서 쪽 칸으로)
    const v = kind === 'bookmark' ? 'bookmark' : 'embed', size = webBlockSize('', v);
    const r = createWebBlock(e, spot(view, size.w, size.h, where), '', v);
    if (!r.ok) return null;
    view.select([r.value.blockId]);
    focusWebInput(() => view.mounted.get(r.value.blockId)?.el);
    return r.value.blockId;
  }
  // 구분선 (노트형 NS-01): 캔버스 선 — 가로는 구역, 세로는 VS · 열 나누기. (글 안 가로줄은 'divider' — 서식 상자)
  if (kind === 'line-h' || kind === 'line-v') {
    const v = kind === 'line-v', p = spot(view, v ? DIVIDER_THICK : 360, v ? 200 : DIVIDER_THICK, where);
    const r = createDivider(e, p, v ? 'v' : 'h');
    return r.ok ? selectNew(view, { ...r, value: r.value.blockId }, false) : null;
  }
  if (kind === 'toc') {
    const p = spot(view, 300, 160, where);
    const r = e.transact((tx) => { const blockId = tx.createBlock({ x: p.x, y: p.y, w: 300, h: 160 }); tx.createContent({ blockId, type: 'toc' }); return blockId; },
      { origin: 'user', label: '목차 넣기' });
    return selectNew(view, r, true);
  }
  if (kind === 'tabs') return selectNew(view, createTabsBlock(e, spot(view, 420, 120, where)), false); // 탭 (GAP #17)
  if (kind === 'button') return selectNew(view, createButtonBlock(e, spot(view, BUTTON_SIZE.w, BUTTON_SIZE.h, where)), false); // 버튼 (GAP #17) — 넣을 내용은 ⋯에서
  if (kind === 'database') return selectNew(view, createDatabaseBlock(e, spot(view, 540, 220, where)), true);
  if (kind.startsWith('columns-')) return insertColumns(view, Number(kind.slice(8)), where);
  if (kind.startsWith('db-')) {
    // 보드 · 캘린더 · 갤러리 · 리스트로 보이는 데이터베이스 (노션 /board …)
    const r = createDatabaseBlock(e, spot(view, 540, 220, where));
    const cid = r.ok ? e.contentsOf(r.value)[0]?.id : undefined;
    if (cid) addDbView(e, cid, kind.slice(3) as 'board' | 'calendar' | 'gallery' | 'list' | 'timeline' | 'chart');
    return selectNew(view, r, true);
  }
  if (kind === 'table' && !where.size) { const { size: _s, ...rest } = where; pickTableSize((size) => insertBlock(view, 'table', { ...rest, size }), where.anchor); return null; }
  if (kind === 'table' || kind === 'chart') {
    const table = kind === 'table' ? sizedTable(where.size!) : null;
    const data = table ? { type: 'table' as const, ...table }
      : { type: 'chart' as const, ...makeChart('bar', [{ name: '계열 1', points: [{ x: '항목 1', y: 3 }, { x: '항목 2', y: 5 }, { x: '항목 3', y: 2 }] }], '새 그래프') };
    const size = table ? tableBlockSize(where.size!) : { w: 360, h: 280 };
    const p = spot(view, size.w, size.h, where);
    const r = e.transact((tx) => {
      const blockId = tx.createBlock({ x: p.x, y: p.y, ...size });
      return { blockId, contentId: tx.createContent({ blockId, ...data }) };
    }, { origin: 'user', label: table ? '표 넣기' : '그래프 넣기' });
    if (!r.ok) return null;
    const { blockId, contentId } = r.value;
    view.select([blockId]);
    // 표: 다음 그리기(머리글 DOM이 생긴 뒤)에 첫 열 이름부터 고친다. 그래프: 앱이 데이터 창을 연다
    if (table) requestAnimationFrame(() => requestAnimationFrame(() => startHeaderEdit(view, blockId, contentId, table.columns[0]!.id)));
    else view.host.onEditContent?.(blockId, contentId);
    return blockId;
  }
  const title = kind === 'title';
  const r = createTextBlock(e, spot(view, title ? DEFAULT_TITLE_W : DEFAULT_BLOCK_W, title ? DEFAULT_TITLE_H : DEFAULT_BLOCK_H, where), { kind: title ? 'title' : 'text' });
  if (!r.ok) return null;
  const { blockId } = r.value;
  view.select([blockId]);
  view.startEditing(blockId, 'start');
  const cmd = TEXT_CMD[kind];
  if (cmd) view.mounted.get(blockId)?.editor?.exec(cmd);
  return blockId;
}
