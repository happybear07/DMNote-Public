// 서식 · 블록 명령 (툴바 · 단축키 · 슬래시 메뉴 · 블록 메뉴 공용)과 에디터 없이 스텝을 만드는 헬퍼.
// DOM을 쓰지 않는다 — 테스트 · 헤드리스에서도 부른다.
import type { TextDoc } from '@dn/engine-core';
import { chainCommands, setBlockType, splitBlock, toggleMark, wrapIn, lift } from 'prosemirror-commands';
import { Fragment, type MarkType, type Node as PMNode, type NodeType } from 'prosemirror-model';
import { liftListItem, sinkListItem, wrapInList } from 'prosemirror-schema-list';
import { AllSelection, EditorState, TextSelection, type Command, type Selection, type Transaction, NodeSelection } from 'prosemirror-state';
import { toJSON, toNode } from './codec';
import { safeHref, schema } from './schema';
import type { FormatCommand } from './format';
import { cleanColor } from './text-colors';
import { fontFamilyAt, fontSizeAt, markColor, markColorAt, markFont, markSize } from './mark-style';
import { insertFootnote } from './footnote';
import { paraStyle } from './para-style';
import { setListNums } from './list-nums';

export { fontFamilyAt, fontSizeAt, markColorAt };

const N = schema.nodes as Record<string, NodeType>;
const M = schema.marks as Record<string, MarkType>;

export function formatCommand(name: FormatCommand, arg?: unknown): Command | null {
  switch (name) {
    case 'strong': case 'em': case 'underline': case 'strike': case 'code': case 'sup': case 'sub': case 'chip':
      return toggleMark(M[name]!);
    case 'highlight': return highlight;
    case 'clear': return clearFormat;
    case 'textColor': case 'bgColor': return markColor(name === 'textColor' ? M.textColor! : M.highlight!, cleanColor(arg));
    case 'fontSize': return markSize(arg === 'up' || arg === 'down' ? arg : Number(arg) || 1);
    case 'fontFamily': return markFont(arg);
    case 'paraStyle': return paraStyle(arg);
    case 'listNums': return setListNums(arg);
    case 'indent': return chainCommands(sinkListItem(N.list_item!), sinkListItem(N.task_item!));
    case 'outdent': return chainCommands(liftListItem(N.list_item!), liftListItem(N.task_item!));
    case 'link': {
      const href = typeof arg === 'string' ? arg.trim() : '';
      return (state, dispatch) => {
        const { from, to, empty } = state.selection;
        if (empty) return false;
        if (!href) { dispatch?.(state.tr.removeMark(from, to, M.link!)); return true; }
        if (!safeHref(href)) return false;
        dispatch?.(state.tr.addMark(from, to, M.link!.create({ href })));
        return true;
      };
    }
    case 'h1': case 'h2': case 'h3': case 'h4': {
      const level = Number(name[1]);
      return (state, dispatch, view) => (isBlock(state, N.heading!, { level })
        ? setBlockType(N.paragraph!)(state, dispatch, view)
        : setBlockType(N.heading!, { level })(state, dispatch, view));
    }
    case 'paragraph': return setBlockType(N.paragraph!);
    case 'bullet': return toggleList(N.bullet_list!, N.list_item!);
    case 'ordered': return toggleList(N.ordered_list!, N.list_item!);
    case 'task': return toggleList(N.task_list!, N.task_item!);
    case 'quote': return (state, dispatch, view) => (inAncestor(state, N.blockquote!) ? lift(state, dispatch) : wrapIn(N.blockquote!)(state, dispatch, view));
    case 'code_block': return setBlockType(N.code_block!);
    case 'divider': return insertDivider;
    case 'math': return insertMath;
    case 'mathInline': return toInlineMath;
    case 'footnote': return insertFootnote;
    case 'toggle': return wrapToggle;
    case 'toggleH1': return toggleHeading(1);
    case 'toggleH2': return toggleHeading(2);
    case 'toggleH3': return toggleHeading(3);
    case 'callout': return (state, dispatch, view) => (inAncestor(state, N.callout!) ? false : wrapIn(N.callout!)(state, dispatch, view));
  }
}

