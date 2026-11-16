// 묶음 끝 화살표 (v6 Anchor.groupId): 묶음 둘레에서 출발 · 대표 아닌 상자를 옮겨도 따라옴 · 풀면 상자 끝 · 합치면 새 묶음 ·
// 대표 상자를 지우면 남는 상자로 · 느슨한 참조(묶음이 아니면 상자 끝) · 실행 취소 한 번.
import { describe, expect, it } from 'vitest';
import {
  createTextBlock, deleteEntities, Engine, GROUP_END_PAD, groupBlocks, moveBlocks, setArrowGroupEnd, ungroupBlocks,
  type TextDoc, type TxResult,
} from '../src';

const val = <T,>(r: TxResult<T>): T => { if (!r.ok) throw new Error(r.reason); return r.value; };
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }) as TextDoc;

/** 묶음 G = 가(0,0) · 나(0,100), 따로 다(400,0) · 라(400,300), 화살표 가 → 다 */
function note() {
  const e = new Engine();
  const id: Record<string, string> = {};
  for (const [k, x, y] of [['가', 0, 0], ['나', 0, 100], ['다', 400, 0], ['라', 400, 300]] as const) id[k] = val(createTextBlock(e, { x, y }, { doc: doc(k) })).blockId;
  const g = val(groupBlocks(e, [id['가']!, id['나']!]))!;
  let arrow = '';
  e.transact((tx) => { arrow = tx.createArrow({ from: { blockId: id['가']!, side: 'auto' }, to: { blockId: id['다']!, side: 'auto' } }); }, { origin: 'user' });
  return { e, id, g, arrow };
}
const rectOf = (e: Engine, id: string) => e.blockRect(id)!;

describe('묶음 끝 화살표', () => {
  it('묶음 끝으로 붙이면 묶음 둘레에서 출발, 떼면 상자에서 — 실행 취소 한 번', () => {
    const { e, id, g, arrow } = note();
    const box = e.arrowGeometry(e.getArrow(arrow)!)!;
    expect(val(setArrowGroupEnd(e, arrow, 'from', true))).toBe(true);
    expect(e.getArrow(arrow)!.from.groupId).toBe(g);
    const grp = e.arrowGeometry(e.getArrow(arrow)!)!;
    const a = rectOf(e, id['가']!), b = rectOf(e, id['나']!);
    const bottom = Math.max(a.y + a.h, b.y + b.h) + GROUP_END_PAD;
    expect(grp.a.x).toBeGreaterThan(Math.max(a.x + a.w, b.x + b.w)); // 묶음 오른쪽 둘레 바깥
    expect(grp.a.y).toBeLessThan(bottom);
    expect(grp.a).not.toEqual(box.a);
    e.undo();
    expect(e.getArrow(arrow)!.from.groupId).toBeUndefined();
    e.redo();
    val(setArrowGroupEnd(e, arrow, 'from', false));
    expect(e.getArrow(arrow)!.from.groupId).toBeUndefined();
  });

  it('묶음이 아닌 상자 끝은 묶음 끝으로 못 붙인다', () => {
    const { e, arrow } = note();
    expect(val(setArrowGroupEnd(e, arrow, 'to', true))).toBe(false);
    expect(e.getArrow(arrow)!.to.groupId).toBeUndefined();
  });

  it('대표가 아닌 상자를 옮겨도 화살표 기하 · 공간 색인이 따라온다', () => {
    const { e, id, arrow } = note();
    val(setArrowGroupEnd(e, arrow, 'from', true));
    val(moveBlocks(e, [id['나']!], 0, 2000)); // 묶음 아래쪽이 크게 늘어남
    const g = e.arrowGeometry(e.getArrow(arrow)!)!;
    expect(g.a.y).toBeGreaterThan(500); // 둘레 가운데가 아래로 내려감
    const hits = e.queryArrows({ x: g.a.x - 1, y: g.a.y - 1, w: 2, h: 2 });
    expect(hits).toContain(arrow);
  });

  it('묶음을 풀면 상자 끝으로, 다른 상자와 합치면 새 묶음으로', () => {
    const a = note();
    val(setArrowGroupEnd(a.e, a.arrow, 'from', true));
    val(ungroupBlocks(a.e, [a.id['가']!]));
    expect(a.e.getArrow(a.arrow)!.from.groupId).toBeUndefined();
    const b = note();
    val(setArrowGroupEnd(b.e, b.arrow, 'from', true));
    const ng = val(groupBlocks(b.e, [b.id['가']!, b.id['라']!]))!;
    expect(b.e.getArrow(b.arrow)!.from.groupId).toBe(ng);
    expect(b.e.getBlock(b.id['나']!)!.group).toBe(ng);
  });

  it('대표 상자를 지우면 묶음에 남는 상자로 — 하나만 남으면 그 상자 끝으로', () => {
    const { e, id, g, arrow } = note();
    val(setArrowGroupEnd(e, arrow, 'from', true));
    val(deleteEntities(e, [id['가']!]));
    const a = e.getArrow(arrow)!;
    expect(a).toBeDefined();
    expect(a.from.blockId).toBe(id['나']);
    expect(a.from.groupId).toBeUndefined(); // 상자 하나 = 묶음 아님
    e.undo();
    expect(e.getArrow(arrow)!.from).toMatchObject({ blockId: id['가'], groupId: g });
    // 셋이면 묶음 끝 그대로, 대표만 바뀜
    val(groupBlocks(e, [id['가']!, id['라']!]));
    const g3 = e.getBlock(id['가']!)!.group!;
    expect(e.getArrow(arrow)!.from.groupId).toBe(g3);
    val(deleteEntities(e, [id['가']!]));
    expect(e.getArrow(arrow)!.from.groupId).toBe(g3);
    expect([id['나'], id['라']]).toContain(e.getArrow(arrow)!.from.blockId);
  });

  it('느슨한 참조: 대표 상자가 그 묶음이 아니면 상자 끝으로 그린다', () => {
    const { e, id, arrow } = note();
    const box = e.arrowGeometry(e.getArrow(arrow)!)!;
    e.transact((tx) => tx.set('arrow', arrow, { from: { blockId: id['가']!, side: 'auto', groupId: 'no-such-group' } }), { origin: 'remote' });
    expect(e.arrowGeometry(e.getArrow(arrow)!)).toEqual(box);
  });
});

describe('묶음 종류 · 테두리 (v6 3단계)', () => {
  it('setGroupMeta: 이름은 두고 종류 · 테두리만 바꾸기 · 지우기 · 실행 취소 한 번 · 풀면 사라짐', async () => {
    const { setGroupMeta, renameGroup } = await import('../src');
    const { e, id, g } = note();
    val(renameGroup(e, g, '전제'));
    val(setGroupMeta(e, g, { kind: 'premises', bracket: 'brace' }));
    expect(e.note.groups?.[g]).toEqual({ name: '전제', kind: 'premises', bracket: 'brace' });
    val(setGroupMeta(e, g, { bracket: undefined }));
    expect(e.note.groups?.[g]).toEqual({ name: '전제', kind: 'premises' });
    e.undo();
    expect(e.note.groups?.[g]?.bracket).toBe('brace');
    val(ungroupBlocks(e, [id['가']!]));
    expect(e.note.groups?.[g]).toBeUndefined();
  });
});
