// 문단 스타일 칸 (워드 스타일 갤러리): 하나만 — 감싼 인용 · 콜아웃을 풀고 새 모양으로
import { describe, expect, it } from 'vitest';
import { createTextBlock, editText, Engine, type TextDoc } from '@dn/engine-core';
import { EditorState, TextSelection } from 'prosemirror-state';
import { toJSON, toNode } from '../src/codec';
import { pmCodec } from '../src/headless';
import { paraStyle } from '../src/para-style';

const p = (text: string): TextDoc => ({ type: 'paragraph', content: [{ type: 'text', text }] }) as TextDoc;
const doc = (...content: TextDoc[]): TextDoc => ({ type: 'doc', content }) as TextDoc;
const quote = (...content: TextDoc[]): TextDoc => ({ type: 'blockquote', content }) as TextDoc;
const callout = (...content: TextDoc[]): TextDoc => ({ type: 'callout', attrs: { icon: 'bulb', color: 'yellow' }, content }) as TextDoc;

/** 글 `at`이 든 문단에 커서를 두고 스타일을 바꾼 결과 (못 하면 null) */
function apply(d: TextDoc, at: string, style: string): TextDoc | null {
  const s0 = EditorState.create({ doc: toNode(d) });
  let pos = -1;
  s0.doc.descendants((n, p) => { if (pos < 0 && n.isText && n.text!.includes(at)) pos = p + 1; });
  const s = s0.apply(s0.tr.setSelection(TextSelection.create(s0.doc, pos)));
  let out: TextDoc | null = null;
  paraStyle(style)(s, (tr) => { out = toJSON(tr.doc); });
  return out;
}

describe('문단 스타일', () => {
  it('본문 → 인용 · 콜아웃 · 코드 · 제목', () => {
    expect(apply(doc(p('가')), '가', 'quote')).toEqual(doc(quote(p('가'))));
    expect(apply(doc(p('가')), '가', 'callout')).toEqual(doc(callout(p('가'))));
    expect(apply(doc(p('가')), '가', 'code_block')).toEqual(doc({ type: 'code_block', attrs: { language: '' }, content: [{ type: 'text', text: '가' }] } as TextDoc));
    expect(apply(doc(p('가')), '가', 'h2')).toEqual(doc({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '가' }] } as TextDoc));
  });

  it('인용 → 본문: 인용을 벗긴다 (고른 문단만 — 나머지는 인용으로 남음)', () => {
    expect(apply(doc(quote(p('가'))), '가', 'paragraph')).toEqual(doc(p('가')));
    expect(apply(doc(quote(p('가'), p('나'))), '나', 'paragraph')).toEqual(doc(quote(p('가')), p('나')));
  });

  it('인용 → 콜아웃 · 콜아웃 → 제목 1: 감싼 것은 하나만', () => {
    expect(apply(doc(quote(p('가'))), '가', 'callout')).toEqual(doc(callout(p('가'))));
    expect(apply(doc(callout(p('가'))), '가', 'h1')).toEqual(doc({ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '가' }] } as TextDoc));
  });

  it('제목 → 인용: 인용 안은 본문 문단', () => {
    expect(apply(doc({ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '가' }] } as TextDoc), '가', 'quote')).toEqual(doc(quote(p('가'))));
  });

  it('모르는 스타일은 하지 않음', () => {
    expect(apply(doc(p('가')), '가', 'toggle')).toBeNull();
  });
});

describe('스타일 바꾸기와 실행 취소', () => {
  it('친 글 바로 뒤의 스타일 바꾸기는 따로 한 단계 — Ctrl+Z 한 번에 친 글까지 되돌아가지 않음', () => {
    const e = new Engine(undefined, { codec: pmCodec });
    const r = createTextBlock(e, { x: 0, y: 0 }, { body: '가' });
    if (!r.ok) throw new Error();
    const cid = r.value.contentId;
    e.clearHistory();
    const docOf = () => (e.getContent(cid) as unknown as { doc: TextDoc }).doc;
    const run = (make: (s: EditorState) => unknown[]) => { const s = EditorState.create({ doc: toNode(docOf()) }); editText(e, cid, make(s)); };
    run((s) => s.tr.insertText('나', 2).steps.map((x) => x.toJSON()));
    run((s) => { let steps: unknown[] = []; paraStyle('quote')(s.apply(s.tr.setSelection(TextSelection.create(s.doc, 1))), (tr) => { steps = tr.steps.map((x) => x.toJSON()); }); return steps; });
    expect(docOf()).toEqual(doc(quote(p('가나'))));
    e.undo();
    expect(docOf()).toEqual(doc(p('가나')));
    e.undo();
    expect(docOf()).toEqual(doc(p('가')));
  });
});
