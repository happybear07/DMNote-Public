// 붙여넣은 원문 → 검증된 StructurePlan (FR-100~103, ARCHITECTURE 7.3, AI-PROMPTS 4 · 6.4 · 8.5 · 16.3).
// 정규화 → 청킹 → 청크마다 transport(재시도 · 타임아웃) → 최종 검증 · 수치 검사 → 병합. 엔진에는 손대지 않는다(적용은 apply.ts).
import { newId } from '@dn/engine-core';
import { chunkText } from './chunk';
import { AiError } from './errors';
import { MAX_CHARS, MIN_CHARS, normalizeSource, visibleLength } from './normalize';
import { STRUCTURE_PROMPT_VERSION, type StructurePromptVersion } from './prompts';
import { DEFAULT_MODEL, type AiUsage, type Effort, type StructureChunkRequest, type StructureMode } from './request';
import { throwIfAborted, withRetry, withTimeout } from './retry';
import {
  ALL_KINDS, checkNumbers, checkStructure, extractNumbers, normTitle, starCounts,
  type DroppedItem, type StructureChart, type StructureEdge, type StructureKind, type StructureNode, type StructureTable,
  type Structure, type StructureContainer, type StructurePattern,
} from './structure';
import { minMembers } from './structure-v2';
import { isSheet, mergeSheet, type StructureSheet } from './sheet';
import type { StructureTransport, TransportStage } from './transport';

/** 청크당 타임아웃. API 3.2는 90초, API 1.4 · AI-PROMPTS 8.1 · MESSAGES는 60초 — 최신 결정(16,000 토큰 + thinking)인 3.2를 따른다 */
export const CHUNK_TIMEOUT_MS = 90_000;

export type PipelineStage = 'chunking' | 'analyzing' | 'retrying' | 'validating' | 'done';

export interface PipelineProgress {
  readonly stage: PipelineStage;
  /** 0~100 */
  readonly pct: number;
  /** 1부터 — "구조를 분석하는 중… {n}/{N}" (MSG-AI-020) */
  readonly chunk?: number;
  readonly chunks?: number;
  /** transport가 알려 준 세부 단계: thinking · emitting · repairing … */
  readonly detail?: TransportStage;
  /** 재시도 중일 때 — "다시 시도하는 중이에요({k}/3)" (MSG-AI-022) */
  readonly retry?: { readonly attempt: number; readonly of: number; readonly code: string };
}

export interface StructureInput {
  readonly text: string;
  readonly kinds?: readonly StructureKind[];
  readonly locale?: string;
}

export interface StructureOptions {
  readonly transport: StructureTransport;
  readonly signal?: AbortSignal;
  readonly onProgress?: (p: PipelineProgress) => void;
  readonly model?: string;
  readonly effort?: Effort;
  /** 비교 · 평가용 — 기본은 STRUCTURE_PROMPT_VERSION(v2) */
  readonly promptVersion?: StructurePromptVersion;
  /** 노트형 정리(NS-16) — 사용자가 칩으로 고른 모양. 없으면 AI가 고른다 */
  readonly mode?: StructureMode;
  readonly retries?: number;
  readonly retryBaseMs?: number;
}

/** 병합 후 노드. key는 청크 이름공간이 붙은 `c{index}:{key}` (6.4) */
export interface PlanNode extends StructureNode { readonly chunk: number }
export interface PlanChart extends StructureChart { readonly chunk: number }
export interface PlanTable extends StructureTable { readonly chunk: number }

export interface StructurePlan {
  readonly runId: string;
  readonly promptVersion: string;
  readonly promptRevision?: number;
  /** 응답에 찍힌 실제 모델 (청크마다 다르면 마지막 것) */
  readonly model: string;
  /** 정규화된 전체 원문 — 출처 연결(FR-111) · 수치 검사 기준 */
  readonly sourceText: string;
  readonly title?: string;
  readonly nodes: readonly PlanNode[];
  readonly edges: readonly StructureEdge[];
  readonly charts: readonly PlanChart[];
  readonly tables: readonly PlanTable[];
  /** structure.v2 응답이 하나라도 있었으면 (출처 schema 기록) */
  readonly version?: 'structure.v2';
  /** v2 묶음 · 구조 판별 — key는 청크 이름공간(c0:…) */
  readonly containers?: readonly StructureContainer[];
  readonly patterns?: readonly StructurePattern[];
  /** 노트형 (청크의 카드를 차례로 이은 것) — mode 'sheet'면 카드 격자로 놓는다 */
  readonly mode?: 'diagram' | 'sheet';
  /** 노트 키워드 (AI 자동 태그) — 원문에 그대로 있는 것만, 최대 8개 */
  readonly keywords?: string[];
  readonly sheet?: StructureSheet;
  readonly usage: AiUsage;
  readonly chunks: number;
  /** 구조화하지 못한 청크 수 — "n개 구간을 구조화하지 못함" 안내 (8.4) */
  readonly failedChunks: number;
  readonly chunkErrors: readonly AiError[];
  /** 항목 단위로 버린 것 (MSG-AI-030 "일부 항목은 형식이 맞지 않아 빼고") */
  readonly dropped: readonly DroppedItem[];
  /** 원문에 없는 수치라 버린 차트 점 · 비운 표 셀 (16.3) */
  readonly droppedNumbers: { readonly points: number; readonly cells: number };
}

