// Claude 요청 조립 · 청크 하나의 호출 + 교정 재요청 (AI-PROMPTS 8 · 9 · 13절).
// Edge Worker(계정 모드)와 브라우저(로컬 전용 모드)가 같은 코드로 쓴다 — 그래서 SDK는 타입만 가져오고,
// 실제 호출은 주입된 `ClaudeCall`이 한다(Worker · 브라우저 · 테스트가 각자 구현).
import type Anthropic from '@anthropic-ai/sdk';
import { AiError } from './errors';
import { nonceFor, renderTemplate, STRUCTURE_PROMPT_VERSION, STRUCTURE_PROMPT_VERSIONS, structurePrompts, type StructurePromptVersion, type TemplateVars } from './prompts';
import { STRUCTURE_WIRE_SCHEMA, STRUCTURE_WIRE_SCHEMA_V2 } from './schema';
import { ALL_KINDS, checkStructure, formatViolations, type StructureKind, type StructureV1 } from './structure';

/** AI-PROMPTS 3.1: 구조화 기본 모델. API 3.2 허용 목록 안에서만 바꾼다 (FR-140). */
export const DEFAULT_MODEL = 'claude-sonnet-5-5';
export const ALLOWED_MODELS = ['claude-sonnet-5-5', 'claude-haiku-4-5-20251001', 'claude-opus-5-5'] as const;
export type Effort = 'low' | 'medium' | 'high';
export const DEFAULT_EFFORT: Effort = 'medium';
/** 추론 토큰 포함. 노드 60 · 엣지 120 상한에서도 잘리지 않게 (AI-PROMPTS 3.4, API 3.2) */
export const STRUCTURE_MAX_TOKENS = 16_000;
export const TOOL_NAME = 'emit_structure';

/** 도구 정의는 고정 객체 — 런타임에 조립 순서가 흔들리면 캐시 접두어가 깨진다 (3.5) */
export const STRUCTURE_TOOL: Anthropic.Tool = {
  name: TOOL_NAME,
  description: 'Emit the diagram for the source text in the user message. Call exactly once. nodes are concept blocks; edges are arrows between node keys; charts hold numeric series whose every value is written in the source; tables hold comparisons. The app validates this input against the schema and draws it on the user\'s canvas; any text outside this call is discarded.',
  strict: true,
  input_schema: STRUCTURE_WIRE_SCHEMA as Anthropic.Tool.InputSchema,
};

/**
 * structure.v2 도구. strict를 끈다 — v2 스키마의 선택 필드(56개)가 strict 문법 상한(전체 24개)을 넘어 400이 난다.
 * 형식은 앱 검증기(checkStructure)가 보고, 전체 위반이면 교정 재요청(모드 A) 한 번.
 */
export const STRUCTURE_TOOL_V2: Anthropic.Tool = {
  name: TOOL_NAME,
  description: 'Emit the diagram for the source text in the user message. Call exactly once, with "version": "structure.v2". nodes are concept blocks; edges are arrows between node or container keys; containers frame nodes the source itself groups; patterns name the catalog structures the result contains; charts hold numeric series whose every value is written in the source; tables hold comparisons. The app validates this input against the schema and draws it on the user\'s canvas; any text outside this call is discarded.',
  input_schema: STRUCTURE_WIRE_SCHEMA_V2 as Anthropic.Tool.InputSchema,
};
const toolOf = (v: StructurePromptVersion) => (v === 'structure.v1' ? STRUCTURE_TOOL : STRUCTURE_TOOL_V2);

/** API 3.2 요청 본문과 같은 모양 (Edge 프록시는 이 객체를 그대로 POST 한다) */
export interface StructureChunkRequest {
  readonly runId: string;
  readonly chunk: { readonly index: number; readonly count: number };
  readonly text: string;
  readonly locale: string;
  readonly options: {
    readonly kinds: readonly StructureKind[];
    readonly model?: string;
    readonly promptVersion?: string;
    readonly effort?: Effort;
    /** 노트형 정리(NS-16) — 'sheet' · 'diagram'이면 그 모양으로 강제, 없으면 AI가 고른다 */
    readonly mode?: StructureMode;
  };
  readonly context?: {
    readonly previousNodeTitles?: readonly string[];
    /** API 3.2에는 아직 없는 필드 — AI-PROMPTS 6.3 겹침 문맥. Worker가 받아 템플릿에 넣어야 한다 */
    readonly precedingContext?: string;
  };
}

export interface AiUsage { input: number; output: number; cacheRead: number; cacheWrite: number }

/** API 3.2 SSE `result` 데이터와 같은 모양 (+ promptRevision · repaired) */
export interface StructureChunkResult {
  readonly runId: string;
  readonly chunk: number;
  /** emit_structure 입력 — 전체 위반은 이미 걸렀지만 항목 단위 정리 · 수치 검사는 받는 쪽이 한다 */
  readonly structure: unknown;
  readonly usage: AiUsage;
  /** 응답에 찍힌 실제 모델 (사용량 기록 근거, 3.7) */
  readonly model: string;
  readonly promptVersion: string;
  readonly promptRevision?: number;
  readonly repaired?: 'A' | 'B';
}

