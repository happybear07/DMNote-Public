// 문서 뷰 쪽 보기 (워드의 인쇄 모양): 쪽 설정(engine-core page-setup.ts)의 종이 · 여백 위에 항목을 차례로 놓고,
// 쪽 바닥을 넘는 항목은 다음 쪽 맨 위로 민다. '쪽 나눔' 상자는 늘 새 쪽에서. 종이마다 머리글 · 바닥글 · 쪽 번호.
// 한 쪽보다 큰 항목(긴 글 상자)은 그 안의 문단 · 목록 줄 · 표 행 단위로 같은 규칙을 적용해 여백 · 쪽 사이 틈에 글이 걸리지 않게 한다 (DQ-015).
// 미는 것은 위쪽 여백(margin-top)만 — 표 행은 앞에 테두리 없는 빈 행(쪽 사이 띠)을 끼워 표가 쪽 끝에서 끊기게 (DQ-029).
// 인쇄에서는 여백 · 빈 행을 지우고 브라우저 쪽 나눔으로.
import { fillPageText, pageGeom, type PageGeom, type PageNumberPos } from '@dn/engine-core';
import { iconElement } from '@dn/text-pm';

export const PAGE_GAP = 24;
/** 긴 항목 안에서 쪽을 넘길 수 있는 가장 작은 단위 */
const UNIT = 'p, h1, h2, h3, h4, li, pre, blockquote, hr, tr, figure, img, .dn-math-block, [data-type="callout"], [data-type="toggle"]';
const PUSHED = 'dnPushed';
/** 표가 쪽을 넘는 자리에 끼운 빈 행 */
const SPACER = 'dnSpacer';

/** 종이 꾸밈: 크기 · 여백 · 머리글 · 바닥글 · 쪽 번호 — 문서 뷰가 쪽 설정으로 만들어 page에 적어 둔다 (복제해 PDF로 그릴 때도 같게) */
export interface SheetDeco {
  geom: PageGeom;
  header?: string | undefined;
  footer?: string | undefined;
  numbers?: PageNumberPos | undefined;
  skipFirst?: boolean | undefined;
  title?: string | undefined;
  date?: string | undefined;
}

/** page에 종이 꾸밈을 적고 폭 · 여백을 맞춘다 */
export function setSheetDeco(page: HTMLElement, deco: SheetDeco): void {
  const s = JSON.stringify(deco);
  if (page.dataset.sheet === s) return;
  page.dataset.sheet = s;
  const g = deco.geom;
  page.style.width = `${g.w}px`;
  page.style.padding = `${g.t}px ${g.r}px 0 ${g.l}px`;
  page.style.setProperty('--dn-content-h', `${g.h - g.t - g.b}px`); // 첫 쪽 표지가 본문 칸을 다 쓰게 (doc-cover.ts)
}

/** page에 적힌 종이 꾸밈 (없으면 A4 세로 · 보통 여백 · 아래 가운데 번호) */
export function sheetDeco(page: HTMLElement): SheetDeco {
  try {
    const d = JSON.parse(page.dataset.sheet ?? '') as SheetDeco | null;
    if (d?.geom) return d;
  } catch { /* 기본 */ }
  return { geom: pageGeom() };
}

/**
 * page의 맨 위 단계 항목들을 쪽에 맞춰 놓고, sheets에 종이 · 머리글 · 바닥글 · 쪽 번호를 그린다. 쪽 수를 돌려준다.
 * gap: 쪽 사이 틈 — 화면은 24, PDF로 그릴 때는 0
 */
