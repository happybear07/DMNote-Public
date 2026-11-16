// 문서 뷰를 워드처럼 (FR-088): 글 상자 나누기(Enter) · 합치기(Backspace · Delete) · 끝에 새 상자 · 쪽 나눔(Ctrl+Enter).
// 저장은 그대로 상자 단위 — 캔버스도 같이 바뀐다. 새 상자가 끼어들면 그 아래 상자들을 그만큼 내려서 캔버스에서도 겹치지 않고,
// 읽는 순서(위 → 아래)가 문서 순서와 같게 남는다. 모두 실행 취소 한 번.
import type { Engine, Tx, TxResult } from './engine';
import { endBlock, isTextContent, type AiProvenance, type Block, type BlockAnchor, type Id, type TextDoc } from './model';
import { isStroke, strokeBounds } from './ink';
import { contentBottom, pageAt, pageY, sheetGeom, SHEET_PAD } from './sheet';
import { isBlankDoc } from './text-doc';
import { q } from './geom';
import { DOCK_GAP, findDockSpot } from './dock';
import { newId } from './id';
import { documentOrder } from './flow';
import { clipHeight, createFromClip, type BlockClip } from './clip';
import { strokesOfContent } from './ink-bind';
import { deleteEntities } from './commands';
import { bridgeChains, docDropTarget, joinUnit, reorderForMove } from './doc-units';
import { rehomeGroupEnds } from './group-anchor';

/** 문서 뷰에서 위아래 상자 사이 간격 (월드 px) */
export const DOC_GAP = 16;

/**
 * b 바로 아래에 높이 h짜리 자리를 만든다: 아래 상자들(위쪽 모서리가 b 바닥 이상)을 겹치지 않을 만큼만 내린다.
 * curH: b의 지금 높이(측정값) — 문서 뷰에서 고친 상자는 모델 높이가 늦을 수 있다. 새 자리의 위쪽 y를 돌려준다.
 */
function openGap(engine: Engine, tx: Tx, b: Block, h: number, curH?: number, skip?: ReadonlySet<Id>, room?: DocRoom): number {
  const below = [...engine.blocks()].filter((x) => x.id !== b.id && x.y >= b.y + b.h - 1 && !skip?.has(x.id));
  const bh = curH ? Math.max(24, q(curH)) : b.h;
  if (curH && b.sizing === 'auto' && bh !== b.h) tx.set('block', b.id, { h: bh });
  const top = b.y + bh + DOC_GAP;
  const first = below.reduce((m, x) => Math.min(m, x.y), Infinity);
  const dy = Number.isFinite(first) ? Math.max(0, top + h + DOC_GAP - first) : 0;
  if (dy) for (const x of below) tx.set('block', x.id, { y: x.y + dy });
  if (room && dy) { room.ids = below.map((x) => x.id); room.dy = dy; }
  return top;
}

/** 새 초안 자리를 내느라 내린 아래 상자들 · 내린 만큼 — 글 없이 떠나면 되올린다 (discardIfEmpty) */
export interface DocRoom { ids: Id[]; dy: number }

/** 글자 모양(크기 · 색 · 정렬)은 나눈 상자도 같게 — 문단을 나눠도 모양은 이어진다 */
function carryStyle(b: Block): Partial<Block> {
  return { ...(b.fontScale ? { fontScale: b.fontScale } : {}), ...(b.textColor ? { textColor: b.textColor } : {}), ...(b.align ? { align: b.align } : {}), ...(b.lineHeight ? { lineHeight: b.lineHeight } : {}), ...(b.indent ? { indent: b.indent } : {}), ...(b.style ? { style: b.style } : {}) };
}

export interface SplitOptions {
  /** 새 상자 높이 (측정값). 없으면 이 상자 높이 */
  h?: number;
  /** 새 상자부터 새 쪽 (Ctrl+Enter) */
  pageBreak?: boolean;
  /** 나누고 남은 이 상자의 높이 (측정값) */
  curH?: number;
}

/**
 * 글 상자를 둘로: 이 상자에서는 cutSteps(커서 뒤를 지우는 스텝)를 적용하고, 뒤쪽 글(tail)은 바로 아래 새 내용 상자로.
 * 아래 상자들은 새 상자 높이 + 간격만큼 내린다.
 */
