// 데이터베이스 새 속성 (GAP #19): 수식 문법 · 계산 · 오류, 상태(묶음 · 정렬 · 보드), 만든 때 · 고친 때, 파일(해시:이름 · 첨부 모으기)
import { describe, expect, it } from 'vitest';
import {
  activeDbView, addDbProperty, addDbRow, boardProp, cellValue, createDatabaseBlock, dbCellTextIn, dbFilesWith, dbRows, Engine, evalFormula,
  isDatabaseContent, noteAttachments, parseFormula, setDbFormula, setDbPropertyType, setDbValue, updateDbView, viewRows, type DatabaseContent, type TxResult,
} from '../src';

const val = <T,>(r: TxResult<T>): T => { if (!r.ok) throw new Error(r.reason); return r.value; };
const calc = (src: string, props: Record<string, number | string | boolean | null> = {}) => evalFormula(parseFormula(src), (n) => { if (!(n in props)) throw new Error(n); return props[n]!; });

describe('수식 문법 · 계산', () => {
  it('사칙 · 우선순위 · 괄호 · 비교 · 논리', () => {
    expect(calc('1 + 2 * 3')).toBe(7);
    expect(calc('(1 + 2) * 3')).toBe(9);
    expect(calc('10 - 4 - 3')).toBe(3);
    expect(calc('7 % 3 == 1 && !(2 > 3)')).toBe(true);
    expect(calc('1 < 2 or false')).toBe(true);
    expect(calc('-prop("a") + 1', { a: 5 })).toBe(-4);
  });
  it('글자 잇기 · 함수 · 날짜', () => {
    expect(calc('"점수: " + prop("점수")', { 점수: 90 })).toBe('점수: 90');
    expect(calc('if(prop("점수") >= 60, "통과", "다시")', { 점수: 59 })).toBe('다시');
    expect(calc('round(10 / 3, 2)')).toBe(3.33);
    expect(calc('concat(upper("ab"), length("가나다"))')).toBe('AB3');
    expect(calc('dateBetween("2026-10-13", "2026-10-01", "days")')).toBe(12);
    expect(calc('dateAdd("2026-01-31", 1, "months")')).toBe('2026-03-03');
    expect(calc('year("2026-10-13") * 100 + month("2026-10-13")')).toBe(202610);
    expect(calc('empty("") && not(empty(0))')).toBe(true);
  });
  it('잘못 쓰면 한국어 오류', () => {
    expect(() => parseFormula('1 +')).toThrow('덜 끝났');
    expect(() => parseFormula('foo(1)')).toThrow('모르는 함수');
    expect(() => parseFormula('점수 * 2')).toThrow('읽을 수 없는 글자');
    expect(() => calc('1 / 0')).toThrow('0으로');
  });
});

function setup() {
  const e = new Engine();
  const blockId = val(createDatabaseBlock(e, { x: 0, y: 0 }));
  const db = () => e.contentsOf(blockId).find(isDatabaseContent)! as DatabaseContent;
  const cid = db().id;
  const [name, status] = db().properties;
  const score = val(addDbProperty(e, cid, 'number', '점수'))!;
  const rows = dbRows(db()).map((r) => r.id);
  return { e, db, cid, name: name!, status: status!, score, rows };
}

