// 실제 API 평가 (eval/README 3절 지표): .env.local의 ANTHROPIC_API_KEY로 평가 케이스를 실제 파이프라인에 흘려
// 지연 · 토큰 · 비용 추정과 함께 eval/results/<날짜>-live-<판>.json에 쓴다. 돈이 드니 평소에는 건너뛴다: DN_LIVE=1 일 때만.
// 예: DN_LIVE=1 DN_LIVE_CASES=01,11 DN_LIVE_PROMPT=structure.v2 corepack pnpm exec vitest run packages/ai-pipeline/test/live-eval.test.ts
// 다시 채점만: DN_LIVE_FROM=eval/results/<파일>.json — 저장된 모델 답(raw)을 다시 흘린다(호출 없음, 돈 안 듦).
// 키 값은 어디에도 찍지 않는다. 결과는 평가 · 비교용이다 — Claude 출력을 학습 데이터로 쓰지 않는다(OWN-MODEL, AUP).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { Engine, setDefaultTextCodec } from '@dn/engine-core';
import { pmCodec } from '@dn/text-pm/headless';
import { applyStructure, DEFAULT_MODEL, structurePrompts, structureText, type ClaudeCall, type StructurePlan, type StructurePromptVersion } from '../src';
import { createAnthropicClient, createDirectTransport, sdkClaudeCall } from '../src/direct';
import { loadEvalCases, message, ROOT, scriptedCall, toolUse } from './fixtures';
import { aggregate, gate, ratio, scoreRun, type RunScore } from './scorer';

