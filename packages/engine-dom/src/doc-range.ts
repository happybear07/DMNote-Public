// 문서 뷰: 여러 글 칸에 걸친 글자 고르기 (워드처럼). 칸 경계를 넘어 끌거나(Shift+누르기 · 칸 끝에서 Shift+↑↓) 하면 편집기를 닫고
// 정적 글 위에 브라우저 선택으로 범위를 그린다. 그 범위에서 Delete · Backspace · 글자 입력 · 잘라내기 · 붙여넣기 = 워드처럼
// 첫 칸 앞부분 + 마지막 칸 뒷부분을 잇고, 통째로 든 칸 · 블록은 지운다(engine-core deleteAcross, 실행 취소 한 번). 복사는 브라우저 기본.
import { BLOCK_CLIP_MIME, deleteAcross, isTextContent, type Id, type TextContent } from '@dn/engine-core';
import { crossDeleteSteps, deleteRangeSteps, domAtUnits, posAtUnits, unitsAtDom, unitsAtPos } from '@dn/text-pm';
import type { DocView } from './doc-view';
import type { DocWord } from './doc-word';

type Pt = { node: Node; offset: number };
/** 다시 그리기를 넘어 기억하는 범위 끝: 글 칸 안이면 (칸 id, 단위 수), 아니면 화면 지점 그대로 */
type Mark = { part: Id; units: number } | Pt;

/** 화면 좌표의 글자 자리 */
function caretAt(x: number, y: number): Pt | null {
  const d = document as Document & { caretPositionFromPoint?(x: number, y: number): { offsetNode: Node; offset: number } | null };
  if (d.caretPositionFromPoint) { const p = d.caretPositionFromPoint(x, y); return p ? { node: p.offsetNode, offset: p.offset } : null; }
  const r = document.caretRangeFromPoint?.(x, y);
  return r ? { node: r.startContainer, offset: r.startOffset } : null;
}

export class DocRange {
  constructor(private readonly dv: DocView) {}

  private parts(): HTMLElement[] {
    return [...this.dv.page.querySelectorAll<HTMLElement>('.dn-doc-text[data-part]')].filter((el) => !el.parentElement?.closest('[data-part]'));
  }

  private content(part: HTMLElement): TextContent | null {
    const c = this.dv.opts.engine.getContent(part.dataset.part!);
    return c && isTextContent(c) ? c : null;
  }

  /** 고른 범위가 문서 안에 있고 편집기가 닫혀 있으면 그 범위. 다른 편집기(표 칸 · 열 이름 입력 …) 안의 선택은 그 편집기 몫 (DE-003) */
  range(): Range | null {
    if (this.dv.word.editor) return null;
    const sel = getSelection();
    if (!sel?.rangeCount || sel.isCollapsed) return null;
    const r = sel.getRangeAt(0);
    const editing = (n: Node) => !!(n instanceof Element ? n : n.parentElement)?.closest('[contenteditable="true"], input, textarea, .dn-cell-editing');
    if (editing(r.startContainer) || editing(r.endContainer)) return null;
    return this.dv.page.contains(r.startContainer) && this.dv.page.contains(r.endContainer) ? r : null;
  }

  get active(): boolean { return !!this.range(); }

  /** 다시 그리기 전에 범위 양 끝을 (칸 id, 단위 수)로 기억 — 칸 요소가 새로 지어지면 브라우저 선택이 칸 밖으로 밀려 범위가 번진다 (DE-002) */
  snapshot(): { a: Mark; h: Mark } | null {
    const sel = getSelection();
    if (!this.range() || !sel?.anchorNode || !sel.focusNode) return null;
    const mark = (node: Node, offset: number): Mark => {
      const part = this.partOf(node);
      return part ? { part: part.dataset.part!, units: unitsAtDom(part, node, offset) } : { node, offset };
    };
    return { a: mark(sel.anchorNode, sel.anchorOffset), h: mark(sel.focusNode, sel.focusOffset) };
  }

