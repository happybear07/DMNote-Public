// Claude 세션 평가 2단계: eval/session/runs/<id>.json(세션이 모델 역할로 낸 emit_structure 입력)을 실제 파이프라인
// (요청 조립 → 응답 검사 → 정리 → 수치 검사 → 병합)에 그대로 흘리고 엔진에도 적용해 본 뒤, eval/README 3절 지표로 채점해
// eval/results/<날짜>-claude-session.json에 쓴다. 평소에는 건너뛴다: DN_SESSION_SCORE=1 일 때만.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { Engine, setDefaultTextCodec } from '@dn/engine-core';
import { pmCodec } from '@dn/text-pm/headless';
import { applyStructure, STRUCTURE_PROMPT_VERSION, structurePrompts, structureText, type StructurePlan } from '../src';
import { createDirectTransport } from '../src/direct';
import { loadEvalCases, message, ROOT, scriptedCall, toolUse } from './fixtures';
import { aggregate, gate, ratio, scoreRun, type RunScore } from './scorer';

const ON = process.env.DN_SESSION_SCORE === '1';
const RUNS = join(ROOT, 'eval', 'session', 'runs');
const OUT = join(ROOT, 'eval', 'results');
const DATE = process.env.DN_EVAL_DATE ?? new Date().toISOString().slice(0, 10);

interface SessionRun { run: number; called_tool: boolean; tool_input: unknown; parse_error?: string }

beforeAll(() => setDefaultTextCodec(pmCodec));

describe.skipIf(!ON)('Claude 세션 평가: 채점', () => {
  it('세션 답 → 파이프라인 → 엔진 → 지표', async () => {
    const perCase: unknown[] = [];
    const all: RunScore[] = [];
    const hardFails: string[] = [];
    for (const c of loadEvalCases()) {
      const file = join(RUNS, `${c.id}.json`);
      if (!existsSync(file)) throw new Error(`${c.id}: 세션 답이 없음 (${file})`);
      const runs = JSON.parse(readFileSync(file, 'utf8')) as SessionRun[];
      const scored = [];
      for (const s of runs) {
        let plan: StructurePlan | null = null;
        let error: string | undefined;
        let validFirst = false;
        if (s.called_tool && !s.parse_error) {
          // 응답은 한 번뿐 — 첫 응답이 전체 위반이면 교정 재요청에서 "응답이 더 없음"으로 실패한다(= 스키마 부적합으로 센다)
          const call = scriptedCall([message([toolUse(s.tool_input)])]);
          try {
            plan = await structureText({ text: c.source, kinds: c.expected.kinds, locale: c.expected.lang },
              { transport: createDirectTransport({ call }), retries: 0, retryBaseMs: 1 });
            validFirst = call.calls.length === 1;
          } catch (e) {
            error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
          }
        } else if (s.parse_error) error = `JSON 아님: ${s.parse_error}`;
        let applied: string | null = null;
        if (plan) {
          const e = new Engine();
          const res = applyStructure(e, plan, { x: 0, y: 0 }, { locale: c.expected.lang });
          applied = res.ok ? `블록 ${res.counts.blocks} · 화살표 ${res.counts.arrows} · 그래프 ${res.counts.charts} · 표 ${res.counts.tables}` : `실패: ${res.reason}`;
        }
        const score = scoreRun(c, { called: s.called_tool, raw: s.tool_input, plan, validFirst, ...(error ? { error } : {}) });
        all.push(score);
        hardFails.push(...score.hardFails.map((h) => `${c.id} #${s.run}: ${h}`));
        scored.push({
          run: s.run, applied,
          nodeRecall: ratio(score.nodeRecall), edgePrecision: ratio(score.edgePrecision), edgeRecall: ratio(score.edgeRecall),
          numberAccuracy: ratio(score.numberAccuracy), chartPointRecall: ratio(score.chartPointRecall), tableColumnMatch: ratio(score.tableColumnMatch),
          sourceMatch: ratio(score.sourceMatch), score, dropped: plan?.dropped ?? [], droppedNumbers: plan?.droppedNumbers ?? null,
          raw: s.tool_input,
        });
      }
      perCase.push({ id: c.id, category: c.expected.category, runs: scored });
    }
    const a = aggregate(all);
    const fails = gate(a);
    const report = {
      date: DATE,
      change: 'Claude 세션 대역 평가 — API 키 없이 세션(Sonnet)이 앱이 보낼 요청을 그대로 받아 답함',
      bundle: { promptVersion: STRUCTURE_PROMPT_VERSION, promptRevision: structurePrompts().system.revision, schema: STRUCTURE_PROMPT_VERSION },
      model: 'claude-sonnet (Claude Code 세션 대역 — 실제 API 아님)', runsPerCase: 3,
      env: { region: 'local', client: 'session-score.test.ts', note: 'thinking · effort · tool_choice는 재현 안 됨, 지연 · 비용 측정 없음, 교정 재요청 없음(첫 응답 한 번)' },
      metrics: {
        schemaValidity: a.schemaValidity, nodeRecall: a.micro.nodeRecall, edgePrecision: a.micro.edgePrecision, numberAccuracy: a.micro.numberAccuracy,
        inventedNumbers: a.inventedNumbers, tableColumnMatch: a.micro.tableColumnMatch, sourceMatch: a.micro.sourceMatch, latencyP50Ms: null, latencyP95Ms: null,
      },
      diagnostics: {
        edgeRecall: a.micro.edgeRecall, edgeRecallViaPath: a.micro.edgeRecallViaPath, looseEdgePrecision: a.micro.looseEdgePrecision, unscoredEdges: a.unscoredEdges, chartPointRecall: a.micro.chartPointRecall,
        finalNumberAccuracy: a.micro.finalNumberAccuracy, spuriousCharts: a.spuriousCharts, spuriousTables: a.spuriousTables,
        tableNumberSourceRate: a.micro.tableNumberSource, exactTableRate: a.micro.exactTable, rowRecall: a.micro.rowRecall, quoteMissingRate: a.micro.quoteMissing,
        minPerRun: a.minPerRun,
      },
      gateFails: fails,
      hardFails,
      perCase,
    };
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, `${DATE}-claude-session.json`), `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`\n[session-score] ${JSON.stringify({ metrics: report.metrics, diagnostics: { ...report.diagnostics, minPerRun: undefined }, gateFails: fails, hardFails }, null, 2)}\n`);
    expect(all.length).toBeGreaterThan(0);
  }, 120_000);
});