export function splitTextBox(engine: Engine, contentId: Id, cutSteps: readonly unknown[], tail: TextDoc, opts: SplitOptions = {}): TxResult<{ blockId: Id; contentId: Id }> {
  return engine.transact((tx) => {
    const c = engine.getContent(contentId);
    const b = c && engine.getBlock(c.blockId);
    if (!c || !b) return tx.fail('나눌 상자가 없어요');
    const h = q(Math.max(24, opts.h ?? b.h));
    if (cutSteps.length) tx.text(contentId, cutSteps);
    const y = openGap(engine, tx, b, h, opts.curH);
    // 나뉜 뒷부분은 같은 단계 · 같은 묶음에 남는다 — 묶음이 없고 화살표 흐름에 든 상자면 둘을 새 묶음으로 (문서 순서가 흐름 밖으로 밀리지 않게)
    let group = b.group;
    if (!group && engine.arrowsOf(b.id).length) { group = newId(); tx.set('block', b.id, { group }); }
    const blockId = tx.createBlock({ x: b.x, y, w: b.w, h, ...carryStyle(b), ...(group ? { group } : {}), ...(opts.pageBreak ? { pageBreak: true } : {}), ...(isBlankDoc(tail) && !opts.pageBreak ? { draft: true } : {}) });
    const cid = tx.createContent({ blockId, type: 'text', role: 'body', doc: tail });
    return { blockId, contentId: cid };
  }, { origin: 'user', label: opts.pageBreak ? '쪽 나눔' : '문단 나누기' });
}

/**
 * 다음 글 상자를 앞 상자 끝에 합치기: intoId 내용에 appendSteps(뒤 글을 끝에 붙이는 스텝)를 적용하고, fromId 내용을 지운다.
 * 그 상자에 다른 내용이 없으면 상자째. 자리는 비워 둔다(위로 당기면 다른 줄의 상자와 겹칠 수 있다).
 */
export function mergeTextBoxes(engine: Engine, intoId: Id, appendSteps: readonly unknown[], fromId: Id): TxResult<void> {
  return engine.transact((tx) => {
    const from = engine.getContent(fromId);
    if (!engine.getContent(intoId) || !from) return tx.fail('합칠 상자가 없어요');
    if (appendSteps.length) tx.text(intoId, appendSteps);
    const rest = engine.contentsOf(from.blockId).filter((c) => c.id !== fromId);
    if (rest.length) { tx.delete('content', fromId); return; }
    // 지우는 상자의 화살표는 합친 상자로 옮긴다 — 흐름이 끊기지 않게 (자기 자신으로 가는 화살표가 되면 지운다)
    const into = engine.getContent(intoId)!.blockId;
    for (const a of engine.arrowsOf(from.blockId)) {
      const end = endBlock(a.from) === from.blockId ? 'from' : 'to';
      const other = endBlock(end === 'from' ? a.to : a.from); // 빈 곳의 점 끝이면 undefined
      if (other === into || other === from.blockId) tx.delete('arrow', a.id);
      else tx.set('arrow', a.id, { [end]: { ...(a[end] as BlockAnchor), blockId: into } });
    }
    tx.delete('content', fromId);
    tx.delete('block', from.blockId);
  }, { origin: 'user', label: '문단 합치기' });
}

/** 문서 맨 끝(읽는 순서)에 빈 내용 상자 — 문서 아래 빈 곳을 누르면. 너비는 마지막 상자를 따른다 */
/** pageBreak: 새 쪽에서 시작 (문서 뷰 쪽 보기의 '+') */
export function appendTextBox(engine: Engine, h = 32, pageBreak = false): TxResult<{ blockId: Id; contentId: Id }> {
  return engine.transact((tx) => {
    const order = documentOrder(engine).map((x) => x.block);
    const last = order[order.length - 1];
    const bottom = order.reduce((m, b) => Math.max(m, b.y + b.h), 0);
    const x = last ? last.x : 0, w = last ? last.w : 600;
    const blockId = tx.createBlock({ x, y: order.length ? bottom + DOC_GAP : 0, w, h, draft: true, ...(pageBreak ? { pageBreak: true } : {}) });
    const contentId = tx.createContent({ blockId, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'paragraph' }] } });
    return { blockId, contentId };
  }, { origin: 'user', label: pageBreak ? '새 쪽' : '새 문단' });
}

/**
 * 문서 뷰 항목 사이 빈 틈을 두 번 누르면 ('클릭하여 입력'): 이 블록 바로 아래(null이면 문서 맨 위)에 빈 초안 상자 —
 * 글이 들어와야 캔버스에 나타난다. join: 틈이 묶음 · 흐름 단계 안이면 새 상자도 그 단위로(문서에서 그 자리에 보이게).
 * 아래 상자는 내리고 room으로 돌려준다 — 글 없이 떠나면 discardIfEmpty가 되올린다.
 */
