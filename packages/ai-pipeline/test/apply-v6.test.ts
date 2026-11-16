// AI 구조화 반영 (노트 v6): 화살표에 관계 종류(모양은 저장 안 함) · 블록에 노드 종류 · 출처(모델 계열 · 모델 · 프롬프트 판 · 스키마) ·
// 차트 · 표에 붙은 노드(attachTo). 실행 취소 한 번에 전부 사라진다.
import { beforeAll, describe, expect, it } from 'vitest';
import { effectiveStyle, Engine, setDefaultTextCodec } from '@dn/engine-core';
import { pmCodec } from '@dn/text-pm/headless';
import { applyStructure, STRUCTURE_SCHEMA_NAME, structureText, type StructureV1 } from '../src';
import { fakeTransport } from './fixtures';

beforeAll(() => setDefaultTextCodec(pmCodec));

const answer: StructureV1 = {
  nodes: [
    { key: 'a', title: '금리 인상', kind: 'concept' },
    { key: 'b', title: '물가 안정', kind: 'conclusion' },
    { key: 'c', title: '사례', kind: 'evidence' },
  ],
  edges: [
    { from: 'a', to: 'b', relation: 'causes' },
    { from: 'c', to: 'a', relation: 'example-of', label: '예컨대' },
    { from: 'b', to: 'c', relation: 'contrasts' },
  ],
  charts: [{ key: 'ch', kind: 'bar', title: '물가', series: [{ name: '물가', points: [{ x: '1월', y: 3 }, { x: '2월', y: 2 }] }], attachTo: 'b' }],
  tables: [],
};
const TEXT = '금리 인상은 물가 안정을 부른다. 예컨대 사례가 있다. 물가는 1월 3, 2월 2였다.';

describe('AI 반영 v6', () => {
  it('관계 · 노드 종류 · 출처 · 붙은 노드를 저장하고 모양 · 색은 쓰지 않는다', async () => {
    const plan = await structureText({ text: TEXT }, { transport: fakeTransport(() => answer) });
    const e = new Engine();
    const r = applyStructure(e, plan, { x: 0, y: 0 }, { origin: 'claude', provider: 'anthropic' });
    if (!r.ok) throw new Error(r.reason);
    const byTitle = (t: string) => [...e.blocks()].find((b) => JSON.stringify(e.contentsOf(b.id)).includes(t))!;
    const arrows = [...e.arrows()];
    expect(arrows.map((a) => a.relation).sort()).toEqual(['causes', 'contrasts', 'example-of']);
    expect(arrows.every((a) => a.style === undefined)).toBe(true);
    const ex = arrows.find((a) => a.relation === 'example-of')!;
    expect(ex.label).toBe('예컨대'); // 원문 구절은 그대로
    expect(effectiveStyle(ex).line).toBe('dashed'); // 모양은 관계에서
    expect(arrows.find((a) => a.relation === 'causes')!.label).toBe('유발'); // 라벨 없으면 관계 칩
    expect(effectiveStyle(arrows.find((a) => a.relation === 'contrasts')!).head).toBe('none');
    expect(byTitle('물가 안정').nodeKind).toBe('conclusion');
    expect(byTitle('물가 안정').style).toBeUndefined();
    const ai = byTitle('금리 인상').ai!;
    expect(ai).toMatchObject({ origin: 'claude', provider: 'anthropic', promptVersion: plan.promptVersion, schema: STRUCTURE_SCHEMA_NAME });
    expect(ex.ai).toMatchObject({ origin: 'claude', schema: STRUCTURE_SCHEMA_NAME });
    const chart = [...e.blocks()].find((b) => e.contentsOf(b.id).some((c) => c.type === 'chart'))!;
    expect(chart.attachTo).toBe(byTitle('물가 안정').id);
    e.undo();
    expect(e.blockCount).toBe(0);
  });

  it('모델 계열을 넘기지 않으면 claude — 모르는 모델은 학습에서 빠지는 쪽으로', async () => {
    const plan = await structureText({ text: TEXT }, { transport: fakeTransport(() => answer) });
    const e = new Engine();
    const r = applyStructure(e, plan, { x: 0, y: 0 });
    if (!r.ok) throw new Error(r.reason);
    expect([...e.blocks()].every((b) => b.ai?.origin === 'claude')).toBe(true);
  });
});
