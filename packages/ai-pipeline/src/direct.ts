// 로컬 전용 모드: 브라우저에서 Anthropic API 직접 호출 (BYOK, A2 · ADR-0007 · SECURITY 4절).
// 별도 진입점(`@dn/ai-pipeline/direct`)으로 둔 이유: 계정 모드 번들에 SDK가 들어가지 않게 — 앱은 로컬 모드에서만 동적 import 한다.
// Edge Worker도 같은 `sdkClaudeCall`을 쓸 수 있다(Workers 런타임은 fetch 기반이라 SDK가 그대로 돈다).
import Anthropic from '@anthropic-ai/sdk';
import { AiError, codeFromStatus } from './errors';
import { runStructureChunk, type ClaudeCall } from './request';
import { runEdit, type EditInput, type EditResult, type EditRunOptions } from './edit';
import { runOcr, type OcrInput, type OcrResult } from './ocr';
import { runQa, type QaAnswer, type QaInput } from './qa';
import { retryAfterSeconds, type StructureTransport } from './transport';

export interface DirectTransportOptions {
  apiKey: string;
  /** 테스트 · 프록시 실험용. 기본 https://api.anthropic.com */
  baseURL?: string;
  fetch?: typeof fetch;
}

/**
 * SDK 오류 → AiError. 타입별 클래스로 가른다(문자열 매칭 금지).
 * 401/403 → invalid-api-key (MESSAGES 부록 B "Anthropic 직접 호출"), 429 · 5xx · 529는 재시도 대상 코드로.
 */
export function mapSdkError(e: unknown, signal?: AbortSignal): AiError {
  if (e instanceof AiError) return e;
  if (e instanceof Anthropic.APIUserAbortError || signal?.aborted) return new AiError('aborted', { cause: e });
  if (e instanceof Anthropic.APIConnectionTimeoutError) return new AiError('upstream-timeout', { cause: e });
  if (e instanceof Anthropic.APIConnectionError) return new AiError('network', { detail: e.message, cause: e });
  if (e instanceof Anthropic.APIError && typeof e.status === 'number') {
    return new AiError(codeFromStatus(e.status, 'anthropic'), {
      status: e.status,
      retryAfter: retryAfterSeconds(e.headers?.get('retry-after')),
      requestId: e.requestID ?? undefined,
      detail: e.message,
      cause: e,
    });
  }
  return new AiError('upstream-error', { detail: e instanceof Error ? e.message : String(e), cause: e });
}

/** SDK 클라이언트로 만든 ClaudeCall — 스트리밍으로 받아(긴 max_tokens에서 HTTP 타임아웃 방지) 완성된 Message를 돌려준다. */
export function sdkClaudeCall(client: Anthropic): ClaudeCall {
  return async (params, { signal, onStage, onText }) => {
    try {
      const stream = client.messages.stream(params, { signal });
      stream.on('streamEvent', (ev) => {
        if (ev.type !== 'content_block_start') return;
        if (ev.content_block.type === 'thinking' || ev.content_block.type === 'redacted_thinking') onStage?.('thinking');
        else if (ev.content_block.type === 'tool_use') onStage?.('emitting');
      });
      if (onText) stream.on('text', (_delta, snapshot) => onText(snapshot));
      return await stream.finalMessage();
    } catch (e) {
      throw mapSdkError(e, signal);
    }
  };
}

/**
 * 직접 호출 클라이언트. `dangerouslyAllowBrowser: true`면 SDK가 브라우저 CORS 허용 헤더
 * `anthropic-dangerous-direct-browser-access: true`를 붙인다(SECURITY 4절 표와 같은 헤더).
 * 재시도는 SDK가 아니라 파이프라인이 한다(maxRetries 0) — "다시 시도하는 중이에요({k}/3)" 진행 표시를 내려고.
 */
export function createAnthropicClient(o: DirectTransportOptions): Anthropic {
  return new Anthropic({
    apiKey: o.apiKey,
    dangerouslyAllowBrowser: true,
    maxRetries: 0,
    ...(o.baseURL ? { baseURL: o.baseURL } : {}),
    ...(o.fetch ? { fetch: o.fetch } : {}),
  });
}

/** 로컬 전용 모드 transport: Worker가 하던 일(요청 조립 · 교정 재요청)을 브라우저가 같은 코드로 한다 (AI-PROMPTS 4절). */
export function createDirectTransport(o: DirectTransportOptions | { call: ClaudeCall }): StructureTransport {
  const call = 'call' in o ? o.call : sdkClaudeCall(createAnthropicClient(o));
  return {
    kind: 'direct',
    structureChunk: (req, ev) => runStructureChunk(call, req, { signal: ev.signal, onStage: ev.onStage }),
  };
}

/**
 * 키 유효성 검사 (FR-139 "테스트 호출"). 토큰을 쓰지 않는 Models API로 확인한다.
 * 성공이면 null, 실패면 AiError (401/403 → invalid-api-key).
 */
export async function testApiKey(o: DirectTransportOptions, signal?: AbortSignal): Promise<AiError | null> {
  try {
    await createAnthropicClient(o).models.retrieve('claude-sonnet-5-5', {}, { signal });
    return null;
  } catch (e) {
    return mapSdkError(e, signal);
  }
}

/** 손글씨 → 글 (FR-038) 직접 호출 — 로컬 전용 모드 */
export function createDirectOcr(o: DirectTransportOptions | { call: ClaudeCall }): (input: OcrInput, opts: { signal: AbortSignal; model?: string }) => Promise<OcrResult> {
  const call = 'call' in o ? o.call : sdkClaudeCall(createAnthropicClient(o));
  return (input, opts) => runOcr(call, input, opts);
}

/** 고른 글 AI 편집 (FR-112) 직접 호출 — 로컬 전용 모드. onText로 미리보기에 글이 흘러나온다 */
export function createDirectEdit(o: DirectTransportOptions | { call: ClaudeCall }): (input: EditInput, opts: EditRunOptions) => Promise<EditResult> {
  const call = 'call' in o ? o.call : sdkClaudeCall(createAnthropicClient(o));
  return (input, opts) => runEdit(call, input, opts);
}

/** 내 노트에 질문하기 (FR-116) 직접 호출 — 로컬 전용 모드 */
export function createDirectQa(o: DirectTransportOptions | { call: ClaudeCall }): (input: QaInput, opts: { signal: AbortSignal; model?: string }) => Promise<QaAnswer> {
  const call = 'call' in o ? o.call : sdkClaudeCall(createAnthropicClient(o));
  return (input, opts) => runQa(call, input, opts);
}
