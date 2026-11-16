// 블록 댓글 (FR-132): 블록에 붙는 메모 목록 — 본문과 따로라 내보내기(Markdown · HTML · PNG)에는 나오지 않는다(콘텐츠만 내보낸다).
// 글 일부에 단 댓글은 그 글에 comment 표시(mark, id = anchor)가 있고, 댓글에는 그때 고른 글(quote)을 남긴다.
// 해결 · 지우기는 그 표시도 함께 지운다 — 표시를 지우는 스텝은 글 코덱을 아는 쪽(engine-dom)이 만들어 넘긴다(한 트랜잭션 · 실행 취소 한 번).
import type { Engine, TxResult } from './engine';
import { newId } from './id';
import type { Block, Id } from './model';

export interface BlockComment {
  readonly id: Id;
  readonly text: string;
  readonly at: number;
  readonly resolved?: boolean;
  /** 글 일부에 단 댓글: 그 글 (화면에 인용으로) · 글 속 표시 id */
  readonly quote?: string;
  readonly anchor?: Id;
}

/** 표시를 지우는 글 편집 (콘텐츠 · ProseMirror 스텝) */
export interface CommentTextEdit { readonly contentId: Id; readonly steps: readonly unknown[] }

export const blockComments = (b: Block | undefined): readonly BlockComment[] => (b as { comments?: readonly BlockComment[] } | undefined)?.comments ?? [];
export const openComments = (b: Block | undefined): readonly BlockComment[] => blockComments(b).filter((c) => !c.resolved);

export function addComment(engine: Engine, blockId: Id, text: string, opts: { quote?: string; anchor?: Id; at?: number } = {}): TxResult<Id> {
  const t = text.trim().slice(0, 4000);
  return engine.transact((tx) => {
    const b = engine.getBlock(blockId);
    if (!b) tx.fail('댓글: 블록 없음');
    if (!t) tx.fail('댓글: 빈 글');
    const c: BlockComment = {
      id: newId(), text: t, at: opts.at ?? Date.now(),
      ...(opts.quote?.trim() ? { quote: opts.quote.trim().slice(0, 300) } : {}), ...(opts.anchor ? { anchor: opts.anchor } : {}),
    };
    tx.set('block', blockId, { comments: [...blockComments(b), c] });
    return c.id;
  }, { origin: 'user', label: '댓글 달기' });
}

/** 해결 · 다시 열기. 해결하면 글 속 표시를 지운다(edits) */
export function setCommentResolved(engine: Engine, blockId: Id, commentId: Id, resolved: boolean, edits: readonly CommentTextEdit[] = []): TxResult<void> {
  return engine.transact((tx) => {
    const list = blockComments(engine.getBlock(blockId));
    if (!list.some((c) => c.id === commentId)) tx.fail('댓글 없음');
    for (const e of edits) if (e.steps.length) tx.text(e.contentId, e.steps);
    tx.set('block', blockId, { comments: list.map((c) => (c.id === commentId ? { ...c, resolved: resolved || undefined } : c)) });
  }, { origin: 'user', label: resolved ? '댓글 해결' : '댓글 다시 열기' });
}

export function deleteComment(engine: Engine, blockId: Id, commentId: Id, edits: readonly CommentTextEdit[] = []): TxResult<void> {
  return engine.transact((tx) => {
    const list = blockComments(engine.getBlock(blockId));
    if (!list.some((c) => c.id === commentId)) tx.fail('댓글 없음');
    for (const e of edits) if (e.steps.length) tx.text(e.contentId, e.steps);
    const rest = list.filter((c) => c.id !== commentId);
    tx.set('block', blockId, { comments: rest.length ? rest : undefined });
  }, { origin: 'user', label: '댓글 지우기' });
}

/** 노트의 열린 댓글 (블록 순서 그대로) — 패널 목록용 */
export function noteOpenComments(engine: Engine): { blockId: Id; comment: BlockComment }[] {
  const out: { blockId: Id; comment: BlockComment }[] = [];
  for (const b of engine.blocks()) for (const c of openComments(b)) out.push({ blockId: b.id, comment: c });
  return out;
}