export function insertDraftBelow(engine: Engine, blockId: Id | null, h = 32, join = false): TxResult<{ blockId: Id; contentId: Id; room: DocRoom | null }> {
  return engine.transact((tx) => {
    const b = blockId ? engine.getBlock(blockId) : undefined;
    const hh = q(Math.max(24, h)), room: DocRoom = { ids: [], dy: 0 };
    const first = b ? undefined : documentOrder(engine)[0]?.block;
    const at = b ? { x: b.x, y: openGap(engine, tx, b, hh, undefined, undefined, room), w: b.w } : first ? { x: first.x, y: first.y - DOC_GAP - hh, w: first.w } : { x: 0, y: 0, w: 600 };
    const id = tx.createBlock({ x: at.x, y: at.y, w: at.w, h: hh, draft: true });
    if (b && join) joinUnit(engine, tx, b, [id]);
    const contentId = tx.createContent({ blockId: id, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'paragraph' }] } });
    return { blockId: id, contentId, room: room.dy ? room : null };
  }, { origin: 'user', label: '클릭하여 입력' });
}

/**
 * 문서 뷰에서 글 칸을 떠날 때: 글이 하나도 없는 본문 상자(초안 · 지워서 빈 상자)는 캔버스에서도 없앤다.
 * 상자에 다른 내용(표 · 사진 · 필기)이 있으면 남긴다. room: 이 상자 자리를 내느라 내린 아래 상자 — 되올린다. 값: 없앴으면 true
 */
export function discardIfEmpty(engine: Engine, contentId: Id, room?: DocRoom | null): TxResult<boolean> {
  return engine.transact((tx) => {
    const c = engine.getContent(contentId), b = c && engine.getBlock(c.blockId);
    // 초안(문서 뷰 '클릭하여 입력'이 채운 빈 줄뿐인 상자 포함)은 빈 문단만 있어도 빈 상자로 본다
    if (!c || !b || !isTextContent(c) || c.role === 'title' || !(isBlankDoc(c.doc) || (b.draft && c.doc.content.every((n) => n.type === 'paragraph' && !n.content?.length)))) return false;
    if (engine.contentsOf(b.id).length !== 1 || strokesOfContent(engine, c.id).length) return false;
    bridgeChains(engine, tx, new Set([b.id]));
    deleteEntities(engine, [b.id]); // 바깥 트랜잭션에 합류
    if (room) for (const id of room.ids) { const x = engine.getBlock(id); if (x) tx.set('block', id, { y: x.y - room.dy }); }
    return true;
  }, { origin: 'user', label: '빈 문단 지우기' });
}

/**
 * 이 상자 바로 아래에 높이 h 자리를 만든다 — 표 · 사진을 문서 순서대로 넣을 때. 새 상자의 왼쪽 위 · 너비.
 * 바깥 트랜잭션 안에서 부르면 새 상자 만들기와 함께 실행 취소 한 번.
 */
export function makeRoomBelow(engine: Engine, blockId: Id, h: number, curH?: number): TxResult<{ x: number; y: number; w: number }> {
  return engine.transact((tx) => {
    const b = engine.getBlock(blockId);
    if (!b) return tx.fail('상자가 없어요');
    return { x: b.x, y: openGap(engine, tx, b, h, curH), w: b.w };
  }, { origin: 'user', label: '자리 만들기' });
}

/** 문서 뷰에서 ref 바로 아래에 넣은 블록들을 ref의 묶음 · 흐름 단계로 — 묶음 가운데에 넣어도 묶음 끝으로 밀리지 않고 그 자리에 보이게 */
export function joinBelow(engine: Engine, refId: Id, ids: readonly Id[]): TxResult<void> {
  return engine.transact((tx) => { const b = engine.getBlock(refId); if (b) joinUnit(engine, tx, b, ids); }, { origin: 'user', label: '넣기' });
}

/**
 * 노트 맨 위에 글 상자 하나 (AI 노트 요약, FR-115) — 폭을 먼저 정하고 measure(폭)으로 높이를 잰다.
 * 캔버스 노트는 맨 위 내용(상자 · 자유 필기) 바로 위에 놓기만 하고 아무것도 옮기지 않는다. A4 노트는 용지 위쪽이 정해져 있으니
 * 용지 안쪽 맨 위에 두고, 자리가 모자라면 상자 · 자유 필기를 모두 같은 만큼 내린다(서로 위치 관계는 그대로) — 내려서 쪽 사이 틈에
 * 걸치는 상자는 다음 쪽으로, 그 아래도 같이(교차 검토 A9). 실행 취소 한 번
 */
