// 문서 뷰를 워드처럼: 상자 나누기(아래 상자는 겹치지 않을 만큼만 내림 · 글자 모양 이어짐) · 합치기 · 끝에 새 상자 · 쪽 나눔 · 자리 만들기 — 실행 취소 한 번
import { describe, expect, it } from 'vitest';
import {
  appendTextBox, blockClip, discardIfEmpty, createTextBlock, documentOrder, deleteAcross, insertClipBelow, moveBlocksBelow, DOC_GAP, Engine, makeRoomBelow, mergeTextBoxes, readingOrder, setBlockTextStyle, setPageBreak, splitTextBox,
  type TextDoc, type TxResult,
} from '../src';

const val = <T,>(r: TxResult<T>): T => { if (!r.ok) throw new Error(r.reason); return r.value; };
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }) as TextDoc;
function setup() {
  const e = new Engine();
  const a = val(createTextBlock(e, { x: 0, y: 0 }, { doc: doc('첫 문단') }));
  const b = val(createTextBlock(e, { x: 0, y: 200 }, { doc: doc('둘째 문단') }));
  const side = val(createTextBlock(e, { x: 400, y: 0 }, { doc: doc('옆 칸') }));
  return { e, a, b, side };
}
const block = (e: Engine, id: string) => e.getBlock(id)!;

describe('문서 뷰 편집', () => {
  it('나누기: 새 상자는 바로 아래, 아래 상자는 겹치지 않을 만큼만 내리고 글자 모양은 이어진다 — 실행 취소 한 번', () => {
    const { e, a, b, side } = setup();
    val(setBlockTextStyle(e, [a.blockId], { align: 'center', fontScale: 1.3 }));
    const A = block(e, a.blockId), yB = block(e, b.blockId).y;
    const r = val(splitTextBox(e, a.contentId, [], doc('뒤 글'), { h: 150 }));
    const N = block(e, r.blockId);
    expect([N.x, N.y, N.w, N.h]).toEqual([A.x, A.y + A.h + DOC_GAP, A.w, 150]);
    expect([N.align, N.fontScale]).toEqual(['center', 1.3]);
    expect(e.getContent(r.contentId)).toMatchObject({ type: 'text', role: 'body', doc: doc('뒤 글') });
    expect(block(e, b.blockId).y).toBe(N.y + N.h + DOC_GAP); // 겹치던 만큼만
    expect(block(e, side.blockId).y).toBe(0); // 위쪽 줄의 옆 칸은 그대로
    expect(readingOrder(e.blocks()).map((x) => x.id)).toEqual([a.blockId, side.blockId, r.blockId, b.blockId]);
    e.undo();
    expect(e.getBlock(r.blockId)).toBeUndefined();
    expect(block(e, b.blockId).y).toBe(yB);
  });

  it('나누기: 아래 상자가 충분히 멀면 움직이지 않고, 쪽 나눔이면 새 상자에 표시 · 남은 높이(측정값)를 반영', () => {
    const { e, a, b } = setup();
    const r = val(splitTextBox(e, a.contentId, [], doc('다음 쪽'), { h: 40, pageBreak: true, curH: 60 }));
    expect(block(e, r.blockId).pageBreak).toBe(true);
    expect(block(e, a.blockId).h).toBe(60);
    expect(block(e, r.blockId).y).toBe(60 + DOC_GAP);
    expect(block(e, b.blockId).y).toBe(200); // 60+16+40+16 = 132 < 200
  });

  it('합치기: 앞 상자에 붙이고 뒤 상자는 지운다 (연결 화살표도) — 실행 취소 한 번', () => {
    const { e, a, b } = setup();
    e.transact((tx) => tx.createArrow({ from: { blockId: a.blockId, side: 'auto' }, to: { blockId: b.blockId, side: 'auto' } }), { origin: 'user' });
    val(mergeTextBoxes(e, a.contentId, [], b.contentId));
    expect(e.getBlock(b.blockId)).toBeUndefined();
    expect([...e.arrows()].length).toBe(0);
    e.undo();
    expect(e.getBlock(b.blockId)).toBeDefined();
    expect([...e.arrows()].length).toBe(1);
  });

  it('끝에 새 상자: 읽는 순서 마지막 상자 아래, 너비는 마지막 상자를 따름', () => {
    const { e, b } = setup();
    const r = val(appendTextBox(e));
    const N = block(e, r.blockId), B = block(e, b.blockId);
    expect(readingOrder(e.blocks()).at(-1)!.id).toBe(r.blockId);
    expect([N.x, N.w, N.y]).toEqual([B.x, B.w, B.y + B.h + DOC_GAP]);
    expect(val(appendTextBox(new Engine())).blockId).toBeTruthy(); // 빈 노트에서도
  });

  it('자리 만들기 + 새 상자를 바깥 트랜잭션 하나로 — 실행 취소 한 번 · 쪽 나눔 켜고 끄기', () => {
    const { e, a, b } = setup();
    const yB = block(e, b.blockId).y;
    const id = val(e.transact((tx) => { const at = val(makeRoomBelow(e, a.blockId, 300)); return tx.createBlock({ ...at, h: 300 }); }, { origin: 'user', label: '표 넣기' }));
    expect(block(e, b.blockId).y).toBeGreaterThanOrEqual(block(e, id).y + 300 + DOC_GAP);
    e.undo();
    expect(e.getBlock(id)).toBeUndefined();
    expect(block(e, b.blockId).y).toBe(yB);
    val(setPageBreak(e, b.blockId, true));
    expect(block(e, b.blockId).pageBreak).toBe(true);
    val(setPageBreak(e, b.blockId, false));
    expect(block(e, b.blockId).pageBreak).toBeUndefined();
  });
});

