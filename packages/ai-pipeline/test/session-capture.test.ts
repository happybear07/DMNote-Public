// Claude 세션 평가 1단계 (API 키 없이 실제 모델 동작 시험): 평가 케이스마다 앱이 실제로 보낼 요청(시스템 프롬프트 · 사용자 메시지 · 도구)을
// 그대로 뽑아 eval/session/requests/<id>.json에 쓴다. 이 요청을 Claude 세션(워크플로 에이전트)이 모델 역할로 받아 답하고,
// 그 답을 session-score.test.ts가 실제 파이프라인에 다시 흘려 채점한다. 평소에는 건너뛴다: DN_SESSION_CAPTURE=1 일 때만.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { structureText, type ClaudeCall } from '../src';
import { createDirectTransport } from '../src/direct';
import { loadEvalCases, ROOT } from './fixtures';

const ON = process.env.DN_SESSION_CAPTURE === '1';
const OUT = join(ROOT, 'eval', 'session', 'requests');

class Captured extends Error {}

describe.skipIf(!ON)('Claude 세션 평가: 요청 뽑기', () => {
  it('케이스마다 첫 청크 요청을 파일로', async () => {
    mkdirSync(OUT, { recursive: true });
    for (const c of loadEvalCases()) {
      let params: Anthropic.MessageCreateParamsNonStreaming | null = null;
      const call: ClaudeCall = async (p) => { params = p; throw new Captured(); };
      await structureText({ text: c.source, kinds: c.expected.kinds, locale: c.expected.lang }, { transport: createDirectTransport({ call }), retryBaseMs: 1 }).catch(() => null);
      if (!params) throw new Error(`${c.id}: 요청을 못 잡음`);
      const p = params as Anthropic.MessageCreateParamsNonStreaming;
      const system = typeof p.system === 'string' ? p.system : (p.system ?? []).map((b) => (b as { text: string }).text).join('\n\n');
      const user = p.messages.map((m) => (typeof m.content === 'string' ? m.content : m.content.map((b) => ('text' in b ? b.text : '')).join('\n'))).join('\n\n');
      writeFileSync(join(OUT, `${c.id}.json`), JSON.stringify({ id: c.id, model: p.model, system, user, tool: p.tools?.[0], schema: (p.tools?.[0] as Anthropic.Tool | undefined)?.input_schema }, null, 2));
    }
  });
});