export function insertTextAtTop(engine: Engine, doc: TextDoc, measure: (w: number) => number, opts: { ai?: AiProvenance; label?: string } = {}): TxResult<{ blockId: Id; contentId: Id }> {
  return engine.transact((tx) => {
    const blocks = [...engine.blocks()];
    const free = [...engine.strokes()].filter(isStroke).filter((s) => s.parent.kind === 'layer');
    const first = documentOrder(engine)[0]?.block;
    const tops = [...blocks.map((b) => b.y), ...free.map((s) => strokeBounds(s).y)];
    const top = tops.length ? tops.reduce((m, y) => Math.min(m, y), Infinity) : null;
    const g = sheetGeom(engine.note);
    const w = g ? g.list[0]!.w - 2 * SHEET_PAD : Math.max(first?.w ?? 0, 480); // 첫 쪽 폭 (쪽마다 가로 · 세로가 다를 수 있다)
    const h = q(Math.max(32, measure(w)));
    let x: number, y: number;
    if (g) {
      x = SHEET_PAD; y = SHEET_PAD;
      y = pageY(g, y, h);
      const dy = top === null ? 0 : Math.max(0, y + h + DOC_GAP - top);
      if (dy) {
        // 위에서부터 내리며 틈에 걸치면 다음 쪽 위로 — 더 내린 만큼(extra)은 그 아래 상자 · 필기에도
        let extra = 0;
        const bumps: [number, number][] = [];
        for (const b of [...blocks].sort((p, r) => p.y - r.y || p.x - r.x)) {
          const ny = b.y + dy + extra, py = pageY(g, ny, b.h);
          if (py > ny) { extra += py - ny; bumps.push([b.y, extra]); }
          tx.set('block', b.id, { y: py });
        }
        const more = (sy: number) => bumps.reduce((m, [at, e]) => (sy >= at ? e : m), 0);
        for (const s of free) tx.set('stroke', s.id, { origin: { x: s.origin.x, y: s.origin.y + dy + more(strokeBounds(s).y) } });
      }
    } else {
      x = first?.x ?? 0; y = top === null ? 0 : q(top - h - DOC_GAP);
    }
    const blockId = tx.createBlock({ x, y, w, h, ...(opts.ai ? { ai: opts.ai } : {}) });
    const contentId = tx.createContent({ blockId, type: 'text', role: 'body', doc });
    return { blockId, contentId };
  }, { origin: 'user', label: opts.label ?? '맨 위에 넣기' });
}

/**
 * 노트 맨 끝에 글 상자 하나 (AI 초안, FR-113) — 아무것도 옮기지 않는다. 문서 순서 마지막 상자의 왼쪽 · 폭(480 이상)으로
 * 모든 내용(상자 · 자유 필기) 아래에, A4 노트는 용지 안쪽 폭으로. 실행 취소 한 번
 */
export function insertTextAtEnd(engine: Engine, doc: TextDoc, measure: (w: number) => number, opts: { ai?: AiProvenance; label?: string } = {}): TxResult<{ blockId: Id; contentId: Id }> {
  return engine.transact((tx) => {
    const free = [...engine.strokes()].filter(isStroke).filter((s) => s.parent.kind === 'layer');
    const last = documentOrder(engine).at(-1)?.block;
    const bottoms = [...[...engine.blocks()].map((b) => b.y + b.h), ...free.map((s) => { const r = strokeBounds(s); return r.y + r.h; })];
    const g = sheetGeom(engine.note, contentBottom(engine));
    const y0 = bottoms.length ? q(bottoms.reduce((m, v) => Math.max(m, v), -Infinity) + DOC_GAP) : g ? SHEET_PAD : 0;
    const w = g ? pageAt(g, y0).w - 2 * SHEET_PAD : Math.max(last?.w ?? 0, 480); // 놓일 쪽의 폭
    const h = q(Math.max(32, measure(w)));
    const x = g ? SHEET_PAD : last?.x ?? 0;
    const y = g ? pageY(g, y0, h) : y0; // A4: 쪽 사이 틈에 걸치면 다음 쪽 위로 (교차 검토 A9)
    const blockId = tx.createBlock({ x, y, w, h, ...(opts.ai ? { ai: opts.ai } : {}) });
    const contentId = tx.createContent({ blockId, type: 'text', role: 'body', doc });
    return { blockId, contentId };
  }, { origin: 'user', label: opts.label ?? '맨 끝에 넣기' });
}

