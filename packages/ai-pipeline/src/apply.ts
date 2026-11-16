// StructurePlan → 엔진 반영 (FR-105~109, ENGINE 5.7 · 10.4, API 4.1 매핑).
// 측정 · 배치 계산은 트랜잭션 밖에서 끝내고(planApply — 순수 함수), 블록 · 콘텐츠 · 화살표를 transact 한 번으로 만든다.
// origin 'ai' → undo 한 번에 전부 사라진다 (FR-002 · FR-022).
import {
  DEFAULT_BLOCK_W, docText, freeStrokes, makeChart, makeTable, newId, q, rectsIntersect, RELATION_SPEC, strokeBounds, toTitleDoc, unionRects,
  type AiOrigin, type AiProvenance, type Block, type ChartData, type GroupMeta, type TableData, type BoxKind, type Engine, type Id, type Rect, type TextDoc, type TextNode, type Vec2, type DividerData,
} from '@dn/engine-core';
import { markdownToDoc } from '@dn/text-pm/headless';
import { arrange, patternArchetype, TAG_H } from './arrange';
import { estimateFit, estimateMeasure, MIN_TITLE_W } from './estimate';
import { laidWidth, paginate, stackLaid, type PagePlacement } from './page';
import { dropReplaced, normTitle, relink } from './replace';
import { isSheet, planSheet, type SheetDeps } from './sheet';
import type { PlanChart, PlanNode, PlanTable, StructurePlan } from './pipeline';
import type { Relation, StructureContainer, StructureEdge, StructureNode } from './structure';

export type Locale = 'ko' | 'en';
export { estimateMeasure } from './estimate';

/** 이 앱이 AI 출력에서 받는 스키마 이름 — 출처에 남긴다 */
export const STRUCTURE_SCHEMA_NAME = 'structure.v1';

/** 차트 · 표 콘텐츠는 스키마 v4 형식 (engine-core rich.ts, FR-018) */
export type PlannedContent = { readonly type: 'text'; readonly doc: TextDoc }
  | (ChartData & { readonly type: 'chart' }) | (TableData & { readonly type: 'table' }) | (DividerData & { readonly type: 'divider' });

export interface PlannedBlock {
  /** 계획 안의 참조 이름 (노드 key · 차트 key · 표 key) */
  readonly ref: string;
  readonly kind: 'node' | 'chart' | 'table';
  readonly rect: Rect;
  readonly content: PlannedContent;
  readonly ai: AiProvenance;
  /** 노드 종류 (v6 — 바탕색은 그릴 때 종류에서 정하고 저장하지 않는다) */
  readonly nodeKind?: string;
  /** 차트 · 표가 붙은 노드 ref */
  readonly attachTo?: string;
  /** v2 노드 필드 → 블록 필드 (상태 · 역할 · 발화자 · 담당 · 시점 — 원문 그대로) */
  readonly meta?: BlockMeta;
  /** v2 묶음 key (맨 바깥 묶음 — 앱 묶음은 한 겹) */
  readonly group?: string;
  /** 고정 크기 (구분선 — 높이를 글로 재지 않는다) */
  readonly fixed?: boolean;
  /** 최소 높이 — 노트형 레고 블록에서 단 아래 끝을 맞추려 늘린 상자 (자동 높이는 그대로, 글이 늘면 더 커진다) */
  readonly minH?: number;
}
type BlockMeta = Partial<Pick<Block, 'status' | 'emphasis' | 'hedge' | 'role' | 'speaker' | 'owner' | 'time' | 'start' | 'end' | 'due'>>;
/** v2 묶음 → 노트 묶음 (이름 · 종류 · 괄호) */
export interface PlannedGroup { readonly key: string; readonly meta: GroupMeta }
export interface PlannedArrow {
  readonly from: string;
  readonly to: string;
  readonly label?: string;
  readonly relation: Relation;
  readonly ai: AiProvenance;
  /** 끝이 묶음이면 그 묶음 key (from · to는 그 묶음의 첫 상자) — v6 묶음 끝 화살표 */
  readonly fromGroup?: string;
  readonly toGroup?: string;
  /** v2 기호 — 성립 안 함 · 극성 · 번호 · 응답 · 확률 */
  readonly marks?: Pick<StructureEdge, 'negated' | 'sign' | 'order' | 'reply' | 'prob'>;
}
export interface ApplyPlan {
  readonly runId: string;
  readonly blocks: readonly PlannedBlock[];
  readonly arrows: readonly PlannedArrow[];
  readonly groups: readonly PlannedGroup[];
  /** 결과 묶음 전체 영역 (적용 후 전체 맞춤 FR-012의 대상) */
  readonly bounds: Rect;
}

