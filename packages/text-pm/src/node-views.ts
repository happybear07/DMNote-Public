// 편집 중 NodeView — 할 일 체크 · 토글 버튼 · 콜아웃 아이콘(고르기 포함)
import type { Node as PMNode } from 'prosemirror-model';
import { TextSelection } from 'prosemirror-state';
import type { EditorView, NodeView, ViewMutationRecord } from 'prosemirror-view';
import { CALLOUT_COLORS, CALLOUT_ICONS } from './schema';
import { CODE_LANGUAGES } from './highlight';
import { installCodeCopy } from './code-copy';
import { iconElement, resolveIcon } from './icons';

/** 노드 속성을 따라 DOM을 맞추는 NodeView 공통 틀 */
export abstract class AttrView {
  constructor(protected node: PMNode, protected readonly view: EditorView, protected readonly getPos: () => number | undefined) {}
  protected abstract sync(): void;
  /** 이 노드 속성 바꾸기 — 노드가 이미 빠졌으면 false */
  protected set(attrs: Record<string, unknown>): boolean {
    const pos = this.getPos();
    if (pos === undefined) return false;
    this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, ...attrs }));
    return true;
  }
  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.sync();
    return true;
  }
}

// ───────── 코드 블록 (FR-026): 오른쪽 위 언어 고르기 ─────────
export class CodeBlockView extends AttrView implements NodeView {
  dom: HTMLPreElement;
  contentDOM: HTMLElement;
  private bar: HTMLSpanElement;
  private sel: HTMLSelectElement;
  constructor(node: PMNode, view: EditorView, getPos: () => number | undefined) {
    super(node, view, getPos);
    this.dom = document.createElement('pre');
    this.bar = document.createElement('span');
    this.bar.className = 'dn-code-lang';
    this.bar.contentEditable = 'false';
    this.sel = document.createElement('select');
    this.sel.setAttribute('aria-label', '코드 언어');
    for (const l of CODE_LANGUAGES) this.sel.append(new Option(l.name, l.id));
    this.sel.addEventListener('change', () => { if (this.set({ language: this.sel.value })) view.focus(); });
    this.bar.append(this.sel);
    this.contentDOM = document.createElement('code');
    this.dom.append(this.bar, this.contentDOM);
    this.sync();
    installCodeCopy();
  }
  protected override sync(): void {
    const lang = String(this.node.attrs.language ?? '');
    if (lang) this.dom.dataset.language = lang; else delete this.dom.dataset.language;
    this.sel.value = lang;
  }
  stopEvent(e: Event): boolean { return e.target instanceof Node && this.bar.contains(e.target); }
  ignoreMutation(m: ViewMutationRecord): boolean { return this.bar.contains(m.target); }
}

// ───────── 할 일 항목 (FR-033) ─────────
export class TaskItemView extends AttrView implements NodeView {
  dom: HTMLLIElement;
  contentDOM: HTMLDivElement;
  private box: HTMLSpanElement;
  constructor(node: PMNode, view: EditorView, getPos: () => number | undefined) {
    super(node, view, getPos);
    this.dom = document.createElement('li');
    this.box = document.createElement('span');
    this.box.className = 'dn-check';
    this.box.contentEditable = 'false';
    this.box.addEventListener('mousedown', (e) => { e.preventDefault(); this.set({ checked: !this.node.attrs.checked }); });
    this.contentDOM = document.createElement('div');
    this.dom.append(this.box, this.contentDOM);
    this.sync();
  }
  protected override sync(): void { this.dom.dataset.checked = String(this.node.attrs.checked); }
}

// ───────── 토글 (FR-047) ─────────
// 모양은 스키마 toDOM과 같게 만든다 (정적 렌더 ↔ 편집 전환 시 흔들림 없음)
export class ToggleView extends AttrView implements NodeView {
  dom: HTMLDivElement;
  contentDOM: HTMLDivElement;
  private btn: HTMLSpanElement;
  constructor(node: PMNode, view: EditorView, getPos: () => number | undefined) {
    super(node, view, getPos);
    this.dom = document.createElement('div');
    this.dom.dataset.type = 'toggle';
    this.btn = document.createElement('span');
    this.btn.className = 'dn-toggle-btn';
    this.btn.contentEditable = 'false';
    this.btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const pos = getPos();
      if (pos === undefined) return;
      const tr = view.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, open: !this.node.attrs.open });
      // 접으면서 커서가 숨는 내용 안에 있으면 요약 줄 끝으로 꺼낸다
      const { from } = view.state.selection;
      const summaryEnd = pos + this.node.firstChild!.nodeSize;
      if (this.node.attrs.open && from > summaryEnd && from < pos + this.node.nodeSize) tr.setSelection(TextSelection.create(tr.doc, summaryEnd));
      view.dispatch(tr);
    });
    this.contentDOM = document.createElement('div');
    this.contentDOM.className = 'dn-toggle-body';
    this.dom.append(this.btn, this.contentDOM);
    this.sync();
  }
  protected override sync(): void {
    this.dom.dataset.open = String(this.node.attrs.open);
    this.btn.setAttribute('aria-label', this.node.attrs.open ? '접기' : '펼치기');
  }
  ignoreMutation(m: ViewMutationRecord): boolean { return m.type === 'attributes' && (m.target === this.dom || m.target === this.btn); }
}

