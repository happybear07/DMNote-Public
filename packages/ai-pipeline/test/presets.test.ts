// 도식 원형별 배치 (STRUCTURE-GUIDE 2.1, Figma P-01~P-23) · 구조 판별 덩어리 잇기 (arrange.ts).
import { describe, expect, it } from 'vitest';
import type { Vec2 } from '@dn/engine-core';
import { arrange, type ArrangeItem } from '../src/arrange';
import { parseArchetype, runPreset, type Archetype, type PresetEdge, type PresetGroup, type PresetInput, type PresetNode } from '../src/presets';
import type { StructurePattern } from '../src';

const box = (id: string, w = 200, h = 60, more: Partial<PresetNode> = {}): PresetNode => ({ id, w, h, ...more });
const e = (from: string, to: string, relation?: string): PresetEdge => ({ from, to, ...(relation ? { relation } : {}) });
const run = (a: Archetype, nodes: PresetNode[], edges: PresetEdge[] = [], groups: PresetGroup[] = [], pattern?: Partial<StructurePattern>) => {
  const input: PresetInput = { nodes, edges, groups, ...(pattern ? { pattern: { id: 'S-01', pattern: a, ...pattern } } : {}) };
  const r = runPreset(a, input);
  noOverlap(r.pos, nodes, r.width);
  expect([...runPreset(a, input).pos]).toEqual([...r.pos]); // 결정적
  return r;
};
function noOverlap(pos: Map<string, Vec2>, nodes: readonly PresetNode[], width?: Map<string, number>): void {
  expect(pos.size).toBe(nodes.length);
  const r = nodes.map((n) => ({ id: n.id, ...pos.get(n.id)!, w: width?.get(n.id) ?? n.w, h: n.h }));
  for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) {
    const a = r[i]!, b = r[j]!;
    const hit = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    expect(hit, `${a.id} · ${b.id} 겹침`).toBe(false);
  }
}
const cx = (p: Map<string, Vec2>, id: string, w = 200) => p.get(id)!.x + w / 2;

describe('원형 키 읽기', () => {
  it('괄호 · 덧붙임 · 방향 힌트', () => {
    expect(parseArchetype('chain(세로)')).toEqual({ key: 'chain', dir: 'TB' });
    expect(parseArchetype('tree(결론 왼쪽)')).toEqual({ key: 'tree', dir: 'RL' });
    expect(parseArchetype('lanes(가로)')).toEqual({ key: 'lanes', dir: 'LR' });
    expect(parseArchetype('table + 결론')).toEqual({ key: 'table' });
    expect(parseArchetype('fishbone / tree')).toEqual({ key: 'fishbone' });
    expect(parseArchetype('뭔가')).toEqual({});
  });
});

