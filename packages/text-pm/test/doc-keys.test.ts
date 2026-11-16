// 문서 뷰 키 (워드처럼): 빈 줄 Enter → 나누기, 제목 Enter → 뒤 글은 새 상자, Ctrl+Enter → 쪽 나눔, 맨 앞 Backspace · 맨 끝 Delete → 합치기,
// 합치기 스텝은 맞닿은 문단을 한 문단으로 (커서는 이은 자리), 목록 안에서는 원래 키 동작
import { describe, expect, it } from 'vitest';
import type { TextDoc } from '@dn/engine-core';
import { EditorState, TextSelection } from 'prosemirror-state';
import { Step } from 'prosemirror-transform';
import { appendDocSteps, cutAfter, docKeymap, type DocKeyHost } from '../src/doc-keys';
import { toJSON, toNode } from '../src/codec';
import { schema } from '../src/schema';

const p = (text?: string) => (text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' });
const doc = (...content: object[]) => ({ type: 'doc', content }) as TextDoc;
const apply = (d: TextDoc, steps: unknown[]) => { let n = toNode(d); for (const s of steps) n = Step.fromJSON(schema, s as never).apply(n).doc!; return toJSON(n); };

function host() {
  const calls: unknown[][] = [];
  const h: DocKeyHost = {
    move: (...a) => { calls.push(['move', ...a]); return true; },
    split: (...a) => { calls.push(['split', ...a]); },
    breakBefore: () => { calls.push(['breakBefore']); },
    merge: (d) => { calls.push(['merge', d]); return true; },
    align: (a) => { calls.push(['align', a]); }, fontStep: (d) => { calls.push(['font', d]); }, save: () => { calls.push(['save']); },
  };
  return { h, calls };
}
/** 키 하나 누르기 (화면 없이 — 상자 넘기 ↑↓은 화면이 필요해 e2e에서) */
function press(d: TextDoc, pos: number, key: string, mode: 'title' | 'body' = 'body') {
  const { h, calls } = host();
  const plugin = docKeymap(h, mode);
  let state = EditorState.create({ doc: toNode(d) });
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)));
  const [k, ...mods] = key.split('-').reverse();
  const ev = { key: k, ctrlKey: mods.includes('Mod'), metaKey: false, shiftKey: mods.includes('Shift'), altKey: false, preventDefault() {} } as unknown as KeyboardEvent;
  const handled = plugin.props.handleKeyDown!.call(plugin, { state, dispatch: () => {} } as never, ev);
  return { handled, calls, state };
}

describe('문서 뷰 키', () => {
  it('빈 줄에서 Enter → 그 자리에서 나누기: 앞 글은 남기고 빈 줄은 없애고 뒤 글은 새 상자로', () => {
    const d = doc(p('하나'), p(), p('둘'));
    const { handled, calls } = press(d, 5, 'Enter'); // 빈 문단 안
    expect(handled).toBe(true);
    const [, cut, tail, br] = calls[0] as [string, unknown[], TextDoc, boolean];
    expect(apply(d, cut)).toEqual(doc(p('하나')));
    expect(tail).toEqual(doc(p('둘')));
    expect(br).toBe(false);
  });

  it('글이 있는 줄의 Enter · 목록 안 빈 줄은 원래 동작 (나누지 않음)', () => {
    expect(press(doc(p('하나'), p('둘')), 3, 'Enter').handled).toBe(false);
    const list = doc({ type: 'bullet_list', content: [{ type: 'list_item', content: [p('가')] }, { type: 'list_item', content: [p()] }] });
    expect(press(list, 8, 'Enter').handled).toBe(false);
  });

  it('맨 끝 빈 줄 Enter (= Enter 두 번) → 빈 새 상자', () => {
    const d = doc(p('끝'), p());
    const { calls } = press(d, 4, 'Enter');
    expect(apply(d, calls[0]![1] as unknown[])).toEqual(doc(p('끝')));
    expect(calls[0]![2]).toEqual(doc(p()));
  });

  it('제목 상자 Enter → 커서 뒤 글은 새 내용 상자로', () => {
    const d = doc(p('제목글'));
    const { calls } = press(d, 3, 'Enter', 'title');
    expect(apply(d, calls[0]![1] as unknown[])).toEqual(doc(p('제목')));
    expect(calls[0]![2]).toEqual(doc(p('글')));
  });

  it('Ctrl+Enter → 커서에서 쪽 나눔 · 맨 앞이면 이 상자부터 새 쪽', () => {
    const d = doc(p('앞뒤'));
    const { calls } = press(d, 2, 'Mod-Enter');
    expect(calls[0]![0]).toBe('split');
    expect(calls[0]![2]).toEqual(doc(p('뒤')));
    expect(calls[0]![3]).toBe(true);
    expect(press(d, 1, 'Mod-Enter').calls[0]).toEqual(['breakBefore']);
  });

  it('맨 앞 Backspace · 맨 끝 Delete → 합치기, 가운데에서는 원래 동작', () => {
    const d = doc(p('글'));
    expect(press(d, 1, 'Backspace').calls[0]).toEqual(['merge', 'prev']);
    expect(press(d, 2, 'Delete').calls[0]).toEqual(['merge', 'next']);
    expect(press(doc(p('글자')), 2, 'Backspace').handled).toBe(false);
  });

  it('워드 단축키: 정렬 Ctrl+L · E · R · J, 글자 크기 Ctrl+] · [, 저장 Ctrl+S', () => {
    const d = doc(p('글'));
    expect(['Mod-l', 'Mod-e', 'Mod-r', 'Mod-j'].map((k) => press(d, 1, k).calls[0])).toEqual([['align', 'left'], ['align', 'center'], ['align', 'right'], ['align', 'justify']]);
    expect(press(d, 1, 'Mod-]').calls[0]).toEqual(['font', 1]);
    expect(press(d, 1, 'Mod-[').calls[0]).toEqual(['font', -1]);
    expect(press(d, 1, 'Mod-s').calls[0]).toEqual(['save']);
  });

  it('합치기 스텝: 맞닿은 문단은 한 문단, 커서는 이은 자리 · 떼어 내기는 뒤 글', () => {
    const into = doc(p('앞 글'), p('끝'));
    const r = appendDocSteps(into, doc(p('이어'), p('다음')));
    expect(apply(into, r.steps)).toEqual(doc(p('앞 글'), p('끝이어'), p('다음')));
    expect(r.caret).toBe(7); // "끝" 뒤
    const s = EditorState.create({ doc: toNode(doc(p('하나둘'))) });
    const c = cutAfter(s, 3);
    expect(apply(doc(p('하나둘')), c.cut)).toEqual(doc(p('하나')));
    expect(c.tail).toEqual(doc(p('둘')));
  });
});
