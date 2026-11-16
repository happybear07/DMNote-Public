// 문서 뷰 맨 끝 각주 목록 (워드 미주처럼): 문서 차례대로 모은 각주 글 — 글 속 번호(CSS 카운터 dn-fn)와 같은 차례라 번호가 맞는다.
// 인쇄 · PDF에도 그대로 (쪽 보기에서는 마지막 쪽 아래로 이어진다).
import { documentOrder, footnoteNotes, isTextContent, type Engine } from '@dn/engine-core';

export function syncFootnotes(page: HTMLElement, engine: Engine): void {
  const notes: string[] = [];
  for (const { block } of documentOrder(engine)) for (const c of engine.contentsOf(block.id)) if (isTextContent(c)) notes.push(...footnoteNotes(c.doc, true));
  let sec = page.querySelector<HTMLElement>(':scope > .dn-doc-footnotes');
  if (!notes.length) { sec?.remove(); return; }
  if (!sec) {
    sec = document.createElement('section');
    sec.className = 'dn-doc-footnotes';
    sec.setAttribute('aria-label', '각주');
  }
  const key = JSON.stringify(notes);
  if (sec.dataset.key !== key) {
    sec.dataset.key = key;
    const ol = document.createElement('ol');
    for (const n of notes) ol.append(Object.assign(document.createElement('li'), { textContent: n || '(빈 각주)' }));
    sec.replaceChildren(Object.assign(document.createElement('div'), { className: 'dn-doc-fn-title', textContent: '각주' }), ol);
  }
  page.append(sec); // 늘 맨 끝
}
