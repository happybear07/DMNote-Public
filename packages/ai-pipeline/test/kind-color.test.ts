// FR-021: AI가 만든 블록은 노드 종류별 기본색 (결론 초록 · 질문 노랑 · 선택지 보라 · 근거 회색, 그 밖은 기본)
// v6: AI는 종류(nodeKind)만 저장하고, 색은 그릴 때 정한다(blockColor) — 사용자가 고른 색과 구별된다
import { beforeAll, describe, expect, it } from 'vitest';
import { blockColor, Engine, setDefaultTextCodec } from '@dn/engine-core';
import { pmCodec } from '@dn/text-pm/headless';
import { applyStructure, KIND_COLOR, structureText, type StructureV1 } from '../src';
import { fakeTransport } from './fixtures';

beforeAll(() => setDefaultTextCodec(pmCodec));

describe('AI 블록 기본색', () => {
  it('종류별 색이 블록 바탕색으로', async () => {
    const answer: StructureV1 = {
      nodes: [
        { key: 'a', title: '금리 인상', kind: 'concept' },
        { key: 'b', title: '물가 안정', kind: 'conclusion' },
        { key: 'c', title: '언제 내릴까?', kind: 'question' },
        { key: 'd', title: '통계 근거', kind: 'evidence' },
        { key: 'e', title: '동결안', kind: 'option' },
      ],
      edges: [], charts: [], tables: [],
    };
    const plan = await structureText({ text: '금리 인상과 물가 안정, 언제 내릴까? 통계 근거와 동결안을 함께 봅니다.' }, { transport: fakeTransport(() => answer) });
    const e = new Engine();
    const r = applyStructure(e, plan, { x: 0, y: 0 });
    if (!r.ok) throw new Error(r.reason);
    const block = (title: string) => [...e.blocks()].find((b) => JSON.stringify(e.contentsOf(b.id)).includes(title))!;
    const titles = ['금리 인상', '물가 안정', '언제 내릴까?', '통계 근거', '동결안'];
    expect(titles.map((t) => blockColor(block(t)))).toEqual([undefined, 'green', 'yellow', 'gray', 'purple']);
    expect(titles.map((t) => block(t).nodeKind)).toEqual(['concept', 'conclusion', 'question', 'evidence', 'option']);
    expect(titles.every((t) => block(t).style === undefined)).toBe(true); // 사용자 색 자리는 비어 있다
    // 사용자가 색을 고르면 그 색이 이긴다
    e.transact((tx) => tx.set('block', block('물가 안정').id, { style: { color: 'blue' } }), { origin: 'user' });
    expect(blockColor(block('물가 안정'))).toBe('blue');
    expect(KIND_COLOR.concept).toBeUndefined();
  });
});
