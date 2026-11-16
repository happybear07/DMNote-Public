// 사용자 커맨드 카탈로그 (ENGINE 5.2). 의미 규칙(연쇄 삭제 등)은 커맨드가 Op로 만든다.
import type { Engine, TxResult } from './engine';
import { findDockSpot, flowBelow, type PushDebt } from './dock';
import { sheetFits } from './sheet';
import { MIN_SIZE, q, unionRects, type Rect, type Vec2 } from './geom';
import { newId } from './id';
import { isBlockEnd, isBound, isTextContent, PAPER_COLORS, type AiProvenance, type Anchor, type BlockAnchor, type ArrowStyle, type BoxKind, type Content, type Id, type NoteCover, type NotePage, type Paper, type TextDoc } from './model';
import { bodyDoc, isBlankDoc, mergeTitleBody, titleDoc, toTitleDoc } from './text-doc';
import { keyBetween } from './order';
import { cloneBoundStrokes, strokesOfContent } from './ink-bind';
import { rehomeGroupEnds } from './group-anchor';
import { dbFiles } from './db-props';
import type { DbValue } from './database';

export const DEFAULT_BLOCK_W = 260;
export const DEFAULT_BLOCK_H = 84;
/** 제목 상자 기본 크기 — 한 줄이라 낮다. 높이는 측정(layout)이 맞춘다 */
export const DEFAULT_TITLE_W = 320;
export const DEFAULT_TITLE_H = 48;

/**
 * 텍스트 블록 만들기 (스키마 v3: 블록 = 제목 상자 또는 내용 상자, 텍스트 콘텐츠 하나).
 * - kind 'title': 제목 상자 — `title`(또는 `doc`을 한 줄로 편 것)
 * - kind 'text'(기본): 내용 상자 — `doc`, 없으면 `title`(제목3 줄) + `body`(문단들)
 */
export function createTextBlock(
  engine: Engine,
  at: Vec2,
  init: { kind?: BoxKind; title?: string; body?: string; doc?: TextDoc; w?: number; h?: number; label?: string } = {},
): TxResult<{ blockId: Id; contentId: Id }> {
  const kind = init.kind ?? 'text';
  return engine.transact((tx) => {
    const blockId = tx.createBlock({
      x: at.x, y: at.y, w: init.w ?? (kind === 'title' ? DEFAULT_TITLE_W : DEFAULT_BLOCK_W), h: init.h ?? (kind === 'title' ? DEFAULT_TITLE_H : DEFAULT_BLOCK_H),
    });
    const doc = kind === 'title'
      ? (init.doc ? toTitleDoc(init.doc) : titleDoc(init.title ?? ''))
      : init.doc ?? (init.title ? mergeTitleBody(titleDoc(init.title), bodyDoc(init.body ?? '')) : bodyDoc(init.body ?? ''));
    const contentId = tx.createContent({ blockId, type: 'text', role: kind === 'title' ? 'title' : 'body', doc });
    return { blockId, contentId };
  }, { origin: 'user', label: init.label ?? (kind === 'title' ? '제목 상자 만들기' : '내용 상자 만들기') });
}

/**
 * 상자 종류 바꾸기 (블록 메뉴). 내용 → 제목: 글자를 한 줄로 편다(줄바꿈 · 목록 구조는 사라지고 글자 · 서식은 남음).
 * 제목 → 내용: 문서 그대로 역할만 바꾼다. 다중 선택이면 전체를 한 트랜잭션(undo 한 번)으로.
 */
export function convertBoxes(engine: Engine, blockIds: readonly Id[], kind: BoxKind): TxResult<void> {
  return engine.transact((tx) => {
    for (const id of blockIds) {
      for (const c of engine.contentsOf(id)) {
        if (!isTextContent(c)) continue;
        const role = kind === 'title' ? 'title' : 'body';
        if ((c.role ?? 'body') === role) continue;
        tx.set('content', c.id, kind === 'title' ? { role, doc: toTitleDoc(c.doc) } : { role });
      }
    }
  }, { origin: 'user', label: kind === 'title' ? '제목 상자로 바꾸기' : '내용 상자로 바꾸기' });
}