export type ChunkStage = 'thinking' | 'emitting' | 'repairing';

/** Claude Messages 호출 한 번 (스트리밍으로 받아 완성된 Message를 돌려준다). 오류는 AiError로 정규화해서 던진다.
 *  onText: 글 조각이 올 때마다 지금까지 받은 글 전체 (작성 도우미 미리보기, FR-112) */
export type ClaudeCall = (
  params: Anthropic.MessageCreateParamsNonStreaming,
  opts: { signal: AbortSignal; onStage?(stage: ChunkStage): void; onText?(snapshot: string): void },
) => Promise<Anthropic.Message>;

export interface UserMessageInput {
  nonce: string;
  chunkNo: number;
  chunkCount: number;
  kinds: readonly StructureKind[];
  locale: string;
  sourceText: string;
  previousNodeTitles?: readonly string[];
  precedingContext?: string;
  retryNote?: string;
  mode?: StructureMode;
}

export type StructureMode = 'sheet' | 'diagram';

const MAX_PREV_TITLES = 200;
const MAX_TITLE_LEN = 80;

export function renderStructureUser(i: UserMessageInput, version: StructurePromptVersion = STRUCTURE_PROMPT_VERSION): string {
  const seen = new Set<string>();
  const titles: string[] = [];
  for (const t of i.previousNodeTitles ?? []) {
    const v = t.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE_LEN);
    const k = v.toLowerCase().replace(/\s+/g, '');
    if (!v || seen.has(k)) continue;
    seen.add(k);
    titles.push(v);
    if (titles.length >= MAX_PREV_TITLES) break;
  }
  return renderTemplate(structurePrompts(version).user.body, {
    NONCE: i.nonce,
    CHUNK_NO: i.chunkNo,
    CHUNK_COUNT: i.chunkCount,
    ENABLED_KINDS: ALL_KINDS.filter((k) => i.kinds.includes(k)).join(', '),
    LOCALE: i.locale,
    PREVIOUS_NODE_TITLES: titles.map((t) => `- ${t}`).join('\n'),
    PRECEDING_CONTEXT: i.precedingContext ?? '',
    SOURCE_TEXT: i.sourceText,
    RETRY_NOTE: i.retryNote ?? '',
    FORCED_MODE: version === 'structure.v1' ? '' : i.mode ?? '',
  }).replace(/\n+$/, '');
}

export type RepairReason = 'no_tool_call' | 'truncated' | 'invalid_json';
const repairNote = (vars: TemplateVars) => renderTemplate(structurePrompts().repair.body, vars).trim(); // v1 · v2 같은 문구

export function buildStructureParams(model: string, effort: Effort, messages: Anthropic.MessageParam[], version: StructurePromptVersion = STRUCTURE_PROMPT_VERSION): Anthropic.MessageCreateParamsNonStreaming {
  // Haiku 4.5는 adaptive thinking · effort를 받지 않는다 (AI-PROMPTS 3.4 classify 행)
  const reasoning = model.startsWith('claude-haiku')
    ? {}
    : { thinking: { type: 'adaptive' as const }, output_config: { effort } };
  return {
    model,
    max_tokens: STRUCTURE_MAX_TOKENS,
    ...reasoning,
    // temperature는 보내지 않는다 — Sonnet 5.5 · Opus 5.5는 기본값이 아닌 sampling 파라미터를 400으로 거부 (3.4)
    tools: [toolOf(version)],
    // 강제 호출(type:"tool")은 Sonnet 5.5 · Opus 5.5에서 400 → auto + 병렬 금지 + "exactly once" 지시 (3.3)
    tool_choice: { type: 'auto', disable_parallel_tool_use: true },
    system: [{ type: 'text', text: structurePrompts(version).system.body, cache_control: { type: 'ephemeral' } }],
    messages,
  };
}

function addUsage(u: AiUsage, m: Anthropic.Message): void {
  u.input += m.usage.input_tokens;
  u.output += m.usage.output_tokens;
  u.cacheRead += m.usage.cache_read_input_tokens ?? 0;
  u.cacheWrite += m.usage.cache_creation_input_tokens ?? 0;
}

type Outcome =
  | { kind: 'ok'; input: unknown }
  | { kind: 'b'; reason: RepairReason }
  | { kind: 'a'; toolUseId: string; violations: string };

