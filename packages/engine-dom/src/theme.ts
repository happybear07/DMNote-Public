// 캔버스(2D)에 그리는 색 — CSS 변수에서 읽는다 (FR-086 다크 테마). 변수가 없으면 밝은 테마 기본값.
// CSS로 그리는 블록 DOM과 캔버스로 그리는 격자 · 화살표 · 축소 모습이 같은 테마를 따르게 한다.
import type { Arrow, EffectiveArrowStyle, RelationTone } from '@dn/engine-core';
import { BLOCK_COLORS } from './constants';

export interface CanvasTheme {
  bg: string; card: string; line: string; text: string; muted: string;
  /** 바탕(--card)이 어두운지 — 검정 펜을 밝게 보일지 (AT-021) */
  dark: boolean;
  /** 용지(A4) 바깥 — 책상 */
  desk: string;
  grid: string; arrow: string; accent: string;
  /** 블록 색 이름 → 실제 색 (축소 모습 · PNG) */
  blocks: Record<string, string>;
  /** 관계 색 (v6, STRUCTURE-GUIDE 4.4 relation/*) — 화살표 색 이름도 이 이름으로 */
  tones: Record<RelationTone, string>;
}

/** 관계 색 기본값 (밝은 테마). 다크는 앱 CSS --dn-rel-* */
export const TONE_COLORS: Record<Exclude<RelationTone, 'secondary' | 'tertiary' | 'primary'>, string> = {
  purple: '#7c4fd6', orange: '#d9730d', green: '#2b593f', blue: '#4c6ef5', red: '#e03e3e', brown: '#9f6b53',
};

export function readTheme(el: Element): CanvasTheme {
  const cs = getComputedStyle(el);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  const card = v('--card', '#ffffff');
  return {
    bg: v('--bg', '#ffffff'), desk: v('--desk', '#ecebe7'), card, line: v('--line', '#e9e9e7'), text: v('--text', '#37352f'), muted: v('--muted', '#6b6b68'),
    dark: (luminance(card) ?? 1) < 0.2,
    grid: v('--dn-grid', '#dcdad5'), arrow: v('--dn-arrow', '#9b9a97'), accent: v('--accent', '#4c6ef5'),
    blocks: Object.fromEntries(Object.entries(BLOCK_COLORS).map(([k, hex]) => [k, v(`--dn-block-${k}`, hex)])),
    tones: {
      ...(Object.fromEntries(Object.entries(TONE_COLORS).map(([k, hex]) => [k, v(`--dn-rel-${k}`, hex)])) as Record<keyof typeof TONE_COLORS, string>),
      secondary: v('--muted', '#6b6b68'), tertiary: v('--dn-arrow', '#9b9a97'), primary: v('--text', '#37352f'),
    },
  };
}

/** 상대 밝기 0~1 (WCAG) — #rgb · #rrggbb · rgb(…)만 읽는다, 못 읽으면 null */
export function luminance(c: string): number | null {
  const s = c.trim().toLowerCase(), h = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s), m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(s);
  const hex = h ? (h[1]!.length === 3 ? [...h[1]!].map((d) => d + d).join('') : h[1]!) : '';
  const rgb = h ? [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) : m ? [m[1], m[2], m[3]].map(Number) : null;
  if (!rgb) return null;
  const [r, g, b] = rgb.map((x) => { const u = x / 255; return u <= 0.03928 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

const tones = new Map<string, 'k' | 'w' | null>();
/** 펜 색이 검정에 가까우면 'k', 흰색에 가까우면 'w' — 같은 쪽 바탕에서는 안 보인다 */
export function inkTone(color: string): 'k' | 'w' | null {
  let t = tones.get(color);
  if (t === undefined) { const l = luminance(color); t = l === null ? null : l < 0.05 ? 'k' : l > 0.8 ? 'w' : null; if (tones.size > 500) tones.clear(); tones.set(color, t); }
  return t;
}

/** 화면에 그릴 펜 색 (AT-021): 저장 색은 그대로 — 어두운 바탕 위 검정 펜 · 밝은 바탕 위 흰 펜만 글자색으로 보인다 */
export function shownInk(t: Pick<CanvasTheme, 'dark' | 'text'>, color: string): string {
  const k = inkTone(color);
  return (k === 'k' && t.dark) || (k === 'w' && !t.dark) ? t.text : color;
}

/** 화살표 색: 사용자가 고른 색(관계 색 이름 또는 CSS 색) > 관계 색 > 테마 기본 화살표 색 */
export function arrowColor(t: CanvasTheme, a: Pick<Arrow, 'style' | 'relation'> & Partial<Pick<Arrow, 'negated'>>, look: EffectiveArrowStyle): string {
  const c = a.style?.color;
  if (c) return t.tones[c as RelationTone] ?? c;
  return a.relation || a.negated ? t.tones[look.tone] : t.arrow;
}
