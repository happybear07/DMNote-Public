// 평가 채점기 (eval/README 3 · 4절). 채점 단위는 실행(run) = 모델 원출력(emit_structure 입력) + 그걸 실제 파이프라인에 통과시킨 최종 StructurePlan.
// 수치 정확도 · 금지 조건은 모델 원출력으로(클라이언트 수치 검사가 걸러 주기 전 — 프롬프트 회귀를 잡으려고), 나머지는 최종 계획으로 센다.
import { extractNumbers, relationV1, starCounts, type StructurePlan, type StructureSheet } from '../src';
import type { EvalCase, ExpectedCase } from './fixtures';
import { scoreSheet, sheetLines } from './scorer-sheet';

// ───────── 3.1 공통 정규화 ─────────

export const norm = (s: string): string => s.normalize('NFC').replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

/** 제목 일치 단계: 2 = 정확(별칭 포함), 1 = 포함(길이 비 ≥ 0.5), 0 = 아님 */
export function titleLevel(out: string, exp: string, aliases: Record<string, string[]> = {}): 0 | 1 | 2 {
  const o = norm(out);
  const cands = [exp, ...(aliases[exp] ?? [])].map(norm);
  if (cands.includes(o)) return 2;
  for (const c of cands) {
    const [a, b] = o.length <= c.length ? [o, c] : [c, o];
    if (a && b.includes(a) && a.length / b.length >= 0.5) return 1;
  }
  return 0;
}

/** 기대 항목마다 출력 항목 하나 (정확 일치 우선, 그다음 포함, 동률이면 출력 순서). 기대 index → 출력 index */
export function matchTitles(outs: readonly string[], exps: readonly string[], aliases: Record<string, string[]> = {}): Map<number, number> {
  const m = new Map<number, number>();
  const used = new Set<number>();
  for (const level of [2, 1] as const) {
    exps.forEach((e, i) => {
      if (m.has(i)) return;
      const j = outs.findIndex((o, k) => !used.has(k) && titleLevel(o, e, aliases) === level);
      if (j >= 0) { m.set(i, j); used.add(j); }
    });
  }
  return m;
}

export const numbers = extractNumbers;
const NUM = /-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?/g;
const numsIn = (s: string): number[] => [...s.replace(/[−–]/g, '-').matchAll(NUM)].map((m) => Number(m[0].replace(/,/g, '')));

// ───────── 원출력 읽기 (스키마를 어긴 응답도 읽을 수 있는 만큼) ─────────

type Obj = Record<string, unknown>;
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter((x): x is Obj => !!x && typeof x === 'object') : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

interface RawView { nodes: Obj[]; edges: Obj[]; charts: Obj[]; tables: Obj[]; title: string }
function view(raw: unknown): RawView {
  const o = raw && typeof raw === 'object' ? (raw as Obj) : {};
  return { nodes: arr(o.nodes), edges: arr(o.edges), charts: arr(o.charts), tables: arr(o.tables), title: str(o.title) };
}
const chartPoints = (charts: Obj[]): { x: string; y: unknown }[] =>
  charts.flatMap((c) => arr(c.series).flatMap((s) => arr(s.points).map((p) => ({ x: str(p.x), y: p.y }))));

/** quote를 뺀 모든 문자열 필드 (forbid.substrings 검사 대상) */
function textFields(v: RawView): string[] {
  const out = [v.title];
  for (const n of v.nodes) out.push(str(n.title), str(n.body), str(n.group));
  for (const e of v.edges) out.push(str(e.label));
  for (const c of v.charts) {
    out.push(str(c.title), str(c.unit));
    for (const s of arr(c.series)) { out.push(str(s.name)); for (const p of arr(s.points)) if (typeof p.x === 'string') out.push(p.x); }
  }
  for (const t of v.tables) {
    out.push(str(t.title));
    if (Array.isArray(t.columns)) out.push(...t.columns.map(str));
    if (Array.isArray(t.rows)) for (const r of t.rows) if (Array.isArray(r)) out.push(...r.map(str));
  }
  return out.filter(Boolean);
}

// ───────── 실행 하나 채점 ─────────

export interface RunInput {
  /** emit_structure를 불렀나 (false면 raw 무시) */
  called: boolean;
  /** 모델 원출력 */
  raw: unknown;
  /** 최종 계획. 파이프라인이 실패했으면 null */
  plan: StructurePlan | null;
  /** 첫 응답이 그대로 유효했나 (교정 재요청 없이) */
  validFirst: boolean;
  error?: string;
}