  /** 다시 그린 뒤 기억한 범위를 되놓는다. 끝 하나라도 없어졌으면 범위를 푼다(엉뚱한 범위를 지우지 않게) */
  restore(s: { a: Mark; h: Mark }): void {
    const pt = (m: Mark): Pt | null => {
      if ('node' in m) return m.node.isConnected && this.dv.page.contains(m.node) ? m : null;
      const part = this.parts().find((p) => p.dataset.part === m.part);
      return part ? domAtUnits(part, m.units) : null;
    };
    const a = pt(s.a), h = pt(s.h), sel = getSelection();
    if (!sel) return;
    if (!a || !h) { sel.removeAllRanges(); return; }
    if (sel.anchorNode === a.node && sel.anchorOffset === a.offset && sel.focusNode === h.node && sel.focusOffset === h.offset) return;
    sel.setBaseAndExtent(a.node, a.offset, h.node, h.offset);
  }

  private partOf(n: Node): HTMLElement | null {
    const p = (n instanceof Element ? n : n.parentElement)?.closest<HTMLElement>('.dn-doc-text[data-part]') ?? null;
    return p && this.parts().includes(p) ? p : null;
  }

  /** 고치던 칸의 선택(앵커)을 정적 글 위의 화면 지점으로 옮기고 편집기를 닫는다 */
  private anchorFromEditor(): { anchor: Pt; head: Pt } | null {
    const cur = this.dv.word.editor;
    if (!cur) return null;
    const c = this.content(cur.el);
    const { anchor, head } = cur.ed.view.state.selection;
    const doc = cur.ed.doc, el = cur.el;
    const ua = unitsAtPos(doc, anchor), uh = unitsAtPos(doc, head);
    this.dv.word.close(false);
    if (!c || !el.isConnected) return null;
    return { anchor: domAtUnits(el, ua), head: domAtUnits(el, uh) };
  }

  private set(a: Pt, h: Pt): void {
    this.dv.root.focus({ preventScroll: true });
    getSelection()?.setBaseAndExtent(a.node, a.offset, h.node, h.offset);
  }

  /** 끌기: 처음엔 고치던 칸의 앵커에서, 그다음엔 그 앵커를 그대로 두고 머리만 */
  private dragAnchor: Pt | null = null;
  dragTo(x: number, y: number): boolean {
    if (!this.dragAnchor) {
      const r = this.anchorFromEditor();
      if (!r) return false;
      this.dragAnchor = r.anchor;
    }
    const h = caretAt(x, y);
    if (!h || !this.dv.page.contains(h.node)) return true;
    this.set(this.dragAnchor, h);
    return true;
  }
  endDrag(): void { this.dragAnchor = null; }

  /** Shift+누르기: 고치던 칸의 커서에서 누른 자리까지 */
  extendTo(x: number, y: number): boolean {
    const h = caretAt(x, y);
    if (!h || !this.dv.page.contains(h.node)) return false;
    const r = this.anchorFromEditor();
    if (!r) return false;
    this.set(r.anchor, h);
    return true;
  }

  /** 범위가 있을 때 Shift+누르기: 머리만 옮긴다 */
  extendHead(x: number, y: number): boolean {
    const h = caretAt(x, y), sel = getSelection();
    if (!h || !sel || !this.active || !this.dv.page.contains(h.node)) return false;
    sel.extend(h.node, h.offset);
    return true;
  }

  /** 칸 끝에서 Shift+↑↓: 칸을 넘어 한 줄 더 */
  extendFromEditor(dir: 'up' | 'down'): boolean {
    const r = this.anchorFromEditor();
    if (!r) return false;
    this.set(r.anchor, r.head);
    getSelection()?.modify('extend', dir === 'down' ? 'forward' : 'backward', 'line');
    return true;
  }

