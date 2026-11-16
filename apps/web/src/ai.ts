// AI 자동 구조화 흐름 (FR-105~109 · FR-139, 화면 03 · 04 · 05 · 08).
// 키 출처 두 가지 (어느 쪽이든 같은 요청 조립 코드):
// - env: 개발 서버가 `.env.local`의 키를 `/anthropic` 프록시로 붙여 준다 — 키가 브라우저에 오지 않는다 (vite.config.ts)
// - device: 설정 화면에서 넣은 키를 이 기기에 암호화해 두고 브라우저에서 Claude로 바로 요청 (로컬 전용 모드, SECURITY 4절)
// 계정 모드(Edge 프록시, FR-104)는 로그인(P5)이 생기면 transport만 바꿔 끼운다.
import {
  AiError, ALL_KINDS, applyStructure, ALLOWED_MODELS, DEFAULT_MODEL, estimateMeasure, isEmptyPlan, nodeBoxKind, normalizeSource, structureText,
  type Effort, type MeasureFn, type PagePlacement, type PipelineProgress, type StructureKind, type StructureMode, type StructurePlan,
} from '@dn/ai-pipeline';
import {
  A4, blockTextParts, isBound, CARD_GAP, CARD_PAD, contentBottom, docText, freeStrokes, pageAt, pageNo, pageY, SHEET_PAD, sheetGeom, strokeBounds, type Block, type Engine, type Id, type TextDoc, type TextNode, type Vec2,
} from '@dn/engine-core';
import { measureRich, measureTitleWidth, type CanvasView } from '@dn/engine-dom';
import type { MetaStore } from '@dn/storage-idb';
import { CONSENT_VERSION } from './legal/consent';

export const KEY_SECRET = 'anthropic-api-key';

export interface AiSettings {
  /** 지금 판(CONSENT_VERSION)의 전송 안내에 동의했는가 (LEGAL-RISK R2) */
  consent: boolean;
  /** 지금 판에 동의한 시각 (동의 기록) */
  consentAt: number | null;
  /** 옛 판 문구에만 동의했다 — 안내가 바뀌어 다시 묻는다 */
  consentOld: boolean;
  model: string; kinds: StructureKind[];
  /** 추론 강도 (FR-140) — 기본 보통 */
  effort: Effort;
  /** 구조화할 때 AI가 고른 원문 키워드를 노트 태그로 붙이기 (10/26) — 기본 켬 */
  autoTag: boolean;
  /** 쓸 키의 끝 4자리 (없으면 null) */
  keyLast4: string | null;
  keySource: 'env' | 'device' | null;
}

/** 누적 사용량 (FR-141): 요청 수 · 토큰. 이 기기에서 센 값 */
export interface AiUsageTotal {
  requests: number; input: number; output: number; cacheRead: number; cacheWrite: number; since: number;
  /** 최근 요청 10개 (요청별 기록) */
  recent?: { at: number; input: number; output: number; model: string }[];
}
export async function getAiUsage(meta: MetaStore): Promise<AiUsageTotal> {
  return (await meta.getSetting<AiUsageTotal>('aiUsage')) ?? { requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, since: Date.now() };
}
export async function addAiUsage(meta: MetaStore, u: { input: number; output: number; cacheRead?: number; cacheWrite?: number }, model: string): Promise<void> {
  const t = await getAiUsage(meta);
  const recent = [{ at: Date.now(), input: u.input, output: u.output, model }, ...(t.recent ?? [])].slice(0, 10);
  await meta.setSetting('aiUsage', { ...t, requests: t.requests + 1, input: t.input + u.input, output: t.output + u.output, cacheRead: t.cacheRead + (u.cacheRead ?? 0), cacheWrite: t.cacheWrite + (u.cacheWrite ?? 0), recent });
}

/** 브라우저 저장소에 이 값이 있으면 env 키를 쓰지 않는다 — e2e가 가짜 응답으로 시험할 때(실제 API 호출 · 비용 방지) */
export const NO_ENV_KEY_FLAG = 'dn:no-env-key';