export function paginate(page: HTMLElement, sheets: HTMLElement, isBreak: (el: HTMLElement) => boolean, gap = PAGE_GAP): number {
  const deco = sheetDeco(page), g = deco.geom;
  const STEP = g.h + gap, CONTENT_H = g.h - g.t - g.b;
  const items = [...page.children].filter((el): el is HTMLElement => el instanceof HTMLElement && el !== sheets);
  clearPushed(page);
  const pr = page.getBoundingClientRect();
  const scale = page.offsetHeight ? pr.height / page.offsetHeight || 1 : 1;
  const topOf = (el: HTMLElement) => (el.getBoundingClientRect().top - page.getBoundingClientRect().top) / scale;
  /** el을 쪽에 맞춰 밀고, 놓인 바닥을 돌려준다 */
  /** h: 함께 옮길 높이 (세로로 합친 칸으로 이어진 표 행 덩어리) */
  const place = (el: HTMLElement, forceNew: boolean, h = el.getBoundingClientRect().height / scale): number => {
    const top = topOf(el);
    const k = Math.max(0, Math.floor(top / STEP));
    const contentTop = k * STEP + g.t, contentBottom = k * STEP + g.h - g.b;
    let target = top;
    if (top < contentTop - 0.5) target = contentTop; // 앞 쪽 바닥 여백 · 쪽 사이에 걸치면 이 쪽 맨 위로
    else if ((forceNew && top > contentTop + 1) || (top + h > contentBottom && h <= CONTENT_H && top > contentTop + 1)) target = (k + 1) * STEP + g.t;
    // 겹치는 여백(margin collapse) 때문에 덜 움직일 수 있다 — 다시 재서 모자란 만큼 더
    for (let n = 0; n < 3 && Math.abs(target - topOf(el)) > 0.5; n++) push(el, target - topOf(el));
    return target + h;
  };
  let bottom = 0;
  items.forEach((el, i) => {
    const top = topOf(el), h = el.offsetHeight;
    const units = h > CONTENT_H && !el.querySelector('.dn-text-editing') ? leafUnits(el) : [];
    if (!units.length) { bottom = Math.max(bottom, place(el, i > 0 && isBreak(el))); return; }
    // 긴 항목: 먼저 항목 머리를 쪽 안으로, 그다음 줄 단위로
    if (i > 0 && isBreak(el)) place(el, true);
    else if (top < Math.floor(top / STEP) * STEP + g.t - 0.5) place(el, false);
    for (const u of units) place(u, false, u instanceof HTMLTableRowElement ? rowGroupHeight(u, scale) : undefined);
    bottom = Math.max(bottom, topOf(el) + el.getBoundingClientRect().height / scale);
  });
  const pages = Math.max(1, Math.ceil((bottom + g.b) / STEP));
  let papers = [...sheets.children].filter((el) => el.classList.contains('dn-doc-sheet')) as HTMLElement[];
  if (papers.length !== pages) {
    papers = Array.from({ length: pages }, () => Object.assign(document.createElement('div'), { className: 'dn-doc-sheet' }));
    sheets.replaceChildren(...papers);
  }
  papers.forEach((el, k) => { // 틈 · 크기가 바뀌어도(PDF · 쪽 설정) 자리를 맞춘다
    el.style.top = `${k * STEP}px`;
    el.style.width = `${g.w}px`;
    el.style.height = `${g.h}px`;
    el.dataset.page = String(k + 1);
    decorate(el, k, pages, deco);
  });
  page.style.minHeight = `${pages * STEP - gap}px`;
  return pages;
}

/** 종이 k의 머리글 · 바닥글 줄: [글 | 가운데 번호 | 오른쪽 번호] */
function decorate(sheet: HTMLElement, k: number, pages: number, d: SheetDeco): void {
  const g = d.geom, n = String(k + 1), pos = d.numbers ?? 'bottom-center', show = !(d.skipFirst && k === 0);
  const v = { page: k + 1, pages, title: d.title ?? '', date: d.date ?? '' };
  const line = (cls: string, text: string, num: 'c' | 'r' | null, top: boolean) => {
    let el = sheet.querySelector<HTMLElement>(`:scope > .${cls}`);
    if (!show || (!text && !num)) { el?.remove(); return; }
    if (!el) {
      el = document.createElement('div');
      el.className = cls;
      el.append(...['l', 'c', 'r'].map((x) => Object.assign(document.createElement('span'), { className: `dn-sheet-${x}` })));
      sheet.append(el);
    }
    el.style.cssText = `left:${g.l}px;right:${g.r}px;${top ? 'top' : 'bottom'}:${Math.round((top ? g.t : g.b) * 0.4)}px`;
    const [l, c, r] = [...el.children] as HTMLElement[];
    l!.textContent = text;
    for (const [s, key] of [[c!, 'c'], [r!, 'r']] as const) { s.textContent = num === key ? n : ''; s.classList.toggle('dn-sheet-num', num === key); }
  };
  line('dn-sheet-head', fillPageText(d.header ?? '', v), pos === 'top-right' ? 'r' : null, true);
  line('dn-sheet-foot', fillPageText(d.footer ?? '', v), pos === 'bottom-center' ? 'c' : pos === 'bottom-right' ? 'r' : null, false);
}

/**
 * 마지막 쪽 오른쪽 아래 바깥의 동그란 '+' (새 쪽) — 종이 층 안에 두어 쪽 나누기 계산에 끼지 않고, 문서와 함께 굴러가
 * 마지막 쪽 바닥이 보일 때만 보인다. onAdd가 없으면(보기 전용) 없앤다
 */