export function moveBlocks(engine: Engine, ids: readonly Id[], dx: number, dy: number): TxResult<void> {
  return engine.transact((tx) => {
    for (const id of ids) {
      const b = engine.getBlock(id);
      if (!b) continue;
      tx.set('block', id, { x: b.x + dx, y: b.y + dy });
    }
  }, { origin: 'user', label: ids.length > 1 ? `블록 ${ids.length}개 이동` : '블록 이동' });
}

/** 리사이즈. 세로 크기를 바꾸면 그 높이를 최소 높이로 고정한다 (D6 추천안). */
export function resizeBlock(engine: Engine, id: Id, r: Rect, heightChanged: boolean): TxResult<void> {
  return engine.transact((tx) => {
    const w = Math.max(MIN_SIZE, r.w), h = Math.max(MIN_SIZE, r.h);
    const patch: Record<string, unknown> = { x: r.x, y: r.y, w };
    if (heightChanged) { patch.h = h; patch.minH = q(h); patch.sizing = 'fixed'; }
    tx.set('block', id, patch);
  }, { origin: 'user', label: '블록 크기 조절' });
}

/** 블록 · 화살표 (· 자유 잉크 획) 삭제. 블록에 딸린 콘텐츠와 연결 화살표도 함께 지운다 (FR-015, I1 · I2). 실행 취소 한 번 */
export function deleteEntities(engine: Engine, blockIds: readonly Id[], arrowIds: readonly Id[] = [], strokeIds: readonly Id[] = []): TxResult<void> {
  return engine.transact((tx) => {
    // 묶음 끝 화살표는 묶음에 남는 상자로 대표를 옮기고 남긴다 (v6)
    rehomeGroupEnds(engine, tx, new Set(blockIds));
    const arrows = new Set(arrowIds);
    for (const id of blockIds) for (const a of engine.arrowsOf(id)) arrows.add(a.id);
    for (const id of arrows) if (engine.getArrow(id)) tx.delete('arrow', id);
    for (const id of blockIds) {
      if (!engine.getBlock(id)) continue;
      for (const c of engine.contentsOf(id)) {
        for (const s of strokesOfContent(engine, c.id)) tx.delete('stroke', s.id);
        tx.delete('content', c.id);
      }
      tx.delete('block', id);
    }
    for (const id of strokeIds) if (engine.getStroke(id)) tx.delete('stroke', id);
  }, { origin: 'user', label: '삭제' });
}

/**
 * 복제: 블록 · 콘텐츠, 그리고 복제 대상끼리 잇는 화살표까지.
 * `dock`: 사본 묶음을 원본 묶음 옆 빈자리에 붙인다(겹침 없음, 상대 배치 유지). 아니면 `offset`만큼 어긋나게.
 */
export function duplicateBlocks(engine: Engine, ids: readonly Id[], offset = 24, opts: { dock?: boolean } = {}): TxResult<Id[]> {
  let dx = offset, dy = offset;
  if (opts.dock) {
    const rects = ids.map((id) => engine.blockRect(id)).filter((r): r is Rect => !!r);
    const u = unionRects(rects);
    if (u) {
      // 원본 바로 아래에 붙이는 자리부터 — 원본을 피해야 하므로 원본 자리에서 도킹을 시작한다
      const spot = findDockSpot(engine, u, new Set(), undefined, sheetFits(engine)); // 용지(A4)면 종이 안에서
      dx = spot.x - u.x; dy = spot.y - u.y;
    }
  }
  return engine.transact((tx) => {
    const map = new Map<Id, Id>();
    // 블록(묶음)째 복제하면 사본은 새 묶음으로. 묶음 안 상자 일부만이면 사본도 같은 묶음에 (상자 하나짜리 새 묶음이 생기던 것 — AT-006, 문서 뷰 복제와 같게)
    const groupCopy = new Map<Id, Id>();
    const picked = new Set(ids), all = [...engine.blocks()];
    const whole = (g: Id) => all.every((x) => x.group !== g || picked.has(x.id));
    let z = engine.topZ();
    for (const id of ids) {
      const b = engine.getBlock(id);
      if (!b) continue;
      z = keyBetween(z, null);
      if (b.group && !groupCopy.has(b.group) && whole(b.group)) groupCopy.set(b.group, newId());
      const nid = tx.createBlock({ ...b, id: newId(), z, x: b.x + dx, y: b.y + dy, group: b.group ? groupCopy.get(b.group) ?? b.group : undefined });
      map.set(id, nid);
      for (const c of engine.contentsOf(id)) {
        const cid = tx.createContent({ ...(structuredClone(c) as Content), id: newId(), blockId: nid } as never);
        for (const st of cloneBoundStrokes(engine, c.id, cid)) tx.apply({ k: 'create', e: 'stroke', id: st.id, value: st } as never);
      }
    }
    const seen = new Set<Id>();
    for (const id of ids) {
      for (const a of engine.arrowsOf(id)) {
        if (seen.has(a.id)) continue;
        seen.add(a.id);
        if (!isBound(a)) continue; // 빈 곳 화살표는 복제하지 않는다
        const f = map.get(a.from.blockId), t = map.get(a.to.blockId);
        // 묶음 끝(groupId)은 사본 묶음으로 — 묶음째 복제하지 않았으면 상자 끝으로 (v6)
        const end = (x: BlockAnchor, id: Id): Anchor => { const { groupId, ...r } = x; const g = groupId && groupCopy.get(groupId); return { ...r, blockId: id, ...(g ? { groupId: g } : {}) }; };
        if (f && t) tx.createArrow({ ...structuredClone(a), id: newId(), from: end(a.from, f), to: end(a.to, t) });
      }
    }
    return [...map.values()];
  }, { origin: 'user', label: '복제' });
}

