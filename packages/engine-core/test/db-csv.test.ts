// 데이터베이스 ↔ CSV (GAP #13): 지금 보기 기준 내보내기(필터 · 정렬 · 숨긴 속성) · 따옴표 · BOM · CRLF · 내보낸 CSV를 다시 가져오면 같은 값
import { describe, expect, it } from 'vitest';
import {
  activeDbView, addDbProperty, createDatabaseBlock, csvToDatabase, dbRows, dbToCsv, Engine, isDatabaseContent, parseCsv, setDbPropertyHidden,
  setDbValue, updateDbView, type DatabaseContent, type TxResult,
} from '../src';

const val = <T,>(r: TxResult<T>): T => { if (!r.ok) throw new Error(r.reason); return r.value; };
function setup() {
  const e = new Engine();
  const blockId = val(createDatabaseBlock(e, { x: 0, y: 0 }, '과제'));
  const db = () => e.contentsOf(blockId).find(isDatabaseContent)! as DatabaseContent;
  const cid = db().id;
  const [name, status, date] = db().properties;
  const done = val(addDbProperty(e, cid, 'checkbox', '완료'))!;
  const score = val(addDbProperty(e, cid, 'number', '점수'))!;
  const rows = dbRows(db()).map((r) => r.id);
  const opt = (n: string) => status!.options!.find((o) => o.name === n)!.id;
  const data: [string, string, string, boolean, number][] = [['보고서, 초안', '할 일', '2026-10-05', false, 30], ['발표 "최종"', '완료', '2026-10-01', true, 90], ['복습', '완료', '', false, 60]];
  data.forEach(([n, s, d, c, sc], i) => {
    setDbValue(e, cid, rows[i]!, name!.id, n); setDbValue(e, cid, rows[i]!, status!.id, opt(s));
    if (d) setDbValue(e, cid, rows[i]!, date!.id, d);
    setDbValue(e, cid, rows[i]!, done, c); setDbValue(e, cid, rows[i]!, score, sc);
  });
  return { e, db, cid, status: status!, date: date!, score, opt };
}

describe('데이터베이스 → CSV', () => {
  it('머리 줄 + 항목, BOM · CRLF, 쉼표 · 따옴표는 따옴표로 감싼다, 체크박스는 예 · 아니요', () => {
    const { e, db } = setup();
    const { csv, rows } = dbToCsv(e, db());
    expect(rows).toBe(3);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv.split('\r\n')).toEqual([
      '\uFEFF이름,상태,날짜,완료,점수',
      '"보고서, 초안",할 일,2026-10-05,아니요,30',
      '"발표 ""최종""",완료,2026-10-01,예,90',
      '복습,완료,,아니요,60',
      '',
    ]);
  });

  it('지금 보기 기준 — 필터 · 정렬을 따르고 숨긴 속성은 뺀다', () => {
    const { e, db, cid, score, date } = setup();
    const v = activeDbView(db());
    val(updateDbView(e, cid, v.id, { filters: [{ propId: score, op: 'gt', value: 40 }], sorts: [{ propId: score, dir: 'desc' }] }));
    val(setDbPropertyHidden(e, cid, date.id, true));
    const lines = dbToCsv(e, db()).csv.trimEnd().split('\r\n');
    expect(lines).toEqual(['\uFEFF이름,상태,완료,점수', '"발표 ""최종""",완료,예,90', '복습,완료,아니요,60']);
  });

  it('내보낸 CSV를 다시 가져오면 같은 값 · 타입 (선택 · 날짜 · 체크박스 · 숫자)', () => {
    const { e, db } = setup();
    const table = parseCsv(dbToCsv(e, db()).csv);
    const back = csvToDatabase(table[0]!, table.slice(1), '과제').data;
    expect(back.properties.map((p) => p.type)).toEqual(['text', 'select', 'date', 'checkbox', 'number']);
    const [n, s, d, c, sc] = back.properties;
    const r = back.rows.map((x) => [x.values[n!.id], s!.options!.find((o) => o.id === x.values[s!.id])?.name, x.values[d!.id], x.values[c!.id], x.values[sc!.id]]);
    expect(r).toEqual([['보고서, 초안', '할 일', '2026-10-05', false, 30], ['발표 "최종"', '완료', '2026-10-01', true, 90], ['복습', '완료', undefined, false, 60]]);
  });
});

describe('CSV 수식 주입 막기 (DEMO-SECURITY-CHECK 2-6)', () => {
  it('= + - @ 로 시작하는 칸은 작은따옴표를 붙여 스프레드시트가 수식으로 읽지 않게', () => {
    const { e, db, cid } = setup();
    const name = db().properties[0]!, row = dbRows(db())[0]!.id;
    setDbValue(e, cid, row, name.id, '=HYPERLINK("http://x","y")');
    const { csv } = dbToCsv(e, db());
    expect(csv).toContain(`"'=HYPERLINK(""http://x"",""y"")"`);
    expect(csv).not.toMatch(/(^|,)=HYPERLINK/m);
  });
});

