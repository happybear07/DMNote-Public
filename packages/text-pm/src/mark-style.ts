// 고른 글자에만 거는 꾸밈 표시: 글자 색 · 배경 색(노션) · 글자 크기 · 글꼴(워드). 상자 전체 꾸밈은 블록 필드(textColor · fontScale)라 따로다.
// 글자를 안 골랐으면 커서 자리의 "다음에 칠 글자" 표시(storedMarks)를 바꾼다. DOM을 쓰지 않는다.
import { stepFontScale } from '@dn/engine-core';
import type { MarkType } from 'prosemirror-model';
import type { Command, EditorState } from 'prosemirror-state';
import { cleanScale, schema } from './schema';

const M = schema.marks as Record<string, MarkType>;

/** 표시 하나를 고른 글자에 다시 건다 (attrs가 null이면 지운다) */
const setMark = (type: MarkType, attrs: Record<string, unknown> | null): Command => (state, dispatch) => {
  if (!dispatch) return true;
  const { from, to, empty, $from } = state.selection;
  if (empty) {
    const rest = (state.storedMarks ?? $from.marks()).filter((m) => m.type !== type);
    dispatch(state.tr.setStoredMarks(attrs ? [...rest, type.create(attrs)] : rest));
    return true;
  }
  const tr = state.tr.removeMark(from, to, type);
  if (attrs) tr.addMark(from, to, type.create(attrs));
  dispatch(tr.scrollIntoView());
  return true;
};

/** 고른 글자만 글자 색 · 배경 색 (빈 색이면 지움) */
export const markColor = (type: MarkType, color: string): Command => setMark(type, color ? { color } : null);

/** 고른 글자(없으면 커서 자리)의 표시 값 — 섞여 있으면 null, 없으면 none */
function markValue<T>(state: EditorState, type: MarkType, read: (attrs: Record<string, unknown>) => T, none: T): T | null {
  const { from, to, empty, $from } = state.selection;
  const of = (marks: readonly { type: MarkType; attrs: Record<string, unknown> }[]) => { const m = marks.find((x) => x.type === type); return m ? read(m.attrs) : none; };
  if (empty) return of(state.storedMarks ?? $from.marks());
  let found: T | null | undefined;
  state.doc.nodesBetween(from, to, (n) => { if (!n.isText) return; const c = of(n.marks); if (found === undefined) found = c; else if (found !== c) found = null; });
  return found === undefined ? none : found; // null = 섞임 (?? 로 쓰면 섞임이 사라진다)
}

/** 고른 글자의 글자 색 · 배경 색 — 섞여 있거나 없으면 null. 기본 형광은 'default' */
export function markColorAt(state: EditorState, kind: 'textColor' | 'bgColor'): string | null {
  return markValue<string | null>(state, kind === 'textColor' ? M.textColor! : M.highlight!, (a) => String(a.color || 'default'), null);
}

/** 고른 글자의 글자 크기 배율 (상자 크기에 곱함) — 표시가 없으면 1, 섞여 있으면 null */
export function fontSizeAt(state: EditorState): number | null {
  return markValue<number>(state, M.fontSize!, (a) => cleanScale(a.scale) ?? 1, 1);
}

/** 고른 글자의 글꼴 — 표시가 없으면 'sans'(기본), 섞여 있으면 null */
export function fontFamilyAt(state: EditorState): 'sans' | 'serif' | 'mono' | null {
  return markValue<'sans' | 'serif' | 'mono'>(state, M.fontFamily!, (a) => (a.family === 'mono' ? 'mono' : 'serif'), 'sans');
}

/** 고른 글자만 글꼴 ('sans' · 빈 값이면 지움) */
export function markFont(family: unknown): Command {
  return setMark(M.fontFamily!, family === 'serif' || family === 'mono' ? { family } : null);
}

/** 고른 글자만 글자 크기: 배율(1이면 지움) 또는 한 칸 위 · 아래(섞여 있으면 첫 글자 기준) */
export function markSize(to: number | 'up' | 'down'): Command {
  return (state, dispatch, view) => {
    let cur = fontSizeAt(state);
    if (cur === null) { const $f = state.doc.resolve(state.selection.from + 1); cur = cleanScale($f.marks().find((m) => m.type === M.fontSize)?.attrs.scale) ?? 1; }
    const next = to === 'up' || to === 'down' ? stepFontScale(cur, to === 'up' ? 1 : -1) : to;
    const s = cleanScale(next);
    return setMark(M.fontSize!, s ? { scale: s } : null)(state, dispatch, view);
  };
}

