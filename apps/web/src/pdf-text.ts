// PDF 글자 층 · 링크 · 책갈피 재기 (pdf.ts): 쪽으로 나눈 문서 DOM(rasterizePages가 화면 밖에 붙인 복제본)에서
// 줄마다 글자와 자리를 잰다. 쪽 그림 위 같은 자리에 보이지 않는 글자를 깔아 고르기 · 찾기 · 복사가 되게 한다 (스캔 문서의 OCR 글자 층과 같은 방식).
import type { PdfLink, PdfOutline, PdfTextRun } from './pdf';

/** 글자 층에 넣지 않는 곳: 편집 단추 · 수식의 숨은 MathML(그려진 수식 글자만) */
const SKIP = '.dn-ui:not(.dn-toc-link):not(.dn-caption), .katex-mathml, script, style, .dn-doc-gap';

export interface PageLayer { runs: PdfTextRun[]; links: PdfLink[] }

/** page(.dn-doc-page) 안 글자 · 링크 · 제목 → 쪽마다. 자리는 그 쪽 왼쪽 위 기준 CSS px, 쪽 사이 틈 없음(pageH 간격) */
export function measurePdfLayer(page: HTMLElement, pageH: number, pages: number): { layers: PageLayer[]; outline: PdfOutline[] } {
  const base = page.getBoundingClientRect();
  const layers: PageLayer[] = Array.from({ length: pages }, () => ({ runs: [], links: [] }));
  const at = (r: { top: number; left: number; height: number }) => {
    const y = r.top - base.top, k = Math.min(pages - 1, Math.max(0, Math.floor((y + r.height / 2) / pageH)));
    return { k, x: r.left - base.left, y: y - k * pageH };
  };
  // 글자: 글 조각마다 한 글자씩 재서 같은 줄에 이어지는 것끼리 묶는다
  const walker = document.createTreeWalker(page, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (!n.nodeValue?.trim() || n.parentElement?.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const range = document.createRange();
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const s = n.nodeValue!;
    let cur: { k: number; x: number; y: number; right: number; h: number; text: string } | null = null;
    const flush = () => { if (cur?.text.trim()) layers[cur.k]!.runs.push({ x: cur.x, y: cur.y, w: cur.right - cur.x, h: cur.h, text: cur.text }); cur = null; };
    for (let i = 0; i < s.length;) {
      const cp = s.codePointAt(i)!, len = cp > 0xffff ? 2 : 1;
      range.setStart(n, i);
      range.setEnd(n, i + len);
      i += len;
      const r = range.getBoundingClientRect();
      if (!r.width && !r.height) continue; // 접힌 공백
      const p = at(r), ch = String.fromCodePoint(cp);
      const left = r.left - base.left;
      if (cur && p.k === cur.k && Math.abs(p.y - cur.y) < cur.h / 2 && left >= cur.right - 2 && left - cur.right < cur.h * 2) {
        cur.text += ch;
        cur.right = r.right - base.left;
        cur.h = Math.max(cur.h, r.height);
      } else {
        flush();
        cur = { k: p.k, x: p.x, y: p.y, right: r.right - base.left, h: r.height, text: ch };
      }
    }
    flush();
  }
  // 링크: 웹 주소는 그대로, 상호 참조 · 목차는 그 블록이 놓인 쪽 · 자리로
  const place = (a: Element, link: Omit<PdfLink, 'x' | 'y' | 'w' | 'h'>) => {
    for (const r of a.getClientRects()) { const p = at(r); layers[p.k]!.links.push({ x: p.x, y: p.y, w: r.width, h: r.height, ...link }); }
  };
  for (const a of page.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const href = a.getAttribute('href') ?? '';
    if (!/^(https?:|mailto:)/i.test(href)) continue;
    try { place(a, { href: new URL(href).href }); } catch { /* 읽을 수 없는 주소 */ }
  }
  const itemAt = (id: string) => {
    const el = page.querySelector(`.dn-doc-item[data-id="${CSS.escape(id)}"]`);
    if (!el) return null;
    const p = at(el.getBoundingClientRect());
    return { page: p.k, y: p.y };
  };
  for (const a of page.querySelectorAll<HTMLElement>('a.dn-xref[data-xref]:not(.missing), a.dn-toc-link[data-block]')) {
    const dest = itemAt(a.dataset.xref ?? a.dataset.block ?? '');
    if (dest) place(a, { dest });
  }
  // 책갈피: 제목 상자 = 1단계, 제목 1~4 = 1~4단계 (목차와 같게)
  const outline: PdfOutline[] = [];
  for (const el of page.querySelectorAll<HTMLElement>('.dn-doc-title, .dn-doc-text:not(.dn-doc-title) :is(h1, h2, h3, h4)')) {
    const title = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!title) continue;
    const p = at(el.getBoundingClientRect());
    outline.push({ title, level: el.classList.contains('dn-doc-title') ? 1 : Number(el.tagName[1]), page: p.k, y: p.y });
  }
  return { layers, outline };
}
