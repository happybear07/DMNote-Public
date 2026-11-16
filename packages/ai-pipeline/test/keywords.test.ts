// AI 자동 태그 (2026-10-26): structure.v2 keywords — 형식 정리(# 떼기 · 20자 · 8개 · 중복), 원문에 그대로 있는 것만 계획에 남김, v1은 무시
import { describe, expect, it } from 'vitest';
import { checkStructure, structureText, type Structure } from '../src';
import { fakeTransport } from './fixtures';

const TEXT = '결제 연동은 금요일까지 끝낸다. 베타 출시 전에 Stripe 시험을 한다.';
const answer = (keywords: unknown): Structure => ({
  version: 'structure.v2', keywords: keywords as string[],
  nodes: [{ key: 'n1', title: '결제 연동', kind: 'concept' }], edges: [], charts: [], tables: [],
  patterns: [{ key: 'p1', id: 'S-01', pattern: 'chain', primary: true, nodes: ['n1'] }],
});

describe('AI 자동 태그 keywords', () => {
  it('형식 정리: # 떼기 · 앞뒤 공백 · 20자 넘는 것 · 문자열 아닌 것 · 중복 빼기', () => {
    const r = checkStructure(answer(['#결제', ' 베타 ', '아주아주아주아주아주아주긴키워드입니다아아', 3, '결제']));
    expect(r.ok && r.value.keywords).toEqual(['결제', '베타']);
  });

  it('계획에는 원문에 그대로 있는 키워드만 (대소문자 무시), 최대 8개', async () => {
    const plan = await structureText({ text: TEXT }, { transport: fakeTransport(() => answer(['결제', 'stripe', '환불', '베타 출시'])) });
    expect(plan.keywords).toEqual(['결제', 'stripe', '베타 출시']);
  });

  it('키워드가 없으면 계획에도 없음 · v1 응답의 keywords는 정의되지 않은 속성', async () => {
    const plan = await structureText({ text: TEXT }, { transport: fakeTransport(() => ({ ...answer([]), keywords: undefined })) });
    expect(plan.keywords).toBeUndefined();
    const v1 = checkStructure({ version: 'structure.v1', nodes: [], edges: [], charts: [], tables: [], keywords: ['결제'] });
    expect(v1.ok).toBe(false);
  });
});
