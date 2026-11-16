// 고른 글 → 글 속 수식: 바꾼 뒤 커서는 수식 뒤 (수식이 골라진 채면 다음 입력이 수식을 지운다), 빈 수식은 골라서 입력 칸을 연다
import { describe, expect, it } from 'vitest';
import { EditorState, NodeSelection, TextSelection } from 'prosemirror-state';
import { formatCommand } from '../src/commands';
import { toJSON, toNode } from '../src/codec';

const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'E=mc^2' }] }] };

describe('글 속 수식으로', () => {
  it('고른 글은 수식이 되고 커서는 수식 뒤 — 이어 쓰면 수식이 남는다', () => {
    let state = EditorState.create({ doc: toNode(doc) });
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 7)));
    formatCommand('mathInline')!(state, (tr) => { state = state.apply(tr); });
    expect(state.selection).toBeInstanceOf(TextSelection);
    state = state.apply(state.tr.insertText(' 끝'));
    expect(toJSON(state.doc).content![0]!.content).toEqual([{ type: 'math_inline', attrs: { tex: 'E=mc^2' } }, { type: 'text', text: ' 끝' }]);
  });

  it('고른 글이 없으면 빈 수식을 골라 둔다 (입력 칸이 열림)', () => {
    let state = EditorState.create({ doc: toNode(doc) });
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 7)));
    formatCommand('mathInline')!(state, (tr) => { state = state.apply(tr); });
    expect(state.selection).toBeInstanceOf(NodeSelection);
    expect((state.selection as NodeSelection).node.type.name).toBe('math_inline');
  });
});