export function bringToFront(engine: Engine, ids: readonly Id[]): TxResult<void> {
  return engine.transact((tx) => {
    let z = engine.topZ();
    for (const id of ids) {
      if (!engine.getBlock(id)) continue;
      z = keyBetween(z, null);
      tx.set('block', id, { z });
    }
  }, { origin: 'user', label: '맨 앞으로' });
}

/** style: 새로 긋는 화살표 모양(도구 막대에서 고른 것) — 없으면 관계 기본 모양 */
export function createArrow(engine: Engine, from: Anchor, to: Anchor, label?: string, style?: ArrowStyle): TxResult<Id> {
  return engine.transact((tx) => tx.createArrow({ from, to, ...(label ? { label } : {}), ...(style ? { style: { ...style } } : {}) }),
    { origin: 'user', label: '화살표 연결' });
}

export function reconnectArrow(engine: Engine, arrowId: Id, end: 'from' | 'to', anchor: Anchor): TxResult<void> {
  return engine.transact((tx) => tx.set('arrow', arrowId, { [end]: anchor }), { origin: 'user', label: '화살표 다시 연결' });
}

/** 빈 곳 화살표 옮기기 (11/09): 점 끝만 d만큼 — 상자에 붙은 끝은 그대로. 이어 끄는 움직임은 실행 취소 한 번으로 모인다 */
export function moveArrowPoints(engine: Engine, arrowId: Id, d: Vec2): TxResult<void> {
  return engine.transact((tx) => {
    const a = engine.getArrow(arrowId);
    if (!a || (!d.x && !d.y)) return;
    const patch: Record<string, unknown> = {};
    for (const end of ['from', 'to'] as const) { const an = a[end]; if (!isBlockEnd(an)) patch[end] = { point: { x: q(an.point.x + d.x), y: q(an.point.y + d.y) } }; }
    if (Object.keys(patch).length) tx.set('arrow', arrowId, patch);
  }, { origin: 'user', label: '화살표 옮기기', mergeKey: `arrow-move:${arrowId}` });
}

export function setArrowLabel(engine: Engine, arrowId: Id, label: string): TxResult<void> {
  return engine.transact((tx) => tx.set('arrow', arrowId, { label: label.trim() ? label.trim() : undefined }),
    { origin: 'user', label: '화살표 라벨' });
}

/** 텍스트 편집. 같은 콘텐츠의 연속 입력은 undo 한 번으로 묶인다. */
export function setText(engine: Engine, contentId: Id, doc: TextDoc): TxResult<void> {
  return engine.transact((tx) => tx.set('content', contentId, { doc }),
    { origin: 'text', label: '텍스트 입력', mergeKey: `text:${contentId}` });
}

