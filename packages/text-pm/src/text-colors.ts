// 글 일부의 글자 색 · 배경 색 (노션처럼 고른 글자만): 이름(테마가 다크에서 바꾼다 — CSS 변수) 또는 팔레트에서 고른 #rrggbb.
// 값은 engine-core normalizeTextColor로 다듬어 이름 · #rrggbb 말고는 받지 않는다(스타일에 그대로 넣으므로).
import { normalizeTextColor, TEXT_COLOR_NAMES } from '@dn/engine-core';

export const COLOR_NAMES = TEXT_COLOR_NAMES;
export const COLOR_LABEL: Readonly<Record<string, string>> = {
  gray: '회색', brown: '갈색', orange: '주황', yellow: '노랑', green: '초록', blue: '파랑', purple: '보라', pink: '분홍', red: '빨강',
};
/** 밝은 테마 글자 색 (다크는 --dn-tc-<이름>) */
export const TEXT_COLOR_HEX: Readonly<Record<string, string>> = {
  gray: '#787774', brown: '#9f6b53', orange: '#d9730d', yellow: '#cb912f', green: '#448361', blue: '#337ea9', purple: '#9065b0', pink: '#c14c8a', red: '#d44c47',
};
/** 밝은 테마 배경 색 — 블록 바탕색과 같은 톤 (다크는 --dn-block-<이름>) */
export const BG_COLOR_HEX: Readonly<Record<string, string>> = {
  gray: '#f1f1ef', brown: '#f4eeee', orange: '#fbecdd', yellow: '#fbf3db', green: '#edf3ec', blue: '#e7f3f8', purple: '#f4f0f7', pink: '#f9eef3', red: '#fdebec',
};

/** 받을 수 있는 색이면 다듬은 값, 아니면 '' */
export function cleanColor(c: unknown): string {
  return typeof c === 'string' ? normalizeTextColor(c) ?? '' : '';
}

const HEX = /^#[0-9a-f]{6}$/i;
/** 글자 색 CSS 값 (모르는 값이면 '') */
export function textColorCss(c: string): string {
  return TEXT_COLOR_HEX[c] ? `var(--dn-tc-${c}, ${TEXT_COLOR_HEX[c]})` : HEX.test(c) ? c : '';
}
/** 배경 색 CSS 값 (모르는 값이면 '') */
export function bgColorCss(c: string): string {
  return BG_COLOR_HEX[c] ? `var(--dn-block-${c}, ${BG_COLOR_HEX[c]})` : HEX.test(c) ? c : '';
}