describe('원형별 모양', () => {
  it('사슬(P-01): 왼→오', () => {
    const { pos } = run('chain', [box('a'), box('b'), box('c')], [e('a', 'b', 'causes'), e('b', 'c', 'causes')]);
    expect(pos.get('a')!.x).toBeLessThan(pos.get('b')!.x);
    expect(pos.get('b')!.x).toBeLessThan(pos.get('c')!.x);
  });

  it('단계 · 증명(P-02 · P-16): 원문 판별이 LR이어도 위→아래 한 줄', () => {
    for (const a of ['steps', 'proof'] as const) {
      const { pos } = run(a, [box('s1'), box('s2'), box('s3')], [e('s1', 's2', 'next'), e('s2', 's3', 'next')], [], { direction: 'LR' });
      expect(pos.get('s1')!.y).toBeLessThan(pos.get('s2')!.y);
      expect(pos.get('s2')!.y).toBeLessThan(pos.get('s3')!.y);
      expect(pos.get('s1')!.x).toBe(pos.get('s3')!.x);
    }
  });

  it('사슬 + 묶음(경로 셋): 테두리가 겹치면 묶음마다 가로 띠 — 층(열)은 그대로', () => {
    const ids = ['root', 'a1', 'a2', 'b1', 'b2', 'c1', 'c2'];
    const edges = [e('root', 'a1', 'causes'), e('a1', 'a2', 'causes'), e('root', 'b1', 'causes'), e('b1', 'b2', 'causes'), e('root', 'c1', 'causes'), e('c1', 'c2', 'causes'), e('b2', 'a2', 'causes')];
    const groups = [{ key: 'A', members: ['a1', 'a2'] }, { key: 'B', members: ['b1', 'b2'] }, { key: 'C', members: ['c1', 'c2'] }];
    const { pos } = run('chain', ids.map((i) => box(i)), edges, groups);
    const frame = (ms: string[]) => ({ y0: Math.min(...ms.map((m) => pos.get(m)!.y)), y1: Math.max(...ms.map((m) => pos.get(m)!.y + 60)) });
    const [fa, fb, fc] = [frame(['a1', 'a2']), frame(['b1', 'b2']), frame(['c1', 'c2'])];
    expect(fa.y1).toBeLessThan(fb.y0); // 띠끼리 안 겹침
    expect(fb.y1).toBeLessThan(fc.y0);
    expect(pos.get('a1')!.x).toBe(pos.get('b1')!.x); // 같은 층은 같은 열
    expect(pos.get('root')!.x).toBeLessThan(pos.get('a1')!.x);
  });

  it('단계가 7층을 넘으면 다음 열로 이어 쓴다 (10단계 → 5 · 5, 둘째 열은 아래→위 ㄹ자)', () => {
    const ids = Array.from({ length: 10 }, (_, i) => `s${i}`);
    const { pos } = run('steps', ids.map((i) => box(i)), ids.slice(1).map((id, i) => e(ids[i]!, id, 'next')));
    expect(new Set(ids.map((i) => pos.get(i)!.y)).size).toBe(5);
    expect(pos.get('s5')!.x).toBeGreaterThan(pos.get('s4')!.x);
    expect(pos.get('s4')!.y).toBeGreaterThan(pos.get('s3')!.y);
    // 첫 열 끝(s4) → 둘째 열 처음(s5)은 같은 높이의 짧은 가로 화살표, 둘째 열 끝(s9)은 맨 위
    expect(pos.get('s5')!.y).toBe(pos.get('s4')!.y);
    expect(pos.get('s9')!.y).toBe(pos.get('s0')!.y);
  });

  it('논증(P-15): 주장 위 · 근거 아래, 반박은 주장 옆', () => {
    const { pos } = run('argument', [box('claim'), box('ev1'), box('ev2'), box('reb')], [e('ev1', 'claim', 'supports'), e('ev2', 'claim', 'supports'), e('reb', 'claim', 'refutes')]);
    expect(pos.get('claim')!.y).toBeLessThan(pos.get('ev1')!.y);
    expect(pos.get('ev1')!.y).toBe(pos.get('ev2')!.y);
    expect(pos.get('reb')!.y).toBe(pos.get('claim')!.y);
  });

  it('트리(P-06): 상위가 위, 하위는 아래 한 층 (part-of · kind-of는 하위 → 상위)', () => {
    const { pos } = run('tree', [box('ai'), box('ml'), box('sup'), box('uns')], [e('ml', 'ai', 'subset-of'), e('sup', 'ml', 'kind-of'), e('uns', 'ml', 'kind-of')]);
    expect(pos.get('ai')!.y).toBeLessThan(pos.get('ml')!.y);
    expect(pos.get('ml')!.y).toBeLessThan(pos.get('sup')!.y);
    expect(pos.get('sup')!.y).toBe(pos.get('uns')!.y);
  });

  it('고리(P-04): 12시에서 시계 방향, 마지막 → 처음 화살표가 있어도 원', () => {
    const ids = ['s1', 's2', 's3', 's4'];
    const { pos } = run('cycle', ids.map((i) => box(i)), [e('s1', 's2', 'next'), e('s2', 's3', 'next'), e('s3', 's4', 'next'), e('s4', 's1', 'next')]);
    expect(pos.get('s1')!.y).toBeLessThan(pos.get('s3')!.y); // 위 · 아래
    expect(pos.get('s2')!.x).toBeGreaterThan(pos.get('s4')!.x); // 오른쪽 · 왼쪽
    expect(Math.abs(cx(pos, 's1') - cx(pos, 's3'))).toBeLessThan(2); // 같은 세로줄
  });

  it('방사(P-14): 화살표가 가장 많은 상자가 가운데', () => {
    const ids = ['core', 'x1', 'x2', 'x3', 'x4'];
    const { pos } = run('radial', ids.map((i) => box(i)), ids.slice(1).map((i) => e(i, 'core', 'example-of')));
    const others = ids.slice(1).map((i) => pos.get(i)!);
    const c = pos.get('core')!;
    expect(c.x).toBeGreaterThan(Math.min(...others.map((p) => p.x)));
    expect(c.x).toBeLessThan(Math.max(...others.map((p) => p.x)));
    expect(c.y).toBeGreaterThan(Math.min(...others.map((p) => p.y)));
    expect(c.y).toBeLessThan(Math.max(...others.map((p) => p.y)));
  });

  it('시간축(P-03): 원문 번호(order) 차례로 왼→오, 이웃 사건은 위아래 엇갈림', () => {
    const { pos } = run('timeline', [box('e3', 200, 60, { order: 3 }), box('e1', 200, 60, { order: 1 }), box('e2', 200, 60, { order: 2 }), box('e4', 200, 60, { order: 4 })]);
    expect(pos.get('e1')!.x).toBeLessThan(pos.get('e2')!.x);
    expect(pos.get('e2')!.x).toBeLessThan(pos.get('e3')!.x);
    expect(pos.get('e1')!.y).not.toBe(pos.get('e2')!.y);
    expect(pos.get('e1')!.y).toBe(pos.get('e3')!.y);
  });

  it('나란히 열(P-09): 묶음이 열, 이어진 기준은 같은 높이, 열에 안 든 결론은 아래 가운데', () => {
    const nodes = [box('a1'), box('a2'), box('b2'), box('b1'), box('end')];
    const { pos } = run('columns', nodes, [e('a1', 'b1', 'contrasts'), e('a2', 'b2', 'contrasts')], [{ key: 'A', members: ['a1', 'a2'] }, { key: 'B', members: ['b2', 'b1'] }]);
    expect(pos.get('a1')!.x).toBe(pos.get('a2')!.x);
    expect(pos.get('b1')!.x).toBeGreaterThan(pos.get('a1')!.x);
    expect(pos.get('b1')!.y).toBe(pos.get('a1')!.y); // 원문 차례(b2 먼저)보다 짝이 앞선다
    expect(pos.get('b2')!.y).toBe(pos.get('a2')!.y);
    expect(pos.get('end')!.y).toBeGreaterThan(pos.get('a2')!.y);
    expect(pos.get('end')!.x).toBeGreaterThan(pos.get('a1')!.x);
    expect(pos.get('end')!.x).toBeLessThan(pos.get('b1')!.x);
  });

  it('정-반-합(S-19, 묶음 없음): 정 · 반은 위에 나란히, 합은 아래', () => {
    const { pos } = run('columns', [box('thesis'), box('anti'), box('syn')], [e('thesis', 'anti', 'contrasts'), e('thesis', 'syn', 'leads-to'), e('anti', 'syn', 'leads-to')]);
    expect(pos.get('thesis')!.y).toBe(pos.get('anti')!.y);
    expect(pos.get('anti')!.x).toBeGreaterThan(pos.get('thesis')!.x);
    expect(pos.get('syn')!.y).toBeGreaterThan(pos.get('thesis')!.y);
  });

  it('대응(P-19, 묶음 없음): 왼쪽 원소 · 오른쪽 짝이 같은 높이', () => {
    const { pos } = run('mapping', [box('l1'), box('l2'), box('r2'), box('r1')], [e('l1', 'r1', 'maps-to'), e('l2', 'r2', 'maps-to')]);
    expect(pos.get('r1')!.x).toBeGreaterThan(pos.get('l1')!.x);
    expect(pos.get('r1')!.y).toBe(pos.get('l1')!.y);
    expect(pos.get('r2')!.y).toBe(pos.get('l2')!.y);
  });

  it('사분면(P-11): 축 값으로 2×2', () => {
    const n = (id: string, x: string, y: string) => box(id, 200, 60, { axis: { x, y } });
    const { pos } = run('matrix', [n('hh', '높음', '높음'), n('hl', '낮음', '높음'), n('lh', '높음', '낮음'), n('ll', '낮음', '낮음')]);
    expect(pos.get('hh')!.y).toBe(pos.get('hl')!.y);
    expect(pos.get('lh')!.y).toBeGreaterThan(pos.get('hh')!.y);
    expect(pos.get('hh')!.x).toBe(pos.get('lh')!.x);
    expect(pos.get('hl')!.x).not.toBe(pos.get('hh')!.x);
  });

  it('사분면: 축 화살표 방향대로 — 낮은 값(부정)은 왼쪽 · 아래, 원문 차례가 반대여도', () => {
    const n = (id: string, x: string, y: string) => box(id, 200, 60, { axis: { x, y } });
    const { pos } = run('matrix', [n('uu', '긴급', '중요'), n('nu', '긴급하지 않음', '중요'), n('un', '긴급', '중요하지 않음'), n('nn', '긴급하지 않음', '중요하지 않음')]);
    expect(pos.get('nu')!.x).toBeLessThan(pos.get('uu')!.x); // 긴급하지 않음 = 왼쪽
    expect(pos.get('uu')!.y).toBeLessThan(pos.get('un')!.y); // 중요 = 위
  });

  it('고정 틀(P-21) 칸 격자: 칸 이름(slots) 차례로 — 묶음 차례가 달라도', () => {
    const groups = [{ key: 'g2', title: '규칙 (Rule)', members: ['r'] }, { key: 'g1', title: '쟁점 (Issue)', members: ['i'] }, { key: 'g3', title: '적용', members: ['a'] }, { key: 'g4', title: '결론', members: ['c'] }];
    const { pos } = run('form', [box('i'), box('r'), box('a'), box('c')], [], groups, { slots: ['쟁점', '규칙', '적용', '결론'] });
    expect(pos.get('i')!).toEqual({ x: 0, y: 0 });
    expect(pos.get('r')!.y).toBe(0);
    expect(pos.get('r')!.x).toBeGreaterThan(0);
    expect(pos.get('a')!.y).toBeGreaterThan(0);
    expect(pos.get('a')!.x).toBe(0);
  });

  it('고정 틀(S-57 회의록) 되풀이: 안건마다 한 줄 — 줄 안은 논의 → 결정 → 할 일 왼→오', () => {
    const groups = [{ key: 'a1', kind: 'agenda', members: ['d1', 'k1', 't1'] }, { key: 'a2', kind: 'agenda', members: ['k2'] }];
    const { pos } = run('form', [box('d1'), box('k1'), box('t1'), box('k2')], [e('d1', 'k1', 'leads-to'), e('k1', 't1', 'leads-to')], groups);
    expect(pos.get('d1')!.x).toBeLessThan(pos.get('k1')!.x);
    expect(pos.get('k1')!.x).toBeLessThan(pos.get('t1')!.x);
    expect(pos.get('k2')!.y).toBeGreaterThan(pos.get('t1')!.y + 60);
  });

  it('레인(P-17) 가로: 묶음마다 띠, 상자는 화살표 차례로 오른쪽으로', () => {
    const groups = [{ key: 'L1', members: ['draft', 'fix'] }, { key: 'L2', members: ['review'] }, { key: 'L3', members: ['ok'] }];
    const { pos } = run('lanes', [box('draft'), box('review'), box('fix'), box('ok')], [e('draft', 'review', 'next'), e('review', 'fix', 'next'), e('fix', 'ok', 'next')], groups);
    expect(pos.get('draft')!.y).toBe(pos.get('fix')!.y);
    expect(pos.get('review')!.y).toBeGreaterThan(pos.get('draft')!.y);
    expect(pos.get('ok')!.y).toBeGreaterThan(pos.get('review')!.y);
    expect(pos.get('draft')!.x).toBeLessThan(pos.get('review')!.x);
    expect(pos.get('review')!.x).toBeLessThan(pos.get('fix')!.x);
    expect(pos.get('fix')!.x).toBeLessThan(pos.get('ok')!.x);
  });

  it('피시본(P-07): 결과는 오른쪽, 원인은 등뼈 위아래 번갈아 왼→오, 세부 원인은 바깥쪽', () => {
    const ids = ['c1', 'c2', 'c3', 'c4', 'effect', 'sub'];
    const edges = [e('c1', 'effect', 'causes'), e('c2', 'effect', 'causes'), e('c3', 'effect', 'causes'), e('c4', 'effect', 'causes'), e('sub', 'c1', 'causes')];
    const { pos } = run('fishbone', ids.map((i) => box(i)), edges);
    const eff = pos.get('effect')!;
    for (const c of ['c1', 'c2', 'c3', 'c4']) expect(pos.get(c)!.x).toBeLessThan(eff.x);
    expect(pos.get('c1')!.y).toBeLessThan(eff.y); // 위 줄
    expect(pos.get('c2')!.y).toBeGreaterThan(eff.y); // 아래 줄
    expect(pos.get('c3')!.x).toBeGreaterThan(pos.get('c1')!.x);
    expect(pos.get('sub')!.y).toBeLessThan(pos.get('c1')!.y); // 위 줄 원인의 세부 원인은 더 위
  });

  it('벤(P-23): 소속 화살표로 영역 열 — [A만] [둘 다] [B만], 집합 상자는 제 열 위', () => {
    const ids = ['py', 'js', 'indent', 'browser', 'dyn', 'gc'];
    const edges = [e('indent', 'py', 'part-of'), e('browser', 'js', 'part-of'), e('dyn', 'py', 'part-of'), e('dyn', 'js', 'part-of'), e('gc', 'py', 'part-of'), e('gc', 'js', 'part-of')];
    const { pos } = run('venn', ids.map((i) => box(i)), edges);
    expect(pos.get('py')!.x).toBe(pos.get('indent')!.x);
    expect(pos.get('js')!.x).toBe(pos.get('browser')!.x);
    expect(pos.get('dyn')!.x).toBe(pos.get('gc')!.x);
    expect(pos.get('py')!.x).toBeLessThan(pos.get('dyn')!.x);
    expect(pos.get('dyn')!.x).toBeLessThan(pos.get('js')!.x);
    expect(pos.get('py')!.y).toBeLessThan(pos.get('indent')!.y);
  });

  it('층 쌓기(P-22): 가운데 정렬, 아래로 갈수록 넓게 — 퍼널(S-64)은 좁게', () => {
    const ns = [box('top'), box('mid'), box('base')];
    const pyr = run('levels', ns);
    expect(pyr.width!.get('base')!).toBeGreaterThan(pyr.width!.get('top')!);
    expect(pyr.pos.get('top')!.x + pyr.width!.get('top')! / 2).toBeCloseTo(pyr.pos.get('base')!.x + pyr.width!.get('base')! / 2);
    const funnel = run('levels', ns, [], [], { id: 'S-64' });
    expect(funnel.width!.get('base')!).toBeLessThan(funnel.width!.get('top')!);
    const flipped = run('levels', ns, [], [], { orderFrom: 'bottom' });
    expect(flipped.pos.get('top')!.y).toBeGreaterThan(flipped.pos.get('base')!.y);
  });

  it('모든 원형: 크기가 제각각이어도 겹치지 않는다', () => {
    const all: Archetype[] = ['chain', 'steps', 'timeline', 'cycle', 'loop', 'tree', 'fishbone', 'decision', 'columns', 'table', 'matrix', 'scale',
      'nest', 'radial', 'argument', 'proof', 'lanes', 'network', 'mapping', 'chart', 'form', 'levels', 'venn'];
    const nodes = Array.from({ length: 9 }, (_, i) => box(`n${i}`, 120 + ((i * 53) % 160), 40 + ((i * 37) % 120), { order: 9 - i, axis: { x: i % 2 ? 'a' : 'b', y: i % 3 ? 'c' : 'd' } }));
    const edges = [e('n0', 'n1', 'causes'), e('n1', 'n2', 'next'), e('n2', 'n0', 'next'), e('n3', 'n4', 'contrasts'), e('n5', 'n4', 'part-of'), e('n6', 'n7', 'maps-to'), e('n8', 'n3', 'supports')];
    const groups = [{ key: 'g1', members: ['n0', 'n1', 'n2'] }, { key: 'g2', members: ['n3', 'n4'] }, { key: 'g3', members: ['n5', 'n6', 'n7'] }];
    for (const a of all) run(a, nodes, edges, groups);
  });
});

