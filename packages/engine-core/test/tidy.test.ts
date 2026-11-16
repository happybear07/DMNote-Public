// 배치 다듬기 (tidy.ts · tidy-layer.ts): 차례는 그대로 · 이어진 상자는 중심 맞춤 · 부모는 자식들 가운데 · 간격 고르게(라벨 자리) ·
// 폭 단계 · 묶음은 한 덩어리 · 모양(고정 묶음 · 고리 · 층 쌓기)은 그대로 · 겹치지 않음 · 다시 다듬어도 같음
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyTidy, createArrow, createTextBlock, Engine, tidyLayout, tidyPlan, type Rect, type TidyEdge, type TidyInput, type TidyNode, type TxResult } from '../src';

const box = (id: string, x: number, y: number, w = 200, h = 60, extra: Partial<TidyNode> = {}): TidyNode => ({ id, x, y, w, h, ...extra });
const cx = (r: Rect) => r.x + r.w / 2, cy = (r: Rect) => r.y + r.h / 2;
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
function noOverlap(out: Map<string, Rect>, nodes: readonly TidyNode[]): boolean {
  const rs = nodes.map((n) => { const r = out.get(n.id)!; return { ...r, y: r.y - (n.top ?? 0), h: r.h + (n.top ?? 0) }; });
  return rs.every((a, i) => rs.every((b, j) => i >= j || !overlap(a, b)));
}

