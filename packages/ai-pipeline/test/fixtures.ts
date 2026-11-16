// 테스트 공용: eval/structure 케이스 로딩, expected.json → emit_structure 입력 변환, 가짜 transport · Claude 응답.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type Anthropic from '@anthropic-ai/sdk';
import {
  STRUCTURE_PROMPT_VERSION, type ClaudeCall, type StructureChunkRequest, type StructureChunkResult,
  type StructureKind, type StructureTransport, type StructureV1, type Relation, type ChartKind,
} from '../src';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const EVAL_DIR = join(ROOT, 'eval', 'structure');

export interface ExpectedCase {
  id: string;
  category: string;
  lang: 'ko' | 'en';
  kinds: StructureKind[];
  aliases: Record<string, string[]>;
  mustNodes: string[];
  mustEdges: { from: string; to: string; relation: string | string[] }[];
  charts: { kind: string | string[]; unit?: string; title?: string; series: { name: string; points: { x: string | number; y: number }[] }[] }[];
  tables: { columns: string[]; rowLabels?: string[]; exactColumns?: boolean; title?: string }[];
  forbid: { charts?: boolean; tables?: boolean; numbers: number[]; chartNumbers?: number[]; nodeTitles: string[]; substrings: string[] };
  mustCallTool?: boolean;
  /** 구조 판별 기대 (STRUCTURE-GUIDE 2.2): 주 구조로 맞다고 볼 구조 ID들 · 모범 답안의 배치 원형 */
  structure?: { primary: string[]; pattern: string };
  /** 갈래 기대 (NOTE-SHEET-PLAN NS-17) — 없으면 'diagram'. 둘 다 맞으면 배열 */
  mode?: 'sheet' | 'diagram' | ('sheet' | 'diagram')[];
  /** 노트형 기대: 카드(원문 소제목) · 허용 조각 종류(첫째가 모범 답안) · 지킬 원문 구절 · 별점 */
  sheet?: { title?: string; anyOrder?: boolean; cards: SheetCard[] };
}

export interface SheetCard { title: string; pieces: string[]; keep: string[]; ratings?: { label: string; value: number; max?: number }[]; table?: number }

export interface EvalCase { id: string; source: string; expected: ExpectedCase }

export function loadEvalCases(): EvalCase[] {
  return readdirSync(EVAL_DIR).filter((f) => f.endsWith('.expected.json')).sort().map((f) => {
    const id = f.replace(/\.expected\.json$/, '');
    return {
      id,
      source: readFileSync(join(EVAL_DIR, `${id}.md`), 'utf8'),
      expected: JSON.parse(readFileSync(join(EVAL_DIR, f), 'utf8')) as ExpectedCase,
    };
  });
}

const first = <T>(v: T | T[]): T => (Array.isArray(v) ? v[0]! : v);

/**
 * 기대 결과 → "모범 답안" emit_structure 입력. 실제 모델 대신 가짜 transport가 이걸 돌려준다.
 * quote는 원문에서 제목이 그대로 보이면 그 제목, 아니면 생략.
 */
export function expectedToStructure(c: EvalCase): StructureV1 {
  const e = c.expected;
  if (e.sheet && (Array.isArray(e.mode) ? e.mode[0] : e.mode) === 'sheet') return sheetAnswer(c);
  const key = new Map(e.mustNodes.map((t, i) => [t, `n${i + 1}`]));
  // 구조 기대가 있으면 v2 — 주 구조 하나(모든 노드) · 원형 배치까지 거친다
  const v2 = e.structure ? {
    version: 'structure.v2' as const,
    patterns: [{ key: 'p1', id: e.structure.primary[0]!, pattern: e.structure.pattern, primary: true, ...(e.mustNodes.length ? { nodes: e.mustNodes.map((t) => key.get(t)!) } : {}) }],
  } : {};
  return {
    ...v2,
    nodes: e.mustNodes.map((t) => ({
      key: key.get(t)!, title: t, kind: 'concept' as const,
      ...(c.source.includes(t) ? { source: { quote: t } } : {}),
    })),
    edges: e.mustEdges.map((x) => ({ from: key.get(x.from)!, to: key.get(x.to)!, relation: first(x.relation) as Relation })),
    charts: e.charts.map((ch, i) => ({
      key: `c${i + 1}`, kind: first(ch.kind) as ChartKind,
      ...(ch.unit ? { unit: ch.unit } : {}), ...(ch.title ? { title: ch.title } : {}),
      series: ch.series.map((s) => ({ name: s.name, points: s.points.map((p) => ({ x: p.x, y: p.y })) })),
    })),
    tables: e.tables.map((t, i) => {
      // exactColumns:false면 기대 열은 기준 열만이다(항목 이름 열은 채점 제외) — 첫 열을 붙여 준다
      const columns = t.exactColumns ? t.columns : ['항목', ...t.columns];
      return {
        key: `t${i + 1}`, columns,
        rows: (t.rowLabels?.length ? t.rowLabels : ['—']).map((l) => [l, ...columns.slice(1).map(() => '—')]),
      };
    }),
  };
}

