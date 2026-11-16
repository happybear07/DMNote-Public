// 관계 · 집계 (FR-062): 짝 속성 양방향 · 항목 삭제 · 속성 삭제 · 실행 취소 · 집계 함수 · 한쪽만 이어진 관계 · 보기 조건
import { describe, expect, it } from 'vitest';
import {
  addDbProperty, addDbRelation, addDbRollup, createDatabaseBlock, dbCellTextIn, dbRows, deleteDbProperty, deleteDbRows, Engine, filterOps,
  isDatabaseContent, relationTargets, rollupValue, setDbPropertyType, setDbRelation, setDbRollup, setDbValue, viewRows,
  type DatabaseContent, type TxResult,
} from '../src';

const val = <T,>(r: TxResult<T>): T => { if (!r.ok) throw new Error(r.reason); return r.value; };
function setup() {
  const e = new Engine();
  const mk = (title: string, x: number) => { const b = val(createDatabaseBlock(e, { x, y: 0 }, title)); return () => e.contentsOf(b).find(isDatabaseContent)! as DatabaseContent; };
  const proj = mk('프로젝트', 0), task = mk('할 일', 800);
  const name = (db: () => DatabaseContent, i: number, n: string) => { const d = db(); val(setDbValue(e, d.id, dbRows(d)[i]!.id, d.properties[0]!.id, n)); };
  name(proj, 0, '홈페이지'); name(proj, 1, '앱');
  name(task, 0, '디자인'); name(task, 1, '개발'); name(task, 2, '시험');
  const rel = val(addDbRelation(e, proj().id, task().id))!;
  return { e, proj, task, rel, row: (db: () => DatabaseContent, i: number) => dbRows(db())[i]!.id };
}