/** 고른 글 → 글 속 수식 (고른 글이 LaTeX), 고른 글이 없으면 빈 수식을 넣고 입력 칸을 연다 */
const toInlineMath: Command = (state, dispatch) => {
  const { from, to, empty, $from } = state.selection;
  if (!$from.parent.inlineContent || $from.parent.type.spec.code || !$from.parent.type.contentMatch.matchType(N.math_inline!)) return false;
  let mixed = false;
  state.doc.nodesBetween(from, to, (n) => { if (n.isInline && !n.isText) mixed = true; });
  if (mixed) return false;
  if (!dispatch) return true;
  const tr = state.tr.replaceSelectionWith(N.math_inline!.create({ tex: empty ? '' : state.doc.textBetween(from, to, ' ').trim() }), false);
  // 빈 수식은 골라서 입력 칸을 열고, 고른 글을 바꾼 것은 커서를 수식 뒤로 — 수식이 골라진 채면 다음 입력이 수식을 지운다
  tr.setSelection(empty ? NodeSelection.create(tr.doc, from) : TextSelection.create(tr.doc, from + 1));
  dispatch(tr.scrollIntoView());
  return true;
};

/** 커서 줄 자리에 블록 넣기 — 빈 줄이면 그 줄을 바꾸고, 아니면 아래에. sel: 넣은 자리(at) → 넣은 뒤 선택 */
const insertAtLine = (nodes: () => PMNode[], sel: (doc: PMNode, at: number) => Selection): Command => (state, dispatch) => {
  const { $from } = state.selection;
  if (!$from.parent.isTextblock || $from.depth < 1) return false;
  if (!dispatch) return true;
  const empty = $from.parent.content.size === 0;
  const at = empty ? $from.before() : $from.after();
  const tr = state.tr.replaceWith(at, empty ? $from.after() : at, nodes());
  tr.setSelection(sel(tr.doc, at));
  dispatch(tr.scrollIntoView());
  return true;
};

/** 수식 블록 넣기 (FR-018) — 넣자마자 골라서 LaTeX 입력 칸이 열린다 */
const insertMath = insertAtLine(() => [N.math_block!.create({ tex: '' })], (doc, at) => NodeSelection.create(doc, at));

/** 구분선 + 그 아래 빈 문단에 커서 */
const insertDivider = insertAtLine(() => [N.horizontal_rule!.create(), N.paragraph!.create()], (doc, at) => TextSelection.create(doc, at + 2));

/** 선택한 블록들을 토글로 감싼다. 토글은 문단으로 시작해야 하므로 첫 줄이 제목 등이면 문단으로 바꾼 뒤 감싼다. */
/**
 * 고른 글자에 색 표시 (같은 종류의 표시는 바꾼다), 색이 ''면 지운다. 고른 글자가 없으면 이어서 쓸 글자에 (stored marks)
 */
/** 형광펜: 없거나 기본 형광이면 켜고 끄기, 배경 색이 칠해진 글이면 기본 형광으로 바꾼다 (배경 색을 지우지 않게, DQ-033) */
const highlight: Command = (state, dispatch, view) => {
  const c = markColorAt(state, 'bgColor');
  if (c === null || c === 'default') return toggleMark(M.highlight!)(state, dispatch, view);
  const { from, to, empty } = state.selection;
  if (empty) return toggleMark(M.highlight!)(state, dispatch, view);
  dispatch?.(state.tr.removeMark(from, to, M.highlight!).addMark(from, to, M.highlight!.create()));
  return true;
};

/** 지금 줄을 감싸는 토글 (안쪽부터) — 그 토글의 시작 위치 · 노드 */
function toggleAt(state: EditorState): { pos: number; node: PMNode } | null {
  const $f = state.selection.$from;
  for (let d = $f.depth; d > 0; d--) if ($f.node(d).type === N.toggle) return { pos: $f.before(d), node: $f.node(d) };
  return null;
}

/** 노션 '토글 제목': 토글 안이면 요약 줄을 제목으로, 아니면 지금 줄을 토글로 감싼 뒤 요약 줄을 제목으로 (실행 취소 한 번) */
const toggleHeading = (level: 1 | 2 | 3): Command => (state, dispatch, view) => {
  let st = state;
  const tr = state.tr;
  if (!toggleAt(st)) {
    let ok = false;
    wrapToggle(st, (t) => { ok = true; for (const s of t.steps) tr.step(s); st = st.apply(t); }, view);
    if (!ok) return false;
  }
  const t = toggleAt(st);
  if (!t || !t.node.firstChild) return false;
  if (!dispatch) return true;
  tr.setNodeMarkup(t.pos + 1, N.heading!, { level });
  dispatch(tr.scrollIntoView());
  return true;
};

