// 용지(A4): 쪽 사이 틈에 상자가 걸치지 않게 (CQ-009)
import { describe, expect, it } from 'vitest';
import { clampToSheet, createTextBlock, Engine, pageAt, pageY, setNoteSheet, setPageOrient, setSheetPages, SHEET_PAD, sheetGeom, type TextDoc, type TxResult } from '../src';
describe('A4 쪽 사이 틈 (CQ-009)', () => {
  const g = sheetGeom({ id: 'n', title: '', sheet: { size: 'a4', pages: 2 } } as never)!;
  it('쪽 아래에 걸치면 다음 쪽 위 여백 아래로, 위로 옮기는 중이면 앞 쪽 아래로', () => {
    expect(pageY(g, 1100, 56)).toBe(1123 + 40 + 24);
    expect(pageY(g, 1100, 56, true)).toBe(1123 - 24 - 56);
    expect(pageY(g, 500, 56)).toBe(500);
    expect(pageY(g, 1123 + 40 + 5, 56, true)).toBe(1123 - 24 - 56);
    expect(pageY(g, 10, 2000)).toBe(10);
  });
});

// 쪽마다 가로 · 세로 (11/03): 쪽 크기 · 자리 계산, 한 쪽만 돌리면 아래 쪽 내용이 따라 옮기고 넘치는 것은 새 쪽으로
describe('쪽마다 가로 · 세로 (11/03)', () => {
  const val = <T,>(r: TxResult<T>): T => { if (!r.ok) throw new Error(r.reason); return r.value; };
  const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }) as TextDoc;
  const mk = (pages = 3) => { const e = new Engine(); val(setNoteSheet(e, { size: 'a4', pages })); return e; };
  const box = (e: Engine, x: number, y: number, w = 300) => val(createTextBlock(e, { x, y }, { doc: doc('글'), w })).blockId;

  it('쪽 크기 · 위치: 가로 쪽은 1123 × 794, 다음 쪽은 그만큼 위로 — 쪽 찾기 · 틈 피하기도 그 쪽 기준', () => {
    const g = sheetGeom({ id: 'n', title: '', sheet: { size: 'a4', pages: 3, orient: { 1: 'landscape' } } } as never)!;
    expect(g.list.map((p) => [p.y, p.w, p.h])).toEqual([[0, 794, 1123], [1163, 1123, 794], [1997, 794, 1123]]);
    expect([g.w, g.h, g.total]).toEqual([1123, 1123, 1997 + 1123]);
    expect(pageAt(g, 1163 + 800).i).toBe(1); // 가로 쪽 아래 틈도 그 쪽
    expect(pageAt(g, 1997).i).toBe(2);
    expect(pageAt(g, 5000).i).toBe(4); // 목록 뒤는 노트 기본(세로)으로 이어 붙인 쪽
    expect(pageY(g, 1163 + 760, 56)).toBe(1997 + SHEET_PAD); // 가로 쪽 아래에 걸치면 다음 쪽 위로
    expect(pageY(g, 1997 + 5, 56, true)).toBe(1163 + 794 - SHEET_PAD - 56); // 위로 옮기는 중이면 가로 쪽 아래로
    expect(clampToSheet(g, { x: 850, y: 1300, w: 200, h: 50 })).toEqual({ x: 850, y: 1300, w: 200, h: 50 }); // 가로 쪽은 넓다
    expect(clampToSheet(g, { x: 850, y: 2100, w: 200, h: 50 }).x).toBe(794 - SHEET_PAD - 200); // 세로 쪽은 좁다
  });

  it('한 쪽만 가로로: 아래 쪽 내용은 높이 차이만큼 위로, 넘치는 상자는 바로 뒤 새 쪽(세로)으로 · 실행 취소 한 번', () => {
    const e = mk(2);
    const a = box(e, 24, 100), low = box(e, 24, 900), next = box(e, 24, 1163 + 100);
    val(setPageOrient(e, 0, true));
    const s = e.note.sheet!;
    expect(s.orient).toEqual({ 0: 'landscape' });
    expect(s.pages).toBe(3); // 넘친 상자 때문에 쪽 하나를 끼웠다
    expect(e.getBlock(a)!.y).toBe(100); // 들어가는 상자는 그대로
    const ins = 794 + 40; // 끼운 쪽 위 끝
    expect(e.getBlock(low)!.y).toBe(ins + SHEET_PAD);
    expect(e.getBlock(next)!.y).toBe(1163 + 100 + (794 - 1123) + 1123 + 40); // 원래 2쪽 내용 = 이제 3쪽
    const g = sheetGeom(e.note)!;
    expect(g.list.map((p) => p.landscape)).toEqual([true, false, false]);
    e.undo();
    expect([e.getBlock(low)!.y, e.getBlock(next)!.y, e.note.sheet!.orient, e.note.sheet!.pages]).toEqual([900, 1263, undefined, 2]);
  });

  it('넘치는 것이 없으면 쪽을 끼우지 않고, 좁아지면 상자를 쪽 폭 안으로', () => {
    const e = mk(2);
    val(setNoteSheet(e, { size: 'a4', pages: 2, landscape: true }));
    const wide = box(e, 600, 100, 400), later = box(e, 24, 834 + 100);
    val(setPageOrient(e, 0, false));
    expect(e.note.sheet!.orient).toEqual({ 0: 'portrait' }); // 노트 기본(가로)과 다른 쪽만
    expect(e.note.sheet!.pages).toBe(2);
    const b = e.getBlock(wide)!;
    expect(b.x + b.w).toBeLessThanOrEqual(794 - SHEET_PAD);
    expect(e.getBlock(later)!.y).toBe(834 + 100 + (1123 - 794)); // 1쪽이 길어진 만큼 아래로
    // 같은 방향으로 다시 바꾸면 아무 일도 없음 · 다시 노트 기본으로 돌리면 적어 둔 방향이 빠짐
    val(setPageOrient(e, 0, false));
    val(setPageOrient(e, 0, true));
    expect(e.note.sheet!.orient).toBeUndefined();
  });

  it('쪽을 줄이면 없어진 쪽의 방향도 지운다', () => {
    const e = mk(3);
    val(setPageOrient(e, 2, true));
    expect(e.note.sheet!.orient).toEqual({ 2: 'landscape' });
    val(setSheetPages(e, 2));
    expect(e.note.sheet!.orient).toBeUndefined();
  });
});