/** 에디터 입력 (ProseMirror 스텝). 연속 입력은 undo 한 번으로 묶인다. */
export function editText(engine: Engine, contentId: Id, steps: readonly unknown[]): TxResult<void> {
  return engine.transact((tx) => {
    tx.text(contentId, steps);
    const c = engine.getContent(contentId), b = c && engine.getBlock(c.blockId);
    if (b?.draft && c && isTextContent(c) && !isBlankDoc(c.doc)) tx.set('block', b.id, { draft: undefined }); // 글이 들어오면 캔버스에 나타난다
  },
    // 서식만 바꾼 변경(글자 표시 걸기 · 지우기, 제목 · 인용 · 스타일처럼 문단 모양 바꾸기)은 앞뒤 입력과 묶지 않는다 —
    // Ctrl+Z 한 번에 친 글까지 되돌아가지 않게 (DQ-027)
    { origin: 'text', label: '텍스트 입력', ...(formatOnly(steps) ? {} : { mergeKey: `text:${contentId}` }) });
}

/** 글자는 그대로 두고 모양만: 표시(addMark · removeMark) · 감싸기 · 풀기 · 문단 종류(replaceAround) */
const FORMAT_STEPS = new Set(['addMark', 'removeMark', 'replaceAround']);
const formatOnly = (steps: readonly unknown[]) => steps.length > 0 && steps.every((s) => FORMAT_STEPS.has((s as { stepType?: string }).stepType ?? ''));

/** 여러 콘텐츠에 스텝을 한 트랜잭션으로 (블록 메뉴의 타입 전환 — 다중 선택도 undo 한 번). */
export function editTexts(engine: Engine, edits: readonly { contentId: Id; steps: readonly unknown[] }[], label = '블록 타입 전환'): TxResult<void> {
  return engine.transact((tx) => { for (const e of edits) if (e.steps.length) tx.text(e.contentId, e.steps); },
    { origin: 'user', label });
}

/**
 * AI가 쓴 글을 글 상자에 넣기 (작성 도우미 — 바꾸기 · 이어 쓰기 · 빈 상자 초안): 글 스텝과 함께 그 콘텐츠에 AI 출처를 남긴다
 * (10/29 교차 검토 C3 · A11 — 안 남기면 학습 데이터에서 사람 글로 셌다). 사람이 쓴 글에 섞이면 editedAt을 찍어 'AI + 사람'(*_edited),
 * 빈 상자를 AI 글로만 채우면 editedAt 없이 블록에도 출처(AI 테두리). 이미 출처가 있으면 그대로 두고 고친 시각만. 실행 취소 한 번
 */
export function applyAiText(engine: Engine, contentId: Id, steps: readonly unknown[], ai: AiProvenance, label: string, now = Date.now()): TxResult<void> {
  return engine.transact((tx) => {
    const c = engine.getContent(contentId);
    if (!c || !isTextContent(c)) return tx.fail('글 상자가 없어요');
    const blank = isBlankDoc(c.doc);
    tx.text(contentId, steps);
    tx.set('content', contentId, { ai: c.ai ? { ...c.ai, editedAt: now } : blank ? ai : { ...ai, editedAt: now } });
    const b = engine.getBlock(c.blockId);
    if (blank && b && !b.ai && engine.contentsOf(b.id).every((x) => x.id === contentId || (isTextContent(x) && isBlankDoc(x.doc)))) tx.set('block', b.id, { ai });
  }, { origin: 'ai', label }); // 'ai' 출처: 사람 고침 표시(stampEdits)를 이 넣기에 찍지 않는다 — 섞인 것은 위에서 직접
}

/** 선택한 글을 새 블록으로 분리 (FR-017): 원본에서 지우기 + 새 블록 만들기를 undo 한 번으로. */
export function extractToBlock(
  engine: Engine, contentId: Id, deleteSteps: readonly unknown[], doc: TextDoc, at: Vec2, w = DEFAULT_BLOCK_W,
): TxResult<{ blockId: Id; contentId: Id }> {
  return engine.transact((tx) => {
    tx.text(contentId, deleteSteps);
    const blockId = tx.createBlock({ x: q(at.x), y: q(at.y), w, h: DEFAULT_BLOCK_H });
    // 떼어 낸 글은 서식 그대로 새 내용 상자로
    const cid = tx.createContent({ blockId, type: 'text', role: 'body', doc });
    return { blockId, contentId: cid };
  }, { origin: 'user', label: '블록으로 분리' });
}

