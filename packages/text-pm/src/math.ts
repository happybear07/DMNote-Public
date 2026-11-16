// 수식 (FR-018): LaTeX를 KaTeX로 그린다. 문서에는 LaTeX 원문만(attrs.tex) — 렌더 결과는 저장하지 않는다.
// - 인라인 수식 math_inline: $a^2$ · 블록 수식 math_block: $$ 로 시작하는 줄
// - 편집 중에는 수식을 누르면 아래에 원문 입력 칸 + 입력 도우미(틀 · 기호 · 공식)가 열린다(Enter · 바깥 누르기 = 적용, Esc = 취소, 비우면 지움)
import katex from 'katex';
import type { Node as PMNode } from 'prosemirror-model';
import { NodeSelection, TextSelection } from 'prosemirror-state';
import type { EditorView, NodeView } from 'prosemirror-view';
import { jumpPlaceholder, mathPalette, texError } from './math-palette';
import { placeNear } from './menu';

/** el 안의 [data-tex] 자리를 수식으로 그린다 (정적 렌더 · 문서 뷰 · PNG 내보내기) */
export function renderMath(root: HTMLElement): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-tex]')) drawTex(el, el.dataset.tex ?? '', el.tagName === 'DIV');
}

function drawTex(el: HTMLElement, tex: string, display: boolean): void {
  if (!tex.trim()) { el.textContent = display ? '빈 수식 — 눌러서 LaTeX 입력' : '수식'; el.classList.add('dn-math-empty'); return; }
  el.classList.remove('dn-math-empty');
  try { katex.render(tex, el, { throwOnError: false, displayMode: display, output: 'htmlAndMathml', strict: 'ignore' }); }
  catch { el.textContent = tex; }
}