describe('덩어리 잇기 (arrange)', () => {
  const item = (id: string, more: Partial<ArrangeItem> = {}): ArrangeItem => ({ id, w: 200, h: 60, kind: 'node', ...more });
  const overlapFree = (pos: Map<string, Vec2>, items: ArrangeItem[]) => noOverlap(pos, items);

  it('구조 판별이 없으면 계층형 왼→오 하나 (v1과 같다)', () => {
    const items = [item('a'), item('b'), item('c', { kind: 'chart', attachTo: 'b', w: 360, h: 240 })];
    const { pos } = arrange({ items, edges: [e('a', 'b', 'causes')], containers: [], patterns: [] });
    expect(pos.get('a')!.x).toBeLessThan(pos.get('b')!.x);
    // 차트는 붙은 노드와 같은 층(열), 그 아래 — 흐름 한가운데를 차지하지 않게
    expect(Math.abs(pos.get('b')!.x + 100 - (pos.get('c')!.x + 180))).toBeLessThan(2);
    expect(pos.get('c')!.y).toBeGreaterThan(pos.get('b')!.y + 60);
    overlapFree(pos, items);
  });

  it('주 구조(고리)는 왼쪽, 따로 떨어진 부 구조(사슬)는 오른쪽, 구조에 안 든 상자 · 차트는 맨 아래', () => {
    const items = [item('c1'), item('c2'), item('c3'), item('x1'), item('x2'), item('lone'), item('ch', { kind: 'chart', attachTo: 'c1', w: 360, h: 240 })];
    const patterns: StructurePattern[] = [
      { key: 'p2', id: 'S-01', pattern: 'chain', nodes: ['x1', 'x2'] },
      { key: 'p1', id: 'S-05', pattern: 'cycle', primary: true, nodes: ['c1', 'c2', 'c3'] },
    ];
    const edges = [e('c1', 'c2', 'next'), e('c2', 'c3', 'next'), e('c3', 'c1', 'next'), e('x1', 'x2', 'causes')];
    const { pos } = arrange({ items, edges, containers: [], patterns });
    const cycleRight = Math.max(...['c1', 'c2', 'c3'].map((i) => pos.get(i)!.x + 200));
    expect(Math.min(pos.get('x1')!.x, pos.get('x2')!.x)).toBeGreaterThan(cycleRight);
    const top = Math.max(...['c1', 'c2', 'c3', 'x1', 'x2'].map((i) => pos.get(i)!.y + 60));
    expect(pos.get('lone')!.y).toBeGreaterThan(top);
    expect(pos.get('ch')!.y).toBeGreaterThan(top); // 고리(모양 원형)에 붙은 차트는 아래 덩어리로
    overlapFree(pos, items);
  });

  it('계층형끼리 상자를 나눠 쓰면 한 덩어리 — 구조에 안 든 이웃 노드도 그 덩어리로', () => {
    const items = [item('n1'), item('n2'), item('n3'), item('n4'), item('extra')];
    const patterns: StructurePattern[] = [
      { key: 'p1', id: 'S-15', pattern: 'argument', primary: true, nodes: ['n3', 'n4'] },
      { key: 'p2', id: 'S-01', pattern: 'chain', nodes: ['n1', 'n2', 'n3'], with: 'p1', mix: 'overlap' },
    ];
    const edges = [e('n1', 'n2', 'causes'), e('n2', 'n3', 'leads-to'), e('n3', 'n4', 'supports'), e('extra', 'n4', 'supports')];
    const { pos } = arrange({ items, edges, containers: [], patterns });
    // 논증 덩어리 하나: 주장(n4) 위, 근거(n3 · extra)와 사슬은 그 아래 — 오른쪽에 따로 떨어진 덩어리가 없다
    expect(pos.get('n4')!.y).toBeLessThan(pos.get('n3')!.y);
    expect(pos.get('n4')!.y).toBeLessThan(pos.get('extra')!.y);
    expect(pos.get('n3')!.y).toBeLessThan(pos.get('n1')!.y);
    expect(Math.max(...items.map((i) => pos.get(i.id)!.x))).toBeLessThan(800);
    overlapFree(pos, items);
  });

  it('계층형 덩어리와 상자를 나눠 쓰는 모양 원형(방사)은 그 덩어리로 — 예시가 개념 바로 아래', () => {
    const items = ['ml', 'sup', 'cls', 'ex1', 'ex2'].map((i) => item(i));
    const patterns: StructurePattern[] = [
      { key: 'p1', id: 'S-11', pattern: 'tree', primary: true, nodes: ['ml', 'sup', 'cls'] },
      { key: 'p2', id: 'S-20', pattern: 'radial', nodes: ['cls', 'ex1', 'ex2'] },
    ];
    const edges = [e('sup', 'ml', 'kind-of'), e('cls', 'sup', 'kind-of'), e('ex1', 'cls', 'example-of'), e('ex2', 'cls', 'example-of')];
    const { pos } = arrange({ items, edges, containers: [], patterns });
    expect(pos.get('ex1')!.y).toBeGreaterThan(pos.get('cls')!.y);
    expect(pos.get('ex1')!.y).toBe(pos.get('ex2')!.y);
    expect(Math.max(...items.map((i) => pos.get(i.id)!.x))).toBeLessThan(600);
  });

  it('구조 ID로 원형을 찾는다 — pattern이 엉뚱해도 구조 목록의 대괄호로', () => {
    const items = ['s1', 's2', 's3'].map((i) => item(i));
    const { pos } = arrange({ items, edges: [e('s1', 's2', 'next'), e('s2', 's3', 'next')], containers: [], patterns: [{ id: 'S-03', pattern: '???', primary: true, nodes: ['s1', 's2', 's3'] }] });
    expect(pos.get('s1')!.y).toBeLessThan(pos.get('s2')!.y); // S-03 [steps] → 위→아래
    expect(pos.get('s1')!.x).toBe(pos.get('s2')!.x);
  });
});
