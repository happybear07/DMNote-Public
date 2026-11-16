// 블록 글자 모양 그리기 (engine-core block-style.ts): 글꼴 → .dn-ff-*, 크기 배율 → --dn-fs, 글자 색 → --dn-text-color, 정렬 → 클래스.
// 캔버스 블록과 문서 뷰 항목이 같이 쓴다. 다크 테마 글자 색은 CSS 변수(--dn-tc-<색>)가 정한다.
import type { Block } from '@dn/engine-core';
import { TEXT_COLOR_HEX } from '@dn/text-pm';

/** 밝은 테마 글자 색 */
export const TEXT_COLORS: Record<string, string> = { ...TEXT_COLOR_HEX };

/** 글자 색 값 → CSS 색: 이름이면 테마 변수(다크 테마에서 바뀜), #rrggbb면 그대로. 모르는 값은 '' */
export function textColorCss(c: string | null | undefined): string {
  if (!c) return '';
  if (TEXT_COLORS[c]) return `var(--dn-tc-${c}, ${TEXT_COLORS[c]})`;
  return /^#[0-9a-f]{6}$/i.test(c) ? c : '';
}

export function applyTextStyle(el: HTMLElement, st: Pick<Block, 'fontScale' | 'fontFamily' | 'textColor' | 'align' | 'lineHeight' | 'indent' | 'firstLine' | 'spaceBefore' | 'spaceAfter'> | undefined): void {
  const s = el.style;
  // 첫 줄 들여쓰기 · 내어쓰기 (em) · 문단 앞뒤 간격 (px) — CSS .dn-fi-set · .dn-fi-hang · .dn-ps-set
  const fi = st?.firstLine ?? 0;
  if (fi) s.setProperty('--dn-fi', String(Math.abs(fi))); else s.removeProperty('--dn-fi');
  el.classList.toggle('dn-fi-set', fi > 0);
  el.classList.toggle('dn-fi-hang', fi < 0);
  for (const [k, v] of [['--dn-sb', st?.spaceBefore], ['--dn-sa', st?.spaceAfter]] as const) if (v) s.setProperty(k, `${v}px`); else s.removeProperty(k);
  el.classList.toggle('dn-ps-set', !!(st?.spaceBefore || st?.spaceAfter));
  // 글꼴: 명조 · 고정폭 (text.css .dn-ff-*)
  el.classList.toggle('dn-ff-serif', st?.fontFamily === 'serif');
  el.classList.toggle('dn-ff-mono', st?.fontFamily === 'mono');
  // 줄 간격: 설정값(--dn-lh, 문서 전체)을 이 블록만 덮는다 · 들여쓰기: 단계 × 24px (CSS .dn-ind-set)
  if (st?.lineHeight) s.setProperty('--dn-lh', String(st.lineHeight)); else s.removeProperty('--dn-lh');
  if (st?.indent) s.setProperty('--dn-ind', String(st.indent)); else s.removeProperty('--dn-ind');
  el.classList.toggle('dn-ind-set', !!st?.indent);
  if (st?.fontScale) s.setProperty('--dn-bfs', String(st.fontScale)); else s.removeProperty('--dn-bfs');
  el.classList.toggle('dn-fs-set', !!st?.fontScale);
  const tc = textColorCss(st?.textColor);
  if (tc) s.setProperty('--dn-text-color', tc); else s.removeProperty('--dn-text-color');
  el.classList.toggle('dn-tc', !!tc);
  el.classList.toggle('dn-al-center', st?.align === 'center');
  el.classList.toggle('dn-al-right', st?.align === 'right');
  el.classList.toggle('dn-al-justify', st?.align === 'justify');
}