const wrapToggle: Command = (state, dispatch, view) => {
  if (inAncestor(state, N.toggle!) && !dispatch) return false;
  const { $from } = state.selection;
  // 제목 줄은 문단 토글로 (제목 모양 토글은 'toggleH1' …) — 스키마는 제목 요약도 받지만 /토글은 예전처럼
  if ($from.parent.type !== N.heading && wrapIn(N.toggle!)(state, dispatch, view)) return true;
  if (!$from.parent.isTextblock || $from.parent.type === N.paragraph) return false;
  const tr = state.tr.setBlockType($from.before(), $from.after(), N.paragraph!);
  let ok = false;
  wrapIn(N.toggle!)(state.apply(tr), (t2) => {
    ok = true;
    for (const st of t2.steps) tr.step(st);
  });
  if (ok && dispatch) dispatch(tr.scrollIntoView());
  return ok;
};

/** 감싼 노드(토글 · 콜아웃) 찾기: 커서 줄의 바로 위 조상 */
function wrapperOf(state: EditorState): { node: PMNode; pos: number; index: number } | null {
  const { $from } = state.selection;
  if ($from.depth < 2) return null;
  const node = $from.node(-1);
  if (node.type !== N.toggle && node.type !== N.callout) return null;
  return { node, pos: $from.before(-1), index: $from.index(-1) };
}

/** 접힌 토글의 요약 줄에서 Enter → 토글 다음에 새 줄 (숨은 내용 안으로 들어가지 않게) */
export const enterClosedToggle: Command = (state, dispatch) => {
  const w = wrapperOf(state);
  if (!w || w.node.type !== N.toggle || w.node.attrs.open || w.index !== 0 || !state.selection.empty) return false;
  if (!dispatch) return true;
  const after = w.pos + w.node.nodeSize;
  const tr = state.tr.insert(after, N.paragraph!.create());
  dispatch(tr.setSelection(TextSelection.create(tr.doc, after + 1)).scrollIntoView());
  return true;
};

/** 토글 · 콜아웃의 마지막 빈 줄에서 Enter → 밖으로 나간다 (목록과 같은 동작) */
export const exitWrapper: Command = (state, dispatch) => {
  const w = wrapperOf(state);
  const { $from, empty } = state.selection;
  if (!w || !empty || $from.parent.content.size !== 0 || $from.parent.type !== N.paragraph) return false;
  if (w.index !== w.node.childCount - 1 || w.node.childCount < 2) return false;
  return lift(state, dispatch);
};

/** 토글 · 콜아웃 중간의 빈 줄에서 Enter → 그 안에 새 줄 (기본 동작은 감싼 것을 둘로 쪼갠다) */
export const stayInWrapper: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!wrapperOf(state) || !empty || $from.parent.content.size !== 0) return false;
  return splitBlock(state, dispatch);
};

/** 토글 · 콜아웃 첫 줄 맨 앞에서 Backspace → 감싼 것을 푼다 (내용은 그대로) */
export const unwrapAtStart: Command = (state, dispatch) => {
  const w = wrapperOf(state);
  const { $from, empty } = state.selection;
  if (!w || !empty || w.index !== 0 || $from.parentOffset !== 0) return false;
  if (!dispatch) return true;
  const tr = state.tr.replaceWith(w.pos, w.pos + w.node.nodeSize, w.node.content);
  dispatch(tr.setSelection(TextSelection.create(tr.doc, w.pos + 1)).scrollIntoView());
  return true;
};

/** (정적 렌더 · 헤드리스) `pos`의 노드 속성 하나를 뒤집는 스텝 — 편집 중이 아닌 블록의 토글 · 할 일 클릭 */
export function flipAttrSteps(doc: TextDoc, pos: number, attr: 'open' | 'checked'): unknown[] | null {
  const node = toNode(doc);
  const target = pos >= 0 && pos < node.content.size ? node.nodeAt(pos) : null;
  if (!target || !(attr in target.attrs)) return null;
  const s0 = EditorState.create({ doc: node });
  return s0.tr.setNodeMarkup(pos, undefined, { ...target.attrs, [attr]: !target.attrs[attr] }).steps.map((x) => x.toJSON());
}

/** (테스트 · 헤드리스) `pos`에 커서를 두고 서식 명령을 실행한 스텝. 적용할 수 없으면 null */
export function commandSteps(doc: TextDoc, pos: number, name: FormatCommand | 'enter' | 'backspace'): { steps: unknown[]; doc: TextDoc } | null {
  const s0 = EditorState.create({ doc: toNode(doc) });
  const s = s0.apply(s0.tr.setSelection(TextSelection.create(s0.doc, pos)));
  const run = name === 'enter' ? chainCommands(enterClosedToggle, exitWrapper)
    : name === 'backspace' ? unwrapAtStart : formatCommand(name);
  let out: { steps: unknown[]; doc: TextDoc } | null = null;
  run?.(s, (tr) => { out = { steps: tr.steps.map((x) => x.toJSON()), doc: toJSON(tr.doc) }; });
  return out;
}

