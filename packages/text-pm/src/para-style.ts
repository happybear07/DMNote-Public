// 문단 스타일 (문서 서식 막대의 스타일 칸 — 워드 스타일 갤러리): 본문 · 제목 1~4 · 인용 · 코드 · 콜아웃 가운데 하나로.
// 스타일은 하나만 — 고른 문단을 감싼 인용 · 콜아웃을 먼저 풀고(내용은 그대로, 고른 문단만) 새 모양을 입힌다. 실행 취소 한 번.
import type { NodeType } from 'prosemirror-model';
import type { Command, Transaction } from 'prosemirror-state';
import { findWrapping, liftTarget } from 'prosemirror-transform';
import { schema } from './schema';

const STYLES: readonly string[] = ['paragraph', 'h1', 'h2', 'h3', 'h4', 'quote', 'code_block', 'callout'];
const N = schema.nodes as Record<string, NodeType>;
const isWrapper = (t: NodeType) => t === N.blockquote || t === N.callout;

/** 고른 문단을 감싼 인용 · 콜아웃을 한 겹 푼다. 풀 것이 없으면 false */
function liftOnce(tr: Transaction): boolean {
  const { $from, $to } = tr.selection;
  const range = $from.blockRange($to, (n) => isWrapper(n.type));
  const target = range && liftTarget(range);
  if (!range || target == null) return false;
  tr.lift(range, target);
  return true;
}

export function paraStyle(to: unknown): Command {
  return (state, dispatch) => {
    if (typeof to !== 'string' || !STYLES.includes(to)) return false;
    if (!dispatch) return true;
    const tr = state.tr;
    for (let i = 0; i < 4 && liftOnce(tr); i++);
    const { from, to: end } = tr.selection;
    const heading = /^h[1-4]$/.test(to);
    // 글 모양: 인용 · 콜아웃 안은 본문 문단으로
    tr.setBlockType(from, end, heading ? N.heading! : to === 'code_block' ? N.code_block! : N.paragraph!, heading ? { level: Number(to[1]) } : null);
    if (to === 'quote' || to === 'callout') {
      const { $from, $to } = tr.selection;
      const range = $from.blockRange($to);
      const wrap = range && findWrapping(range, to === 'quote' ? N.blockquote! : N.callout!);
      if (!range || !wrap) return false;
      tr.wrap(range, wrap);
    }
    dispatch(tr.scrollIntoView());
    return true;
  };
}
