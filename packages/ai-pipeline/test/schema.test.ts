// 스키마 검증기 · 응답 정리(전체/항목 위반) · kinds 강제 · 수치 검사.
import { describe, expect, it } from 'vitest';
import {
  checkNumbers, checkStructure, extractNumbers, formatViolations, STRUCTURE_SCHEMA,
  validateSchema, type StructureV1,
} from '../src';
import { sample, sampleSource } from './fixtures';

const clone = <T>(v: T): T => structuredClone(v);

describe('validateSchema (structure.v1 원본)', () => {
  it('모범 예시는 유효', () => {
    expect(validateSchema(sample, STRUCTURE_SCHEMA)).toEqual([]);
  });

  it('위반마다 JSON 포인터 경로와 규칙', () => {
    const bad = clone(sample) as unknown as Record<string, unknown>;
    (bad.nodes as Record<string, unknown>[])[0]!.key = 'Bad Key';
    (bad.nodes as Record<string, unknown>[])[1]!.title = '';
    (bad.nodes as Record<string, unknown>[])[2]!.kind = 'idea';
    (bad.edges as Record<string, unknown>[])[0]!.label = 'x'.repeat(25);
    (bad.charts as { series: { points: { y: unknown }[] }[] }[])[0]!.series[0]!.points[1]!.y = '17';
    bad.extra = 1;
    const issues = validateSchema(bad, STRUCTURE_SCHEMA).map((i) => `${i.path} ${i.rule}`);
    expect(issues).toEqual(expect.arrayContaining([
      '/nodes/0/key pattern', '/nodes/1/title minLength', '/nodes/2/kind enum', '/edges/0/label maxLength',
      '/charts/0/series/0/points/1/y type', '/extra additionalProperties',
    ]));
  });

  it('x는 문자열 · 숫자 둘 다, 그 외는 위반', () => {
    const s = clone(sample);
    s.charts[0]!.series[0]!.points[0]!.x = 2023;
    expect(validateSchema(s, STRUCTURE_SCHEMA)).toEqual([]);
    (s.charts[0]!.series[0]!.points[0] as { x: unknown }).x = true;
    expect(validateSchema(s, STRUCTURE_SCHEMA)[0]).toMatchObject({ path: '/charts/0/series/0/points/0/x', rule: 'type' });
  });

  it('글자 수는 UTF-16 길이 — 한글 1자 = 1 (14절)', () => {
    const s = clone(sample);
    s.nodes[0]!.title = '가'.repeat(80);
    expect(validateSchema(s, STRUCTURE_SCHEMA)).toEqual([]);
    s.nodes[0]!.title = '가'.repeat(81);
    expect(validateSchema(s, STRUCTURE_SCHEMA)).toHaveLength(1);
  });
});

