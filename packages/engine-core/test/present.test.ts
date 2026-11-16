// 발표 장면 나누기 (GAP #21): 제목 상자 · 제목 1 · 쪽 나눔에서 새 장면, 그렇지 않으면 묶음 · 흐름 단위, 그래도 하나면 상자마다
import { describe, expect, it } from 'vitest';
import { Engine, groupBlocks, presentSlides, type Id, type TextNode } from '../src';

const P = (t: string): TextNode => ({ type: 'paragraph', content: [{ type: 'text', text: t }] });
const H1 = (t: string): TextNode => ({ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: t }] });
function note(boxes: [number, 'title' | 'body', TextNode, boolean?][]) {
  const e = new Engine();
  const r = e.transact((tx) => boxes.map(([y, role, n, pageBreak]) => {
    const b = tx.createBlock({ x: 0, y, w: 300, h: 40, ...(pageBreak ? { pageBreak: true } : {}) });
    tx.createContent({ blockId: b, type: 'text', role, doc: { type: 'doc', content: [n] } });
    return b;
  }), { origin: 'user' });
  if (!r.ok) throw new Error(r.reason);
  const ids: Id[] = r.value;
  return { e, ids };
}

describe('발표 장면', () => {
  it('제목 상자 · 제목 1 · 쪽 나눔에서 새 장면', () => {
    const { e, ids } = note([[0, 'title', P('표지')], [60, 'body', P('부제')], [120, 'title', P('1장')], [180, 'body', P('내용')], [240, 'body', H1('2장')], [300, 'body', P('다음 쪽'), true]]);
    expect(presentSlides(e)).toEqual([[ids[0], ids[1]], [ids[2], ids[3]], [ids[4]], [ids[5]]]);
  });
  it('구역이 없으면 묶음 단위, 그것도 없으면 상자마다', () => {
    const a = note([[0, 'body', P('가')], [60, 'body', P('나')], [120, 'body', P('다')]]);
    groupBlocks(a.e, [a.ids[0]!, a.ids[1]!]);
    expect(presentSlides(a.e)).toEqual([[a.ids[0], a.ids[1]], [a.ids[2]]]);
    const b = note([[0, 'body', P('가')], [60, 'body', P('나')]]);
    expect(presentSlides(b.e)).toEqual([[b.ids[0]], [b.ids[1]]]);
    expect(presentSlides(new Engine())).toEqual([]);
  });
});