// ───────── 콜아웃 (FR-048) ─────────
const CALLOUT_COLOR_LABEL: Record<string, string> = { yellow: '노랑', blue: '파랑', green: '초록', red: '빨강', purple: '보라', gray: '회색' };

export class CalloutView extends AttrView implements NodeView {
  dom: HTMLDivElement;
  contentDOM: HTMLDivElement;
  private icon: HTMLSpanElement;
  private picker: HTMLDivElement | null = null;
  private readonly close = (e: Event) => { if (!this.picker?.contains(e.target as Node) && !this.icon.contains(e.target as Node)) this.hidePicker(); };
  constructor(node: PMNode, view: EditorView, getPos: () => number | undefined, private overlay: HTMLElement) {
    super(node, view, getPos);
    this.dom = document.createElement('div');
    this.dom.dataset.type = 'callout';
    this.icon = document.createElement('span');
    this.icon.className = 'dn-callout-icon';
    this.icon.contentEditable = 'false';
    this.icon.title = '아이콘 · 색 바꾸기';
    this.icon.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); if (this.picker) this.hidePicker(); else this.showPicker(); });
    this.contentDOM = document.createElement('div');
    this.contentDOM.className = 'dn-callout-body';
    this.dom.append(this.icon, this.contentDOM);
    this.sync();
  }
  protected override sync(): void {
    this.dom.dataset.color = this.node.attrs.color;
    const ic = this.node.attrs.icon as string;
    const name = resolveIcon(ic);
    if (name) { this.icon.dataset.icon = ic; this.icon.replaceChildren(iconElement(name)); }
    else { delete this.icon.dataset.icon; this.icon.textContent = ic; }
  }
  private showPicker(): void {
    const p = document.createElement('div');
    p.className = 'dn-callout-picker';
    const mk = (label: string | SVGElement, cls: string, run: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = cls;
      b.append(label);
      b.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); run(); });
      return b;
    };
    const icons = document.createElement('div');
    icons.className = 'dn-callout-icons';
    for (const ic of CALLOUT_ICONS) {
      const b = mk(iconElement(ic, 17), ic === this.node.attrs.icon ? 'on' : '', () => { this.set({ icon: ic }); this.hidePicker(); });
      b.setAttribute('aria-label', ic);
      icons.appendChild(b);
    }
    const colors = document.createElement('div');
    colors.className = 'dn-callout-colors';
    for (const c of CALLOUT_COLORS) {
      const b = mk('', `dn-swatch${c === this.node.attrs.color ? ' on' : ''}`, () => { this.set({ color: c }); this.hidePicker(); });
      b.dataset.color = c;
      b.title = CALLOUT_COLOR_LABEL[c] ?? c;
      b.setAttribute('aria-label', b.title);
      colors.appendChild(b);
    }
    p.append(icons, colors);
    p.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.overlay.appendChild(p);
    const r = this.icon.getBoundingClientRect(), o = this.overlay.getBoundingClientRect();
    p.style.left = `${Math.max(8, Math.min(r.left - o.left, o.width - p.offsetWidth - 8))}px`;
    p.style.top = `${r.bottom - o.top + 6}px`;
    this.picker = p;
    document.addEventListener('mousedown', this.close, true);
  }
  private hidePicker(): void {
    this.picker?.remove();
    this.picker = null;
    document.removeEventListener('mousedown', this.close, true);
  }
  ignoreMutation(m: ViewMutationRecord): boolean {
    return m.target === this.icon || m.target.parentNode === this.icon || (m.type === 'attributes' && m.target === this.dom);
  }
  destroy(): void { this.hidePicker(); }
}
