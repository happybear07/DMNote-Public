// 데이터베이스 블록 (FR-055 · 056 · 057): 만들기 · 항목 추가/삭제/순서 · 속성 추가/이름/삭제/순서/너비/숨김 · 타입 변환 규칙 · 옵션 · 실행 취소 · 직렬화
import { describe, expect, it } from 'vitest';
import {
  addDbOption, addDbProperty, addDbRow, convertValue, createDatabaseBlock, dbCellText, dbRows, deleteDbOption, deleteDbProperty, deleteDbRows,
  deserialize, Engine, isDatabaseContent, moveDbProperty, moveDbRow, renameDbProperty, SCHEMA_VERSION, serialize, setDbPropertyHidden,
  setDbPropertyType, setDbPropertyWidth, setDbValue, type DatabaseContent, type DbProperty, type TxResult,
} from '../src';

const val = <T,>(r: TxResult<T>): T => { if (!r.ok) throw new Error(r.reason); return r.value; };
function setup() {
  const e = new Engine();
  const blockId = val(createDatabaseBlock(e, { x: 0, y: 0 }, '과제'));
  const db = () => e.contentsOf(blockId).find(isDatabaseContent)! as DatabaseContent;
  return { e, blockId, db, cid: db().id };
}

describe('데이터베이스 블록', () => {
  it('만들기: 이름 · 상태 · 날짜 속성과 빈 항목 셋, 한 번에 실행 취소', () => {
    const { e, db, blockId } = setup();
    expect(db().title).toBe('과제');
    expect(db().properties.map((p) => p.type)).toEqual(['text', 'select', 'date']);
    expect(db().rows).toHaveLength(3);
    e.undo();
    expect(e.getBlock(blockId)).toBeUndefined();
  });

  it('항목 추가(중간 · 끝) · 삭제 · 순서 바꾸기', () => {
    const { e, db, cid } = setup();
    const [a, b] = dbRows(db()).map((r) => r.id);
    const n = val(addDbRow(e, cid, a))!;
    expect(dbRows(db()).map((r) => r.id).indexOf(n)).toBe(1);
    moveDbRow(e, cid, n, null);
    expect(dbRows(db()).at(-1)!.id).toBe(n);
    moveDbRow(e, cid, n, a!);
    expect(dbRows(db())[0]!.id).toBe(n);
    deleteDbRows(e, cid, [n, b!]);
    expect(db().rows).toHaveLength(2);
  });

  it('속성 추가 · 이름 · 순서 · 너비 · 숨김 · 삭제 (첫 속성은 지키기)', () => {
    const { e, db, cid } = setup();
    const p = val(addDbProperty(e, cid, 'number'))!;
    expect(db().properties.at(-1)!.name).toBe('숫자');
    renameDbProperty(e, cid, p, '점수');
    moveDbProperty(e, cid, p, 1);
    expect(db().properties[1]!.name).toBe('점수');
    moveDbProperty(e, cid, p, 0);
    expect(db().properties[0]!.name).toBe('이름');
    setDbPropertyWidth(e, cid, p, 20);
    expect(db().properties[1]!.width).toBe(60);
    setDbPropertyHidden(e, cid, p, true);
    expect(db().properties[1]!.hidden).toBe(true);
    const first = db().properties[0]!.id;
    deleteDbProperty(e, cid, first);
    setDbPropertyHidden(e, cid, first, true);
    expect(db().properties[0]!.id).toBe(first);
    expect(db().properties[0]!.hidden).toBeFalsy();
    const row = db().rows[0]!.id;
    setDbValue(e, cid, row, p, 90);
    deleteDbProperty(e, cid, p);
    expect(db().properties.some((x) => x.id === p)).toBe(false);
    expect(p in db().rows[0]!.values).toBe(false);
  });

  it('타입 변환 규칙', () => {
    const text: DbProperty = { id: 't', name: 't', type: 'text' };
    const opts: { id: string; name: string; color: string }[] = [];
    expect(convertValue('1,200원', text, 'number', opts)).toEqual({ value: 1200, lost: false });
    expect(convertValue('많음', text, 'number', opts)).toEqual({ value: null, lost: true });
    expect(convertValue('2026.3.7', text, 'date', opts).value).toBe('2026-03-07');
    expect(convertValue('예', text, 'checkbox', opts).value).toBe(true);
    const m = convertValue('수학, 영어, 수학', text, 'multiSelect', opts);
    expect((m.value as string[]).length).toBe(2);
    expect(opts.map((o) => o.name)).toEqual(['수학', '영어']);
    const sel: DbProperty = { id: 's', name: 's', type: 'multiSelect', options: opts };
    expect(convertValue(m.value, sel, 'text', []).value).toBe('수학, 영어');
    expect(convertValue(true, { id: 'c', name: 'c', type: 'checkbox' }, 'number', []).value).toBe(1);
  });

  it('타입 바꾸기: 값 옮기기, 못 옮긴 값은 raw에 두었다가 되돌리면 되살림', () => {
    const { e, db, cid } = setup();
    const p = val(addDbProperty(e, cid, 'text', '메모'))!;
    const [r1, r2] = dbRows(db()).map((r) => r.id);
    setDbValue(e, cid, r1!, p, '42');
    setDbValue(e, cid, r2!, p, '많이');
    setDbPropertyType(e, cid, p, 'number');
    const rows = () => Object.fromEntries(db().rows.map((r) => [r.id, r]));
    expect(rows()[r1!]!.values[p]).toBe(42);
    expect(rows()[r2!]!.values[p]).toBeNull();
    expect(rows()[r2!]!.raw?.[p]).toBe('많이');
    setDbPropertyType(e, cid, p, 'text');
    expect(rows()[r2!]!.values[p]).toBe('많이');
    expect(rows()[r2!]!.raw).toBeUndefined();
    setDbPropertyType(e, cid, p, 'select');
    const prop = db().properties.find((x) => x.id === p)!;
    expect(prop.options!.map((o) => o.name).sort()).toEqual(['42', '많이']);
    expect(dbCellText(prop, rows()[r2!]!.values[p])).toBe('많이');
  });

  it('옵션 추가 · 이름 · 삭제(고른 값도 비움)', () => {
    const { e, db, cid } = setup();
    const status = db().properties[1]!;
    const o = val(addDbOption(e, cid, status.id, '보류'))!;
    expect(val(addDbOption(e, cid, status.id, '보류'))).toBe(o);
    const r = db().rows[0]!.id;
    setDbValue(e, cid, r, status.id, o);
    deleteDbOption(e, cid, status.id, o);
    expect(db().rows.find((x) => x.id === r)!.values[status.id]).toBeNull();
  });

  it('스키마 v5 직렬화 왕복 · v4 문서도 읽힘', () => {
    const { e, db } = setup();
    expect(SCHEMA_VERSION).toBe(6);
    const snap = serialize(e);
    const back = deserialize(JSON.parse(JSON.stringify(snap)));
    expect(back.ok && [...new Engine(back.data).contents()].some((c) => isDatabaseContent(c) && c.rows.length === db().rows.length)).toBe(true);
    const v4 = deserialize({ ...JSON.parse(JSON.stringify(snap)), schemaVersion: 4 });
    expect(v4.ok && v4.migratedFrom).toBe(4);
  });
});
