// 각주 (워드 참조 › 각주 · Ctrl+Alt+F): 글 속에는 위첨자 번호만, 각주 글은 노드 속성(attrs.note)에. 번호는 CSS 카운터가 차례대로 —
// 문서 뷰는 문서 전체(맨 끝에 각주 목록, doc-footnotes.ts), 캔버스는 상자마다 1부터.
// 편집 중 번호를 누르면 아래에 각주 글 입력 칸(Enter · 바깥 누르기 = 적용, Esc = 취소, 비우면 각주를 지운다).
import type { Node as PMNode } from 'prosemirror-model';
import { NodeSelection, TextSelection, type Command } from 'prosemirror-state';
import type { EditorView, NodeView } from 'prosemirror-view';
import { placeNear } from './menu';
import { AttrView } from './node-views';
import { schema } from './schema';

/** 각주 넣기: 커서 자리(고른 글이 있으면 그 뒤)에 빈 각주를 넣고 골라 두면 입력 칸이 열린다 */
export const insertFootnote: Command = (state, dispatch) => {
  const { to, $to } = state.selection;
  const t = schema.nodes.footnote!;
  if (!$to.parent.inlineContent || $to.parent.type.spec.code || !$to.parent.type.contentMatch.matchType(t)) return false;
  if (!dispatch) return true;
  const tr = state.tr.insert(to, t.create({ note: '' }));
  dispatch(tr.setSelection(NodeSelection.create(tr.doc, to)).scrollIntoView());
  return true;
};

export class FootnoteView extends AttrView implements NodeView {
  dom: HTMLElement;
  private box: HTMLElement | null = null;

  constructor(node: PMNode, view: EditorView, getPos: () => number | undefined, private readonly overlay: HTMLElement) {
    super(node, view, getPos);
    this.dom = document.createElement('sup');
    this.dom.className = 'dn-fn';
    this.dom.contentEditable = 'false';
    this.sync();
    this.dom.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation(); // 문서 뷰가 편집을 닫지 않게
      const pos = this.getPos();
      if (pos !== undefined) this.view.dispatch(this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, pos)));
      this.open();
    });
  }

  protected sync(): void {
    const note = String(this.node.attrs.note ?? '');
    this.dom.dataset.note = note;
    this.dom.title = note ? `각주: ${note}` : '빈 각주 — 눌러서 쓰기';
    this.dom.classList.toggle('dn-fn-empty', !note);
  }

  selectNode(): void { this.dom.classList.add('ProseMirror-selectednode'); if (!this.node.attrs.note) this.open(); }
  deselectNode(): void { this.dom.classList.remove('ProseMirror-selectednode'); }
  stopEvent(e: Event): boolean { return !!this.box && this.box.contains(e.target as Node); }
  ignoreMutation(): boolean { return true; }
  destroy(): void { const b = this.box; this.box = null; b?.remove(); }

  private open(): void {
    if (this.box) { this.box.querySelector('textarea')?.focus(); return; }
    const box = document.createElement('div');
    box.className = 'dn-fn-editor dn-ui dn-editor-pop';
    box.addEventListener('pointerdown', (e) => e.stopPropagation());
    box.addEventListener('mousedown', (e) => e.stopPropagation());
    const head = Object.assign(document.createElement('div'), { className: 'dn-fn-head', textContent: '각주' });
    const ta = document.createElement('textarea');
    ta.className = 'dn-fn-input';
    ta.rows = 2;
    ta.value = String(this.node.attrs.note ?? '');
    ta.placeholder = '출처 · 덧붙일 말 — Enter 완료 · Esc 취소';
    ta.setAttribute('aria-label', '각주 글');
    box.append(head, ta);
    this.overlay.append(box);
    this.box = box;
    placeNear(box, this.dom.getBoundingClientRect(), this.overlay);
    let done = false;
    const finish = (apply: boolean) => {
      if (done || this.box !== box) return;
      done = true;
      box.remove();
      this.box = null;
      const pos = this.getPos();
      if (pos === undefined) return;
      const note = ta.value.replace(/\s+/g, ' ').trim();
      const v = this.view;
      if (apply || !this.node.attrs.note) {
        // 비우면 각주를 지운다 (넣자마자 Esc도)
        const tr = note && apply ? v.state.tr.setNodeMarkup(pos, undefined, { note }) : v.state.tr.delete(pos, pos + this.node.nodeSize);
        const after = note && apply ? pos + this.node.nodeSize : pos;
        tr.setSelection(TextSelection.create(tr.doc, Math.min(after, tr.doc.content.size)));
        v.dispatch(tr);
      }
      v.focus();
    };
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.isComposing) return;
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finish(true); }
    });
    // 바깥 누르기 = 적용 — 바로 적용해야 문서 뷰 · 캔버스가 편집기를 닫으며(TextEditor.destroy가 이 칸의 초점을 뺀다) 칸을 지우기 전에 저장된다 (AT-003).
    // 다른 창 · 탭으로 갔다 오는 것은 끝내지 않는다
    ta.addEventListener('blur', () => { if (document.hasFocus()) finish(true); });
    requestAnimationFrame(() => ta.focus());
  }
}
