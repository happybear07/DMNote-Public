// JSON Schema 부분집합 검증기 + strict 전송용(wire) 변환 (FR-100, AI-PROMPTS 3.3).
// schemas/*.json이 실제로 쓰는 키워드만 지원한다: type(단일 · 배열) · enum · required · properties ·
// additionalProperties:false · items · min/maxLength · min/maxItems · minimum/maximum · pattern · $ref(#/$defs/…).
// 일반 검증기(ajv 등)를 들이지 않은 이유: 번들 크기, eval/CSP(ajv는 코드 생성을 쓴다), 그리고 오류 경로를 우리 형식(JSON 포인터)으로 바로 내기 위해서.
import structureSchemaJson from '../schemas/structure.v1.json';
import structureV2SchemaJson from '../schemas/structure.v2.json';

export type JsonSchema = {
  readonly type?: string | readonly string[];
  readonly enum?: readonly unknown[];
  readonly required?: readonly string[];
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly additionalProperties?: boolean;
  readonly items?: JsonSchema;
  readonly minLength?: number; readonly maxLength?: number;
  readonly minItems?: number; readonly maxItems?: number;
  readonly minimum?: number; readonly maximum?: number;
  readonly pattern?: string;
  readonly $ref?: string;
  readonly $defs?: Readonly<Record<string, JsonSchema>>;
  readonly description?: string;
  readonly [k: string]: unknown;
};

export const STRUCTURE_SCHEMA = structureSchemaJson as unknown as JsonSchema;
/** structure.v2 — v1의 상위 집합 (STRUCTURE-GUIDE 5절). 응답의 version으로 고른다 */
export const STRUCTURE_SCHEMA_V2 = structureV2SchemaJson as unknown as JsonSchema;

export interface SchemaIssue {
  /** JSON 포인터 (RFC 6901), 예: `/nodes/3/key` */
  readonly path: string;
  /** 위반한 키워드: type · enum · required · additionalProperties · maxLength … */
  readonly rule: string;
  /** 짧은 설명. 원문을 40자 넘게 되풀이하지 않는다 (AI-PROMPTS 9.2) */
  readonly detail: string;
}