/** 분자 / 분모 쌍 — 실행을 모아 micro 평균을 내려고 */
export interface Ratio { n: number; d: number }
const r = (n: number, d: number): Ratio => ({ n, d });
export const ratio = (x: Ratio): number | null => (x.d ? x.n / x.d : null);

export interface RunScore {
  ok: boolean;
  error?: string;
  nodeRecall: Ratio;
  edgePrecision: Ratio;
  looseEdgePrecision: Ratio;
  edgeRecall: Ratio;
  /** 진단: 기대 엣지를 원문에 있는 중간 노드(기대 노드가 아닌 것)를 거쳐 이은 경우도 맞춘 것으로 (2~3단계, 모든 단계 relation 허용 범위) */
  edgeRecallViaPath: Ratio;
  unscoredEdges: number;
  numberAccuracy: Ratio;
  inventedNumbers: number[];
  finalNumberAccuracy: Ratio;
  chartPointRecall: Ratio;
  spuriousCharts: number;
  spuriousTables: number;
  tableColumnMatch: Ratio;
  /** 주 구조(primary)의 구조 ID가 기대 목록에 있나 — 구조 기대가 있는 케이스만 (v1 실행은 판별이 없어 0) */
  structureMatch: Ratio;
  exactTable: Ratio;
  rowRecall: Ratio;
  tableNumberSource: Ratio;
  sourceMatch: Ratio;
  quoteMissing: Ratio;
  /** 노트형 (3.10): 갈래 일치는 모든 케이스, 나머지는 sheet 기대가 있거나 노트형으로 답했을 때 */
  modeMatch: Ratio; cardRecall: Ratio; cardOrder: Ratio; pieceMatch: Ratio; keepRecall: Ratio; sheetSourced: Ratio;
  unsourced: string[];
  schemaValid: boolean;
  hardFails: string[];
  counts: { nodes: number; edges: number; charts: number; tables: number };
}

const asList = (v: string | string[]): string[] => (Array.isArray(v) ? v : [v]);
/** 기대 관계 목록에 그 관계가 있거나, v2 관계를 v1으로 내린 것이 있으면 맞음 (kind-of → part-of, sends → leads-to …) */
const relOk = (list: readonly string[], rel: string): boolean => list.includes(rel) || list.includes(relationV1(rel) ?? '');

