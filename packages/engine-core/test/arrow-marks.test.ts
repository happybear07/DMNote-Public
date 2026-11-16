// 화살표 기호 (v6 3단계): 칩 글자 [번호] ⇏ 기호 라벨 ±, 성립하지 않음 = 반박 모양, 응답 = 파선, setArrowMarks는 의미라서 출처 도장.
import { describe, expect, it } from 'vitest';
import { arrowChip, createTextBlock, effectiveStyle, Engine, setArrowMarks, type TextDoc, type TxResult } from '../src';

const val = <T,>(r: TxResult<T>): T => { if (!r.ok) throw new Error(r.reason); return r.value; };
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }) as TextDoc;

describe('화살표 기호', () => {
  it('칩 글자: 번호(원문자) · ⇏ · 기호 · 라벨 · 극성 순서, 없으면 빈 글자', () => {
    expect(arrowChip({})).toBe('');
    expect(arrowChip({ label: '그러므로' })).toBe('그러므로');
    expect(arrowChip({ order: 2, symbol: '∴', label: '결론', sign: '-' })).toBe('② ∴ 결론 −');
    expect(arrowChip({ negated: true, label: '항상' })).toBe('⇏ 항상');
    expect(arrowChip({ order: 25 })).toBe('25.');
  });

  it('성립하지 않음은 반박 모양(빨강 파선), 응답은 파선 — 사용자가 고른 모양이 이김', () => {
    expect(effectiveStyle({ relation: 'implies', negated: true })).toMatchObject({ line: 'dashed', tone: 'red' });
    expect(effectiveStyle({ relation: 'sends', reply: true }).line).toBe('dashed');
    expect(effectiveStyle({ relation: 'implies', negated: true, style: { line: 'wavy' } }).line).toBe('wavy');
  });

  it('setArrowMarks: 고치기 · 지우기, AI 화살표면 editedAt', () => {
    const e = new Engine();
    const a = val(createTextBlock(e, { x: 0, y: 0 }, { doc: doc('가') })).blockId;
    const b = val(createTextBlock(e, { x: 300, y: 0 }, { doc: doc('나') })).blockId;
    let id = '';
    e.transact((tx) => { id = tx.createArrow({ from: { blockId: a, side: 'auto' }, to: { blockId: b, side: 'auto' }, ai: { generated: true, runId: 'r' } }); }, { origin: 'ai' });
    val(setArrowMarks(e, [id], { symbol: '∴', negated: true, order: 3 }));
    expect(e.getArrow(id)).toMatchObject({ symbol: '∴', negated: true, order: 3 });
    expect(e.getArrow(id)!.ai!.editedAt).toBeGreaterThan(0);
    val(setArrowMarks(e, [id], { symbol: undefined, negated: false }));
    expect(e.getArrow(id)!.symbol).toBeUndefined();
    expect(e.getArrow(id)!.negated).toBeUndefined();
    expect(e.getArrow(id)!.order).toBe(3);
  });
});
