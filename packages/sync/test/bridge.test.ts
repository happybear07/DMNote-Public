// 엔진 ⇄ Y.Doc 다리 (FR-095 ~ 097): 처음 맞추기 · 실시간 반영 · 끊긴 채 따로 고친 뒤 다시 만나면 수렴 ·
// 서로 다른 블록 변경 자동 병합 · 같은 문단의 동시 편집은 글자 단위 병합 · 끊긴 참조 거르기 · 서식 · 원자 노드 왕복
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  blockTextParts, bodyDoc, createArrow, createDivider, createTextBlock, deleteEntities, docText, Engine, groupBlocks, moveBlocks, newId, setGroupMeta, setText, type TextDoc,
} from '@dn/engine-core';
import { attach, fragmentToDoc, writeDoc } from '../src';

const val = <T,>(r: { ok: boolean; value?: T }) => r.value as T;
function pair() {
  const id = newId();
  const a = new Engine({ note: { id, title: '공유', createdAt: 1, updatedAt: 1 } });
  const b1 = val(createTextBlock(a, { x: 0, y: 0 }, { body: '첫 문단 내용' }));
  const b2 = val(createTextBlock(a, { x: 400, y: 0 }, { body: '둘째' }));
  createArrow(a, { blockId: b1.blockId, side: 'auto' }, { blockId: b2.blockId, side: 'auto' });
  const da = new Y.Doc(), db = new Y.Doc();
  attach(a, da);
  const b = new Engine({ note: { id, title: '', createdAt: 1, updatedAt: 1 } });
  Y.applyUpdate(db, Y.encodeStateAsUpdate(da));
  attach(b, db);
  // 연결: 서로의 변경을 주고받는다 (끊으려면 linked = false)
  const link = { on: true };
  da.on('update', (u: Uint8Array, origin: unknown) => { if (link.on && origin !== 'peer') Y.applyUpdate(db, u, 'peer'); });
  db.on('update', (u: Uint8Array, origin: unknown) => { if (link.on && origin !== 'peer') Y.applyUpdate(da, u, 'peer'); });
  const sync = () => { Y.applyUpdate(db, Y.encodeStateAsUpdate(da, Y.encodeStateVector(db)), 'peer'); Y.applyUpdate(da, Y.encodeStateAsUpdate(db, Y.encodeStateVector(da)), 'peer'); };
  return { a, b, da, db, link, sync, b1: b1.blockId, b2: b2.blockId };
}
const bodyOf = (e: Engine, blockId: string) => blockTextParts(e.contentsOf(blockId)).bodies[0]!;
const textOf = (e: Engine, blockId: string) => docText(bodyOf(e, blockId).doc);
const shape = (e: Engine) => JSON.stringify({ blocks: [...e.blocks()].map((x) => [x.id, x.x, x.y]).sort(), arrows: [...e.arrows()].length, texts: [...e.contents()].map((c) => JSON.stringify((c as { doc?: unknown }).doc)).sort() });

