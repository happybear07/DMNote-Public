// 출처 (v6): 사람이 AI 개체의 의미를 고치면 ai.editedAt — 같은 트랜잭션 · 실행 취소로 사라짐 · 자리 이동 · 원격 · AI는 안 찍음.
// 복사(클립 v2) · 복제에서도 출처 · 의미 · 모양이 남는다 — AI 블록이 사람 블록으로 둔갑하지 않게.
import { describe, expect, it } from 'vitest';
import {
  blockClip, blockDataOrigin, createFromClip, createTextBlock, dataOrigin, duplicateBlocks, EDIT_STAMP_MS, Engine, moveBlocks, setArrowLabel, setText,
  type AiProvenance, type BlockClip, type TextDoc, type TxResult,
} from '../src';

const val = <T,>(r: TxResult<T>): T => { if (!r.ok) throw new Error(r.reason); return r.value; };
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }) as TextDoc;
const AI: AiProvenance = { generated: true, runId: 'run1', origin: 'claude', model: 'claude-x' };

/** AI가 만든 블록 둘(가 → 나, 관계 causes) + 사람 블록 하나 */
function note() {
  const e = new Engine();
  const a = val(createTextBlock(e, { x: 0, y: 0 }, { doc: doc('가') }));
  const b = val(createTextBlock(e, { x: 0, y: 200 }, { doc: doc('나') }));
  const h = val(createTextBlock(e, { x: 400, y: 0 }, { doc: doc('사람') }));
  let arrow = '';
  e.transact((tx) => {
    for (const x of [a, b]) { tx.set('block', x.blockId, { ai: AI, nodeKind: 'claim' }); tx.set('content', x.contentId, { ai: AI }); }
    arrow = tx.createArrow({ from: { blockId: a.blockId, side: 'auto' }, to: { blockId: b.blockId, side: 'auto' }, relation: 'causes', label: '그래서', ai: AI, style: { line: 'wavy' } });
  }, { origin: 'ai' });
  e.clearHistory();
  return { e, a, b, h, arrow };
}

describe('editedAt 도장', () => {
  it('AI 글을 고치면 그 콘텐츠에 시각이 찍히고, 실행 취소하면 같이 사라진다', () => {
    const { e, a } = note();
    expect(dataOrigin(e.getContent(a.contentId))).toBe('claude');
    val(setText(e, a.contentId, doc('가 고침')));
    const at = e.getContent(a.contentId)!.ai!.editedAt!;
    expect(at).toBeGreaterThan(0);
    expect(dataOrigin(e.getContent(a.contentId))).toBe('claude_edited');
    expect(blockDataOrigin(e, a.blockId)).toBe('claude_edited');
    // 1분 안에 또 고치면 다시 찍지 않는다
    e.breakUndoMerge();
    val(setText(e, a.contentId, doc('가 또 고침')));
    expect(e.getContent(a.contentId)!.ai!.editedAt).toBe(at);
    e.undo(); e.undo();
    expect(e.getContent(a.contentId)!.ai).toEqual(AI);
  });

  it('관계 · 라벨 · 노드 종류를 고치면 찍히고, 자리만 옮기면 안 찍힌다', () => {
    const { e, a, b, arrow } = note();
    val(moveBlocks(e, [a.blockId], 50, 50));
    expect(e.getBlock(a.blockId)!.ai!.editedAt).toBeUndefined();
    val(setArrowLabel(e, arrow, '그러므로'));
    expect(dataOrigin(e.getArrow(arrow))).toBe('claude_edited');
    e.transact((tx) => tx.set('block', b.blockId, { nodeKind: 'evidence' }), { origin: 'user' });
    expect(dataOrigin(e.getBlock(b.blockId))).toBe('claude_edited');
    e.transact((tx) => tx.set('block', a.blockId, { style: { color: 'blue' } }), { origin: 'user' });
    expect(e.getBlock(a.blockId)!.ai!.editedAt).toBeUndefined(); // 색은 모양
  });

  it('원격 · AI · 불러오기 출처와 사람 블록은 찍지 않는다', () => {
    const { e, a, h } = note();
    for (const origin of ['remote', 'ai', 'load'] as const) e.transact((tx) => tx.set('content', a.contentId, { doc: doc(origin) }), { origin });
    expect(e.getContent(a.contentId)!.ai!.editedAt).toBeUndefined();
    val(setText(e, h.contentId, doc('사람 고침')));
    expect(e.getContent(h.contentId)!.ai).toBeUndefined();
    expect(blockDataOrigin(e, h.blockId)).toBe('human');
  });

  it('출처 라벨: 없음 = 사람 · origin 없음 = claude · 오픈 교사 고침', () => {
    expect(dataOrigin(undefined)).toBe('human');
    expect(dataOrigin({ ai: { generated: true, runId: 'x' } })).toBe('claude');
    expect(dataOrigin({ ai: { generated: true, runId: 'x', origin: 'open_teacher', editedAt: 1 } })).toBe('open_teacher_edited');
    expect(EDIT_STAMP_MS).toBe(60_000);
  });
});

