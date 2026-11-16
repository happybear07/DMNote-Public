// 문서 뷰 '클릭하여 입력'을 받치는 엔진 규칙: 빈 줄뿐인 초안은 떠나면 지운다(초안이 아니면 남긴다) · 들여쓰기 단계를 바로 정한다
import { describe, expect, it } from 'vitest';
import { appendTextBox, discardIfEmpty, DOC_GAP, Engine, insertDraftBelow, setBlockTextStyle, setText } from '../src';

const blank = (n: number) => ({ type: 'doc' as const, content: Array.from({ length: n }, () => ({ type: 'paragraph' })) });

describe('클릭하여 입력', () => {
  it('빈 줄뿐인 초안은 지우고, 초안이 아니면(사용자가 만든 빈 줄) 남긴다', () => {
    const e = new Engine();
    const a = appendTextBox(e);
    if (!a.ok) throw new Error('append');
    setText(e, a.value.contentId, blank(5));
    expect(discardIfEmpty(e, a.value.contentId)).toMatchObject({ ok: true, value: true });
    expect(e.getBlock(a.value.blockId)).toBeUndefined();
    const b = appendTextBox(e);
    if (!b.ok) throw new Error('append');
    setText(e, b.value.contentId, blank(3));
    e.transact((tx) => tx.set('block', b.value.blockId, { draft: undefined }), { origin: 'user' });
    expect(discardIfEmpty(e, b.value.contentId)).toMatchObject({ ok: true, value: false });
    expect(e.getBlock(b.value.blockId)).toBeDefined();
  });

  it('항목 사이 틈: 위 블록 바로 아래 초안 · 아래 상자는 내림 · 글 없이 지우면 제자리 · 묶음 안이면 그 묶음', () => {
    const e = new Engine();
    const ids = e.transact((tx) => [0, 56, 112].map((y, i) => {
      const b = tx.createBlock({ x: 0, y, w: 600, h: 40, ...(i ? { group: 'g' } : {}) });
      tx.createContent({ blockId: b, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `상자 ${i}` }] }] } });
      return b;
    }), { origin: 'user' });
    if (!ids.ok) throw new Error('setup');
    const [a, b, c] = ids.value;
    const d = insertDraftBelow(e, a!, 32);
    if (!d.ok) throw new Error('insert');
    const nb = e.getBlock(d.value.blockId)!;
    expect(nb.draft).toBe(true);
    expect(nb.y).toBe(56);
    expect(nb.group).toBeUndefined();
    expect(e.getBlock(b!)!.y).toBeGreaterThanOrEqual(nb.y + nb.h + DOC_GAP);
    expect(d.value.room?.ids.sort()).toEqual([b!, c!].sort());
    expect(discardIfEmpty(e, d.value.contentId, d.value.room)).toMatchObject({ ok: true, value: true });
    expect([e.getBlock(b!)!.y, e.getBlock(c!)!.y]).toEqual([56, 112]);
    // 묶음 안 틈 (b와 c 사이) → 새 상자도 그 묶음
    const g = insertDraftBelow(e, b!, 32, true);
    if (!g.ok) throw new Error('insert');
    expect(e.getBlock(g.value.blockId)!.group).toBe('g');
    // 맨 위 (제목과 첫 항목 사이): 첫 블록 위에, 아무것도 내리지 않음
    const t = insertDraftBelow(e, null, 32);
    if (!t.ok) throw new Error('insert');
    expect(e.getBlock(t.value.blockId)!.y).toBeLessThan(0);
    expect(t.value.room).toBeNull();
  });

  it('들여쓰기 단계를 바로 정한다 (0~8, 0 · null이면 없음)', () => {
    const e = new Engine();
    const a = appendTextBox(e);
    if (!a.ok) throw new Error('append');
    const id = a.value.blockId;
    setBlockTextStyle(e, [id], { indent: 4, align: null });
    expect(e.getBlock(id)?.indent).toBe(4);
    setBlockTextStyle(e, [id], { indent: 20 });
    expect(e.getBlock(id)?.indent).toBe(8);
    setBlockTextStyle(e, [id], { indent: null });
    expect(e.getBlock(id)?.indent).toBeUndefined();
  });
});
