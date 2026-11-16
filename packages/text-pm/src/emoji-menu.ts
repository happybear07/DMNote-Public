// ':' 이모지 메뉴 (노션처럼): 띄어 쓴 뒤 ':'와 낱말(한글 · 영어)을 치면 맞는 이모지 후보 — Enter · Tab으로 ':낱말'을 이모지로 바꾼다.
// "10:30"처럼 글자에 붙은 ':'는 무시하고, 맞는 것이 없는 채로 띄어 쓰면 거둔다.
import type { Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { PopupMenu, type MenuRow } from './menu';
import { findEmoji, type EmojiItem } from './symbols';

export class EmojiMenu extends PopupMenu<EmojiItem> {
  constructor(view: EditorView, overlay: HTMLElement) {
    super(view, overlay, 'dn-emoji-menu', '이모지', '맞는 이모지가 없어요');
  }

  override update(tr?: Transaction): void {
    const before = this.typed(tr);
    const { state } = this.view;
    const sel = state.selection, $h = sel.$head;
    if (this.from === null) {
      if (!before?.endsWith(':') || !(before.length === 1 || /\s/.test(before[0]!))) return;
      this.from = $h.pos - 1;
      this.index = 0;
      return; // ':'만으로는 띄우지 않는다 — 낱말을 한 글자라도 쳐야
    }
    const from = this.from;
    const valid = sel.empty && $h.pos > from && $h.pos - from <= 20 && state.doc.textBetween(from, from + 1) === ':' && state.doc.resolve(from).parent === $h.parent;
    if (!valid) { this.close(); return; }
    const q = state.doc.textBetween(from + 1, $h.pos);
    if (!q) { this.shown = []; this.el.hidden = true; return; }
    const found = findEmoji(q);
    if (!found.length && /[\s:]$/.test(q)) { this.close(); return; }
    if (!found.length) { this.shown = []; this.el.hidden = true; return; }
    this.show(found, (x) => x.e);
  }

  /** 떠 있을 때만 키를 받는다 (낱말을 치기 전 ':'만 있을 때는 Enter가 그대로) */
  override onKey(e: KeyboardEvent): boolean {
    return this.el.hidden ? (e.key === 'Escape' && this.from !== null ? (this.close(), false) : false) : super.onKey(e);
  }

  protected choose(it: EmojiItem): void {
    const from = this.from;
    if (from === null) return;
    const head = this.view.state.selection.head;
    this.close();
    this.view.dispatch(this.view.state.tr.insertText(it.e, from, head).scrollIntoView());
    this.view.focus();
  }

  protected row(it: EmojiItem): MenuRow {
    return { icon: it.e, label: it.k[0] ?? it.e, hint: it.k.slice(1, 4).join(' · '), id: it.e };
  }
}
