// 표지 쪽 (11/03): 노트 맨 앞 A4 세로 한 장 — A4 노트는 1쪽 위(쪽 차례 -1), 끝없는 캔버스는 내용 왼쪽.
// 표지 안 블록은 본문 문서 순서에서 빠지고, 끝없는 캔버스 → A4면 표지와 그 안의 것이 1쪽 위로 함께, 지우면 안의 것도 함께(실행 취소 한 번).
import { describe, expect, it } from 'vitest';
import {
  addCoverPage, addStroke, clampToSheet, COVER, coverItems, createTextBlock, documentOrder, Engine, isStroke, pageAt, pageY, removeCoverPage,
  setNoteSheet, setPageOrient, SHEET_GAP, SHEET_PAD, sheetFits, sheetGeom, type TextDoc, type TxResult,
} from '../src';

const val = <T,>(r: TxResult<T>): T => { if (!r.ok) throw new Error(r.reason); return r.value; };
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }) as TextDoc;
const box = (e: Engine, x: number, y: number, t = '글') => val(createTextBlock(e, { x, y }, { doc: doc(t), w: 300 })).blockId;
const zig = (x: number, y: number) => ({ tool: 'pen' as const, color: '#000', width: 3, origin: { x, y }, points: [0, 0, 0.5, 0, 20, 15, 0.5, 8, 40, 0, 0.5, 16] });
const TOP = -(COVER.h + SHEET_GAP);

describe('표지 쪽 (11/03)', () => {
  it('A4 노트: 1쪽 바로 위 · 쪽 계산의 차례 -1 · 표지 안에도 상자를 놓을 수 있다', () => {
    const e = new Engine();
    val(setNoteSheet(e, { size: 'a4', pages: 2 }));
    expect(val(addCoverPage(e))).toEqual({ x: 0, y: TOP, w: COVER.w, h: COVER.h });
    expect(e.note.coverPage).toEqual({ x: 0, y: TOP });
    val(addCoverPage(e)); // 두 번 눌러도 그대로
    const g = sheetGeom(e.note)!;
    expect(g.cover).toEqual({ y: TOP, w: COVER.w, h: COVER.h, landscape: false });
    expect(pageAt(g, -500).i).toBe(-1);
    expect(pageAt(g, 10).i).toBe(0);
    expect(clampToSheet(g, { x: 50, y: TOP + 100, w: 200, h: 50 }).y).toBe(TOP + 100); // 표지 안 그대로
    expect(clampToSheet(g, { x: 50, y: TOP - 300, w: 200, h: 50 }).y).toBe(TOP + SHEET_PAD); // 표지 위로는 못 나감
    expect(pageY(g, -30, 56)).toBe(SHEET_PAD); // 표지 아래 틈 → 1쪽 위 여백 아래로
    expect(pageY(g, 10, 56, true)).toBe(TOP + COVER.h - SHEET_PAD - 56); // 1쪽에서 위로 올리면 표지 아래로
    expect(sheetFits(e)({ x: 50, y: TOP + 100, w: 200, h: 50 })).toBe(true);
  });

  it('표지 안 블록은 본문 문서 순서에서 빠지고, 쪽 하나를 돌려도 표지 안 것은 그대로', () => {
    const e = new Engine();
    val(setNoteSheet(e, { size: 'a4', pages: 2 }));
    val(addCoverPage(e));
    const cov = box(e, 100, TOP + 200, '내 공책'), body = box(e, 24, 100, '본문');
    expect(documentOrder(e).map((d) => d.block.id)).toEqual([body]);
    expect(coverItems(e).blocks).toEqual([cov]);
    val(setPageOrient(e, 0, true));
    expect(e.getBlock(cov)!.y).toBe(TOP + 200);
  });

  it('끝없는 캔버스: 내용 왼쪽에 · A4로 바꾸면 표지와 그 안의 것이 1쪽 위로 함께, 본문은 종이 안으로', () => {
    const e = new Engine();
    const body = box(e, 500, 300, '본문');
    const r = val(addCoverPage(e));
    expect(r.x + r.w).toBeLessThan(500);
    expect(r.y).toBe(300);
    const cov = box(e, r.x + 100, r.y + 100, '표지 글');
    const s = val(addStroke(e, zig(r.x + 200, r.y + 400)))!;
    val(setNoteSheet(e, { size: 'a4' }));
    expect(e.note.coverPage).toEqual({ x: 0, y: TOP });
    expect([e.getBlock(cov)!.x, e.getBlock(cov)!.y]).toEqual([100, TOP + 100]);
    const st = e.getStroke(s);
    expect(isStroke(st) ? [st.origin.x, st.origin.y] : null).toEqual([200, TOP + 400]);
    expect([e.getBlock(body)!.x, e.getBlock(body)!.y]).toEqual([SHEET_PAD, SHEET_PAD]); // 본문 왼쪽 위 = 종이 여백
  });

  it('지우기: 표지와 안에 놓은 것 · 그린 것을 함께, 실행 취소 한 번이면 모두 돌아온다', () => {
    const e = new Engine();
    val(setNoteSheet(e, { size: 'a4' }));
    val(addCoverPage(e));
    const cov = box(e, 100, TOP + 200), body = box(e, 24, 100);
    val(addStroke(e, zig(300, TOP + 500)));
    val(removeCoverPage(e));
    expect(e.note.coverPage).toBeUndefined();
    expect(e.getBlock(cov)).toBeUndefined();
    expect(e.getBlock(body)).toBeDefined();
    expect([...e.strokes()]).toHaveLength(0);
    e.undo();
    expect(e.note.coverPage).toEqual({ x: 0, y: TOP });
    expect(e.getBlock(cov)).toBeDefined();
    expect([...e.strokes()]).toHaveLength(1);
  });
});