export function isEmptyPlan(p: StructurePlan): boolean {
  return !p.nodes.length && !p.charts.length && !p.tables.length && !p.sheet?.sections.length;
}

/**
 * 원문 하나를 구조화한다. 실패 정책:
 * - 사용자 취소 → `aborted` (받은 청크 결과도 버린다 — 부분 반영 없음, ARCHITECTURE 7.3)
 * - 모든 청크 실패 → 첫 청크의 오류. 일부만 실패 → 나머지로 계획을 만들고 failedChunks에 센다
 * - 인증 · 키 · 거절 · 타임아웃처럼 다음 청크도 같은 결과일 오류는 즉시 중단
 */
export async function structureText(input: StructureInput, opts: StructureOptions): Promise<StructurePlan> {
  const { signal } = opts;
  throwIfAborted(signal);
  const runId = newId();
  const kinds = input.kinds?.length ? ALL_KINDS.filter((k) => input.kinds!.includes(k)) : [...ALL_KINDS];
  const locale = input.locale ?? 'ko';
  const progress = (p: PipelineProgress) => opts.onProgress?.(p);

  progress({ stage: 'chunking', pct: 0 });
  const sourceText = normalizeSource(input.text);
  if (visibleLength(sourceText) < MIN_CHARS) throw new AiError('too-short');
  if (sourceText.length > MAX_CHARS) throw new AiError('too-long', { detail: `${sourceText.length}자` });
  const chunks = chunkText(sourceText);
  const numbers = extractNumbers(sourceText);
  const stars = starCounts(sourceText);
  const N = chunks.length;

  const usage: AiUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const dropped: DroppedItem[] = [];
  const chunkErrors: AiError[] = [];
  let droppedPoints = 0, blankedCells = 0;
  let model = opts.model ?? DEFAULT_MODEL, promptVersion: string = opts.promptVersion ?? STRUCTURE_PROMPT_VERSION;
  let promptRevision: number | undefined;
  let title: string | undefined;
  const keywords: string[] = [];
  const srcLow = sourceText.normalize('NFC').toLowerCase();
  const merger = new Merger();

  // 분류 단계(용어집, AI-PROMPTS 7절)가 아직 없으므로 6.4의 "용어집 없음" 경로: 순차 실행하며 앞 청크 제목을 넘긴다.
  for (const c of chunks) {
    throwIfAborted(signal);
    const base = (c.index / N) * 90;
    const step = 90 / N;
    progress({ stage: 'analyzing', pct: base, chunk: c.index + 1, chunks: N });
    const req: StructureChunkRequest = {
      runId, chunk: { index: c.index, count: N }, text: c.text, locale,
      options: { kinds, model: opts.model ?? DEFAULT_MODEL, promptVersion: opts.promptVersion ?? STRUCTURE_PROMPT_VERSION, ...(opts.effort ? { effort: opts.effort } : {}), ...(opts.mode ? { mode: opts.mode } : {}) },
      context: {
        previousNodeTitles: merger.titlesRecentFirst(),
        ...(c.precedingContext ? { precedingContext: c.precedingContext } : {}),
      },
    };
    let res;
    try {
      res = await withRetry(
        () => withTimeout((s) => opts.transport.structureChunk(req, {
          signal: s,
          onStage: (stage, pct) => progress({
            stage: 'analyzing', pct: base + step * Math.min(1, (pct ?? stagePct(stage)) / 100), chunk: c.index + 1, chunks: N, detail: stage,
          }),
        }), CHUNK_TIMEOUT_MS, signal),
        {
          signal, retries: opts.retries, baseMs: opts.retryBaseMs,
          onRetry: (r) => progress({ stage: 'retrying', pct: base, chunk: c.index + 1, chunks: N, retry: { attempt: r.attempt, of: r.of, code: r.error.code } }),
        },
      );
    } catch (e) {
      const err = e instanceof AiError ? e : new AiError('upstream-error', { detail: String(e), cause: e });
      if (signal?.aborted || err.code === 'aborted') throw new AiError('aborted', { cause: e });
      if (FATAL.has(err.code) || N === 1) throw err;
      chunkErrors.push(err);
      continue;
    }

    progress({ stage: 'validating', pct: base + step, chunk: c.index + 1, chunks: N });
    usage.input += res.usage.input; usage.output += res.usage.output;
    usage.cacheRead += res.usage.cacheRead ?? 0; usage.cacheWrite += res.usage.cacheWrite ?? 0;
    model = res.model; promptVersion = res.promptVersion; promptRevision = res.promptRevision ?? promptRevision;

    // 클라이언트 최종 검증 — Worker가 1차 검증을 했어도 다시 본다(신뢰 경계, API 4 "클라이언트가 다시 검증")
    const checked = checkStructure(res.structure, kinds);
    if (!checked.ok) {
      chunkErrors.push(new AiError('invalid-response', { detail: checked.violations.slice(0, 3).map((v) => `${v.path} ${v.rule}`).join(', ') }));
      if (N === 1) throw chunkErrors[0];
      continue;
    }
    dropped.push(...checked.dropped.map((d) => ({ ...d, path: `/chunks/${c.index}${d.path}` })));
    const nc = checkNumbers(checked.value, numbers, stars);
    droppedPoints += nc.droppedPoints; blankedCells += nc.blankedCells;
    title ??= nc.value.title;
    // AI 자동 태그: 원문에 그대로 있는 키워드만 (지어낸 낱말은 태그가 되지 않게)
    for (const k of nc.value.keywords ?? []) if (keywords.length < 8 && srcLow.includes(k.normalize('NFC').toLowerCase()) && !keywords.some((x) => x.toLowerCase() === k.toLowerCase())) keywords.push(k);
    merger.add(c.index, nc.value);
  }

  throwIfAborted(signal);
  if (chunkErrors.length === N) throw chunkErrors[0]!;
  progress({ stage: 'done', pct: 100, chunks: N });
  return {
    runId, promptVersion, model, sourceText,
    ...(promptRevision !== undefined ? { promptRevision } : {}),
    ...(title !== undefined ? { title } : {}),
    ...(keywords.length ? { keywords } : {}),
    ...merger.result(),
    ...(merger.v2 ? { version: 'structure.v2' as const } : {}),
    usage, chunks: N, failedChunks: chunkErrors.length, chunkErrors, dropped,
    droppedNumbers: { points: droppedPoints, cells: blankedCells },
  };
}

