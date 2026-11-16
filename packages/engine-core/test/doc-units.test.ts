// 문서 뷰 편집이 흐름 · 묶음 차례를 지키는지 (docs/review/DOC-EDIT-BUGS.md DE-005 ~ 007): 지우기 · 붙여넣기 · 복제 · ⋮⋮ 옮기기 뒤에도
// "문서에서 보이는 자리 = documentOrder", 새 이음은 라벨 없는 새 화살표, 실행 취소 한 번.
import { describe, expect, it } from 'vitest';
import {
  blockClip, createTextBlock, deleteAcross, deleteDocBlocks, docDropTarget, docStepTarget, docUnitIds, documentOrder, Engine, insertClipBelow, moveBlocksBelow,
  type TextDoc, type TxResult,
} from '../src';

const val = <T,>(r: TxResult<T>): T => { if (!r.ok) throw new Error(r.reason); return r.value; };
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }) as TextDoc;

/** 상자 이름 → [x, y], 화살표 [from, to, 라벨?]. 문서 순서를 이름(+단계 번호)으로 읽는다 */
function note(boxes: Record<string, [number, number]>, arrows: [string, string, string?][] = []) {
  const e = new Engine();
  const id: Record<string, string> = {}, cid: Record<string, string> = {};
  for (const [k, [x, y]] of Object.entries(boxes)) { const r = val(createTextBlock(e, { x, y }, { doc: doc(k) })); id[k] = r.blockId; cid[k] = r.contentId; }
  for (const [a, b, label] of arrows) e.transact((tx) => tx.createArrow({ from: { blockId: id[a]!, side: 'auto' }, to: { blockId: id[b]!, side: 'auto' }, ...(label ? { label } : {}) }), { origin: 'user' });
  const name = (bid: string) => Object.entries(id).find(([, v]) => v === bid)?.[0] ?? '새';
  const order = () => documentOrder(e).map((it) => `${name(it.block.id)}${it.step ?? ''}`);
  const links = () => [...e.arrows()].map((a) => `${name(a.from.blockId!)}>${name(a.to.blockId!)}${a.label ? `:${a.label}` : ''}`).sort();
  const group = (...ks: string[]) => e.transact((tx) => { for (const k of ks) tx.set('block', id[k]!, { group: 'g' }); }, { origin: 'user' });
  return { e, id, cid, order, links, group };
}
// 4단계 흐름 — 4단계는 캔버스 맨 위에 있어도 문서에선 화살표 차례
const four = () => note({ 일: [0, 100], 이: [0, 200], 삼: [0, 300], 사: [0, 0] }, [['일', '이', '그래서'], ['이', '삼'], ['삼', '사', '끝으로']]);

describe('DE-005 흐름 가운데 단계를 지우면 앞뒤를 잇는다', () => {
  it('여러 칸 글 지우기(deleteAcross)로 2 · 3단계를 지우면 1 → 4로 이어 단계 번호가 남는다 — 실행 취소 한 번', () => {
    const n = four();
    expect(n.order()).toEqual(['일1', '이2', '삼3', '사4']);
    val(deleteAcross(n.e, { id: n.cid['일']!, steps: [] }, { id: n.cid['삼']!, steps: null }, [n.cid['이']!], []));
    expect(n.order()).toEqual(['일1', '사2']);
    expect(n.links()).toEqual(['일>사']); // 새 이음은 라벨 없이 — 지운 단계의 라벨을 다른 쌍에 옮기지 않는다
    n.e.undo();
    expect(n.order()).toEqual(['일1', '이2', '삼3', '사4']);
    expect(n.links()).toEqual(['삼>사:끝으로', '이>삼', '일>이:그래서']);
  });

  it('블록 고르기 Delete(deleteDocBlocks)로 2단계만 지우면 1 → 3, 남는 쌍의 라벨은 그대로', () => {
    const n = four();
    val(deleteDocBlocks(n.e, [n.id['이']!]));
    expect(n.order()).toEqual(['일1', '삼2', '사3']);
    expect(n.links()).toEqual(['삼>사:끝으로', '일>삼']);
    expect(n.e.getBlock(n.id['이']!)).toBeUndefined();
  });

  it('첫 · 끝 단계를 지우면 잇지 않고 빠진다 · 갈래 흐름(트리)은 지어낸 이음을 만들지 않는다', () => {
    const n = four();
    val(deleteDocBlocks(n.e, [n.id['일']!, n.id['사']!]));
    expect(n.order()).toEqual(['이1', '삼2']);
    const t = note({ 뿌리: [0, 0], 가지: [0, 100], 잎: [0, 200], 옆: [200, 100] }, [['뿌리', '가지'], ['가지', '잎'], ['뿌리', '옆']]);
    val(deleteDocBlocks(t.e, [t.id['가지']!]));
    expect(t.links()).toEqual(['뿌리>옆']);
  });
});

