// 편집 중이 아닌 글 누르기: 링크(웹 · 상호 참조 · 노트) 열기 (캔버스) · 토글 화살표 · 할 일 상자 뒤집기 (캔버스 · 문서 뷰 공통)
import { editTexts, isTextContent, type Engine } from '@dn/engine-core';
import { flipAttrSteps, mediaSeek } from '@dn/text-pm';
import type { CanvasView } from './canvas-view';

export function openNoteLink(view: CanvasView, e: PointerEvent): boolean {
  const t = e.target as Element | null;
  // 웹 링크 (FR-030): 편집 중이 아닌 상자의 링크를 누르면 새 탭에서
  const web = t instanceof Element ? t.closest<HTMLAnchorElement>('a[href]:not(.dn-note-link)') : null;
  if (web && /^(https?:|mailto:)/i.test(web.getAttribute('href') ?? '')) {
    e.preventDefault();
    // 링크 자체의 클릭(target=_blank)은 막는다 — 안 막으면 탭이 두 번 열린다
    web.addEventListener('click', (ev) => ev.preventDefault(), { once: true });
    window.open(web.href, '_blank', 'noopener,noreferrer');
    return true;
  }
  // 녹음 재생 시각 (FR-044): 그 녹음을 그 시점부터
  const mt = t instanceof Element ? t.closest<HTMLElement>('.dn-media-time') : null;
  if (mt) { e.preventDefault(); mediaSeek(mt); return true; }
  // 상호 참조: 그 그림 · 표로
  const x = t instanceof Element ? t.closest<HTMLElement>('a.dn-xref[data-xref]:not(.missing)') : null;
  if (x) { e.preventDefault(); view.focusBlock(x.dataset.xref!); return true; }
  const a = t instanceof Element ? t.closest<HTMLElement>('a.dn-note-link[data-note]') : null;
  if (!a || !view.host.noteLinks || a.classList.contains('missing')) return false;
  e.preventDefault();
  view.host.noteLinks.open(a.dataset.note!);
  return true;
}

/** 편집 중이 아닌 글의 토글 화살표 · 할 일 상자 누르기 → 그 속성만 뒤집기 (캔버스 · 문서 뷰 공통) */
export function flipStatic(engine: Engine, e: MouseEvent, zoom = 1): boolean {
  const t = e.target as HTMLElement | null;
  if (!t?.closest) return false;
  let el: HTMLElement | null = null, attr: 'open' | 'checked' = 'open';
  const btn = t.closest('.dn-toggle-btn');
  if (btn) el = btn.parentElement;
  else {
    const li = t.closest<HTMLElement>('li[data-checked]');
    // 할 일 상자는 ::before라 따로 잡히지 않는다 — 항목 왼쪽 상자 폭만큼을 상자로 본다
    if (li && e.clientX - li.getBoundingClientRect().left < 18 * zoom) { el = li; attr = 'checked'; }
  }
  const partEl = el?.closest<HTMLElement>('[data-part]');
  if (!el?.dataset.pos || !partEl?.dataset.part) return false;
  const c = engine.getContent(partEl.dataset.part);
  if (!c || !isTextContent(c)) return false;
  const steps = flipAttrSteps(c.doc, Number(el.dataset.pos), attr);
  if (!steps) return false;
  e.preventDefault();
  editTexts(engine, [{ contentId: c.id, steps }], attr === 'open' ? '토글 접기/펼치기' : '할 일 체크');
  return true;
}