const FROM = process.env.DN_LIVE_FROM;
const ON = process.env.DN_LIVE === '1' || !!FROM;
const PROMPT = (process.env.DN_LIVE_PROMPT ?? 'structure.v2') as StructurePromptVersion;
const MODEL = process.env.DN_LIVE_MODEL ?? DEFAULT_MODEL;
const CASES = (process.env.DN_LIVE_CASES ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const RUNS = Number(process.env.DN_LIVE_RUNS ?? 1);
const DATE = process.env.DN_EVAL_DATE ?? new Date().toISOString().slice(0, 10);
const OUT = join(ROOT, 'eval', 'results');
/** 백만 토큰당 달러 (Sonnet 5.5: 입력 2 · 출력 10 · 캐시 읽기 0.2 · 캐시 쓰기 2.5) — 추정용 */
const PRICE = { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 };

function apiKey(): string {
  const f = join(ROOT, '.env.local');
  const line = existsSync(f) ? readFileSync(f, 'utf8').split(/\r?\n/).find((l) => l.startsWith('ANTHROPIC_API_KEY=')) : undefined;
  const k = line?.slice('ANTHROPIC_API_KEY='.length).trim() ?? '';
  if (!k) throw new Error('.env.local에 ANTHROPIC_API_KEY가 없음');
  return k;
}

beforeAll(() => setDefaultTextCodec(pmCodec));

describe.skipIf(!ON)('실제 API 평가', () => {
  it('케이스 → 실제 호출 → 파이프라인 → 엔진 → 지표', async () => {
    type Saved = { id: string; runs: { run: number; raw: unknown }[] };
    const saved = FROM ? (JSON.parse(readFileSync(join(ROOT, FROM), 'utf8')) as { perCase: Saved[] }).perCase : null;
    const call0 = saved ? null : sdkClaudeCall(createAnthropicClient({ apiKey: apiKey() }));
    const cases = loadEvalCases().filter((c) => !CASES.length || CASES.some((p) => c.id.startsWith(p)));
    const all: RunScore[] = [];
    const perCase: unknown[] = [];
    let cost = 0;
    for (const c of cases) {
      const runs = [];
      for (let run = 1; run <= RUNS; run++) {
        const seen: Anthropic.Message[] = [];
        const old = saved?.find((s) => s.id === c.id)?.runs.find((r) => r.run === run);
        if (saved && !old) continue;
        const replay = old ? scriptedCall([message([toolUse(old.raw)])]) : null;
        const call: ClaudeCall = async (p, o) => { const m = await (replay ?? call0!)(p, o); seen.push(m); return m; };
        const t0 = Date.now();
        let plan: StructurePlan | null = null, error: string | undefined;
        try {
          plan = await structureText({ text: c.source, kinds: c.expected.kinds, locale: c.expected.lang },
            { transport: createDirectTransport({ call }), model: MODEL, promptVersion: PROMPT, retryBaseMs: 2000 });
        } catch (e) { error = e instanceof Error ? `${e.name}: ${e.message}` : String(e); }
        const ms = Date.now() - t0;
        const toolInput = (m?: Anthropic.Message) => m?.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')?.input ?? null;
        const raw = toolInput(seen.at(-1));
        let applied: string | null = null;
        if (plan) {
          const res = applyStructure(new Engine(), plan, { x: 0, y: 0 }, { locale: c.expected.lang });
          applied = res.ok ? `블록 ${res.counts.blocks} · 화살표 ${res.counts.arrows} · 그래프 ${res.counts.charts} · 표 ${res.counts.tables}` : `실패: ${res.reason}`;
        }
        const score = scoreRun(c, { called: raw !== null, raw, plan, validFirst: seen.length === 1 && !!plan, ...(error ? { error } : {}) });
        all.push(score);
        const u = plan?.usage;
        const usd = u ? (u.input * PRICE.input + u.output * PRICE.output + u.cacheRead * PRICE.cacheRead + u.cacheWrite * PRICE.cacheWrite) / 1e6 : null;
        cost += usd ?? 0;
        runs.push({
          run, ms, calls: seen.length, applied, error, usage: u ?? null, usd,
          nodeRecall: ratio(score.nodeRecall), edgePrecision: ratio(score.edgePrecision), edgeRecall: ratio(score.edgeRecall),
          numberAccuracy: ratio(score.numberAccuracy), sourceMatch: ratio(score.sourceMatch), structureMatch: ratio(score.structureMatch), hardFails: score.hardFails,
          mode: plan?.mode ?? 'diagram', modeMatch: ratio(score.modeMatch), cardRecall: ratio(score.cardRecall), cardOrder: ratio(score.cardOrder),
          pieceMatch: ratio(score.pieceMatch), keepRecall: ratio(score.keepRecall), sheetSourced: ratio(score.sheetSourced), unsourced: score.unsourced,
          cards: plan?.sheet?.sections.map((s) => `${s.title} [${s.pieces.map((p) => p.type).join(' ')}]`) ?? [],
          patterns: plan?.patterns ?? [], containers: plan?.containers ?? [], dropped: plan?.dropped ?? [],
          nodes: plan?.nodes.map((n) => `${n.key} [${n.kind}] ${n.title}`) ?? [],
          edges: plan?.edges.map((e) => `${e.from} -${e.relation}${e.label ? `(${e.label})` : ''}-> ${e.to}`) ?? [],
          raw,
        });
        process.stdout.write(`[live] ${c.id} #${run} ${PROMPT} ${ms}ms calls=${seen.length} ${applied ?? error} $${usd?.toFixed(3) ?? '?'}\n`);
      }
      perCase.push({ id: c.id, category: c.expected.category, runs });
    }
    const a = aggregate(all);
    const report = {
      date: DATE, change: `실제 API 평가 — ${PROMPT}`, model: MODEL, runsPerCase: RUNS,
      bundle: { promptVersion: PROMPT, promptRevision: structurePrompts(PROMPT).system.revision },
      costUsdEstimate: Number(cost.toFixed(3)),
      metrics: {
        schemaValidity: a.schemaValidity, nodeRecall: a.micro.nodeRecall, edgePrecision: a.micro.edgePrecision, numberAccuracy: a.micro.numberAccuracy,
        inventedNumbers: a.inventedNumbers, tableColumnMatch: a.micro.tableColumnMatch, sourceMatch: a.micro.sourceMatch,
        modeMatch: a.micro.modeMatch, cardRecall: a.micro.cardRecall, sheetSourced: a.micro.sheetSourced,
      },
      diagnostics: {
        edgeRecall: a.micro.edgeRecall, edgeRecallViaPath: a.micro.edgeRecallViaPath, structureMatch: a.micro.structureMatch, spuriousCharts: a.spuriousCharts, spuriousTables: a.spuriousTables,
        cardOrder: a.micro.cardOrder, pieceMatch: a.micro.pieceMatch, keepRecall: a.micro.keepRecall,
      },
      gateFails: gate(a),
      perCase,
    };
    mkdirSync(OUT, { recursive: true });
    const tag = CASES.length ? `-${CASES.join('_')}` : '';
    writeFileSync(join(OUT, `${DATE}-live-${PROMPT}${tag}${FROM ? '-rescored' : ''}.json`), `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`\n[live] ${JSON.stringify({ metrics: report.metrics, diagnostics: report.diagnostics, gateFails: report.gateFails, costUsdEstimate: report.costUsdEstimate }, null, 2)}\n`);
    expect(all.length).toBeGreaterThan(0);
  }, 30 * 60_000);
});
