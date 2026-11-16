// 원격 글 변경 뒤의 실행 취소 (SYNC.md 13.7): 내 글자 입력(스텝)을 되돌릴 때, 그 뒤 다른 곳이 같은 글 상자를 바꿨으면
// 역스텝 위치가 맞지 않으므로 건너뛴다 — 다른 곳 글을 깨뜨리거나 되돌리기 전체가 실패하지 않게
import { describe, expect, it } from 'vitest';
import { createTextBlock, editText, Engine, textDoc, type TextDoc } from '@dn/engine-core';
import { EditorState } from 'prosemirror-state';
import { pmCodec, toNode } from '../src/headless';

const typeSteps = (doc: TextDoc, pos: number, text: string) => EditorState.create({ doc: toNode(doc) }).tr.insertText(text, pos).steps.map((s) => s.toJSON());
const text = (e: Engine, cid: string) => toNode((e.getContent(cid) as unknown as { doc: TextDoc }).doc).textContent;

describe('원격 글 변경 뒤 실행 취소', () => {
  it('다른 곳이 같은 글 상자를 바꿨으면 내 글자 입력 되돌리기는 건너뛰고 다른 곳 글을 지킨다', () => {
    const e = new Engine(undefined, { codec: pmCodec });
    const r = createTextBlock(e, { x: 0, y: 0 }, { body: '처음' });
    if (!r.ok) throw new Error();
    const cid = r.value.contentId;
    e.clearHistory();
    const doc = (e.getContent(cid) as unknown as { doc: TextDoc }).doc;
    expect(editText(e, cid, typeSteps(doc, 3, '내가 씀')).ok).toBe(true);
    // 다른 기기 글이 문서 통째로 들어온다(동기화 다리와 같은 방식)
    e.transact((tx) => tx.set('content', cid, { doc: textDoc('', '다른 기기가 다시 쓴 글') }), { origin: 'remote', undoable: false });
    e.undo();
    expect(text(e, cid)).toBe('다른 기기가 다시 쓴 글');
  });

  it('원격 변경이 다른 상자에만 있었으면 내 글자 입력은 그대로 되돌린다', () => {
    const e = new Engine(undefined, { codec: pmCodec });
    const a = createTextBlock(e, { x: 0, y: 0 }, { body: '처음' });
    const b = createTextBlock(e, { x: 400, y: 0 }, { body: '옆' });
    if (!a.ok || !b.ok) throw new Error();
    e.clearHistory();
    const cid = a.value.contentId;
    const doc = (e.getContent(cid) as unknown as { doc: TextDoc }).doc;
    editText(e, cid, typeSteps(doc, 3, '추가'));
    e.transact((tx) => tx.set('content', b.value.contentId, { doc: textDoc('', '옆 상자 바뀜') }), { origin: 'remote', undoable: false });
    e.undo();
    expect(text(e, cid)).toBe('처음');
  });
});
