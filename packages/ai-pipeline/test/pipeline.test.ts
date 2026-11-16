// 재시도 · 타임아웃 · 취소(가짜 타이머) · 진행 이벤트 · 청크 병합 · 부분 실패.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AiError, CHUNK_TIMEOUT_MS, structureText, withRetry, withTimeout,
  type PipelineProgress, type StructureTransport, type StructureV1,
} from '../src';
import { fakeTransport, sample, sampleSource } from './fixtures';

describe('withRetry · withTimeout (FR-102)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('429 · 5xx · 529 · 네트워크는 지수 백오프로 최대 3회, 성공하면 결과', async () => {
    const errs = [new AiError('upstream-overloaded'), new AiError('network'), new AiError('upstream-error')];
    const seen: { attempt: number; delayMs: number }[] = [];
    let calls = 0;
    const p = withRetry(async () => { calls++; const e = errs.shift(); if (e) throw e; return 'ok'; }, {
      random: () => 1, onRetry: (r) => seen.push({ attempt: r.attempt, delayMs: r.delayMs }),
    });
    await vi.advanceTimersByTimeAsync(1000 + 2000 + 4000);
    await expect(p).resolves.toBe('ok');
    expect(calls).toBe(4);
    expect(seen).toEqual([{ attempt: 1, delayMs: 1000 }, { attempt: 2, delayMs: 2000 }, { attempt: 3, delayMs: 4000 }]);
  });

  it('3회 재시도 후에도 실패하면 마지막 오류', async () => {
    let calls = 0;
    const p = withRetry(async () => { calls++; throw new AiError('upstream-error'); }, { random: () => 1 });
    const done = expect(p).rejects.toMatchObject({ code: 'upstream-error' });
    await vi.advanceTimersByTimeAsync(10_000);
    await done;
    expect(calls).toBe(4);
  });

  it('인증 · 키 · 거절 · 타임아웃은 재시도하지 않는다', async () => {
    for (const code of ['invalid-api-key', 'ai-refused', 'upstream-timeout', 'invalid-request'] as const) {
      let calls = 0;
      await expect(withRetry(async () => { calls++; throw new AiError(code); })).rejects.toMatchObject({ code });
      expect(calls).toBe(1);
    }
  });

  it('Retry-After를 따르고, 너무 길면(일일 한도) 기다리지 않는다', async () => {
    let calls = 0;
    const p = withRetry(async () => { calls++; if (calls === 1) throw new AiError('rate-limited', { retryAfter: 5 }); return 1; }, { random: () => 0 });
    await vi.advanceTimersByTimeAsync(4999);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(p).resolves.toBe(1);
    await expect(withRetry(async () => { throw new AiError('rate-limited', { retryAfter: 3600 }); })).rejects.toMatchObject({ retryAfter: 3600 });
  });

  it('타임아웃: 업스트림 신호를 끊고 upstream-timeout', async () => {
    let upstream: AbortSignal | undefined;
    const p = withTimeout((s) => { upstream = s; return new Promise(() => {}); }, 90_000);
    const done = expect(p).rejects.toMatchObject({ code: 'upstream-timeout' });
    await vi.advanceTimersByTimeAsync(90_000);
    await done;
    expect(upstream!.aborted).toBe(true);
  });

  it('바깥 취소: 대기 중인 백오프도 즉시 끝나고 aborted', async () => {
    const ctl = new AbortController();
    const p = withRetry(async () => { throw new AiError('network'); }, { signal: ctl.signal, random: () => 1 });
    const done = expect(p).rejects.toMatchObject({ code: 'aborted' });
    await vi.advanceTimersByTimeAsync(10);
    ctl.abort();
    await done;
  });
});

