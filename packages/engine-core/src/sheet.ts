// 용지 — A4 페이지 캔버스: 끝없는 캔버스 대신 A4 종이를 위에서 아래로 이어 붙인다.
// 블록은 종이 폭 안에 놓이고, 내용이 아래로 넘치면 페이지가 늘어난다(사용자가 '+ 페이지'로 미리 늘릴 수도 있다).
// 크기는 96dpi 기준 A4(210 × 297mm = 794 × 1123px) — 인쇄 · PDF와 같은 비율.
// 쪽마다 가로 · 세로 (11/03, sheet.orient): 쪽은 왼쪽(x 0)에 맞춰 위에서 아래로 — 쪽마다 폭 · 높이가 다를 수 있다.
import type { Engine, TxResult } from './engine';
import type { Note, NoteSheet } from './model';
import { freeStrokes, strokeBounds } from './ink';
import type { Rect } from './geom';

export const A4 = { w: 794, h: 1123 } as const;
/** 페이지 사이 간격 · 종이 안쪽 여백(블록을 놓을 수 있는 가장자리) */
export const SHEET_GAP = 40;
export const SHEET_PAD = 24;

/** 끝없는 캔버스도 끝은 있다: 블록을 놓고 화면을 옮길 수 있는 범위 (월드 px, 18000 × 18000) */
export const BOARD: Rect = { x: -6000, y: -6000, w: 18000, h: 18000 };

/** 용지 없는 노트의 범위 = 보드 ∪ 지금 블록 — 이미 밖에 있는 블록(옛 노트 · 긴 문서)도 늘 닿게. 용지 노트면 null */
export function boardBounds(engine: Engine): Rect | null {
  if (engine.note.sheet) return null;
  const c = engine.blocksBounds();
  if (!c) return BOARD;
  const x = Math.min(BOARD.x, c.x), y = Math.min(BOARD.y, c.y);
  return { x, y, w: Math.max(BOARD.x + BOARD.w, c.x + c.w) - x, h: Math.max(BOARD.y + BOARD.h, c.y + c.h) - y };
}

/** 한 쪽: 위 끝 y · 폭 · 높이 (왼쪽 끝은 늘 x 0) */
export interface SheetPage { readonly y: number; readonly w: number; readonly h: number; readonly landscape: boolean }

export interface SheetGeom {
  /** 가장 넓은 쪽 폭 (화면 범위) · 첫 쪽 높이 (맞춤) */
  readonly w: number; readonly h: number;
  readonly gap: number;
  readonly pages: number;
  /** 모든 페이지를 합친 높이 */
  readonly total: number;
  /** 쪽마다 (위 → 아래) */
  readonly list: readonly SheetPage[];
  /** 목록 뒤(아직 없는 쪽)의 방향 = 노트 기본 */
  readonly landscape: boolean;
  /** 표지 쪽 (1쪽 바로 위, 차례 -1) — 없으면 undefined */
  readonly cover?: SheetPage;
}

/** 표지 쪽 크기 — A4 세로 (책 표지 비율) */
export const COVER = A4;
/** A4 노트의 표지 쪽 왼쪽 위 — 1쪽 바로 위 */
export const SHEET_COVER_AT = { x: 0, y: -(A4.h + SHEET_GAP) } as const;
/** 표지 쪽 자리 (없으면 null) */
export function coverRect(note: Note): Rect | null {
  const c = note.coverPage;
  return c ? { x: c.x, y: c.y, w: COVER.w, h: COVER.h } : null;
}
/** r의 왼쪽 위가 표지 안인가 */
export function inCover(cover: Rect | null, r: { readonly x: number; readonly y: number }): boolean {
  return !!cover && r.x >= cover.x - 0.5 && r.x < cover.x + cover.w && r.y >= cover.y - 0.5 && r.y < cover.y + cover.h;
}
/** 블록을 놓을 수 있는 가장 위 — 표지 쪽이 있으면 그 위 여백 아래 */
export const sheetTop = (g: SheetGeom): number => (g.cover?.y ?? 0) + SHEET_PAD;

/** 내용이 아무리 아래에 있어도 쪽은 이만큼까지만 센다 */
const MAX_PAGES = 1000;
const pageSize = (land: boolean) => (land ? { w: A4.h, h: A4.w } : { w: A4.w, h: A4.h });

/** i번째 쪽(0부터)이 가로인가 — 쪽마다 정한 방향, 없으면 노트 기본 */
export function pageLandscape(s: NoteSheet, i: number): boolean {
  const o = s.orient?.[i];
  return o ? o === 'landscape' : !!s.landscape;
}

/** 내용의 아래 끝 (블록 · 블록에 묶이지 않은 필기) */
export function contentBottom(engine: Engine): number {
  let b = 0;
  for (const x of engine.blocks()) b = Math.max(b, x.y + x.h);
  for (const s of freeStrokes(engine)) { const r = strokeBounds(s); b = Math.max(b, r.y + r.h); }
  return b;
}