/** 에디터 없이 블록 문서 전체에 서식 명령을 적용한 스텝 (블록 메뉴의 타입 전환). 적용할 수 없으면 null. */
export function formatSteps(doc: TextDoc, name: FormatCommand): unknown[] | null {
  const selectAll = (s: EditorState) => s.apply(s.tr.setSelection(new AllSelection(s.doc)));
  const run = formatCommand(name);
  if (!run) return null;
  const attempt = (s: EditorState): { steps: unknown[]; state: EditorState } | null => {
    let out: { steps: unknown[]; state: EditorState } | null = null;
    run(s, (tr) => { out = { steps: tr.steps.map((x) => x.toJSON()), state: s.apply(tr) }; });
    return out;
  };
  const start = selectAll(EditorState.create({ doc: toNode(doc) }));
  const direct = attempt(start);
  if (direct) return direct.steps;
  // 목록 · 인용은 제목 줄을 감쌀 수 없다 (list_item은 문단으로 시작) — 먼저 문단으로 바꾼 뒤 감싼다
  let flatTr = null as Transaction | null;
  setBlockType(N.paragraph!)(start, (t) => { flatTr = t; });
  if (!flatTr) return null;
  const wrapped = attempt(selectAll(start.apply(flatTr)));
  return wrapped ? [...flatTr.steps.map((x) => x.toJSON()), ...wrapped.steps] : null;
}

function toggleList(list: NodeType, item: NodeType): Command {
  return (state, dispatch, view) => (inAncestor(state, list) ? liftListItem(item)(state, dispatch, view) : wrapInList(list)(state, dispatch, view));
}

function inAncestor(state: EditorState, type: NodeType): boolean {
  const $f = state.selection.$from;
  for (let d = $f.depth; d > 0; d--) if ($f.node(d).type === type) return true;
  return false;
}

function isBlock(state: EditorState, type: NodeType, attrs?: Record<string, unknown>): boolean {
  const p = state.selection.$from.parent;
  return p.type === type && (!attrs || Object.entries(attrs).every(([k, v]) => p.attrs[k] === v));
}

export function formatActive(state: EditorState, name: FormatCommand): boolean {
  const { from, to, empty, $from } = state.selection;
  switch (name) {
    // 형광펜은 기본(노랑) 형광일 때만 켜짐 — 배경 색을 칠한 글은 '배경 색' (DQ-033)
    case 'highlight': return markColorAt(state, 'bgColor') === 'default';
    case 'strong': case 'em': case 'underline': case 'strike': case 'code': case 'link': case 'sup': case 'sub': case 'chip': {
      const t = M[name]!;
      return empty ? !!t.isInSet(state.storedMarks ?? $from.marks()) : state.doc.rangeHasMark(from, to, t);
    }
    case 'h1': case 'h2': case 'h3': case 'h4': return isBlock(state, N.heading!, { level: Number(name[1]) });
    case 'paragraph': return isBlock(state, N.paragraph!);
    case 'bullet': return inAncestor(state, N.bullet_list!);
    case 'ordered': return inAncestor(state, N.ordered_list!);
    case 'task': return inAncestor(state, N.task_list!);
    case 'quote': return inAncestor(state, N.blockquote!);
    case 'code_block': return isBlock(state, N.code_block!);
    case 'toggle': return inAncestor(state, N.toggle!);
    case 'textColor': return markColorAt(state, 'textColor') !== null;
    case 'bgColor': return markColorAt(state, 'bgColor') !== null;
    case 'fontSize': return fontSizeAt(state) !== 1;
    case 'fontFamily': return fontFamilyAt(state) !== 'sans';
    case 'toggleH1': case 'toggleH2': case 'toggleH3': { const t = toggleAt(state); return !!t && t.node.firstChild?.type === N.heading && t.node.firstChild!.attrs.level === Number(name.slice(-1)); }
    case 'callout': return inAncestor(state, N.callout!);
    case 'divider': return false;
    case 'math': case 'mathInline': case 'clear': case 'indent': case 'outdent': case 'footnote': case 'paraStyle': case 'listNums': return false;
  }
}


/**
 * Alt+↑/↓ (FR-032): 커서가 있는 줄을 형제와 자리 바꾼다. 목록 항목 안이면 그 항목(하위 항목 포함),
 * 아니면 최상위 블록(문단 · 제목 · 인용 · 코드 …)이 단위다. 한 트랜잭션 = undo 한 번.
 */