describe('checkStructure — 전체 위반 vs 항목 위반 (AI-PROMPTS 8.5 · 9.1)', () => {
  it('최상위 형식 · 필수 배열 누락 · 정의 밖 속성은 전체 위반', () => {
    expect(checkStructure([]).ok).toBe(false);
    expect(checkStructure('x').ok).toBe(false);
    const r = checkStructure({ nodes: [], edges: [], charts: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations[0]).toMatchObject({ path: '/tables', rule: 'required' });
    const r2 = checkStructure({ ...sample, answer: 'x' });
    expect(r2.ok).toBe(false);
    const r3 = checkStructure({ ...sample, nodes: {} });
    expect(r3.ok).toBe(false);
  });

  it('노드 key 중복은 전체 위반 (엣지 대상이 모호)', () => {
    const r = checkStructure({ ...sample, nodes: [...sample.nodes, { key: 'n2', title: 'x', kind: 'concept' }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(formatViolations(r.violations)).toBe('- /nodes/3/key: unique (key "n2" 중복 (/nodes/1과 같음))');
  });

  it('항목 단위 위반은 그 항목만 버린다 — key 형식이 틀린 노드는 연결 엣지도', () => {
    const s = clone(sample) as unknown as StructureV1;
    s.nodes[0]!.key = 'N 1';
    s.edges[0]!.from = 'N 1';
    const r = checkStructure(s);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.nodes.map((n) => n.key)).toEqual(['n2', 'n3']);
    expect(r.value.edges).toEqual([{ from: 'n2', to: 'n3', relation: 'leads-to' }]);
    expect(r.dropped.map((d) => d.path)).toEqual(['/nodes/0', '/edges/0']);
    expect(r.dropped[1]!.reason).toBe('버린 노드에 연결된 엣지');
  });

  it('라벨 위반은 라벨만, 없는 attachTo는 attachTo만, 같은 엣지는 하나로, 표 행은 열 수에 맞춤', () => {
    const s = clone(sample) as unknown as StructureV1;
    s.edges[0]!.label = '';
    s.edges.push({ ...s.edges[1]! });
    s.charts[0]!.attachTo = 'nope';
    s.tables.push({ key: 't1', columns: ['항목', 'A', 'B'], rows: [['x'], ['y', '1', '2', '3']] });
    const r = checkStructure(s);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.edges).toEqual([{ from: 'n1', to: 'n2', relation: 'causes' }, { from: 'n2', to: 'n3', relation: 'leads-to' }]);
    expect(r.value.charts[0]).not.toHaveProperty('attachTo');
    expect(r.value.tables[0]!.rows).toEqual([['x', '—', '—'], ['y', '1', '2']]);
  });

  it('개수 상한 초과는 앞에서부터 상한까지', () => {
    const nodes = Array.from({ length: 70 }, (_, i) => ({ key: `n${i}`, title: `개념 ${i}`, kind: 'concept' as const }));
    const r = checkStructure({ nodes, edges: [], charts: [], tables: [] });
    expect(r.ok && r.value.nodes.length).toBe(60);
  });

  it('비어 있지 않은 배열의 항목이 전부 무효면 전체 위반', () => {
    const r = checkStructure({ nodes: [{ key: 'X', title: 'a', kind: 'concept' }], edges: [], charts: [], tables: [] });
    expect(r.ok).toBe(false);
  });

  it('빈 결과는 유효 (구조 없음 ≠ 호출 없음)', () => {
    const r = checkStructure({ nodes: [], edges: [], charts: [], tables: [] });
    expect(r.ok).toBe(true);
  });

  it('enabled_kinds 밖의 종류는 배열째 버리고, relation이 꺼지면 attachTo도 뺀다', () => {
    const r = checkStructure(sample, ['chart']);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.nodes).toEqual([]);
    expect(r.value.edges).toEqual([]);
    expect(r.value.charts).toHaveLength(1);
    expect(r.value.charts[0]).not.toHaveProperty('attachTo');
  });

  it('교정 문구 위반 목록은 최대 30줄 + 나머지 개수', () => {
    const vs = Array.from({ length: 33 }, (_, i) => ({ path: `/nodes/${i}`, rule: 'x', detail: 'y' }));
    const t = formatViolations(vs).split('\n');
    expect(t).toHaveLength(31);
    expect(t[30]).toBe('- ... and 3 more');
  });
});

describe('수치 검사 (AI-PROMPTS 16.3, eval/README 3.1)', () => {
  it('extractNumbers: 쉼표 · 음수 · 절댓값 · 유니코드 마이너스', () => {
    const n = extractNumbers('매출 12.4억, 3,000회, -3.2억, −7%, 2021년');
    for (const v of [12.4, 3000, -3.2, 3.2, -7, 7, 2021]) expect(n.has(v)).toBe(true);
    expect(n.has(3)).toBe(false);
  });

  it('원문에 없는 점은 버리고, 점 1개만 남은 차트는 버린다', () => {
    const s = clone(sample);
    s.charts[0]!.series[0]!.points[1]!.y = 999; // 원문에 없음
    let r = checkNumbers(s, sampleSource);
    expect(r.value.charts[0]!.series[0]!.points.map((p) => p.y)).toEqual([24, 9]);
    expect(r.droppedPoints).toBe(1);
    s.charts[0]!.series[0]!.points[2]!.y = 1000;
    r = checkNumbers(s, sampleSource);
    expect(r.value.charts).toHaveLength(0);
    expect(r.droppedPoints).toBe(3);
  });

  it('표 셀의 숫자가 원문에 없으면 셀을 "—"로', () => {
    const s: StructureV1 = { nodes: [], edges: [], charts: [], tables: [{ key: 't1', columns: ['요금제', '월 가격'], rows: [['프로', '월 9,900원'], ['팀', '연 118,800원']] }] };
    const r = checkNumbers(s, '프로 요금제는 월 9,900원입니다.');
    expect(r.value.tables[0]!.rows).toEqual([['프로', '월 9,900원'], ['팀', '—']]);
  });
});