/** 이 노트의 종이 모양 — 용지가 없으면 null. bottom: 내용 아래 끝 (넘치면 페이지가 늘어난다) */
export function sheetGeom(note: Note, bottom = 0): SheetGeom | null {
  const s = note.sheet;
  if (!s) return null;
  const min = Math.max(1, s.pages ?? 1), list: SheetPage[] = [];
  let y = 0;
  do {
    const land = pageLandscape(s, list.length), size = pageSize(land);
    list.push({ y, ...size, landscape: land });
    y += size.h + SHEET_GAP;
  } while (list.length < MAX_PAGES && (list.length < min || bottom > y));
  const last = list[list.length - 1]!, c = note.coverPage;
  return {
    w: Math.max(...list.map((p) => p.w)), h: list[0]!.h, gap: SHEET_GAP, pages: list.length, total: last.y + last.h, list, landscape: !!s.landscape,
    ...(c ? { cover: { y: c.y, w: COVER.w, h: COVER.h, landscape: false } } : {}),
  };
}

/** i번째 쪽 — 목록 뒤면 노트 기본 방향으로 이어 붙인 쪽, -1이면 표지 쪽 */
export function pageNo(g: SheetGeom, i: number): SheetPage {
  if (i < 0 && g.cover) return g.cover;
  if (i < g.list.length) return g.list[Math.max(0, i)]!;
  const last = g.list[g.list.length - 1]!, d = pageSize(g.landscape);
  return { y: last.y + last.h + g.gap + (i - g.list.length) * (d.h + g.gap), ...d, landscape: g.landscape };
}

/** y가 든 쪽과 그 차례 (쪽 아래 틈은 그 쪽, 0보다 위는 표지 쪽 -1 · 없으면 첫 쪽) */
export function pageAt(g: SheetGeom, y: number): SheetPage & { readonly i: number } {
  if (g.cover && y < 0) return { ...g.cover, i: -1 };
  const last = g.list[g.list.length - 1]!, end = last.y + last.h + g.gap;
  if (y >= end) {
    const d = pageSize(g.landscape), k = g.list.length + Math.floor((y - end) / (d.h + g.gap));
    return { ...pageNo(g, k), i: k };
  }
  let i = 0;
  while (i + 1 < g.list.length && y >= g.list[i + 1]!.y) i++;
  return { ...g.list[i]!, i };
}

/**
 * 쪽 사이 틈에 걸치지 않는 y (CQ-009): 한 쪽에 들어가는 높이면, 쪽 아래 여백을 넘거나 틈에 놓이면 다음 쪽 위 여백 아래로 (워드처럼 다음 쪽으로).
 * 위 여백에 끼면 여백 아래로. 한 쪽보다 크면 그대로
 */
export function pageY(g: SheetGeom, y: number, h: number, up = false): number {
  const p = pageAt(g, g.cover ? y : Math.max(0, y));
  if (h > p.h - 2 * SHEET_PAD) return y;
  // 위로 옮기는 중이면 앞 쪽 아래 여백 위로 (다음 쪽으로 밀어내면 위 쪽으로 넘어갈 수 없다)
  if (y + h > p.y + p.h - SHEET_PAD) return up ? p.y + p.h - SHEET_PAD - h : pageNo(g, p.i + 1).y + SHEET_PAD;
  if (y < p.y + SHEET_PAD) {
    if (!up || p.i === -1 || (p.i === 0 && !g.cover)) return p.y + SHEET_PAD;
    const q = pageNo(g, p.i - 1);
    return q.y + q.h - SHEET_PAD - h;
  }
  return y;
}

/** 블록 자리를 종이 폭 안으로 (위로도 넘지 않게, 쪽 사이 틈에 걸치지 않게). 종이보다 넓으면 종이 폭에 맞춘다 */
export function clampToSheet(g: SheetGeom, r: Rect): Rect {
  const y = Math.round(pageY(g, Math.max(sheetTop(g), r.y), r.h)), pw = pageAt(g, y).w; // 쪽마다 폭이 다르다 — 놓일 쪽의 폭으로
  const w = Math.min(r.w, pw - 2 * SHEET_PAD);
  return { x: Math.round(Math.max(SHEET_PAD, Math.min(r.x, pw - SHEET_PAD - w))), y, w, h: r.h };
}

// 용지 바꾸기(setNoteSheet — 끝없는 캔버스 → A4 · 가로 ↔ 세로)는 sheet-convert.ts

/** 페이지 늘리기 · 줄이기 (내용이 있는 페이지 아래로는 줄지 않는다) */
export function setSheetPages(engine: Engine, pages: number): TxResult<void> {
  return engine.transact((tx) => {
    const s = engine.note.sheet;
    if (!s) return;
    const g = sheetGeom({ ...engine.note, sheet: { ...s, pages: 1 } }, contentBottom(engine))!;
    const n = Math.max(g.pages, Math.min(200, Math.round(pages)));
    if (n === (s.pages ?? 1)) return;
    // 없어진 쪽의 방향은 지운다 (다시 늘리면 노트 기본 방향)
    const orient = Object.fromEntries(Object.entries(s.orient ?? {}).filter(([k]) => +k < n));
    const { orient: _o, ...rest } = s;
    tx.setNote({ sheet: { ...rest, pages: n, ...(Object.keys(orient).length ? { orient } : {}) } });
  }, { origin: 'user', label: '페이지 수' });
}