/** 블록 배경색. undefined면 기본색 (FR-024 블록 메뉴). */
export function setBlockColor(engine: Engine, ids: readonly Id[], color: string | undefined): TxResult<void> {
  return engine.transact((tx) => {
    for (const id of ids) {
      const b = engine.getBlock(id);
      if (b) tx.set('block', id, { style: color ? { ...b.style, color } : undefined });
    }
  }, { origin: 'user', label: '블록 색상' });
}

export function setNoteTitle(engine: Engine, title: string): TxResult<void> {
  return engine.transact((tx) => tx.setNote({ title }), { origin: 'user', label: '제목 변경', mergeKey: 'note-title' });
}

const pushDebts = new WeakMap<Engine, PushDebt>();
/** 측정된 블록 높이 반영 — undo 밖 (ENGINE 10.2). 글이 늘어 닿는 아래 상자는 레고처럼 함께 내리고, 줄면 내린 만큼 되돌린다 (AT-020 · dock.ts flowBelow) */
export function applyMeasuredHeights(engine: Engine, heights: ReadonlyMap<Id, number>): TxResult<void> {
  let debt = pushDebts.get(engine);
  if (!debt) pushDebts.set(engine, (debt = new Map()));
  const at = new Map<Id, Rect>();
  // 자리부터 다 셈한 뒤 한꺼번에 쓴다 — tx.set은 바로 엔진에 들어가고, flowBelow는 옮기기 전 자리로 위아래를 가린다
  for (const [id, h] of heights) {
    const b = engine.getBlock(id), nh = Math.max(MIN_SIZE, h);
    if (b && Math.abs(nh - b.h) >= 0.5) flowBelow(engine, id, at.get(id) ?? b, nh, at, debt);
  }
  return engine.transact((tx) => {
    for (const [id, r] of at) {
      const b = engine.getBlock(id);
      if (!b) continue;
      const dy = Math.abs(b.y - r.y) >= 0.01, dh = Math.abs(b.h - r.h) >= 0.01;
      if (dy || dh) tx.set('block', id, { ...(dy ? { y: r.y } : {}), ...(dh ? { h: r.h } : {}) });
    }
  }, { origin: 'layout', undoable: false });
}

/** 노트 배경 (FR-041) — 실행 취소 한 번 */
export function setNotePaper(engine: Engine, paper: Paper): TxResult<void> {
  const color = paper.color && PAPER_COLORS.includes(paper.color) ? paper.color : undefined;
  return engine.transact((tx) => tx.setNote({ paper: { kind: paper.kind, gap: Math.max(8, Math.min(96, Math.round(paper.gap))), ...(color ? { color } : {}) } }), { origin: 'user', label: '배경 바꾸기' });
}

/** 페이지 표시 옵션 (FR-072) — 바꾼 것만 넘긴다. 실행 취소 한 번 */
export function setNotePage(engine: Engine, patch: NotePage): TxResult<void> {
  const next: Record<string, boolean> = { ...(engine.note.page ?? {}) };
  for (const [k, v] of Object.entries(patch)) { if (v) next[k] = true; else delete next[k]; }
  const label = patch.editLock !== undefined ? (patch.editLock ? '편집 잠금' : '편집 잠금 풀기') : '페이지 표시';
  return engine.transact((tx) => tx.setNote({ page: Object.keys(next).length ? next : undefined }), { origin: 'user', label });
}

/** 노트 아이콘 (FR-070) — 빈 값이면 없앤다 */
/** 노트 역할 정하기 (회의록 등 — 노트에 묻기 범위). null이면 지움(앱이 다시 추정) — 실행 취소 한 번 */
export function setNoteRole(engine: Engine, role: string | null): TxResult<void> {
  const v = role?.trim().slice(0, 40) || undefined;
  return engine.transact((tx) => tx.setNote({ role: v }), { origin: 'user', label: v ? '노트 역할 정하기' : '노트 역할 지우기' });
}

export function setNoteIcon(engine: Engine, icon: string | null): TxResult<void> {
  const v = icon?.trim().slice(0, 40) || undefined;
  return engine.transact((tx) => tx.setNote({ icon: v }), { origin: 'user', label: v ? '아이콘 바꾸기' : '아이콘 없애기' });
}

