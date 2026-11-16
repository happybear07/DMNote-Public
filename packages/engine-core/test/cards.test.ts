// 카드 · 구분선 (노트형 정리 NS-01 · 02 · 03 · 04): 카드 틀 · 읽는 순서 번호 · 격자 맞추기(행 우선 · 줄 높이 · A4 폭) · 겹친 카드만 아래로 ·
// 이름을 지워도 카드 모양은 남음 · 구분선 넣기 · 방향 바꾸기
import { describe, expect, it } from 'vitest';
import {
  arrangeCards, CARD_GAP, CARD_HEAD, CARD_PAD, createDivider, createTextBlock, dividerOf, Engine, groupBlocks, newId, noteCards, overlappingCards,
  renameGroup, restackCards, setDivider, setGroupMeta, type Id,
} from '../src';

const val = <T,>(r: { ok: boolean; value?: T }) => r.value as T;
function note(sheet = false) { return new Engine({ note: { id: newId(), title: '시트', createdAt: 1, updatedAt: 1, ...(sheet ? { sheet: { size: 'a4' as const } } : {}) } }); }
/** 카드 하나 = 제목 상자 + 내용 상자 (h는 내용 상자 높이) */
function card(e: Engine, x: number, y: number, name: string, h = 80, numbered = true): Id {
  const a = val(createTextBlock(e, { x, y }, { kind: 'title', title: name, w: 300 })).blockId;
  const b = val(createTextBlock(e, { x, y: y + 60 }, { body: '내용', w: 300, h })).blockId;
  const gid = val(groupBlocks(e, [a, b], name))!;
  setGroupMeta(e, gid, { bracket: 'card', ...(numbered ? { numbered: true } : {}) });
  return gid;
}