/** 다음 청크도 같은 결과일 오류 — 남은 청크를 보내지 않는다 */
const FATAL = new Set(['no-api-key', 'invalid-api-key', 'unauthenticated', 'token-expired', 'forbidden', 'client-outdated', 'upstream-timeout', 'rate-limited', 'ai-refused', 'invalid-request']);

function stagePct(stage: TransportStage): number {
  return stage === 'thinking' ? 20 : stage === 'emitting' ? 60 : stage === 'repairing' ? 70 : 5;
}

/**
 * 청크 결과 병합 (API 4.1, AI-PROMPTS 6.4 · 8.5):
 * key에 `c{index}:` 이름공간, 정규화(NFC · 공백 · 대소문자)한 제목이 같은 노드는 하나로(먼저 나온 것 유지),
 * 엣지는 병합된 노드로 다시 잇고 같은 (from, to, relation)은 하나로. 차트 · 표는 합치지 않는다(다른 구간의 수치를 섞지 않게).
 */
class Merger {
  private readonly nodes: PlanNode[] = [];
  private readonly byTitle = new Map<string, string>();
  private readonly edges: StructureEdge[] = [];
  private readonly edgeSeen = new Set<string>();
  private readonly charts: PlanChart[] = [];
  private readonly tables: PlanTable[] = [];
  private readonly titleOrder: string[][] = [];
  private readonly containers: StructureContainer[] = [];
  private readonly patterns: StructurePattern[] = [];
  /** 노드 → 그 노드가 든 묶음 (청크를 넘어 같은 노드로 합쳐져도 묶음은 하나) */
  private readonly owner = new Map<string, string>();
  v2 = false;
  /** 노트형: 이어 붙인 카드 · 노트형으로 답한 청크 */
  private sheet: StructureSheet | undefined;
  private readonly sheetChunks = new Set<number>();

