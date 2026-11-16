// 고르기 막대의 색 판 (노션 "A" 색 메뉴): 글자 색 10 (기본 + 9) · 배경 색 10. 고른 글자에만 칠한다 — 블록 전체 색은 블록 메뉴 · 서식 막대.
import { bgColorCss, COLOR_LABEL, COLOR_NAMES, textColorCss } from './text-colors';

export type MarkColorKind = 'textColor' | 'bgColor';

/** 판 하나. current: 고른 글자의 지금 색 (없으면 null) */
export function colorPanel(current: { text: string | null; bg: string | null }, pick: (kind: MarkColorKind, color: string | null) => void): HTMLDivElement {
  const panel = Object.assign(document.createElement('div'), { className: 'dn-color-panel' });
  panel.setAttribute('role', 'menu');
  panel.setAttribute('aria-label', '글자 색 · 배경 색');
  const row = (kind: MarkColorKind, title: string) => {
    panel.append(Object.assign(document.createElement('div'), { className: 'dn-color-title', textContent: title }));
    const grid = Object.assign(document.createElement('div'), { className: 'dn-color-row' });
    const now = kind === 'textColor' ? current.text : current.bg;
    for (const c of [null, ...COLOR_NAMES]) {
      const b = Object.assign(document.createElement('button'), { type: 'button', textContent: '가' });
      const name = c ? COLOR_LABEL[c] : '기본';
      b.title = kind === 'textColor' ? `글자 색: ${name}` : `배경 색: ${name}`;
      b.setAttribute('aria-label', b.title);
      b.className = `dn-color-sw${now === c ? ' on' : ''}`;
      if (kind === 'textColor' && c) b.style.color = textColorCss(c);
      if (kind === 'bgColor' && c) b.style.background = bgColorCss(c);
      if (kind === 'bgColor' && !c) b.classList.add('none');
      b.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      b.addEventListener('click', () => pick(kind, c));
      grid.append(b);
    }
    panel.append(grid);
  };
  row('textColor', '글자 색');
  row('bgColor', '배경 색');
  return panel;
}