function inspect(m: Anthropic.Message, kinds: readonly StructureKind[], version: StructurePromptVersion): Outcome {
  // 응답을 읽기 전에 항상 stop_reason부터 (3.7). 거절은 재시도하지 않는다.
  if (m.stop_reason === 'refusal') {
    throw new AiError('ai-refused', { detail: m.stop_details?.category ?? undefined });
  }
  if (m.stop_reason === 'max_tokens' || m.stop_reason === 'model_context_window_exceeded') return { kind: 'b', reason: 'truncated' };
  const call = m.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === TOOL_NAME);
  if (!call) return { kind: 'b', reason: 'no_tool_call' };
  if (call.input === null || typeof call.input !== 'object' || Array.isArray(call.input)) return { kind: 'b', reason: 'invalid_json' };
  // v2로 물었는데 version만 빠졌으면 채워서 본다 — 그 한 글자로 교정 재요청을 쓰지 않게
  const input = version === 'structure.v2' && !('version' in call.input) ? { version, ...call.input } : call.input;
  const r = checkStructure(input, kinds);
  if (!r.ok) return { kind: 'a', toolUseId: call.id, violations: formatViolations(r.violations) };
  return { kind: 'ok', input };
}

/**
 * 청크 하나 구조화: 호출 → 검사 → (필요하면) 교정 재요청 1회 (FR-100, AI-PROMPTS 8.4 · 9절).
 * - 모드 A(전체 위반): 같은 대화에 assistant 턴(받은 블록 전부, thinking 포함 그대로) + tool_result(is_error) 이어 붙이기.
 *   preserved thinking 때문에 이전 턴을 고치거나 블록을 빼면 안 된다 — 이어 붙이기만 한다.
 * - 모드 B(호출 없음 · 잘림 · JSON 불가): 새 nonce로 사용자 메시지를 다시 렌더하고 retry_note를 붙인 새 요청.
 * 재시도(429/5xx)와 타임아웃은 바깥(파이프라인 · Worker)이 감싼다.
 */
export async function runStructureChunk(
  call: ClaudeCall,
  req: StructureChunkRequest,
  opts: { signal: AbortSignal; onStage?(stage: ChunkStage): void; nonce?: () => string },
): Promise<StructureChunkResult> {
  const model = req.options.model ?? DEFAULT_MODEL;
  if (!(ALLOWED_MODELS as readonly string[]).includes(model)) throw new AiError('invalid-request', { detail: `허용되지 않은 모델: ${model}` });
  if (!req.options.kinds.length) throw new AiError('invalid-request', { detail: 'options.kinds가 비어 있음' });
  const version = (req.options.promptVersion ?? STRUCTURE_PROMPT_VERSION) as StructurePromptVersion;
  if (!STRUCTURE_PROMPT_VERSIONS.includes(version)) throw new AiError('invalid-request', { detail: `모르는 프롬프트 판: ${version}` });
  const effort = req.options.effort ?? DEFAULT_EFFORT;
  const kinds = req.options.kinds;
  const usage: AiUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const render = (retryNote?: string) => renderStructureUser({
    nonce: nonceFor(req.text, 'dn_source_', opts.nonce),
    chunkNo: req.chunk.index + 1, chunkCount: req.chunk.count,
    kinds, locale: req.locale, sourceText: req.text,
    previousNodeTitles: req.context?.previousNodeTitles, precedingContext: req.context?.precedingContext, retryNote,
    ...(req.options.mode ? { mode: req.options.mode } : {}),
  }, version);
  const done = (m: Anthropic.Message, input: unknown, repaired?: 'A' | 'B'): StructureChunkResult => ({
    runId: req.runId, chunk: req.chunk.index, structure: input as StructureV1, usage, model: m.model,
    promptVersion: version, promptRevision: structurePrompts(version).system.revision, ...(repaired ? { repaired } : {}),
  });

  const first: Anthropic.MessageParam[] = [{ role: 'user', content: [{ type: 'text', text: render() }] }];
  const m1 = await call(buildStructureParams(model, effort, first, version), { signal: opts.signal, onStage: opts.onStage });
  addUsage(usage, m1);
  const o1 = inspect(m1, kinds, version);
  if (o1.kind === 'ok') return done(m1, o1.input);

  opts.onStage?.('repairing');
  let messages: Anthropic.MessageParam[];
  let mode: 'A' | 'B';
  if (o1.kind === 'a') {
    mode = 'A';
    messages = [
      ...first,
      { role: 'assistant', content: m1.content as Anthropic.ContentBlockParam[] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: o1.toolUseId, is_error: true, content: repairNote({ MODE_A: '1', VIOLATIONS: o1.violations }) }] },
    ];
  } else {
    mode = 'B';
    messages = [{ role: 'user', content: [{ type: 'text', text: render(repairNote({ MODE_B: '1', REASON: o1.reason, NODE_CAP: o1.reason === 'truncated' ? 30 : 60 })) }] }];
  }
  const m2 = await call(buildStructureParams(model, effort, messages, version), { signal: opts.signal, onStage: opts.onStage });
  addUsage(usage, m2);
  const o2 = inspect(m2, kinds, version);
  if (o2.kind === 'ok') return done(m2, o2.input, mode);
  throw new AiError('invalid-response', { detail: o2.kind === 'a' ? o2.violations.split('\n').slice(0, 3).join(' ') : o2.reason });
}