export interface MeasureInput { readonly content: PlannedContent; readonly w: number }
/** 블록 크기 측정기. 화면에서는 DomMeasurer(ENGINE 10.3)를 넘기고, 없으면 글자 수 추정(EstimateMeasurer)을 쓴다 */
export type MeasureFn = (b: MeasureInput) => { w: number; h: number };

export interface ApplyOptions {
  readonly locale?: Locale;
  readonly measure?: MeasureFn;
  /** 제목 상자를 한 줄로 그렸을 때의 폭 (화면에서는 DOM으로, 없으면 글자 수 추정) — 제목만 있는 노드는 이 폭에 맞춘다 */
  readonly fit?: (doc: TextDoc) => number;
  /** 원문 임시 블록의 텍스트 콘텐츠 id (FR-105 · FR-111 출처 연결) */
  readonly sourceContentId?: Id;
  /** 이 결과를 만든 모델 계열 (학습 데이터 등급, OWN-MODEL 3절). 없으면 'claude' — 모르는 모델은 학습에서 빠지는 쪽으로 */
  readonly origin?: AiOrigin;
  readonly provider?: string;
  /** 노트형을 A4 노트에 놓을 때: 카드 안쪽 폭 · 열 수 · 쪽 틈 피하기 (at은 용지 안 여백) */
  readonly sheet?: SheetDeps['sheet'];
  /** 도식형을 A4 노트에 놓을 때: 용지 안쪽 폭 · 쪽 틈 피하기 · 막혔을 때 놓을 y (page.ts, at은 원문 아래 용지 왼쪽 여백) */
  readonly page?: PagePlacement;
  /** 다시 구조화 (FR-110): 이 상자들(과 이어진 화살표)을 같은 트랜잭션에서 지우고 그 자리에 — 실행 취소 한 번이면 이전 결과로 */
  readonly replace?: readonly Id[];
  /** 보낸 글이 원문의 한 구간일 때 그 시작 위치 — 출처(from · to)를 원문 기준으로 맞춘다 */
  readonly sourceOffset?: number;
}

// ───────── 텍스트 문서 ─────────

/** AI 본문은 허용 Markdown(목록 · 굵게 · 기울임 · 인라인 코드)만: 제목은 문단으로, 링크는 글자로 (SECURITY 5.1, 8.5) */
function sanitizeNodes(nodes: readonly TextNode[]): TextNode[] {
  return nodes.map((n): TextNode => {
    const content = n.content ? sanitizeNodes(n.content) : undefined;
    const marks = n.marks?.filter((m) => m.type !== 'link');
    const base: TextNode = { ...n, ...(content ? { content } : {}), ...(marks ? { marks } : {}) };
    if (marks && !marks.length) delete (base as { marks?: unknown }).marks;
    if (n.type === 'heading') { const { attrs: _a, ...rest } = base; return { ...rest, type: 'paragraph' }; }
    return base;
  });
}

/** 노드 문서(제목 줄 + 본문)가 어떤 상자가 되는가: 제목 줄뿐이면 제목 상자 */
export function nodeBoxKind(doc: TextDoc): BoxKind {
  return doc.content.length === 1 && doc.content[0]!.type === 'heading' ? 'title' : 'text';
}

/** 노드 수식(math — 원문 KaTeX): 앞뒤 구분자($ · $$ · \[ \] · \( \))를 떼고, 본문에 이미 쓴 수식이면 다시 넣지 않는다 */
function nodeTex(math: string | undefined, body: string | undefined): string | null {
  const tex = (math ?? '').trim().replace(/^\$\$?([\s\S]*?)\$\$?$/, '$1').replace(/^\\\[([\s\S]*)\\\]$/, '$1').replace(/^\\\(([\s\S]*)\\\)$/, '$1').trim();
  if (!tex) return null;
  const flat = (s: string) => s.replace(/\s+/g, '');
  return body && flat(body).includes(flat(tex)) ? null : tex;
}

