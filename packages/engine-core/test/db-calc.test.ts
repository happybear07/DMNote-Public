// 데이터베이스 열 계산 · 타임라인 · 차트 (GAP #20): 지금 보기 항목으로 계산, 타입별 계산 목록, 막대 범위, 묶음별 개수 · 합
import { describe, expect, it } from 'vitest';
import {
  addDbProperty, calcOptions, chartBars, columnCalc, createDatabaseBlock, dayIndex, dayString, dbRows, Engine, isDatabaseContent, setDbValue, timelineBars,
  type DatabaseContent, type TxResult,
} from '../src';

const val = <T,>(r: TxResult<T>): T => { if (!r.ok) throw new Error(r.reason); return r.value; };
function setup() {
  const e = new Engine();
  const blockId = val(createDatabaseBlock(e, { x: 0, y: 0 }));
  const db = () => e.contentsOf(blockId).find(isDatabaseContent)! as DatabaseContent;
  const cid = db().id;
  const [name, status, date] = db().properties;
  const score = val(addDbProperty(e, cid, 'number', '점수'))!, done = val(addDbProperty(e, cid, 'checkbox', '완료'))!, end = val(addDbProperty(e, cid, 'date', '끝'))!;
  const rows = dbRows(db()).map((r) => r.id);
  const opt = (n: string) => status!.options!.find((o) => o.name === n)!.id;
  const data: [string, string, string, string, number | null, boolean][] = [['가', '할 일', '2026-10-01', '2026-10-05', 30, true], ['나', '완료', '2026-10-03', '', 90, false], ['다', '할 일', '', '', null, true]];
  data.forEach(([n, s, d, en, sc, c], i) => {
    setDbValue(e, cid, rows[i]!, name!.id, n); setDbValue(e, cid, rows[i]!, status!.id, opt(s));
    if (d) setDbValue(e, cid, rows[i]!, date!.id, d);
    if (en) setDbValue(e, cid, rows[i]!, end, en);
    if (sc !== null) setDbValue(e, cid, rows[i]!, score, sc);
    setDbValue(e, cid, rows[i]!, done, c);
  });
  const P = (id: string) => db().properties.find((p) => p.id === id)!;
  return { db, P, status: status!, date: date!, score, done, end };
}

describe('열 계산', () => {
  it('타입별 계산 목록', () => {
    const { P, score, done, date } = setup();
    expect(calcOptions(P(score))).toContain('sum');
    expect(calcOptions(P(done))).toEqual(['checked', 'unchecked', 'checkedPct']);
    expect(calcOptions(P(date.id))).toContain('earliest');
  });
  it('개수 · 빈 칸 · 합 · 평균 · 가운데 · 범위 · 체크 비율 · 가장 이른 날', () => {
    const { db, P, score, done, date } = setup();
    const rows = dbRows(db()), c = (id: string, fn: Parameters<typeof columnCalc>[3]) => columnCalc(db(), rows, P(id), fn);
    expect([c(score, 'count'), c(score, 'empty'), c(score, 'sum'), c(score, 'avg'), c(score, 'median'), c(score, 'range')]).toEqual(['2', '1', '120', '60', '60', '60']);
    expect([c(done, 'checked'), c(done, 'checkedPct')]).toEqual(['2', '67%']);
    expect([c(date.id, 'earliest'), c(date.id, 'latest'), c(date.id, 'filled')]).toEqual(['2026-10-01', '2026-10-03', '67%']);
    expect(columnCalc(db(), [], P(score), 'avg')).toBe('—');
  });
});

describe('타임라인 · 차트', () => {
  it('막대: 시작 ~ 끝(없으면 하루), 날짜 없는 항목은 수만', () => {
    const { db, P, date, end } = setup();
    const { bars, undated } = timelineBars(db(), dbRows(db()), P(date.id), P(end));
    expect(bars.map((b) => [dayString(b.start), dayString(b.end)])).toEqual([['2026-10-01', '2026-10-05'], ['2026-10-03', '2026-10-03']]);
    expect(undated).toBe(1);
    expect(dayIndex('2026-10-05') - dayIndex('2026-10-01')).toBe(4);
  });
  it('차트: 상태별 개수 · 점수 합 · 체크박스 예/아니요', () => {
    const { db, P, status, score, done } = setup();
    const rows = dbRows(db());
    expect(chartBars(db(), rows, P(status.id)).map((b) => [b.label, b.value])).toEqual([['할 일', 2], ['완료', 1]]);
    expect(chartBars(db(), rows, P(status.id), P(score)).map((b) => [b.label, b.value])).toEqual([['할 일', 30], ['완료', 90]]);
    expect(chartBars(db(), rows, P(done)).map((b) => [b.label, b.value])).toEqual([['예', 2], ['아니요', 1]]);
  });
});
