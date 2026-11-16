// 글 상자 에디터의 키맵 · 입력 규칙 플러그인 (editor.ts). Ctrl+Z는 엔진 undo로 보낸다 (단일 undo 스택, ENGINE 5.6).
// 제목 상자: 한 줄 · 글자 서식만, Enter · Tab · 끝에서 ↓ = 다음 칸. 내용 상자: 리치 텍스트, 맨 앞에서 ↑ · Backspace · Shift+Tab = 이전 칸.
import { baseKeymap, chainCommands, exitCode, setBlockType, toggleMark } from 'prosemirror-commands';
import { inputRules, undoInputRule } from 'prosemirror-inputrules';
import { keymap } from 'prosemirror-keymap';
import type { MarkType, Node as PMNode, NodeType } from 'prosemirror-model';
import { liftListItem, sinkListItem, splitListItem } from 'prosemirror-schema-list';
import { Plugin, type Command, type EditorState } from 'prosemirror-state';
import { clearFormat, enterClosedToggle, exitWrapper, formatCommand, moveLine, stayInWrapper, toggleFoldAtCursor, toggleTaskAtCursor, unwrapAtStart } from './commands';
import type { EditorMode, TextEditorOptions } from './editor';
import { markdownRules } from './input-rules';
import { codeHighlight, hiddenCursorGuard, placeholderPlugin } from './plugins';
import { schema } from './schema';

const N = schema.nodes as Record<string, NodeType>;
const M = schema.marks as Record<string, MarkType>;