  /** 범위가 켜져 있을 때 키. 처리했으면 true */
  key(e: KeyboardEvent): boolean {
    if (!this.active || e.isComposing) return false;
    const mod = e.ctrlKey || e.metaKey;
    const sel = getSelection()!;
    if (e.shiftKey && !mod && /^Arrow|^Home$|^End$/.test(e.key)) {
      e.preventDefault();
      const dir = e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'Home' ? 'backward' : 'forward';
      sel.modify('extend', dir, e.key === 'ArrowUp' || e.key === 'ArrowDown' ? 'line' : e.key.startsWith('Arrow') ? 'character' : 'lineboundary');
      return true;
    }
    if (e.key === 'Escape') { e.preventDefault(); sel.removeAllRanges(); return true; }
    if (/^Arrow/.test(e.key) && !mod) { e.preventDefault(); this.collapse(e.key === 'ArrowUp' || e.key === 'ArrowLeft'); return true; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.remove(); return true; }
    // Enter: 지운 자리에서 줄 나누기까지 (편집기의 Enter 그대로 — 빈 줄이면 상자 나누기) (DE-009)
    if (e.key === 'Enter' && !mod) {
      e.preventDefault();
      const cur = this.remove(true), view = cur?.ed.view;
      view?.someProp('handleKeyDown', (f) => f(view, new KeyboardEvent('keydown', { key: 'Enter', shiftKey: e.shiftKey })));
      return true;
    }
    // 글자: 지우기 + 친 글자 = 실행 취소 한 번 (DE-008)
    if (e.key.length === 1 && !mod && !e.altKey) { e.preventDefault(); const cur = this.remove(true); cur?.ed.view.dispatch(cur.ed.view.state.tr.insertText(e.key)); return true; }
    // 한글 등 입력기: 조합이 시작되기 전에 지우고 편집기로 초점을 넘긴다 (조합은 편집기에서 이어진다)
    if (e.key === 'Process' || e.keyCode === 229) { this.remove(true); return true; }
    return false;
  }

  /** 범위를 접고 그 끝(앞 · 뒤)에서 고치기 */
  private collapse(toStart: boolean): void {
    const r = this.range();
    if (!r) return;
    const pt = toStart ? { node: r.startContainer, offset: r.startOffset } : { node: r.endContainer, offset: r.endOffset };
    const part = (pt.node instanceof Element ? pt.node : pt.node.parentElement)?.closest<HTMLElement>('.dn-doc-text[data-part]');
    getSelection()?.removeAllRanges();
    const c = part && this.content(part);
    if (part && c) this.dv.word.open(part, { pos: posAtUnits(c.doc, unitsAtDom(part, pt.node, pt.offset)) });
  }

