// structure.v2 (STRUCTURE-GUIDE 5절): 엔진 v6 목록과 같은 값 · version으로 검증기 고르기 · 묶음 · 구조 판별 다듬기 · v1으로 내리기.
import { describe, expect, it } from 'vitest';
import { GROUP_KINDS, NODE_KINDS, RELATIONS } from '@dn/engine-core';
import { checkStructure, STRUCTURE_SCHEMA, STRUCTURE_SCHEMA_V2, toV1, validateSchema, type Structure } from '../src';

type Obj = Record<string, unknown>;
const props = (s: unknown, ...path: string[]): Obj => path.reduce((o, k) => (o[k] as Obj), s as Obj);

/** 회의록 한 장면: 안건 묶음 · 견해 대립 · 결정 · 할 일 (가이드 4.9 예 2를 줄인 것) */
const meeting = (): Obj => ({
  version: 'structure.v2',
  title: '주간 회의',
  nodes: [
    { key: 'c1', title: '제목 검색만 먼저', kind: 'claim', speaker: '김 대리' },
    { key: 'c2', title: '본문 검색도 넣기', kind: 'claim', speaker: '이 사원' },
    { key: 'k1', title: '제목 검색을 먼저 출시', kind: 'decision', speaker: '박 팀장' },
    { key: 't1', title: '제목 검색 명세 작성', kind: 'action', owner: '김 대리', due: '수요일' },
    { key: 'e1', title: '내부 테스트', kind: 'event', time: '10/20' },
    { key: 'e2', title: '베타 배포', kind: 'event', time: '10/27' },
  ],
  edges: [
    { from: 'c1', to: 'c2', relation: 'contrasts' },
    { from: 'c1', to: 'k1', relation: 'leads-to' },
    { from: 'k1', to: 't1', relation: 'next' },
    { from: 'a1', to: 'a2', relation: 'next' },
    { from: 'e1', to: 'e2', relation: 'next', order: 1 },
  ],
  charts: [], tables: [],
  containers: [
    { key: 'a1', title: '안건 1: 검색 기능 범위', kind: 'agenda', members: ['c1', 'c2', 'k1', 't1'] },
    { key: 'a2', title: '안건 2: 베타 일정', kind: 'agenda', members: ['e1', 'e2'] },
  ],
  patterns: [
    { key: 'p1', id: 'S-57', pattern: 'form', primary: true, containers: ['a1', 'a2'] },
    { key: 'p2', id: 'S-65', pattern: 'columns', in: 'p1', mix: 'nested', frame: 'a1', nodes: ['c1', 'c2', 'k1'] },
    { key: 'p3', id: 'S-61', pattern: 'steps', in: 'p1', mix: 'nested', frame: 'a2', nodes: ['e1', 'e2'] },
  ],
});

describe('structure.v2 스키마', () => {
  it('노드 종류 · 관계 · 묶음 종류가 엔진 v6 목록과 같다 (묶음은 + segment)', () => {
    expect(props(STRUCTURE_SCHEMA_V2, 'properties', 'nodes', 'items', 'properties', 'kind').enum).toEqual([...NODE_KINDS]);
    expect(props(STRUCTURE_SCHEMA_V2, 'properties', 'edges', 'items', 'properties', 'relation').enum).toEqual([...RELATIONS]);
    expect(props(STRUCTURE_SCHEMA_V2, 'properties', 'containers', 'items', 'properties', 'kind').enum).toEqual([...GROUP_KINDS, 'segment']);
  });
  it('v1 스키마의 노드 · 엣지 속성은 v2에 모두 있다 (상위 집합)', () => {
    for (const k of ['nodes', 'edges', 'charts', 'tables']) {
      const v1 = Object.keys(props(STRUCTURE_SCHEMA, 'properties', k, 'items', 'properties'));
      const v2 = Object.keys(props(STRUCTURE_SCHEMA_V2, 'properties', k, 'items', 'properties'));
      expect(v2).toEqual(expect.arrayContaining(v1));
    }
  });
  it('회의록 예는 v2로 유효, v1으로는 무효', () => {
    expect(validateSchema(meeting(), STRUCTURE_SCHEMA_V2)).toEqual([]);
    expect(validateSchema(meeting(), STRUCTURE_SCHEMA).length).toBeGreaterThan(0);
  });
});