/** h.menuKey: 열린 고르기 메뉴가 그 키를 받았으면 true (↑ ↓ Enter Tab Esc를 메뉴가 먼저) · h.promptLink: Ctrl+K · h.aiEdit: Ctrl+J */
export function editorPlugins(o: TextEditorOptions, mode: EditorMode, h: { menuKey(e: KeyboardEvent): boolean; promptLink(): void; aiEdit(): void }): Plugin[] {
  const cmd = (fn: () => void): Command => () => { fn(); return true; };
  const listItem = N.list_item!, taskItem = N.task_item!;
  const menus = new Plugin({ props: { handleKeyDown: (_v, e) => h.menuKey(e) } });
  const marks = {
    'Mod-z': cmd(() => o.onUndo()),
    'Shift-Mod-z': cmd(() => o.onRedo()),
    'Mod-y': cmd(() => o.onRedo()),
    'Mod-b': toggleMark(M.strong!),
    'Mod-i': toggleMark(M.em!),
    'Mod-u': toggleMark(M.underline!),
    'Mod-Shift-x': toggleMark(M.strike!),
    'Mod-e': toggleMark(M.code!),
    'Mod-Shift-h': toggleMark(M.highlight!),
    // 인라인 수식 (노션과 같은 키): 고른 글은 그 LaTeX로, 없으면 빈 수식 입력 창
    'Mod-Shift-e': formatCommand('mathInline')!,
    'Mod-Alt-f': formatCommand('footnote')!, // 각주 (워드와 같은 키)
    'Mod-k': cmd(() => h.promptLink()),
    // AI 작성 도우미 (FR-112, 노션과 같은 키) — 문서 뷰는 호스트 키(워드 양쪽 맞춤)가 먼저 받는다
    ...(o.onAiEdit && mode === 'body' ? { 'Mod-j': cmd(() => h.aiEdit()) } : {}),
    'Mod-Shift-\\': clearFormat,
    Escape: cmd(() => o.onEscape()),
  };
  if (mode === 'title') {
    const next: Command = () => { o.onExitNext?.(); return !!o.onExitNext; };
    // ↓: 제목의 마지막 줄(화면상)에서 누르면 다음 칸으로
    const atEnd: Command = (state, d, view) => state.selection.empty && !!view?.endOfTextblock('down') && next(state, d, view);
    return [
      menus, // 제목 상자에서도
      ...(o.keys ? [o.keys] : []),
      // Shift+Tab → 앞 칸 (표 칸, DQ-023). 앞 칸이 없으면 브라우저 기본 초점 이동 대신 그대로 둔다
      keymap({ ...marks, Enter: next, 'Shift-Enter': next, Tab: next, 'Shift-Tab': () => { o.onExitPrev?.(); return true; }, ArrowDown: atEnd }),
      keymap(baseKeymap),
      // 제목은 문단 하나 — 줄이 나뉘거나 다른 블록 노드가 생기는 변경은 받지 않는다 (엔진 I10과 같은 규칙)
      new Plugin({ filterTransaction: (tr) => !tr.docChanged || (tr.doc.childCount === 1 && tr.doc.firstChild!.type === N.paragraph) }),
      placeholderPlugin('title', o.placeholder ?? '제목'),
    ];
  }
  // 내용 맨 앞: ↑ · Backspace · Shift+Tab(목록 밖일 때) → 이전 칸
  const atStart = (state: EditorState) => state.selection.empty && state.selection.$head.pos <= 1 + leadingDepth(state.doc);
  const prev: Command = (state) => { if (!o.onExitPrev || !atStart(state)) return false; o.onExitPrev(); return true; };
  // ↑: 첫 문단의 첫 줄(화면상 — 줄바꿈된 문단도)에서 누르면 이전 칸으로
  const up: Command = (state, _d, view) => {
    if (!o.onExitPrev || !state.selection.empty || !view) return false;
    const $h = state.selection.$head;
    if ($h.before($h.depth) > leadingDepth(state.doc) || !view.endOfTextblock('up')) return false;
    o.onExitPrev();
    return true;
  };
  return [
    menus,
    ...(o.keys ? [o.keys] : []),
    inputRules({ rules: markdownRules() }),
    hiddenCursorGuard(),
    codeHighlight(),
    keymap({ ArrowUp: up, 'Shift-Tab':chainCommands(liftListItem(listItem), liftListItem(taskItem), prev, () => true) }),
    keymap({
      ...marks,
      'Mod-Alt-1': setBlockType(N.heading!, { level: 1 }),
      'Mod-Alt-2': setBlockType(N.heading!, { level: 2 }),
      'Mod-Alt-3': setBlockType(N.heading!, { level: 3 }),
      'Mod-Alt-0': setBlockType(N.paragraph!),
      // 부록 A 블록 타입 전환: 4 할 일 · 5 글머리 · 6 번호 · 7 토글 · 8 코드 · 9 콜아웃
      ...Object.fromEntries((['task', 'bullet', 'ordered', 'toggle', 'code_block', 'callout'] as const).map((c, i) => [`Mod-Alt-${i + 4}`, formatCommand(c)!])),
      'Mod-Enter': toggleTaskAtCursor,
      'Mod-Alt-t': toggleFoldAtCursor,
      'Shift-Enter': chainCommands(exitCode, (state, dispatch) => {
        dispatch?.(state.tr.replaceSelectionWith(N.hard_break!.create()).scrollIntoView());
        return true;
      }),
      Enter: chainCommands(splitListItem(listItem), splitListItem(taskItem, { checked: false }), enterClosedToggle, exitWrapper, stayInWrapper),
      Tab: chainCommands(sinkListItem(listItem), sinkListItem(taskItem), () => true),
      'Alt-ArrowUp': moveLine(-1),
      'Alt-ArrowDown': moveLine(1),
      // 마크다운 단축 변환 직후 Backspace → 입력한 글자로 되돌림 (FR-028). 맨 앞의 빈 문단이면 이전 칸으로
      Backspace: chainCommands(undoInputRule, unwrapAtStart, (state) => (state.doc.childCount === 1 && state.doc.firstChild!.content.size === 0 ? prev(state) : false)),
    }),
    keymap(baseKeymap),
    placeholderPlugin('body'),
  ];
}

/** 문서 맨 앞 글자 위치까지 감싼 노드 수 (문단 0, 목록 항목 안 문단 2 …) — "맨 앞" 판정용 */
function leadingDepth(doc: PMNode): number {
  let n = doc.firstChild, d = 0;
  while (n && !n.isTextblock) { n = n.firstChild; d++; }
  return d;
}
