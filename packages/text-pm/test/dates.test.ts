// 날짜 멘션 (FR-133): 날짜 말 읽기 · 상대 표기 · 문서 노드(스키마 · 검증 · Markdown · 글자 뽑기)
import { describe, expect, it } from 'vitest';
import { textLines } from '@dn/engine-core';
import { dateLabel, dateTense, parseDateQuery } from '../src/dates';
import { pmCodec } from '../src/headless';
import { docToMarkdown } from '../src/to-markdown';

// 2026-10-05 (월) 오후
const NOW = new Date(2026, 9, 5, 15, 30);

describe('날짜 말 읽기', () => {
  const p = (q: string) => parseDateQuery(q, NOW);
  it('오늘 · 내일 · 모레 · 어제 · 영어', () => {
    expect([p('오늘'), p('내일'), p('모레'), p('글피'), p('어제'), p('그제'), p('tomorrow')]).toEqual(
      ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-04', '2026-10-03', '2026-10-06']);
  });
  it('N일 뒤 · N주 후', () => {
    expect([p('3일 뒤'), p('10일후'), p('2주 뒤')]).toEqual(['2026-10-08', '2026-10-15', '2026-10-19']);
  });
  it('요일: 오늘 포함 가장 가까운 · 이번 주 / 다음 주 / 다다음 주 (주는 월요일부터)', () => {
    expect([p('월요일'), p('금요일'), p('일요일')]).toEqual(['2026-10-05', '2026-10-09', '2026-10-11']);
    expect([p('이번 주 금요일'), p('다음 주 월'), p('다음주 일요일'), p('다다음 주 수요일')]).toEqual(['2026-10-09', '2026-10-12', '2026-10-18', '2026-10-21']);
  });
  it('월일 · 연월일 형식, 없는 날짜는 null, 두 달 넘게 지난 월일은 내년', () => {
    expect([p('10월 7일'), p('10/7'), p('12.25'), p('2027-01-03'), p('2027.1.3'), p('2027년 1월 3일')]).toEqual(
      ['2026-10-07', '2026-10-07', '2026-12-25', '2027-01-03', '2027-01-03', '2027-01-03']);
    expect([p('2월 30일'), p('13/1'), p('사과'), p(''), p('금')]).toEqual([null, null, null, null, null]);
    expect(p('1월 3일')).toBe('2027-01-03');
    expect(p('9월 20일')).toBe('2026-09-20');
  });
});

describe('상대 표기', () => {
  it('오늘 · 내일 · 모레 · 어제 · 그 밖은 월일(요일), 다른 해는 연도까지', () => {
    expect(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-04', '2026-10-09', '2027-01-03'].map((d) => dateLabel(d, NOW))).toEqual(
      ['오늘', '내일', '모레', '어제', '10월 9일 (금)', '2027년 1월 3일 (일)']);
    expect(['2026-10-01', '2026-10-05', '2026-12-01'].map((d) => dateTense(d, NOW))).toEqual(['past', 'today', 'future']);
  });
});

describe('문서 노드', () => {
  const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '마감 ' }, { type: 'date_mention', attrs: { date: '2026-10-09' } }, { type: 'text', text: ' 까지' }] }] };
  it('스키마로 유효 · 글자로는 날짜 · Markdown에도 날짜', () => {
    expect(pmCodec.validate(doc as never)).toBeNull();
    expect(textLines(doc as never)).toEqual(['마감 2026-10-09 까지']);
    expect(docToMarkdown(doc as never).trim()).toBe('마감 2026-10-09 까지');
  });
});