export function syncAddPage(sheets: HTMLElement, pages: number, onAdd: (() => void) | null, gap = PAGE_GAP): void {
  let b = sheets.querySelector<HTMLButtonElement>(':scope > .dn-page-add');
  if (!onAdd) { b?.remove(); return; }
  if (!b) {
    b = document.createElement('button');
    b.type = 'button';
    b.className = 'dn-page-add dn-ui';
    b.title = '새 쪽 — 맨 끝에 한 쪽 더';
    b.setAttribute('aria-label', '새 쪽');
    b.append(iconElement('plus', 20));
    // 문서 뷰의 빈 곳 누르기(끌어 고르기 · 새 문단)로 번지지 않게
    b.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
  }
  const g = sheets.parentElement ? sheetDeco(sheets.parentElement).geom : pageGeom();
  b.onclick = () => onAdd();
  b.style.left = `${g.w + 16}px`;
  b.style.top = `${pages * (g.h + gap) - gap - 44}px`;
  if (sheets.lastElementChild !== b) sheets.append(b);
}

/** 안에 다른 단위를 품지 않은 단위들 (문서 차례). 표는 칸 안 문단이 아니라 행 — 세로로 합친 칸으로 이어진 행들은 첫 행 하나로 */
function leafUnits(el: HTMLElement): HTMLElement[] {
  return [...el.querySelectorAll<HTMLElement>(UNIT)].filter((u) => (u instanceof HTMLTableRowElement ? groupEnd(u) !== null : !u.closest('td, th') && !u.querySelector(UNIT)));
}

/** 표 행 덩어리 (세로로 합친 칸으로 이어진 행들): 덩어리 첫 행이면 끝 행, 아니면(가운데 행 · 빈 행) null */
function groupEnd(tr: HTMLTableRowElement): HTMLTableRowElement | null {
  const rows = [...(tr.closest('table')?.rows ?? [])].filter((r) => !r.dataset[SPACER]);
  let until = -1, start: HTMLTableRowElement | null = null, end: HTMLTableRowElement | null = null;
  for (const [i, r] of rows.entries()) {
    if (i > until) { if (start === tr) return end; start = r; }
    end = r;
    for (const c of r.cells) until = Math.max(until, i + c.rowSpan - 1);
  }
  return start === tr ? end : null;
}

function rowGroupHeight(tr: HTMLTableRowElement, scale: number): number {
  const end = groupEnd(tr) ?? tr;
  return (end.getBoundingClientRect().bottom - tr.getBoundingClientRect().top) / scale;
}

/** 위로 by만큼 더 민다. 표 행은 앞에 빈 행을 끼워(쪽 사이 띠 — 세로 칸 선이 여백 · 틈을 가로지르지 않게), 표 첫 행이면 표째 */
function push(el: HTMLElement, by: number): void {
  if (el instanceof HTMLTableRowElement) {
    const table = el.closest('table');
    if (table && [...table.rows].find((r) => !r.dataset[SPACER]) === el) { push(table, by); return; }
    const prev = el.previousElementSibling;
    let sp = prev instanceof HTMLTableRowElement && prev.dataset[SPACER] ? prev : null;
    if (!sp) {
      sp = document.createElement('tr');
      sp.dataset[SPACER] = '1';
      sp.setAttribute('aria-hidden', 'true');
      const td = sp.insertCell();
      td.className = 'dn-page-gap';
      td.colSpan = Math.max(1, ...[...(table?.rows ?? [])].map((r) => [...r.cells].reduce((n, c) => n + c.colSpan, 0)));
      el.before(sp);
    }
    const td = sp.cells[0]!;
    td.style.height = `${Math.max(0, (parseFloat(td.style.height) || 0) + by)}px`;
    return;
  }
  el.dataset[PUSHED] = '1';
  el.style.marginTop = `${(parseFloat(getComputedStyle(el).marginTop) || 0) + by}px`;
}

function clearPushed(page: HTMLElement): void {
  for (const el of page.querySelectorAll<HTMLElement>(`[data-dn-pushed]`)) {
    el.style.marginTop = '';
    delete el.dataset[PUSHED];
  }
  for (const r of page.querySelectorAll('tr[data-dn-spacer]')) r.remove();
}

/** 쪽 보기를 끌 때: 민 여백 · 종이 · 종이 폭을 지운다 */
export function unpaginate(page: HTMLElement, sheets: HTMLElement): void {
  clearPushed(page);
  sheets.replaceChildren();
  page.style.minHeight = '';
  page.style.width = '';
  page.style.padding = '';
  delete page.dataset.sheet;
}
