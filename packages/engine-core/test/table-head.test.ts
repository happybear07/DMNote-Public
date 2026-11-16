// 표 머리 켜고 끄기: 머리 행(열 이름 줄 — 기본 켬) · 머리 열(첫 열 — 기본 끔), 실행 취소 한 번, 표가 아니면 거절
import { describe, expect, it } from 'vitest';
import { Engine, makeTable, setTableHead, tableHeadOn, type TableContent } from '../src';

describe('표 머리', () => {
  it('켜고 끄기 · 실행 취소 · 표가 아니면 거절', () => {
    const e = new Engine();
    const r = e.transact((tx) => {
      const b = tx.createBlock({ x: 0, y: 0, w: 300, h: 80 });
      const t = tx.createContent({ blockId: b, type: 'table', ...makeTable(['A', 'B'], [['a', 'b']]) });
      const x = tx.createBlock({ x: 0, y: 200, w: 300, h: 40 });
      const txt = tx.createContent({ blockId: x, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'paragraph' }] } });
      return { t, txt };
    }, { origin: 'user' });
    if (!r.ok) throw new Error('setup');
    const t = () => e.getContent(r.value.t) as TableContent;
    expect([tableHeadOn(t(), 'row'), tableHeadOn(t(), 'col')]).toEqual([true, false]);
    expect(setTableHead(e, r.value.t, 'row', false).ok).toBe(true);
    expect(setTableHead(e, r.value.t, 'col', true).ok).toBe(true);
    expect([t().noHeader, t().headerCol]).toEqual([true, true]);
    e.undo();
    expect([tableHeadOn(t(), 'row'), tableHeadOn(t(), 'col')]).toEqual([false, false]);
    expect(setTableHead(e, r.value.t, 'row', true).ok).toBe(true);
    expect('noHeader' in t() && t().noHeader !== undefined).toBe(false);
    expect(setTableHead(e, r.value.txt, 'row', false).ok).toBe(false);
  });
});
