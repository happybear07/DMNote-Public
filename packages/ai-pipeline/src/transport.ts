// 전송 계층 경계 (FR-104 · FR-139, ADR-0007). 파이프라인은 어느 경로로 Claude에 닿는지 모른다:
//   (a) Edge 프록시 — 계정 모드. 키는 서버(Vault)에만, 교정 재요청도 Worker가 같은 SSE 안에서 한다(API 3.2).
//   (b) 브라우저 직접 호출(BYOK) — 로컬 전용 모드. `@dn/ai-pipeline/direct`의 createDirectTransport.
import { AiError, codeFromStatus, type AiErrorCode } from './errors';
import type { ChunkStage, StructureChunkRequest, StructureChunkResult } from './request';

export type TransportStage = ChunkStage | 'queued' | (string & {});

export interface StructureTransport {
  readonly kind: 'edge' | 'direct' | (string & {});
  structureChunk(
    req: StructureChunkRequest,
    ev: { signal: AbortSignal; onStage?(stage: TransportStage, pct?: number): void },
  ): Promise<StructureChunkResult>;
}

export interface EdgeTransportOptions {
  /** `https://api.<도메인>/v1` (API 1.1 Base URL, `/v1` 포함) */
  baseUrl: string;
  /** Supabase access token. `refresh: true`면 갱신해서 (401 token-expired 후 1회, API 1.2) */
  getToken(opts: { refresh: boolean }): Promise<string>;
  /** X-DN-Client (클라이언트 semver) */
  clientVersion: string;
  /** X-DN-Device (로그인 후) */
  deviceId?: string;
  /** Idempotency-Key 생성기 (22자 id). 같은 청크의 재시도에는 같은 키를 쓴다 */
  idempotencyKey?(req: StructureChunkRequest): string;
  fetch?: typeof fetch;
}

const KNOWN_CODES = new Set<AiErrorCode>([
  'invalid-request', 'token-expired', 'unauthenticated', 'forbidden', 'payload-too-large', 'no-api-key', 'invalid-api-key',
  'ai-refused', 'client-outdated', 'in-progress', 'rate-limited', 'upstream-error', 'upstream-overloaded', 'upstream-timeout',
]);

interface Problem { code?: string; status?: number; detail?: string; retryAfter?: number; requestId?: string }

export function problemToError(p: Problem, status: number, headers?: Headers): AiError {
  const code = p.code && KNOWN_CODES.has(p.code as AiErrorCode) ? (p.code as AiErrorCode) : codeFromStatus(status, 'edge');
  const ra = p.retryAfter ?? retryAfterSeconds(headers?.get('retry-after'));
  return new AiError(code, {
    status, retryAfter: ra, detail: p.detail,
    requestId: p.requestId ?? headers?.get('x-request-id') ?? undefined,
  });
}

/** Retry-After: 초 또는 HTTP 날짜 */
export function retryAfterSeconds(v: string | null | undefined): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  if (Number.isFinite(n)) return Math.max(0, n);
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.max(0, Math.ceil((t - Date.now()) / 1000)) : undefined;
}

export interface SseEvent { event: string; data: string }

/** text/event-stream 파서 (WHATWG 규칙 중 event · data · 빈 줄 구분만) */
export async function* readSse(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let event = 'message', data: string[] = [];
  const onAbort = () => { reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (value) buf += dec.decode(value, { stream: true });
      if (done) buf += dec.decode() + '\n\n';
      let i: number;
      while ((i = buf.search(/\r\n|\r|\n/)) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(buf[i] === '\r' && buf[i + 1] === '\n' ? i + 2 : i + 1);
        if (line === '') {
          if (data.length) yield { event, data: data.join('\n') };
          event = 'message'; data = [];
        } else if (!line.startsWith(':')) {
          const c = line.indexOf(':');
          const field = c < 0 ? line : line.slice(0, c);
          const val = c < 0 ? '' : line.slice(c + 1).replace(/^ /, '');
          if (field === 'event') event = val;
          else if (field === 'data') data.push(val);
        }
      }
      if (done) return;
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}

/** Edge 프록시 경유 (계정 모드, POST /v1/ai/structure SSE). */
export function createEdgeTransport(o: EdgeTransportOptions): StructureTransport {
  const f = o.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const url = o.baseUrl.replace(/\/+$/, '') + '/ai/structure';

  async function post(req: StructureChunkRequest, signal: AbortSignal, refresh: boolean): Promise<Response> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      authorization: `Bearer ${await o.getToken({ refresh })}`,
      'x-dn-client': o.clientVersion,
    };
    if (o.deviceId) headers['x-dn-device'] = o.deviceId;
    if (o.idempotencyKey) headers['idempotency-key'] = o.idempotencyKey(req);
    try {
      return await f(url, { method: 'POST', headers, body: JSON.stringify(req), signal });
    } catch (e) {
      if (signal.aborted) throw new AiError('aborted', { cause: e });
      throw new AiError('network', { detail: e instanceof Error ? e.message : String(e), cause: e });
    }
  }

  return {
    kind: 'edge',
    async structureChunk(req, ev) {
      const toError = async (r: Response) => problemToError(await r.json().catch(() => ({})) as Problem, r.status, r.headers);
      let res = await post(req, ev.signal, false);
      if (!res.ok) {
        const err = await toError(res);
        if (err.code !== 'token-expired') throw err;
        res = await post(req, ev.signal, true); // refresh 후 1회 (API 1.2)
        if (!res.ok) throw await toError(res);
      }
      if (!res.body) throw new AiError('upstream-error', { detail: '응답 본문 없음' });
      let result: StructureChunkResult | null = null;
      try {
        for await (const e of readSse(res.body, ev.signal)) {
          const data = e.data ? JSON.parse(e.data) : {};
          if (e.event === 'progress') ev.onStage?.(data.stage, data.pct);
          else if (e.event === 'result') result = data as StructureChunkResult;
          else if (e.event === 'error') throw problemToError(data as Problem, (data as Problem).status ?? 502);
          else if (e.event === 'done') break;
        }
      } catch (e) {
        if (ev.signal.aborted) throw new AiError('aborted', { cause: e });
        if (e instanceof AiError) throw e;
        if (e instanceof SyntaxError) throw new AiError('upstream-error', { detail: 'SSE 데이터가 JSON이 아님', cause: e });
        throw new AiError('network', { detail: e instanceof Error ? e.message : String(e), cause: e });
      }
      if (!result) throw new AiError('upstream-error', { detail: 'result 이벤트 없이 스트림이 끝남' });
      return result;
    },
  };
}
