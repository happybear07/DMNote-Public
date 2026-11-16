// 각주 (워드): 넣기 명령 · Markdown ^[글] 읽기 · 쓰기 · 글 줄에는 안 들어가고 따로 모으기.
import { describe, expect, it } from 'vitest';
import { EditorState, NodeSelection, TextSelection } from 'prosemirror-state';
import { docText, footnoteNotes, type TextDoc } from '@dn/engine-core';
import { markdownToDoc, pmCodec, toNode } from '../src/headless';
import { formatCommand } from '../src/commands';
import { docToMarkdown } from '../src/to-markdown';
import { toJSON } from '../src/codec';

const doc = (content: unknown[]): TextDoc => ({ type: 'doc', content: [{ type: 'paragraph', content }] }) as TextDoc;

describe('각주', () => {
  it('넣기: 커서 자리에 빈 각주를 넣고 골라 둔다 (입력 칸이 열리게)', () => {
    let s = EditorState.create({ doc: toNode(doc([{ type: 'text', text: '본문' }])) });
    s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, 3)));
    let out = s;
    expect(formatCommand('footnote')!(s, (tr) => { out = s.apply(tr); })).toBe(true);
    expect(out.selection instanceof NodeSelection && out.selection.node.type.name).toBe('footnote');
    expect(toJSON(out.doc).content![0]!.content!.map((n) => n.type)).toEqual(['text', 'footnote']);
  });
  it('Markdown ^[글] ↔ 각주', () => {
    const d = markdownToDoc('통계는 이렇다^[통계청 2025]. 끝');
    expect(pmCodec.validate(d)).toBeNull();
    const fn = d.content[0]!.content!.find((n) => n.type === 'footnote');
    expect(fn?.attrs).toEqual({ note: '통계청 2025' });
    expect(docToMarkdown(d, {})).toContain('^[통계청 2025]');
  });
  it('글 줄(미리보기 · 제목)에는 안 들어가고 따로 모은다', () => {
    const d = doc([{ type: 'text', text: '본문' }, { type: 'footnote', attrs: { note: '출처 A' } }, { type: 'text', text: ' 이어서' }, { type: 'footnote', attrs: { note: '' } }]);
    expect(docText(d)).toBe('본문 이어서');
    expect(footnoteNotes(d)).toEqual(['출처 A']);
    expect(footnoteNotes(d, true)).toEqual(['출처 A', '']);
  });
});
