// 표 정렬: 숫자는 크기로(쉼표 · 단위 · 음수 · 소수) · 글은 한글 사전 순 · 빈 칸은 늘 뒤 · 같은 값은 원래 차례,
// 내림차순, ↑ · ↓ 표시는 차례가 어긋나면 사라짐, 세로로 합친 칸이 있으면 거절, 실행 취소 한 번
import { describe, expect, it } from 'vitest';
import { cellDoc, cellText, compareCells, Engine, isTableContent, makeTable, mergeCells, sortedRows, sortTable, tableSortState, type TableContent } from '../src';

function setup(rows: string[][]) {
  const e = new Engine();
  const r = e.transact((tx) => {
    const b = tx.createBlock({ x: 0, y: 0, w: 300, h: 100 });
    return tx.createContent({ blockId: b, type: 'table', ...makeTable(['이름', '값'], rows) });
  }, { origin: 'user' });
  if (!r.ok) throw new Error('setup');
  const t = () => e.getContent(r.value) as TableContent;
  const col = (i: number) => t().columns[i]!.id;
  const read = (i: number) => sortedRows(t()).map((x) => cellText(x.cells[col(i)]));
  return { e, id: r.value, t, col, read };
}

describe('표 정렬', () => {
  it('비교: 숫자는 크기로, 숫자가 글보다 앞, 글은 한국어 순서(한글 → 로마자, 글 속 숫자는 크기로)', () => {
    const xs = ['나무', '1,200원', '-3.5', '가방 10', '40%', '가방 9', '₩500', 'apple'];
    expect([...xs].sort(compareCells)).toEqual(['-3.5', '40%', '₩500', '1,200원', '가방 9', '가방 10', '나무', 'apple']);
  });

  it('오름차순 · 내림차순: 빈 칸은 늘 뒤 · 같은 값은 원래 차례 · 실행 취소 한 번', () => {
    const { e, id, t, col, read } = setup([['다', '3'], ['가', ''], ['나', '10'], ['라', '3'], ['마', '2']]);
    expect(sortTable(e, id, col(1), 'asc').ok).toBe(true);
    expect(read(0)).toEqual(['마', '다', '라', '나', '가']);
    expect(tableSortState(t(), col(1))).toBe('asc');
    expect(tableSortState(t(), col(0))).toBeNull();
    sortTable(e, id, col(1), 'desc');
    expect(read(0)).toEqual(['나', '다', '라', '마', '가']);
    e.undo();
    expect(read(0)).toEqual(['마', '다', '라', '나', '가']);
    e.undo();
    expect(read(0)).toEqual(['다', '가', '나', '라', '마']);
    expect(t().sorted).toBeUndefined();
  });

  it('정렬한 뒤 칸을 고쳐 차례가 어긋나면 ↑ 표시가 사라진다', () => {
    const { e, id, t, col } = setup([['b', '1'], ['a', '2']]);
    sortTable(e, id, col(0), 'asc');
    expect(tableSortState(t(), col(0))).toBe('asc');
    const first = sortedRows(t())[0]!;
    e.transact((tx) => tx.set('content', id, { rows: t().rows.map((r) => (r.id === first.id ? { ...r, cells: { ...r.cells, [col(0)]: cellDoc('z') } } : r)) }), { origin: 'user' });
    expect(tableSortState(t(), col(0))).toBeNull();
  });

  it('세로로 합친 칸이 있으면 정렬하지 않는다 (가로로 합친 칸은 행과 함께 옮겨짐)', () => {
    const { e, id, t, col, read } = setup([['b', '1'], ['a', '2'], ['c', '3']]);
    const rows = sortedRows(t());
    mergeCells(e, id, { row: rows[0]!.id, col: col(0) }, { row: rows[0]!.id, col: col(1) });
    expect(sortTable(e, id, col(0), 'desc').ok).toBe(true);
    expect(read(0)).toEqual(['c', 'b 1', 'a']); // 가로로 합친 칸(b · 1)은 행과 함께
    mergeCells(e, id, { row: rows[1]!.id, col: col(0) }, { row: rows[2]!.id, col: col(0) });
    const r = sortTable(e, id, col(1), 'asc');
    expect(r.ok).toBe(false);
    expect(isTableContent(t())).toBe(true);
  });
});
