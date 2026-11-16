// structure.v1 · v2 결과 타입 · 검증 · 정리 (FR-100, API.md 4 · 4.1, AI-PROMPTS 8.5 · 9.1 · 16.3, STRUCTURE-GUIDE 5절).
// v2는 v1의 상위 집합 — 응답의 version이 'structure.v2'면 v2 스키마로 검사하고 묶음 · 구조 판별을 다듬는다(structure-v2.ts).
// 검증은 두 층이다: "응답 전체 위반"이면 교정 재요청(모드 A), "항목 단위 위반"이면 그 항목만 버리고 나머지를 쓴다.
import { brief, pointer, STRUCTURE_SCHEMA, STRUCTURE_SCHEMA_V2, validateSchema, type JsonSchema, type SchemaIssue } from './schema';
import { cleanContainers, cleanPatterns } from './structure-v2';
import { checkSheetNumbers, cleanSheet, type StructureSheet } from './sheet';

export type StructureKind = 'relation' | 'chart' | 'table';
export const ALL_KINDS: readonly StructureKind[] = ['relation', 'chart', 'table'];

export type NodeKindV1 = 'concept' | 'step' | 'option' | 'claim' | 'evidence' | 'question' | 'conclusion';
/** v2 노드 종류 = 노트 v6 블록 nodeKind (engine-core NODE_KINDS와 같은 값) */
export type NodeKind = NodeKindV1
  | 'definition' | 'theorem' | 'assumption' | 'contradiction' | 'rebuttal' | 'condition' | 'decision' | 'action' | 'goal' | 'event' | 'state' | 'actor'
  | 'premise' | 'problem' | 'rule' | 'example' | 'risk';
export type RelationV1 = 'causes' | 'leads-to' | 'part-of' | 'example-of' | 'contrasts' | 'supports' | 'depends-on' | 'next';
/** v2 관계 = 노트 v6 화살표 relation (engine-core RELATIONS와 같은 값) */
export type Relation = RelationV1
  | 'refutes' | 'implies' | 'equivalent' | 'kind-of' | 'inhibits' | 'answers' | 'transitions' | 'serves' | 'becomes' | 'flows-to'
  | 'subset-of' | 'maps-to' | 'symbolizes' | 'relates' | 'sends' | 'elaborates' | 'solves' | 'analogous-to' | 'correlates' | 'moderates';
export type ChartKind = 'bar' | 'line' | 'pie';

export interface Span { quote: string }
export interface StructureNode {
  key: string; title: string; kind: NodeKind; body?: string; group?: string; source?: Span;
  // v2 (STRUCTURE-GUIDE 5.4) — 모두 원문 그대로
  role?: string; status?: 'belief' | 'refuted' | 'before' | 'wrong' | 'deferred'; emphasis?: 'strong' | 'warning'; hedge?: boolean;
  speaker?: string; math?: string; time?: string; start?: string; end?: string; due?: string; owner?: string; order?: number;
  axis?: { x?: string; y?: string }; members?: string[];
}
/** from · to: 노드 key, v2는 묶음(containers) key도 */
export interface StructureEdge { from: string; to: string; relation: Relation; label?: string; sign?: '+' | '-'; negated?: boolean; prob?: string; order?: number; reply?: boolean }
/** v2 묶음 (5.7) */
export interface StructureContainer { key: string; title?: string; kind: string; members: string[]; parent?: string; role?: string }
/** v2 구조 판별 (5.8) */
export interface StructurePattern {
  key?: string; id: string; pattern: string; primary?: boolean;
  nodes?: string[]; containers?: string[]; charts?: string[]; tables?: string[];
  frame?: string; in?: string; with?: string; mix?: 'nested' | 'beside' | 'overlap' | 'shift'; order?: number; span?: string;
  direction?: 'LR' | 'RL' | 'TB' | 'BT'; slots?: string[]; caption?: string; axis?: { x?: string; y?: string }; orderFrom?: 'top' | 'bottom'; parent?: string;
}
export interface ChartPoint { x: string | number; y: number }
export interface ChartSeries { name: string; points: ChartPoint[] }
export interface StructureChart { key: string; kind: ChartKind; title?: string; unit?: string; series: ChartSeries[]; attachTo?: string; source?: Span }
export interface StructureTable { key: string; title?: string; columns: string[]; rows: string[][]; attachTo?: string; source?: Span }