export function pointer(parts: readonly (string | number)[]): string {
  return parts.map((p) => '/' + String(p).replace(/~/g, '~0').replace(/\//g, '~1')).join('');
}

const patternCache = new Map<string, RegExp>();
const re = (p: string) => { let r = patternCache.get(p); if (!r) { r = new RegExp(p, 'u'); patternCache.set(p, r); } return r; };

function typeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

/** 값이 길면 줄여서 설명에 쓴다 — 원문 구절이 교정 프롬프트에서 지시처럼 놓이지 않게 (9.2). */
export function brief(v: unknown, max = 40): string {
  const s = typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v) ?? String(v);
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function resolve(root: JsonSchema, s: JsonSchema): JsonSchema {
  if (!s.$ref) return s;
  const m = /^#\/\$defs\/(.+)$/.exec(s.$ref);
  const def = m && root.$defs?.[m[1]!];
  if (!def) throw new Error(`지원하지 않는 $ref: ${s.$ref}`);
  return resolve(root, def);
}

/** 스키마 검증. 모든 위반을 모아 돌려준다(빈 배열 = 유효). 글자 수는 JS 문자열 길이(UTF-16) — AI-PROMPTS 14절. */
export function validateSchema(value: unknown, schema: JsonSchema, root: JsonSchema = schema, path: (string | number)[] = []): SchemaIssue[] {
  const s = resolve(root, schema);
  const out: SchemaIssue[] = [];
  const at = pointer(path);
  if (s.type !== undefined) {
    const types = typeof s.type === 'string' ? [s.type] : s.type;
    if (!types.some((t) => (t === 'number' ? typeof value === 'number' : typeOf(value) === t))) {
      out.push({ path: at, rule: 'type', detail: `${types.join('|')} 이어야 함 (${typeOf(value)})` });
      return out;
    }
  }
  if (s.enum && !s.enum.some((e) => e === value)) {
    out.push({ path: at, rule: 'enum', detail: `허용 값 아님: ${brief(value)}` });
    return out;
  }
  if (typeof value === 'string') {
    if (s.minLength !== undefined && value.length < s.minLength) out.push({ path: at, rule: 'minLength', detail: `${s.minLength}자 이상이어야 함` });
    if (s.maxLength !== undefined && value.length > s.maxLength) out.push({ path: at, rule: 'maxLength', detail: `${s.maxLength}자 이하여야 함 (${value.length}자)` });
    if (s.pattern !== undefined && !re(s.pattern).test(value)) out.push({ path: at, rule: 'pattern', detail: `${s.pattern} 형식 아님: ${brief(value)}` });
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) out.push({ path: at, rule: 'type', detail: '유한한 수여야 함' });
    if (s.minimum !== undefined && value < s.minimum) out.push({ path: at, rule: 'minimum', detail: `${s.minimum} 이상이어야 함` });
    if (s.maximum !== undefined && value > s.maximum) out.push({ path: at, rule: 'maximum', detail: `${s.maximum} 이하여야 함` });
  }
  if (Array.isArray(value)) {
    if (s.minItems !== undefined && value.length < s.minItems) out.push({ path: at, rule: 'minItems', detail: `항목 ${s.minItems}개 이상이어야 함` });
    if (s.maxItems !== undefined && value.length > s.maxItems) out.push({ path: at, rule: 'maxItems', detail: `항목 ${s.maxItems}개 이하여야 함 (${value.length}개)` });
    if (s.items) value.forEach((v, i) => out.push(...validateSchema(v, s.items!, root, [...path, i])));
  }
  if (typeOf(value) === 'object') {
    const obj = value as Record<string, unknown>;
    for (const k of s.required ?? []) if (!(k in obj)) out.push({ path: pointer([...path, k]), rule: 'required', detail: '필수 속성 누락' });
    for (const [k, v] of Object.entries(obj)) {
      const ps = s.properties?.[k];
      if (ps) out.push(...validateSchema(v, ps, root, [...path, k]));
      else if (s.additionalProperties === false) out.push({ path: pointer([...path, k]), rule: 'additionalProperties', detail: '정의되지 않은 속성' });
    }
  }
  return out;
}

const WIRE_DROP = new Set(['$schema', '$id', 'minLength', 'maxLength', 'minItems', 'maxItems', 'minimum', 'maximum', 'pattern']);

/**
 * strict 도구용 wire 스키마 (AI-PROMPTS 3.3 표). 원본을 기계적으로 변환한다:
 * $schema · $id · 길이/개수/범위/pattern 제거, `type` 배열 → anyOf, 나머지(description · enum · required · additionalProperties · $defs · $ref) 유지.
 * 키 순서는 원본 JSON 순서를 그대로 따른다 — 같은 입력이면 같은 문자열이라 캐시 접두어가 흔들리지 않는다(3.5).
 */
export function toWireSchema(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(toWireSchema);
  if (!s || typeof s !== 'object') return s;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s as Record<string, unknown>)) {
    if (WIRE_DROP.has(k)) continue;
    if (k === 'type' && Array.isArray(v)) { out.anyOf = v.map((t) => ({ type: t })); continue; }
    if (k === 'properties' || k === '$defs') {
      // 이 둘의 키는 속성 이름 · 정의 이름이지 스키마 키워드가 아니다 — 이름이 `pattern`이어도 지우면 안 된다.
      out[k] = Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([n, d]) => [n, toWireSchema(d)]));
      continue;
    }
    out[k] = toWireSchema(v);
  }
  return out;
}

export const STRUCTURE_WIRE_SCHEMA = toWireSchema(STRUCTURE_SCHEMA) as Record<string, unknown>;
export const STRUCTURE_WIRE_SCHEMA_V2 = toWireSchema(STRUCTURE_SCHEMA_V2) as Record<string, unknown>;