describe('계산 속성 · 상태 · 파일', () => {
  it('수식 속성: 다른 속성으로 계산, 오류는 #오류, 정렬 · 필터도 계산 값으로', () => {
    const { e, db, cid, name, score, rows } = setup();
    [['가', 30], ['나', 90], ['다', 60]].forEach(([n, s], i) => { setDbValue(e, cid, rows[i]!, name.id, n as string); setDbValue(e, cid, rows[i]!, score, s as number); });
    const f = val(addDbProperty(e, cid, 'formula', '등급'))!;
    val(setDbFormula(e, cid, f, 'if(prop("점수") >= 60, "통과", "다시") + " " + prop("이름")'));
    const p = db().properties.find((x) => x.id === f)!;
    expect(dbRows(db()).map((r) => dbCellTextIn(e, db(), r, p))).toEqual(['다시 가', '통과 나', '통과 다']);
    const v = activeDbView(db());
    val(updateDbView(e, cid, v.id, { filters: [{ propId: f, op: 'contains', value: '통과' }], sorts: [{ propId: f, dir: 'desc' }] }));
    expect(viewRows(db(), activeDbView(db())).map((r) => r.values[name.id])).toEqual(['다', '나']);
    val(setDbFormula(e, cid, f, 'prop("없는 것") + 1'));
    expect(dbCellTextIn(e, db(), dbRows(db())[0]!, db().properties.find((x) => x.id === f)!)).toBe('#오류');
  });

  it('상태: 선택 → 상태로 바꾸면 이름으로 묶음 짐작 · 정렬은 묶음 차례 · 보드 기준', () => {
    const { e, db, cid, name, status, rows } = setup();
    const opt = (n: string) => db().properties.find((x) => x.id === status.id)!.options!.find((o) => o.name === n)!.id;
    ['완료', '할 일', '진행 중'].forEach((s, i) => { setDbValue(e, cid, rows[i]!, status.id, opt(s)); setDbValue(e, cid, rows[i]!, name.id, s); });
    val(setDbPropertyType(e, cid, status.id, 'status'));
    const p = db().properties.find((x) => x.id === status.id)!;
    expect(p.type).toBe('status');
    expect(p.options!.map((o) => [o.name, o.group])).toEqual([['할 일', 'todo'], ['진행 중', 'doing'], ['완료', 'done']]);
    const v = activeDbView(db());
    val(updateDbView(e, cid, v.id, { sorts: [{ propId: status.id, dir: 'asc' }] }));
    expect(viewRows(db(), activeDbView(db())).map((r) => r.values[name.id])).toEqual(['할 일', '진행 중', '완료']);
    expect(boardProp(db(), activeDbView(db()))?.id).toBe(status.id);
    const fresh = val(addDbProperty(e, cid, 'status', '단계'))!;
    expect(db().properties.find((x) => x.id === fresh)!.options!.map((o) => o.group)).toEqual(['todo', 'doing', 'done']);
  });

  it('만든 때 · 고친 때: 새 항목 · 값 바꾸기에 적힌다', () => {
    const { e, db, cid, name } = setup();
    const id = val(addDbRow(e, cid))!;
    const c = val(addDbProperty(e, cid, 'created'))!, ed = val(addDbProperty(e, cid, 'edited'))!;
    const row = () => db().rows.find((r) => r.id === id)!;
    expect(cellValue(db(), row(), db().properties.find((x) => x.id === c)!)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    const before = row().edited!;
    setDbValue(e, cid, id, name.id, '바꿈');
    expect(row().edited!).toBeGreaterThanOrEqual(before);
    expect(String(cellValue(db(), row(), db().properties.find((x) => x.id === ed)!))).toMatch(/^\d{4}-/);
  });

  it('파일: 해시:이름 값 · 칸 글자 · 노트 첨부에 들어감', () => {
    const { e, db, cid, rows } = setup();
    const f = val(addDbProperty(e, cid, 'files', '첨부'))!;
    setDbValue(e, cid, rows[0]!, f, dbFilesWith(db(), rows[0]!, f, [{ hash: 'abc123', name: '보고서.pdf' }, { hash: 'def456', name: 'a:b.png' }]));
    const p = db().properties.find((x) => x.id === f)!;
    expect(dbCellTextIn(e, db(), dbRows(db())[0]!, p)).toBe('보고서.pdf, a:b.png');
    expect(noteAttachments(e)).toEqual(expect.arrayContaining([{ hash: 'abc123', name: '보고서.pdf' }, { hash: 'def456', name: 'a:b.png' }]));
    setDbValue(e, cid, rows[0]!, f, dbFilesWith(db(), rows[0]!, f, [], 'abc123'));
    expect(dbCellTextIn(e, db(), dbRows(db())[0]!, p)).toBe('a:b.png');
  });
});
