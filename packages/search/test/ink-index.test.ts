// 필기에서 읽은 글 색인 (FR-120): 읽은 글은 획에 붙어 검색 · 근거 블록(ink:첫 획)이 되고, 검색 문서를 다시 만들어도 이어지며,
// 획이 모두 지워지면 블록은 빠지고 기록은 30일 남는다(실행 취소로 돌아오면 다시 걸린다). 같은 글이 글 상자에 이미 있으면 겹치지 않게 블록은 빼고 기록만 둔다.
import { describe, expect, it } from 'vitest';
import { addStroke, createTextBlock, Engine, deleteStrokes, type TextDoc } from '@dn/engine-core';
import { extractSearchDoc, INK_GONE_KEEP_MS, inkRef, isInkRef, SearchIndex, type InkText } from '../src';

const zig = (x: number, y: number) => ({ tool: 'pen' as const, color: '#000', width: 3, origin: { x, y }, points: [0, 0, 0.5, 0, 20, 15, 0.5, 8, 40, 0, 0.5, 16] });
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }) as TextDoc;
const val = <T,>(r: { ok: boolean; value?: T; reason?: string }): T => { if (!r.ok) throw new Error(r.reason); return r.value as T; };

function note() {
  const e = new Engine({ note: { id: 'n1', title: '손 필기', createdAt: 0, updatedAt: 0 } });
  const a = val(addStroke(e, zig(0, 0)))!, b = val(addStroke(e, zig(60, 0)))!;
  return { e, a, b };
}

describe('필기에서 읽은 글 색인 (FR-120)', () => {
  it('읽은 글은 필기 블록(ink:첫 획 · 종류 ink)으로 걸리고, 검색 문서에 기록이 남는다', () => {
    const { e, a, b } = note();
    const ink: InkText = { id: inkRef(a), strokes: [a, b], text: '분기 목표 회의', at: 1 };
    const d = extractSearchDoc(e, 1, [ink]);
    expect(d.blocks).toEqual([{ id: `ink:${a}`, text: '분기 목표 회의', kinds: ['ink'] }]);
    expect(d.ink).toEqual([ink]);
    expect(isInkRef(d.blocks[0]!.id)).toBe(true);
    const ix = new SearchIndex();
    ix.put(d);
    const notes = [{ id: 'n1', title: '손 필기', updatedAt: 1 }];
    expect(ix.query('목표', notes)[0]!.blocks[0]!.id).toBe(`ink:${a}`);
    expect(ix.query('목표', notes, 50, { kind: 'ink' })).toHaveLength(1);
    expect(ix.passages('분기 목표가 뭐였지', notes)[0]!.ref).toBe(`n1#ink:${a}`);
  });

  it('획이 하나라도 남으면 그대로, 모두 지우면 블록은 빠지고 기록은 30일 — 실행 취소로 돌아오면 다시 걸린다 (교차 검토 B3)', () => {
    const { e, a, b } = note();
    const ink: InkText = { id: inkRef(a), strokes: [a, b], text: '회의', at: 1 };
    val(deleteStrokes(e, [a]));
    expect(extractSearchDoc(e, 1, [ink], 100).ink).toEqual([ink]);
    val(deleteStrokes(e, [b]));
    const d = extractSearchDoc(e, 1, [ink], 100);
    expect(d.blocks).toEqual([]);
    expect(d.ink).toEqual([{ ...ink, gone: 100 }]);
    // 지워진 때는 처음 것을 지킨다 · 기간이 지나면 버린다
    expect(extractSearchDoc(e, 1, d.ink, 200).ink).toEqual([{ ...ink, gone: 100 }]);
    expect(extractSearchDoc(e, 1, d.ink, 100 + INK_GONE_KEEP_MS).ink).toBeUndefined();
    // 실행 취소로 획이 돌아오면 다시 필기 블록 · gone 없음
    e.undo();
    const back = extractSearchDoc(e, 1, d.ink, 300);
    expect(back.blocks).toEqual([{ id: `ink:${a}`, text: '회의', kinds: ['ink'] }]);
    expect(back.ink).toEqual([ink]);
  });

  it('필기에서 읽은 #낱말은 노트 태그(hashtags)가 되지 않는다 — 검색에는 걸린다 (교차 검토 B8)', () => {
    const { e, a, b } = note();
    val(createTextBlock(e, { x: 0, y: 100 }, { doc: doc('정리 #회의') }));
    const d = extractSearchDoc(e, 1, [{ id: inkRef(a), strokes: [a, b], text: '분기 목표 #예산', at: 1 }]);
    expect(d.hashtags).toEqual(['회의']);
    const ix = new SearchIndex();
    ix.put(d);
    expect(ix.query('#예산', [{ id: 'n1', title: '손 필기', updatedAt: 1 }])[0]!.blocks[0]!.id).toBe(`ink:${a}`);
  });

  it('같은 글이 글 상자에 있으면(띄어쓰기 · 줄바꿈 무시) 블록은 빼고 기록은 남긴다', () => {
    const { e, a, b } = note();
    val(createTextBlock(e, { x: 0, y: 100 }, { doc: doc('분기 목표회의 정리') }));
    const d = extractSearchDoc(e, 1, [{ id: inkRef(a), strokes: [a, b], text: '분기 목표\n회의', at: 1 }]);
    expect(d.blocks.map((x) => x.kinds)).toEqual([['text']]);
    expect(d.ink).toHaveLength(1);
  });

  it('색인은 기록을 따로 들고 있다 — 다시 넣어도 이어지고, 같은 획을 다시 읽으면 바꾸며, 노트를 빼면 함께 사라진다', () => {
    const { e, a, b } = note();
    const ix = new SearchIndex();
    ix.addInk('n1', { id: inkRef(a), strokes: [a], text: '첫 판', at: 1 });
    ix.addInk('n1', { id: inkRef(b), strokes: [b], text: '다른 필기', at: 2 });
    ix.addInk('n1', { id: inkRef(a), strokes: [a, b], text: '다시 읽음', at: 3 });
    expect(ix.inkOf('n1').map((x) => x.text)).toEqual(['다시 읽음']);
    ix.put(extractSearchDoc(e, 1, ix.inkOf('n1')));
    ix.put(extractSearchDoc(e, 2, ix.inkOf('n1')));
    expect(ix.inkOf('n1')).toHaveLength(1);
    ix.remove('n1');
    expect(ix.inkOf('n1')).toEqual([]);
  });
});
