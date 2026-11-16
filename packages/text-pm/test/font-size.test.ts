// 고른 글자만 글자 크기 (워드): 배율 걸기 · 한 칸 위 · 아래 · 1이면 지움 · 섞이면 null · 이상한 값 거절 · 문서 검증.
import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { TextDoc } from '@dn/engine-core';
import { pmCodec } from '../src/headless';
import { fontFamilyAt, fontSizeAt, formatCommand } from '../src/commands';
import { toJSON, toNode } from '../src/codec';
import { cleanScale } from '../src/schema';

const doc = (text: string): TextDoc => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }) as TextDoc;
const sel = (d: TextDoc, from: number, to: number) => { const s = EditorState.create({ doc: toNode(d) }); return s.apply(s.tr.setSelection(TextSelection.create(s.doc, from + 1, to + 1))); };
const run = (s: EditorState, arg: unknown) => { let out = s; formatCommand('fontSize', arg)!(s, (tr) => { out = s.apply(tr); }); return out; };

describe('고른 글자만 글자 크기', () => {
  it('배율 걸기 → 표시 하나, 1이면 지움', () => {
    let s = run(sel(doc('큰 글자'), 0, 1), 1.5);
    expect(toJSON(s.doc).content![0]!.content![0]).toEqual({ type: 'text', text: '큰', marks: [{ type: 'fontSize', attrs: { scale: 1.5 } }] });
    expect(fontSizeAt(s)).toBe(1.5);
    s = run(s, 1);
    expect(fontSizeAt(s)).toBe(1);
    expect(JSON.stringify(toJSON(s.doc))).not.toContain('fontSize');
  });
  it('한 칸 위 · 아래 (상자 글자 크기와 같은 단계)', () => {
    let s = run(sel(doc('글자'), 0, 2), 'up');
    expect(fontSizeAt(s)).toBe(1.15);
    s = run(run(s, 'up'), 'up');
    expect(fontSizeAt(s)).toBe(1.5);
    s = run(s, 'down');
    expect(fontSizeAt(s)).toBe(1.3);
  });
  it('크기가 섞인 범위는 null, 한 칸은 첫 글자 기준', () => {
    const s = run(sel(doc('가나다라'), 0, 2), 2);
    const mixed = s.apply(s.tr.setSelection(TextSelection.create(s.doc, 1, 5)));
    expect(fontSizeAt(mixed)).toBeNull();
    expect(fontSizeAt(run(mixed, 'up'))).toBe(2.5);
  });
  it('0.5 ~ 4배 밖 · 숫자 아닌 값은 거절, 문서 검증 통과', () => {
    expect(cleanScale(10)).toBeNull();
    expect(cleanScale('1e3')).toBeNull();
    expect(cleanScale('abc')).toBeNull();
    expect(cleanScale(0.875)).toBe(0.875);
    expect(pmCodec.validate({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '가', marks: [{ type: 'fontSize', attrs: { scale: 2 } }] }] }] } as TextDoc)).toBeNull();
  });
});

describe('고른 글자만 글꼴', () => {
  const font = (s: EditorState, f: unknown) => { let out = s; formatCommand('fontFamily', f)!(s, (tr) => { out = s.apply(tr); }); return out; };
  it('명조 · 고정폭 걸기 → 기본이면 지움 · 섞이면 null · 모르는 값은 지움', () => {
    let s = font(sel(doc('가나다라'), 0, 2), 'serif');
    expect(fontFamilyAt(s)).toBe('serif');
    expect(fontFamilyAt(s.apply(s.tr.setSelection(TextSelection.create(s.doc, 1, 5))))).toBeNull();
    s = font(s, 'mono');
    expect(fontFamilyAt(s)).toBe('mono');
    s = font(s, 'cursive');
    expect(fontFamilyAt(s)).toBe('sans');
    expect(JSON.stringify(toJSON(s.doc))).not.toContain('fontFamily');
  });
});