describe('카드', () => {
  it('카드 틀 = 상자 합 + 여백 + 머리, 번호는 읽는 순서 (번호 켠 카드끼리)', () => {
    const e = note();
    const g2 = card(e, 500, 0, '둘째'), g1 = card(e, 0, 0, '첫째'), g3 = card(e, 0, 400, '셋째', 80, false), g4 = card(e, 500, 400, '넷째');
    const cards = noteCards(e);
    expect(cards.map((c) => c.id)).toEqual([g1, g2, g3, g4]);
    expect(cards.map((c) => c.number)).toEqual([1, 2, undefined, 3]);
    const c1 = cards[0]!, r = e.blockRect(e.contentsOf([...e.blocks()].find((b) => b.group === g1)!.id)[0]!.blockId)!;
    expect(c1.frame.x).toBe(r.x - CARD_PAD);
    expect(c1.frame.y).toBe(0 - CARD_PAD - CARD_HEAD);
  });

  it('격자 맞추기: 행 우선 3열, 한 줄 높이 = 그 줄에서 가장 큰 카드, 실행 취소 한 번', () => {
    const e = note();
    const ids = [card(e, 0, 0, '1', 200), card(e, 900, 50, '2'), card(e, 300, 700, '3'), card(e, 50, 1200, '4')];
    expect(arrangeCards(e, ids).ok).toBe(true);
    const f = new Map(noteCards(e).map((c) => [c.id, c.frame]));
    const [a, b, c, d] = ids.map((id) => f.get(id)!);
    expect(a!.y).toBe(b!.y); expect(b!.y).toBe(c!.y);
    expect(b!.x).toBe(a!.x + a!.w + CARD_GAP);
    expect(d!.x).toBe(a!.x);
    expect(d!.y).toBe(a!.y + Math.max(a!.h, b!.h, c!.h) + CARD_GAP);
    e.undo();
    expect(noteCards(e).find((x) => x.id === ids[1])!.frame.x).toBe(900 - CARD_PAD);
  });

  it('A4 세로 노트면 2열, 용지 안 여백에서 시작', () => {
    const e = note(true);
    const ids = [card(e, 0, 0, '1'), card(e, 400, 0, '2'), card(e, 0, 300, '3')];
    arrangeCards(e, ids);
    const f = noteCards(e).map((c) => c.frame);
    expect(f[0]!.x).toBe(24);
    expect(f[1]!.y).toBe(f[0]!.y);
    expect(f[2]!.x).toBe(24);
  });

  it('글이 늘어 겹치면 겹친 카드만 아래로 (다른 카드는 그대로)', () => {
    const e = note();
    const ids = [card(e, 0, 0, '1'), card(e, 400, 0, '2'), card(e, 0, 300, '3')];
    arrangeCards(e, ids, { cols: 2 });
    expect(overlappingCards(e)).toEqual([]);
    // 1번 카드의 내용 상자가 늘어남 (측정 높이 반영과 같음)
    const grow = [...e.blocks()].find((b) => b.group === ids[0] && b.y > 0)!;
    e.transact((tx) => tx.set('block', grow.id, { h: 500 }), { origin: 'layout', undoable: false });
    expect(overlappingCards(e).sort()).toEqual([ids[0], ids[2]].sort());
    const before2 = noteCards(e).find((c) => c.id === ids[1])!.frame.y;
    expect(val(restackCards(e))).toBe(1);
    expect(overlappingCards(e)).toEqual([]);
    expect(noteCards(e).find((c) => c.id === ids[1])!.frame.y).toBe(before2);
  });

  it('카드 안 상자가 늘어 아래 상자를 덮으면 다시 맞추기가 카드 안을 쌓고, 늘어난 카드 아래 카드도 내린다', () => {
    const e = note();
    const ids = [card(e, 0, 0, '1'), card(e, 0, 400, '2')];
    arrangeCards(e, ids, { cols: 1 });
    const top = [...e.blocks()].filter((b) => b.group === ids[0]).sort((a, b) => a.y - b.y)[0]!;
    e.transact((tx) => tx.set('block', top.id, { h: 300 }), { origin: 'layout', undoable: false });
    expect(overlappingCards(e)).toContain(ids[0]);
    restackCards(e);
    expect(overlappingCards(e)).toEqual([]);
    const [a, b] = [...e.blocks()].filter((x) => x.group === ids[0]).sort((p, q) => p.y - q.y);
    expect(b!.y).toBe(a!.y + a!.h + 8);
  });

  it('카드에 밀려 겹치게 된 아래 구분선도 같이 내리고, 멀리 있는 블록은 그대로', () => {
    const e = note();
    const g = card(e, 0, 0, '1');
    const line = val(createDivider(e, { x: 0, y: 260 }, 'h', { len: 300 })).blockId;
    const far = val(createTextBlock(e, { x: 2000, y: 0 }, { body: '멀리' })).blockId;
    const top = [...e.blocks()].filter((b) => b.group === g).sort((a, b) => a.y - b.y)[0]!;
    e.transact((tx) => tx.set('block', top.id, { h: 400 }), { origin: 'layout', undoable: false });
    restackCards(e);
    const frame = noteCards(e)[0]!.frame;
    expect(e.getBlock(line)!.y).toBeGreaterThanOrEqual(frame.y + frame.h);
    expect(e.getBlock(far)!.y).toBe(0);
  });

  it('이름을 지워도 카드 모양 · 번호는 남는다', () => {
    const e = note();
    const g = card(e, 0, 0, '이름');
    renameGroup(e, g, '');
    expect(e.note.groups?.[g]).toEqual({ bracket: 'card', numbered: true });
  });
});

describe('구분선', () => {
  it('가로선: 높이 24 고정 블록, 방향을 바꾸면 폭 · 높이를 맞바꾼다', () => {
    const e = note();
    const { blockId, contentId } = val(createDivider(e, { x: 10, y: 20 }, 'h', { len: 400, label: 'VS' }));
    expect(e.getBlock(blockId)).toMatchObject({ w: 400, h: 24, sizing: 'fixed', minH: 24 });
    expect(dividerOf(e, blockId)).toMatchObject({ orient: 'h', label: 'VS' });
    setDivider(e, contentId, { orient: 'v', line: 'dashed' });
    expect(e.getBlock(blockId)).toMatchObject({ w: 24, h: 400, minH: 400 });
    expect(dividerOf(e, blockId)).toMatchObject({ orient: 'v', line: 'dashed' });
    setDivider(e, contentId, { line: 'solid', label: '' });
    expect(dividerOf(e, blockId)!.line).toBeUndefined();
    expect(dividerOf(e, blockId)!.label).toBeUndefined();
  });
});
