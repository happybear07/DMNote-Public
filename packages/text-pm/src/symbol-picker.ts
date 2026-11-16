// 기호 · 이모지 고르기 판 (워드 삽입 › 기호, 노션 /emoji): 커서 아래에 묶음 단추 + 칸 격자. 누르면 커서 자리에 넣고 닫는다.
// 이모지 판은 위에 찾기 칸 (한글 · 영어 검색어). Esc · 바깥 누르기로 닫는다.
import { CursorPicker } from './menu';
import { EMOJI, findEmoji, SYMBOL_GROUPS } from './symbols';

export type SymbolKind = 'symbol' | 'emoji';

export class SymbolPicker extends CursorPicker {
  open(kind: SymbolKind): void {
    this.close();
    const el = document.createElement('div');
    el.className = `dn-symbols dn-editor-pop dn-symbols-${kind}`;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', kind === 'emoji' ? '이모지' : '기호');
    el.addEventListener('mousedown', (e) => { if (!(e.target instanceof HTMLInputElement)) e.preventDefault(); });
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    const grid = document.createElement('div');
    grid.className = 'dn-symbols-grid';
    const fill = (chars: readonly string[]) => {
      grid.replaceChildren(...chars.map((c) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = c;
        b.title = c;
        b.addEventListener('click', () => this.insert(c));
        return b;
      }));
    };
    if (kind === 'emoji') {
      const q = document.createElement('input');
      q.className = 'dn-symbols-search';
      q.placeholder = '찾기 — 하트 · 완료 · smile …';
      q.setAttribute('aria-label', '이모지 찾기');
      q.addEventListener('input', () => fill(findEmoji(q.value, 200).map((x) => x.e)));
      q.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Escape') { this.close(); this.view.focus(); }
        if (e.key === 'Enter') { e.preventDefault(); const first = grid.querySelector('button'); if (first) this.insert(first.textContent ?? ''); } // 그 Enter가 편집기로 넘어가 줄이 생기지 않게
      });
      el.append(q, grid);
      fill(EMOJI.map((x) => x.e));
      requestAnimationFrame(() => q.focus());
    } else {
      const tabs = document.createElement('div');
      tabs.className = 'dn-symbols-tabs';
      SYMBOL_GROUPS.forEach((g, i) => {
        const t = document.createElement('button');
        t.type = 'button';
        t.textContent = g.name;
        t.addEventListener('click', () => { for (const x of tabs.children) x.classList.toggle('on', x === t); fill([...g.items]); });
        if (i === 0) t.classList.add('on');
        tabs.append(t);
      });
      el.append(tabs, grid);
      fill([...SYMBOL_GROUPS[0]!.items]);
    }
    this.show(el, (e) => { if (e.key === 'Escape') { e.stopPropagation(); this.close(); this.view.focus(); } });
  }

  private insert(c: string): void { if (c) this.put((tr) => tr.insertText(c)); }
}
