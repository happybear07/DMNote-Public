// 고른 글자만 글자 색 · 배경 색 (노션처럼): 표시를 걸고 · 바꾸고 · 지우기, 이상한 값은 받지 않음, 섞이면 null, 옛 형광펜 문서는 그대로.
import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { TextDoc } from '@dn/engine-core';
import { pmCodec } from '../src/headless';
import { formatCommand, markColorAt } from '../src/commands';
import { toJSON, toNode } from '../src/codec';

const doc = (text: string, marks?: unknown[]): TextDoc => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text, ...(marks ? { marks } : {}) }] }] }) as TextDoc;
/** from ~ to 글자를 고른 상태 (문단 안 위치 = 글자 위치 + 1) */
const sel = (d: TextDoc, from: number, to: number) => { const s = EditorState.create({ doc: toNode(d) }); return s.apply(s.tr.setSelection(TextSelection.create(s.doc, from + 1, to + 1))); };
const run = (s: EditorState, cmd: 'textColor' | 'bgColor', c: string) => { let out = s; formatCommand(cmd, c)!(s, (tr) => { out = s.apply(tr); }); return out; };

describe('글 일부 글자 색 · 배경 색', () => {
  it('고른 글자에만 글자 색 → 바꾸면 하나로 → 비우면 지움', () => {
    let s = run(sel(doc('빨간 글자'), 0, 2), 'textColor', 'red');
    expect(toJSON(s.doc)).toEqual({ type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: '빨간', marks: [{ type: 'textColor', attrs: { color: 'red' } }] }, { type: 'text', text: ' 글자' },
    ] }] });
    s = run(s, 'textColor', '#3366FF');
    expect(markColorAt(s, 'textColor')).toBe('#3366ff');
    s = run(s, 'textColor', '');
    expect(markColorAt(s, 'textColor')).toBeNull();
  });
  it('배경 색은 형광펜 표시에 색으로 — 기본 형광은 default', () => {
    const s = run(sel(doc('강조할 말'), 0, 3), 'bgColor', 'yellow');
    expect(markColorAt(s, 'bgColor')).toBe('yellow');
    const plain = sel(doc('강조할 말', [{ type: 'highlight' }]), 0, 3);
    expect(markColorAt(plain, 'bgColor')).toBe('default');
  });
  it('이름 · #rrggbb 말고는 받지 않는다 (스타일에 그대로 들어가므로)', () => {
    const s = run(run(sel(doc('글자'), 0, 2), 'textColor', 'red'), 'textColor', 'url(javascript:1)');
    expect(markColorAt(s, 'textColor')).toBeNull();
  });
  it('색이 섞인 범위는 null', () => {
    const s = run(sel(doc('가나다라'), 0, 2), 'textColor', 'red');
    expect(markColorAt(s.apply(s.tr.setSelection(TextSelection.create(s.doc, 1, 5))), 'textColor')).toBeNull();
  });
  it('옛 문서(색 없는 형광펜)도 그대로 유효', () => {
    expect(pmCodec.validate(doc('옛 형광', [{ type: 'highlight' }]))).toBeNull();
    expect(pmCodec.validate(doc('색 있는 글자', [{ type: 'textColor', attrs: { color: 'blue' } }]))).toBeNull();
  });
});
