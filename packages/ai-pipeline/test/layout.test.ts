// 계층형 배치 (FR-109) · 적용 계획 매핑 (API 4.1, AI-PROMPTS 15절).
import { describe, expect, it, beforeAll } from 'vitest';
import { Engine, rectsIntersect, setDefaultTextCodec } from '@dn/engine-core';
import { pmCodec } from '@dn/text-pm/headless';
import { applyStructure, layeredLayout, nodeDoc, planApply, structureText, type StructurePlan } from '../src';
import { fakeTransport, sample, sampleSource } from './fixtures';

beforeAll(() => setDefaultTextCodec(pmCodec));

const box = (id: string, w = 100, h = 50) => ({ id, w, h });

describe('layeredLayout', () => {
  it('원인 → 결과가 왼쪽 → 오른쪽 층으로, 겹치지 않고, 결정적이다', () => {
    const input = {
      nodes: [box('a'), box('b'), box('c'), box('d', 100, 120), box('e')],
      edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'a', to: 'd' }, { from: 'd', to: 'c' }],
      direction: 'LR' as const,
    };
    const p = layeredLayout(input);
    expect(p.get('a')!.x).toBeLessThan(p.get('b')!.x);
    expect(p.get('b')!.x).toBeLessThan(p.get('c')!.x);
    expect(p.get('b')!.x).toBe(p.get('d')!.x);
    // 연결 없는 e는 그래프 아래
    expect(p.get('e')!.y).toBeGreaterThan(Math.max(...['a', 'b', 'c', 'd'].map((k) => p.get(k)!.y)));
    const rects = input.nodes.map((n) => ({ ...p.get(n.id)!, w: n.w, h: n.h }));
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(rectsIntersect(rects[i]!, rects[j]!)).toBe(false);
    expect([...layeredLayout(input)]).toEqual([...p]);
  });

  it('순환(되먹임 고리)도 배치된다', () => {
    const p = layeredLayout({ nodes: [box('a'), box('b'), box('c')], edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'a' }], direction: 'TB' });
    expect(p.size).toBe(3);
    expect(p.get('a')!.y).toBeLessThan(p.get('b')!.y);
  });

  it('대조(contrasts)는 같은 층', () => {
    const p = layeredLayout({ nodes: [box('r'), box('a'), box('b')], edges: [{ from: 'r', to: 'a' }, { from: 'a', to: 'b', sameLayer: true }], direction: 'LR' });
    expect(p.get('a')!.x).toBe(p.get('b')!.x);
  });
});