describe('structureText (FR-101~103)', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('진행 이벤트: 나누기 → 분석(세부 단계) → 검증 → 완료', async () => {
    const ev: PipelineProgress[] = [];
    const plan = await structureText({ text: sampleSource }, { transport: fakeTransport(() => sample, { stages: true }), onProgress: (p) => ev.push(p) });
    expect(ev.map((e) => e.stage)).toEqual(['chunking', 'analyzing', 'analyzing', 'analyzing', 'validating', 'done']);
    expect(ev.filter((e) => e.detail).map((e) => e.detail)).toEqual(['thinking', 'emitting']);
    expect(ev.at(-1)!.pct).toBe(100);
    expect(plan.nodes.map((n) => n.key)).toEqual(['c0:n1', 'c0:n2', 'c0:n3']);
    expect(plan.charts[0]!.attachTo).toBe('c0:n3');
    expect(plan.title).toBe('결론');
    expect(plan.promptVersion).toBe('structure.v2');
  });

  it('재시도 중 진행 이벤트(MSG-AI-022 {k}/3)', async () => {
    vi.useFakeTimers();
    let n = 0;
    const t = fakeTransport(() => { if (n++ < 2) throw new AiError('upstream-overloaded'); return sample; });
    const ev: PipelineProgress[] = [];
    const p = structureText({ text: sampleSource }, { transport: t, onProgress: (e) => ev.push(e) });
    await vi.advanceTimersByTimeAsync(10_000);
    await p;
    expect(ev.filter((e) => e.stage === 'retrying').map((e) => e.retry)).toEqual([
      { attempt: 1, of: 3, code: 'upstream-overloaded' }, { attempt: 2, of: 3, code: 'upstream-overloaded' },
    ]);
  });

  it('청크 타임아웃은 기본 90초, 재시도하지 않는다', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const t: StructureTransport = { kind: 'hang', structureChunk: () => { calls++; return new Promise(() => {}); } };
    const p = structureText({ text: sampleSource }, { transport: t });
    const done = expect(p).rejects.toMatchObject({ code: 'upstream-timeout' });
    await vi.advanceTimersByTimeAsync(CHUNK_TIMEOUT_MS);
    await done;
    expect(calls).toBe(1);
  });

  it('사용자 취소: 진행 중 요청의 신호가 끊기고 aborted, 결과는 없다', async () => {
    const ctl = new AbortController();
    let upstream: AbortSignal | undefined;
    const t: StructureTransport = { kind: 'hang', structureChunk: (_r, ev) => { upstream = ev.signal; return new Promise(() => {}); } };
    const p = structureText({ text: sampleSource }, { transport: t, signal: ctl.signal });
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    ctl.abort();
    await expect(p).rejects.toMatchObject({ code: 'aborted' });
    expect(upstream?.aborted).toBe(true);
  });

  it('너무 짧은 · 너무 긴 입력은 호출하지 않는다', async () => {
    const t = fakeTransport(() => sample);
    await expect(structureText({ text: '  짧은 글  ' }, { transport: t })).rejects.toMatchObject({ code: 'too-short' });
    await expect(structureText({ text: '가'.repeat(120_001) }, { transport: t })).rejects.toMatchObject({ code: 'too-long' });
    expect(t.requests).toHaveLength(0);
  });

  it('긴 입력: 청크마다 순차 요청, 앞 청크 노드 제목 · 겹침 문맥 전달, 같은 제목 노드 병합 (FR-101)', async () => {
    const para = (h: string, n: number) => `## ${h}\n\n` + Array.from({ length: n }, (_, i) => `${h}에 대한 설명 문장 ${i}입니다.`).join(' ') + '\n\n';
    const text = para('기술 부채', 300) + para('배포 속도', 300) + para('결론', 300);
    const t = fakeTransport((req): StructureV1 => ({
      nodes: [
        { key: 'a', title: '기술 부채', kind: 'concept' },
        { key: 'b', title: `구간 ${req.chunk.index}`, kind: 'concept' },
      ],
      edges: [{ from: 'a', to: 'b', relation: 'causes' }],
      charts: [], tables: [],
    }));
    const ev: PipelineProgress[] = [];
    const plan = await structureText({ text }, { transport: t, onProgress: (e) => ev.push(e) });
    const N = t.requests.length;
    expect(N).toBeGreaterThan(1);
    expect(plan.chunks).toBe(N);
    t.requests.forEach((r, i) => { expect(r.chunk).toEqual({ index: i, count: N }); expect(r.text.length).toBeLessThanOrEqual(24_000); });
    expect(t.requests[0]!.context?.previousNodeTitles).toEqual([]);
    expect(t.requests[0]!.context?.precedingContext).toBeUndefined();
    expect(t.requests[1]!.context?.previousNodeTitles).toEqual(['기술 부채', '구간 0']);
    expect(t.requests[1]!.context?.precedingContext).toMatch(/^\(section: ## /);
    // "기술 부채"는 청크마다 나왔지만 하나로, 엣지는 병합된 노드로 다시 이어진다
    expect(plan.nodes.filter((n) => n.title === '기술 부채')).toHaveLength(1);
    expect(plan.nodes).toHaveLength(1 + N);
    expect(plan.edges.every((e) => e.from === 'c0:a')).toBe(true);
    expect(ev.filter((e) => e.stage === 'analyzing' && !e.detail).map((e) => `${e.chunk}/${e.chunks}`)).toEqual(Array.from({ length: N }, (_, i) => `${i + 1}/${N}`));
  });

  it('일부 청크만 실패하면 나머지로 계획을 만들고 failedChunks를 센다', async () => {
    const text = Array.from({ length: 3 }, (_, k) => `## 절 ${k}\n\n` + '문장입니다. '.repeat(1200)).join('\n\n');
    const t = fakeTransport((req) => (req.chunk.index === 1 ? { bad: true } : sample));
    const plan = await structureText({ text }, { transport: t });
    expect(plan.failedChunks).toBe(1);
    expect(plan.chunkErrors[0]!.code).toBe('invalid-response');
    expect(plan.nodes.length).toBeGreaterThan(0);
  });

  it('키 오류는 남은 청크를 보내지 않고 바로 실패', async () => {
    const text = Array.from({ length: 3 }, (_, k) => `## 절 ${k}\n\n` + '문장입니다. '.repeat(1200)).join('\n\n');
    const t = fakeTransport(() => { throw new AiError('invalid-api-key'); });
    await expect(structureText({ text }, { transport: t })).rejects.toMatchObject({ code: 'invalid-api-key' });
    expect(t.requests).toHaveLength(1);
  });

  it('원문에 없는 수치는 반영 전에 버린다 (16.3) — 인젝션의 999처럼 원문에 있는 수치는 프롬프트 · 평가 몫', async () => {
    const s = structuredClone(sample);
    s.charts[0]!.series[0]!.points.push({ x: '4월', y: 5 });
    const plan = await structureText({ text: sampleSource }, { transport: fakeTransport(() => s) });
    expect(plan.charts[0]!.series[0]!.points.map((p) => p.y)).toEqual([24, 17, 9]);
    expect(plan.droppedNumbers.points).toBe(1);
  });
});