  /** 고른 범위 지우기 → 이은 자리에서 고치기. 고치는 편집기를 돌려준다. typing: 바로 이어 쓰는 글과 실행 취소 한 번 */
  remove(typing = false): DocWord['editor'] {
    const r = this.range();
    if (!r) return null;
    const parts = this.parts();
    const before = (el: Node, start: boolean) => r.comparePoint(el, start ? 0 : el.childNodes.length);
    // 첫 칸: 범위 시작이 든 칸, 아니면 시작 뒤 첫 칸 / 끝 칸: 끝이 든 칸, 아니면 끝 앞 마지막 칸
    const inPart = (n: Node) => (n instanceof Element ? n : n.parentElement)?.closest<HTMLElement>('.dn-doc-text[data-part]') ?? null;
    let A = inPart(r.startContainer), B = inPart(r.endContainer);
    if (A && !parts.includes(A)) A = null;
    if (B && !parts.includes(B)) B = null;
    A ??= parts.find((p) => before(p, true) >= 0) ?? null;
    B ??= [...parts].reverse().find((p) => before(p, false) <= 0) ?? null;
    const items = [...this.dv.page.querySelectorAll<HTMLElement>('.dn-doc-item')];
    const whole = (el: HTMLElement) => before(el, true) >= 0 && before(el, false) <= 0;
    const keepBlocks = new Set([A, B].map((p) => p && this.content(p)?.blockId).filter(Boolean));
    const blocks: Id[] = [], strokes: Id[] = [];
    for (const it of items) {
      if (!whole(it)) continue;
      if (it.dataset.strokes) strokes.push(...it.dataset.strokes.split(','));
      else if (it.dataset.id && !keepBlocks.has(it.dataset.id)) blocks.push(it.dataset.id);
    }
    const e = this.dv.opts.engine;
    const a = A && this.content(A), b = B && this.content(B);
    if (!A || !a || !B || !b || parts.indexOf(A) > parts.indexOf(B)) {
      // 글 칸이 없는 범위(그림 · 표만): 통째로 든 블록만
      getSelection()?.removeAllRanges();
      if (blocks.length || strokes.length) deleteAcross(e, { id: '', steps: [] }, null, [], blocks, strokes);
      return null;
    }
    const aPos = inPart(r.startContainer) === A ? posAtUnits(a.doc, unitsAtDom(A, r.startContainer, r.startOffset)) : posAtUnits(a.doc, 0);
    const bPos = inPart(r.endContainer) === B ? posAtUnits(b.doc, unitsAtDom(B, r.endContainer, r.endOffset)) : posAtUnits(b.doc, Number.MAX_SAFE_INTEGER);
    const middle = parts.slice(parts.indexOf(A) + 1, parts.indexOf(B)).map((p) => p.dataset.part!);
    let caret = aPos;
    const key = typing ? `text:${a.id}` : undefined; // 편집기 글 입력(editText)과 같은 mergeKey
    if (A === B) deleteAcross(e, { id: a.id, steps: deleteRangeSteps(a.doc, aPos, Math.max(aPos, bPos)) }, null, [], blocks, strokes, key);
    else {
      const x = crossDeleteSteps(a.doc, aPos, b.doc, bPos, a.role === 'title');
      caret = x.caret;
      deleteAcross(e, { id: a.id, steps: x.aSteps }, { id: b.id, steps: x.bSteps }, middle, blocks, strokes, key);
    }
    getSelection()?.removeAllRanges();
    this.dv.render();
    const el = this.dv.page.querySelector<HTMLElement>(`.dn-doc-text[data-part="${a.id}"]`);
    if (el && this.dv.word.open(el, { pos: caret }, { keepUndo: typing })) return this.dv.word.editor;
    return null;
  }

  /** 잘라내기: 브라우저 복사 내용 그대로 + 지우기 */
  cut(ev: ClipboardEvent): boolean {
    const r = this.range();
    // 초점이 문서 뷰 밖(다른 입력 칸 · 단추)이면 문서 범위를 지우지 않는다 — Delete와 같게 (DE-010)
    if (!r || !ev.clipboardData || !this.dv.root.contains(document.activeElement)) return false;
    ev.preventDefault();
    const box = document.createElement('div');
    box.append(r.cloneContents());
    ev.clipboardData.setData('text/plain', getSelection()!.toString());
    ev.clipboardData.setData('text/html', box.innerHTML);
    this.remove();
    return true;
  }

  /** 붙여넣기: 범위를 지우고 그 자리에. 블록 묶음이면 지운 뒤 false — 이어서 블록 붙여넣기가 지운 자리 블록 아래로 (DE-012) */
  paste(ev: ClipboardEvent): boolean {
    if (!this.active || !ev.clipboardData) return false;
    if (ev.clipboardData.types.includes(BLOCK_CLIP_MIME)) { this.remove(); return false; }
    const html = ev.clipboardData.getData('text/html'), text = ev.clipboardData.getData('text/plain');
    ev.preventDefault();
    const cur = this.remove(true);
    if (cur) { if (html) cur.ed.view.pasteHTML(html); else if (text) cur.ed.view.pasteText(text); }
    return true;
  }
}
