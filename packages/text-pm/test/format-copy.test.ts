// 서식 복사 (워드 붓): 글자 서식만 담고(링크 · 댓글은 빼고) 다른 글자의 서식을 그것으로 바꾼다.
import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { TextDoc } from '@dn/engine-core';
import { copyMarks, pasteMarks } from '../src/format-copy';
import { toJSON, toNode } from '../src/codec';

const p = (...content: unknown[]): TextDoc => ({ type: 'doc', content: [{ type: 'paragraph', content }] }) as TextDoc;
const at = (d: TextDoc, from: number, to: number) => { const s = EditorState.create({ doc: toNode(d) }); return s.apply(s.tr.setSelection(TextSelection.create(s.doc, from + 1, to + 1))); };

describe('서식 복사', () => {
  it('굵게 · 빨강 · 1.5배를 담고 링크는 빼며, 다른 글자의 서식(기울임)을 그것으로 바꾼다', () => {
    const d = p(
      { type: 'text', text: '원본', marks: [{ type: 'strong' }, { type: 'textColor', attrs: { color: 'red' } }, { type: 'fontSize', attrs: { scale: 1.5 } }, { type: 'link', attrs: { href: 'https://a.com', title: null } }] },
      { type: 'text', text: ' 대상', marks: [{ type: 'em' }] },
    );
    const copy = copyMarks(at(d, 0, 2));
    expect(copy.map((m) => m.type).sort()).toEqual(['fontSize', 'strong', 'textColor']);
    const s = at(d, 3, 5);
    let out = s;
    pasteMarks(copy)(s, (tr) => { out = s.apply(tr); });
    const target = toJSON(out.doc).content![0]!.content!.find((n) => n.text === '대상')!;
    expect((target.marks ?? []).map((m) => m.type).sort()).toEqual(['fontSize', 'strong', 'textColor']);
  });
  it('서식 없는 글을 담으면 대상 서식을 지운다', () => {
    const d = p({ type: 'text', text: '평범 ' }, { type: 'text', text: '굵게', marks: [{ type: 'strong' }] });
    const copy = copyMarks(at(d, 0, 2));
    expect(copy).toEqual([]);
    const s = at(d, 3, 5);
    let out = s;
    pasteMarks(copy)(s, (tr) => { out = s.apply(tr); });
    expect(JSON.stringify(toJSON(out.doc))).not.toContain('strong');
  });
});
