// 질문 → 근거 조각: 조사를 뗀 낱말로 찾고(OR), 많이 걸린 블록부터, 노트당 4개까지, 걸린 게 없으면 빈 목록
import { describe, expect, it } from 'vitest';
import { questionTerms, retrievePassages } from '../src';

const src = (id: string, title: string, texts: string[], updatedAt = 1) => ({ note: { id, title, updatedAt }, blocks: texts.map((t, i) => ({ id: `${id}-b${i}`, text: t, low: t.toLowerCase() })) });

describe('질문 근거 찾기', () => {
  it('조사 · 어미를 떼고 의문사는 뺀다', () => {
    expect(questionTerms('지난주 회의에서 정한 예산은 얼마였나요?')).toEqual(['지난주', '회의', '정한', '예산', '얼마']);
    expect(questionTerms('What is the API limit?')).toEqual(['api', 'limit']);
  });

  it('많이 걸린 블록부터 · 노트당 4개 · 없으면 빈 목록', () => {
    const r = retrievePassages('회의에서 정한 예산은?', [
      src('a', '회의록', ['예산은 300만 원으로 정했다', '점심 메뉴', '회의 시간은 2시']),
      src('b', '가계부', ['이번 달 예산 초과']),
    ]);
    expect(r.map((p) => p.blockId)).toEqual(['a-b0', 'a-b2', 'b-b0']); // '점심 메뉴'는 제목에만 걸려 빠진다
    expect(r[0]!.ref).toBe('a#a-b0');
    expect(retrievePassages('전혀 없는 낱말', [src('a', 'x', ['글'])])).toEqual([]);
    const many = retrievePassages('예산', [src('c', 'c', Array.from({ length: 9 }, () => '예산'))]);
    expect(many).toHaveLength(4);
  });
});
