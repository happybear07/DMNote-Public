// 글 상자 위 고르기 메뉴의 공통 틀 — 슬래시(/) 메뉴 · 노트 링크 메뉴.
// 메뉴 상태는 에디터 문서가 아니라 화면 쪽에만 둔다 — 검색어는 보통 글자로 문서에 들어가고, 고르면 트리거부터 지운다.
import type { Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

/** 기준 사각형 바로 아래(모자라면 위)에 놓는다 — 좌표는 overlay 기준 */
export function placeNear(el: HTMLElement, c: { left: number; top: number; bottom: number }, overlay: HTMLElement): void {
  const o = overlay.getBoundingClientRect();
  const h = el.offsetHeight, w = el.offsetWidth;
  const below = c.bottom - o.top + 6;
  el.style.left = `${Math.max(8, Math.min(c.left - o.left, o.width - w - 8))}px`;
  el.style.top = `${below + h > o.height - 8 && c.top - o.top - h - 6 > 8 ? c.top - o.top - h - 6 : below}px`;
}

/** section: 묶음 머리 — 앞 줄과 다르면 머리 줄을 먼저 그린다 */
export interface MenuRow { icon: string | Element; label: string; hint: string; id?: string; ai?: boolean; section?: string }

/** 고르기 메뉴 한 줄 (dn-slash-item): 아이콘 · 이름 · 설명 — 이 틀 · 상호 참조 판 · 빈 캔버스의 붙여넣은 주소 메뉴(engine-dom)가 같이 쓴다 */
export function menuItem(r: MenuRow, on: boolean): HTMLDivElement {
  const b = document.createElement('div');
  b.className = `dn-slash-item${on ? ' on' : ''}${r.ai ? ' ai' : ''}`;
  b.setAttribute('role', 'option');
  b.setAttribute('aria-selected', String(on));
  if (r.id) b.dataset.id = r.id;
  const icon = Object.assign(document.createElement('span'), { className: 'dn-slash-icon' });
  icon.append(r.icon);
  const text = Object.assign(document.createElement('span'), { className: 'dn-slash-text' });
  text.append(Object.assign(document.createElement('b'), { textContent: r.label }), Object.assign(document.createElement('small'), { textContent: r.hint }));
  if (r.hint) b.title = r.hint;
  b.append(icon, text);
  return b;
}

export abstract class PopupMenu<T> {
  protected readonly el: HTMLDivElement;
  /** 트리거 첫 글자의 문서 위치 (열려 있을 때만) */
  protected from: number | null = null;
  protected shown: T[] = [];
  protected index = 0;

  constructor(protected readonly view: EditorView, private readonly overlay: HTMLElement, className: string, label: string, private readonly empty: string) {
    this.el = document.createElement('div');
    this.el.className = className;
    this.el.setAttribute('role', 'listbox');
    this.el.setAttribute('aria-label', label);
    this.el.hidden = true;
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    overlay.appendChild(this.el);
  }

  /** 에디터 트랜잭션마다: 트리거를 막 쳤으면 열고, 열려 있으면 검색어를 다시 읽는다 */
  abstract update(tr?: Transaction): void;
  protected abstract choose(it: T): void | Promise<void>;
  protected abstract row(it: T): MenuRow;

  /** 열린 위치를 트랜잭션에 맞춰 옮긴다. 닫혀 있고 커서 앞에 막 글자를 쳤으면 커서 앞 두 글자, 아니면 null */
  protected typed(tr?: Transaction): string | null {
    const sel = this.view.state.selection;
    if (this.from !== null && tr) this.from = tr.mapping.map(this.from, -1);
    if (this.from !== null || !tr?.docChanged || !sel.empty || !this.view.hasFocus()) return null;
    const $h = sel.$head;
    if ($h.parent.type.spec.code || $h.parentOffset < 1) return null;
    return $h.parent.textBetween(Math.max(0, $h.parentOffset - 2), $h.parentOffset, undefined, '￼');
  }

  /** 항목이 바뀌었으면 맨 위를 고른 채로 다시 그린다 */
  protected show(items: T[], key: (it: T) => string): void {
    if (items.map(key).join() !== this.shown.map(key).join()) this.index = 0;
    this.shown = items;
    this.render();
  }

  onKey(e: KeyboardEvent): boolean {
    if (this.from === null || e.isComposing) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const n = this.shown.length;
      if (n) { this.index = (this.index + (e.key === 'ArrowDown' ? 1 : n - 1)) % n; this.render(); }
      return true;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      const it = this.shown[this.index];
      if (!it) { this.close(); return true; } // 맞는 항목이 없으면 닫기만 — 그 Enter로 줄 · 제목이 나뉘지 않게 (DQ-031)
      void this.choose(it);
      return true;
    }
    if (e.key === 'Escape') { this.close(); return true; }
    return false;
  }

  private render(): void {
    const el = this.el;
    el.replaceChildren();
    if (!this.shown.length) el.appendChild(Object.assign(document.createElement('div'), { className: 'dn-slash-empty', textContent: this.empty }));
    let section: string | undefined;
    this.shown.forEach((it, i) => {
      const r = this.row(it);
      if (r.section && r.section !== section) el.appendChild(Object.assign(document.createElement('div'), { className: 'dn-slash-head', textContent: r.section }));
      else if (r.ai && i > 0) el.appendChild(Object.assign(document.createElement('div'), { className: 'dn-slash-sep' }));
      section = r.section;
      const b = menuItem(r, i === this.index);
      b.addEventListener('mousedown', (e) => { e.preventDefault(); void this.choose(it); });
      b.addEventListener('mousemove', () => { if (this.index !== i) { this.index = i; this.render(); } });
      el.appendChild(b);
    });
    el.hidden = false;
    placeNear(el, this.view.coordsAtPos(this.from!), this.overlay);
    el.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  }

  close(): void {
    this.from = null;
    this.shown = [];
    this.el.hidden = true;
  }

  destroy(): void { this.el.remove(); }
}

/** 커서 아래 고르기 판 공통 (기호 · 이모지 symbol-picker.ts · 상호 참조 xref.ts): 띄우기 · 바깥 누르기 · 창 키 · 넣기 · 닫기 */
export abstract class CursorPicker {
  private el: HTMLDivElement | null = null;
  private off: (() => void) | null = null;

  constructor(protected readonly view: EditorView, protected readonly overlay: HTMLElement) {}

  /** el을 커서 아래에 띄운다 — 바깥을 누르면 닫고, 키는 창 전체에서 key가 먼저 받는다 */
  protected show(el: HTMLDivElement, key: (e: KeyboardEvent) => void): void {
    this.overlay.append(el);
    this.el = el;
    placeNear(el, this.view.coordsAtPos(this.view.state.selection.head), this.overlay);
    const outside = (e: PointerEvent) => { if (!el.contains(e.target as Node)) this.close(); };
    setTimeout(() => { window.addEventListener('pointerdown', outside, true); window.addEventListener('keydown', key, true); }, 0);
    this.off = () => { window.removeEventListener('pointerdown', outside, true); window.removeEventListener('keydown', key, true); };
  }

  /** 닫고 커서 자리에 넣는다 (그사이 편집기가 없어졌으면 그만) */
  protected put(make: (tr: Transaction) => Transaction): void {
    this.close();
    const v = this.view;
    if (v.isDestroyed) return;
    v.dispatch(make(v.state.tr).scrollIntoView());
    v.focus();
  }

  close(): void {
    this.off?.();
    this.off = null;
    this.el?.remove();
    this.el = null;
  }
}