describe('관계 · 집계', () => {
  it('관계 추가: 양쪽에 짝 속성 (이름 = 서로의 데이터베이스 이름), 대상 목록', () => {
    const { proj, task, rel, e } = setup();
    const pa = proj().properties.find((p) => p.id === rel)!;
    const pb = task().properties.find((p) => p.type === 'relation')!;
    expect(pa).toMatchObject({ name: '할 일', type: 'relation', relation: { db: task().id, pair: pb.id } });
    expect(pb).toMatchObject({ name: '프로젝트', relation: { db: proj().id, pair: rel } });
    expect(relationTargets(e, proj().id).map((t) => t.title)).toEqual(['할 일']);
  });

  it('잇기 · 끊기가 양쪽에 (한 번에 실행 취소), 저쪽에서 고쳐도 이쪽에', () => {
    const { e, proj, task, rel, row } = setup();
    const pb = task().properties.find((p) => p.type === 'relation')!.id;
    val(setDbRelation(e, proj().id, row(proj, 0), rel, [row(task, 0), row(task, 1)]));
    expect(dbCellTextIn(e, proj(), dbRows(proj())[0]!, proj().properties.find((p) => p.id === rel)!)).toBe('디자인, 개발');
    expect(dbRows(task()).map((r) => r.values[pb] ?? [])).toEqual([[row(proj, 0)], [row(proj, 0)], []]);
    val(setDbRelation(e, task().id, row(task, 1), pb, [row(proj, 0), row(proj, 1)]));
    expect(dbRows(proj()).map((r) => r.values[rel] ?? [])).toEqual([[row(task, 0), row(task, 1)], [row(task, 1)], []]);
    e.undo();
    expect(dbRows(proj())[1]!.values[rel] ?? []).toEqual([]);
    expect(dbRows(task())[1]!.values[pb]).toEqual([row(proj, 0)]);
  });

  it('항목을 지우면 저쪽 연결에서도 빠지고, 실행 취소로 함께 돌아옴', () => {
    const { e, proj, task, rel, row } = setup();
    const gone = row(task, 0);
    val(setDbRelation(e, proj().id, row(proj, 0), rel, [gone, row(task, 2)]));
    val(deleteDbRows(e, task().id, [gone]));
    expect(dbRows(proj())[0]!.values[rel]).toEqual([row(task, 1)]);
    e.undo();
    expect(dbRows(proj())[0]!.values[rel]).toEqual([gone, row(task, 2)]);
  });

  it('집계: 개수 · 합계 · 평균 · 최소 · 최대 · 체크된 수 · 나열', () => {
    const { e, proj, task, rel, row } = setup();
    const hours = val(addDbProperty(e, task().id, 'number', '시간'))!;
    const done = val(addDbProperty(e, task().id, 'checkbox', '끝남'))!;
    [3, 4.5, 2].forEach((h, i) => val(setDbValue(e, task().id, row(task, i), hours, h)));
    val(setDbValue(e, task().id, row(task, 1), done, true));
    val(setDbRelation(e, proj().id, row(proj, 0), rel, [row(task, 0), row(task, 1), row(task, 2)]));
    const ru = val(addDbRollup(e, proj().id))!;
    const v = (fn: Parameters<typeof setDbRollup>[3]['fn'], prop?: string) => {
      val(setDbRollup(e, proj().id, ru, { fn, ...(prop ? { prop } : {}) }));
      const d = proj();
      return rollupValue(e, d, dbRows(d)[0]!, d.properties.find((p) => p.id === ru)!);
    };
    expect(v('count')).toBe(3);
    expect(v('sum', hours)).toBe(9.5);
    expect(v('avg')).toBeCloseTo(9.5 / 3);
    expect(v('min')).toBe(2);
    expect(v('max')).toBe(4.5);
    expect(v('checked', done)).toBe(1);
    expect(v('list', task().properties[0]!.id)).toBe('디자인, 개발, 시험');
    val(setDbRollup(e, proj().id, ru, { fn: 'avg', prop: hours }));
    const d = proj();
    expect(dbCellTextIn(e, d, dbRows(d)[0]!, d.properties.find((p) => p.id === ru)!)).toBe('3.17');
    expect(rollupValue(e, d, dbRows(d)[1]!, d.properties.find((p) => p.id === ru)!)).toBeNull(); // 연결 없음 → 평균 없음
  });

  it('관계 속성을 지우면 저쪽 짝 · 이 관계를 쓰는 집계도 지움 (실행 취소로 모두 복구)', () => {
    const { e, proj, task, rel, row } = setup();
    val(setDbRelation(e, proj().id, row(proj, 0), rel, [row(task, 0)]));
    const ru = val(addDbRollup(e, proj().id))!;
    val(deleteDbProperty(e, proj().id, rel));
    expect(proj().properties.some((p) => p.id === rel || p.id === ru)).toBe(false);
    expect(task().properties.some((p) => p.type === 'relation')).toBe(false);
    expect(dbRows(task())[0]!.values).not.toHaveProperty(String(task().properties.find((p) => p.type === 'relation')?.id));
    e.undo();
    expect(proj().properties.filter((p) => p.id === rel || p.id === ru)).toHaveLength(2);
    expect(dbRows(task())[0]!.values[task().properties.find((p) => p.type === 'relation')!.id]).toEqual([row(proj, 0)]);
  });

  it('짝이 맞지 않는 관계(복사본)는 이쪽만 고침 · 관계 · 집계로 타입 바꾸기는 막음', () => {
    const { e, proj, task, rel, row } = setup();
    // 프로젝트 데이터베이스를 그대로 복사한 셈: 같은 관계 속성이 할 일을 가리키지만 할 일의 짝은 원본을 가리킨다
    const copyBlock = val(createDatabaseBlock(e, { x: 0, y: 600 }, '복사본'));
    const copy = () => e.contentsOf(copyBlock).find(isDatabaseContent)! as DatabaseContent;
    e.transact((tx) => tx.set('content', copy().id, { properties: [...copy().properties, proj().properties.find((p) => p.id === rel)!] }), { origin: 'user' });
    const before = JSON.stringify(task().rows);
    val(setDbRelation(e, copy().id, dbRows(copy())[0]!.id, rel, [row(task, 0)]));
    expect(dbRows(copy())[0]!.values[rel]).toEqual([row(task, 0)]);
    expect(JSON.stringify(task().rows)).toBe(before);
    const t0 = JSON.stringify(proj().properties);
    setDbPropertyType(e, proj().id, rel, 'text');
    setDbPropertyType(e, proj().id, proj().properties[2]!.id, 'relation');
    expect(JSON.stringify(proj().properties)).toBe(t0);
  });

  it('보기: 관계는 비었는지로 거르고 연결 수로 정렬, 집계는 조건 없음', () => {
    const { e, proj, task, rel, row } = setup();
    val(setDbRelation(e, proj().id, row(proj, 1), rel, [row(task, 0), row(task, 1)]));
    const p = proj().properties.find((x) => x.id === rel)!;
    expect(filterOps(p)).toEqual(['empty', 'notEmpty']);
    const ru = val(addDbRollup(e, proj().id))!;
    expect(filterOps(proj().properties.find((x) => x.id === ru)!)).toEqual([]);
    const v = { id: 'v', name: '표', kind: 'table' as const, filters: [{ propId: rel, op: 'notEmpty' as const }] };
    expect(viewRows(proj(), v).map((r) => r.id)).toEqual([row(proj, 1)]);
    const s = { id: 'v', name: '표', kind: 'table' as const, sorts: [{ propId: rel, dir: 'desc' as const }] };
    expect(viewRows(proj(), s)[0]!.id).toBe(row(proj, 1));
  });
});