/** 노트형 모범 답안 — 카드마다 첫 허용 조각을 지킬 구절로 채운다 (가짜 transport용, 평가 전용) */
export function sheetAnswer(c: EvalCase): StructureV1 {
  const e = c.expected, s = e.sheet!;
  const tables = e.tables.map((t, i) => {
    const columns = t.exactColumns ? t.columns : ['항목', ...t.columns];
    return { key: `t${i + 1}`, columns, rows: (t.rowLabels?.length ? t.rowLabels : ['—']).map((l) => [l, ...columns.slice(1).map(() => '—')]) };
  });
  const piece = (card: SheetCard) => {
    const k = card.keep, half = Math.ceil(k.length / 2);
    switch (card.pieces[0] ?? 'text') {
      case 'checklist': return { type: 'checklist', items: k };
      case 'chips': return { type: 'chips', items: k };
      case 'flow': return { type: 'flow', steps: k };
      case 'compare': return { type: 'compare', left: { items: k.slice(0, half) }, right: { items: k.slice(half) } };
      case 'rating': return { type: 'rating', rows: card.ratings ?? [] };
      case 'table': return { type: 'table', table: `t${(card.table ?? 0) + 1}` };
      case 'callout': return { type: 'callout', md: k.join('\n'), icon: 'bulb' };
      case 'quote': return { type: 'quote', md: k.join(' ') };
      case 'conclusion': return { type: 'conclusion', md: k.join(' ') };
      default: return { type: 'text', md: k.map((x) => `- ${x}`).join('\n') };
    }
  };
  return {
    version: 'structure.v2', mode: 'sheet', nodes: [], edges: [], charts: [], tables,
    sheet: { ...(s.title ? { title: s.title } : {}), sections: s.cards.map((card) => ({ title: card.title, pieces: [piece(card)] })) },
  } as unknown as StructureV1;
}

/** 미리 정한 결과를 돌려주는 transport (네트워크 없음). `fn`으로 요청을 보고 결과를 고를 수 있다 */
export function fakeTransport(
  fn: (req: StructureChunkRequest, call: number) => unknown | Promise<unknown>,
  opts: { stages?: boolean; model?: string } = {},
): StructureTransport & { requests: StructureChunkRequest[] } {
  const requests: StructureChunkRequest[] = [];
  return {
    kind: 'fake',
    requests,
    async structureChunk(req, ev): Promise<StructureChunkResult> {
      requests.push(req);
      if (opts.stages) { ev.onStage?.('thinking'); ev.onStage?.('emitting'); }
      const structure = await fn(req, requests.length - 1);
      return {
        runId: req.runId, chunk: req.chunk.index, structure,
        usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 },
        model: opts.model ?? 'claude-sonnet-5-5', promptVersion: STRUCTURE_PROMPT_VERSION, promptRevision: 1,
      };
    },
  };
}

// ───────── 가짜 Claude 응답 ─────────

export function message(content: unknown[], stop: Anthropic.StopReason = 'tool_use', extra: Partial<Anthropic.Message> = {}): Anthropic.Message {
  return {
    id: 'msg_fake', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: content as Anthropic.ContentBlock[],
    stop_reason: stop, stop_sequence: null, stop_details: null,
    usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 800, cache_creation_input_tokens: 0 } as Anthropic.Usage,
    ...extra,
  } as Anthropic.Message;
}
export const thinkingBlock = { type: 'thinking', thinking: '', signature: 'sig-abc' };
export const toolUse = (input: unknown, id = 'toolu_1') => ({ type: 'tool_use', id, name: 'emit_structure', input });

/** 정해 둔 응답을 순서대로 돌려주는 ClaudeCall. 받은 요청은 `calls`에 (깊은 복사) */
export function scriptedCall(responses: (Anthropic.Message | Error)[]): ClaudeCall & { calls: Anthropic.MessageCreateParamsNonStreaming[] } {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const fn = (async (params: Anthropic.MessageCreateParamsNonStreaming) => {
    calls.push(structuredClone(params));
    const r = responses.shift();
    if (!r) throw new Error('응답이 더 없음');
    if (r instanceof Error) throw r;
    return r;
  }) as unknown as ClaudeCall & { calls: typeof calls };
  fn.calls = calls;
  return fn;
}

export const sample: StructureV1 = {
  title: '결론',
  nodes: [
    { key: 'n1', title: '리팩터링을 미루면', kind: 'concept', source: { quote: '리팩터링을 미루면 기술 부채가 쌓이고' } },
    { key: 'n2', title: '기술 부채', kind: 'concept' },
    { key: 'n3', title: '배포 속도 저하', kind: 'conclusion' },
  ],
  edges: [{ from: 'n1', to: 'n2', relation: 'causes' }, { from: 'n2', to: 'n3', relation: 'leads-to' }],
  charts: [{ key: 'c1', kind: 'line', title: '팀 A의 배포 횟수', unit: '회', attachTo: 'n3',
    series: [{ name: '배포 횟수', points: [{ x: '1월', y: 24 }, { x: '2월', y: 17 }, { x: '3월', y: 9 }] }] }],
  tables: [],
};
export const sampleSource = '## 결론\n리팩터링을 미루면 기술 부채가 쌓이고, 기술 부채는 배포 속도 저하로 이어집니다. 실제로 팀 A의 배포 횟수는 1월 24회, 2월 17회, 3월 9회로 줄었습니다.';