/** emit_structure 도구 입력 = schemas/structure.v1.json · structure.v2.json (v2는 version · containers · patterns · 새 kind · 관계 · 필드) */
export interface Structure {
  version?: 'structure.v2';
  title?: string;
  nodes: StructureNode[];
  edges: StructureEdge[];
  charts: StructureChart[];
  tables: StructureTable[];
  containers?: StructureContainer[];
  patterns?: StructurePattern[];
  /** v2 노트형 (docs/research/NOTE-SHEET-PLAN.md) — mode 'sheet'면 sheet의 카드로 놓는다 */
  mode?: 'diagram' | 'sheet';
  /** v2 노트 키워드 (AI 자동 태그) — 원문에 있는지는 파이프라인이 원문과 대조한다 */
  keywords?: string[];
  sheet?: StructureSheet;
}
/** 옛 이름 — v1 · v2 모두 Structure */
export type StructureV1 = Structure;

/** 정리 결과의 버린 항목 기록 — 사용자 안내(MSG-AI-030)와 실행 로그용 */
export interface DroppedItem { readonly path: string; readonly reason: string }

export type CheckResult =
  | { readonly ok: true; readonly value: Structure; readonly dropped: readonly DroppedItem[] }
  | { readonly ok: false; readonly violations: readonly SchemaIssue[] };

const CAPS = { nodes: 60, edges: 120, charts: 10, tables: 10 } as const;
const ARRAYS = ['nodes', 'edges', 'charts', 'tables'] as const;
const LABEL_MAX = 24;


/**
 * 응답 정리. API 4.1 · AI-PROMPTS 8.5 · 9.1 규칙을 이 순서로 적용한다:
 * 1) 전체 위반(최상위 형식 · 필수 배열 · 정의 밖 속성 · 노드 key 중복) → `ok:false`
 * 2) 개수 상한 초과 → 앞에서부터 상한까지 (위반이 아니라 자르기)
 * 3) 고칠 수 있는 필드는 필드만 버림: 엣지 label(빈 문자열 · 24자 초과), attachTo(없는 노드), 표 행 길이(채우거나 자름)
 * 4) 나머지 항목 단위 위반 → 그 항목만 버림. key 형식이 틀린 노드는 연결 엣지도 함께 버린다
 * 5) `kinds`에 없는 종류는 배열째 버림 (모델이 인젝션으로 kinds를 어겨도 앱이 강제, 13.2)
 * 6) 비어 있지 않은 배열이 있었는데 남은 항목이 하나도 없으면 전체 위반
 */
