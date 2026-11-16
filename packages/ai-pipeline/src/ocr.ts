// 손글씨 → 글 (FR-038, AI-PROMPTS 10절): 올가미로 고른 필기를 그린 그림 한 장 → emit_ocr 도구로 줄마다 글 · 신뢰도.
// "쓴 대로" 전사(교정 · 번역 금지), 읽을 수 없는 글자는 □. 도구 호출이 없으면 새 요청 1회, 그래도 없으면 실패(잉크 묶기를 권한다).
import type Anthropic from '@anthropic-ai/sdk';
import ocrSchemaJson from '../schemas/ocr.v1.json';
import { AiError } from './errors';
import { prompt, renderTemplate } from './prompts';
import { toWireSchema, validateSchema, type JsonSchema } from './schema';
import type { AiUsage, ClaudeCall } from './request';

export const OCR_MODEL = 'claude-sonnet-5-5';
/** "정밀 인식" (AI-PROMPTS 10절) */
export const OCR_PRECISE_MODEL = 'claude-opus-5-5';

const OCR_SCHEMA = ocrSchemaJson as unknown as JsonSchema & { $defs: Record<string, JsonSchema> };
const MODEL_OUTPUT: JsonSchema = { ...OCR_SCHEMA.$defs.modelOutput!, $defs: OCR_SCHEMA.$defs } as JsonSchema;

export const OCR_TOOL: Anthropic.Tool = {
  name: 'emit_ocr',
  description: 'Return the transcription of the handwriting in the image, one entry per handwritten line in reading order. Call exactly once.',
  strict: true,
  input_schema: toWireSchema(MODEL_OUTPUT) as Anthropic.Tool.InputSchema,
};

export interface OcrInput {
  /** base64 (data: 접두어 없이) */
  readonly image: string;
  readonly mime: 'image/png' | 'image/webp' | 'image/jpeg';
  readonly w: number;
  readonly h: number;
  readonly locale?: string;
  readonly hint?: 'lines';
}
export interface OcrLine { readonly text: string; readonly confidence: number; readonly bbox?: readonly [number, number, number, number] }
export interface OcrResult { readonly lines: readonly OcrLine[]; readonly overallConfidence: number; readonly model: string; readonly usage: AiUsage }

export function buildOcrParams(model: string, i: OcrInput): Anthropic.MessageCreateParamsNonStreaming {
  const p = prompt('ocr.v1.md');
  const user = renderTemplate(p.user ?? '', { IMAGE_W: i.w, IMAGE_H: i.h, LOCALE: i.locale ?? 'ko', HINT: i.hint ?? 'lines' }).replace(/\n+$/, '');
  return {
    model,
    max_tokens: 2048,
    // 전사라 추론 이득보다 지연이 크다 — Sonnet 5.5는 disabled를 400으로 거부하므로 between_tools + effort low (AI-PROMPTS 3.4)
    thinking: { type: 'between_tools' } as unknown as Anthropic.ThinkingConfigParam,
    output_config: { effort: 'low' },
    tools: [OCR_TOOL],
    tool_choice: { type: 'auto', disable_parallel_tool_use: true },
    system: [{ type: 'text', text: p.system ?? '', cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: i.mime, data: i.image } },
      { type: 'text', text: user },
    ] }],
  } as Anthropic.MessageCreateParamsNonStreaming;
}

/** 도구 입력 → 결과 (스키마 검사, 그림 밖 bbox는 bbox만 버린다). 쓸 수 없으면 null */
export function readOcr(input: unknown, w: number, h: number): Omit<OcrResult, 'model' | 'usage'> | null {
  if (validateSchema(input, MODEL_OUTPUT, MODEL_OUTPUT).length) return null;
  const o = input as { lines: OcrLine[]; overallConfidence: number };
  const lines = o.lines.map((l) => {
    const b = l.bbox;
    const ok = b && b[0] <= b[2] && b[1] <= b[3] && b[2] <= w + 1 && b[3] <= h + 1;
    return ok ? l : { text: l.text, confidence: l.confidence };
  });
  return { lines, overallConfidence: o.overallConfidence };
}

export async function runOcr(call: ClaudeCall, input: OcrInput, opts: { signal: AbortSignal; model?: string }): Promise<OcrResult> {
  const model = opts.model ?? OCR_MODEL;
  const usage: AiUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  for (let attempt = 0; attempt < 2; attempt++) {
    const m = await call(buildOcrParams(model, input), { signal: opts.signal });
    usage.input += m.usage.input_tokens;
    usage.output += m.usage.output_tokens;
    usage.cacheRead += m.usage.cache_read_input_tokens ?? 0;
    usage.cacheWrite += m.usage.cache_creation_input_tokens ?? 0;
    if (m.stop_reason === 'refusal') throw new AiError('invalid-response', { detail: 'refusal' });
    const tool = m.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === OCR_TOOL.name);
    const r = tool ? readOcr(tool.input, input.w, input.h) : null;
    if (r) return { ...r, model: m.model, usage };
  }
  throw new AiError('invalid-response', { detail: 'no usable emit_ocr call' });
}