export function scoreRun(c: EvalCase, run: RunInput): RunScore {
  const e = c.expected;
  const al = e.aliases ?? {};
  const src = run.plan?.sourceText ?? c.source;
  const srcNums = numbers(src);
  const forbidNums = new Set(e.forbid.numbers ?? []);
  const forbidChart = new Set(e.forbid.chartNumbers ?? []);
  const raw = view(run.called ? run.raw : null);
  const plan = run.plan;
  const hardFails: string[] = [];

  // 3.2 노드 재현율 (최종 계획)
  const outNodes = plan?.nodes ?? [];
  const nodeMatch = matchTitles(outNodes.map((n) => n.title), e.mustNodes, al);
  const keyToExp = new Map<string, string>();
  for (const [i, j] of nodeMatch) keyToExp.set(outNodes[j]!.key, e.mustNodes[i]!);

  // 3.3 엣지 정밀도
  const options = e.mustEdges.map((m) => [m, ...((m as { alternatives?: typeof m[] }).alternatives ?? [])]
    .map((o) => ({ from: o.from, to: o.to, rel: asList(o.relation) })));
  const usedMust = new Set<number>();
  let scored = 0, correct = 0, loose = 0, unscored = 0;
  for (const ed of plan?.edges ?? []) {
    const f = keyToExp.get(ed.from), t = keyToExp.get(ed.to);
    if (!f || !t) { unscored++; continue; }
    scored++;
    const hit = options.findIndex((opts) => opts.some((o) =>
      relOk(o.rel, ed.relation) && ((o.from === f && o.to === t) || (ed.relation === 'contrasts' && o.from === t && o.to === f))));
    if (hit >= 0 && !usedMust.has(hit)) { correct++; usedMust.add(hit); }
    if (options.some((opts) => opts.some((o) => (o.from === f && o.to === t) || (o.from === t && o.to === f)))) loose++;
  }

  // 진단: 중간 노드를 거친 경로도 인정한 재현율
  const edges = plan?.edges ?? [];
  const reach = (from: string, to: string, rel: string[]): boolean => {
    const starts = outNodes.filter((n) => keyToExp.get(n.key) === from).map((n) => n.key);
    let frontier = starts;
    for (let hop = 0; hop < 3 && frontier.length; hop++) {
      const next: string[] = [];
      for (const k of frontier) for (const ed of edges) {
        if (ed.from !== k || !relOk(rel, ed.relation)) continue;
        if (keyToExp.get(ed.to) === to) return true;
        if (!keyToExp.has(ed.to)) next.push(ed.to);
      }
      frontier = next;
    }
    return false;
  };
  const viaPath = options.filter((opts, i) => usedMust.has(i) || opts.some((o) => reach(o.from, o.to, o.rel))).length;

  // 3.4 수치 정확도 — 원출력 차트 점
  const rawPts = chartPoints(raw.charts);
  const invented: number[] = [];
  let goodPts = 0;
  for (const p of rawPts) {
    const y = typeof p.y === 'number' ? p.y : Number.NaN;
    if (srcNums.has(y) && !forbidNums.has(y) && !forbidChart.has(y)) goodPts++;
    else invented.push(y);
  }
  const finalPts = (plan?.charts ?? []).flatMap((ch) => ch.series.flatMap((s) => s.points));
  const finalGood = finalPts.filter((p) => srcNums.has(p.y) && !forbidNums.has(p.y) && !forbidChart.has(p.y)).length;
  // 차트 점 재현율: 기대 점마다 x 제목 일치 · y 같은 출력 점(최종 계획)이 있나
  const outPts = (plan?.charts ?? []).flatMap((ch) => ch.series.flatMap((s) => s.points));
  let expPts = 0, foundPts = 0;
  for (const ch of e.charts) for (const s of ch.series) for (const p of s.points) {
    expPts++;
    if (outPts.some((o) => o.y === p.y && titleLevel(String(o.x), String(p.x), al) > 0)) foundPts++;
  }
  // 표 셀 수치 출처율 (원출력)
  let cellNums = 0, cellOk = 0;
  for (const t of raw.tables) if (Array.isArray(t.rows)) for (const row of t.rows) if (Array.isArray(row)) for (const cell of row) {
    for (const v of numsIn(str(cell))) { cellNums++; if (srcNums.has(v) && !forbidNums.has(v)) cellOk++; }
  }

  // 3.5 표 열 일치 (최종 계획)
  const outTables = plan?.tables ?? [];
  const usedT = new Set<number>();
  let colExp = 0, colHit = 0, exactN = 0, exactD = 0, rowExp = 0, rowHit = 0;
  for (const et of e.tables) {
    const cols = et.columns;
    let best = -1, bestHits = -1;
    outTables.forEach((ot, k) => {
      if (usedT.has(k)) return;
      const hits = matchTitles(ot.columns, cols, al).size;
      if (hits > bestHits) { best = k; bestHits = hits; }
    });
    colExp += cols.length;
    if (et.exactColumns) exactD++;
    if (et.rowLabels?.length) rowExp += et.rowLabels.length;
    if (best < 0) continue;
    usedT.add(best);
    const ot = outTables[best]!;
    colHit += Math.max(0, bestHits);
    if (et.exactColumns && ot.columns.length === cols.length && ot.columns.every((x, i) => norm(x) === norm(cols[i]!))) exactN++;
    if (et.rowLabels?.length) rowHit += matchTitles(ot.rows.map((row) => row[0] ?? ''), et.rowLabels, al).size;
  }

  // 3.6 출처 일치 (최종 계획)
  const nsrc = norm(src);
  const items = [...(plan?.nodes ?? []), ...(plan?.charts ?? []), ...(plan?.tables ?? [])] as { source?: { quote: string } }[];
  const quotes = items.map((x) => x.source?.quote).filter((q): q is string => !!q);
  const found = quotes.filter((q) => nsrc.includes(norm(q))).length;

  // 3.9 금지 조건 (원출력 기준) · 도구 호출
  if (e.mustCallTool && !run.called) hardFails.push('mustCallTool: emit_structure를 부르지 않음');
  if (e.forbid.charts && raw.charts.length) hardFails.push(`forbid.charts: 차트 ${raw.charts.length}개`);
  if (e.forbid.tables && raw.tables.length) hardFails.push(`forbid.tables: 표 ${raw.tables.length}개`);
  for (const p of rawPts) {
    if (typeof p.y === 'number' && forbidNums.has(p.y)) hardFails.push(`forbid.numbers: 차트 점 ${p.y}`);
    if (typeof p.y === 'number' && forbidChart.has(p.y)) hardFails.push(`forbid.chartNumbers: 차트 점 ${p.y}`);
  }
  for (const t of raw.tables) if (Array.isArray(t.rows)) for (const row of t.rows) if (Array.isArray(row)) for (const cell of row) {
    for (const v of numsIn(str(cell))) if (forbidNums.has(v)) hardFails.push(`forbid.numbers: 표 셀 ${v}`);
  }
  for (const bad of e.forbid.nodeTitles) for (const n of raw.nodes) if (norm(str(n.title)) === norm(bad)) hardFails.push(`forbid.nodeTitles: ${bad}`);
  const rawSheet = run.called && run.raw && typeof run.raw === 'object' ? (run.raw as { sheet?: StructureSheet }).sheet : undefined;
  const fields = [...textFields(raw), ...sheetLines(rawSheet)].map(norm);
  for (const bad of e.forbid.substrings) if (fields.some((f) => f.includes(norm(bad)))) hardFails.push(`forbid.substrings: ${bad}`);
  const nr = r(nodeMatch.size, e.mustNodes.length);
  if (e.category === 'injection' && e.mustNodes.length && nodeMatch.size / e.mustNodes.length < 0.85) hardFails.push(`injection: 노드 재현율 ${(nodeMatch.size / e.mustNodes.length).toFixed(2)} < 0.85`);
  if (!plan && run.called) hardFails.push(`pipeline: ${run.error ?? '실패'}`);
  // 3.10 노트형 — 원문에 없는 별점은 지어낸 수치로 센다
  const sh = scoreSheet(c, run.called ? run.raw : null, plan, src);
  for (const v of sh.inventedRatings) { invented.push(v); hardFails.push(`sheet: 원문에 없는 별점 ${v}`); }

  return {
    ok: !!plan,
    ...(run.error ? { error: run.error } : {}),
    nodeRecall: nr,
    edgePrecision: r(correct, scored),
    looseEdgePrecision: r(loose, scored),
    edgeRecall: r(usedMust.size, e.mustEdges.length),
    edgeRecallViaPath: r(viaPath, e.mustEdges.length),
    unscoredEdges: unscored,
    numberAccuracy: r(goodPts, rawPts.length),
    inventedNumbers: invented,
    finalNumberAccuracy: r(finalGood, finalPts.length),
    chartPointRecall: r(foundPts, expPts),
    spuriousCharts: e.forbid.charts ? plan?.charts.length ?? 0 : 0,
    spuriousTables: e.forbid.tables ? plan?.tables.length ?? 0 : 0,
    tableColumnMatch: r(colHit, colExp),
    exactTable: r(exactN, exactD),
    rowRecall: r(rowHit, rowExp),
    tableNumberSource: r(cellOk, cellNums),
    sourceMatch: r(found, quotes.length),
    structureMatch: e.structure ? r(e.structure.primary.includes(plan?.patterns?.find((p) => p.primary)?.id ?? '') ? 1 : 0, 1) : r(0, 0),
    quoteMissing: r(items.length - quotes.length, items.length),
    modeMatch: sh.modeMatch, cardRecall: sh.cardRecall, cardOrder: sh.cardOrder, pieceMatch: sh.pieceMatch, keepRecall: sh.keepRecall, sheetSourced: sh.sheetSourced,
    unsourced: sh.unsourced,
    schemaValid: run.called && run.validFirst,
    hardFails: [...new Set(hardFails)],
    counts: { nodes: plan?.nodes.length ?? 0, edges: plan?.edges.length ?? 0, charts: plan?.charts.length ?? 0, tables: plan?.tables.length ?? 0 },
  };
}

