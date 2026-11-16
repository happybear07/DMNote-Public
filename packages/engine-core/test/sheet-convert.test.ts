// 끝없는 캔버스 → A4 (11/03 다시 씀): 상자가 겹치지 않게 — 넓으면 같은 배율로(최소 0.6) 줄이고, 그래도 넘치면 안으로 당겨 아래로.
// 상자 위 필기 · 묶음은 함께, 노트 전체 가로 ↔ 세로는 쪽마다 돌리기로(쪽 사이 틈에 걸치지 않게)
import { describe, expect, it } from 'vitest';
import { addStroke, createTextBlock, Engine, isStroke, MIN_FIT, pageAt, setNoteSheet, SHEET_PAD, sheetGeom, strokeBounds, type Block, type TextDoc, type TxResult } from '../src';

const val = <T,>(r: TxResult<T>): T => { if (!r.ok) throw new Error(r.reason); return r.value; };
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }) as TextDoc;
const box = (e: Engine, x: number, y: number, w = 300) => val(createTextBlock(e, { x, y }, { doc: doc('글'), w })).blockId;
const zig = (x: number, y: number) => ({ tool: 'pen' as const, color: '#000', width: 3, origin: { x, y }, points: [0, 0, 0.5, 0, 20, 15, 0.5, 8, 40, 0, 0.5, 16] });
const all = (e: Engine) => [...e.blocks()];
const overlap = (bs: Block[]) => bs.some((a, i) => bs.some((b, j) => j > i && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h));
const inPage = (e: Engine) => { const g = sheetGeom(e.note, 1e5)!; return all(e).every((b) => { const p = pageAt(g, b.y); return b.x >= SHEET_PAD - 1 && b.x + b.w <= p.w - SHEET_PAD + 1 && b.y >= p.y && b.y + b.h <= p.y + p.h; }); };

describe('끝없는 캔버스 → A4 (11/03)', () => {
  it('나란히 놓인 넓은 내용: 같은 배율로 줄여 배치 그대로 · 겹치지 않음 · 종이 안', () => {
    const e = new Engine();
    const a = box(e, 0, 0), b = box(e, 900, 0), c = box(e, 450, 400);
    val(setNoteSheet(e, { size: 'a4' }));
    const k = (794 - 2 * SHEET_PAD) / 1200;
    expect(e.getBlock(a)!.x).toBe(SHEET_PAD);
    expect(e.getBlock(b)!.x).toBe(Math.round(SHEET_PAD + 900 * k));
    expect(e.getBlock(c)!.y).toBe(Math.round(SHEET_PAD + 400 * k));
    expect(e.getBlock(a)!.fontScale).toBeCloseTo(k, 2);
    expect(overlap(all(e))).toBe(false);
    expect(inPage(e)).toBe(true);
  });

  it('아주 넓으면 0.6배까지만 줄이고, 넘친 상자는 안으로 당겨 겹치면 아래로 — 그 뒤 상자도 같이 내려 겹치지 않음', () => {
    const e = new Engine();
    box(e, 0, 0); box(e, 1000, 0); box(e, 2000, 0); box(e, 0, 300); box(e, 2000, 300);
    val(setNoteSheet(e, { size: 'a4' }));
    expect(all(e).every((b) => Math.abs(b.w - 300 * MIN_FIT) < 1)).toBe(true);
    expect(overlap(all(e))).toBe(false);
    expect(inPage(e)).toBe(true);
  });

  it('쪽보다 넓은 글 상자 하나는 폭만 쪽에 맞춘다 · 상자 위에 그린 필기는 상자와 함께', () => {
    const e = new Engine();
    const wide = box(e, 100, 100, 760);
    const t = box(e, 3000, 2000);
    const s = val(addStroke(e, zig(3050, 2010)))!;
    const before = (() => { const st = e.getStroke(s); return isStroke(st) ? strokeBounds(st).x - e.getBlock(t)!.x : NaN; })();
    val(setNoteSheet(e, { size: 'a4' }));
    expect(e.getBlock(wide)!.w).toBeLessThanOrEqual(794 - 2 * SHEET_PAD);
    const st = e.getStroke(s);
    const after = isStroke(st) ? strokeBounds(st).x - e.getBlock(t)!.x : NaN;
    expect(Math.abs(after - before * MIN_FIT)).toBeLessThan(2); // 같은 배율로 함께
    expect(overlap(all(e))).toBe(false);
  });

  it('노트 전체를 가로로: 모든 쪽을 돌리고(넘치면 다음 쪽) 쪽마다 정한 방향은 지운다 · 쪽 틈에 걸치는 상자 없음 · 실행 취소 한 번', () => {
    const e = new Engine();
    val(setNoteSheet(e, { size: 'a4', pages: 2 }));
    for (const y of [24, 300, 700, 1000, 1163 + 24, 1163 + 600]) box(e, 24, y);
    val(setNoteSheet(e, { size: 'a4', landscape: true }));
    const s = e.note.sheet!;
    expect([s.landscape, s.orient]).toEqual([true, undefined]);
    expect(sheetGeom(e.note, 1e5)!.list.every((p) => p.landscape)).toBe(true);
    expect(inPage(e)).toBe(true);
    expect(overlap(all(e))).toBe(false);
    e.undo();
    expect(e.note.sheet!.landscape).toBeUndefined();
    expect(all(e).map((b) => b.y).sort((p, q) => p - q)).toEqual([24, 300, 700, 1000, 1187, 1763]);
  });
});