  add(chunk: number, s: Structure): void {
    const ns = (k: string) => `c${chunk}:${k}`;
    const remap = new Map<string, string>();
    if (s.version === 'structure.v2') this.v2 = true;
    if (isSheet(s)) { this.sheet = mergeSheet(this.sheet, s.sheet, ns); this.sheetChunks.add(chunk); }
    const titles: string[] = [];
    for (const n of s.nodes) {
      const t = normTitle(n.title);
      const existing = this.byTitle.get(t);
      if (existing) { remap.set(n.key, existing); continue; }
      const key = ns(n.key);
      this.byTitle.set(t, key);
      remap.set(n.key, key);
      this.nodes.push({ ...n, key, chunk });
      titles.push(n.title);
    }
    this.titleOrder.push(titles);
    // v2 묶음: 이름공간 · 구성원 다시 잇기 — 다른 청크에서 이미 묶음에 든 노드는 빼고, 둘 미만이면 버린다
    const cmap = new Map<string, string>();
    for (const c of s.containers ?? []) {
      const members = [...new Set(c.members.map((m) => remap.get(m)).filter((m): m is string => !!m))].filter((m) => !this.owner.has(m) || (c.parent !== undefined && this.owner.get(m) === ns(c.parent)));
      if (members.length < minMembers(c.kind)) continue;
      const key = ns(c.key);
      cmap.set(c.key, key);
      for (const m of members) if (!this.owner.has(m)) this.owner.set(m, key);
      this.containers.push({ ...c, key, members, ...(c.parent ? { parent: ns(c.parent) } : {}) });
    }
    for (const c of this.containers) if (c.parent && !this.containers.some((o) => o.key === c.parent)) delete c.parent;
    const end = (k: string) => remap.get(k) ?? cmap.get(k);
    for (const e of s.edges) {
      const from = end(e.from), to = end(e.to);
      if (!from || !to || from === to) continue;
      const sig = `${from}\u0000${to}\u0000${e.relation}`;
      if (this.edgeSeen.has(sig)) continue;
      this.edgeSeen.add(sig);
      this.edges.push({ ...e, from, to });
    }
    for (const c of s.charts) this.charts.push({ ...c, key: ns(c.key), chunk, ...(c.attachTo ? { attachTo: remap.get(c.attachTo) } : {}) });
    for (const t of s.tables) this.tables.push({ ...t, key: ns(t.key), chunk, ...(t.attachTo ? { attachTo: remap.get(t.attachTo) } : {}) });
    // v2 구조 판별: 참조를 이름공간으로 (평가 · 배치 방향용 — 앱 반영은 방향만 쓴다)
    const pk = (k?: string) => (k ? ns(k) : undefined);
    const keep = <T>(xs: T[] | undefined, f: (x: T) => string | undefined) => { const v = (xs ?? []).map(f).filter((x): x is string => !!x); return v.length ? v : undefined; };
    for (const p of s.patterns ?? []) {
      const { key, nodes, containers, charts, tables, frame, in: inn, with: wit, parent, ...rest } = p;
      const v: StructurePattern = { ...rest, ...(key ? { key: ns(key) } : {}) };
      const n = keep(nodes, (k) => remap.get(k)), c = keep(containers, (k) => cmap.get(k)), ch = keep(charts, pk), tb = keep(tables, pk);
      if (n) v.nodes = n; if (c) v.containers = c; if (ch) v.charts = ch; if (tb) v.tables = tb;
      if (frame && cmap.get(frame)) v.frame = cmap.get(frame)!;
      if (parent && cmap.get(parent)) v.parent = cmap.get(parent)!;
      if (inn) v.in = ns(inn);
      if (wit) v.with = ns(wit);
      if (v.primary && this.patterns.some((o) => o.primary)) delete v.primary;
      this.patterns.push(v);
    }
  }

  /** 최근 청크 것을 먼저 (6.3) */
  titlesRecentFirst(): string[] {
    return [...this.titleOrder].reverse().flat();
  }

  result() {
    // 노트형 청크와 도식형 청크가 섞이면 도식형 청크의 노드를 카드 하나로 (버리지 않게 — 카드 이름은 첫 노드 제목)
    let sheet = this.sheet;
    if (sheet) {
      const extra = [...new Set(this.nodes.map((n) => n.chunk))].filter((c) => !this.sheetChunks.has(c)).flatMap((c) => {
        const ns = this.nodes.filter((n) => n.chunk === c);
        return ns.length ? [{ title: ns[0]!.title.slice(0, 40), pieces: [{ type: 'text' as const, md: ns.map((n) => `- **${n.title}**${n.body ? ` — ${n.body.replace(/\n+/g, ' ')}` : ''}`).join('\n') }] }] : [];
      });
      if (extra.length) sheet = { ...sheet, sections: [...sheet.sections, ...extra] };
    }
    return {
      nodes: this.nodes, edges: this.edges, charts: this.charts, tables: this.tables,
      ...(this.containers.length ? { containers: this.containers } : {}), ...(this.patterns.length ? { patterns: this.patterns } : {}),
      ...(sheet ? { mode: 'sheet' as const, sheet } : {}),
    };
  }
}
