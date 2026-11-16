// 다단계 번호 (워드 '다단계 목록'): 번호 목록의 번호 모양 — 기본(1. → a. → i.) · 다단계(1. → 1.1. → 1.1.1.).
// 가장 바깥 번호 목록에 모양(nums)을 적고, 안쪽 번호 목록은 CSS로 따른다(text.css). 번호 목록 밖이면 그 자리를 번호 목록으로 만들며 모양을 정한다.
import type { Node as PMNode, NodeType } from 'prosemirror-model';
import type { Command, EditorState } from 'prosemirror-state';
import { wrapInList } from 'prosemirror-schema-list';
import { schema } from './schema';

export type ListNums = '' | 'outline';
const OL = schema.nodes.ordered_list as NodeType;

/** 커서를 감싼 가장 바깥 번호 목록 */
function outerOl(state: EditorState): { node: PMNode; pos: number } | null {
  const { $from } = state.selection;
  for (let d = 1; d <= $from.depth; d++) { const n = $from.node(d); if (n.type === OL) return { node: n, pos: $from.before(d) }; }
  return null;
}

/** 커서 자리 번호 목록의 모양 — 번호 목록 밖이면 null */
export function listNumsAt(state: EditorState): ListNums | null {
  const o = outerOl(state);
  return o ? (o.node.attrs.nums === 'outline' ? 'outline' : '') : null;
}

export function setListNums(v: unknown): Command {
  const nums: ListNums = v === 'outline' ? 'outline' : '';
  return (state, dispatch) => {
    const o = outerOl(state);
    if (!o) return wrapInList(OL, { nums })(state, dispatch);
    if (dispatch && o.node.attrs.nums !== nums) dispatch(state.tr.setNodeMarkup(o.pos, undefined, { ...o.node.attrs, nums }).scrollIntoView());
    return true;
  };
}