/** 노드 상자 문서: 제목 줄(heading) → 수식(math가 있으면 수식 블록) → 본문(허용 Markdown — $…$ · $$…$$는 수식으로) */
export function nodeDoc(title: string, body?: string, math?: string): TextDoc {
  const head: TextNode = { type: 'heading', attrs: { level: 3 }, content: title ? [{ type: 'text', text: title }] : [] };
  const tex = nodeTex(math, body);
  const rest = body?.trim() ? sanitizeNodes(markdownToDoc(body).content) : [];
  return { type: 'doc', content: [head, ...(tex ? [{ type: 'math_block', attrs: { tex } }] : []), ...rest] };
}

// ───────── 계획 ─────────

/** 이번 실행의 출처 (v6): 모델 계열 · 모델 · 프롬프트 판 · 스키마 */
function runInfo(plan: StructurePlan, opts: ApplyOptions): AiProvenance {
  return {
    generated: true, runId: plan.runId, origin: opts.origin ?? 'claude', ...(opts.provider ? { provider: opts.provider } : {}),
    ...(plan.model ? { model: plan.model } : {}), promptVersion: plan.promptVersion, schema: plan.version ?? STRUCTURE_SCHEMA_NAME,
  };
}

function provenance(plan: StructurePlan, quote: string | undefined, opts: ApplyOptions): AiProvenance {
  // quote를 원문에서 정확히 찾으면 위치로 (API 4.1). 못 찾으면 출처를 남기지 않는다 —
  // AiProvenance.source는 from/to가 필수라 "excerpt만"을 표현할 수 없다(보고서 참고).
  const at = quote ? plan.sourceText.indexOf(quote) : -1;
  if (!quote || at < 0) return runInfo(plan, opts);
  return {
    ...runInfo(plan, opts),
    source: { ...(opts.sourceContentId ? { contentId: opts.sourceContentId } : {}), from: at + (opts.sourceOffset ?? 0), to: at + (opts.sourceOffset ?? 0) + quote.length, excerpt: quote },
  };
}

/** 노드 종류별 기본 바탕색 (FR-021) — 이제 engine-core가 그릴 때 정한다(blockColor) */
export { KIND_COLOR } from '@dn/engine-core';

/**
 * 순수 계획: 블록 크기 측정 → 계층형 배치 → 빈 자리 찾기. 엔진은 읽기만 한다(빈 자리 질의).
 * 차트 · 표는 attachTo 노드 다음 층에(배치용 가상 엣지), 붙을 곳이 없으면 그래프 아래 격자로.
 */