describe('배치 다듬기', () => {
  it('가로 사슬: 비뚤어진 상자들이 한 줄로 · 간격이 같고 · 차례는 그대로', () => {
    const nodes = [box('a', 0, 0), box('b', 300, 37), box('c', 520, -21), box('d', 900, 12)];
    const edges: TidyEdge[] = [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'd' }];
    const out = tidyLayout({ nodes, edges });
    const ys = ['a', 'b', 'c', 'd'].map((id) => cy(out.get(id)!));
    expect(new Set(ys).size).toBe(1);
    const xs = ['a', 'b', 'c', 'd'].map((id) => out.get(id)!.x);
    expect(xs).toEqual([...xs].sort((p, q) => p - q));
    const gaps = xs.slice(1).map((x, i) => x - (xs[i]! + 200));
    expect(new Set(gaps).size).toBe(1);
    expect(gaps[0]).toBeGreaterThanOrEqual(64);
  });

  it('위→아래 트리: 부모는 자식들 가운데, 자식은 자기 부모 밑에 모인다', () => {
    const nodes = [box('p', 300, 0), box('a', 0, 160), box('b', 240, 160), box('c', 480, 160), box('a1', 0, 320), box('a2', 240, 320)];
    const edges: TidyEdge[] = [{ from: 'p', to: 'a' }, { from: 'p', to: 'b' }, { from: 'p', to: 'c' }, { from: 'a', to: 'a1' }, { from: 'a', to: 'a2' }];
    const out = tidyLayout({ nodes, edges });
    const mean = (...ids: string[]) => ids.reduce((s, id) => s + cx(out.get(id)!), 0) / ids.length;
    expect(Math.abs(cx(out.get('p')!) - mean('a', 'b', 'c'))).toBeLessThan(2);
    expect(Math.abs(cx(out.get('a')!) - mean('a1', 'a2'))).toBeLessThan(2);
    expect(out.get('a1')!.y).toBe(out.get('a2')!.y);
    expect(noOverlap(out, nodes)).toBe(true);
  });

  it('넓게 벌어진 부모 → 두 자식도 위→아래 그대로 (가로로 읽으면 화살표가 양쪽으로 갈라진다)', () => {
    const nodes = [box('p', 300, 400, 260, 44), box('l', 0, 560, 260, 44), box('r', 620, 590, 260, 44)];
    const out = tidyLayout({ nodes, edges: [{ from: 'p', to: 'l' }, { from: 'p', to: 'r' }] });
    expect(out.get('l')!.y).toBe(out.get('r')!.y);
    expect(out.get('p')!.y + 44).toBeLessThan(out.get('l')!.y);
  });

  it('세로로 다듬은 것이 가로로도 맞아 보여도, 다시 다듬으면 그대로 (덜 움직이는 쪽)', () => {
    const nodes = [box('n0', 340, 800, 120, 40), box('n1', 0, 0, 120, 40, { top: 20 }), box('n2', 0, 800, 120, 40), box('n3', 680, 0, 120, 40, { top: 20 })];
    const edges: TidyEdge[] = [{ from: 'n0', to: 'n2', label: '이어짐' }, { from: 'n2', to: 'n3' }];
    const once = tidyLayout({ nodes, edges });
    const again = tidyLayout({ nodes: nodes.map((n) => ({ ...n, ...once.get(n.id)! })), edges });
    for (const n of nodes) expect(again.get(n.id)).toEqual(once.get(n.id));
  });

  it('라벨이 있는 화살표 층 사이는 라벨 폭 + 양옆 여백만큼 벌린다', () => {
    const nodes = [box('a', 0, 0), box('b', 260, 0)];
    const out = tidyLayout({ nodes, edges: [{ from: 'a', to: 'b', label: 'x' }], labelWidth: () => 180 });
    expect(out.get('b')!.x - (out.get('a')!.x + 200)).toBe(220);
  });

  it('폭 단계: 제목 상자는 글 폭에 맞게, 비슷한 것끼리 같은 폭 · 훨씬 좁은 것은 따로 · 바뀐 폭은 높이를 다시 잰다', () => {
    const nodes = [
      box('t1', 0, 0, 260, 44, { minW: 120 }), box('t2', 300, 0, 260, 44, { minW: 150 }),
      box('body', 600, 0, 260, 88, { minW: 260 }), box('img', 900, 0, 320, 200),
    ];
    const out = tidyLayout({ nodes, edges: [{ from: 't1', to: 't2' }, { from: 't2', to: 'body' }, { from: 'body', to: 'img' }], heightAt: (id, w) => (id === 'body' ? 70 : 44 + w * 0) });
    expect(out.get('t1')!.w).toBe(150);
    expect(out.get('t2')!.w).toBe(150);
    expect(out.get('body')!.w).toBe(260);
    expect(out.get('body')!.h).toBe(88); // 폭이 그대로면 다시 재지 않는다
    expect(out.get('img')).toMatchObject({ w: 320, h: 200 });
  });

  it('묶음은 안을 다듬은 한 덩어리 — 다른 상자가 테두리 안으로 들어오지 않는다', () => {
    const nodes = [box('r', 0, 200), box('g1', 300, 0), box('g2', 560, 30), box('h1', 300, 400), box('h2', 560, 380)];
    const edges: TidyEdge[] = [{ from: 'r', to: 'g1' }, { from: 'r', to: 'h1' }, { from: 'g1', to: 'g2' }, { from: 'h1', to: 'h2' }];
    const out = tidyLayout({ nodes, edges, groups: [{ id: 'G', members: ['g1', 'g2'] }, { id: 'H', members: ['h1', 'h2'] }] });
    expect(cy(out.get('g1')!)).toBe(cy(out.get('g2')!));
    const frame = (a: string, b: string) => { const p = out.get(a)!, q = out.get(b)!; return { x: Math.min(p.x, q.x) - 8, y: Math.min(p.y, q.y) - 28, w: Math.max(p.x + p.w, q.x + q.w) - Math.min(p.x, q.x) + 16, h: Math.max(p.y + p.h, q.y + q.h) - Math.min(p.y, q.y) + 36 }; };
    const G = frame('g1', 'g2'), H = frame('h1', 'h2');
    expect(overlap(G, H)).toBe(false);
    expect(overlap(G, out.get('r')!)).toBe(false);
    // 뿌리는 두 묶음 가운데 높이
    expect(Math.abs(cy(out.get('r')!) - (cy(G) + cy(H)) / 2)).toBeLessThan(2);
  });

  it('고정 묶음 · 고리 · 층 쌓기는 안쪽 자리가 그대로 (통째로만 옮긴다)', () => {
    const fixed = [box('m1', 0, 0), box('m2', 230, 15), box('m3', 10, 140)];
    const ring = [box('c1', 600, 0, 120, 44), box('c2', 760, 100, 120, 44), box('c3', 600, 200, 120, 44), box('c4', 440, 100, 120, 44)];
    const pyr = [box('p1', 1100, 0, 200, 44, { minW: 120 }), box('p2', 1076, 70, 248, 44, { minW: 120 }), box('p3', 1052, 140, 296, 44, { minW: 120 })];
    const edges: TidyEdge[] = [
      { from: 'c1', to: 'c2' }, { from: 'c2', to: 'c3' }, { from: 'c3', to: 'c4' }, { from: 'c4', to: 'c1' },
      { from: 'p1', to: 'p2' }, { from: 'p2', to: 'p3' },
    ];
    const out = tidyLayout({ nodes: [...fixed, ...ring, ...pyr], edges, groups: [{ id: 'M', members: ['m1', 'm2', 'm3'], rigid: true }] });
    const rel = (ids: string[], src: TidyNode[]) => ids.map((id) => { const r = out.get(id)!, a = out.get(ids[0]!)!, s = src.find((n) => n.id === id)!, s0 = src.find((n) => n.id === ids[0])!; return [r.x - a.x - (s.x - s0.x), r.y - a.y - (s.y - s0.y), r.w - s.w]; });
    for (const [set, ids] of [[fixed, ['m1', 'm2', 'm3']], [ring, ['c1', 'c2', 'c3', 'c4']], [pyr, ['p1', 'p2', 'p3']]] as const) {
      for (const d of rel([...ids], [...set])) expect(d).toEqual([0, 0, 0]);
    }
  });

  it('화살표 없는 상자만: 줄 · 칸을 고르게 맞춘다', () => {
    const nodes = [box('a', 0, 0), box('b', 260, 14), box('c', 6, 130), box('d', 251, 118)];
    const out = tidyLayout({ nodes, edges: [] });
    expect(out.get('a')!.y).toBe(out.get('b')!.y);
    expect(out.get('c')!.y).toBe(out.get('d')!.y);
    expect(out.get('a')!.x).toBe(out.get('c')!.x);
    expect(out.get('b')!.x).toBe(out.get('d')!.x);
  });

  it('따로 노는 덩어리는 제자리에 두고, 겹치면 아래로 민다', () => {
    const nodes = [box('a', 0, 0), box('b', 400, 300), box('x', 100, 40), box('y', 100, 160)];
    const out = tidyLayout({ nodes, edges: [{ from: 'a', to: 'b' }, { from: 'x', to: 'y' }] });
    expect(noOverlap(out, nodes)).toBe(true);
  });

  it('이름표 높이(top)도 겹치지 않게 센다', () => {
    const nodes = [box('a', 0, 0, 200, 44, { top: 20 }), box('b', 0, 60, 200, 44, { top: 20 }), box('c', 300, 30, 200, 44, { top: 20 })];
    const out = tidyLayout({ nodes, edges: [{ from: 'a', to: 'c' }, { from: 'b', to: 'c' }] });
    expect(out.get('b')!.y - 20 - (out.get('a')!.y + 44)).toBeGreaterThanOrEqual(40);
  });

  it('조금 옮기고 다시 다듬어도 같은 결과 — 층은 화살표가 정하고, 도식은 첫 상자 자리에 (10/28)', () => {
    const nodes = [box('p', 300, 0), box('a', 0, 160), box('b', 260, 190), box('c', 560, 150)];
    const edges: TidyEdge[] = [{ from: 'p', to: 'a' }, { from: 'p', to: 'b' }, { from: 'p', to: 'c' }];
    const once = tidyLayout({ nodes, edges });
    // 자식 하나를 크게 비뚤게(이웃을 넘지 않게) 옮겨도 같은 자리
    const moved = nodes.map((n) => ({ ...n, ...once.get(n.id)!, ...(n.id === 'b' ? { x: once.get('b')!.x - 90, y: once.get('b')!.y + 120 } : {}) }));
    const again = tidyLayout({ nodes: moved, edges });
    for (const n of nodes) expect(again.get(n.id)).toEqual(once.get(n.id));
    expect(once.get('p')).toMatchObject({ x: 300, y: 0 }); // 첫 상자(뿌리)는 제자리
  });

  it('층 차례는 화살표 방향 — 위에 놓여 있던 도착 상자도 출발 상자 아래로 (10/28 사용자 확인: 응답 스키마 검증 → 캔버스 반영)', () => {
    const nodes = [box('a', 0, 0), box('b', 0, 160), box('c', 300, 160), box('d', 300, -40)];
    const out = tidyLayout({ nodes, edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'd' }] });
    const rs = ['a', 'b', 'c', 'd'].map((id) => out.get(id)!);
    const lr = new Set(rs.map(cy)).size === 1, tb = new Set(rs.map(cx)).size === 1;
    expect(lr || tb).toBe(true); // 한 줄로 곧게
    rs.slice(1).forEach((r, i) => expect(lr ? r.x > rs[i]!.x + rs[i]!.w : r.y > rs[i]!.y + rs[i]!.h).toBe(true)); // 화살표 차례대로
  });

  it('관계가 뒤 → 앞(근거 → 주장 · 예시 → 개념)이면 도착 쪽이 위, 같은 줄 관계는 곁에', () => {
    const nodes = [box('claim', 200, 300), box('e1', 0, 0), box('e2', 400, 30), box('vs', 700, 300)];
    const out = tidyLayout({ nodes, edges: [{ from: 'e1', to: 'claim', dir: 'reverse' }, { from: 'e2', to: 'claim', dir: 'reverse' }, { from: 'claim', to: 'vs', dir: 'same' }] });
    expect(out.get('claim')!.y).toBeLessThan(out.get('e1')!.y);
    expect(out.get('e1')!.y).toBe(out.get('e2')!.y);
    expect(out.get('vs')!.y).toBe(out.get('claim')!.y);
  });

  it('같은 도식의 내용 상자는 같은 폭 · 같은 높이(최소 높이) — 따로 있는 상자는 맞추지 않고 예전 최소 높이를 지운다', () => {
    const u = { uniform: true };
    const nodes = [box('a', 0, 0, 200, 60, { minW: 200, ...u }), box('b', 0, 160, 240, 60, { minW: 240, ...u }), box('c', 0, 320, 180, 60, { minW: 180, ...u }), box('memo', 600, 0, 300, 60, { minW: 300, ...u })];
    const plan = tidyPlan({ nodes, edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }], heightAt: (id, w) => (id === 'c' ? 100 : 60 + (w > 1000 ? 1 : 0)) });
    for (const id of ['a', 'b', 'c']) { expect(plan.rects.get(id)).toMatchObject({ w: 240, h: 100 }); expect(plan.minH.get(id)).toBe(100); }
    expect(plan.rects.get('memo')!.w).toBe(300); // 다른 도식의 넓은 상자가 폭을 끌어올리지 않는다
    expect(plan.minH.get('memo')).toBeNull();
  });

  it('화살표: 곧게 맞으면 곧은 선, 부채꼴은 꺾은선(아래 → 위), 위로 가는 화살표는 위 → 아래 끝', () => {
    const nodes = [box('p', 300, 0), box('a', 0, 160), box('b', 300, 160), box('c', 600, 160), box('d', 300, 320)];
    const edges: TidyEdge[] = [{ id: 'pa', from: 'p', to: 'a' }, { id: 'pb', from: 'p', to: 'b' }, { id: 'pc', from: 'p', to: 'c' }, { id: 'da', from: 'd', to: 'a', dir: 'reverse' }, { id: 'dc', from: 'd', to: 'c', dir: 'reverse' }];
    const { routes, rects } = tidyPlan({ nodes, edges });
    expect(Math.abs(cx(rects.get('p')!) - cx(rects.get('b')!))).toBeLessThanOrEqual(1);
    expect(routes.get('pb')).toEqual({ from: 'auto', to: 'auto' });
    expect(routes.get('pa')).toEqual({ from: 'bottom', to: 'top', route: 'orthogonal' });
    expect(routes.get('pc')).toEqual({ from: 'bottom', to: 'top', route: 'orthogonal' });
    expect(routes.get('da')).toEqual({ from: 'top', to: 'bottom', route: 'orthogonal' });
  });

  it('제목 상자 바로 아래 도식은 밀어내지 않는다 (사이 22px 그대로)', () => {
    const nodes = [box('title', 120, 24, 320, 44), box('a', 120, 90, 300, 68), box('b', 120, 280, 300, 68)];
    const out = tidyLayout({ nodes, edges: [{ from: 'a', to: 'b' }] });
    expect(out.get('a')!.y).toBe(90);
  });

  it('겹치지 않고 · 같은 입력이면 같은 결과 · 다듬은 것을 다시 다듬어도 그대로 (속성)', () => {
    const arb = fc.record({
      cells: fc.uniqueArray(fc.tuple(fc.integer({ min: 0, max: 5 }), fc.integer({ min: 0, max: 5 })), { minLength: 2, maxLength: 12, selector: ([a, b]) => `${a},${b}` }),
      jit: fc.array(fc.tuple(fc.integer({ min: -30, max: 30 }), fc.integer({ min: -20, max: 20 }), fc.integer({ min: 120, max: 260 }), fc.integer({ min: 40, max: 120 })), { minLength: 12, maxLength: 12 }),
      links: fc.array(fc.tuple(fc.nat(11), fc.nat(11), fc.boolean()), { maxLength: 16 }),
    });
    fc.assert(fc.property(arb, ({ cells, jit, links }) => {
      const nodes = cells.map(([i, j], k) => { const [dx, dy, w, h] = jit[k]!; return box(`n${k}`, i * 340 + dx, j * 200 + dy, w, h, { top: k % 2 ? 20 : 0 }); });
      const edges = links.filter(([a, b]) => a < nodes.length && b < nodes.length && a !== b).map(([a, b, l]) => ({ from: `n${a}`, to: `n${b}`, ...(l ? { label: '이어짐' } : {}) }));
      const input: TidyInput = { nodes, edges };
      const once = tidyLayout(input);
      expect(noOverlap(once, nodes)).toBe(true);
      expect([...tidyLayout(input)]).toEqual([...once]);
      const again = tidyLayout({ nodes: nodes.map((n) => ({ ...n, ...once.get(n.id)! })), edges });
      // 정수 반올림 · 수렴 문턱 때문에 몇 px까지는 남는다 — 눈에 띄지 않는 만큼만
      for (const n of nodes) { const a = once.get(n.id)!, b = again.get(n.id)!; expect(Math.abs(a.x - b.x) + Math.abs(a.y - b.y)).toBeLessThanOrEqual(4); }
    }), { numRuns: 150 });
  });
});

