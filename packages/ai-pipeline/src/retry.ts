// 재시도 · 타임아웃 · 취소 (FR-102 · FR-103). setTimeout · AbortController만 쓴다 — 브라우저 · Node 18+ · Worker 공통.
import { AiError, isRetryable } from './errors';

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AiError('aborted');
}

/** 취소 가능한 대기 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AiError('aborted'));
    const t = setTimeout(() => { signal?.removeEventListener('abort', on); resolve(); }, ms);
    const on = () => { clearTimeout(t); reject(new AiError('aborted')); };
    signal?.addEventListener('abort', on, { once: true });
  });
}

/**
 * 타임아웃 + 바깥 취소를 하나의 신호로 묶어 `fn`에 넘긴다. 시간이 지나면 업스트림을 끊고 `upstream-timeout`.
 * 바깥(사용자) 취소면 `aborted`. `fn`이 신호를 무시해도 결과를 기다리지 않는다.
 */
export async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, ms: number, outer?: AbortSignal): Promise<T> {
  throwIfAborted(outer);
  const ctl = new AbortController();
  let timedOut = false;
  const onOuter = () => ctl.abort();
  outer?.addEventListener('abort', onOuter, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { timedOut = true; ctl.abort(); reject(new AiError('upstream-timeout', { detail: `${ms}ms 초과` })); }, ms);
    ctl.signal.addEventListener('abort', () => { if (!timedOut) reject(new AiError('aborted')); }, { once: true });
  });
  try {
    return await Promise.race([fn(ctl.signal), guard]);
  } catch (e) {
    if (timedOut) throw new AiError('upstream-timeout', { detail: `${ms}ms 초과`, cause: e });
    if (outer?.aborted) throw new AiError('aborted');
    throw e;
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', onOuter);
    guard.catch(() => {}); // 경주에서 진 쪽의 거부가 처리되지 않은 거부로 남지 않게
  }
}

export interface RetryOptions {
  /** 첫 시도 뒤 재시도 횟수 (기본 3 — ARCHITECTURE 7.3) */
  retries?: number;
  /** 지수 백오프 기준 (기본 1초 → 1 · 2 · 4초) */
  baseMs?: number;
  signal?: AbortSignal;
  /** 재시도 직전 — MSG-AI-022 "다시 시도하는 중이에요({k}/3)" */
  onRetry?(info: { attempt: number; of: number; delayMs: number; error: AiError }): void;
  /** 0~1 난수 (테스트 고정용) */
  random?: () => number;
}

export async function withRetry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const retries = opts.retries ?? 3, base = opts.baseMs ?? 1000, maxWait = 60_000; // Retry-After가 이보다 길면 기다리지 않고 바로 실패 (일일 한도 등)
  const rnd = opts.random ?? Math.random;
  for (let attempt = 0; ; attempt++) {
    throwIfAborted(opts.signal);
    try {
      return await fn(attempt);
    } catch (e) {
      if (!isRetryable(e) || attempt >= retries) throw e;
      const err = e as AiError;
      // 지수 백오프 + 전체 지터 절반 — 여러 탭 · 청크가 같은 순간에 다시 몰리지 않게
      const backoff = base * 2 ** attempt * (0.5 + rnd() / 2);
      const delayMs = err.retryAfter !== undefined ? Math.max(err.retryAfter * 1000, backoff) : backoff;
      if (delayMs > maxWait) throw e;
      opts.onRetry?.({ attempt: attempt + 1, of: retries, delayMs, error: err });
      await sleep(delayMs, opts.signal);
    }
  }
}
