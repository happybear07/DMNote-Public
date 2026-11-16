// 내 노트에 질문하기 (FR-116~117): 근거 조각 → document(citations), 이력 6턴 · 캐시, 인용 → ref, 근거 판정, 조각이 없으면 부르지 않음
import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { buildQaParams, QA_NOT_FOUND, readQa, runQa, type ClaudeCall, type QaPassage } from '../src';

const P: QaPassage[] = [
  { ref: 'n1#b1', noteTitle: '회의록', text: '예산은 300만 원으로 정했다.', updatedAt: Date.UTC(2026, 9, 1) },
  { ref: 'n2#b9', noteTitle: '일정', text: '출시는 10월 31일.', updatedAt: Date.UTC(2026, 9, 2) },
];
const msg = (content: unknown[]): Anthropic.Message => ({ id: 'm', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content, stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 500, output_tokens: 40 } } as unknown as Anthropic.Message);

describe('Q&A', () => {
  it('요청: 근거마다 document(제목 · ref · 인용 켬) 다음 질문 글, 이력 6턴 · 마지막에 캐시', () => {
    const history = Array.from({ length: 8 }, (_, i) => ({ question: `질문${i}`, answer: `답${i}` }));
    const p = buildQaParams('claude-sonnet-5-5', { question: '예산은?', passages: P, scope: '전체 노트', history, today: '2026-10-06 (화)' }, 'NONCE123');
    expect(p.messages).toHaveLength(13);
    expect(p.messages[0]!.content).toBe('질문2');
    expect((p.messages[11]!.content as { cache_control?: unknown }[])[0]!.cache_control).toEqual({ type: 'ephemeral' });
    const last = p.messages[12]!.content as { type: string; title?: string; context?: string; citations?: unknown; text?: string }[];
    expect(last.map((c) => c.type)).toEqual(['document', 'document', 'text']);
    expect(last[0]).toMatchObject({ title: '회의록', citations: { enabled: true } });
    expect(last[0]!.context).toContain('ref: n1#b1');
    expect(last[2]!.text).toContain('<dn_question_NONCE123>\n예산은?');
    expect(last[2]!.text).toContain('2026-10-06 (화)');
  });

  it('응답: 인용 → 노트#블록 · 근거 있음, "찾지 못했습니다"로 시작하면 근거 없음', () => {
    const r = readQa(msg([
      { type: 'text', text: '예산은 300만 원입니다.', citations: [{ type: 'char_location', document_index: 0, cited_text: '예산은 300만 원으로 정했다.' }] },
    ]), P);
    expect(r.grounded).toBe(true);
    expect(r.segments[0]!.cites).toEqual([{ ref: 'n1#b1', noteTitle: '회의록', quote: '예산은 300만 원으로 정했다.' }]);
    expect(readQa(msg([{ type: 'text', text: QA_NOT_FOUND }]), P).grounded).toBe(false);
    expect(readQa(msg([{ type: 'text', text: '아마 300만 원' }]), P).grounded).toBe(false); // 인용 없음
  });

  it('근거 조각이 없으면 Claude를 부르지 않고 "노트에서 답을 찾지 못했습니다."', async () => {
    let called = false;
    const call: ClaudeCall = async () => { called = true; return msg([]); };
    const r = await runQa(call, { question: '?', passages: [], scope: '전체 노트' }, { signal: new AbortController().signal });
    expect(called).toBe(false);
    expect(r.segments[0]!.text).toBe(QA_NOT_FOUND);
  });
});
