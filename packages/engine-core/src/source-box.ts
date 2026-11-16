// 원문에서 상자 만들기 (11/02): 원문 상자에서 고른 글을 새 상자로 꺼낸다 — 원문은 그대로 두고 새 상자에 원문 연결(source)을 남겨
// '원문에서 보기' · 원문 구절 강조가 AI 상자처럼 된다. 사람이 만든 상자라 AI 출처(ai)는 달지 않는다 — 원문 → 구조의 짝(OWN-MODEL 학습 자료)이 된다.
// '블록으로 분리'(extractToBlock)는 글을 옮기고, 이것은 복사 + 연결이다.
import { DEFAULT_BLOCK_H, DEFAULT_BLOCK_W } from './commands';
import type { Engine, TxResult } from './engine';
import { q, type Vec2 } from './geom';
import { isTextContent, type Block, type Id, type SourceRef, type TextDoc } from './model';
import { docText } from './text-doc';

/** 원문에 강조할 글 — 너무 길면 앞부분만 (찾기는 글자로) */
const EXCERPT_MAX = 2000;

/** 원문 콘텐츠의 [from, to) 조각(doc — 서식 그대로)을 at에 새 내용 상자로. 원문은 그대로, 실행 취소 한 번 */
export function boxFromSource(
  engine: Engine, contentId: Id, range: { readonly from: number; readonly to: number }, doc: TextDoc, at: Vec2, w = DEFAULT_BLOCK_W,
): TxResult<{ blockId: Id; contentId: Id }> {
  return engine.transact((tx) => {
    const c = engine.getContent(contentId);
    if (!c || !isTextContent(c)) return tx.fail('원문 글 상자가 없어요');
    const excerpt = docText(doc).trim().slice(0, EXCERPT_MAX);
    if (!excerpt) return tx.fail('고른 글이 없어요');
    const blockId = tx.createBlock({ x: q(at.x), y: q(at.y), w, h: DEFAULT_BLOCK_H, source: { contentId, from: range.from, to: range.to, excerpt } });
    const cid = tx.createContent({ blockId, type: 'text', role: 'body', doc });
    return { blockId, contentId: cid };
  }, { origin: 'user', label: '원문에서 상자 만들기' });
}

/** 상자의 원문 연결 — 사람이 꺼낸 것(source)이 먼저, 없으면 AI 출처(ai.source) */
export function sourceOf(b: Pick<Block, 'source' | 'ai'> | undefined): SourceRef | undefined {
  return b?.source ?? b?.ai?.source;
}
