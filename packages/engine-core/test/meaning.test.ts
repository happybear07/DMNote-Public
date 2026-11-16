// 의미 고치기 (v6): 관계 종류 · 노드 종류 — 모양은 그대로, 실행 취소 한 번, 이름표가 모든 값에 있다.
import { describe, expect, it } from 'vitest';
import {
  createTextBlock, Engine, NODE_KIND_LABEL, NODE_KINDS, RELATION_LABEL, RELATIONS, setArrowRelation, setNodeKind,
  type TextDoc, type TxResult,
} from '../src';

const val = <T,>(r: TxResult<T>): T => { if (!r.ok) throw new Error(r.reason); return r.value; };
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }) as TextDoc;

describe('의미 고치기', () => {
  it('관계 종류: 여러 화살표 한 번에, 모양은 건드리지 않음, 실행 취소 한 번, 미정으로 되돌리기', () => {
    const e = new Engine();
    const a = val(createTextBlock(e, { x: 0, y: 0 }, { doc: doc('가') })).blockId;
    const b = val(createTextBlock(e, { x: 300, y: 0 }, { doc: doc('나') })).blockId;
    const ids: string[] = [];
    e.transact((tx) => { ids.push(tx.createArrow({ from: { blockId: a, side: 'auto' }, to: { blockId: b, side: 'auto' }, style: { color: 'red' } })); ids.push(tx.createArrow({ from: { blockId: b, side: 'auto' }, to: { blockId: a, side: 'auto' } })); }, { origin: 'user' });
    val(setArrowRelation(e, ids, 'refutes'));
    expect(ids.map((id) => e.getArrow(id)!.relation)).toEqual(['refutes', 'refutes']);
    expect(e.getArrow(ids[0]!)!.style).toEqual({ color: 'red' });
    e.undo();
    expect(ids.map((id) => e.getArrow(id)!.relation)).toEqual([undefined, undefined]);
    e.redo();
    val(setArrowRelation(e, [ids[0]!], undefined));
    expect(e.getArrow(ids[0]!)!.relation).toBeUndefined();
  });

  it('노드 종류: 고르기 · 없애기', () => {
    const e = new Engine();
    const a = val(createTextBlock(e, { x: 0, y: 0 }, { doc: doc('가') })).blockId;
    val(setNodeKind(e, [a], 'theorem'));
    expect(e.getBlock(a)!.nodeKind).toBe('theorem');
    val(setNodeKind(e, [a], undefined));
    expect(e.getBlock(a)!.nodeKind).toBeUndefined();
  });

  it('모든 관계 · 노드 종류에 이름표', () => {
    for (const r of RELATIONS) expect(RELATION_LABEL[r], r).toBeTruthy();
    for (const k of NODE_KINDS) expect(NODE_KIND_LABEL[k], k).toBeTruthy();
  });
});

describe('블록 상태 · 역할 (v6 3단계)', () => {
  it('setBlockMeta: 글자는 다듬고 길이 제한, 빈 글자 · false는 지움, AI 블록이면 출처 도장', async () => {
    const { setBlockMeta } = await import('../src');
    const e = new Engine();
    const a = val(createTextBlock(e, { x: 0, y: 0 }, { doc: doc('가') })).blockId;
    e.transact((tx) => tx.set('block', a, { ai: { generated: true, runId: 'r' } }), { origin: 'ai' });
    val(setBlockMeta(e, [a], { status: 'belief', emphasis: 'warning', hedge: true, role: '  가설  ', speaker: 'x'.repeat(60) }));
    expect(e.getBlock(a)).toMatchObject({ status: 'belief', emphasis: 'warning', hedge: true, role: '가설' });
    expect(e.getBlock(a)!.speaker).toHaveLength(40);
    expect(e.getBlock(a)!.ai!.editedAt).toBeGreaterThan(0);
    val(setBlockMeta(e, [a], { role: '', hedge: false, status: undefined }));
    expect(e.getBlock(a)!.role).toBeUndefined();
    expect(e.getBlock(a)!.hedge).toBeUndefined();
    expect(e.getBlock(a)!.status).toBeUndefined();
  });
});
