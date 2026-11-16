// 그림 · 표 캡션: 종류(표 · 그림 · 글 없음), 번호는 문서 차례로 종류마다, 달기 · 지우기 · 실행 취소.
import { describe, expect, it } from 'vitest';
import { captionKind, captionNumbers, Engine, makeTable, setBlockCaption, setImageAlt } from '../src';

function setup() {
  const e = new Engine();
  const ids = e.transact((tx) => {
    const t1 = tx.createBlock({ x: 0, y: 0, w: 300, h: 80 }); tx.createContent({ blockId: t1, type: 'table', ...makeTable(['A'], [['a']]) });
    const g1 = tx.createBlock({ x: 0, y: 200, w: 300, h: 160 }); tx.createContent({ blockId: g1, type: 'image', attachment: 'h1', natural: { w: 10, h: 10 } });
    const txt = tx.createBlock({ x: 0, y: 400, w: 300, h: 40 }); tx.createContent({ blockId: txt, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'paragraph' }] } });
    const g2 = tx.createBlock({ x: 0, y: 500, w: 300, h: 160 }); tx.createContent({ blockId: g2, type: 'chart', kind: 'bar', series: [] });
    const t2 = tx.createBlock({ x: 0, y: 700, w: 300, h: 80 }); tx.createContent({ blockId: t2, type: 'table', ...makeTable(['B'], [['b']]) });
    return { t1, g1, txt, g2, t2 };
  }, { origin: 'user' });
  if (!ids.ok) throw new Error('setup');
  return { e, ...ids.value };
}

describe('캡션', () => {
  it('종류: 표 · 그림 · 글 상자는 없음', () => {
    const { e, t1, g1, txt, g2 } = setup();
    expect([captionKind(e, t1), captionKind(e, g1), captionKind(e, txt), captionKind(e, g2)]).toEqual(['표', '그림', null, '그림']);
  });
  it('캡션이 달린 것만 문서 차례로 종류마다 번호', () => {
    const { e, t1, g1, g2, t2 } = setup();
    for (const id of [t1, g1, g2, t2]) setBlockCaption(e, id, '설명');
    const n = captionNumbers(e);
    expect([n.get(t1)?.label, n.get(g1)?.label, n.get(g2)?.label, n.get(t2)?.label]).toEqual(['표 1', '그림 1', '그림 2', '표 2']);
    setBlockCaption(e, g1, '  ');
    expect(captionNumbers(e).get(g2)?.label).toBe('그림 1');
    expect(e.getBlock(g1)?.caption).toBeUndefined();
    e.undo();
    expect(e.getBlock(g1)?.caption).toBe('설명');
  });
});

describe('사진 대체 텍스트', () => {
  it('달기 · 공백 정리 · 비우면 지움 · 실행 취소 · 사진이 아니면 거절', () => {
    const { e, g1, txt } = setup();
    const img = e.contentsOf(g1)[0]!.id, alt = () => (e.getContent(img) as { alt?: string }).alt;
    expect(setImageAlt(e, img, '  바다   위 노을 ').ok).toBe(true);
    expect(alt()).toBe('바다 위 노을');
    expect(setImageAlt(e, img, ' ').ok).toBe(true);
    expect(alt()).toBeUndefined();
    e.undo();
    expect(alt()).toBe('바다 위 노을');
    expect(setImageAlt(e, e.contentsOf(txt)[0]!.id, '글').ok).toBe(false);
  });
});
