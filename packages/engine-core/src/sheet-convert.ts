// 용지 바꾸기 (11/03 다시 씀 — 끝없는 캔버스에서 A4로 바꾸면 상자가 겹치던 것):
// - 끝없는 캔버스 → A4: 내용을 덩어리(묶음 · 붙은 상자 · 겹친 상자와 그 위 필기 · 붙어 있는 필기)로 묶어 자리 차례로 종이에 놓는다.
//   폭이 넘치면 모두 같은 배율로 줄이고(MIN_FIT까지 — 배치 그대로), 그래도 넘치는 덩어리는 안으로 당긴다. 앞에 놓은 것과 겹치거나
//   쪽 사이 틈에 걸치면 아래로 — 내린 만큼 그 뒤 덩어리도 같이 내린다(서로 자리는 그대로). 표지 쪽은 1쪽 위로 따로.
// - A4 가로 ↔ 세로: 쪽마다 돌리기(setPageOrient)를 모든 쪽에 — 넘치는 내용은 다음 쪽으로.
// - 끝없는 캔버스로(null): 블록 자리는 그대로 (예전 노트 · 시험용 — 화면에서는 A4만 고른다).
import type { Engine, Tx, TxResult } from './engine';
import { isTextContent, type Block, type Id, type NoteSheet } from './model';
import type { Rect } from './geom';
import { freeStrokes, strokeBounds, type Stroke } from './ink';
import { contentBottom, coverRect, inCover, pageAt, pageY, setPageOrient, SHEET_COVER_AT, SHEET_PAD, sheetGeom, type SheetGeom } from './sheet';

/** 넓은 내용을 종이 폭에 맞춰 줄이는 가장 작은 배율 — 더 작으면 글을 읽기 어렵다. 그래도 넘치는 덩어리는 안으로 당겨 아래로 */
export const MIN_FIT = 0.6;
/** 겹쳐서 내릴 때 앞 덩어리와 띄우는 틈 */
const FIT_GAP = 20;

export function setNoteSheet(engine: Engine, sheet: NoteSheet | null): TxResult<void> {
  return engine.transact((tx) => {
    const prev = engine.note.sheet;
    if (prev && sheet) {
      // 이미 종이: 방향이 다른 쪽을 모두 돌린 뒤(넘치면 다음 쪽으로) 노트 기본 방향으로 — 쪽마다 정한 방향은 지운다
      const land = !!sheet.landscape;
      rotateAll(engine, land);
      const { orient: _o, landscape: _l, ...rest } = engine.note.sheet!, { orient: _o2, landscape: _l2, ...want } = sheet;
      tx.setNote({ sheet: { ...rest, ...want, pages: Math.max(want.pages ?? 1, rest.pages ?? 1), ...(land ? { landscape: true } : {}) } });
      return;
    }
    tx.setNote({ sheet: sheet ?? undefined });
    if (!sheet) return;
    // 표지 쪽(11/03)은 본문과 따로: 표지와 그 안의 것을 1쪽 바로 위로 함께 옮긴다
    const cr = coverRect(engine.note), cov = cr ? { ...SHEET_COVER_AT } : null;
    // 옮기기 전에 가른다 (tx.set은 바로 적용된다)
    const covB = new Set([...engine.blocks()].filter((b) => inCover(cr, b)).map((b) => b.id));
    const covS = new Set(freeStrokes(engine).filter((st) => inCover(cr, strokeBounds(st))).map((st) => st.id));
    if (cr && cov && (cr.x !== cov.x || cr.y !== cov.y)) {
      const cx = cov.x - cr.x, cy = cov.y - cr.y;
      tx.setNote({ coverPage: cov });
      for (const b of [...engine.blocks()]) if (covB.has(b.id)) tx.set('block', b.id, { x: b.x + cx, y: b.y + cy });
      for (const st of freeStrokes(engine)) if (covS.has(st.id)) tx.set('stroke', st.id, { origin: { x: st.origin.x + cx, y: st.origin.y + cy } });
    }
    const g = sheetGeom({ ...engine.note, sheet, ...(cov ? { coverPage: cov } : {}) })!;
    fitIntoSheet(engine, tx, g, [...engine.blocks()].filter((b) => !covB.has(b.id)), freeStrokes(engine).filter((st) => !covS.has(st.id)));
  }, { origin: 'user', label: sheet ? (engine.note.sheet ? (sheet.landscape ? 'A4 가로로' : 'A4 세로로') : '용지 A4') : '끝없는 캔버스' });
}

/** 모든 쪽을 한 방향으로 — 쪽 하나 돌릴 때 넘친 내용이 새 쪽으로 가면 그 쪽도 돌린다 (바깥 트랜잭션 안) */
function rotateAll(engine: Engine, land: boolean): void {
  for (let i = 0, n = 0; n < 500; n++) {
    const g = sheetGeom(engine.note, contentBottom(engine))!;
    if (i >= g.pages) break;
    if (g.list[i]!.landscape !== land) setPageOrient(engine, i, land);
    else i++;
  }
}

interface Unit { r: Rect; readonly blocks: Block[]; readonly strokes: Stroke[] }
const hit = (a: Rect, b: Rect, pad = 0) => a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
const union = (a: Rect, b: Rect): Rect => { const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y); return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }; };

