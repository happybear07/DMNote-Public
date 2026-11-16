// 손글씨 → 글 (FR-038): 요청 모양(그림 먼저 · 도구 · 시스템 캐시), 결과 검사 · 그림 밖 bbox 버리기, 도구 호출이 없으면 1회 다시, 그래도 없으면 실패
import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { AiError, buildOcrParams, readOcr, runOcr, type ClaudeCall } from '../src';

const msg = (content: unknown[]): Anthropic.Message => ({
  id: 'm', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content, stop_reason: 'tool_use', stop_sequence: null,
  usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
} as unknown as Anthropic.Message);
const tool = (input: unknown) => ({ type: 'tool_use', id: 't', name: 'emit_ocr', input });
const input = { image: 'AAAA', mime: 'image/png' as const, w: 400, h: 200 };

describe('OCR', () => {
  it('요청: 그림 블록 다음 안내 글, emit_ocr 도구 · 병렬 금지 · 시스템 캐시 · 그림 크기', () => {
    const p = buildOcrParams('claude-sonnet-5-5', input);
    const content = (p.messages[0]!.content as { type: string; text?: string }[]);
    expect(content.map((c) => c.type)).toEqual(['image', 'text']);
    expect(content[1]!.text).toContain('400 x 200');
    expect(p.tools?.[0]).toMatchObject({ name: 'emit_ocr', strict: true });
    expect(p.tool_choice).toEqual({ type: 'auto', disable_parallel_tool_use: true });
    expect((p.system as { cache_control?: unknown }[])[0]!.cache_control).toEqual({ type: 'ephemeral' });
  });

  it('결과 검사: 줄 · 신뢰도, 그림 밖 bbox는 bbox만 버림, 형식이 틀리면 null', () => {
    const r = readOcr({ lines: [{ text: '회의 메모', confidence: 0.95, bbox: [0, 0, 100, 30] }, { text: '- 예산 □', confidence: 0.7, bbox: [0, 0, 999, 30] }], overallConfidence: 0.85 }, 400, 200);
    expect(r?.lines).toEqual([{ text: '회의 메모', confidence: 0.95, bbox: [0, 0, 100, 30] }, { text: '- 예산 □', confidence: 0.7 }]);
    expect(readOcr({ lines: 'x', overallConfidence: 1 }, 400, 200)).toBeNull();
    expect(readOcr({ lines: [{ text: 'a', confidence: 2 }], overallConfidence: 0.5 }, 400, 200)).toBeNull();
  });

  it('도구 호출이 없으면 한 번 다시, 두 번째에 받으면 사용량 합산', async () => {
    let n = 0;
    const call: ClaudeCall = async () => (++n === 1 ? msg([{ type: 'text', text: '음…' }]) : msg([tool({ lines: [{ text: '안녕', confidence: 0.9 }], overallConfidence: 0.9 })]));
    const r = await runOcr(call, input, { signal: new AbortController().signal });
    expect(n).toBe(2);
    expect(r.lines[0]!.text).toBe('안녕');
    expect(r.usage.input).toBe(200);
  });

  it('두 번 다 없으면 AiError(invalid-response)', async () => {
    const call: ClaudeCall = async () => msg([{ type: 'text', text: '없음' }]);
    await expect(runOcr(call, input, { signal: new AbortController().signal })).rejects.toBeInstanceOf(AiError);
  });
});
