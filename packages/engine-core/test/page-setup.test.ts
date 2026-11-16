// 쪽 설정: 종이 · 여백, 바꾼 것만 저장(기본값은 지움) · 실행 취소, 머리글 · 바닥글 자리 표시
import { describe, expect, it } from 'vitest';
import { Engine, fillPageText, pageGeom, setPageSetup } from '../src';

describe('쪽 설정', () => {
  it('종이 · 여백: 기본 A4 세로 1인치, 가로면 뒤집고, 넓게는 양옆 2인치', () => {
    expect(pageGeom()).toEqual({ w: 794, h: 1123, t: 96, b: 96, l: 96, r: 96 });
    expect(pageGeom({ landscape: true, margin: 'narrow' })).toEqual({ w: 1123, h: 794, t: 48, b: 48, l: 48, r: 48 });
    expect(pageGeom({ margin: 'wide' }).l).toBe(192);
  });

  it('바꾼 것만 합쳐 저장 · 기본값은 지움 · 글은 다듬기 · 실행 취소 한 번', () => {
    const e = new Engine();
    setPageSetup(e, { landscape: true, header: '  보고서   {제목} ' });
    setPageSetup(e, { numbers: 'top-right' });
    expect(e.note.pageSetup).toEqual({ landscape: true, header: '보고서 {제목}', numbers: 'top-right' });
    setPageSetup(e, { landscape: false, header: '', numbers: 'bottom-center', margin: 'normal' });
    expect(e.note.pageSetup).toBeUndefined();
    e.undo();
    expect(e.note.pageSetup?.numbers).toBe('top-right');
  });

  it('머리글 · 바닥글 자리 표시: {쪽} · {전체 쪽} · {제목} · {날짜} (영어 이름도)', () => {
    const v = { page: 2, pages: 5, title: '실험 보고서', date: '2026. 10. 8.' };
    expect(fillPageText('{제목} — {쪽} / {전체 쪽}', v)).toBe('실험 보고서 — 2 / 5');
    expect(fillPageText('{date} p.{page}', v)).toBe('2026. 10. 8. p.2');
    expect(fillPageText('{모름}', v)).toBe('{모름}');
  });
});
