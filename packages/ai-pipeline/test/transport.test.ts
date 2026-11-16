// transport 두 가지 — 네트워크 없이 가짜 fetch로.
//  (a) Edge 프록시 SSE (API 3.2)  (b) 브라우저 직접 호출(BYOK) — 실제 SDK에 가짜 fetch를 꽂아 스트리밍 · 헤더 · 오류 변환까지.
import { describe, expect, it } from 'vitest';
import {
  createEdgeTransport, readSse, structureText, type StructureChunkRequest,
} from '../src';
import { createDirectTransport, testApiKey } from '../src/direct';
import { sample, sampleSource } from './fixtures';

const enc = new TextEncoder();
function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({ start(c) { for (const s of chunks) c.enqueue(enc.encode(s)); c.close(); } });
}
const sse = (events: [string, unknown][]) => events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`);

const req: StructureChunkRequest = {
  runId: '4Qk2t8xP0aZmN3bV7cR1sY', chunk: { index: 0, count: 1 }, text: sampleSource, locale: 'ko',
  options: { kinds: ['relation', 'chart', 'table'], model: 'claude-sonnet-5-5', promptVersion: 'structure.v1' },
};

describe('readSse', () => {
  it('조각난 바이트 · CRLF · 주석 · 여러 줄 data', async () => {
    const out = [];
    for await (const e of readSse(streamOf([': ping\r\n', 'event: a\r\nda', 'ta: 1\r\ndata: 2\r\n\r\n', 'data: x\n\n']))) out.push(e);
    expect(out).toEqual([{ event: 'a', data: '1\n2' }, { event: 'message', data: 'x' }]);
  });
});

describe('Edge 프록시 transport (계정 모드)', () => {
  it('요청 헤더 · 본문, progress → onStage, result 반환', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fetchFn = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(streamOf(sse([
        ['progress', { stage: 'thinking', pct: 10 }], ['progress', { stage: 'emitting', pct: 60 }],
        ['result', { runId: req.runId, chunk: 0, structure: sample, usage: { input: 5321, output: 1840, cacheRead: 4100 }, model: 'claude-sonnet-5-5', promptVersion: 'structure.v1' }],
        ['done', {}],
      ])), { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }) as unknown as typeof fetch;
    const t = createEdgeTransport({ baseUrl: 'https://api.example.test/v1/', getToken: async () => 'jwt', clientVersion: '0.3.0', deviceId: 'dev-1', idempotencyKey: () => 'K'.repeat(22), fetch: fetchFn });
    const stages: unknown[] = [];
    const r = await t.structureChunk(req, { signal: new AbortController().signal, onStage: (s, p) => stages.push([s, p]) });
    expect(r.structure).toEqual(sample);
    expect(stages).toEqual([['thinking', 10], ['emitting', 60]]);
    expect(seen!.url).toBe('https://api.example.test/v1/ai/structure');
    const h = seen!.init.headers as Record<string, string>;
    expect(h.authorization).toBe('Bearer jwt');
    expect(h['x-dn-client']).toBe('0.3.0');
    expect(h['x-dn-device']).toBe('dev-1');
    expect(h['idempotency-key']).toBe('K'.repeat(22));
    expect(JSON.parse(seen!.init.body as string)).toEqual(req);
    // 키는 어디에도 없다 (FR-104)
    expect(JSON.stringify(seen!.init)).not.toContain('sk-ant');
  });

  it('Problem Details → AiError 코드 · retryAfter · requestId', async () => {
    const fetchFn = (async () => new Response(JSON.stringify({ code: 'rate-limited', status: 429, detail: '분당 한도', retryAfter: 30, requestId: 'req1' }), { status: 429 })) as unknown as typeof fetch;
    const t = createEdgeTransport({ baseUrl: 'https://x/v1', getToken: async () => 't', clientVersion: '1', fetch: fetchFn });
    await expect(t.structureChunk(req, { signal: new AbortController().signal })).rejects.toMatchObject({ code: 'rate-limited', retryAfter: 30, requestId: 'req1', status: 429 });
  });

  it('401 token-expired → 토큰 갱신 후 1회 재요청', async () => {
    const refresh: boolean[] = [];
    let n = 0;
    const fetchFn = (async () => (n++ === 0
      ? new Response(JSON.stringify({ code: 'token-expired' }), { status: 401 })
      : new Response(streamOf(sse([['result', { runId: 'r', chunk: 0, structure: sample, usage: { input: 1, output: 1 }, model: 'm', promptVersion: 'structure.v1' }]]))))) as unknown as typeof fetch;
    const t = createEdgeTransport({ baseUrl: 'https://x/v1', getToken: async ({ refresh: r }) => { refresh.push(r); return 't'; }, clientVersion: '1', fetch: fetchFn });
    await t.structureChunk(req, { signal: new AbortController().signal });
    expect(refresh).toEqual([false, true]);
  });

  it('SSE error 이벤트 · result 없는 종료 · fetch 실패', async () => {
    const mk = (body: string[] | Error) => createEdgeTransport({
      baseUrl: 'https://x/v1', getToken: async () => 't', clientVersion: '1',
      fetch: (async () => { if (body instanceof Error) throw body; return new Response(streamOf(body)); }) as unknown as typeof fetch,
    });
    const s = new AbortController().signal;
    await expect(mk(sse([['error', { code: 'invalid-api-key', status: 422 }]])).structureChunk(req, { signal: s })).rejects.toMatchObject({ code: 'invalid-api-key' });
    await expect(mk(sse([['progress', { stage: 'thinking' }]])).structureChunk(req, { signal: s })).rejects.toMatchObject({ code: 'upstream-error' });
    await expect(mk(new TypeError('Failed to fetch')).structureChunk(req, { signal: s })).rejects.toMatchObject({ code: 'network' });
  });
});

// ───────── 직접 호출 (BYOK) — 실제 SDK + 가짜 fetch ─────────

function messagesStream(input: unknown): string[] {
  const json = JSON.stringify(input);
  return sse([
    ['message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 900, output_tokens: 1, cache_read_input_tokens: 700, cache_creation_input_tokens: 0 } } }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig' } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['content_block_start', { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_1', name: 'emit_structure', input: {} } }],
    ['content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: json.slice(0, 40) } }],
    ['content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: json.slice(40) } }],
    ['content_block_stop', { type: 'content_block_stop', index: 1 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 321 } }],
    ['message_stop', { type: 'message_stop' }],
  ]);
}

function fakeAnthropic(handler: (url: string, init: RequestInit, n: number) => Response) {
  const calls: { url: string; headers: Headers; body: Record<string, unknown> | null }[] = [];
  const fetchFn = (async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), headers: new Headers(init.headers), body: init.body ? JSON.parse(String(init.body)) : null });
    return handler(String(url), init, calls.length - 1);
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

describe('직접 호출 transport (로컬 전용 모드, BYOK)', () => {
  it('브라우저 직접 호출 헤더 · 스트리밍 요청 · 결과 조립', async () => {
    const { fetchFn, calls } = fakeAnthropic(() => new Response(streamOf(messagesStream(sample)), { headers: { 'content-type': 'text/event-stream' } }));
    const t = createDirectTransport({ apiKey: 'sk-ant-test-key', fetch: fetchFn });
    const stages: string[] = [];
    const r = await t.structureChunk(req, { signal: new AbortController().signal, onStage: (s) => stages.push(s) });
    expect(r.structure).toEqual(sample);
    expect(r.usage).toEqual({ input: 900, output: 321, cacheRead: 700, cacheWrite: 0 });
    expect(stages).toEqual(['thinking', 'emitting']);
    const c = calls[0]!;
    expect(c.url).toBe('https://api.anthropic.com/v1/messages');
    expect(c.headers.get('anthropic-dangerous-direct-browser-access')).toBe('true');
    expect(c.headers.get('x-api-key')).toBe('sk-ant-test-key');
    expect(c.headers.get('anthropic-version')).toBeTruthy();
    expect(c.body).toMatchObject({ model: 'claude-sonnet-5-5', max_tokens: 16000, stream: true, thinking: { type: 'adaptive' }, tool_choice: { type: 'auto', disable_parallel_tool_use: true } });
    expect(c.body).not.toHaveProperty('temperature');
  });

  it('401 → invalid-api-key (재시도 없음), 529 → upstream-overloaded 백오프 후 성공', async () => {
    const bad = fakeAnthropic(() => new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }), { status: 401, headers: { 'content-type': 'application/json' } }));
    await expect(structureText({ text: sampleSource }, { transport: createDirectTransport({ apiKey: 'k', fetch: bad.fetchFn }), retryBaseMs: 1 }))
      .rejects.toMatchObject({ code: 'invalid-api-key', status: 401 });
    expect(bad.calls).toHaveLength(1);

    const flaky = fakeAnthropic((_u, _i, n) => (n === 0
      ? new Response(JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }), { status: 529, headers: { 'content-type': 'application/json' } })
      : new Response(streamOf(messagesStream(sample)), { headers: { 'content-type': 'text/event-stream' } })));
    const retries: string[] = [];
    const plan = await structureText({ text: sampleSource }, {
      transport: createDirectTransport({ apiKey: 'k', fetch: flaky.fetchFn }), retryBaseMs: 1,
      onProgress: (p) => { if (p.retry) retries.push(p.retry.code); },
    });
    expect(retries).toEqual(['upstream-overloaded']);
    expect(flaky.calls).toHaveLength(2); // SDK 자체 재시도는 끔 (maxRetries 0)
    expect(plan.nodes).toHaveLength(3);
  });

  it('429 Retry-After 헤더를 읽는다', async () => {
    const { fetchFn } = fakeAnthropic(() => new Response(JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'x' } }), { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '120' } }));
    await expect(createDirectTransport({ apiKey: 'k', fetch: fetchFn }).structureChunk(req, { signal: new AbortController().signal }))
      .rejects.toMatchObject({ code: 'rate-limited', retryAfter: 120 });
  });

  it('키 유효성 검사 (FR-139)', async () => {
    const ok = fakeAnthropic(() => new Response(JSON.stringify({ id: 'claude-sonnet-5-5', type: 'model', display_name: 'x', created_at: '2026-01-01T00:00:00Z' }), { headers: { 'content-type': 'application/json' } }));
    expect(await testApiKey({ apiKey: 'k', fetch: ok.fetchFn })).toBeNull();
    expect(ok.calls[0]!.url).toContain('/v1/models/claude-sonnet-5-5');
    const bad = fakeAnthropic(() => new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'x' } }), { status: 401, headers: { 'content-type': 'application/json' } }));
    expect((await testApiKey({ apiKey: 'k', fetch: bad.fetchFn }))?.code).toBe('invalid-api-key');
  });
});
