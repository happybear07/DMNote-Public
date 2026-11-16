// 쪽 설정 (워드 레이아웃 › 여백 · 방향, 삽입 › 머리글 · 바닥글 · 쪽 번호): 문서 뷰 쪽 보기 · 인쇄 · PDF가 같이 쓴다.
// 종이는 A4(96dpi 794 × 1123px), 가로면 뒤집는다. 머리글 · 바닥글 글의 {쪽} · {전체 쪽} · {제목} · {날짜}는 쪽마다 바꿔 넣는다.
import type { Engine, TxResult } from './engine';
import type { PageMargin, PageNumberPos, PageSetup } from './model';
import { A4 } from './sheet';

/** 여백 고르기 (워드와 같은 이름 · 크기, px) */
export const PAGE_MARGINS: Readonly<Record<PageMargin, { readonly label: string; readonly t: number; readonly b: number; readonly l: number; readonly r: number }>> = {
  normal: { label: '보통', t: 96, b: 96, l: 96, r: 96 },
  narrow: { label: '좁게', t: 48, b: 48, l: 48, r: 48 },
  moderate: { label: '조금 좁게', t: 96, b: 96, l: 72, r: 72 },
  wide: { label: '넓게', t: 96, b: 96, l: 192, r: 192 },
};

export const PAGE_NUMBER_POS: Readonly<Record<PageNumberPos, string>> = {
  'bottom-center': '아래 가운데', 'bottom-right': '아래 오른쪽', 'top-right': '위 오른쪽', none: '없음',
};

/** 머리글 · 바닥글에 넣을 수 있는 자리 표시 */
export const PAGE_TOKENS = ['{쪽}', '{전체 쪽}', '{제목}', '{날짜}'] as const;

const MAX_TEXT = 200;

/** 종이 · 여백 (px) */
export interface PageGeom { readonly w: number; readonly h: number; readonly t: number; readonly b: number; readonly l: number; readonly r: number }

export function pageGeom(setup?: PageSetup): PageGeom {
  const m = PAGE_MARGINS[setup?.margin ?? 'normal'] ?? PAGE_MARGINS.normal;
  const land = !!setup?.landscape;
  return { w: land ? A4.h : A4.w, h: land ? A4.w : A4.h, t: m.t, b: m.b, l: m.l, r: m.r };
}

/** 쪽 설정 바꾸기 — 바꾼 것만 넘긴다. 기본값은 지워서 저장한다. 실행 취소 한 번 */
export function setPageSetup(engine: Engine, patch: PageSetup): TxResult<void> {
  const next: Record<string, unknown> = { ...(engine.note.pageSetup ?? {}), ...patch };
  for (const k of ['header', 'footer'] as const) {
    const v = typeof next[k] === 'string' ? (next[k] as string).replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT) : '';
    if (v) next[k] = v; else delete next[k];
  }
  if (!next.landscape) delete next.landscape;
  if (!next.skipFirst) delete next.skipFirst;
  if (!next.margin || next.margin === 'normal' || !(String(next.margin) in PAGE_MARGINS)) delete next.margin;
  if (!next.numbers || next.numbers === 'bottom-center' || !(String(next.numbers) in PAGE_NUMBER_POS)) delete next.numbers;
  const v = Object.keys(next).length ? (next as PageSetup) : undefined;
  return engine.transact((tx) => tx.setNote({ pageSetup: v }), { origin: 'user', label: '쪽 설정' });
}

/** 머리글 · 바닥글 글 → 이 쪽에 보일 글 */
export function fillPageText(tpl: string, v: { readonly page: number; readonly pages: number; readonly title: string; readonly date: string }): string {
  return tpl.replace(/\{(쪽|전체 쪽|제목|날짜|page|pages|title|date)\}/g, (_, k: string) => {
    if (k === '쪽' || k === 'page') return String(v.page);
    if (k === '전체 쪽' || k === 'pages') return String(v.pages);
    if (k === '제목' || k === 'title') return v.title;
    return v.date;
  });
}