/** 편집 중 수식 NodeView */
export class MathView implements NodeView {
  dom: HTMLElement;
  private shown: HTMLElement;
  private editor: HTMLElement | null = null;
  /** overlay: 입력 칸 · 도우미 판을 화면 크기 그대로 띄울 곳 (캔버스 확대와 무관). 없으면 수식 아래에 */
  constructor(private node: PMNode, private readonly view: EditorView, private readonly getPos: () => number | undefined, private readonly overlay?: HTMLElement) {
    const block = node.type.name === 'math_block';
    this.dom = document.createElement(block ? 'div' : 'span');
    this.dom.className = block ? 'dn-math-block' : 'dn-math';
    this.dom.contentEditable = 'false';
    this.shown = document.createElement(block ? 'div' : 'span');
    this.shown.className = 'dn-math-view';
    this.dom.append(this.shown);
    drawTex(this.shown, node.attrs.tex as string, block);
    this.dom.addEventListener('mousedown', (e) => {
      if (this.editor && this.editor.contains(e.target as Node)) return;
      e.preventDefault();
      e.stopPropagation(); // 수식 누르기는 여기서 끝 — 문서 뷰가 편집을 닫지 않게
      const pos = this.getPos();
      if (pos !== undefined) this.view.dispatch(this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, pos)));
      this.open();
    });
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    if (!this.editor) drawTex(this.shown, node.attrs.tex as string, node.type.name === 'math_block');
    return true;
  }

  selectNode(): void { this.dom.classList.add('ProseMirror-selectednode'); if (!(this.node.attrs.tex as string)) this.open(); }
  deselectNode(): void { this.dom.classList.remove('ProseMirror-selectednode'); }
  stopEvent(e: Event): boolean { return !!this.editor && this.editor.contains(e.target as Node); }
  ignoreMutation(): boolean { return true; }
  destroy(): void { const b = this.editor; this.editor = null; b?.remove(); } // 먼저 비운다 — 지우는 사이의 blur가 적용하지 않게

  open(): void {
    if (this.editor) { this.editor.querySelector('textarea')?.focus(); return; }
    const ta = document.createElement('textarea');
    ta.className = 'dn-math-input';
    ta.value = this.node.attrs.tex as string;
    ta.rows = this.node.type.name === 'math_block' ? 3 : 1;
    ta.placeholder = 'LaTeX — 예: \\frac{a}{b}, x^2, \\sum_{i=1}^n';
    ta.setAttribute('aria-label', '수식 LaTeX');
    ta.spellcheck = false;
    const display = this.node.type.name === 'math_block';
    // 입력 칸 · 쓰는 법 · 문법 오류 · 도우미 판. 칸 밖을 눌러도 입력 칸의 초점은 그대로 (바깥 누르기 = 적용과 구분)
    const box = document.createElement('div');
    box.className = `dn-math-editor dn-ui${this.overlay ? ' dn-math-pop dn-editor-pop' : ''}`;
    box.addEventListener('pointerdown', (e) => e.stopPropagation());
    // 두 번 누르기 · 휠은 입력 창 몫 — 캔버스가 새 블록을 만들거나 화면을 옮기지 않게 (Ctrl+휠 확대는 그대로)
    box.addEventListener('dblclick', (e) => e.stopPropagation());
    box.addEventListener('wheel', (e) => { if (!e.ctrlKey && !e.metaKey) e.stopPropagation(); });
    const head = Object.assign(document.createElement('div'), { className: 'dn-math-head', textContent: display ? '블록 수식' : '인라인 수식' });
    // 노션처럼: 입력 칸 위에 깔끔한 미리보기 카드 — 글 속 수식은 작게 줄지 않고 크게 보여 준다
    const card = Object.assign(document.createElement('div'), { className: 'dn-math-card' });
    const pv = Object.assign(document.createElement('div'), { className: 'dn-math-pv' });
    card.append(pv);
    const foot = Object.assign(document.createElement('div'), { className: 'dn-math-foot' });
    const help = Object.assign(document.createElement('span'), { className: 'dn-math-help', textContent: 'Enter 완료 · Shift+Enter 줄바꿈 · Tab 다음 빈칸 · Esc 취소' });
    const done$ = Object.assign(document.createElement('button'), { type: 'button', className: 'dn-math-done', textContent: '완료' });
    done$.addEventListener('click', () => finish(true));
    foot.append(help, done$);
    const err = document.createElement('div');
    err.className = 'dn-math-err';
    err.setAttribute('role', 'status');
    const preview = () => { drawTex(this.shown, ta.value, display); if (ta.value.trim()) drawTex(pv, ta.value, true); else pv.textContent = '쓰는 대로 여기에 미리 보여요'; card.classList.toggle('dn-math-card-empty', !ta.value.trim()); const m = texError(ta.value, display); err.textContent = m ? `수식 문법을 확인해 주세요 — ${m}` : ''; err.hidden = !m; };
    ta.addEventListener('input', preview);
    box.addEventListener('mousedown', (e) => { e.stopPropagation(); if (e.target !== ta) e.preventDefault(); });
    box.append(head, card, ta, err, mathPalette(ta), foot);
    err.hidden = true;
    let done = false;
    /** next: 초점이 옮겨 가는 곳 — 다른 수식 입력 창이면 에디터로 초점을 되돌리지 않는다 */
    const finish = (apply: boolean, next?: EventTarget | null) => {
      if (done || this.editor !== box) return;
      done = true;
      const tex = ta.value.trim();
      box.remove();
      this.editor = null;
      const pos = this.getPos();
      if (pos === undefined) return;
      if (!apply) { drawTex(this.shown, this.node.attrs.tex as string, this.node.type.name === 'math_block'); this.view.focus(); return; }
      const tr = tex ? this.view.state.tr.setNodeMarkup(pos, undefined, { tex }) : this.view.state.tr.delete(pos, pos + this.node.nodeSize);
      // 글 속 수식은 커서를 수식 뒤로 — 이어 치는 글이 수식 뒤에 (DQ-026)
      if (tex && this.node.type.name === 'math_inline') tr.setSelection(TextSelection.create(tr.doc, pos + this.node.nodeSize));
      this.view.dispatch(tr);
      if (!(next instanceof Element && next.closest('.dn-editor-pop'))) this.view.focus();
    };
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
      else if (e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); jumpPlaceholder(ta, e.shiftKey ? -1 : 1); }
      else if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); finish(true); }
    });
    // 다른 창 · 탭으로 갔다 오는 것은 끝내지 않는다 (돌아오면 입력 칸에 초점이 돌아온다)
    ta.addEventListener('blur', (e) => { if (document.hasFocus()) finish(true, e.relatedTarget); });
    this.editor = box;
    if (this.overlay) {
      this.overlay.append(box);
      // 수식 바로 아래 (모자라면 위), 화면을 옮겨도 따라간다
      const place = () => {
        if (!box.isConnected) return;
        placeNear(box, this.dom.getBoundingClientRect(), this.overlay!);
        requestAnimationFrame(place);
      };
      place();
    } else this.dom.append(box);
    preview();
    // 빈 수식이면 바로 입력, 있으면 끝에 커서 — 도우미로 넣는 틀이 뒤에 붙는다
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); });
  }
}