describe('applyTidy', () => {
  const val = <T,>(r: TxResult<T>): T => { if (!r.ok) throw new Error(r.reason); return r.value; };
  it('바뀐 상자만 한 번에 쓰고, 실행 취소 한 번이면 처음대로', () => {
    const e = new Engine();
    const a = val(createTextBlock(e, { x: 0, y: 0 }, { title: 'A' })).blockId;
    const b = val(createTextBlock(e, { x: 330, y: 47 }, { title: 'B' })).blockId;
    val(createArrow(e, { blockId: a, side: 'auto' }, { blockId: b, side: 'auto' }));
    const before = [e.getBlock(a)!, e.getBlock(b)!].map((x) => ({ x: x.x, y: x.y }));
    const rects = tidyLayout({ nodes: [a, b].map((id) => { const x = e.getBlock(id)!; return { id, x: x.x, y: x.y, w: x.w, h: x.h }; }), edges: [{ from: a, to: b }] });
    expect(val(applyTidy(e, rects))).toBeGreaterThan(0);
    expect(e.getBlock(a)!.y + e.getBlock(a)!.h / 2).toBe(e.getBlock(b)!.y + e.getBlock(b)!.h / 2);
    e.undo();
    expect([e.getBlock(a)!, e.getBlock(b)!].map((x) => ({ x: x.x, y: x.y }))).toEqual(before);
  });
});