describe('planApply 매핑', () => {
  let plan: StructurePlan;
  beforeAll(async () => {
    plan = await structureText({ text: sampleSource }, { transport: fakeTransport(() => ({
      ...sample,
      nodes: [...sample.nodes, { key: 'n4', title: '시스템', kind: 'concept', body: '- **핵심** 구성\n- [링크](https://x.test)' }],
      edges: [...sample.edges, { from: 'n4', to: 'n2', relation: 'part-of' }, { from: 'n1', to: 'n3', relation: 'next' }, { from: 'n2', to: 'n4', relation: 'example-of', label: '30% 감소시킴' }],
    })) });
  });

  it('relation 기본 라벨(UI 언어) · 모양은 저장 안 함 · next는 라벨 없음 · 모델 라벨 우선', () => {
    const ko = planApply(null, plan, { x: 0, y: 0 });
    const by = (r: string) => ko.arrows.find((a) => a.relation === r)!;
    expect(by('causes').label).toBe('유발');
    expect(by('leads-to').label).toBe('이어짐');
    expect(by('part-of').label).toBe('일부');
    expect(by('next').label).toBeUndefined();
    expect(by('example-of')).toMatchObject({ label: '30% 감소시킴', relation: 'example-of' });
    expect(by('example-of')).not.toHaveProperty('style'); // v6: 모양은 저장하지 않고 관계에서 (점선은 그릴 때)
    const en = planApply(null, plan, { x: 0, y: 0 }, { locale: 'en' });
    expect(en.arrows.find((a) => a.relation === 'causes')!.label).toBe('causes');
  });

  it('part-of는 전체가 앞 층 (배치 방향 = to → from), 화살표 의미 방향은 그대로', () => {
    const p = planApply(null, plan, { x: 0, y: 0 });
    const at = (k: string) => p.blocks.find((b) => b.ref === k)!.rect;
    const a = p.arrows.find((x) => x.relation === 'part-of')!;
    expect([a.from, a.to]).toEqual(['c0:n4', 'c0:n2']);
    expect(at('c0:n2').x).toBeLessThan(at('c0:n4').x);
  });

  it('노드 본문: 제목은 heading, Markdown 본문은 허용 서식만(링크는 글자로)', () => {
    const d = nodeDoc('시스템', '## 소제목\n- **핵심** 구성\n- [링크](https://x.test)');
    expect(pmCodec.validate(d)).toBeNull();
    expect(d.content[0]).toMatchObject({ type: 'heading', attrs: { level: 3 } });
    expect(d.content[1]!.type).toBe('paragraph'); // 본문 제목은 문단으로
    expect(JSON.stringify(d)).not.toContain('"link"');
    expect(JSON.stringify(d)).toContain('링크');
  });

  it('노드 수식(math): 제목 아래 수식 블록 · 구분자 떼기 · 본문에 이미 있으면 한 번만 · 본문 $…$는 인라인 수식', () => {
    const d = nodeDoc('훅의 법칙', '복원력은 변위에 비례한다.', '$$F = -kx$$');
    expect(pmCodec.validate(d)).toBeNull();
    expect(d.content.map((n) => n.type)).toEqual(['heading', 'math_block', 'paragraph']);
    expect(d.content[1]!.attrs).toEqual({ tex: 'F = -kx' });
    expect(nodeDoc('주기', undefined, '\\[T = 2\\pi\\sqrt{\\frac{m}{k}}\\]').content[1]!.attrs).toEqual({ tex: 'T = 2\\pi\\sqrt{\\frac{m}{k}}' });
    expect(nodeDoc('각진동수', undefined, '\\(\\omega = \\sqrt{k/m}\\)').content[1]!.attrs).toEqual({ tex: '\\omega = \\sqrt{k/m}' });
    const once = nodeDoc('뉴턴 제2법칙', '힘은 $F = ma$ 로 쓴다.', 'F=ma');
    expect(once.content.filter((n) => n.type === 'math_block')).toHaveLength(0);
    expect(JSON.stringify(once.content[1])).toContain('"math_inline"');
    expect(nodeDoc('빈 수식', '본문', '  $ $ ').content.map((n) => n.type)).toEqual(['heading', 'paragraph']);
  });

  it('차트는 attachTo 노드와 같은 층, 그 곁에 (흐름 한가운데를 차지하지 않게), UnknownContent(type chart)로', () => {
    const p = planApply(null, plan, { x: 100, y: 200 });
    const chart = p.blocks.find((b) => b.kind === 'chart')!;
    expect(chart.content).toMatchObject({ type: 'chart', kind: 'line', unit: '회' });
    const n3 = p.blocks.find((b) => b.ref === 'c0:n3')!;
    const overlapX = Math.min(chart.rect.x + chart.rect.w, n3.rect.x + n3.rect.w) - Math.max(chart.rect.x, n3.rect.x);
    const overlapY = Math.min(chart.rect.y + chart.rect.h, n3.rect.y + n3.rect.h) - Math.max(chart.rect.y, n3.rect.y);
    expect(overlapX > 0 || overlapY > 0).toBe(true); // 같은 열(가로 흐름) 또는 같은 줄(세로 흐름)
    expect(p.bounds.x).toBe(100);
    expect(p.bounds.y).toBe(200);
  });

  it('출처: quote를 원문에서 찾으면 위치, 못 찾으면 출처 없음', () => {
    const p = planApply(null, plan, { x: 0, y: 0 }, { sourceContentId: 'SRC' });
    const n1 = p.blocks.find((b) => b.ref === 'c0:n1')!;
    expect(n1.ai.source).toEqual({ contentId: 'SRC', from: sampleSource.indexOf('리팩터링을 미루면 기술 부채가 쌓이고'), to: sampleSource.indexOf('리팩터링을 미루면 기술 부채가 쌓이고') + 20, excerpt: '리팩터링을 미루면 기술 부채가 쌓이고' });
    expect(p.blocks.find((b) => b.ref === 'c0:n2')!.ai.source).toBeUndefined();
  });

  it('기존 블록이 빽빽해도 빈 자리를 찾아 겹치지 않게 놓는다', () => {
    const e = new Engine();
    e.transact((tx) => { for (let i = 0; i < 9; i++) tx.createBlock({ x: (i % 3) * 400, y: Math.floor(i / 3) * 300, w: 380, h: 280 }); }, { origin: 'user' });
    const r = applyStructure(e, plan, { x: 400, y: 300 });
    if (!r.ok) throw new Error(r.reason);
    const all = [...e.blocks()];
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(rectsIntersect(all[i]!, all[j]!)).toBe(false);
  });

  it('빈 계획은 아무것도 바꾸지 않는다', () => {
    const e = new Engine();
    const empty: StructurePlan = { ...plan, nodes: [], edges: [], charts: [], tables: [] };
    const r = applyStructure(e, empty, { x: 0, y: 0 });
    expect(r.ok && r.counts).toEqual({ blocks: 0, arrows: 0, charts: 0, tables: 0 });
    expect(e.canUndo()).toBe(false);
  });
});