describe('checkStructure — v2', () => {
  it('version을 보고 v2로 검사 — 묶음 · 구조 판별 · 묶음 끝 엣지 · 새 필드가 남는다', () => {
    const r = checkStructure(meeting());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dropped).toEqual([]);
    expect(r.value.version).toBe('structure.v2');
    expect(r.value.containers?.map((c) => c.key)).toEqual(['a1', 'a2']);
    expect(r.value.patterns?.map((p) => p.key)).toEqual(['p1', 'p2', 'p3']);
    expect(r.value.edges.some((e) => e.from === 'a1' && e.to === 'a2')).toBe(true);
    expect(r.value.nodes.find((n) => n.key === 't1')).toMatchObject({ kind: 'action', owner: '김 대리', due: '수요일' });
  });
  it('v1 응답(version 없음)은 예전 그대로 — v2 필드가 있으면 그 항목은 버림', () => {
    const v1 = { nodes: [{ key: 'a', title: '가', kind: 'concept' }, { key: 'b', title: '나', kind: 'decision' }], edges: [], charts: [], tables: [] };
    const r = checkStructure(v1);
    expect(r.ok && r.value.nodes.map((n) => n.key)).toEqual(['a']);
    expect(r.ok && r.value.version).toBeUndefined();
  });
  it('묶음: 없는 노드는 빼고, 겹치는 구성원은 먼저 나온 묶음에, 구성원 둘 미만이면 버림 · 그 묶음을 가리키던 엣지도', () => {
    const s = meeting();
    (s.containers as Obj[]).push(
      { key: 'x', kind: 'segment', members: ['c1', 'e1'] }, // c1 · e1은 이미 다른 묶음 → 구성원 0
      { key: 'y', kind: 'set', members: ['t1', 'nope'] }, // nope 없음 · t1 겹침
    );
    (s.edges as Obj[]).push({ from: 'x', to: 'k1', relation: 'supports' });
    const r = checkStructure(s);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.containers?.map((c) => c.key)).toEqual(['a1', 'a2']);
    expect(r.value.edges.some((e) => e.from === 'x')).toBe(false);
    expect(r.dropped.map((d) => d.path)).toEqual(expect.arrayContaining(['/containers/x', '/containers/y']));
  });
  it('고정 틀의 칸(slot) · 레인(lane)은 상자 하나여도 남는다 (배치 자리)', () => {
    const s = { version: 'structure.v2', nodes: [{ key: 'i', title: '쟁점 내용', kind: 'question' }, { key: 'c', title: '결론 내용', kind: 'conclusion' }], edges: [], charts: [], tables: [],
      containers: [{ key: 's1', kind: 'slot', title: '쟁점', members: ['i'] }, { key: 's2', kind: 'slot', title: '결론', members: ['c'] }, { key: 'z', kind: 'set', members: ['c'] }] };
    const r = checkStructure(s);
    expect(r.ok && r.value.containers?.map((c) => c.key)).toEqual(['s1', 's2']);
  });

  it('안쪽 묶음(parent)은 바깥 묶음과 구성원이 겹쳐도 된다', () => {
    const s = meeting();
    (s.containers as Obj[]).push({ key: 'in1', title: '논의', kind: 'column', members: ['c1', 'c2'], parent: 'a1' });
    const r = checkStructure(s);
    expect(r.ok && r.value.containers?.find((c) => c.key === 'in1')).toMatchObject({ members: ['c1', 'c2'], parent: 'a1' });
  });
  it('구조 판별: 없는 참조는 빼고 · 주 구조는 하나 · in 깊이 2 초과는 끊음', () => {
    const s = meeting();
    const ps = s.patterns as Obj[];
    ps[1]!.nodes = ['c1', 'ghost'];
    ps.push({ key: 'p4', id: 'S-15', pattern: 'argument', primary: true, in: 'p2' }, { key: 'p5', id: 'S-03', pattern: 'steps', in: 'p4' });
    const r = checkStructure(s);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const by = (k: string) => r.value.patterns!.find((p) => p.key === k)!;
    expect(by('p2').nodes).toEqual(['c1']);
    expect(by('p4').primary).toBeUndefined();
    expect(by('p4').in).toBe('p2');
    expect(by('p5').in).toBeUndefined(); // p5 → p4 → p2 → p1: 깊이 3
  });
  it('relation이 꺼져 있으면 묶음 · 구조 판별도 뺀다', () => {
    const r = checkStructure(meeting(), ['chart', 'table']);
    expect(r.ok && [r.value.nodes.length, r.value.containers, r.value.patterns]).toEqual([0, undefined, undefined]);
  });
});

describe('toV1 — v2 → v1 내리기 (5.9)', () => {
  it('결과는 v1 스키마로 유효 · 종류는 v1로 · 묶음은 group으로 · 묶음 끝 엣지는 첫 구성원으로', () => {
    const r = checkStructure(meeting());
    if (!r.ok) throw new Error('check');
    const { value } = toV1(r.value);
    expect(validateSchema(value, STRUCTURE_SCHEMA)).toEqual([]);
    const n = (k: string) => value.nodes.find((x) => x.key === k)!;
    expect(n('k1')).toMatchObject({ kind: 'conclusion', group: '안건 1: 검색 기능 범위' });
    expect(n('t1').kind).toBe('step');
    expect(n('t1').body).toContain('김 대리 · 수요일까지');
    expect(n('e1').title).toBe('10/20 내부 테스트');
    expect(n('c1').body).toContain('김 대리:');
    expect(value.edges).toContainEqual({ from: 'c1', to: 'e1', relation: 'next' });
  });
  it('관계 내리기: refutes → contrasts + 반박, answers는 방향을 바꿈, solves · ⇏ 엣지는 버림', () => {
    const s: Structure = {
      version: 'structure.v2', nodes: [{ key: 'a', title: '가', kind: 'claim' }, { key: 'b', title: '나', kind: 'rebuttal' }, { key: 'q', title: '왜?', kind: 'question' }],
      edges: [{ from: 'b', to: 'a', relation: 'refutes' }, { from: 'a', to: 'q', relation: 'answers' }, { from: 'a', to: 'b', relation: 'solves' }, { from: 'q', to: 'b', relation: 'implies', negated: true }],
      charts: [], tables: [],
    };
    const { value, dropped } = toV1(s);
    expect(value.edges).toEqual([{ from: 'b', to: 'a', relation: 'contrasts', label: '반박' }, { from: 'q', to: 'a', relation: 'leads-to', label: '답' }]);
    expect(value.nodes.find((x) => x.key === 'b')).toMatchObject({ kind: 'claim', title: '반박: 나' });
    expect(dropped).toHaveLength(2);
    expect(validateSchema(value, STRUCTURE_SCHEMA)).toEqual([]);
  });
});