describe('나누기 · 합치기에도 구조 유지', () => {
  it('흐름에 든 상자를 나누면 뒷부분도 같은 단계(묶음) · 합치면 지운 상자의 화살표를 남는 상자로', () => {
    const { e, a, b } = setup();
    const c = val(createTextBlock(e, { x: 0, y: 400 }, { doc: doc('셋째') }));
    e.transact((tx) => { tx.createArrow({ from: { blockId: a.blockId, side: 'auto' }, to: { blockId: b.blockId, side: 'auto' } }); tx.createArrow({ from: { blockId: b.blockId, side: 'auto' }, to: { blockId: c.blockId, side: 'auto' } }); }, { origin: 'user' });
    const r = val(splitTextBox(e, b.contentId, [], doc('둘째 뒷부분'), { h: 40 }));
    expect(block(e, r.blockId).group).toBeDefined();
    expect(block(e, r.blockId).group).toBe(block(e, b.blockId).group);
    // b를 a에 합치면 b → c 화살표는 a → c로
    val(mergeTextBoxes(e, a.contentId, [], b.contentId));
    const arrows = [...e.arrows()].map((x) => [x.from.blockId, x.to.blockId]);
    expect(arrows).toEqual([[a.blockId, c.blockId]]);
  });
});

describe('블록 복사 · 붙여넣기 (문서 뷰)', () => {
  it('이 블록 바로 아래에 끼워 넣고 아래 상자는 내린다 — 실행 취소 한 번', () => {
    const { e, a, b, side } = setup();
    const yB = block(e, b.blockId).y;
    const ids = val(insertClipBelow(e, a.blockId, blockClip(e, [a.blockId])));
    expect(ids).toHaveLength(1);
    const n = block(e, ids[0]!);
    expect(n.y).toBe(block(e, a.blockId).y + block(e, a.blockId).h + DOC_GAP);
    expect(block(e, b.blockId).y).toBeGreaterThanOrEqual(n.y + n.h + DOC_GAP);
    expect(readingOrder(e.blocks()).map((x) => x.id).filter((id) => id !== side.blockId)).toEqual([a.blockId, ids[0], b.blockId]);
    e.undo();
    expect(e.getBlock(ids[0]!)).toBeUndefined();
    expect(block(e, b.blockId).y).toBe(yB);
  });
  it('기준 블록이 없으면 문서 끝에', () => {
    const { e, a, b } = setup();
    const ids = val(insertClipBelow(e, null, blockClip(e, [a.blockId])));
    expect(block(e, ids[0]!).y).toBeGreaterThan(block(e, b.blockId).y);
  });
});

describe('블록 옮기기 (문서 뷰 ⋮⋮ 끌기)', () => {
  it('아래 블록을 위 블록 아래로 · 맨 위로 — 순서가 바뀌고 실행 취소 한 번', () => {
    const { e, a, b, side } = setup();
    const c = val(createTextBlock(e, { x: 0, y: 400 }, { doc: doc('셋째') }));
    const order = () => readingOrder(e.blocks()).map((x) => x.id).filter((id) => id !== side.blockId);
    val(moveBlocksBelow(e, [c.blockId], a.blockId));
    expect(order()).toEqual([a.blockId, c.blockId, b.blockId]);
    val(moveBlocksBelow(e, [b.blockId], null));
    expect(order()[0]).toBe(b.blockId);
    e.undo();
    expect(order()).toEqual([a.blockId, c.blockId, b.blockId]);
  });
});

