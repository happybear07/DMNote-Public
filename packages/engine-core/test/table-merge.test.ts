// 표 칸 합치기 · 나누기: 사각형 합치기(글은 왼쪽 위 칸으로), 안쪽에 행을 끼우면 따라 늘고, 끝 행이 지워지면 버림, 겹치는 합침까지 넓히기, 나누기 · 실행 취소.
import { describe, expect, it } from 'vitest';
import { cellText, deleteTableLine, Engine, insertAnchor, isTableContent, keyBetween, makeTable, mergeAt, mergeCells, mergeRect, mergeSpans, sortedRows, splitCell, type TableContent } from '../src';

function setup() {
  const e = new Engine();
  const data = makeTable(['A', 'B', 'C'], [['a1', 'b1', 'c1'], ['a2', 'b2', 'c2'], ['a3', 'b3', 'c3']]);
  let contentId = '';
  e.transact((tx) => { const blockId = tx.createBlock({ x: 0, y: 0, w: 300, h: 120 }); contentId = tx.createContent({ blockId, type: 'table', ...data }); }, { origin: 'user' });
  const t = () => { const c = e.getContent(contentId); if (!isTableContent(c)) throw new Error('표 아님'); return c as TableContent; };
  const at = (r: number, c: number) => ({ row: sortedRows(t())[r]!.id, col: t().columns[c]!.id });
  const text = (r: number, c: number) => cellText(sortedRows(t())[r]!.cells[t().columns[c]!.id]);
  return { e, contentId, t, at, text };
}

describe('표 칸 합치기', () => {
  it('2×2 합치기 → 왼쪽 위 칸에 rowspan · colspan, 글은 모아서, 덮인 칸은 비움', () => {
    const { e, contentId, t, at, text } = setup();
    const r = mergeCells(e, contentId, at(1, 1), at(0, 0));
    expect(r.ok && r.value).toEqual(at(0, 0));
    const { spans, covered } = mergeSpans(t());
    expect(spans.get(`${at(0, 0).row}:${at(0, 0).col}`)).toEqual({ rows: 2, cols: 2 });
    expect(covered.size).toBe(3);
    expect(text(0, 0)).toBe('a1 b1 a2 b2');
    expect([text(0, 1), text(1, 0), text(1, 1)]).toEqual(['', '', '']);
    expect(text(0, 2)).toBe('c1');
  });

  it('안쪽에 행을 끼우면 합친 칸이 따라 늘고, 끝 행을 지우면 그 합침은 버린다', () => {
    const { e, contentId, t, at } = setup();
    mergeCells(e, contentId, at(0, 0), at(1, 0));
    const rows = sortedRows(t());
    const mid = { id: 'midrow0001', order: keyBetween(rows[0]!.order, rows[1]!.order), cells: {} };
    e.transact((tx) => tx.set('content', contentId, { rows: [...t().rows, mid] }), { origin: 'user' });
    expect([...mergeSpans(t()).spans.values()]).toEqual([{ rows: 3, cols: 1 }]);
    e.transact((tx) => tx.set('content', contentId, { rows: t().rows.filter((r) => r.id !== rows[1]!.id) }), { origin: 'user' });
    expect(mergeSpans(t()).spans.size).toBe(0);
  });

  it('겹치는 합침이 있으면 그것까지 덮게 넓힌다', () => {
    const { e, contentId, t, at } = setup();
    mergeCells(e, contentId, at(0, 1), at(1, 2)); // B1:C2
    expect(mergeRect(t(), at(1, 0), at(2, 1))).toEqual({ r0: at(0, 0).row, c0: at(0, 0).col, r1: at(2, 0).row, c1: at(2, 2).col });
    mergeCells(e, contentId, at(1, 0), at(2, 1));
    expect(t().merges).toHaveLength(1);
    expect([...mergeSpans(t()).spans.values()]).toEqual([{ rows: 3, cols: 3 }]);
  });

  it('나누기 → 합침이 빠지고 글은 왼쪽 위 칸에, 실행 취소로 되돌림', () => {
    const { e, contentId, t, at, text } = setup();
    mergeCells(e, contentId, at(0, 0), at(0, 1));
    expect(mergeAt(t(), at(0, 1))).not.toBeNull();
    expect(splitCell(e, contentId, at(0, 1)).ok).toBe(true);
    expect(t().merges).toBeUndefined();
    expect(text(0, 0)).toBe('a1 b1');
    e.undo();
    expect(mergeSpans(t()).spans.size).toBe(1);
    e.undo();
    expect(t().merges).toBeUndefined();
    expect(text(0, 1)).toBe('b1');
  });

  it('한 칸만이면 합치지 않는다', () => {
    const { e, contentId, at } = setup();
    expect(mergeCells(e, contentId, at(0, 0), at(0, 0)).ok).toBe(false);
  });
});

describe('합친 칸 근처 행 · 열 넣기 · 지우기 (DQ-021 · DQ-022)', () => {
  it('합친 칸 안에서 넣기 기준은 그 끝 (아래 행 · 오른쪽 열)', () => {
    const { e, contentId, t, at } = setup();
    mergeCells(e, contentId, at(0, 0), at(1, 1));
    expect(insertAnchor(t(), at(0, 0))).toEqual({ row: at(1, 1).row, col: at(1, 1).col });
    expect(insertAnchor(t(), at(2, 2))).toEqual(at(2, 2));
  });
  it('왼쪽 위 행을 지우면 모은 글이 다음 행으로 · 합친 칸은 한 줄 줄어 남는다', () => {
    const { e, contentId, t, at, text } = setup();
    const a00 = at(0, 0), a11 = at(1, 1), r1 = at(1, 0).row;
    mergeCells(e, contentId, a00, a11);
    expect(deleteTableLine(e, contentId, 'row', a00.row).ok).toBe(true);
    expect(text(0, 0)).toBe('a1 b1 a2 b2');
    expect(t().merges).toEqual([{ r0: r1, c0: a00.col, r1: a11.row, c1: a11.col }]);
    expect([...mergeSpans(t()).spans.values()]).toEqual([{ rows: 1, cols: 2 }]);
  });
  it('끝 열을 지우면 한 칸 줄고, 한 칸만 남으면 합침이 없어진다 · 지운 줄을 가리키는 합침이 남지 않는다', () => {
    const { e, contentId, t, at } = setup();
    mergeCells(e, contentId, at(0, 0), at(0, 1)); // 1×2
    const c1 = at(0, 1).col;
    deleteTableLine(e, contentId, 'col', c1);
    expect(t().merges).toBeUndefined();
    expect(t().columns.map((c) => c.id)).not.toContain(c1);
  });
  it('마지막 행은 지우지 않는다', () => {
    const e = new Engine();
    let id = '';
    e.transact((tx) => { const b = tx.createBlock({ x: 0, y: 0, w: 200, h: 60 }); id = tx.createContent({ blockId: b, type: 'table', ...makeTable(['A'], [['a']]) }); }, { origin: 'user' });
    const c = e.getContent(id) as TableContent;
    expect(deleteTableLine(e, id, 'row', c.rows[0]!.id).ok).toBe(false);
  });
});