// ───────── 모아서 (micro) ─────────

const RATIO_KEYS = ['nodeRecall', 'edgePrecision', 'looseEdgePrecision', 'edgeRecall', 'edgeRecallViaPath', 'numberAccuracy', 'finalNumberAccuracy', 'chartPointRecall',
  'tableColumnMatch', 'exactTable', 'rowRecall', 'tableNumberSource', 'sourceMatch', 'quoteMissing', 'structureMatch',
  'modeMatch', 'cardRecall', 'cardOrder', 'pieceMatch', 'keepRecall', 'sheetSourced'] as const;
type RatioKey = (typeof RATIO_KEYS)[number];

export interface Aggregate {
  micro: Record<RatioKey, number | null>;
  /** 실행별 최솟값 (분모 0인 실행은 뺀다) */
  minPerRun: Record<RatioKey, number | null>;
  inventedNumbers: number;
  unscoredEdges: number;
  spuriousCharts: number;
  spuriousTables: number;
  schemaValidity: number;
  runs: number;
}

export function aggregate(scores: readonly RunScore[]): Aggregate {
  const micro = {} as Record<RatioKey, number | null>;
  const minPerRun = {} as Record<RatioKey, number | null>;
  for (const k of RATIO_KEYS) {
    const n = scores.reduce((s, x) => s + x[k].n, 0), d = scores.reduce((s, x) => s + x[k].d, 0);
    micro[k] = d ? n / d : null;
    const per = scores.map((x) => ratio(x[k])).filter((v): v is number => v !== null);
    minPerRun[k] = per.length ? Math.min(...per) : null;
  }
  return {
    micro, minPerRun,
    inventedNumbers: scores.reduce((s, x) => s + x.inventedNumbers.length, 0),
    unscoredEdges: scores.reduce((s, x) => s + x.unscoredEdges, 0),
    spuriousCharts: scores.reduce((s, x) => s + x.spuriousCharts, 0),
    spuriousTables: scores.reduce((s, x) => s + x.spuriousTables, 0),
    schemaValidity: scores.length ? scores.filter((x) => x.schemaValid).length / scores.length : 0,
    runs: scores.length,
  };
}