/**
 * 이 상자 바로 아래에 글 상자 하나 (녹음 받아쓴 글, FR-044) — A4 노트는 문서처럼 용지 폭으로 넣고 아래 상자를 내린다.
 * 끝없는 캔버스는 아무것도 옮기지 않고 바로 아래(폭 480 이상), 막혔으면 가장 가까운 빈 자리에 붙인다. 실행 취소 한 번
 */
export function insertTextBelow(engine: Engine, blockId: Id, doc: TextDoc, measure: (w: number) => number, opts: { label?: string } = {}): TxResult<{ blockId: Id; contentId: Id }> {
  return engine.transact((tx) => {
    const b = engine.getBlock(blockId);
    if (!b) return tx.fail('상자가 없어요');
    const g = sheetGeom(engine.note, contentBottom(engine));
    const w = g ? pageAt(g, b.y).w - 2 * SHEET_PAD : Math.max(b.w, 480); // 이 상자가 든 쪽의 폭
    const h = q(Math.max(32, measure(w)));
    const at = g ? { x: SHEET_PAD, y: openGap(engine, tx, b, h) } : findDockSpot(engine, { x: b.x, y: b.y + b.h + DOCK_GAP, w, h });
    const id = tx.createBlock({ ...at, w, h });
    const contentId = tx.createContent({ blockId: id, type: 'text', role: 'body', doc });
    return { blockId: id, contentId };
  }, { origin: 'user', label: opts.label ?? '아래에 넣기' });
}

/** 이 상자부터 새 쪽 (문서 뷰 · 인쇄 · PDF) 켜고 끄기 */
export function setPageBreak(engine: Engine, blockId: Id, on: boolean): TxResult<void> {
  return engine.transact((tx) => { if (engine.getBlock(blockId)) tx.set('block', blockId, { pageBreak: on ? true : undefined }); },
    { origin: 'user', label: on ? '쪽 나눔' : '쪽 나눔 없애기' });
}

/**
 * 문서 뷰 붙여넣기 · 복제: 이 블록 바로 아래(없으면 문서 끝)에 블록 묶음을 끼워 넣는다. 아래 상자는 내림.
 * 이 블록이 묶음 · 흐름 단계면 새 블록도 그 단위에 든다 — 문서에서도 바로 아래에 보이게 (DE-006). 실행 취소 한 번
 */
export function insertClipBelow(engine: Engine, blockId: Id | null, clip: BlockClip, label = '블록 붙여넣기'): TxResult<Id[]> {
  return engine.transact((tx) => {
    const b = blockId ? engine.getBlock(blockId) : undefined;
    const h = clipHeight(clip);
    if (b) {
      const ids = createFromClip(engine, tx, clip, { x: b.x, y: openGap(engine, tx, b, h) });
      joinUnit(engine, tx, b, ids);
      return ids;
    }
    const all = [...engine.blocks()];
    const bottom = all.reduce((m, x) => Math.max(m, x.y + x.h), -DOC_GAP);
    return createFromClip(engine, tx, clip, { x: all.length ? Math.min(...all.map((x) => x.x)) : 0, y: bottom + DOC_GAP });
  }, { origin: 'user', label });
}

/**
 * 문서 뷰 끌어 옮기기 (⋮⋮ 손잡이): 블록들을 target 바로 아래로(null이면 문서 맨 위로) 옮긴다. 서로의 자리 관계는 그대로,
 * 받는 자리 아래 상자는 내린다. id가 그대로라 링크 · 댓글 · 화살표가 남는다. 실행 취소 한 번.
 * target이 다른 묶음 · 흐름 가운데면 그 끝으로, 같은 한 줄 흐름 안이면 화살표 차례를 바꾼다 (DE-007, doc-units.ts)
 */
export function moveBlocksBelow(engine: Engine, ids: readonly Id[], target: Id | null): TxResult<void> {
  return engine.transact((tx) => {
    const t = docDropTarget(engine, ids, target);
    reorderForMove(engine, tx, new Set(ids), t);
    placeBelow(engine, tx, ids, t);
  }, { origin: 'user', label: '블록 옮기기' });
}