/** 놓을 수 있는 자리인가 (용지가 없으면 늘 그렇다) — 빈자리 찾기(findDockSpot)에 넘긴다 */
export function sheetFits(engine: Engine): (r: Rect) => boolean {
  const g = engine.note.sheet ? sheetGeom(engine.note, contentBottom(engine)) : null;
  if (!g) return () => true;
  return (r) => r.x >= SHEET_PAD - 0.5 && r.x + r.w <= pageAt(g, r.y).w - SHEET_PAD + 0.5 && r.y >= sheetTop(g) - 0.5 && Math.abs(pageY(g, r.y, r.h) - r.y) < 0.5;
}

/** 용지가 있는 노트면 새 블록 자리를 종이 안으로, 없으면 그대로 */
export function clampToNoteSheet(engine: Engine, r: Rect): Rect {
  const g = engine.note.sheet ? sheetGeom(engine.note, contentBottom(engine)) : null;
  return g ? clampToSheet(g, r) : r;
}

/**
 * 쪽 하나만 가로 · 세로로 (11/03). 그 아래 쪽 내용은 높이가 바뀐 만큼 같이 옮기고, 좁아지면 그 쪽 블록 · 필기를 쪽 폭 안으로,
 * 낮아져 넘치는 블록 · 필기는 바로 뒤에 새 쪽(원래 방향)을 끼워 그리로 옮긴다(서로 자리는 그대로). 실행 취소 한 번
 */
export function setPageOrient(engine: Engine, i: number, landscape: boolean): TxResult<void> {
  return engine.transact((tx) => {
    const s = engine.note.sheet;
    if (!s) return;
    const g = sheetGeom(engine.note, contentBottom(engine))!;
    if (i < 0 || i >= g.pages || g.list[i]!.landscape === landscape) return;
    const p = g.list[i]!, size = pageSize(landscape);
    interface Item { readonly r: Rect; readonly k: number; move(dx: number, dy: number, w: number): void }
    const items: Item[] = [
      ...[...engine.blocks()].map((b): Item => ({ r: b, k: pageAt(g, b.y).i, move: (dx, dy, w) => tx.set('block', b.id, { x: b.x + dx, y: b.y + dy, ...(w !== b.w ? { w } : {}) }) })),
      ...freeStrokes(engine).map((st): Item => {
        const r = strokeBounds(st);
        return { r, k: pageAt(g, r.y).i, move: (dx, dy) => tx.set('stroke', st.id, { origin: { x: st.origin.x + dx, y: st.origin.y + dy } }) };
      }),
    ];
    const over = items.filter((it) => it.k === i && it.r.y + it.r.h > p.y + size.h - SHEET_PAD + 0.5);
    const insert = over.length > 0, after = p.y + size.h + g.gap; // 바뀐 쪽 다음(끼운 쪽) 위 끝
    const top = Math.min(...over.map((it) => it.r.y));
    const shift = size.h - p.h + (insert ? p.h + g.gap : 0); // 뒤 쪽들이 옮겨 갈 만큼
    for (const it of items) {
      const { r } = it;
      if (it.k > i) { if (shift) it.move(0, shift, r.w); }
      else if (it.k !== i) continue;
      else if (over.includes(it)) it.move(0, after + SHEET_PAD - top, r.w);
      else if (size.w < p.w) {
        const w = Math.min(r.w, size.w - 2 * SHEET_PAD), x = Math.max(SHEET_PAD, Math.min(r.x, size.w - SHEET_PAD - w));
        if (x !== r.x || w !== r.w) it.move(x - r.x, 0, w);
      }
    }
    // 쪽 방향: 노트 기본과 다른 쪽만 적는다 (끼운 쪽 뒤로는 차례가 하나씩 밀린다)
    const orient: Record<string, 'landscape' | 'portrait'> = {};
    for (let k = 0; k < g.pages + (insert ? 1 : 0); k++) {
      const land = k < i ? pageLandscape(s, k) : k === i ? landscape : insert && k === i + 1 ? p.landscape : pageLandscape(s, insert ? k - 1 : k);
      if (land !== !!s.landscape) orient[k] = land ? 'landscape' : 'portrait';
    }
    const { orient: _o, ...rest } = s;
    tx.setNote({ sheet: { ...rest, pages: g.pages + (insert ? 1 : 0), ...(Object.keys(orient).length ? { orient } : {}) } });
  }, { origin: 'user', label: landscape ? '이 쪽 가로로' : '이 쪽 세로로' });
}