/** 개발 서버가 `.env.local` 키 프록시를 켰는가 */
export function envKey(): { last4: string } | null {
  if (typeof __DN_ENV_KEY__ === 'undefined' || !__DN_ENV_KEY__) return null;
  try { if (localStorage.getItem(NO_ENV_KEY_FLAG) === '1') return null; } catch { /* 저장소 막힘 — env 키 사용 */ }
  return __DN_ENV_KEY__;
}

export interface AiRun {
  blockId: Id;
  progress: PipelineProgress | null;
  startedAt: number;
}

/** 수식은 $…$ · $$…$$로 감싸서 — AI가 수식을 알아보고 원문 KaTeX 그대로 옮기게 (structure.v2 math · 본문 $…$).
 *  문단 안 줄바꿈(hard_break)은 줄바꿈 글자로 — 글 줄(docText)에서는 빈 글자라 앞뒤 문장이 붙는다 */
function withTex(n: TextNode): TextNode {
  const tex = typeof n.attrs?.tex === 'string' ? n.attrs.tex : '';
  if (n.type === 'hard_break') return { type: 'text', text: '\n' };
  if (n.type === 'math_inline') return { type: 'text', text: tex ? `$${tex}$` : '' };
  if (n.type === 'math_block') return { type: 'paragraph', content: tex ? [{ type: 'text', text: `$$${tex}$$` }] : [] };
  return n.content ? { ...n, content: n.content.map(withTex) } : n;
}

/** 블록의 원문 — 제목 칸은 마크다운 제목으로, 본문 칸은 줄 구조를 살려 이어 붙인다. 수식은 $ 구분자째 */
export function blockText(engine: Engine, blockId: Id): string {
  const { title, bodies } = blockTextParts(engine.contentsOf(blockId));
  const t = title ? docText(withTex(title.doc)).trim() : '';
  const body = bodies.map((c) => docText(withTex(c.doc))).join('\n\n').trim();
  return (t ? `# ${t}\n\n${body}` : body).trim();
}

/** 다시 구조화할 구간 (FR-110): 보낼 글 · 바꿀 상자 · 놓을 자리 · 원문 출처(구간 시작 위치) */
export interface RestructureSource { readonly text: string; readonly replace: readonly Id[]; readonly at: Vec2; readonly sourceContentId?: Id; readonly offset?: number }

/**
 * 고른 AI 상자들이 나온 원문 구간 — 같은 구조화 실행에서 나온 상자만. 원문 블록이 남아 있으면 출처 구절이 든 문단 처음부터 끝까지,
 * 없으면(지웠거나 출처가 없으면) 고른 상자의 글과 그 사이 화살표로
 */
