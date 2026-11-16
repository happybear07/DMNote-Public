// 서식 복사 (워드 붓 · Ctrl+Alt+C / V): 글자 서식 표시만 골라 담고 다른 글자에 그대로 입힌다.
// 링크 · 댓글 · 노트 링크 같은 "내용" 표시는 옮기지 않는다. DOM을 쓰지 않는다.
import type { Mark, MarkType } from 'prosemirror-model';
import { TextSelection, type Command, type EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { schema } from './schema';

/** 옮기는 글자 서식 */
const KINDS = ['strong', 'em', 'underline', 'strike', 'code', 'highlight', 'textColor', 'fontSize', 'fontFamily', 'sup', 'sub'] as const;
const TYPES = KINDS.map((k) => schema.marks[k]).filter((t): t is MarkType => !!t);

export type MarkCopy = readonly { type: string; attrs?: Record<string, unknown> }[];

/** 커서 자리(고른 글자면 그 첫 글자)의 글자 서식 */
export function copyMarks(state: EditorState): MarkCopy {
  const { empty, from, to, $from } = state.selection;
  let marks: readonly Mark[] = empty ? state.storedMarks ?? $from.marks() : [];
  if (!empty) {
    let found = false;
    state.doc.nodesBetween(from, to, (n) => { if (found || !n.isText) return !found; marks = n.marks; found = true; return false; });
  }
  return marks.filter((m) => TYPES.includes(m.type)).map((m) => ({ type: m.type.name, ...(Object.keys(m.attrs).length ? { attrs: { ...m.attrs } } : {}) }));
}

/** 고른 글자의 글자 서식을 담아 둔 것으로 바꾼다 (비었으면 커서 자리의 다음 글자) */
export function pasteMarks(copy: MarkCopy): Command {
  return (state, dispatch) => {
    const marks = copy.flatMap((m) => { const t = schema.marks[m.type]; return t && TYPES.includes(t) ? [t.create(m.attrs)] : []; });
    if (!dispatch) return true;
    const { from, to, empty, $from } = state.selection;
    if (empty) {
      const rest = (state.storedMarks ?? $from.marks()).filter((m) => !TYPES.includes(m.type));
      dispatch(state.tr.setStoredMarks([...rest, ...marks]));
      return true;
    }
    const tr = state.tr;
    for (const t of TYPES) tr.removeMark(from, to, t);
    for (const m of marks) tr.addMark(from, to, m);
    dispatch(tr);
    return true;
  };
}

/** 마우스를 막 뗀 때: 화면(DOM)에서 고른 글자를 에디터 선택으로 맞춘다 — 에디터가 selectionchange를 아직 못 읽었을 수 있다 */
export function syncDomSelection(view: EditorView): void {
  const sel = view.dom.ownerDocument.getSelection();
  if (!sel || sel.isCollapsed || !sel.anchorNode || !sel.focusNode || !view.dom.contains(sel.anchorNode) || !view.dom.contains(sel.focusNode)) return;
  try {
    const a = view.posAtDOM(sel.anchorNode, sel.anchorOffset), h = view.posAtDOM(sel.focusNode, sel.focusOffset);
    const cur = view.state.selection;
    if (a !== h && (cur.anchor !== a || cur.head !== h)) view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, a, h)));
  } catch { /* 에디터 밖 노드 — 그대로 */ }
}