/** 커버 이미지 (FR-070) — null이면 없앤다. 위치만 바꿀 때는 끌기 한 번이 실행 취소 한 번(mergeKey) */
export function setNoteCover(engine: Engine, cover: NoteCover | null, opts: { mergeKey?: string } = {}): TxResult<void> {
  const v = cover ? { attachment: cover.attachment, pos: Math.max(0, Math.min(100, Math.round(cover.pos))) } : undefined;
  return engine.transact((tx) => tx.setNote({ cover: v }), {
    origin: 'user', label: v ? (engine.note.cover?.attachment === v.attachment ? '커버 위치' : '커버 바꾸기') : '커버 없애기', ...(opts.mergeKey ? { mergeKey: opts.mergeKey } : {}),
  });
}

/** 노트가 쓰는 첨부 (이미지 · 파일 · 커버) — 백업 · 내보내기가 함께 담는다. 파일이면 이름도 */
export function noteAttachments(engine: Engine): { hash: string; name?: string }[] {
  const out = new Map<string, string | undefined>();
  for (const c of engine.contents()) {
    // 데이터베이스 파일 속성 · 버튼이 넣을 상자 속 그림 · 파일도 (백업 · 내보내기가 빠뜨리지 않게)
    if (c.type === 'database') for (const r of (c as { rows?: { values: Record<string, DbValue> }[] }).rows ?? []) for (const v of Object.values(r.values)) for (const f of dbFiles(v)) if (!out.has(f.hash)) out.set(f.hash, f.name);
    if (c.type === 'button') for (const b of (c as { clip?: { blocks?: { contents?: Record<string, unknown>[] }[] } }).clip?.blocks ?? []) for (const x of b.contents ?? []) if (typeof x.attachment === 'string' && !out.has(x.attachment)) out.set(x.attachment, typeof x.name === 'string' ? x.name : undefined);
    const a = (c as { attachment?: unknown }).attachment;
    if (typeof a !== 'string' || (c.type !== 'image' && c.type !== 'file')) continue;
    const name = c.type === 'file' ? String((c as { name?: unknown }).name ?? '') : undefined;
    if (!out.has(a) || name) out.set(a, name);
  }
  const cover = engine.note.cover?.attachment;
  if (cover && !out.has(cover)) out.set(cover, undefined);
  return [...out].map(([hash, name]) => (name ? { hash, name } : { hash }));
}

/** 노트 내용 통째로 바꾸기 (버전 되돌리기 FR-093 · 백업으로 바꾸기 FR-092) — 실행 취소 한 번. 노트 id는 그대로 */
export function replaceNoteContent(engine: Engine, src: Engine, label = '내용 바꾸기'): TxResult<void> {
  return engine.transact((tx) => {
    for (const a of [...engine.arrows()]) tx.delete('arrow', a.id);
    for (const s of [...engine.strokes()]) tx.delete('stroke', s.id);
    for (const b of [...engine.blocks()]) { for (const c of engine.contentsOf(b.id)) tx.delete('content', c.id); tx.delete('block', b.id); }
    for (const b of src.blocks()) tx.createBlock({ ...b });
    for (const c of src.contents()) tx.createContent({ ...c } as never);
    for (const a of src.arrows()) tx.createArrow({ ...a });
    for (const s of src.strokes()) tx.apply({ k: 'create', e: 'stroke', id: s.id, value: s } as never);
    tx.setNote({ title: src.note.title, ...(src.note.paper ? { paper: src.note.paper } : {}) });
  }, { origin: 'user', label });
}

/** 동기화 충돌 블록 정하기 (FR-097): 남기기 = 표시만 지움, 지우기 = 블록 삭제. 실행 취소 한 번 */
export function resolveConflict(engine: Engine, blockId: Id, keep: boolean): TxResult<void> {
  if (!keep) return deleteEntities(engine, [blockId]);
  // 남기기는 실행 취소 기록에 넣지 않는다 — 묘비로 보류된 블록은 남기기가 묘비를 지우는 일이라(@dn/sync), 되돌리면 conflict만
  // 일반 필드로 다시 써져 묘비 없는 충돌 표시가 된다. 남긴 뒤 마음이 바뀌면 지우기를 고르면 된다
  return engine.transact((tx) => { if (engine.getBlock(blockId)?.conflict) tx.set('block', blockId, { conflict: undefined }); }, { origin: 'user', label: '충돌 블록 남기기', undoable: false });
}