export function moveLine(dir: -1 | 1): Command {
  return (state, dispatch) => {
    const { $from, from, to } = state.selection;
    let depth = 1;
    for (let d = $from.depth; d > 0; d--) {
      const t = $from.node(d).type;
      if (t === N.list_item || t === N.task_item) { depth = d; break; }
    }
    if ($from.depth < depth) return false;
    const parent = $from.node(depth - 1);
    const index = $from.index(depth - 1);
    const target = index + dir;
    if (target < 0 || target >= parent.childCount) return false;
    if (!dispatch) return true;
    const node = parent.child(index), other = parent.child(target);
    const start = $from.before(depth);
    const shift = dir < 0 ? -other.nodeSize : other.nodeSize;
    const tr = dir < 0
      ? state.tr.replaceWith(start - other.nodeSize, start + node.nodeSize, Fragment.from([node, other]))
      : state.tr.replaceWith(start, start + node.nodeSize + other.nodeSize, Fragment.from([other, node]));
    tr.setSelection(TextSelection.create(tr.doc, from + shift, to + shift));
    dispatch(tr.scrollIntoView());
    return true;
  };
}

/** (테스트 · 헤드리스) `pos`에 커서가 있을 때 줄 이동 스텝. 움직일 수 없으면 null */
export function moveLineSteps(doc: TextDoc, pos: number, dir: -1 | 1): unknown[] | null {
  const s0 = EditorState.create({ doc: toNode(doc) });
  const s = s0.apply(s0.tr.setSelection(TextSelection.create(s0.doc, pos)));
  let steps: unknown[] | null = null;
  moveLine(dir)(s, (tr) => { steps = tr.steps.map((x) => x.toJSON()); });
  return steps;
}

// ───────── 단축키 전용 명령 (부록 A · FR-023) ─────────


/** 커서가 있는 가장 가까운 조상 노드 (종류) */
function ancestor(state: EditorState, type: NodeType): { node: PMNode; pos: number } | null {
  const $f = state.selection.$from;
  for (let d = $f.depth; d > 0; d--) if ($f.node(d).type === type) return { node: $f.node(d), pos: $f.before(d) };
  return null;
}

/** Ctrl+Enter — 커서가 있는 할 일 체크 뒤집기 (FR-033) */
export const toggleTaskAtCursor: Command = (state, dispatch) => {
  const hit = ancestor(state, N.task_item!);
  if (!hit) return false;
  dispatch?.(state.tr.setNodeMarkup(hit.pos, undefined, { ...hit.node.attrs, checked: !hit.node.attrs.checked }));
  return true;
};

/** Ctrl+Alt+T — 커서가 있는 토글 접기 · 펼치기 (FR-047). 접을 때 커서가 숨는 쪽이면 요약 줄 끝으로 */
export const toggleFoldAtCursor: Command = (state, dispatch) => {
  const hit = ancestor(state, N.toggle!);
  if (!hit) return false;
  const tr = state.tr.setNodeMarkup(hit.pos, undefined, { ...hit.node.attrs, open: !hit.node.attrs.open });
  const summaryEnd = hit.pos + hit.node.firstChild!.nodeSize;
  if (hit.node.attrs.open && state.selection.from > summaryEnd) tr.setSelection(TextSelection.create(tr.doc, summaryEnd));
  dispatch?.(tr);
  return true;
};

/** 댓글 표시 지우기 (FR-132 해결 · 지우기): 이 id의 comment 표시만 지우는 스텝. 없으면 빈 배열 */
export function removeCommentSteps(doc: TextDoc, id: string): unknown[] {
  const state = EditorState.create({ doc: toNode(doc) });
  const tr = state.tr;
  state.doc.descendants((n, pos) => {
    for (const m of n.marks) if (m.type === M.comment && m.attrs.id === id) tr.removeMark(pos, pos + n.nodeSize, m);
    return true;
  });
  return tr.steps.map((x) => x.toJSON());
}


/** 서식 지우기 (워드 Ctrl+Space · 구글 문서 Ctrl+\): 글자 표시를 지우고(링크 · 댓글은 남김) 제목은 본문으로. 빈 선택이면 이어 쓸 글자 표시만 */
const KEEP_MARKS = new Set(['link', 'comment']);
export const clearFormat: Command = (state, dispatch) => {
  const { from, to, empty } = state.selection;
  const tr = state.tr;
  if (empty) tr.setStoredMarks([]);
  else for (const m of Object.values(M)) if (!KEEP_MARKS.has(m.name)) tr.removeMark(from, to, m);
  state.doc.nodesBetween(from, to, (n, pos) => { if (n.type === N.heading) tr.setNodeMarkup(pos, N.paragraph!); return !n.isTextblock; });
  if (!tr.docChanged && !empty) return false;
  dispatch?.(tr);
  return true;
};
