// 블록 글자 모양 (오른쪽 클릭 › 글자): 크기 배율 · 글꼴 · 글자 색 · 정렬. 블록 전체에 — 고른 블록 여럿이면 모두에 (한 번에 실행 취소).
// 배경색(style.color)과 따로 블록 필드(fontScale · textColor · align)에 — 기기 사이 동기화에서 서로 덮어쓰지 않는다. 기본값은 지운다.
import type { Engine, TxResult } from './engine';
import type { Id } from './model';

/** 한 칸 크게 · 작게(Ctrl+] · [)의 크기 배율 차례 (기본 1) */
export const FONT_SCALES = [0.75, 0.875, 1, 1.15, 1.3, 1.5, 1.75, 2, 2.5, 3] as const;
/** 글자 크기 칸은 배율 대신 px로 보인다(알파 10/31) — 기준은 설정 '글자 크기'가 기본일 때 내용 상자 본문(text.css 12.5px) · 제목 상자(canvas.css 17px) */
export const FONT_BASE_PX = { text: 12.5, title: 17 } as const;
/** 크기 칸 ▾ 목록 (px) — 기준 크기는 따로 '기본'으로 끼운다 */
export const FONT_PX_LIST = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48] as const;
/** 배율 → 보이는 px (소수 한 자리) */
export const pxOfScale = (scale: number, base: number): number => Math.round(base * scale * 10) / 10;
/** 친 px → 배율 (블록 배율 범위 0.5 ~ 4로 자름) */
export const scaleOfPx = (px: number, base: number): number => Math.max(0.5, Math.min(4, px / base));
/** 글자 색 이름 (화면 색은 테마가 정한다) */
export const TEXT_COLOR_NAMES = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'] as const;
export type BlockAlign = 'left' | 'center' | 'right' | 'justify';
/** 글꼴: 기본(고딕, 없음) · 명조 · 고정폭 — 시스템 글꼴만 쓴다(내려받기 없음) */
export const FONT_FAMILIES = ['serif', 'mono'] as const;
export type FontFamily = (typeof FONT_FAMILIES)[number];
export const FONT_FAMILY_LABEL: Record<FontFamily | 'sans', string> = { sans: '기본 (고딕)', serif: '명조', mono: '고정폭' };

/** 글자 색 값 다듬기: 이름(화면 색은 테마가) 또는 팔레트 · 직접 고른 #rrggbb(#rgb는 늘림, 소문자). 그 밖은 undefined */
export function normalizeTextColor(c: string | null | undefined): string | undefined {
  if (!c) return undefined;
  if ((TEXT_COLOR_NAMES as readonly string[]).includes(c)) return c;
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c);
  if (!m) return undefined;
  const h = m[1]!.toLowerCase();
  return `#${h.length === 3 ? [...h].map((x) => x + x).join('') : h}`;
}

/** 한 칸 더 크게 · 작게 */
export function stepFontScale(cur: number | undefined, dir: 1 | -1): number {
  const c = cur ?? 1;
  if (dir > 0) return FONT_SCALES.find((s) => s > c + 1e-6) ?? FONT_SCALES[FONT_SCALES.length - 1]!;
  return [...FONT_SCALES].reverse().find((s) => s < c - 1e-6) ?? FONT_SCALES[0];
}

/** fontStep: 블록마다 제 크기에서 한 칸 (여럿을 고르면 각자) */
export interface TextStylePatch {
  fontScale?: number | null; fontStep?: 1 | -1; textColor?: string | null; align?: BlockAlign | null;
  /** 글꼴 — null이면 기본 */
  fontFamily?: FontFamily | null;
  /** 줄 간격 배율 — null · 1이면 설정값으로 */
  lineHeight?: number | null;
  /** 들여쓰기 한 단계 더 · 덜 (0~8) */
  indentStep?: 1 | -1;
  /** 들여쓰기 단계를 바로 (0 · null이면 없음, 최대 8) — 문서 뷰 '클릭하여 입력' */
  indent?: number | null;
  /** 첫 줄 들여쓰기(양수) · 내어쓰기(음수) 글자 수, 0 · null이면 없음 */
  firstLine?: number | null;
  /** 문단 앞 · 뒤 간격 px, 0 · null이면 기본 */
  spaceBefore?: number | null;
  spaceAfter?: number | null;
}
/** 고를 수 있는 첫 줄 · 문단 간격 (서식 막대) */
export const FIRST_LINES = [0, 1, 2, -2] as const;
export const PARA_SPACES = [0, 6, 12, 18, 24] as const;
export const LINE_HEIGHTS = [1, 1.15, 1.5, 2, 2.5] as const;
export const MAX_INDENT = 8;

/** 글자 모양 바꾸기. null · 기본값이면 그 항목을 지운다. 바꾼 항목만 쓴다 */
export function setBlockTextStyle(engine: Engine, ids: readonly Id[], patch: TextStylePatch): TxResult<void> {
  return engine.transact((tx) => {
    for (const id of ids) {
      const b = engine.getBlock(id);
      if (!b) continue;
      const p: Record<string, unknown> = {};
      const fs = patch.fontStep ? stepFontScale(b.fontScale, patch.fontStep) : patch.fontScale;
      if (fs !== undefined) p.fontScale = fs === null || Math.abs(fs - 1) < 1e-6 ? undefined : Math.max(0.5, Math.min(4, fs));
      if (patch.textColor !== undefined) p.textColor = normalizeTextColor(patch.textColor);
      if (patch.fontFamily !== undefined) p.fontFamily = patch.fontFamily && (FONT_FAMILIES as readonly string[]).includes(patch.fontFamily) ? patch.fontFamily : undefined;
      if (patch.align !== undefined) p.align = patch.align && patch.align !== 'left' ? patch.align : undefined;
      if (patch.lineHeight !== undefined) p.lineHeight = !patch.lineHeight || patch.lineHeight === 1 ? undefined : Math.max(0.8, Math.min(3, patch.lineHeight));
      if (patch.firstLine !== undefined) p.firstLine = patch.firstLine ? Math.max(-4, Math.min(4, Math.round(patch.firstLine))) || undefined : undefined;
      for (const k of ['spaceBefore', 'spaceAfter'] as const) if (patch[k] !== undefined) p[k] = patch[k] ? Math.max(0, Math.min(72, Math.round(patch[k]!))) || undefined : undefined;
      if (patch.indent !== undefined) p.indent = patch.indent ? Math.max(0, Math.min(MAX_INDENT, Math.round(patch.indent))) || undefined : undefined;
      if (patch.indentStep) { const n = Math.max(0, Math.min(MAX_INDENT, (b.indent ?? 0) + patch.indentStep)); p.indent = n || undefined; }
      if (Object.keys(p).some((k) => (b as unknown as Record<string, unknown>)[k] !== p[k])) tx.set('block', id, p);
    }
  }, { origin: 'user', label: '글자 모양' });
}
