// 고른 글 AI 편집 (FR-112, AI-PROMPTS 12절): 요약 · 자세히 · 다듬기 · 말투, 노트 요약(digest, FR-115),
// 이어 쓰기 · 초안(continue · draft, FR-113), 번역(translate, FR-114). 도구 없이 글(Markdown 부분집합)로 받는다.
// 결과는 앱이 미리보기로 보여 주고 사용자가 넣는 자리를 고른다(실행 취소 한 번). 원문에 없던 숫자는 미리보기에서 강조(12.4).
import type Anthropic from '@anthropic-ai/sdk';
import { AiError } from './errors';
import { nonceFor, prompt, renderTemplate } from './prompts';
import type { AiUsage, ClaudeCall } from './request';
import { newNumbers } from './structure';

export const EDIT_MODEL = 'claude-sonnet-5-5';
/** 고른 글 상한 (12.3) — 넘으면 요청 전에 막는다 */
export const EDIT_MAX_CHARS = 6_000;
/** 노트 요약(digest, FR-115) 입력 상한 — 노트 전체 글 */
export const DIGEST_MAX_CHARS = 40_000;
/** 노트 번역(FR-114) 입력 상한 — 결과가 원문만큼 길어 요약보다 작게 (16,384토큰 안) */
export const TRANSLATE_NOTE_MAX_CHARS = 12_000;
/** 초안 주제(FR-113) 상한 */
export const DRAFT_BRIEF_MAX_CHARS = 1_000;
/** digest: 노트 전체 요약 + 결정 · 할 일 (FR-115) · continue · draft: 이어 쓰기 · 초안 (FR-113) · translate: 번역 (FR-114) */
export type EditAction = 'summarize' | 'expand' | 'polish' | 'tone' | 'digest' | 'continue' | 'draft' | 'translate';
export type EditTone = 'formal' | 'casual' | 'concise' | 'friendly';
/** 번역할 언어 */
export type EditLang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'fr';
export const EDIT_LANGS: readonly { lang: EditLang; name: string; label: string }[] = [
  { lang: 'ko', name: 'Korean', label: '한국어' }, { lang: 'en', name: 'English', label: 'English' }, { lang: 'ja', name: 'Japanese', label: '日本語' },
  { lang: 'zh', name: 'Simplified Chinese', label: '中文' }, { lang: 'es', name: 'Spanish', label: 'Español' }, { lang: 'fr', name: 'French', label: 'Français' },
];

/** 라틴 문자 글의 언어 가르기: 자주 쓰는 낱말 + 그 언어에만 있는 글자 (교차 검토 A10 — 스페인어 · 프랑스어도 다 영어로 봐 번역 대상에서 영어가 빠졌다) */
const LATIN: readonly [EditLang, RegExp, RegExp][] = [
  ['en', /^(the|and|is|are|of|to|in|that|it|for|with|this|was|be|on|not|you|have)$/, /^$/],
  ['es', /^(el|los|las|que|y|es|en|por|para|con|una|del|al|lo|como|pero|más|está|son)$/, /[ñ¿¡áíóú]/g],
  ['fr', /^(le|les|des|est|et|une|pour|avec|pas|dans|du|au|qui|ce|sur|sont|mais|nous|vous)$/, /[çœàâèêëîïôûù]/g],
];
function latinLang(text: string): EditLang {
  const words = text.toLowerCase().match(/[a-zà-öø-ÿœ]+/g) ?? [];
  const score = LATIN.map(([lang, common, marks]) => [lang, words.filter((w) => common.test(w)).length + (text.toLowerCase().match(marks)?.length ?? 0)] as const);
  const best = [...score].sort((a, b) => b[1] - a[1])[0]!;
  return best[1] > score[0]![1] ? best[0] : 'en';
}

/** 글의 주 언어 (번역 대상 고르기 — 글자 수가 가장 많은 문자, 라틴 문자면 낱말로 영어 · 스페인어 · 프랑스어) */
export function textLang(text: string): EditLang {
  const n = (re: RegExp) => text.match(re)?.length ?? 0;
  const counts: [EditLang, number][] = [['ko', n(/[가-힣]/g)], ['ja', n(/[぀-ヿ]/g) * 3], ['zh', n(/[一-鿿]/g)], ['en', n(/[a-z]/gi) / 4]];
  const [lang, c] = counts.sort((a, b) => b[1] - a[1])[0]!;
  return c <= 0 ? 'en' : lang === 'en' ? latinLang(text) : lang;
}

/** 노트 번역: 조각(제목 · 상자 · 화살표 이름 …)을 표지 줄로 이어 한 번에 보내고 같은 표지로 돌려받는다 */
const segLine = (n: number) => `<<<SEG ${n}>>>`;
export function joinSegments(parts: readonly string[]): string { return parts.map((p, i) => `${segLine(i + 1)}\n${p}`).join('\n\n'); }
/**
 * 받은 글 → 조각 (없거나 빈 조각은 null — 원문 그대로 둔다). 다음 번호 조각의 표지가 글 어디에도 없으면 빠진 표지의 글이
 * 이 조각에 이어 붙었을 수 있다(교차 검토 A6 — 두 상자 글이 한 상자에 합쳐짐): 원문(sources)보다 문단이 많으면 믿지 않는다,
 * 원문을 모르면 늘 믿지 않는다. 순서가 바뀐 표지 · 범위 밖 엉터리 표지는 상관없다
 */
