// 그래프 ↔ 표 바꾸기 (FR-110, rich-convert.ts): 같은 수치를 다른 모양으로, 블록 · 화살표 · 출처는 그대로, 실행 취소 한 번
import { describe, expect, it } from 'vitest';
import { cellNumber, cellText, chartToTable, convertRich, createArrow, createTextBlock, Engine, makeChart, makeTable, sortedRows, tableToChart, type ChartData, type TableData, type TxResult } from '../src';

const val = <T,>(r: TxResult<T>): T => { if (!r.ok) throw new Error(r.reason); return r.value; };
const grid = (t: TableData) => [t.columns.map((c) => c.name), ...sortedRows(t).map((r) => t.columns.map((c) => cellText(r.cells[c.id])))];

describe('그래프 ↔ 표', () => {
  it('칸 글자 → 수: 쉼표 · 단위 꼬리 · 퍼센트, 글자는 null', () => {
    expect(cellNumber('1,240억')).toBe(1240);
    expect(cellNumber('58%')).toBe(58);
    expect(cellNumber(' -3.5 ')).toBe(-3.5);
    expect(cellNumber('높음')).toBeNull();
  });

  it('그래프 → 표: 첫 열 항목, 계열마다 열(단위는 괄호), 빈 값은 빈 칸', () => {
    const c = makeChart('line', [{ name: '팀 A', points: [{ x: '1월', y: 24 }, { x: '2월', y: 17 }] }, { name: '팀 B', points: [{ x: '1월', y: 9 }] }], '배포 횟수', '회');
    expect(grid(chartToTable(c))).toEqual([['항목', '팀 A (회)', '팀 B (회)'], ['1월', '24', '9'], ['2월', '17', '']]);
    expect(chartToTable(c).title).toBe('배포 횟수');
  });

  it('표 → 그래프: 숫자 열만 계열, 공통 단위는 단위로, 시간 항목은 선 · 아니면 막대', () => {
    const t = makeTable(['분기', '매출 (억)', '이익 (억)', '비고'], [['2025 1분기', '120', '8', '흑자'], ['2025 2분기', '140', '12', '—']], '실적');
    const c = tableToChart(t)!;
    expect(c.kind).toBe('line');
    expect(c.unit).toBe('억');
    expect(c.series.map((s) => s.name)).toEqual(['매출', '이익']);
    expect(c.series[0]!.points).toEqual([{ x: '2025 1분기', y: 120 }, { x: '2025 2분기', y: 140 }]);
    expect(tableToChart(makeTable(['언어', '장점'], [['Python', '쉬움'], ['Go', '빠름']]))).toBeNull();
    expect(tableToChart(makeTable(['DB', '점유율'], [['PG', '45%'], ['MySQL', '30%']]))!.kind).toBe('bar');
  });

  it('왕복: 그래프 → 표 → 그래프는 같은 수치', () => {
    const c = makeChart('bar', [{ name: '점유율', points: [{ x: 'AWS', y: 58 }, { x: 'Azure', y: 14 }] }], '점유율', '%');
    const back = tableToChart(chartToTable(c)) as ChartData;
    expect(back.series.map((s) => [s.name, s.points])).toEqual([['점유율', [{ x: 'AWS', y: 58 }, { x: 'Azure', y: 14 }]]]);
    expect(back.unit).toBe('%');
  });

  it('convertRich: 블록 · 화살표 · 출처는 그대로, 실행 취소 한 번이면 처음대로', () => {
    const e = new Engine();
    const a = val(createTextBlock(e, { x: 0, y: 0 }, { title: '근거' })).blockId;
    let id = '';
    e.transact((tx) => {
      id = tx.createBlock({ x: 300, y: 0, w: 360, h: 240 });
      tx.createContent({ type: 'chart', blockId: id, ...makeChart('bar', [{ name: 'v', points: [{ x: 'a', y: 1 }] }]), ai: { generated: true, runId: 'r1' } } as never);
    }, { origin: 'user' });
    val(createArrow(e, { blockId: a, side: 'auto' }, { blockId: id, side: 'auto' }));
    val(convertRich(e, id, 'table'));
    const c = e.contentsOf(id);
    expect(c).toHaveLength(1);
    expect(c[0]!.type).toBe('table');
    expect(c[0]!.ai?.runId).toBe('r1');
    expect([...e.arrows()]).toHaveLength(1);
    expect(convertRich(e, id, 'table').ok).toBe(false);
    e.undo();
    expect(e.contentsOf(id)[0]!.type).toBe('chart');
  });
});