export function planApply(engine: Pick<Engine, 'queryBlocks'> | null, plan: StructurePlan, at: Vec2, opts: ApplyOptions = {}): ApplyPlan {
  const locale = opts.locale ?? 'ko';
  const measure = opts.measure ?? estimateMeasure;
  // 노트형(NS-15): 레고 블록(10/29 — 카드 격자에서 바꿈) — sheet.ts (도식형 노드 · 화살표는 쓰지 않는다)
  if (isSheet(plan)) {
    const r = planSheet(plan.sheet, at, { measure, ai: provenance(plan, undefined, opts), run: runInfo(plan, opts), sanitize: (md) => sanitizeNodes(markdownToDoc(md).content), free: (rect) => (engine ? findFreeSpot(engine, rect, 48) : at),
      tables: plan.tables, patterns: plan.patterns ?? [], nodes: plan.nodes, edges: plan.edges, ...(opts.sheet ? { sheet: opts.sheet } : {}) });
    return { runId: plan.runId, ...r, bounds: unionRects(r.blocks.map((b) => b.rect)) ?? { x: at.x, y: at.y, w: 0, h: 0 } };
  }
  type Item = { ref: string; kind: PlannedBlock['kind']; content: PlannedContent; ai: AiProvenance; size: { w: number; h: number }; minW?: number; nodeKind?: string; attachTo?: string; meta?: BlockMeta; group?: string; order?: number; axis?: StructureNode['axis'] };
  // v2 묶음: 맨 바깥 묶음이 앱 묶음, 안쪽 묶음 이름은 구성원 제목 앞에 (5.7 — 앱 묶음은 한 겹)
  const containers = plan.containers ?? [];
  const { topOf, innerTitle } = containerIndex(containers);
  const items: Item[] = [];
  // 노드 폭: 제목만 있는 노드는 제목 한 줄 폭(120 ~ 기본 폭), 본문이 있으면 기본 폭. 배치 다듬기가 비슷한 폭끼리 맞춘다(minW)
  const nodeW = (content: PlannedContent) => (content.type === 'text' && nodeBoxKind(content.doc) === 'title'
    ? Math.min(DEFAULT_BLOCK_W, Math.max(MIN_TITLE_W, Math.ceil(opts.fit?.(content.doc) ?? estimateFit(content.doc)))) : DEFAULT_BLOCK_W);
  const push = (ref: string, kind: PlannedBlock['kind'], content: PlannedContent, quote?: string, extra: Partial<Item> = {}) => {
    const w = kind === 'node' ? nodeW(content) : DEFAULT_BLOCK_W;
    const size = measure({ content, w });
    items.push({ ref, kind, content, ai: provenance(plan, quote, opts), size: { w: Math.max(size.w, 24), h: Math.max(size.h, 24) }, ...(kind === 'node' ? { minW: w } : {}), ...extra });
  };
  // 상자 하나짜리 칸 · 레인은 앱 묶음(둘 이상)이 안 된다 — 칸 이름은 역할로, 레인 이름은 담당으로 남긴다 (원문 말 그대로)
  const solo = new Map(containers.filter((c) => c.title && c.members.length === 1 && (c.kind === 'slot' || c.kind === 'lane')).map((c) => [c.members[0]!, c]));
  plan.nodes.forEach((n: PlanNode) => {
    const inner = innerTitle.get(n.key), group = topOf.get(n.key), s = solo.get(n.key);
    const meta = blockMeta(s ? { ...n, ...(s.kind === 'slot' ? { role: n.role || s.title } : { owner: n.owner || s.title }) } : n);
    push(n.key, 'node', { type: 'text', doc: nodeDoc(inner ? `${inner} · ${n.title}` : n.title, n.body, n.math) }, n.source?.quote,
      { nodeKind: n.kind, ...(meta ? { meta } : {}), ...(group ? { group } : {}), ...(n.order !== undefined ? { order: n.order } : {}), ...(n.axis ? { axis: n.axis } : {}) });
  });
  plan.charts.forEach((c: PlanChart) => push(c.key, 'chart', { type: 'chart', ...makeChart(c.kind, c.series, c.title, c.unit) }, c.source?.quote, c.attachTo ? { attachTo: c.attachTo } : {}));
  plan.tables.forEach((t: PlanTable) => push(t.key, 'table', { type: 'table', ...makeTable(t.columns, t.rows, t.title) }, t.source?.quote, t.attachTo ? { attachTo: t.attachTo } : {}));

  // 배치: 구조 판별(v2 patterns)마다 그 원형 모양으로(Figma 원형 P-01~23), 판별이 없으면 계층형 왼→오 (arrange.ts).
  // 묶음 끝 화살표는 배치에서 그 묶음의 첫 상자로
  const firstOf = new Map(containers.map((c) => [c.key, c.members[0]!]));
  const endRef = (k: string) => firstOf.get(k) ?? k;
  const byRef = new Map(items.map((i) => [i.ref, i]));
  const page = opts.page;
  const input = {
    items: items.map((i) => ({ id: i.ref, w: i.size.w, h: i.size.h, kind: i.kind, ...(i.minW !== undefined ? { minW: i.minW } : {}), ...(i.attachTo ? { attachTo: i.attachTo } : {}), ...(i.order !== undefined ? { order: i.order } : {}), ...(i.axis ? { axis: i.axis } : {}) })),
    edges: plan.edges.map((e) => { const label = e.label ?? RELATION_SPEC[e.relation]?.chip?.[locale]; return { from: endRef(e.from), to: endRef(e.to), relation: e.relation, ...(label ? { label } : {}) }; }),
    containers, patterns: plan.patterns ?? [],
    heightAt: (ref: string, w: number) => Math.max(24, measure({ content: byRef.get(ref)!.content, w }).h),
    ...(page ? { maxWidth: page.width } : {}),
  };
  // A4 용지(page.ts): 줄 바꿈 → 위→아래로 다시 → 원문 차례로 한 줄
  let laid = arrange(input);
  if (page && laidWidth(laid, input.items) > page.width) laid = arrange({ ...input, vertical: true });
  if (page && laidWidth(laid, input.items) > page.width) laid = stackLaid(input.items, page.width);

  const local = items.map((i) => ({ ...i, rect: { x: laid.pos.get(i.ref)!.x, y: laid.pos.get(i.ref)!.y, w: laid.width.get(i.ref) ?? i.size.w, h: laid.height.get(i.ref) ?? i.size.h } }));
  const bbox = unionRects(local.map((i) => i.rect)) ?? { x: 0, y: 0, w: 0, h: 0 };
  // 기존 블록이 있으면 `at` 근처 빈 자리에 (FR-109, ENGINE 10.4 findFreeRect gap=48). A4 용지면 원문 아래 용지 가운데, 막혔으면 내용 맨 아래
  const origin = page
    ? { x: at.x + Math.max(0, (page.width - bbox.w) / 2), y: engine?.queryBlocks({ x: at.x, y: at.y, w: page.width, h: bbox.h }).length ? page.after : at.y }
    : engine ? findFreeSpot(engine, { x: at.x, y: at.y, w: bbox.w, h: bbox.h }, 48) : at;
  const dx = origin.x - bbox.x, dy = origin.y - bbox.y;
  const placedRect = new Map(local.map((i) => [i.ref, { x: i.rect.x + dx, y: i.rect.y + dy, w: i.rect.w, h: i.rect.h }]));
  if (page) paginate(placedRect, (ref) => (byRef.get(ref)!.kind === 'node' ? TAG_H : 0), page.place);

  // 시간축 · 사분면 · 척도 · 벤 구조는 그 상자들을 모양 묶음 하나로 — 캔버스가 축선 · 십자 · 축 · 타원을 덧그린다(engine-dom group-shapes.ts).
  // 상자가 이미 앱 묶음(둘 이상인 칸 · 사분면 묶음)에 들어가면 그 구조는 모양 묶음을 만들지 않는다
  const perGroup = new Map<string, number>();
  for (const i of local) if (i.group) perGroup.set(i.group, (perGroup.get(i.group) ?? 0) + 1);
  const grouped = (i: (typeof local)[number]) => !!i.group && perGroup.get(i.group)! > 1;
  const placed = new Set(local.filter((i) => !grouped(i)).map((i) => i.ref));
  const shapeOf = new Map<string, string>(), shapeGroups: PlannedGroup[] = [];
  for (const p of plan.patterns ?? []) {
    const shape = SHAPES[patternArchetype(p) ?? ''], ms = (p.nodes ?? []).filter((k) => placed.has(k) && !shapeOf.has(k));
    if (!shape || ms.length < 2 || ms.length !== (p.nodes ?? []).length) continue;
    const key = `shape:${p.key ?? p.id}`;
    for (const k of ms) shapeOf.set(k, key);
    // 사분면 · 벤은 그림이 본질 — 문서 뷰 · 인쇄 · 워드에서 캔버스 그림으로 (STRUCTURE-GUIDE 4.11, 묶음 메뉴에서 글로 되돌릴 수 있다)
    const figure = shape === 'matrix' || shape === 'venn';
    // 이름: 판별 caption, 없으면 주 구조는 결과 제목(원문 머리말), 사분면은 축 이름 — 그림 캡션 · 사이드바에 (첫 상자 제목이 아니게)
    const name = p.caption ?? (p.primary ? plan.title : undefined) ?? (shape === 'matrix' && p.axis?.x && p.axis.y ? `${p.axis.x} × ${p.axis.y}` : undefined);
    shapeGroups.push({ key, meta: { ...(name ? { name: name.slice(0, 60) } : {}), shape, ...(p.axis ? { axis: p.axis } : {}), bracket: 'none', ...(figure ? { figure: true } : {}), ai: runInfo(plan, opts) } });
  }
  const blocks: PlannedBlock[] = local.map((i) => {
    const group = grouped(i) ? i.group : shapeOf.get(i.ref) ?? i.group;
    return {
      ref: i.ref, kind: i.kind, content: i.content, ai: i.ai, ...(i.nodeKind ? { nodeKind: i.nodeKind } : {}), ...(i.attachTo ? { attachTo: i.attachTo } : {}),
      ...(i.meta ? { meta: i.meta } : {}), ...(group ? { group } : {}),
      rect: (({ x, y, w, h }) => ({ x: q(x), y: q(y), w: q(w), h: q(h) }))(placedRect.get(i.ref)!),
    };
  });
  const refs = new Set(blocks.map((b) => b.ref));
  // 화살표: 관계 종류만 저장하고 모양은 쓰지 않는다 — 그릴 때 관계 기본 모양(engine-core relations.ts). 라벨은 원문 구절, 없으면 관계 칩
  // 묶음(상자 둘 이상이 실제로 놓인 것)만 앱 묶음이 된다
  const used = new Set(blocks.flatMap((b) => (b.group ? [b.group] : [])));
  const groups: PlannedGroup[] = containers.filter((c) => !c.parent && used.has(c.key) && blocks.filter((b) => b.group === c.key).length > 1)
    .map((c): PlannedGroup => ({ key: c.key, meta: { ...(c.title ? { name: c.title } : {}), kind: c.kind, ai: runInfo(plan, opts), ...(c.kind === 'premises' ? { bracket: 'brace' as const } : {}) } }))
    .concat(shapeGroups);
  const gset = new Set(groups.map((g) => g.key));
  const arrows: PlannedArrow[] = plan.edges.flatMap((e) => {
    // 묶음 끝: 안쪽 묶음이면 맨 바깥 묶음으로, 앱 묶음이 안 됐으면 첫 상자 끝으로
    const side = (k: string) => { const c = containers.find((x) => x.key === k); if (!c) return { ref: k }; const top = topContainer(containers, c); return { ref: c.members[0]!, ...(gset.has(top) ? { group: top } : {}) }; };
    const f = side(e.from), t = side(e.to);
    if (!refs.has(f.ref) || !refs.has(t.ref) || f.ref === t.ref) return [];
    const label = e.label ?? RELATION_SPEC[e.relation]?.chip?.[locale];
    const marks = { ...(e.negated ? { negated: true } : {}), ...(e.sign ? { sign: e.sign } : {}), ...(e.order !== undefined ? { order: e.order } : {}), ...(e.reply ? { reply: true } : {}), ...(e.prob ? { prob: e.prob } : {}) };
    return [{
      from: f.ref, to: t.ref, relation: e.relation, ai: runInfo(plan, opts), ...(label ? { label } : {}),
      ...(f.group ? { fromGroup: f.group } : {}), ...(t.group ? { toGroup: t.group } : {}), ...(Object.keys(marks).length ? { marks } : {}),
    }];
  });
  return { runId: plan.runId, blocks, arrows, groups, bounds: unionRects(blocks.map((b) => b.rect)) ?? { x: at.x, y: at.y, w: 0, h: 0 } };
}