export function splitSegments(text: string, count: number, sources?: readonly string[]): (string | null)[] {
  const out: (string | null)[] = Array.from({ length: count }, () => null);
  const marks = [...text.matchAll(/^<<<SEG (\d+)>>>[ \t]*$/gm)];
  const seen = new Set(marks.map((m) => Number(m[1]) - 1));
  const paras = (s: string) => s.trim().split(/\n[ \t]*\n/).filter((x) => x.trim()).length;
  marks.forEach((m, i) => {
    const k = Number(m[1]) - 1, end = marks[i + 1]?.index ?? text.length;
    const body = text.slice(m.index! + m[0].length, end).trim();
    if (k + 1 < count && !seen.has(k + 1) && (!sources?.[k] || paras(body) > paras(sources[k]!))) return;
    if (k >= 0 && k < count && body && out[k] === null) out[k] = body;
  });
  return out;
}
/** 미리보기: 표지 줄을 뺀 글 */
export const stripSegments = (text: string): string => text.replace(/^<<<SEG \d+>>>[ \t]*\n?/gm, '').replace(/\n{3,}/g, '\n\n').trim();

export interface EditInput {
  /** 고른 글 (Markdown) — draft면 사용자가 쓴 주제 */
  readonly selection: string;
  readonly action: EditAction;
  /** action이 'tone'일 때만 (없으면 formal) */
  readonly tone?: EditTone;
  /** action이 'translate'일 때만 (없으면 영어) */
  readonly target?: EditLang;
  readonly locale?: string;
}

const MAX_TOKENS: Partial<Record<EditAction, number>> = { expand: 8192, continue: 2048, translate: 16_384 };
export interface EditResult {
  readonly text: string;
  /** 원문에 없던 숫자 — 미리보기에서 강조해 확인하게 한다(자동으로 버리지는 않는다) */
  readonly newNumbers: readonly string[];
  /** 최대 길이에 닿아 끝이 잘림 */
  readonly truncated: boolean;
  readonly model: string;
  readonly usage: AiUsage;
}
export interface EditRunOptions {
  signal: AbortSignal;
  model?: string;
  /** 지금까지 받은 글 (다듬은 뒤) */
  onText?(text: string): void;
}

export function buildEditParams(model: string, i: EditInput, nonce = nonceFor(i.selection, 'dn_selection_')): Anthropic.MessageCreateParamsNonStreaming {
  const p = prompt('edit.v1.md');
  const lang = EDIT_LANGS.find((l) => l.lang === (i.target ?? 'en'))!;
  const user = renderTemplate(p.user ?? '', {
    NONCE: nonce, ACTION: i.action, TONE: i.action === 'tone' ? i.tone ?? 'formal' : '', TARGET: i.action === 'translate' ? `${lang.lang} (${lang.name})` : '',
    LOCALE: i.locale ?? 'ko', SELECTION: i.selection,
  }).replace(/\n+$/, '');
  return {
    model,
    max_tokens: MAX_TOKENS[i.action] ?? 4096,
    // 고쳐 쓰기라 추론 이득보다 지연이 크다 — OCR과 같이 between_tools + effort low (AI-PROMPTS 3.4)
    thinking: { type: 'between_tools' } as unknown as Anthropic.ThinkingConfigParam,
    output_config: { effort: 'low' },
    system: [{ type: 'text', text: p.system ?? '', cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: user }],
  } as Anthropic.MessageCreateParamsNonStreaming;
}

const QUOTES: Record<string, string> = { '"': '"', '“': '”', "'": "'", '‘': '’' };

/** 지시를 어기고 결과 전체를 감싼 코드 울타리 · 따옴표를 벗긴다 — 원문이 그렇게 생겼으면 그대로 */
export function cleanEdit(text: string, selection: string): string {
  let t = text.trim();
  const src = selection.trim();
  const fence = /^```[\w-]*\n([\s\S]*?)\n?```$/.exec(t);
  if (fence && !src.startsWith('```')) t = fence[1]!.trim();
  const close = QUOTES[t[0] ?? ''];
  if (close && t.length > 1 && t.endsWith(close) && !src.startsWith(t[0]!)) t = t.slice(1, -1).trim();
  return t;
}

export async function runEdit(call: ClaudeCall, input: EditInput, opts: EditRunOptions): Promise<EditResult> {
  const model = opts.model ?? EDIT_MODEL;
  const onText = opts.onText;
  const m = await call(buildEditParams(model, input), { signal: opts.signal, ...(onText ? { onText: (s: string) => onText(cleanEdit(s, input.selection)) } : {}) });
  if (m.stop_reason === 'refusal') throw new AiError('ai-refused');
  const text = cleanEdit(m.content.map((b) => (b.type === 'text' ? b.text : '')).join(''), input.selection);
  const usage: AiUsage = {
    input: m.usage.input_tokens, output: m.usage.output_tokens,
    cacheRead: m.usage.cache_read_input_tokens ?? 0, cacheWrite: m.usage.cache_creation_input_tokens ?? 0,
  };
  return { text, newNumbers: newNumbers(input.selection, text), truncated: m.stop_reason === 'max_tokens', model: m.model, usage };
}
