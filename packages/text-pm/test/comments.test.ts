// 블록 댓글 (FR-132): 댓글 달기 · 해결(글 속 표시도 지움) · 지우기가 각각 실행 취소 한 번, 표시 스텝은 그 id만, 직렬화 왕복 · Markdown에는 안 나옴.
import { beforeAll, describe, expect, it } from 'vitest';
import {
  addComment, blockComments, createTextBlock, deleteComment, deserialize, Engine, noteOpenComments, openComments, serialize,
  setCommentResolved, setDefaultTextCodec, type TextContent, type TextDoc,
} from '@dn/engine-core';
import { pmCodec } from '../src/headless';
import { removeCommentSteps } from '../src/commands';
import { docToMarkdown } from '../src/to-markdown';

beforeAll(() => setDefaultTextCodec(pmCodec));

const marked = (id: string, t: string) => ({ type: 'text', text: t, marks: [{ type: 'comment', attrs: { id } }] });
const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '예산은 ' }, marked('a1', '3천만 원'), { type: 'text', text: '으로 ' }, marked('a2', '확정')] }] } as TextDoc;

function setup() {
  const e = new Engine();
  const r = createTextBlock(e, { x: 0, y: 0 }, { doc });
  if (!r.ok) throw new Error('setup');
  e.clearHistory();
  return { e, ...r.value };
}
const textOf = (e: Engine, cid: string) => (e.getContent(cid) as TextContent).doc;

describe('블록 댓글', () => {
  it('표시 지우기 스텝은 그 id 표시만 지운다', () => {
    const steps = removeCommentSteps(doc, 'a1');
    expect(steps.length).toBe(1);
    const r = pmCodec.apply(doc, steps) as unknown as { doc: TextDoc };
    const after = r.doc;
    expect(JSON.stringify(after)).not.toContain('"a1"');
    expect(JSON.stringify(after)).toContain('"a2"');
    expect(removeCommentSteps(doc, '없음')).toEqual([]);
  });

  it('달기 · 해결(표시도 지움) · 다시 열기 · 지우기 — 각각 실행 취소 한 번', () => {
    const { e, blockId, contentId } = setup();
    const c1 = addComment(e, blockId, '  출처 확인 필요  ', { quote: '3천만 원', anchor: 'a1' });
    const c2 = addComment(e, blockId, '날짜도');
    expect(c1.ok && c2.ok).toBe(true);
    if (!c1.ok || !c2.ok) return;
    expect(blockComments(e.getBlock(blockId)).map((c) => [c.text, c.quote, c.anchor])).toEqual([['출처 확인 필요', '3천만 원', 'a1'], ['날짜도', undefined, undefined]]);
    expect(addComment(e, blockId, '   ').ok).toBe(false);

    const edits = [{ contentId, steps: removeCommentSteps(textOf(e, contentId), 'a1') }];
    expect(setCommentResolved(e, blockId, c1.value, true, edits).ok).toBe(true);
    expect(openComments(e.getBlock(blockId)).map((c) => c.id)).toEqual([c2.value]);
    expect(JSON.stringify(textOf(e, contentId))).not.toContain('"a1"');
    e.undo();
    expect(openComments(e.getBlock(blockId))).toHaveLength(2);
    expect(JSON.stringify(textOf(e, contentId))).toContain('"a1"');
    e.redo();

    expect(setCommentResolved(e, blockId, c1.value, false).ok).toBe(true);
    expect(noteOpenComments(e).map((x) => x.comment.id)).toEqual([c1.value, c2.value]);
    expect(deleteComment(e, blockId, c2.value).ok).toBe(true);
    expect(deleteComment(e, blockId, c1.value).ok).toBe(true);
    expect((e.getBlock(blockId) as { comments?: unknown }).comments).toBeUndefined();
    e.undo();
    expect(blockComments(e.getBlock(blockId))).toHaveLength(1);
  });

  it('직렬화 왕복에 댓글 · Markdown에는 댓글도 표시도 없음', () => {
    const { e, blockId } = setup();
    addComment(e, blockId, '비밀 메모', { quote: '확정', anchor: 'a2' });
    const back = deserialize(serialize(e));
    expect(back.ok).toBe(true);
    if (back.ok) expect(JSON.stringify([...back.data.blocks])).toContain('비밀 메모');
    const md = docToMarkdown(doc);
    expect(md).toContain('예산은 3천만 원으로 확정');
    expect(md).not.toContain('a1');
  });
});