/** 모양 묶음이 되는 원형 → 묶음 모양 */
const SHAPES: Readonly<Record<string, GroupMeta['shape']>> = { timeline: 'timeline', matrix: 'matrix', scale: 'scale', venn: 'venn', fishbone: 'fishbone' };

/** v2 노드 필드 중 블록에 저장하는 것 (원문 그대로 — 계산하지 않는다) */
function blockMeta(n: StructureNode): BlockMeta | undefined {
  const m: { -readonly [K in keyof BlockMeta]: BlockMeta[K] } = {};
  if (n.status) m.status = n.status;
  if (n.emphasis) m.emphasis = n.emphasis;
  if (n.hedge) m.hedge = true;
  for (const k of ['role', 'speaker', 'owner', 'time', 'start', 'end', 'due'] as const) { const v = n[k]?.trim(); if (v) m[k] = v.slice(0, k === 'role' ? 24 : 40); }
  return Object.keys(m).length ? m : undefined;
}

function topContainer(cs: readonly StructureContainer[], c: StructureContainer): string {
  let cur = c;
  for (let i = 0; i < 10 && cur.parent; i++) { const p = cs.find((x) => x.key === cur.parent); if (!p) break; cur = p; }
  return cur.key;
}

/** 노드 → 맨 바깥 묶음 key, 노드 → 가장 안쪽 묶음 이름 (안쪽 묶음에 든 노드만) */
function containerIndex(cs: readonly StructureContainer[]): { topOf: Map<string, string>; innerTitle: Map<string, string> } {
  const topOf = new Map<string, string>(), innerTitle = new Map<string, string>();
  const depth = (c: StructureContainer) => { let d = 0, cur = c; while (cur.parent && d < 10) { const p = cs.find((x) => x.key === cur.parent); if (!p) break; cur = p; d++; } return d; };
  for (const c of [...cs].sort((a, b) => depth(a) - depth(b))) {
    for (const m of c.members) {
      if (!topOf.has(m)) topOf.set(m, topContainer(cs, c));
      if (c.parent && c.title) innerTitle.set(m, c.title);
    }
  }
  return { topOf, innerTitle };
}

