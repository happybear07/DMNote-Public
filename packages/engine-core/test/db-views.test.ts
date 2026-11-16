// 데이터베이스 뷰 (FR-058 ~ 061): 기본 표 뷰 · 뷰 추가/바꾸기/삭제 · 필터(타입별 조건, 모두/하나라도) · 다중 정렬 · 뷰별 저장
import { describe, expect, it } from 'vitest';
import {
  activeDbView, addDbProperty, addDbView, boardProp, calendarProp, createDatabaseBlock, dbRows, dbViews, deleteDbView, Engine, isDatabaseContent,
  matchFilter, setActiveDbView, setDbValue, updateDbView, viewRows, type DatabaseContent, type DbProperty, type DbViewsData, type TxResult,
} from '../src';

const val = <T,>(r: TxResult<T>): T => { if (!r.ok) throw new Error(r.reason); return r.value; };
function setup() {
  const e = new Engine();
  const blockId = val(createDatabaseBlock(e, { x: 0, y: 0 }));
  const db = () => e.contentsOf(blockId).find(isDatabaseContent)! as DatabaseContent & DbViewsData;
  const cid = db().id;
  const [name, status, date] = db().properties;
  const score = val(addDbProperty(e, cid, 'number', '점수'))!;
  const rows = dbRows(db()).map((r) => r.id);
  const opt = (n: string) => status!.options!.find((o) => o.name === n)!.id;
  const data: [string, string, string, number][] = [['가', '할 일', '2026-10-05', 30], ['나', '완료', '2026-10-01', 90], ['다', '진행 중', '', 60]];
  data.forEach(([n, s, d, sc], i) => {
    setDbValue(e, cid, rows[i]!, name!.id, n); setDbValue(e, cid, rows[i]!, status!.id, opt(s));
    if (d) setDbValue(e, cid, rows[i]!, date!.id, d);
    setDbValue(e, cid, rows[i]!, score, sc);
  });
  return { e, db, cid, name: name!, status: status!, date: date!, score, opt };
}
const names = (d: DatabaseContent & DbViewsData, nameId: string) => viewRows(d, activeDbView(d)).map((r) => r.values[nameId]);

describe('데이터베이스 뷰', () => {
  it('뷰가 없으면 기본 표 뷰 하나', () => {
    const { db } = setup();
    expect(dbViews(db()).map((v) => v.kind)).toEqual(['table']);
  });

  it('뷰 추가 → 활성 · 바꾸기 · 삭제(마지막 하나는 남김)', () => {
    const { e, db, cid } = setup();
    addDbView(e, cid, 'board');
    expect(activeDbView(db()).kind).toBe('board');
    expect(dbViews(db())).toHaveLength(2);
    setActiveDbView(e, cid, dbViews(db())[0]!.id);
    expect(activeDbView(db()).kind).toBe('table');
    deleteDbView(e, cid, dbViews(db())[1]!.id);
    deleteDbView(e, cid, dbViews(db())[0]!.id);
    expect(dbViews(db())).toHaveLength(1);
  });

  it('필터: 숫자 · 선택 · 날짜 · 글자, 모두/하나라도 — 뷰마다 따로', () => {
    const { e, db, cid, name, status, date, score, opt } = setup();
    const v = activeDbView(db()).id;
    updateDbView(e, cid, v, { filters: [{ propId: score, op: 'gte', value: 60 }] });
    expect(names(db(), name.id)).toEqual(['나', '다']);
    updateDbView(e, cid, dbViews(db())[0]!.id, { filters: [{ propId: score, op: 'gte', value: 60 }, { propId: status.id, op: 'is', value: opt('완료') }] });
    expect(names(db(), name.id)).toEqual(['나']);
    updateDbView(e, cid, dbViews(db())[0]!.id, { match: 'or' });
    expect(names(db(), name.id)).toEqual(['나', '다']);
    addDbView(e, cid, 'table');
    expect(names(db(), name.id)).toHaveLength(3); // 새 뷰는 필터 없음
    updateDbView(e, cid, activeDbView(db()).id, { filters: [{ propId: date.id, op: 'before', value: '2026-10-03' }] });
    expect(names(db(), name.id)).toEqual(['나']);
    updateDbView(e, cid, activeDbView(db()).id, { filters: [{ propId: name.id, op: 'contains', value: '' }, { propId: date.id, op: 'empty' }] });
    expect(names(db(), name.id)).toEqual(['다']);
  });

  it('조건 판정 세부', () => {
    const multi: DbProperty = { id: 'm', name: 'm', type: 'multiSelect', options: [{ id: 'a', name: 'A', color: 'gray' }] };
    expect(matchFilter(multi, ['a'], { propId: 'm', op: 'contains', value: 'a' })).toBe(true);
    expect(matchFilter(multi, [], { propId: 'm', op: 'empty' })).toBe(true);
    const chk: DbProperty = { id: 'c', name: 'c', type: 'checkbox' };
    expect(matchFilter(chk, undefined, { propId: 'c', op: 'unchecked' })).toBe(true);
  });

  it('다중 정렬: 같으면 다음 기준 · 원래 순서', () => {
    const { e, db, cid, name, status, score } = setup();
    const v = activeDbView(db()).id;
    updateDbView(e, cid, v, { sorts: [{ propId: score, dir: 'desc' }] });
    expect(names(db(), name.id)).toEqual(['나', '다', '가']);
    updateDbView(e, cid, v, { sorts: [{ propId: status.id, dir: 'asc' }, { propId: score, dir: 'asc' }] });
    expect(names(db(), name.id)).toEqual(['가', '다', '나']); // 옵션 순서: 할 일 · 진행 중 · 완료
    updateDbView(e, cid, v, { sorts: [{ propId: name.id, dir: 'desc' }] });
    expect(names(db(), name.id)).toEqual(['다', '나', '가']);
  });

  it('보드 · 캘린더 기준 속성 기본값', () => {
    const { db, status, date } = setup();
    expect(boardProp(db(), activeDbView(db()))?.id).toBe(status.id);
    expect(calendarProp(db(), activeDbView(db()))?.id).toBe(date.id);
  });
});
