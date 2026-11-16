// 구분선 그리기 (노트형 정리 NS-01, engine-core divider.ts): 캔버스는 블록 칸 가득 선 하나(가운데 라벨), 문서 뷰는 가로줄.
// 세로 구분선은 문서에서 건너뛴다(같은 줄 두 상자 사이의 열 막대가 같은 뜻). 선 모양은 data-line → CSS.
import type { DividerContent } from '@dn/engine-core';

/** 캔버스: 블록 칸에 선 */
export function renderDivider(c: DividerContent, el: HTMLElement): void {
  el.className = 'dn-divider';
  el.dataset.orient = c.orient;
  el.dataset.line = c.line ?? 'solid';
  el.setAttribute('role', 'separator');
  el.setAttribute('aria-orientation', c.orient === 'v' ? 'vertical' : 'horizontal');
  if (c.label) el.setAttribute('aria-label', c.label); else el.removeAttribute('aria-label');
  const label = c.label ? [Object.assign(document.createElement('span'), { className: 'dn-divider-label', textContent: c.label })] : [];
  el.replaceChildren(...label);
}

/** 문서 뷰 · 인쇄: 가로줄 (라벨은 가운데) — 세로선은 비운다 */
export function renderDividerDoc(c: DividerContent, el: HTMLElement): void {
  if (c.orient === 'v') { el.replaceChildren(); el.className = 'dn-doc-divider-v'; return; }
  renderDivider(c, el);
  el.classList.add('dn-doc-divider');
}
