// 블록 = 콘텐츠 묶음: 묶기 · 합치기 · 풀기(한 번에 실행 취소) · 이름(붙인 이름 → 첫 제목 → 첫 줄) · 같은 배율 크기 조절 · 읽는 순서 · 복제
import { describe, expect, it } from 'vitest';
import {
  createTextBlock, duplicateBlocks, Engine, groupBlocks, groupMembers, groupName, groupOf, noteGroups, readingOrder, renameGroup, scaleBlocks, ungroupBlocks,
  type TextDoc, type TxResult,
} from '../src';

const val = <T,>(r: TxResult<T>): T => { if (!r.ok) throw new Error(r.reason); return r.value; };
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }) as TextDoc;
function setup() {
  const e = new Engine();
  const title = val(createTextBlock(e, { x: 0, y: 0 }, { kind: 'title', title: '고양이 사진' })).blockId;
  const body = val(createTextBlock(e, { x: 0, y: 60 }, { doc: doc('창가에서 졸고 있다') })).blockId;
  const pic = e.transact((tx) => { const b = tx.createBlock({ x: 300, y: 0, w: 200, h: 150 }); tx.createContent({ blockId: b, type: 'image', attachment: 'h', natural: { w: 400, h: 300 } } as never); return b; }, { origin: 'user' });
  const other = val(createTextBlock(e, { x: 0, y: 400 }, { doc: doc('다른 글') })).blockId;
  return { e, title, body, pic: val(pic), other };
}

describe('블록 묶기', () => {
  it('묶기 → 같은 묶음 · 이름은 첫 제목, 풀기 · 실행 취소 한 번', () => {
    const { e, title, body, pic } = setup();
    const gid = val(groupBlocks(e, [title, body, pic]))!;
    expect(groupOf(e, body)).toEqual({ id: gid, ids: [title, body, pic] });
    expect(groupName(e, gid)).toBe('고양이 사진');
    expect(noteGroups(e).map((g) => [g.name, g.ids.length, g.rect])).toEqual([['고양이 사진', 3, { x: 0, y: 0, w: 500, h: 150 }]]);
    val(ungroupBlocks(e, [pic]));
    expect(groupMembers(e).size).toBe(0);
    e.undo();
    expect(groupOf(e, pic)?.id).toBe(gid);
    e.undo();
    expect(groupOf(e, pic)).toBeNull();
  });

  it('하나뿐이면 묶지 않음 · 묶음에 든 상자를 고르면 그 묶음째 새 묶음으로 합침', () => {
    const { e, title, body, pic, other } = setup();
    expect(val(groupBlocks(e, [title]))).toBeNull();
    val(groupBlocks(e, [title, body]));
    const g2 = val(groupBlocks(e, [body, other]))!;
    expect([...groupMembers(e).entries()]).toEqual([[g2, [title, body, other]]]);
    expect(groupOf(e, pic)).toBeNull();
  });

  it('이름 붙이기 · 지우면 다시 첫 제목', () => {
    const { e, title, body } = setup();
    const gid = val(groupBlocks(e, [title, body], '여행'))!;
    expect(groupName(e, gid)).toBe('여행');
    val(renameGroup(e, gid, '  '));
    expect(groupName(e, gid)).toBe('고양이 사진');
  });

  it('같은 배율로 키우기: 자리 · 크기 · 글자 크기(글이 있는 상자만), 고정점은 그대로', () => {
    const { e, title, body, pic } = setup();
    val(scaleBlocks(e, [title, body, pic], { x: 0, y: 0 }, 2));
    const t = e.getBlock(title)!, p = e.getBlock(pic)!, b = e.getBlock(body)!;
    expect([t.x, t.y, t.fontScale]).toEqual([0, 0, 2]);
    expect([b.y, b.fontScale]).toEqual([120, 2]);
    expect([p.x, p.w, p.h, p.fontScale]).toEqual([600, 400, 300, undefined]);
  });

  it('읽는 순서: 묶음은 한 덩어리 (묶음 안 → 다음 상자)', () => {
    const { e, title, body, pic, other } = setup();
    const lone = val(createTextBlock(e, { x: 600, y: 10 }, { doc: doc('오른쪽 위 메모') })).blockId;
    expect(readingOrder(e.blocks()).map((b) => b.id)).toEqual([title, pic, lone, body, other]);
    val(groupBlocks(e, [title, body, pic]));
    expect(readingOrder(e.blocks()).map((b) => b.id)).toEqual([title, pic, body, lone, other]);
  });

  it('묶음째 복제하면 사본은 새 묶음', () => {
    const { e, title, body } = setup();
    const gid = val(groupBlocks(e, [title, body]))!;
    const copies = val(duplicateBlocks(e, [title, body]));
    const g2 = groupOf(e, copies[0]!);
    expect(g2 && g2.id !== gid && g2.ids.length === 2).toBe(true);
    expect(groupOf(e, title)?.ids).toEqual([title, body]);
  });

  it('묶음 안 상자 하나만 복제하면 사본도 같은 묶음 (상자 하나짜리 새 묶음이 아니라 — AT-006)', () => {
    const { e, title, body } = setup();
    const gid = val(groupBlocks(e, [title, body]))!;
    const [copy] = val(duplicateBlocks(e, [body]));
    expect(e.getBlock(copy!)?.group).toBe(gid);
    expect(groupOf(e, title)?.ids.sort()).toEqual([title, body, copy!].sort());
    expect(groupMembers(e).size).toBe(1);
  });
});
