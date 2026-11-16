// 내 노트에 질문하기 (FR-116~119, AI-PROMPTS 11절): 검색으로 고른 근거 조각을 document 블록(citations)으로 보내고,
// 답의 인용(cited_text · document_index)을 조각의 ref(노트#블록)로 되돌린다. 도구 · JSON 출력 없이 텍스트로 받는다.
// 근거 조각이 없으면 Claude를 부르지 않고 "노트에서 답을 찾지 못했습니다."
import type Anthropic from '@anthropic-ai/sdk';
import { prompt, renderTemplate, newNonce } from './prompts';
import type { AiUsage, ClaudeCall } from './request';

export const QA_MODEL = 'claude-sonnet-5-5';
export const QA_NOT_FOUND = '노트에서 답을 찾지 못했습니다.';
/** 이력은 최근 6턴(질문 · 답 쌍)까지, 텍스트만 */
export const QA_HISTORY_TURNS = 6;

export interface QaPassage { readonly ref: string; readonly noteTitle: string; readonly text: string; readonly updatedAt: number }
export interface QaTurn { readonly question: string; readonly answer: string }
export interface QaInput {
  readonly question: string;
  readonly passages: readonly QaPassage[];
  /** "전체 노트" · "현재 노트: …" · "폴더: …" · "태그: …" */
  readonly scope: string;
  readonly history?: readonly QaTurn[];
  /** "YYYY-MM-DD (요일)" — 없으면 오늘 */
  readonly today?: string;
}
export interface QaCite { readonly ref: string; readonly noteTitle: string; readonly quote: string }
export interface QaSegment { readonly text: string; readonly cites: readonly QaCite[] }
export interface QaAnswer {
  readonly segments: readonly QaSegment[];
  /** 인용이 하나 이상이고 "찾지 못했습니다"로 시작하지 않음 (11.3) */
  readonly grounded: boolean;
  readonly model: string;
  readonly usage: AiUsage;
}

const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
export function todayLabel(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} (${DAYS[d.getDay()]})`;
}

export function buildQaParams(model: string, i: QaInput, nonce = newNonce()): Anthropic.MessageCreateParamsNonStreaming {
  const p = prompt('qa.v1.md');
  const history = (i.history ?? []).slice(-QA_HISTORY_TURNS).flatMap((t): Anthropic.MessageParam[] => [
    { role: 'user', content: t.question },
    { role: 'assistant', content: t.answer },
  ]);
  // 이력 끝에 캐시 중단점 (같은 세션의 다음 질문이 이력까지 캐시를 읽는다)
  const last = history[history.length - 1];
  if (last) history[history.length - 1] = { role: 'assistant', content: [{ type: 'text', text: last.content as string, cache_control: { type: 'ephemeral' } }] };
  const docs = i.passages.map((x): Anthropic.DocumentBlockParam => ({
    type: 'document', source: { type: 'text', media_type: 'text/plain', data: x.text },
    title: x.noteTitle || '제목 없음', context: `ref: ${x.ref} · updated: ${new Date(x.updatedAt).toISOString().slice(0, 10)}`, citations: { enabled: true },
  }));
  const user = renderTemplate(p.user ?? '', { TODAY: i.today ?? todayLabel(), SCOPE: i.scope, NONCE: nonce, QUESTION: i.question }).replace(/\n+$/, '');
  return {
    model,
    max_tokens: 4096,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'low' },
    system: [{ type: 'text', text: p.system ?? '', cache_control: { type: 'ephemeral' } }],
    messages: [...history, { role: 'user', content: [...docs, { type: 'text', text: user }] }],
  } as Anthropic.MessageCreateParamsNonStreaming;
}

/** 응답 → 답 조각 · 인용 (document_index → 조각의 ref) */
export function readQa(m: Anthropic.Message, passages: readonly QaPassage[]): Omit<QaAnswer, 'model' | 'usage'> {
  const segments: QaSegment[] = [];
  for (const b of m.content) {
    if (b.type !== 'text') continue;
    const cites: QaCite[] = [];
    for (const c of (b.citations ?? []) as { document_index?: number; cited_text?: string }[]) {
      const p = typeof c.document_index === 'number' ? passages[c.document_index] : undefined;
      if (p && c.cited_text && !cites.some((x) => x.ref === p.ref && x.quote === c.cited_text)) cites.push({ ref: p.ref, noteTitle: p.noteTitle, quote: c.cited_text });
    }
    if (b.text || cites.length) segments.push({ text: b.text, cites });
  }
  const text = segments.map((s) => s.text).join('').trim();
  const grounded = segments.some((s) => s.cites.length) && !text.startsWith(QA_NOT_FOUND) && !text.startsWith("I couldn't find this in your notes.");
  return { segments, grounded };
}

export async function runQa(call: ClaudeCall, input: QaInput, opts: { signal: AbortSignal; model?: string }): Promise<QaAnswer> {
  const usage: AiUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  if (!input.passages.length) return { segments: [{ text: QA_NOT_FOUND, cites: [] }], grounded: false, model: '', usage };
  const m = await call(buildQaParams(opts.model ?? QA_MODEL, input), { signal: opts.signal });
  usage.input += m.usage.input_tokens;
  usage.output += m.usage.output_tokens;
  usage.cacheRead += m.usage.cache_read_input_tokens ?? 0;
  usage.cacheWrite += m.usage.cache_creation_input_tokens ?? 0;
  return { ...readQa(m, input.passages), model: m.model, usage };
}