/** `at`에서 시작해 나선으로 돌며 기존 블록과 (gap 여유를 두고) 겹치지 않는 첫 자리 (ENGINE 10.4 findFreeRect) */
export function findFreeSpot(engine: Pick<Engine, 'queryBlocks'>, r: Rect, gap: number): Vec2 {
  const free = (x: number, y: number) => engine.queryBlocks({ x: x - gap, y: y - gap, w: r.w + 2 * gap, h: r.h + 2 * gap }).length === 0;
  if (free(r.x, r.y)) return { x: r.x, y: r.y };
  const step = Math.max(64, Math.min(r.w, r.h) / 2);
  for (let ring = 1; ring <= 64; ring++) {
    // 고리 위의 칸을 오른쪽 → 아래 → 왼쪽 → 위 순서로 (오른쪽 · 아래가 읽기 순서상 자연스럽다)
    const cells: [number, number][] = [];
    for (let i = -ring; i <= ring; i++) cells.push([ring, i]);
    for (let i = ring - 1; i >= -ring; i--) cells.push([i, ring]);
    for (let i = ring - 1; i >= -ring; i--) cells.push([-ring, i]);
    for (let i = -ring + 1; i < ring; i++) cells.push([i, -ring]);
    for (const [cx, cy] of cells) {
      const x = r.x + cx * step, y = r.y + cy * step;
      if (free(x, y)) return { x, y };
    }
  }
  return { x: r.x, y: r.y };
}