describe('복사 · 복제에서 출처 · 의미 · 모양 유지', () => {
  it('클립 v2: AI 블록 · 노드 종류 · 관계 · 화살표 모양 · 붙은 블록이 다른 노트로 그대로', () => {
    const { e, a, b } = note();
    e.transact((tx) => tx.set('block', b.blockId, { attachTo: a.blockId }), { origin: 'ai' });
    const clip = blockClip(e, [a.blockId, b.blockId]);
    expect(clip.v).toBe(2);
    const other = new Engine();
    const ids = val(other.transact((tx) => createFromClip(other, tx, JSON.parse(JSON.stringify(clip)) as BlockClip, { x: 0, y: 0 }), { origin: 'user' }));
    const [na, nb] = ids.map((id) => other.getBlock(id)!);
    expect(na!.ai).toEqual(AI);
    expect(na!.nodeKind).toBe('claim');
    expect(nb!.attachTo).toBe(na!.id);
    expect(dataOrigin(other.contentsOf(na!.id)[0])).toBe('claude');
    const arr = [...other.arrows()][0]!;
    expect(arr).toMatchObject({ relation: 'causes', label: '그래서', ai: AI, style: { line: 'wavy' }, from: { blockId: na!.id }, to: { blockId: nb!.id } });
  });

  it('v1 클립도 읽힌다 · 클립 안 id · 묶음은 버린다', () => {
    const e = new Engine();
    const v1 = { kind: 'dn-blocks', v: 1, blocks: [{ dx: 0, dy: 0, w: 200, h: 50, sizing: 'auto', layout: 'flow', id: 'evil', group: 'g', contents: [{ type: 'text', role: 'body', order: 'a0', doc: doc('옛 클립') }] }], arrows: [] } as unknown as BlockClip;
    const [id] = val(e.transact((tx) => createFromClip(e, tx, v1, { x: 10, y: 10 }), { origin: 'user' }));
    expect(id).not.toBe('evil');
    expect(e.getBlock(id!)!.group).toBeUndefined();
    expect(e.contentsOf(id!)).toHaveLength(1);
  });

  it('묶음째 복제하면 묶음 끝 화살표도 사본 묶음으로, 묶음 없이 복제하면 상자 끝으로', () => {
    const { e, a, b, h } = note();
    e.transact((tx) => {
      tx.set('block', a.blockId, { group: 'g' }); tx.set('block', h.blockId, { group: 'g' });
      tx.createArrow({ from: { blockId: a.blockId, side: 'auto', groupId: 'g' }, to: { blockId: b.blockId, side: 'auto' } });
    }, { origin: 'user' });
    val(duplicateBlocks(e, [a.blockId, h.blockId, b.blockId]));
    const copies = [...e.arrows()].filter((x) => x.from.groupId && x.from.groupId !== 'g');
    expect(copies).toHaveLength(1);
    expect(e.getBlock(copies[0]!.from.blockId!)!.group).toBe(copies[0]!.from.groupId);
    val(duplicateBlocks(e, [a.blockId, b.blockId]));
    expect([...e.arrows()].filter((x) => x.from.groupId === 'g')).toHaveLength(1); // 원본만
  });
});
