// 상호 참조 (워드 삽입 › 상호 참조): 캡션 단 그림 · 표를 골라 글 속에 '그림 3'을 넣는다. 글자는 그때그때 지금 번호(schema.ts xref) —
// 차례가 바뀌어도 따라가고, 캡션이 없어지면 넣을 때 번호를 흐리게. 고르기 판은 ↑↓ · Enter · 누르기, Esc · 바깥 누르기로 닫기.
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import { CursorPicker, menuItem } from './menu';
import { RefLinkView } from './note-link';
import { schema, xrefLabel } from './schema';

export interface XrefTarget { id: string; label: string; caption: string }

/** 앱이 넘겨 주는 참조할 것 (캡션 단 그림 · 표, 문서 차례) · 그리로 가기 */
export interface XrefHost {
  targets(): XrefTarget[];
  open(id: string): void;
}

export class XrefPicker extends CursorPicker {
  constructor(view: EditorView, overlay: HTMLElement, private readonly host: XrefHost) { super(view, overlay); }

  open(): void {
    this.close();
    const items = this.host.targets();
    let index = 0;
    const el = document.createElement('div');
    el.className = 'dn-xref-menu dn-editor-pop';
    el.setAttribute('role', 'listbox');
    el.setAttribute('aria-label', '상호 참조');
    el.addEventListener('mousedown', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    const render = () => {
      el.replaceChildren();
      if (!items.length) el.append(Object.assign(document.createElement('div'), { className: 'dn-slash-empty', textContent: '캡션 단 그림 · 표가 없어요 — 블록 메뉴 › 캡션 달기' }));
      items.forEach((it, i) => {
        const row = menuItem({ icon: it.label.split(' ')[0] ?? '', label: it.label, hint: it.caption, id: it.id }, i === index);
        row.addEventListener('click', () => this.insert(it));
        row.addEventListener('mousemove', () => { if (index !== i) { index = i; render(); } });
        el.append(row);
      });
    };
    render();
    const key = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { if (items.length) { index = (index + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length; render(); } }
      else if (e.key === 'Enter' || e.key === 'Tab') { const it = items[index]; if (it) this.insert(it); else this.close(); }
      else if (e.key === 'Escape') this.close();
      else { this.close(); return; } // 다른 글자를 치면 닫고 그 글자는 그대로 들어간다
      e.preventDefault();
      e.stopPropagation();
    };
    this.show(el, key);
  }

  private insert(it: XrefTarget): void { this.put((tr) => tr.replaceSelectionWith(schema.nodes.xref!.create({ id: it.id, label: it.label }), false)); }
}

/** 편집 중 상호 참조: 누르면 그 그림 · 표로, 글자는 지금 번호 */
export class XrefView extends RefLinkView {
  constructor(node: PMNode, open?: (id: string) => void) {
    const id = node.attrs.id as string, label = node.attrs.label as string;
    super('dn-xref', { xref: id, label }, id, xrefLabel, label || '참조', open);
  }
}