/** 문서 뷰에서 고른 블록 지우기 — 한 줄 흐름의 가운데 단계면 앞뒤를 잇는다 (DE-005). 실행 취소 한 번 */
export function deleteDocBlocks(engine: Engine, blocks: readonly Id[], strokes: readonly Id[] = []): TxResult<void> {
  return engine.transact((tx) => {
    bridgeChains(engine, tx, new Set(blocks));
    deleteEntities(engine, blocks, [], strokes); // 바깥 트랜잭션에 합류
  }, { origin: 'user', label: '삭제' });
}

/** 블록들을 target 아래(없으면 맨 위)로 — 서로의 자리 관계는 그대로 */
function placeBelow(engine: Engine, tx: Tx, ids: readonly Id[], target: Id | null): void {
  const moved = new Set(ids);
  const bs = ids.map((id) => engine.getBlock(id)).filter((b): b is Block => !!b);
  if (!bs.length || (target && moved.has(target))) return;
  const x0 = Math.min(...bs.map((b) => b.x)), y0 = Math.min(...bs.map((b) => b.y));
  const h = bs.reduce((m, b) => Math.max(m, b.y - y0 + b.h), 0);
  const t = target ? engine.getBlock(target) : undefined;
  const rest = [...engine.blocks()].filter((b) => !moved.has(b.id));
  let at: { x: number; y: number };
  if (t) at = { x: t.x, y: openGap(engine, tx, t, h, undefined, moved) };
  else {
    const top = rest.reduce((m, b) => Math.min(m, b.y), Infinity);
    at = Number.isFinite(top) ? { x: Math.min(...rest.map((b) => b.x)), y: top - DOC_GAP - h } : { x: x0, y: y0 };
  }
  for (const b of bs) tx.set('block', b.id, { x: q(at.x + b.x - x0), y: q(at.y + b.y - y0) });
}

/**
 * 문서 뷰에서 여러 칸에 걸쳐 고른 글 지우기 (워드처럼): 첫 칸(into)은 앞부분 + 마지막 칸 뒷부분으로(intoSteps),
 * 사이의 글 칸 · 블록 · 손그림 획은 지운다. last: 마지막 칸 — steps가 있으면 그 칸은 남기고 고치고, 없으면 지운다.
 * 글이 다 빠진 블록은 함께 지운다(딸린 화살표도). 실행 취소 한 번
 */
export function deleteAcross(engine: Engine, into: { id: Id; steps: readonly unknown[] }, last: { id: Id; steps: readonly unknown[] | null } | null,
  contents: readonly Id[], blocks: readonly Id[], strokes: readonly Id[] = [], mergeKey?: string): TxResult<void> {
  return engine.transact((tx) => {
    if (into.steps.length) tx.text(into.id, into.steps);
    const goneContents = new Set(contents);
    if (last) { if (last.steps) { if (last.steps.length) tx.text(last.id, last.steps); } else goneContents.add(last.id); }
    goneContents.delete(into.id);
    const touched = new Set<Id>(blocks);
    for (const id of goneContents) { const c = engine.getContent(id); if (c) touched.add(c.blockId); }
    // 통째로 고른 블록 + 글이 다 빠진 블록 (첫 칸의 블록은 남는다)
    const keep = engine.getContent(into.id)?.blockId;
    const goneBlocks = new Set([...touched].filter((id) => id !== keep && engine.getBlock(id) && (blocks.includes(id) || engine.contentsOf(id).every((c) => goneContents.has(c.id)))));
    bridgeChains(engine, tx, goneBlocks); // 흐름 가운데 단계를 지우면 앞뒤를 잇는다 (DE-005)
    rehomeGroupEnds(engine, tx, goneBlocks); // 묶음 끝 화살표는 남는 상자로 (v6)
    const arrows = new Set([...goneBlocks].flatMap((b) => engine.arrowsOf(b).map((a) => a.id)));
    for (const a of arrows) tx.delete('arrow', a);
    const goneStrokes = new Set(strokes.filter((s) => engine.getStroke(s)));
    const dropContent = (id: Id) => { for (const s of strokesOfContent(engine, id)) goneStrokes.add(s.id); tx.delete('content', id); };
    for (const id of goneContents) { const c = engine.getContent(id); if (c && !goneBlocks.has(c.blockId)) dropContent(id); }
    for (const b of goneBlocks) { for (const c of engine.contentsOf(b)) dropContent(c.id); tx.delete('block', b); }
    for (const s of goneStrokes) tx.delete('stroke', s);
  }, { origin: 'user', label: '고른 글 지우기', ...(mergeKey ? { mergeKey } : {}) }); // mergeKey: 바로 이어 친 글자와 실행 취소 한 번 (DE-008)
}