/** 덩어리: 묶음 · 붙은 상자(attachTo)는 처음부터 하나, 처음부터 겹쳐 있던 상자 · 필기(가까운 필기끼리는 12px 안)도 하나 — 서로 자리를 지킨다 */
function unitsOf(blocks: readonly Block[], strokes: readonly Stroke[]): Unit[] {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const shared = new Map<Id, number>();
  for (const b of blocks) if (b.group) shared.set(b.group, (shared.get(b.group) ?? 0) + 1);
  const keyOf = (b: Block, depth = 0): string => {
    const parent = b.attachTo ? byId.get(b.attachTo) : undefined;
    if (parent && depth < 8) return keyOf(parent, depth + 1);
    return b.group && (shared.get(b.group) ?? 0) >= 2 ? `g:${b.group}` : `b:${b.id}`;
  };
  const map = new Map<string, Unit>();
  for (const b of blocks) {
    const k = keyOf(b), u = map.get(k);
    if (u) { u.blocks.push(b); u.r = union(u.r, b); } else map.set(k, { r: { x: b.x, y: b.y, w: b.w, h: b.h }, blocks: [b], strokes: [] });
  }
  const units = [...map.values(), ...strokes.map((s): Unit => ({ r: strokeBounds(s), blocks: [], strokes: [s] }))];
  // 겹친 것끼리 합치기 (필기가 끼면 12px 안이면 붙은 것) — 합치면 다시 처음부터
  for (let changed = true, guard = 0; changed && guard < 50; guard++) {
    changed = false;
    units.sort((a, b) => a.r.x - b.r.x);
    for (let i = 0; i < units.length; i++) {
      const a = units[i]!;
      for (let j = i + 1; j < units.length && units[j]!.r.x <= a.r.x + a.r.w + 12; j++) {
        const b = units[j]!, pad = a.strokes.length || b.strokes.length ? 12 : 0;
        if (!hit(a.r, b.r, pad)) continue;
        a.blocks.push(...b.blocks); a.strokes.push(...b.strokes); a.r = union(a.r, b.r);
        units.splice(j, 1); j--; changed = true;
      }
    }
  }
  return units;
}

/** 끝없는 캔버스의 내용을 종이에 (위 설명) */
function fitIntoSheet(engine: Engine, tx: Tx, g: SheetGeom, blocks: readonly Block[], strokes: readonly Stroke[]): void {
  const units = unitsOf(blocks, strokes);
  if (!units.length) return;
  const box = units.map((u) => u.r).reduce(union);
  const inner0 = g.list[0]!.w - 2 * SHEET_PAD;
  const k = box.w > inner0 ? Math.max(MIN_FIT, inner0 / box.w) : 1;
  units.sort((a, b) => a.r.y - b.r.y || a.r.x - b.r.x);
  const placed: Rect[] = [];
  let carry = 0; // 앞 덩어리를 내린 만큼 — 뒤 덩어리도 같이
  for (const u of units) {
    const t = { x: SHEET_PAD + (u.r.x - box.x) * k, y: SHEET_PAD + (u.r.y - box.y) * k + carry, w: u.r.w * k, h: u.r.h * k };
    for (let n = 0; n < 200; n++) {
      const pw = pageAt(g, t.y).w;
      if (t.x + t.w > pw - SHEET_PAD) t.x = Math.max(SHEET_PAD, pw - SHEET_PAD - t.w); // 넘치면 안으로
      const o = placed.find((p) => hit(p, t));
      const ny = o ? o.y + o.h + FIT_GAP : pageY(g, t.y, t.h); // 겹치면 그 아래로, 아니면 쪽 사이 틈 피하기
      if (ny <= t.y) break;
      carry += ny - t.y;
      t.y = ny;
    }
    placed.push(t);
    place(engine, tx, u, t, k, pageAt(g, t.y).w - 2 * SHEET_PAD);
  }
}

/** 덩어리 하나를 t(왼쪽 위) · 배율 k로 — 상자는 크기 · 글자 크기까지 같은 배율, 필기는 원점 · 배율. 글 상자 하나가 쪽보다 넓으면 폭만 쪽에 */
function place(engine: Engine, tx: Tx, u: Unit, t: Rect, k: number, inner: number): void {
  const sx = (v: number) => t.x + (v - u.r.x) * k, sy = (v: number) => t.y + (v - u.r.y) * k;
  const lone = u.blocks.length === 1 && !u.strokes.length;
  for (const b of u.blocks) {
    const hasText = engine.contentsOf(b.id).some((c) => isTextContent(c));
    const patch: Record<string, unknown> = { x: Math.round(sx(b.x)), y: Math.round(sy(b.y)) };
    if (k !== 1) {
      patch.w = Math.max(40, Math.round(b.w * k));
      patch.h = Math.max(24, Math.round(b.h * k));
      if (hasText) { const fs = Math.max(0.5, Math.min(4, (b.fontScale ?? 1) * k)); patch.fontScale = Math.abs(fs - 1) > 1e-3 ? Math.round(fs * 1000) / 1000 : undefined; }
      if (b.sizing === 'fixed' && b.minH) patch.minH = Math.round(b.minH * k);
    }
    if (lone && hasText && ((patch.w as number | undefined) ?? b.w) > inner) patch.w = Math.round(inner);
    tx.set('block', b.id, patch);
  }
  for (const s of u.strokes) tx.set('stroke', s.id, { origin: { x: sx(s.origin.x), y: sy(s.origin.y) }, ...(k !== 1 ? { scale: s.scale * k } : {}) });
}