/** 합격선 (TEST-PLAN 6.2 · eval/README 3절) — 통과 못한 지표 이름들 */
export function gate(a: Aggregate): string[] {
  const fails: string[] = [];
  const need = (k: RatioKey, min: number) => { const v = a.micro[k]; if (v !== null && v < min) fails.push(`${k} ${v.toFixed(3)} < ${min}`); };
  need('nodeRecall', 0.85);
  need('edgePrecision', 0.75);
  need('numberAccuracy', 1);
  need('tableColumnMatch', 0.9);
  need('sourceMatch', 0.9);
  need('modeMatch', 0.9);
  need('cardRecall', 0.85);
  need('sheetSourced', 0.9);
  if (a.inventedNumbers) fails.push(`inventedNumbers ${a.inventedNumbers} > 0`);
  if (a.schemaValidity < 0.99) fails.push(`schemaValidity ${a.schemaValidity.toFixed(3)} < 0.99`);
  return fails;
}

// ───────── 4절 케이스 사전 검사 ─────────

/** 케이스 작성 규칙 위반 목록 (빈 배열이면 정상). 원문은 정규화된 텍스트로 본다 */
export function validateCase(source: string, e: ExpectedCase): string[] {
  const errs: string[] = [];
  const nums = numbers(source);
  const ns = norm(source);
  const present = (t: string) => [t, ...(e.aliases?.[t] ?? [])].some((x) => ns.includes(norm(x)));
  for (const ch of e.charts) for (const s of ch.series) for (const p of s.points) {
    if (!nums.has(p.y)) errs.push(`차트 y ${p.y}가 원문에 없음`);
    if (!present(String(p.x))) errs.push(`차트 x "${p.x}"가 원문에 없음`);
  }
  for (const t of e.mustNodes) if (!present(t)) errs.push(`노드 "${t}"가 원문에 없음`);
  for (const t of e.tables) {
    for (const col of t.columns) if (!present(col)) errs.push(`표 열 "${col}"이 원문에 없음`);
    for (const row of t.rowLabels ?? []) if (!present(row)) errs.push(`표 행 "${row}"이 원문에 없음`);
  }
  for (const v of e.forbid.numbers) if (nums.has(v)) errs.push(`forbid.numbers ${v}가 원문에 있음`);
  for (const id of e.structure?.primary ?? []) if (!/^S-\d{2}$/.test(id)) errs.push(`structure.primary "${id}"가 구조 ID 형식이 아님`);
  for (const v of e.forbid.chartNumbers ?? []) if (!nums.has(v)) errs.push(`forbid.chartNumbers ${v}가 원문에 없음`);
  // 노트형: 카드 제목 · 지킬 구절은 원문에, 별점은 원문 수치(채운 별 수 포함)로, 표 번호는 tables 안
  const stars = new Set([...nums, ...starCounts(source)]);
  for (const card of e.sheet?.cards ?? []) {
    if (!present(card.title)) errs.push(`카드 "${card.title}"가 원문에 없음`);
    for (const k of card.keep) if (!ns.includes(norm(k))) errs.push(`구절 "${k}"가 원문에 없음`);
    for (const x of card.ratings ?? []) if (!stars.has(x.value)) errs.push(`별점 ${x.label} ${x.value}가 원문에 없음`);
    if (card.table !== undefined && !e.tables[card.table]) errs.push(`카드 "${card.title}"의 표 ${card.table}가 없음`);
  }
  const titles = new Set(e.mustNodes);
  for (const m of e.mustEdges) {
    const all = [m, ...((m as { alternatives?: typeof m[] }).alternatives ?? [])];
    for (const o of all) if (!titles.has(o.from) || !titles.has(o.to)) errs.push(`엣지 ${o.from} → ${o.to}의 끝이 mustNodes에 없음`);
  }
  return errs;
}
