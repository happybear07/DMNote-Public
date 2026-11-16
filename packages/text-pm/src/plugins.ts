import type { Node as PMNode, NodeType } from 'prosemirror-model';
import { tokenizeCode } from './highlight';
import { Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { schema } from './schema';
import type { EditorMode } from './editor';

const N = schema.nodes as Record<string, NodeType>;

/** 접힌 토글의 숨은 내용 안으로 커서가 들어가면(문서 끝으로 이동 · 방향키 등) 그 토글의 요약 줄 끝으로 꺼낸다 */
export function hiddenCursorGuard(): Plugin {
  return new Plugin({
    appendTransaction(_trs, _old, state) {
      const { $head } = state.selection;
      // 바깥 토글부터 — 바깥이 접혀 있으면 안쪽 토글의 요약 줄도 숨어 있다
      for (let d = 1; d <= $head.depth; d++) {
        const n = $head.node(d);
        if (n.type === N.toggle && !n.attrs.open && $head.index(d) > 0) {
          const end = $head.before(d) + 1 + n.firstChild!.nodeSize - 1;
          return state.tr.setSelection(TextSelection.create(state.doc, end));
        }
      }
      return null;
    },
  });
}

// ───────── 코드 구문 강조 (FR-026) ─────────
// 노드는 바뀌지 않는 값이라, 고치지 않은 코드 블록은 같은 노드 — 토큰을 다시 계산하지 않는다
const tokCache = new WeakMap<PMNode, ReturnType<typeof tokenizeCode>>();
function codeDecos(doc: PMNode): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type !== N.code_block) return true;
    if (!node.attrs.language) return false;
    let toks = tokCache.get(node);
    if (!toks) { toks = tokenizeCode(node.textContent, node.attrs.language); tokCache.set(node, toks); }
    for (const t of toks) decos.push(Decoration.inline(pos + 1 + t.from, pos + 1 + t.to, { class: `dn-tok-${t.cls}` }));
    return false;
  });
  return DecorationSet.create(doc, decos);
}

export function codeHighlight(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: new PluginKey('dn-code-hl'),
    state: { init: (_c, s) => codeDecos(s.doc), apply: (tr, old) => (tr.docChanged ? codeDecos(tr.doc) : old) },
    props: { decorations(state) { return this.getState(state); } },
  });
}

// ───────── 자리표시자 ─────────
/** text: 제목 모드 자리표시를 바꾼다 (표 칸은 '' — 비움) */
export function placeholderPlugin(mode: EditorMode, titleText = '제목'): Plugin {
  return new Plugin({
    key: new PluginKey('dn-placeholder'),
    props: {
      decorations(state) {
        const decos: Decoration[] = [];
        const { doc, selection } = state;
        doc.forEach((node, offset) => {
          if (!node.isTextblock || node.content.size > 0) return;
          const hasCursor = selection.empty && selection.$from.parent === node;
          const text = mode === 'title' ? titleText || null
            : hasCursor ? "내용 입력 · '/' 메뉴 · '# ' 제목 · '- ' 목록"
            : doc.childCount === 1 ? '내용' : null;
          if (text) decos.push(Decoration.node(offset, offset + node.nodeSize, { class: 'dn-empty', 'data-placeholder': text }));
        });
        // 토글 요약 줄은 비어 있으면 늘 안내 (안쪽 노드라 위 순회에 안 걸린다)
        if (mode === 'body') doc.descendants((node, pos, parent, index) => {
          if (parent?.type === N.toggle && index === 0 && node.content.size === 0) decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'dn-empty', 'data-placeholder': '토글 제목' }));
          return !node.isTextblock;
        });
        return DecorationSet.create(doc, decos);
      },
    },
  });
}
