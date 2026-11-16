// 노트 맨 위 · 맨 끝에 글 상자 (AI 노트 요약 FR-115 · AI 초안 FR-113): 캔버스는 아무것도 안 옮기고 맨 위 내용 위에, A4는 용지 맨 위 —
// 자리가 모자라면 상자 · 자유 필기를 같은 만큼 내림. AI 출처 표시 · 문서 순서 첫째 · 실행 취소 한 번
import { describe, expect, it } from 'vitest';
import { addStroke, createTextBlock, documentOrder, DOC_GAP, Engine, insertTextAtEnd, insertTextAtTop, isStroke, SHEET_GAP, SHEET_PAD, setNoteSheet, strokeBounds, type TextDoc, type TxResult } from '../src';

const val = <T,>(r: TxResult<T>): T => { if (!r.ok) throw new Error(r.reason); return r.value; };
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }) as TextDoc;
const zig = (x: number, y: number) => ({ tool: 'pen' as const, color: '#000', width: 3, origin: { x, y }, points: [0, 0, 0.5, 0, 20, 15, 0.5, 8, 40, 0, 0.5, 16] });
const ai = { generated: true as const, runId: 'r1', model: 'claude-sonnet-5-5', promptVersion: 'edit.v1' };

describe('노트 맨 위에 넣기', () => {
  it('캔버스: 맨 위 내용(필기 포함) 위에, 다른 것은 그대로 · 문서 순서 첫째 · AI 표시 · 실행 취소 한 번', () => {
    const e = new Engine();
    const a = val(createTextBlock(e, { x: 100, y: 200 }, { doc: doc('첫 문단'), w: 300 }));
    const s = val(addStroke(e, zig(400, 150)))!;
    const inkY = () => { const x = e.getStroke(s); return isStroke(x) ? x.origin.y : NaN; };
    const before = { a: e.getBlock(a.blockId)!.y, s: inkY() };
    const inkTop = strokeBounds([...e.strokes()].filter(isStroke)[0]!).y; // 선 굵기만큼 150보다 조금 위
    let measured = 0;
    const r = val(insertTextAtTop(e, doc('요약'), (w) => { measured = w; return 90; }, { ai }));
    const b = e.getBlock(r.blockId)!;
    expect(measured).toBe(480); // 맨 위 상자 폭(300)보다 좁지 않게
    expect(inkTop).toBeLessThan(150);
    expect({ x: b.x, y: b.y, w: b.w, h: b.h }).toEqual({ x: 100, y: inkTop - 90 - DOC_GAP, w: 480, h: 90 });
    expect(b.ai).toEqual(ai);
    expect(e.getBlock(a.blockId)!.y).toBe(before.a);
    expect(inkY()).toBe(before.s);
    expect(documentOrder(e)[0]!.block.id).toBe(r.blockId);
    e.undo();
    expect(e.getBlock(r.blockId)).toBeUndefined();
  });

  it('A4: 용지 안쪽 맨 위 · 용지 폭, 자리가 모자라면 상자 · 자유 필기를 같은 만큼 내림 — 실행 취소 한 번에 되돌림', () => {
    const e = new Engine();
    val(setNoteSheet(e, { size: 'a4' }));
    const a = val(createTextBlock(e, { x: SHEET_PAD, y: SHEET_PAD }, { doc: doc('본문'), w: 500 }));
    const s = val(addStroke(e, zig(300, 120)))!;
    const ya = e.getBlock(a.blockId)!.y, ys = strokeBounds([...e.strokes()].filter(isStroke).find((x) => x.id === s)!).y;
    const r = val(insertTextAtTop(e, doc('요약'), () => 100));
    const b = e.getBlock(r.blockId)!;
    expect({ x: b.x, y: b.y, w: b.w }).toEqual({ x: SHEET_PAD, y: SHEET_PAD, w: 794 - 2 * SHEET_PAD });
    const dy = SHEET_PAD + 100 + DOC_GAP - SHEET_PAD;
    expect(e.getBlock(a.blockId)!.y).toBe(ya + dy);
    expect(strokeBounds([...e.strokes()].filter(isStroke).find((x) => x.id === s)!).y).toBeCloseTo(ys + dy, 5);
    e.undo();
    expect(e.getBlock(a.blockId)!.y).toBe(ya);
    expect(e.getBlock(r.blockId)).toBeUndefined();
  });

  it('맨 끝에 (AI 초안): 모든 내용(필기 포함) 아래 · 마지막 상자 왼쪽, 아무것도 안 옮김 · A4는 용지 폭 · 빈 노트는 맨 위', () => {
    const e = new Engine();
    const a = val(createTextBlock(e, { x: 60, y: 0 }, { doc: doc('본문'), w: 300, h: 80 }));
    val(addStroke(e, zig(100, 300)));
    const inkBottom = (() => { const r = strokeBounds([...e.strokes()].filter(isStroke)[0]!); return r.y + r.h; })();
    const r = val(insertTextAtEnd(e, doc('초안'), () => 120, { ai }));
    const b = e.getBlock(r.blockId)!;
    expect(b.x).toBe(60);
    expect(b.w).toBe(480);
    expect(b.y).toBeCloseTo(inkBottom + DOC_GAP, 1);
    expect(b.ai).toEqual(ai);
    expect(e.getBlock(a.blockId)!.y).toBe(0);
    expect(documentOrder(e).at(-1)!.block.id).toBe(r.blockId);
    e.undo();
    expect(e.getBlock(r.blockId)).toBeUndefined();
    const s = new Engine();
    val(setNoteSheet(s, { size: 'a4' }));
    const sb = s.getBlock(val(insertTextAtEnd(s, doc('초안'), () => 50)).blockId)!;
    expect({ x: sb.x, y: sb.y, w: sb.w }).toEqual({ x: SHEET_PAD, y: SHEET_PAD, w: 794 - 2 * SHEET_PAD });
    const empty = new Engine();
    expect(empty.getBlock(val(insertTextAtEnd(empty, doc('초안'), () => 50)).blockId)!.y).toBe(0);
  });

  it('A4: 위에 빈자리가 넉넉하면 아무것도 안 옮김 · 빈 노트면 그냥 맨 위', () => {
    const e = new Engine();
    val(setNoteSheet(e, { size: 'a4' }));
    const a = val(createTextBlock(e, { x: SHEET_PAD, y: 400 }, { doc: doc('아래쪽 글') }));
    val(insertTextAtTop(e, doc('요약'), () => 80));
    expect(e.getBlock(a.blockId)!.y).toBe(400);
    const empty = new Engine();
    const r = val(insertTextAtTop(empty, doc('요약'), () => 40));
    expect(empty.getBlock(r.blockId)!.y).toBe(0);
  });

  it('A4: 쪽 사이 틈에 걸치지 않게 — 맨 끝은 다음 쪽 위로, 맨 위 넣기로 내린 상자는 다음 쪽으로 · 그 아래도 같이 (교차 검토 A9)', () => {
    const stride = 1123 + SHEET_GAP, pageEnd = 1123 - SHEET_PAD;
    // 맨 끝: 첫 쪽 아래 여백 가까이 끝나는 내용 → 120 높이 상자는 다음 쪽 위 여백 아래에
    const e = new Engine();
    val(setNoteSheet(e, { size: 'a4' }));
    val(createTextBlock(e, { x: SHEET_PAD, y: pageEnd - 60 }, { doc: doc('끝'), h: 40 }));
    const end = e.getBlock(val(insertTextAtEnd(e, doc('초안'), () => 120)).blockId)!;
    expect(end.y).toBe(stride + SHEET_PAD);
    // 맨 위: 맨 위 상자 + 쪽 끝 가까운 상자 B + 다음 쪽 상자 C + B 아래 필기
    const t = new Engine();
    val(setNoteSheet(t, { size: 'a4' }));
    const a = val(createTextBlock(t, { x: SHEET_PAD, y: SHEET_PAD }, { doc: doc('위'), h: 40 }));
    const b = val(createTextBlock(t, { x: SHEET_PAD, y: pageEnd - 90 }, { doc: doc('쪽 끝'), h: 80 }));
    const c = val(createTextBlock(t, { x: SHEET_PAD, y: stride + SHEET_PAD + 200 }, { doc: doc('다음 쪽'), h: 40 }));
    const s = val(addStroke(t, zig(300, stride + 400)))!;
    const before = { a: t.getBlock(a.blockId)!.y, b: t.getBlock(b.blockId)!.y, c: t.getBlock(c.blockId)!.y, s: strokeBounds(t.getStroke(s) as never).y };
    val(insertTextAtTop(t, doc('요약'), () => 100));
    const dy = 100 + DOC_GAP;
    const B = t.getBlock(b.blockId)!.y, extra = B - (before.b + dy);
    expect(t.getBlock(a.blockId)!.y).toBe(before.a + dy);
    expect(B).toBe(stride + SHEET_PAD); // 틈에 걸쳐 다음 쪽 위로
    expect(extra).toBeGreaterThan(0);
    expect(t.getBlock(c.blockId)!.y).toBe(before.c + dy + extra); // 그 아래도 같이 — B와 C 사이는 그대로
    expect(strokeBounds(t.getStroke(s) as never).y).toBeCloseTo(before.s + dy + extra, 5);
    t.undo();
    expect(t.getBlock(b.blockId)!.y).toBe(before.b);
  });
});
