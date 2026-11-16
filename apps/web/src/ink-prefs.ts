// 펜 · 형광펜 설정 기억 (이 기기 브라우저에만): 지금 색 · 더한 색(＋, 3개까지) · 굵기 · 종류. 노트를 바꾸거나 새로 고쳐도 그대로.
// 못 읽거나 이상한 값은 버리고 기본값 — 저장이 막혀도 그리기는 된다.
import { HL_KINDS, PEN_KINDS, type HlKind, type PenKind } from '@dn/engine-core';
import { EXTRA_COLORS, HIGHLIGHT_COLORS, INK_COLORS, setInkStyle, type CanvasView } from '@dn/engine-dom';

const KEY = 'dn:ink';
const hex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

interface InkPrefs { color: string; hlColor: string; colors: readonly string[]; hlColors: readonly string[]; width: number; hlWidth: number; pen: PenKind; hl: HlKind; penOnly: boolean; penOnlySet: boolean }

export function loadInkPrefs(view: CanvasView): void {
  let raw: Record<string, unknown> | null;
  try { raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Record<string, unknown> | null; } catch { return; }
  if (!raw || typeof raw !== 'object') return;
  const row = (v: unknown, base: readonly string[]) =>
    [...base, ...(Array.isArray(v) ? v.filter(hex).map((c) => c.toLowerCase()).filter((c, i, a) => !base.includes(c) && a.indexOf(c) === i).slice(0, EXTRA_COLORS) : [])];
  const colors = row(raw.extra, INK_COLORS), hlColors = row(raw.hlExtra, HIGHLIGHT_COLORS);
  setInkStyle(view, {
    colors, hlColors,
    ...(hex(raw.color) && colors.includes(raw.color) ? { color: raw.color } : {}),
    ...(hex(raw.hlColor) && hlColors.includes(raw.hlColor) ? { hlColor: raw.hlColor } : {}),
    ...(typeof raw.width === 'number' ? { width: raw.width } : {}),
    ...(typeof raw.hlWidth === 'number' ? { hlWidth: raw.hlWidth } : {}),
    ...((PEN_KINDS as readonly unknown[]).includes(raw.pen) ? { pen: raw.pen as PenKind } : {}),
    ...((HL_KINDS as readonly unknown[]).includes(raw.hl) ? { hl: raw.hl as HlKind } : {}),
  });
  // 펜 전용 (T4) — 저장된 값 그대로 (직접 바꾼 적이 있는지도)
  if (typeof raw.penOnly === 'boolean') { view.ink.penOnly = raw.penOnly; view.ink.penOnlySet = raw.penOnlySet === true; }
}

export function saveInkPrefs(ink: InkPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      color: ink.color, hlColor: ink.hlColor, extra: ink.colors.slice(INK_COLORS.length), hlExtra: ink.hlColors.slice(HIGHLIGHT_COLORS.length),
      width: ink.width, hlWidth: ink.hlWidth, pen: ink.pen, hl: ink.hl, penOnly: ink.penOnly, penOnlySet: ink.penOnlySet,
    }));
  } catch { /* 저장 못 해도 이번엔 그대로 */ }
}
