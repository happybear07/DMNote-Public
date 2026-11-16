// 프롬프트 템플릿 로딩 · 렌더 (FR-099, AI-PROMPTS 3.8 · 13.1).
// 원본은 prompts/*.md. 머리 HTML 주석이 메타데이터(id · revision)이고, 나머지를 바이트 그대로 보낸다 —
// 시스템 프롬프트가 한 글자라도 바뀌면 캐시 접두어가 깨지기 때문이다.
import { RAW_PROMPTS } from './prompts.gen';

export interface PromptFile {
  readonly file: string;
  /** 'structure.v1' 같은 버전 id */
  readonly id: string;
  /** 같은 vN 안의 문구 개정 번호 (AI-PROMPTS 17.1) */
  readonly revision: number;
  /** 주석을 뗀 본문. `@system`/`@user` 표지가 있는 파일은 표지 이전(보통 빈 문자열) */
  readonly body: string;
  /** `<!-- @system -->` · `<!-- @user -->` 표지로 나뉜 파일 (ocr · qa) */
  readonly system?: string;
  readonly user?: string;
}

const HEAD = /^<!--\n([\s\S]*?)\n-->\n?/;
const SYSTEM_MARK = '<!-- @system -->\n';
const USER_MARK = '<!-- @user -->\n';

export function parsePrompt(file: string, raw: string): PromptFile {
  const text = raw.replace(/\r\n?/g, '\n');
  const m = HEAD.exec(text);
  if (!m) throw new Error(`${file}: 머리 주석(메타데이터)이 없음`);
  const meta = m[1]!;
  const id = /^id:\s*(\S+)/m.exec(meta)?.[1];
  const rev = /^revision:\s*(\d+)/m.exec(meta)?.[1];
  if (!id || !rev) throw new Error(`${file}: id · revision 누락`);
  let body = text.slice(m[0].length);
  // 파일 끝 줄바꿈 하나는 편집기 관례라 본문이 아니다.
  if (body.endsWith('\n')) body = body.slice(0, -1);
  const si = body.indexOf(SYSTEM_MARK), ui = body.indexOf(USER_MARK);
  if (si >= 0 && ui > si) {
    const system = body.slice(si + SYSTEM_MARK.length, ui).replace(/\n$/, '');
    const user = body.slice(ui + USER_MARK.length);
    return { file, id, revision: Number(rev), body: body.slice(0, si), system, user };
  }
  return { file, id, revision: Number(rev), body };
}

const cache = new Map<string, PromptFile>();
export function prompt(file: string): PromptFile {
  let p = cache.get(file);
  if (!p) {
    const raw = RAW_PROMPTS[file];
    if (raw === undefined) throw new Error(`프롬프트 파일 없음: ${file}`);
    p = parsePrompt(file, raw);
    cache.set(file, p);
  }
  return p;
}

/** 구조화 번들 (AI-PROMPTS 17.1): 시스템 + 사용자 템플릿 + 교정 문구 + 스키마를 하나로 묶은 버전 */
export type StructurePromptVersion = 'structure.v1' | 'structure.v2';
export const STRUCTURE_PROMPT_VERSIONS: readonly StructurePromptVersion[] = ['structure.v1', 'structure.v2'];
/** 기본은 v2 — 구조 목록(STRUCTURE-GUIDE 2.2)으로 글의 구조를 판별하고 묶음 · 노드 종류 · 관계를 v6 그대로 낸다 */
export const STRUCTURE_PROMPT_VERSION: StructurePromptVersion = 'structure.v2';

let v2System: PromptFile | undefined;
/** v2 시스템 = 본문 + "\n\n" + 구조 목록 본문 (structure.v2.md 머리 주석의 loader 규칙) — 바이트가 고정이라 캐시 접두어가 같다 */
function structureV2System(): PromptFile {
  if (!v2System) {
    const s = prompt('structure.v2.md'), c = prompt('structure.v2.catalog.md');
    v2System = { ...s, body: `${s.body}\n\n${c.body}` };
  }
  return v2System;
}

export const structurePrompts = (version: StructurePromptVersion = STRUCTURE_PROMPT_VERSION) => ({
  system: version === 'structure.v1' ? prompt('structure.v1.md') : structureV2System(),
  // 사용자 템플릿 · 교정 문구는 v1 · v2가 같다 (v2 본문 "What the user message contains"가 v1 템플릿 모양)
  user: prompt('structure.v1.user.md'),
  repair: prompt('repair.v1.md'),
});

export type TemplateVars = Readonly<Record<string, string | number | undefined | null>>;

/**
 * 로직 없는 템플릿 (AI-PROMPTS 3.8): `{{NAME}}` 치환, `{{#NAME}}…{{/NAME}}`은 값이 비어 있지 않을 때만.
 * 구간 여닫음 표지 바로 뒤의 줄바꿈 하나는 표지와 함께 먹는다 — 생략된 구간이 빈 줄을 남기지 않게.
 * 치환은 한 번의 스캔으로 끝나며, 넣은 값은 다시 해석하지 않는다(원문 속 `{{NONCE}}`가 진짜 nonce로 바뀌면 경계가 무너진다).
 * 값은 이스케이프하지 않는다 — 경계는 nonce가 맡는다(13.1).
 */
export function renderTemplate(template: string, vars: TemplateVars): string {
  const has = (k: string) => { const v = vars[k]; return v !== undefined && v !== null && String(v) !== ''; };
  const sections = template.replace(/\{\{#(\w+)\}\}\n?([\s\S]*?)\{\{\/\1\}\}\n?/g, (_, k: string, inner: string) => (has(k) ? inner : ''));
  return sections.replace(/\{\{(\w+)\}\}/g, (all, k: string) => {
    if (!(k in vars)) throw new Error(`템플릿 변수 누락: ${k}`);
    const v = vars[k];
    return v === undefined || v === null ? '' : String(v);
  });
}

const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** 16자 base62, 요청마다 새로 (13.1). runId · 시간에서 유도하지 않는다. */
export function newNonce(len = 16): string {
  let out = '';
  const buf = new Uint8Array(32);
  while (out.length < len) {
    crypto.getRandomValues(buf);
    for (const b of buf) {
      if (b < 248) out += B62[b % 62]; // 248 = 62 × 4, 모듈로 편향 제거
      if (out.length === len) break;
    }
  }
  return out;
}

/** 원문에 `dn_source_<nonce>`가 이미 있으면 다시 뽑는다(사실상 일어나지 않지만 비용이 없다). */
export function nonceFor(source: string, prefix = 'dn_source_', gen: () => string = newNonce): string {
  for (let i = 0; i < 8; i++) {
    const n = gen();
    if (!source.includes(prefix + n)) return n;
  }
  throw new Error('nonce 충돌이 반복됨');
}