export function checkStructure(raw: unknown, kinds: readonly StructureKind[] = ALL_KINDS): CheckResult {
  const whole: SchemaIssue[] = [];
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, violations: [{ path: '', rule: 'type', detail: '최상위는 객체여야 함' }] };
  }
  const obj = raw as Record<string, unknown>;
  // v2: version으로 스키마를 고른다 (5.1 #2)
  const v2 = obj.version === 'structure.v2';
  const root = v2 ? STRUCTURE_SCHEMA_V2 : STRUCTURE_SCHEMA;
  const defs = root.properties!;
  const itemSchema = (k: string) => defs[k]!.items as JsonSchema;
  for (const k of ARRAYS) {
    if (!(k in obj)) whole.push({ path: `/${k}`, rule: 'required', detail: '필수 배열 누락' });
    else if (!Array.isArray(obj[k])) whole.push({ path: `/${k}`, rule: 'type', detail: 'array 이어야 함' });
  }
  for (const k of Object.keys(obj)) {
    if (!(k in defs)) whole.push({ path: pointer([k]), rule: 'additionalProperties', detail: '정의되지 않은 최상위 속성' });
  }
  if (whole.length) return { ok: false, violations: whole };

  const seen = new Map<string, number>();
  (obj.nodes as unknown[]).forEach((n, i) => {
    const key = (n as { key?: unknown } | null)?.key;
    if (typeof key !== 'string') return;
    const first = seen.get(key);
    if (first !== undefined) whole.push({ path: `/nodes/${i}/key`, rule: 'unique', detail: `key ${brief(key)} 중복 (/nodes/${first}과 같음)` });
    else seen.set(key, i);
  });
  if (whole.length) return { ok: false, violations: whole };

  const dropped: DroppedItem[] = [];
  const drop = (path: string, reason: string) => dropped.push({ path, reason });
  const inputCount = ARRAYS.reduce((s, k) => s + (obj[k] as unknown[]).length, 0);

  const capped = <T>(k: (typeof ARRAYS)[number]): T[] => {
    const arr = obj[k] as T[];
    if (arr.length > CAPS[k]) drop(`/${k}`, `상한 ${CAPS[k]}개 초과 — 앞에서부터 ${CAPS[k]}개만 사용 (${arr.length}개)`);
    return arr.slice(0, CAPS[k]);
  };
  const itemValid = (k: (typeof ARRAYS)[number], v: unknown, i: number): boolean => {
    const issues = validateSchema(v, itemSchema(k), root, [k, i]);
    if (issues.length) drop(`/${k}/${i}`, issues.map((x) => `${x.path} ${x.rule}`).slice(0, 3).join(', '));
    return issues.length === 0;
  };

  // 노드
  const nodes: StructureNode[] = [];
  const badKeys = new Set<string>();
  capped<unknown>('nodes').forEach((n, i) => {
    if (itemValid('nodes', n, i)) nodes.push(clone(n as StructureNode));
    else if (typeof (n as { key?: unknown })?.key === 'string') badKeys.add((n as { key: string }).key);
  });
  const nodeKeys = new Set(nodes.map((n) => n.key));
  // v2 묶음 — 화살표가 묶음을 가리킬 수 있으니 엣지보다 먼저
  const containers = v2 && Array.isArray(obj.containers) ? cleanContainers(obj.containers, nodeKeys, (v, i) => validateSchema(v, itemSchema('containers'), root, ['containers', i]), drop) : undefined;
  const endKeys = new Set([...nodeKeys, ...(containers ?? []).map((c) => c.key)]);

  // 엣지
  const edges: StructureEdge[] = [];
  const edgeSeen = new Set<string>();
  capped<unknown>('edges').forEach((e0, i) => {
    let e = e0;
    if (e && typeof e === 'object' && 'label' in e) {
      const l = (e as { label: unknown }).label;
      if (typeof l !== 'string' || !l.trim() || l.length > LABEL_MAX) {
        const { label: _l, ...rest } = e as Record<string, unknown>;
        e = rest;
        drop(`/edges/${i}/label`, '라벨 형식 위반 — 기본 라벨 사용');
      }
    }
    if (!itemValid('edges', e, i)) return;
    const edge = clone(e as StructureEdge);
    if (!endKeys.has(edge.from) || !endKeys.has(edge.to)) {
      drop(`/edges/${i}`, badKeys.has(edge.from) || badKeys.has(edge.to) ? '버린 노드에 연결된 엣지' : '없는 노드 key를 가리킴');
      return;
    }
    if (edge.from === edge.to) { drop(`/edges/${i}`, '자기 자신을 잇는 엣지'); return; }
    const sig = `${edge.from}\u0000${edge.to}\u0000${edge.relation}`;
    if (edgeSeen.has(sig)) { drop(`/edges/${i}`, '같은 (from, to, relation) 엣지 중복'); return; }
    edgeSeen.add(sig);
    edges.push(edge);
  });

  const fixAttach = <T extends { attachTo?: unknown }>(k: 'charts' | 'tables', v: T, i: number): T => {
    if (v && typeof v === 'object' && 'attachTo' in v && !(typeof v.attachTo === 'string' && nodeKeys.has(v.attachTo))) {
      const { attachTo: _a, ...rest } = v;
      drop(`/${k}/${i}/attachTo`, '없는 노드를 가리킴 — attachTo만 버림');
      return rest as T;
    }
    return v;
  };

  const charts: StructureChart[] = [];
  capped<Record<string, unknown>>('charts').forEach((c, i) => {
    const v = fixAttach('charts', c, i);
    if (itemValid('charts', v, i)) charts.push(clone(v as unknown as StructureChart));
  });

  const tables: StructureTable[] = [];
  capped<Record<string, unknown>>('tables').forEach((t0, i) => {
    let t = fixAttach('tables', t0, i);
    // 행 길이 ≠ 열 수 → 채우거나 자른다 (API 4.1). 빈 칸은 프롬프트 규칙과 같은 "—".
    if (t && Array.isArray(t.columns) && Array.isArray(t.rows)) {
      const n = t.columns.length;
      let fixed = false;
      const rows = (t.rows as unknown[]).map((r) => {
        if (!Array.isArray(r) || r.length === n) return r;
        fixed = true;
        return r.length > n ? r.slice(0, n) : [...r, ...Array(n - r.length).fill('—')];
      });
      if (fixed) { t = { ...t, rows }; drop(`/tables/${i}/rows`, '행 길이를 열 수에 맞춤'); }
    }
    if (itemValid('tables', t, i)) tables.push(clone(t as unknown as StructureTable));
  });

  let title: string | undefined;
  if ('title' in obj) {
    const issues = validateSchema(obj.title, defs.title!, root, ['title']);
    if (issues.length) drop('/title', '제목 형식 위반 — 제목만 버림');
    else title = obj.title as string;
  }

  const patternsRaw = v2 && Array.isArray(obj.patterns) ? obj.patterns : [];
  // 노트형: 카드 · 조각 정리 (표 · 도식 조각은 남은 표 · 구조 판별을 가리켜야)
  const defsV2 = (root.$defs ?? {}) as Record<string, JsonSchema>;
  const sheet = v2 && obj.sheet !== undefined
    ? cleanSheet(obj.sheet, (v, def, path) => validateSchema(v, defsV2[def]!, root, path), { tables: new Set(tables.map((t) => t.key)), patterns: new Set(patternsRaw.map((p) => (p as { key?: unknown })?.key).filter((k): k is string => typeof k === 'string')) }, drop)
    : undefined;
  const mode = v2 && (obj.mode === 'sheet' || obj.mode === 'diagram') ? obj.mode : undefined;
  // 노트 키워드: 형식이 틀린 것만 버린다 (# 떼기 · 20자 · 8개)
  const keywords = v2 && Array.isArray(obj.keywords)
    ? [...new Set((obj.keywords as unknown[]).filter((k): k is string => typeof k === 'string').map((k) => k.trim().replace(/^#+/, '').trim()).filter((k) => k && k.length <= 20))].slice(0, 8)
    : [];
  const kept = nodes.length + edges.length + charts.length + tables.length + (sheet?.sections.length ?? 0);
  if (inputCount > 0 && kept === 0) {
    return { ok: false, violations: dropped.slice(0, 30).map((d) => ({ path: d.path, rule: 'item', detail: d.reason })) };
  }

  const patterns = v2 && Array.isArray(obj.patterns)
    ? cleanPatterns(obj.patterns, { nodes: nodeKeys, containers: new Set((containers ?? []).map((c) => c.key)), charts: new Set(charts.map((c) => c.key)), tables: new Set(tables.map((t) => t.key)) }, (v, i) => validateSchema(v, itemSchema('patterns'), root, ['patterns', i]), drop)
    : undefined;
  const value = applyKinds({
    ...(v2 ? { version: 'structure.v2' as const } : {}), ...(title !== undefined ? { title } : {}), nodes, edges, charts, tables,
    ...(containers?.length ? { containers } : {}), ...(patterns?.length ? { patterns } : {}),
    ...(mode ? { mode } : {}), ...(sheet ? { sheet } : {}), ...(keywords.length ? { keywords } : {}),
  }, kinds, drop);
  return { ok: true, value, dropped };
}

/** enabled_kinds 강제 (8.5 · FR-142). relation이 꺼져 있으면 노드 · 엣지와 attachTo를 모두 뺀다. */
export function applyKinds(s: Structure, kinds: readonly StructureKind[], drop?: (path: string, reason: string) => void): Structure {
  const on = new Set(kinds);
  const out: Structure = { ...s };
  if (!on.has('relation')) {
    if (s.nodes.length || s.edges.length) drop?.('/nodes', 'relation이 꺼져 있어 노드 · 엣지를 버림');
    out.nodes = []; out.edges = []; delete out.containers; delete out.patterns;
    out.charts = s.charts.map(({ attachTo: _a, ...c }) => c);
    out.tables = s.tables.map(({ attachTo: _a, ...t }) => t);
  }
  if (!on.has('chart')) { if (s.charts.length) drop?.('/charts', 'chart가 꺼져 있어 버림'); out.charts = []; }
  if (!on.has('table')) { if (s.tables.length) drop?.('/tables', 'table이 꺼져 있어 버림'); out.tables = []; }
  return out;
}

/** 교정 재요청 MODE A의 {{VIOLATIONS}} — 한 줄에 하나, 최대 30줄 (repair.v1). */
export function formatViolations(vs: readonly SchemaIssue[], max = 30): string {
  const lines = vs.slice(0, max).map((v) => `- ${v.path || '/'}: ${v.rule} (${v.detail})`);
  if (vs.length > max) lines.push(`- ... and ${vs.length - max} more`);
  return lines.join('\n');
}

// ───────── 수치 검사 (AI-PROMPTS 16.3, eval/README 3.1과 같은 함수) ─────────

const NUM = /-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?/g;

/** 원문 수치 집합: 쉼표를 지운 값과 그 절댓값. 유니코드 마이너스(−) · en dash(–)는 `-`로. */
export function extractNumbers(src: string): Set<number> {
  const out = new Set<number>();
  for (const m of src.replace(/[−–]/g, '-').matchAll(NUM)) {
    const v = Number(m[0].replace(/,/g, ''));
    if (Number.isFinite(v)) { out.add(v); out.add(Math.abs(v)); }
  }
  return out;
}

/** 글에 있는데 원문 수치 집합에 없는 숫자 (쓴 그대로, 중복 없이). 줄 머리의 목록 번호('1.')는 세지 않는다 — 작성 도우미 미리보기 강조 (AI-PROMPTS 12.4) */
export function newNumbers(source: string, text: string): string[] {
  const nums = extractNumbers(source), out = new Set<string>();
  for (const m of text.replace(/^\s*\d+[.)]\s/gm, '').replace(/[−–]/g, '-').matchAll(NUM)) {
    const v = Number(m[0].replace(/,/g, ''));
    if (Number.isFinite(v) && !nums.has(v) && !nums.has(Math.abs(v))) out.add(m[0].replace(/^-/, ''));
  }
  return [...out];
}

export interface NumberCheck {
  readonly value: Structure;
  /** 버린 차트 점 수 + "—"로 비운 표 셀 수 (실행 로그 droppedNumbers) */
  readonly droppedPoints: number;
  readonly blankedCells: number;
}

/** 원문 별 표시('★★★☆☆')마다 채운 별 수 — 노트형 별점 검사에만 쓴다 (차트 · 표 수치에는 넣지 않는다) */
export const starCounts = (text: string): number[] => [...text.matchAll(/★+/g)].map((m) => m[0].length);

/**
 * 반영 전 필수 수치 검사. 차트 점의 y가 원문 수치 집합에 없으면 그 점을 버리고,
 * 점 0개 시리즈 · 시리즈 0개 차트 · 점이 1개만 남은 차트를 버린다. 표 셀의 숫자가 하나라도 없으면 셀을 "—"로.
 * 비교 대상은 청크가 아니라 정규화된 전체 원문이다.
 */
export function checkNumbers(s: Structure, sourceText: string | Set<number>, stars: readonly number[] = typeof sourceText === 'string' ? starCounts(sourceText) : []): NumberCheck {
  const nums = typeof sourceText === 'string' ? extractNumbers(sourceText) : sourceText;
  let droppedPoints = 0, blankedCells = 0;
  const charts: StructureChart[] = [];
  for (const c of s.charts) {
    const series = c.series
      .map((se) => {
        const points = se.points.filter((p) => nums.has(p.y));
        droppedPoints += se.points.length - points.length;
        return { ...se, points };
      })
      .filter((se) => se.points.length > 0);
    const total = series.reduce((n, se) => n + se.points.length, 0);
    if (series.length === 0 || total < 2) { droppedPoints += total; continue; }
    charts.push({ ...c, series });
  }
  const tables = s.tables.map((t) => {
    let n = 0;
    const rows = t.rows.map((r) => r.map((cell) => {
      const found = [...cell.replace(/[−–]/g, '-').matchAll(NUM)].map((m) => Number(m[0].replace(/,/g, '')));
      if (found.every((v) => nums.has(v))) return cell;
      n++;
      return '—';
    }));
    blankedCells += n;
    return n ? { ...t, rows } : t;
  });
  // 노트형 별점도 원문 수치일 때만 (원문에 없는 값의 줄은 글로) — 원문 별 표시 '★★★☆☆'는 채운 별 수(3)를 수치로 친다
  const sheet = s.sheet ? structuredClone(s.sheet) : undefined;
  if (sheet) droppedPoints += checkSheetNumbers(sheet, stars.length ? new Set([...nums, ...stars]) : nums);
  return { value: { ...s, charts, tables, ...(sheet ? { sheet } : {}) }, droppedPoints, blankedCells };
}

/** 제목 비교용 정규화 (eval/README 3.1 norm + API 4.1 병합 규칙: NFC · 공백 무시 · 대소문자 무시) */
export function normTitle(s: string): string {
  return s.normalize('NFC').replace(/\*\*|__|`/g, '').replace(/\s+/g, '').toLowerCase();
}

function clone<T>(v: T): T { return JSON.parse(JSON.stringify(v)) as T; }