// ───────── 적용 ─────────

export type ApplyResult =
  | {
    readonly ok: true; readonly runId: string; readonly txId: string;
    readonly blockIds: readonly Id[]; readonly arrowIds: readonly Id[]; readonly contentIds: readonly Id[];
    /** MSG-AI-024 "블록 {n}개 · 화살표 {m}개 · 그래프 {g}개 · 표 {t}개" */
    readonly counts: { readonly blocks: number; readonly arrows: number; readonly charts: number; readonly tables: number };
    readonly bounds: Rect;
  }
  | { readonly ok: false; readonly reason: string };

/**
 * 구조화 결과를 `at` 근처에 배치해 한 트랜잭션으로 반영 (FR-105~109). 불변식 위반이면 엔진이 전부 롤백하고 ok:false.
 * 전체 맞춤(FR-012)은 뷰포트 조작이라 앱이 `bounds`로 한다.
 * 빈 계획이면 바뀌는 것 없이 ok(블록 0개, undo 엔트리 없음) — 앱은 MSG-AI-027을 띄운다.
 */
export function applyStructure(engine: Engine, plan: StructurePlan, at: Vec2, opts: ApplyOptions = {}): ApplyResult {
  // 빈 자리 찾기: 기존 블록과 자유 필기 — 결과가 손글씨를 덮지 않게 (교차 검토 B6).
  // 다시 구조화면 바꿀 상자는 없는 셈 친다 (그 자리에 새 결과가 들어간다)
  const rep = new Set(opts.replace ?? []);
  const ink = freeStrokes(engine).map((s) => ({ id: s.id, r: strokeBounds(s) }));
  const p = planApply({ queryBlocks: (q: Rect) => [...engine.queryBlocks(q).filter((id) => !rep.has(id)), ...ink.filter((x) => rectsIntersect(x.r, q)).map((x) => x.id)] }, plan, at, opts);
  const r = engine.transact((tx) => {
    const outer = dropReplaced(engine, tx, rep);
    const ids = new Map<string, Id>();
    const blockIds: Id[] = [], contentIds: Id[] = [], arrowIds: Id[] = [];
    // v2 묶음 → 노트 묶음 (이름 · 종류 · 괄호 · 출처)
    const gids = new Map(p.groups.map((g) => [g.key, newId()]));
    if (p.groups.length) tx.setNote({ groups: { ...engine.note.groups, ...Object.fromEntries(p.groups.map((g) => [gids.get(g.key)!, g.meta])) } });
    for (const b of p.blocks) {
      // AI 블록은 항상 flow · auto 높이 (PRD "AI 블록은 항상 flow", ENGINE 10.4)
      const gid = b.group ? gids.get(b.group) : undefined;
      const id = tx.createBlock({ ...b.rect, layout: 'flow', ...(b.fixed ? { sizing: 'fixed', minH: b.rect.h } : { sizing: 'auto', ...(b.minH ? { minH: b.minH } : {}) }), ai: b.ai, ...(b.nodeKind ? { nodeKind: b.nodeKind } : {}), ...b.meta, ...(gid ? { group: gid } : {}) });
      ids.set(b.ref, id);
      blockIds.push(id);
      if (b.content.type === 'text') {
        // 엔진 스키마 v3: 본문 없는 노드는 제목 상자, 본문이 있으면 내용 상자(첫 줄 제목3 + 본문)
        const kind = nodeBoxKind(b.content.doc);
        contentIds.push(tx.createContent({
          type: 'text', blockId: id, ai: b.ai,
          ...(kind === 'title' ? { role: 'title', doc: toTitleDoc(b.content.doc) } : { role: 'body', doc: b.content.doc }),
        }));
      } else {
        contentIds.push(tx.createContent({ ...b.content, blockId: id, ai: b.ai }));
      }
    }
    // 차트 · 표가 붙은 노드 (v6 attachTo — 느슨한 참조)
    for (const b of p.blocks) { const t = b.attachTo && ids.get(b.attachTo); if (t) tx.set('block', ids.get(b.ref)!, { attachTo: t }); }
    for (const a of p.arrows) {
      const from = ids.get(a.from), to = ids.get(a.to);
      if (!from || !to) tx.fail(`화살표 끝 블록 없음: ${a.from} → ${a.to}`);
      const fg = a.fromGroup ? gids.get(a.fromGroup) : undefined, tg = a.toGroup ? gids.get(a.toGroup) : undefined;
      arrowIds.push(tx.createArrow({
        from: { blockId: from!, side: 'auto', ...(fg ? { groupId: fg } : {}) }, to: { blockId: to!, side: 'auto', ...(tg ? { groupId: tg } : {}) },
        ai: a.ai, relation: a.relation, ...(a.label ? { label: a.label } : {}), ...a.marks,
      }));
    }
    // 다시 구조화: 바깥과 이어졌던 화살표를 제목이 같은 새 상자로 다시 잇는다
    if (outer.length) relink(tx, outer, new Map(p.blocks.flatMap((b) => (b.content.type === 'text' ? [[normTitle(docText(b.content.doc).split('\n')[0] ?? ''), ids.get(b.ref)!] as const] : []))));
    return { blockIds, contentIds, arrowIds };
  }, { origin: 'ai', label: rep.size ? 'AI 다시 구조화' : 'AI 구조화' });
  if (!r.ok) return r;
  return {
    ok: true, runId: p.runId, txId: r.txId, ...r.value, bounds: p.bounds,
    counts: {
      blocks: p.blocks.filter((b) => b.kind === 'node').length, arrows: p.arrows.length,
      charts: p.blocks.filter((b) => b.kind === 'chart').length, tables: p.blocks.filter((b) => b.kind === 'table').length,
    },
  };
}