export function restructureSource(engine: Engine, ids: readonly Id[]): RestructureSource | { error: string } {
  const blocks = ids.map((id) => engine.getBlock(id)).filter((b): b is Block => !!b?.ai);
  if (!blocks.length) return { error: '다시 구조화는 AI가 만든 상자에서만 할 수 있어요.' };
  if (new Set(blocks.map((b) => b.ai!.runId)).size > 1) return { error: '같은 구조화 결과에서 나온 상자만 골라 주세요.' };
  const replace = blocks.map((b) => b.id), at = { x: Math.min(...blocks.map((b) => b.x)), y: Math.min(...blocks.map((b) => b.y)) };
  const srcs = blocks.map((b) => b.ai!.source).filter((s): s is NonNullable<typeof s> => !!s?.contentId);
  const cid = srcs[0]?.contentId, srcBlock = cid ? engine.getContent(cid)?.blockId : undefined;
  if (cid && srcBlock && engine.getBlock(srcBlock)) {
    const text = normalizeSource(blockText(engine, srcBlock));
    const spans = srcs.filter((s) => s.contentId === cid).flatMap((s): [number, number][] => {
      if (s.excerpt && text.slice(s.from, s.to) === s.excerpt) return [[s.from, s.to]];
      const i = s.excerpt ? text.indexOf(s.excerpt) : -1; // 원문을 고쳐 자리가 밀렸으면 구절로 다시 찾는다
      return i < 0 ? [] : [[i, i + s.excerpt!.length]];
    });
    if (spans.length) {
      // 구절이 든 줄(원문 글에서 문단 = 한 줄) 처음부터 끝까지
      const from = text.lastIndexOf('\n', Math.min(...spans.map((s) => s[0])) - 1), to = text.indexOf('\n', Math.max(...spans.map((s) => s[1])));
      const lo = from < 0 ? 0 : from + 1, raw = text.slice(lo, to < 0 ? text.length : to);
      return { text: raw.trim(), replace, at, sourceContentId: cid, offset: lo + raw.length - raw.trimStart().length };
    }
  }
  const set = new Set(replace), name = (id: Id) => blockText(engine, id).split('\n')[0]!.replace(/^#\s*/, '');
  const arrows = [...engine.arrows()].filter(isBound).filter((a) => set.has(a.from.blockId) && set.has(a.to.blockId))
    .map((a) => `- ${name(a.from.blockId)} → ${name(a.to.blockId)}${a.label ? ` (${a.label})` : ''}`);
  return { text: [...blocks.map((b) => blockText(engine, b.id)), arrows.join('\n')].filter(Boolean).join('\n\n'), replace, at };
}

/** AI 전송 동의 기록 (설정 aiConsentRecord) — 어느 판 문구에 언제 동의했는지. 문구가 바뀌면 다시 받아야 한다(개인정보보호법 제28조의8 제3항) */
export interface ConsentRecord { version: number; at: number }

export async function loadAiSettings(meta: MetaStore): Promise<AiSettings> {
  const [consent, record, model, kinds, keyMeta, effort, autoTag] = await Promise.all([
    meta.getSetting<boolean>('aiConsent'), meta.getSetting<ConsentRecord>('aiConsentRecord'), meta.getSetting<string>('aiModel'), meta.getSetting<StructureKind[]>('aiKinds'),
    meta.secretMeta(KEY_SECRET), meta.getSetting<Effort>('aiEffort'), meta.getSetting<boolean>('aiAutoTag'),
  ]);
  const current = !!consent && record?.version === CONSENT_VERSION;
  return {
    consent: current,
    consentAt: current ? record!.at : null,
    consentOld: !!consent && !current,
    effort: effort === 'low' || effort === 'high' ? effort : 'medium',
    autoTag: autoTag !== false,
    model: model && (ALLOWED_MODELS as readonly string[]).includes(model) ? model : DEFAULT_MODEL,
    kinds: kinds?.length ? kinds : [...ALL_KINDS],
    ...keyInfo(keyMeta?.last4 as string | undefined),
  };
}

/** env 키가 있으면 그것이 우선, 없으면 이 기기에 저장한 키 */
export function keyInfo(deviceLast4: string | undefined | null): Pick<AiSettings, 'keyLast4' | 'keySource'> {
  const env = envKey();
  if (env) return { keyLast4: env.last4, keySource: 'env' };
  return deviceLast4 ? { keyLast4: deviceLast4, keySource: 'device' } : { keyLast4: null, keySource: null };
}

/** 직접 호출 설정 — 개발 서버의 키 프록시가 있으면 그쪽(키는 브라우저에 오지 않음), 아니면 이 기기에 저장한 키. 없으면 null */
export async function directOpts(meta: MetaStore): Promise<{ apiKey: string; baseURL?: string } | null> {
  if (envKey()) return { apiKey: 'sk-ant-env-proxy', baseURL: `${location.origin}/anthropic` };
  const apiKey = await meta.getSecret(KEY_SECRET);
  return apiKey ? { apiKey } : null;
}

/** 키 확인 후 저장 (FR-139). 실패하면 저장하지 않고 오류를 돌려준다. */
export async function saveApiKey(meta: MetaStore, apiKey: string): Promise<AiError | null> {
  const key = apiKey.trim();
  if (!/^sk-ant-/.test(key)) return new AiError('invalid-api-key', { detail: 'format' });
  const { testApiKey } = await import('@dn/ai-pipeline/direct');
  const err = await testApiKey({ apiKey: key });
  if (err) return err;
  await meta.setSecret(KEY_SECRET, key, { last4: key.slice(-4), validatedAt: Date.now() });
  return null;
}

export interface RunDeps {
  engine: Engine;
  view: CanvasView;
  meta: MetaStore;
  settings: AiSettings;
  signal: AbortSignal;
  onProgress(p: PipelineProgress): void;
}

export type RunOutcome =
  | { kind: 'applied'; plan: StructurePlan; counts: { blocks: number; arrows: number; charts: number; tables: number } }
  | { kind: 'empty' }
  | { kind: 'no-key' };

/** mode: 결과 칩에서 '노트로 · 도식으로 정리'를 고르면 그 모양으로 다시 요청 (NOTE-SHEET-PLAN NS-16). 없으면 AI가 고른다.
 *  again: 고른 AI 상자만 다시 (FR-110) — 그 구간을 보내고 결과로 그 상자들을 바꾼다 */
export async function runStructure(blockId: Id, d: RunDeps, mode?: StructureMode, again?: RestructureSource): Promise<RunOutcome> {
  // env 키: 개발 서버 프록시가 진짜 키로 바꿔 끼우므로 여기서는 자리 채움 값만 보낸다
  const transportOpts = await directOpts(d.meta);
  if (!transportOpts) return { kind: 'no-key' };
  const text = again?.text ?? blockText(d.engine, blockId);
  const { createDirectTransport } = await import('@dn/ai-pipeline/direct');
  const plan = await structureText(
    { text, kinds: d.settings.kinds, locale: 'ko' },
    { transport: createDirectTransport(transportOpts), signal: d.signal, onProgress: d.onProgress, model: d.settings.model, effort: d.settings.effort, ...(mode ? { mode } : {}) },
  );
  // 사용량 기록 (FR-141) — 실패한 요청은 파이프라인이 던지므로 여기까지 오면 받은 응답
  await addAiUsage(d.meta, plan.usage, plan.model).catch(() => {});
  if (d.signal.aborted) throw new AiError('aborted');
  if (isEmptyPlan(plan)) return { kind: 'empty' };

  const src = again ? undefined : d.engine.getBlock(blockId);
  // A4 노트면 결과는 원문 아래 용지 안 — 노트형은 카드 격자, 도식형은 용지 폭 안 도식(넘치면 줄 바꿈 · 위→아래, page.ts). 끝없는 캔버스는 원문 오른쪽 빈 자리.
  // 다시 구조화는 바꿀 상자들이 있던 자리(왼쪽 위)에
  const below = again ? again.at.y - 40 : src ? src.y + src.h : contentBottom(d.engine);
  // A4 노트형은 용지 폭을 다 쓴다 — 원문 아래에 다른 내용(블록 · 자유 필기)이 있으면 덮지 않게 내용 맨 아래에 (교차 검토 B6, 도식형 page.after와 같게)
  const skip = new Set([blockId, ...(again?.replace ?? [])]);
  const blocked = [...d.engine.blocks()].some((b) => !skip.has(b.id) && b.y + b.h > below) || freeStrokes(d.engine).some((s) => strokeBounds(s).y > below);
  const a4 = plan.mode === 'sheet' ? sheetPlacement(d.engine, blocked ? contentBottom(d.engine) : below) : null;
  const page = plan.mode !== 'sheet' ? pagePlacement(d.engine) : null;
  const at = a4?.at ?? (page ? { x: SHEET_PAD, y: below + 40 } : again ? again.at : src ? { x: src.x + src.w + 120, y: src.y } : { x: 0, y: 0 });
  // 실제 DOM으로 잰다 — 추정치로 두면 그려진 그래프(제목 · 범례) · 표(줄바꿈)가 더 길어 아래 블록과 겹친다. 표 폭만 추정치
  const measure: MeasureFn = (b) => {
    if (b.content.type === 'text') return { w: b.w, h: d.view.measureText(b.content.doc, b.w, nodeBoxKind(b.content.doc)) };
    if (b.content.type === 'divider') return estimateMeasure(b);
    const w = b.content.type === 'table' ? estimateMeasure(b).w : 360;
    return { w, h: measureRich(d.view, b.content, w) };
  };
  const sourceContentId = again ? again.sourceContentId : src ? blockTextParts(d.engine.contentsOf(blockId)).bodies[0]?.id : undefined;
  // 출처: 지금 앱은 Claude만 쓴다 — 학습 데이터 등급 claude (OWN-MODEL 3절, 자체 모델로 바꾸면 여기서 origin을 바꾼다)
  const fit = (doc: TextDoc) => measureTitleWidth(d.view, doc);
  const r = applyStructure(d.engine, plan, at, {
    locale: 'ko', measure, fit, sourceContentId, origin: 'claude', provider: 'anthropic', ...(a4 ? { sheet: a4.sheet } : {}), ...(page ? { page } : {}),
    ...(again ? { replace: again.replace, ...(again.offset ? { sourceOffset: again.offset } : {}) } : {}),
  });
  if (!r.ok) throw new AiError('invalid-response', { detail: r.reason });
  d.view.select(r.blockIds);
  d.view.revealRect(src ? union(r.bounds, src) : r.bounds);
  return { kind: 'applied', plan, counts: r.counts };
}

/** A4 노트: 세로 2단 · 가로 3단, 블록 폭은 용지 폭에서 — 쪽마다 들어가는 만큼 블록 하나 (노트형 레고 블록, sheet.ts) */
function sheetPlacement(engine: Engine, below: number) {
  const g = sheetGeom(engine.note, contentBottom(engine));
  if (!g) return null;
  // 쪽마다 가로 · 세로가 다를 수 있다 — 놓기 시작하는 쪽부터 끝(이어 붙는 쪽 포함)까지 가장 좁은 폭에 맞춘다
  const pw = Math.min(...[...g.list.slice(pageAt(g, below + 40).i), pageNo(g, g.pages)].map((p) => p.w));
  const cols = pw > A4.w ? 3 : 2;
  const inner = Math.floor((pw - 2 * SHEET_PAD - (cols - 1) * CARD_GAP) / cols) - 2 * CARD_PAD;
  const room = (y: number) => { const p = pageAt(g, y); return p.y + p.h - SHEET_PAD - y; }; // 그 쪽 아래 여백까지
  return { at: { x: SHEET_PAD, y: below + 40 }, sheet: { inner, cols, place: (y: number, h: number) => pageY(g, y, h), room } };
}

/** A4 노트의 도식형: 용지 안쪽 폭 · 쪽 틈 피하기 · 원문 아래가 막혔을 때 놓을 자리(내용 맨 아래) */
function pagePlacement(engine: Engine): PagePlacement | null {
  const bottom = contentBottom(engine), g = sheetGeom(engine.note, bottom);
  return g ? { width: Math.min(...g.list.map((p) => p.w), pageNo(g, g.pages).w) - 2 * SHEET_PAD, place: (y, h) => pageY(g, y, h), after: bottom + 40 } : null; // 가장 좁은 쪽 폭
}

function union(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

/** MSG-AI-024: 0개 항목은 생략 */
export function appliedMessage(c: { blocks: number; arrows: number; charts: number; tables: number }): string {
  const parts = [
    c.blocks && `블록 ${c.blocks}개`, c.arrows && `화살표 ${c.arrows}개`, c.charts && `그래프 ${c.charts}개`, c.tables && `표 ${c.tables}개`,
  ].filter(Boolean);
  return `${parts.join(' · ')}를 만들었어요.`;
}

/** MSG-AI-020 · 022 진행 문구 */
export function progressText(p: PipelineProgress | null): { title: string; sub: string } {
  if (!p || p.stage === 'chunking') return { title: '원문을 나누는 중…', sub: '관계 · 수치 · 비교 구조를 찾을 준비를 하고 있어요' };
  if (p.stage === 'retrying' && p.retry) return { title: '구조를 분석하는 중…', sub: `연결이 불안정해 다시 시도하는 중이에요(${p.retry.attempt}/${p.retry.of}).` };
  if (p.stage === 'validating' || p.stage === 'done') return { title: '블록을 배치하는 중…', sub: '결과를 캔버스에 놓고 있어요' };
  return { title: '구조를 분석하는 중…', sub: p.detail === 'repairing' ? '응답 형식을 한 번 더 맞추는 중이에요' : '관계 · 수치 · 비교 구조를 찾고 있어요' };
}