describe('DE-006 흐름 단계 · 묶음 아래에 붙여넣기 · 복제', () => {
  it('1단계를 복제하면 사본은 1단계와 같은 단계(묶음)로 — 문서에서도 바로 아래', () => {
    const n = note({ 일: [0, 0], 이: [0, 100], 삼: [0, 200] }, [['일', '이'], ['이', '삼']]);
    val(insertClipBelow(n.e, n.id['일']!, blockClip(n.e, [n.id['일']!]), '블록 복제'));
    expect(n.order()).toEqual(['일1', '새', '이2', '삼3']);
    expect(n.links()).toEqual(['이>삼', '일>이']); // 화살표를 새로 만들지 않는다
  });

  it('묶음 블록 아래에 붙여넣으면 그 묶음에 든다 · 흐름 밖 낱 상자 아래는 자리만', () => {
    const n = note({ 가: [0, 0], 나: [0, 100], 다: [0, 200] });
    n.group('가', '나');
    val(insertClipBelow(n.e, n.id['가']!, blockClip(n.e, [n.id['다']!])));
    expect(n.order()).toEqual(['가', '새', '나', '다']);
    const m = note({ 가: [0, 0], 나: [0, 100] });
    const ids = val(insertClipBelow(m.e, m.id['가']!, blockClip(m.e, [m.id['나']!])));
    expect(m.order()).toEqual(['가', '새', '나']);
    expect(m.e.getBlock(ids[0]!)!.group).toBeUndefined();
  });
});

describe('DE-007 ⋮⋮ 끌어 옮기기', () => {
  it('같은 흐름의 단계 2개를 함께 옮기면 차례가 바뀐다 — 새 쌍은 라벨 없는 새 화살표, 실행 취소 한 번', () => {
    const n = four();
    val(moveBlocksBelow(n.e, [n.id['이']!, n.id['삼']!], n.id['사']!));
    expect(n.order()).toEqual(['일1', '사2', '이3', '삼4']);
    expect(n.links()).toEqual(['사>이', '이>삼', '일>사']); // 이 → 삼(함께 옮김)은 그대로, 라벨 붙은 쌍은 없어져 지움
    n.e.undo();
    expect(n.order()).toEqual(['일1', '이2', '삼3', '사4']);
  });

  it('흐름 밖 메모를 단계 사이에 놓으면 흐름 끝으로 — 캔버스 자리도 흐름 뒤', () => {
    const n = note({ 일: [0, 0], 이: [0, 100], 삼: [0, 200], 메모: [0, 400] }, [['일', '이'], ['이', '삼']]);
    expect(docDropTarget(n.e, [n.id['메모']!], n.id['일']!)).toBe(n.id['삼']);
    val(moveBlocksBelow(n.e, [n.id['메모']!], n.id['일']!));
    expect(n.order()).toEqual(['일1', '이2', '삼3', '메모']);
    expect(n.e.getBlock(n.id['메모']!)!.y).toBeGreaterThan(n.e.getBlock(n.id['삼']!)!.y);
    expect(n.links()).toEqual(['이>삼', '일>이']);
  });

  it('흐름 단계를 다른 흐름 가운데에 놓으면 그 흐름 끝으로, 원래 흐름은 앞뒤를 잇는다', () => {
    const n = note({ 일: [0, 0], 이: [0, 100], 삼: [0, 200], 가: [0, 400], 나: [0, 500] }, [['일', '이'], ['이', '삼'], ['가', '나']]);
    val(moveBlocksBelow(n.e, [n.id['이']!], n.id['가']!));
    expect(n.order()).toEqual(['일1', '삼2', '가1', '나2', '이']);
    expect(n.links()).toEqual(['가>나', '일>삼']);
  });

  it('묶음의 한 블록을 끌면 묶음 전체가 옮겨진다 (docUnitIds)', () => {
    const n = note({ A: [0, 0], B: [0, 100], C: [0, 200], D: [0, 300] });
    n.group('B', 'C');
    const ids = docUnitIds(n.e, [n.id['C']!]);
    expect(new Set(ids)).toEqual(new Set([n.id['B'], n.id['C']]));
    val(moveBlocksBelow(n.e, ids, null));
    expect(n.order()).toEqual(['B', 'C', 'A', 'D']);
  });

  it('Alt+↑↓ 한 조각씩: 흐름 안에선 단계마다, 흐름 밖에선 흐름 통째로 건너뛴다', () => {
    const n = note({ 일: [0, 0], 이: [0, 100], 삼: [0, 200], 메모: [0, 400] }, [['일', '이'], ['이', '삼']]);
    expect(docStepTarget(n.e, [n.id['삼']!], -1)).toBe(n.id['일']);
    val(moveBlocksBelow(n.e, [n.id['삼']!], n.id['일']!));
    expect(n.order()).toEqual(['일1', '삼2', '이3', '메모']);
    expect(docStepTarget(n.e, [n.id['메모']!], -1)).toBeNull(); // 흐름 하나를 통째로 건너 맨 위로
    val(moveBlocksBelow(n.e, [n.id['메모']!], null));
    expect(n.order()).toEqual(['메모', '일1', '삼2', '이3']);
    expect(docStepTarget(n.e, [n.id['메모']!], -1)).toBeUndefined();
    expect(docStepTarget(n.e, [n.id['메모']!], 1)).toBe(n.id['이']);
  });
});
