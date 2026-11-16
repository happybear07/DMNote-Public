// 할 일 모아보기 (FR-137): 글 속 날짜 · 기한 묶음 · 노트에서 모으기
import { describe, expect, it } from 'vitest';
import { createTextBlock, Engine } from '@dn/engine-core';
import { markdownToDoc } from '@dn/text-pm/headless';
import { collectTodos, groupOf, parseDue } from '../src/todos';

// 2026-10-03 (토) 15:00
const NOW = new Date(2026, 9, 3, 15).getTime();
const day = (m: number, d: number, y = 2026) => new Date(y, m - 1, d).getTime();

describe('글 속 날짜', () => {
  it.each([
    ['보고서 2026-10-05까지', day(10, 5)],
    ['2026.10.7 발표', day(10, 7)],
    ['10/9 회의', day(10, 9)],
    ['10월 12일 마감', day(10, 12)],
    ['오늘 장보기', day(10, 3)],
    ['내일 전화', day(10, 4)],
    ['모레 운동', day(10, 5)],
    ['금요일에 제출', day(10, 9)],
    ['토요일 청소', day(10, 3)],
    ['다음 주 월요일', day(10, 5)],
    ['다음 주 금요일', day(10, 9)], // 토요일 기준 다음 주 = 월요일부터 시작하는 주
    ['1/5 신년 계획', day(1, 5, 2027)],
  ])('%s', (text, want) => { expect(parseDue(text, NOW)).toBe(want); });

  it('날짜가 아니면 없음 (버전 1.2.3 · 2월 30일)', () => {
    expect(parseDue('버전 1.2.3 배포', NOW)).toBeUndefined();
    expect(parseDue('2월 30일', NOW)).toBeUndefined();
    expect(parseDue('그냥 할 일', NOW)).toBeUndefined();
  });
});

describe('기한 묶음', () => {
  it('지남 · 오늘 · 이번 주(일요일까지) · 나중 · 없음', () => {
    expect(groupOf(day(10, 2), NOW)).toBe('overdue');
    expect(groupOf(day(10, 3), NOW)).toBe('today');
    expect(groupOf(day(10, 4), NOW)).toBe('week');
    expect(groupOf(day(10, 5), NOW)).toBe('later');
    expect(groupOf(undefined, NOW)).toBe('none');
  });
});

describe('노트에서 모으기', () => {
  it('할 일 항목 · 체크 상태 · 위치 · 기한, 위 상자부터', () => {
    const e = new Engine({ note: { id: 'n', title: '', createdAt: 0, updatedAt: 0 } });
    createTextBlock(e, { x: 0, y: 300 }, { doc: markdownToDoc('- [ ] 아래 상자 내일') });
    createTextBlock(e, { x: 0, y: 0 }, { doc: markdownToDoc('- [x] 끝난 일\n- [ ] 남은 일 10/9\n  - [ ] 하위 일') });
    const t = collectTodos(e, NOW);
    expect(t.map((x) => [x.text, x.checked])).toEqual([['끝난 일', true], ['남은 일 10/9', false], ['하위 일', false], ['아래 상자 내일', false]]);
    expect(t[1]!.due).toBe(day(10, 9));
    expect(t[3]!.due).toBe(day(10, 4));
    expect(new Set(t.map((x) => x.pos)).size).toBe(3); // 같은 상자 안은 위치가 다르다
  });
});

describe('AI 요약이 베낀 할 일 (교차 검토 A7)', () => {
  it('AI 상자의 할 일이 사람 할 일과 글이 같으면 한 번만 · 요약이 새로 뽑은 할 일은 남는다 · 개수도 같다', async () => {
    const e = new Engine();
    createTextBlock(e, { x: 0, y: 200 }, { doc: markdownToDoc('- [ ] 견적 받기\n- [x] 회의실 잡기') });
    const ai = createTextBlock(e, { x: 0, y: 0 }, { doc: markdownToDoc('**AI 요약**\n\n- [ ] 견적  받기\n- [ ] 민수에게 메일') });
    if (!ai.ok) throw new Error(ai.reason);
    e.transact((tx) => tx.set('block', ai.value.blockId, { ai: { generated: true, runId: 'r', promptVersion: 'edit.v1' } }), { origin: 'ai' });
    expect(collectTodos(e).map((t) => t.text)).toEqual(['민수에게 메일', '견적 받기', '회의실 잡기']);
    const { countTodos } = await import('../src/ws-model');
    expect(countTodos(e)).toEqual({ done: 1, total: 3 });
  });
});