describe('여러 칸에 걸친 글 지우기', () => {
  it('첫 칸은 고치고 사이 블록 · 마지막 칸 블록은 지움 — 화살표도, 실행 취소 한 번', () => {
    const { e, a, b, side } = setup();
    const c = val(createTextBlock(e, { x: 0, y: 400 }, { doc: doc('셋째') }));
    e.transact((tx) => { tx.createArrow({ from: { blockId: b.blockId, side: 'auto' }, to: { blockId: c.blockId, side: 'auto' } }); }, { origin: 'user' });
    const n0 = e.blockCount;
    val(deleteAcross(e, { id: a.contentId, steps: [] }, { id: c.contentId, steps: null }, [], [b.blockId]));
    expect(e.getBlock(b.blockId)).toBeUndefined();
    expect(e.getBlock(c.blockId)).toBeUndefined();
    expect(e.getBlock(a.blockId)).toBeDefined();
    expect(e.getBlock(side.blockId)).toBeDefined();
    expect([...e.arrows()]).toHaveLength(0);
    e.undo();
    expect(e.blockCount).toBe(n0);
    expect([...e.arrows()]).toHaveLength(1);
  });
});

describe('흐름 단계 옮기기', () => {
  const chain = () => {
    const e = new Engine();
    const id: Record<string, string> = {};
    for (const [k, y] of [['일', 0], ['이', 150], ['삼', 300], ['밖', 600]] as const) id[k] = val(createTextBlock(e, { x: 0, y }, { doc: doc(k) })).blockId;
    for (const [f, t] of [['일', '이'], ['이', '삼']] as const) e.transact((tx) => tx.createArrow({ from: { blockId: id[f]!, side: 'auto' }, to: { blockId: id[t]!, side: 'auto' }, label: `${f}→${t}` }), { origin: 'user' });
    const name = Object.fromEntries(Object.entries(id).map(([k, v]) => [v, k]));
    const order = () => documentOrder(e).map((x) => `${name[x.block.id]}${x.step ?? ''}`);
    return { e, id, order };
  };
  it('3단계를 1단계 아래로 → 화살표가 다시 이어져 단계 번호가 바뀐다 (실행 취소 한 번)', () => {
    const { e, id, order } = chain();
    expect(order()).toEqual(['일1', '이2', '삼3', '밖']);
    val(moveBlocksBelow(e, [id['삼']!], id['일']!));
    expect(order()).toEqual(['일1', '삼2', '이3', '밖']);
    expect([...e.arrows()]).toHaveLength(2);
    e.undo();
    expect(order()).toEqual(['일1', '이2', '삼3', '밖']);
  });
  it('단계를 흐름 밖으로 → 앞뒤 단계를 이어 주고 빠진다 · 맨 앞으로', () => {
    const { e, id, order } = chain();
    val(moveBlocksBelow(e, [id['이']!], id['밖']!));
    expect(order()).toEqual(['일1', '삼2', '밖', '이']);
    const c = chain();
    val(moveBlocksBelow(c.e, [c.id['삼']!], null));
    expect(c.order()).toEqual(['삼1', '일2', '이3', '밖']);
  });
});

describe('초안 상자 (글이 들어올 때 캔버스에 나타남)', () => {
  const blank = { type: 'doc', content: [{ type: 'paragraph' }] } as TextDoc;
  const everywhere = { x: -1e6, y: -1e6, w: 2e6, h: 2e6 };
  it('빈 뒷부분으로 나누면 초안 — 캔버스 색인 밖, 문서에는 있다', () => {
    const { e, a } = setup();
    const r = val(splitTextBox(e, a.contentId, [], blank, { h: 40 }));
    expect(block(e, r.blockId).draft).toBe(true);
    expect(e.queryBlocks(everywhere)).not.toContain(r.blockId);
    expect(documentOrder(e).map((x) => x.block.id)).toContain(r.blockId);
    expect(val(splitTextBox(e, a.contentId, [], doc('뒤 글'), { h: 40 })).blockId).toBeTruthy();
  });
  it('discardIfEmpty: 빈 본문 상자는 없애고, 글 있는 상자는 둔다', () => {
    const { e, a } = setup();
    const r = val(appendTextBox(e));
    expect(val(discardIfEmpty(e, a.contentId))).toBe(false);
    expect(val(discardIfEmpty(e, r.contentId))).toBe(true);
    expect(e.getBlock(r.blockId)).toBeUndefined();
    expect(e.getContent(r.contentId)).toBeUndefined();
  });
});
