// 원문에서 상자 만들기 (11/02): 고른 글을 새 상자로 — 원문은 그대로, 새 상자에 원문 연결(source), AI 표시 없음, 실행 취소 한 번.
import { describe, expect, it } from 'vitest';
import { blockDataOrigin, bodyDoc, boxFromSource, createTextBlock, deserialize, docText, Engine, serialize, sourceOf, type Id, type TextDoc } from '../src';

const setup = () => {
  const e = new Engine();
  const t = createTextBlock(e, { x: 0, y: 0 }, { body: '금리가 오르면 대출이 줄어든다. 대출이 줄면 소비도 준다.' });
  if (!t.ok) throw new Error();
  return { e, block: t.value.blockId, content: t.value.contentId };
};
const textOf = (e: Engine, id: Id) => docText((e.contentsOf(id)[0] as { doc: TextDoc }).doc);

describe('boxFromSource', () => {
  it('고른 글로 새 상자 · 원문은 그대로 · 원문 연결과 구절', () => {
    const { e, block, content } = setup();
    const before = textOf(e, block);
    const r = boxFromSource(e, content, { from: 1, to: 17 }, bodyDoc('금리가 오르면 대출이 줄어든다.'), { x: 300, y: 0 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const b = e.getBlock(r.value.blockId)!;
    expect(textOf(e, b.id)).toBe('금리가 오르면 대출이 줄어든다.');
    expect(textOf(e, block)).toBe(before);
    expect(b.source).toEqual({ contentId: content, from: 1, to: 17, excerpt: '금리가 오르면 대출이 줄어든다.' });
    expect(sourceOf(b)?.contentId).toBe(content);
  });

  it('사람이 만든 상자 — AI 표시가 없고 데이터 출처도 사람', () => {
    const { e, content } = setup();
    const r = boxFromSource(e, content, { from: 1, to: 5 }, bodyDoc('금리가'), { x: 300, y: 0 });
    if (!r.ok) throw new Error();
    expect(e.getBlock(r.value.blockId)!.ai).toBeUndefined();
    expect(blockDataOrigin(e, r.value.blockId)).not.toMatch(/claude/);
  });

  it('실행 취소 한 번이면 상자만 사라지고, 저장 · 다시 열기에도 연결이 남음', () => {
    const { e, content } = setup();
    const r = boxFromSource(e, content, { from: 1, to: 5 }, bodyDoc('금리가'), { x: 300, y: 0 });
    if (!r.ok) throw new Error();
    const back = deserialize(JSON.parse(JSON.stringify(serialize(e))));
    expect(back.ok && new Engine(back.data).getBlock(r.value.blockId)?.source?.excerpt).toBe('금리가');
    e.undo();
    expect(e.getBlock(r.value.blockId)).toBeUndefined();
    expect(e.blockCount).toBe(1);
  });

  it('원문이 글 상자가 아니거나 고른 글이 비면 만들지 않음', () => {
    const { e, content } = setup();
    expect(boxFromSource(e, 'nope', { from: 0, to: 1 }, bodyDoc('x'), { x: 0, y: 0 }).ok).toBe(false);
    expect(boxFromSource(e, content, { from: 1, to: 1 }, bodyDoc('  '), { x: 0, y: 0 }).ok).toBe(false);
    expect(e.blockCount).toBe(1);
  });

  it('sourceOf: 사람이 꺼낸 연결이 먼저, 없으면 AI 출처', () => {
    expect(sourceOf({ source: { from: 1, to: 2, excerpt: 'a' }, ai: { generated: true, runId: 'r', source: { from: 3, to: 4 } } })?.excerpt).toBe('a');
    expect(sourceOf({ ai: { generated: true, runId: 'r', source: { from: 3, to: 4 } } })?.from).toBe(3);
    expect(sourceOf(undefined)).toBeUndefined();
  });
});
