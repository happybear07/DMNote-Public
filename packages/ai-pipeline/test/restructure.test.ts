// 다시 구조화 적용 (FR-110, apply.ts replace · sourceOffset): 고른 상자(와 이어진 화살표)를 같은 트랜잭션에서 지우고 그 자리에 새 결과 · 실행 취소 한 번
import { beforeAll, describe, expect, it } from 'vitest';
import { Engine, setDefaultTextCodec } from '@dn/engine-core';
import { pmCodec } from '@dn/text-pm/headless';
import { applyStructure, structureText } from '../src';
import { fakeTransport } from './fixtures';

beforeAll(() => setDefaultTextCodec(pmCodec));

const TEXT = '금리 인상은 대출 감소로 이어지고, 대출 감소는 소비 위축을 낳습니다.';
const first = { nodes: [{ key: 'a', title: '금리 인상', kind: 'concept', source: { quote: '금리 인상' } }, { key: 'b', title: '대출 감소', kind: 'concept' }, { key: 'c', title: '소비 위축', kind: 'concept' }],
  edges: [{ from: 'a', to: 'b', relation: 'causes' }, { from: 'b', to: 'c', relation: 'causes' }], charts: [], tables: [] };
const again = { nodes: [{ key: 'x', title: '대출 감소', kind: 'concept', source: { quote: '대출 감소는' } }, { key: 'y', title: '소비 위축', kind: 'conclusion' }, { key: 'z', title: '가계 지출', kind: 'concept' }],
  edges: [{ from: 'x', to: 'y', relation: 'leads-to' }, { from: 'y', to: 'z', relation: 'causes' }], charts: [], tables: [] };

describe('다시 구조화 (replace)', () => {
  it('고른 상자 · 이어진 화살표를 지우고 그 자리에 새 결과, 나머지는 그대로 — 실행 취소 한 번이면 처음 결과', async () => {
    const e = new Engine();
    const p1 = await structureText({ text: TEXT }, { transport: fakeTransport(() => first) });
    const r1 = applyStructure(e, p1, { x: 0, y: 0 });
    if (!r1.ok) throw new Error(r1.reason);
    const byTitle = (t: string) => [...e.blocks()].find((b) => JSON.stringify(e.contentsOf(b.id)).includes(t))!;
    const keep = byTitle('금리 인상').id;
    const pick = [byTitle('대출 감소'), byTitle('소비 위축')];
    const at = { x: Math.min(...pick.map((b) => b.x)), y: Math.min(...pick.map((b) => b.y)) };
    const before = { blocks: e.blockCount, arrows: [...e.arrows()].length };

    const p2 = await structureText({ text: '대출 감소는 소비 위축을 낳고, 소비 위축은 가계 지출을 줄입니다.' }, { transport: fakeTransport(() => again) });
    const r2 = applyStructure(e, p2, at, { replace: pick.map((b) => b.id), sourceContentId: 'SRC', sourceOffset: 17 });
    if (!r2.ok) throw new Error(r2.reason);
    expect(pick.every((b) => !e.getBlock(b.id))).toBe(true);
    expect(e.getBlock(keep)).toBeTruthy();
    expect(e.blockCount).toBe(1 + 3);
    // 고른 상자 사이 화살표는 새 결과의 것으로, 바깥(금리 인상) → 대출 감소는 새 결과의 '대출 감소'로 다시 잇는다
    expect([...e.arrows()].length).toBe(3);
    const relinked = [...e.arrows()].find((a) => a.from.blockId === keep)!;
    expect(r2.blockIds).toContain(relinked.to.blockId);
    expect(relinked.relation).toBe('causes');
    // 바꾼 자리: 고른 상자들이 있던 왼쪽 위
    expect(Math.min(...r2.blockIds.map((id) => e.getBlock(id)!.x))).toBe(at.x);
    // 출처는 원문 기준 위치로 (보낸 구간의 시작만큼 밀림)
    const x = e.getBlock(r2.blockIds[0]!)!;
    expect(x.ai?.source).toMatchObject({ contentId: 'SRC', from: 17, to: 17 + '대출 감소는'.length });
    e.undo();
    expect({ blocks: e.blockCount, arrows: [...e.arrows()].length }).toEqual(before);
    expect(pick.every((b) => e.getBlock(b.id))).toBe(true);
  });
});
