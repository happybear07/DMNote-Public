// 손글씨 → 글 상자 (FR-038): 줄 → 문단 · 글머리 목록 · 할 일, 바꾸기는 필기를 지우고 추가는 남김, 실행 취소 한 번
import { describe, expect, it } from 'vitest';
import { addStroke, Engine, inkToText, ocrLinesDoc, type TxResult } from '../src';

const val = <T,>(r: TxResult<T>): T => { if (!r.ok) throw new Error(r.reason); return r.value; };

describe('손글씨 → 글', () => {
  it('줄 → 문단 · 글머리 · 할 일 (빈 줄은 뺀다)', () => {
    expect(ocrLinesDoc(['회의 메모', '', '- 예산', '- 일정', '[ ] 메일', '[x] 전화', '끝'])).toEqual({ type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: '회의 메모' }] },
      { type: 'bullet_list', content: [{ type: 'list_item', content: [{ type: 'paragraph', content: [{ type: 'text', text: '예산' }] }] }, { type: 'list_item', content: [{ type: 'paragraph', content: [{ type: 'text', text: '일정' }] }] }] },
      { type: 'task_list', content: [{ type: 'task_item', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '메일' }] }] }, { type: 'task_item', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '전화' }] }] }] },
      { type: 'paragraph', content: [{ type: 'text', text: '끝' }] },
    ] });
  });

  it('바꾸기: 필기 자리에 글 상자 · 필기 지움 · 실행 취소 한 번 / 추가: 필기 남김', () => {
    const e = new Engine();
    const s = val(addStroke(e, { tool: 'pen', color: '#000', width: 2, origin: { x: 100, y: 50 }, points: [0, 0, 0.5, 0, 80, 10, 0.5, 10] }));
    const b = val(inkToText(e, [s], ['안녕'], { x: 90, y: 40, w: 120, h: 40 }, { removeInk: true }));
    expect(e.getBlock(b)).toMatchObject({ x: 90, y: 40, w: 160 });
    expect(e.getStroke(s)).toBeUndefined();
    e.undo();
    expect(e.getBlock(b)).toBeUndefined();
    expect(e.getStroke(s)).toBeDefined();
    val(inkToText(e, [s], ['안녕'], { x: 90, y: 40, w: 300, h: 40 }, { removeInk: false }));
    expect(e.getStroke(s)).toBeDefined();
  });
});