describe('엔진 ⇄ Y.Doc', () => {
  it('처음: 빈 엔진이 Y.Doc 내용으로 맞춰진다', () => {
    const { a, b, b1 } = pair();
    expect(shape(b)).toBe(shape(a));
    expect(textOf(b, b1)).toBe('첫 문단 내용');
    expect(b.note.title).toBe('공유');
  });

  it('실시간: 옮기기 · 글 고치기 · 새 블록 · 삭제가 바로 반영', () => {
    const { a, b, b1, b2 } = pair();
    moveBlocks(a, [b1], 50, 20);
    expect(b.getBlock(b1)!.x).toBe(50);
    setText(b, bodyOf(b, b2).id, bodyDoc('둘째 고침'));
    expect(textOf(a, b2)).toBe('둘째 고침');
    const n = val(createTextBlock(b, { x: 0, y: 300 }, { body: '새 블록' }));
    expect(textOf(a, n.blockId)).toBe('새 블록');
    deleteEntities(a, [n.blockId]);
    expect(b.getBlock(n.blockId)).toBeUndefined();
    expect(shape(a)).toBe(shape(b));
  });

  it('끊긴 채 따로 고친 뒤 다시 만나면: 서로 다른 블록 변경 + 같은 문단 글자 단위 병합', () => {
    const { a, b, link, sync, b1, b2 } = pair();
    link.on = false;
    setText(a, bodyOf(a, b1).id, bodyDoc('A가 앞에 쓴 첫 문단 내용'));
    setText(b, bodyOf(b, b1).id, bodyDoc('첫 문단 내용 그리고 B가 뒤에'));
    moveBlocks(a, [b2], 0, 100);
    setText(b, bodyOf(b, b2).id, bodyDoc('B가 고친 둘째'));
    link.on = true;
    sync();
    expect(textOf(a, b1)).toBe('A가 앞에 쓴 첫 문단 내용 그리고 B가 뒤에');
    expect(textOf(b, b1)).toBe(textOf(a, b1));
    expect(b.getBlock(b2)!.y).toBe(100);
    expect(textOf(a, b2)).toBe('B가 고친 둘째');
    expect(shape(a)).toBe(shape(b));
  });

  it('한쪽이 블록을 지우고 다른 쪽이 거기 화살표를 걸면: 끊긴 화살표는 엔진에 넣지 않는다 (불변식 유지)', () => {
    const { a, b, link, sync, b1, b2 } = pair();
    link.on = false;
    deleteEntities(a, [b2]);
    const n = val(createTextBlock(b, { x: 800, y: 0 }, { body: '셋째' }));
    createArrow(b, { blockId: b2, side: 'auto' }, { blockId: n.blockId, side: 'auto' });
    link.on = true;
    sync();
    for (const e of [a, b]) {
      expect(e.getBlock(b2)).toBeUndefined();
      for (const ar of e.arrows()) { expect(e.getBlock(ar.from.blockId!)).toBeDefined(); expect(e.getBlock(ar.to.blockId!)).toBeDefined(); }
    }
    expect(textOf(a, n.blockId)).toBe('셋째');
    expect(b1).toBeTruthy();
  });

  it('서식 · 목록 · 원자 노드(노트 링크 · 수식 · 줄바꿈) 왕복', () => {
    const doc: TextDoc = { type: 'doc', content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '제목' }] },
      { type: 'paragraph', content: [
        { type: 'text', text: '굵게', marks: [{ type: 'strong' }] }, { type: 'text', text: ' 링크', marks: [{ type: 'em' }, { type: 'link', attrs: { href: 'https://a.com' } }] },
        { type: 'hard_break' }, { type: 'note_link', attrs: { id: 'n1', title: '다른 노트' } }, { type: 'math_inline', attrs: { tex: 'x^2' } }, { type: 'text', text: ' 끝' },
      ] },
      { type: 'task_list', content: [{ type: 'task_item', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '할 일' }] }] }] },
      { type: 'paragraph' },
    ] };
    const y = new Y.Doc();
    const f = y.getXmlFragment('t');
    writeDoc(f, doc);
    expect(fragmentToDoc(f)).toEqual(doc);
  });
});

describe('노트형 요소 동기화 (NS-20)', () => {
  it('칩 마크 · 별점 노드 왕복, 구분선 콘텐츠 · 카드 묶음 정보가 다른 기기에 그대로', () => {
    const doc: TextDoc = { type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: '소속감', marks: [{ type: 'chip', attrs: { color: 'blue' } }] }, { type: 'text', text: ' 공감 ' }, { type: 'rating', attrs: { value: 4, max: 5 } },
    ] }] } as unknown as TextDoc;
    const y = new Y.Doc();
    const f = y.getXmlFragment('t');
    writeDoc(f, doc);
    expect(fragmentToDoc(f)).toEqual(doc);
    const { a, b, b1, b2 } = pair();
    const d = val(createDivider(a, { x: 0, y: 500 }, 'h', { label: 'VS', line: 'dashed' }));
    const gid = val(groupBlocks(a, [b1, b2], '카드'))!;
    setGroupMeta(a, gid, { bracket: 'card', tone: 'yellow', numbered: true });
    expect(b.contentsOf(d.blockId)[0]).toMatchObject({ type: 'divider', orient: 'h', label: 'VS', line: 'dashed' });
    expect(b.note.groups?.[gid]).toMatchObject({ name: '카드', bracket: 'card', tone: 'yellow', numbered: true });
  });
});
