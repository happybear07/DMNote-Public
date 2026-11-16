// 목차 블록 그리기 (FR-053): 제목 목록(단계만큼 들여쓰기) — 누르면 그 블록으로 간다(캔버스: 이동 · 문서 뷰: 스크롤).
// 링크는 dn-ui — 캔버스 끌기 · 선택과 겹치지 않는다. 블록의 빈 곳(제목 줄)을 잡으면 목차 블록 자체를 옮길 수 있다.
import type { Id, TocEntry } from '@dn/engine-core';

export function renderToc(entries: readonly TocEntry[], el: HTMLElement, go: (blockId: Id) => void): void {
  el.className = 'dn-toc';
  const head = document.createElement('div');
  head.className = 'dn-toc-title';
  head.textContent = '목차';
  if (!entries.length) {
    const p = document.createElement('p');
    p.className = 'dn-toc-empty';
    p.textContent = '제목 상자나 제목 1~3을 쓰면 여기에 목차가 생겨요.';
    el.replaceChildren(head, p);
    return;
  }
  const nav = document.createElement('nav');
  nav.setAttribute('aria-label', '목차');
  const ol = document.createElement('ol');
  const top = Math.min(...entries.map((e) => e.level));
  for (const e of entries) {
    const li = document.createElement('li');
    li.className = `dn-toc-l${e.level - top + 1}`;
    const a = document.createElement('a');
    a.className = 'dn-toc-link dn-ui';
    a.href = '#';
    a.textContent = e.num ? `${e.num} ${e.text}` : e.text;
    a.dataset.block = e.blockId;
    a.addEventListener('click', (ev) => { ev.preventDefault(); go(e.blockId); });
    li.appendChild(a);
    ol.appendChild(li);
  }
  nav.appendChild(ol);
  el.replaceChildren(head, nav);
}
