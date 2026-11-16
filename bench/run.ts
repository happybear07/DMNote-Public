// FR-008 Node 마이크로 벤치 (ENGINE 14.4~14.5). 사용: `corepack pnpm bench [--update-baseline]`
// 결과는 bench/results/<날짜>-<기기>.json. 기준선(bench/baseline.json)보다 10% 넘게 느리거나 절대 예산을 넘으면 exit 1.
// 기준선 비교는 같은 기기끼리만 의미가 있다(14.5) — CPU · Node 메이저가 다르면 절대 예산만 판정한다.
//
// 잡음 대응 (실측 근거): 개발 PC(노트북 CPU)는 터보 · 발열 · 백그라운드 부하로 같은 측정이 실행마다 ±20% 흔들린다.
// 14.5의 "7회 중앙값"으로는 10% 규칙이 거의 매번 깨져서, 회차를 15로 늘리고 묶음 전체를 3번 돌려(PASSES)
// 모든 회차의 하위 25% 값(p25)으로 회귀를 본다. 최솟값은 운 좋은 한 회차에 끌려가 기준선이 부풀고(실측), 중앙값은 부하에 흔들린다.
// 회귀로 보이면 그 묶음만 PASSES번 더 재서 표본을 늘린 뒤 다시 판정한다 — p25는 표본이 늘어도 아래로 치우치지 않는다.
// 그래도 기기 전체 속도가 분 단위로 15~30% 오르내린다(모든 지표가 같이 움직임, 실측). 그래서 회귀는
// "지표 변화 ÷ 전체 지표 변화의 중앙값(drift)"으로 본다 — 한 경로만 느려진 회귀는 잡고, 기기 전체의 흔들림은 뺀다.
// drift 자체가 10%를 넘으면 경고만 한다(전체가 같이 느려진 회귀는 이 기기에서 잡음과 구분할 수 없음 — 조용한 상태에서 다시 잴 것).
// 기준선과 일반 실행은 같은 절차로 잰다. 기록 · 절대 예산은 중앙값(ms)으로 본다.
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTextBlock, deserialize, Engine, serialize, type Rect } from '../packages/engine-core/src/index';
import { synthNote, rng, WORLD } from './synth';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROUNDS = 15;
const PASSES = 3;
const REGRESSION = 0.10;
/** 이보다 작은 차이(drift 보정 후)는 잡음으로 보고 회귀 판정에서 뺀다. 0.3ms짜리 undo/redo · µs 단위 질의는
 * 실행마다 ±15%가 흔해(실측) 10% 규칙만으로는 매번 깨진다 — 이 지표들은 절대 예산(1ms · 16.7ms)이 실질 판정이다. */
const NOISE_FLOOR_MS = 0.05;
const updateBaseline = process.argv.includes('--update-baseline');

/** 절대 예산 (ms). null = 예산 없음, 회귀만 본다. target = 넘으면 경고만 (실패 아님). */
const BUDGETS: Record<string, { budget: number | null; target?: number; why: string }> = {
  'open.100': { budget: null, why: '' },
  'open.1k': { budget: null, why: '' },
  // 하드 예산은 FR-006의 열기 200ms. TEST-PLAN G1 · ENGINE 12.7의 세부 배분(구축+검증 25 + 인덱스 15 = 40)은 목표로만 경고한다.
  'open.10k': { budget: 200, target: 40, why: 'FR-006 열기 200ms 안 (목표 40ms: TEST-PLAN G1 · ENGINE 12.7)' },
  'openJson.10k': { budget: null, target: 200, why: 'JSON.parse 포함 참고치 — 앱은 IDB 구조화 복제라 FR 판정 대상 아님' },
  'query.10k.z100.p95': { budget: 1, why: 'FR-004 1만 블록 뷰포트 질의 1ms' },
  'query.10k.z25.p95': { budget: 1, why: 'FR-004 (25% 줌 = 16배 넓은 뷰포트)' },
  'hitTest.10k.p95': { budget: 1, why: 'FR-004 점 판정 (질의 예산 준용)' },
  'serialize.10k': { budget: null, why: '' },
  'tx.create100.10k': { budget: 16.7, why: '한 프레임 (FR-002 블록 100개 = 1단계)' },
  'undo.100.10k': { budget: 16.7, why: '한 프레임' },
  'redo.100.10k': { budget: 16.7, why: '한 프레임' },
};

const gc = (globalThis as { gc?: () => void }).gc ?? (() => {});
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]!; };
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))]!; };
const time = (fn: () => void) => { const t = performance.now(); fn(); return performance.now() - t; };
/** 1ms 안팎의 작업은 한 번 재면 타이머 잡음이 더 크다 — n번 돌려 평균 */
const timeN = (fn: () => void, n: number) => time(() => { for (let i = 0; i < n; i++) fn(); }) / n;

/** 워밍업 1회 + ROUNDS회의 원시 값 */
function rounds(fn: () => number): number[] {
  fn();
  const raw: number[] = [];
  for (let i = 0; i < ROUNDS; i++) { gc(); raw.push(fn()); }
  return raw;
}

let sink = 0; // 결과를 버리지 않게 해 최적화로 사라지는 것을 막는다
const note: Record<number, { obj: unknown; json: string }> = {};
for (const n of [100, 1000, 10_000]) {
  const json = JSON.stringify(synthNote({ blocks: n, seed: 42 }));
  note[n] = { obj: JSON.parse(json), json };
}
const open = (input: unknown) => {
  const r = deserialize(input);
  if (!r.ok) throw new Error(`합성 노트 역직렬화 실패: ${JSON.stringify(r).slice(0, 200)}`);
  return new Engine(r.data);
};
const e = open(note[10_000]!.obj);
if (e.blockCount !== 10_000) throw new Error(`블록 수 ${e.blockCount}`);
const r = rng(7);
const viewport = (zoom: number): Rect => { const w = 1440 / zoom, h = 900 / zoom; return { x: r() * (WORLD - w), y: r() * (WORLD - h), w, h }; };
const queryP95 = (zoom: number) => rounds(() => {
  const ts: number[] = [];
  for (let i = 0; i < 500; i++) { const v = viewport(zoom); ts.push(time(() => { sink += e.queryBlocks(v).length + e.queryArrows(v).length; })); }
  return pct(ts, 0.95);
});

/** 측정 묶음 — 지표 이름 → 회차별 원시 값 */
const GROUPS: (() => Record<string, number[]>)[] = [
  // 열기: 역직렬화(O(n) 구조 검증) + 엔진 구축(맵 · 파생 인덱스 · rbush.load)
  () => ({ 'open.100': rounds(() => timeN(() => open(note[100]!.obj), 50)) }),
  () => ({ 'open.1k': rounds(() => timeN(() => open(note[1000]!.obj), 5)) }),
  () => ({ 'open.10k': rounds(() => time(() => open(note[10_000]!.obj))) }),
  () => ({ 'openJson.10k': rounds(() => time(() => open(JSON.parse(note[10_000]!.json)))) }),
  // 질의 · 히트테스트: 무작위 위치 500회의 p95
  () => ({ 'query.10k.z100.p95': queryP95(1) }),
  () => ({ 'query.10k.z25.p95': queryP95(0.25) }),
  () => ({
    'hitTest.10k.p95': rounds(() => {
      const ts: number[] = [];
      for (let i = 0; i < 500; i++) { const p = { x: r() * WORLD, y: r() * WORLD }; ts.push(time(() => { sink += e.hitTest(p) ? 1 : 0; })); }
      return pct(ts, 0.95);
    }),
  }),
  () => ({ 'serialize.10k': rounds(() => time(() => { sink += Object.keys(serialize(e).blocks).length; })) }),
  // 블록 100개 트랜잭션 · undo · redo (1만 블록 노트 위에서)
  () => {
    const tx: number[] = [], undo: number[] = [], redo: number[] = [];
    for (let i = 0; i <= ROUNDS; i++) {
      gc();
      const t0 = time(() => e.transact(() => { for (let k = 0; k < 100; k++) createTextBlock(e, { x: r() * WORLD, y: r() * WORLD }, { title: `벤치 ${k}` }); }, { origin: 'user' }));
      const t1 = time(() => { if (!e.undo()) throw new Error('undo 실패'); });
      const t2 = time(() => { if (!e.redo()) throw new Error('redo 실패'); });
      e.undo(); // 다음 회차를 같은 블록 수에서 시작
      if (i > 0) { tx.push(t0); undo.push(t1); redo.push(t2); } // 0회차 = 워밍업
    }
    if (e.blockCount !== 10_000) throw new Error(`undo 후 블록 수 ${e.blockCount}`);
    return { 'tx.create100.10k': tx, 'undo.100.10k': undo, 'redo.100.10k': redo };
  },
];

interface Metric { ms: number; p25: number }
const raw: Record<string, number[]> = {};
const groupOf: Record<string, number> = {};
const measure = (gi: number) => { for (const [k, xs] of Object.entries(GROUPS[gi]!())) { (raw[k] ??= []).push(...xs); groupOf[k] = gi; } };
for (let p = 0; p < PASSES; p++) GROUPS.forEach((_, gi) => measure(gi));
const summarize = () => Object.fromEntries(Object.entries(raw).map(([k, xs]) => [k, { ms: median(xs), p25: pct(xs, 0.25) }])) as Record<string, Metric>;
let metrics = summarize();

// ── 기록 · 판정 ──
const machine = {
  cpu: os.cpus()[0]?.model.trim() ?? 'unknown',
  cores: os.cpus().length,
  memGB: Math.round(os.totalmem() / 2 ** 30),
  os: `${os.type()} ${os.release()} ${os.arch()}`,
  node: process.version,
  host: os.hostname(),
};
let commit = 'unknown';
try { commit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* git 없음 */ }

const baselinePath = join(HERE, 'baseline.json');
type Base = { referenceMachine: typeof machine; metrics: Record<string, Metric> };
const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) as Base : null;
const sameMachine = !!baseline && baseline.referenceMachine.cpu === machine.cpu && baseline.referenceMachine.node.split('.')[0] === machine.node.split('.')[0];

const ratio = (k: string) => { const base = baseline?.metrics[k]; return base ? metrics[k]!.p25 / base.p25 : null; };
const driftOf = () => { const rs = Object.keys(metrics).map(ratio).filter((x): x is number => x !== null); return rs.length ? median(rs) : 1; };
let drift = driftOf();
const regressed = (k: string) => {
  const base = baseline?.metrics[k], q = ratio(k);
  return !updateBaseline && sameMachine && !!base && q !== null && q / drift - 1 > REGRESSION && metrics[k]!.p25 - base.p25 * drift > NOISE_FLOOR_MS;
};
const suspects = Object.keys(metrics).filter(regressed);
if (suspects.length) {
  console.log(`회귀 의심 — 표본을 늘려 다시 판정: ${suspects.join(', ')}`);
  for (const gi of new Set(suspects.map((k) => groupOf[k]!))) for (let p = 0; p < PASSES; p++) measure(gi);
  metrics = summarize();
  drift = driftOf();
}

type Status = 'ok' | 'over-budget' | 'regression';
const rows: Record<string, Metric & { budget: number | null; target?: number; baseline: Metric | null; change: number | null; status: Status }> = {};
let failed = 0;
console.log(`기기: ${machine.cpu} · ${machine.os} · Node ${machine.node}`);
const judging = sameMachine && !updateBaseline;
console.log(judging ? `기준선과 같은 기기 — 10% 회귀(p25 ÷ drift) + 절대 예산 판정 · 기기 전체 drift ${((drift - 1) * 100).toFixed(0)}%` : '기준선 갱신 또는 다른 기기 — 절대 예산만 판정');
if (judging && drift > 1 + REGRESSION) console.log(`WARN  기기 전체가 기준선보다 ${((drift - 1) * 100).toFixed(0)}% 느림 — 부하 · 절전 상태 확인 후 다시 잴 것 (전 경로 공통 회귀일 수도 있음)`);
for (const [k, m] of Object.entries(metrics)) {
  const budget = BUDGETS[k]?.budget ?? null, target = BUDGETS[k]?.target;
  const base = baseline?.metrics[k] ?? null;
  const change = base ? m.p25 / base.p25 / drift - 1 : null;
  let status: Status = 'ok';
  if (budget !== null && m.ms > budget) status = 'over-budget';
  else if (regressed(k)) status = 'regression';
  if (status !== 'ok') failed++;
  const warn = status === 'ok' && target !== undefined && m.ms > target;
  rows[k] = { ms: +m.ms.toFixed(4), p25: +m.p25.toFixed(4), budget, ...(target !== undefined ? { target } : {}), baseline: base, change: change === null ? null : +change.toFixed(3), status };
  const vs = base ? ` (p25 ${m.p25.toFixed(3)} vs 기준 ${base.p25.toFixed(3)}, drift 보정 ${change! >= 0 ? '+' : ''}${(change! * 100).toFixed(0)}%)` : '';
  console.log(`${status !== 'ok' ? 'FAIL' : warn ? 'WARN' : 'PASS'}  ${k.padEnd(20)} ${m.ms.toFixed(3).padStart(9)} ms${budget !== null ? ` / 예산 ${budget}` : ''}${target !== undefined ? ` · 목표 ${target}` : ''}${vs}${status !== 'ok' ? ` — ${status}` : ''}`);
}

const date = new Date().toISOString().slice(0, 10);
const slug = machine.host.replace(/[^0-9A-Za-z_-]/g, '_');
mkdirSync(join(HERE, 'results'), { recursive: true });
const out = join(HERE, 'results', `${date}-${slug}.json`);
writeFileSync(out, JSON.stringify({
  date: new Date().toISOString(), commit, machine, rounds: ROUNDS, passes: PASSES, drift: +drift.toFixed(3), regression: REGRESSION, noiseFloorMs: NOISE_FLOOR_MS,
  synth: { seed: 42, arrowRatio: 0.5, strokeRatio: 1, dist: 'cluster' }, metrics: rows, sink,
}, null, 2) + '\n');
console.log(`\n결과: ${out}`);

if (updateBaseline) {
  const budgets = Object.fromEntries(Object.entries(BUDGETS).filter(([, b]) => b.budget !== null || b.target !== undefined)
    .map(([k, b]) => [k, [b.budget !== null ? `예산 ${b.budget}ms` : '', b.target !== undefined ? `목표 ${b.target}ms` : ''].filter(Boolean).join(' · ') + ` — ${b.why}`]));
  writeFileSync(baselinePath, JSON.stringify({
    note: '기준 기기(ENGINE 19절 D2 데스크톱)의 Node 마이크로 벤치 기록. ms = 중앙값, p25 = 하위 25% 값(회귀 판정용). 같은 CPU · 같은 Node 메이저에서만 10% 회귀 판정에 쓴다. 갱신: corepack pnpm bench --update-baseline',
    createdAt: new Date().toISOString(), commit, referenceMachine: machine, rounds: ROUNDS, passes: PASSES, budgets,
    metrics: Object.fromEntries(Object.entries(metrics).map(([k, v]) => [k, { ms: +v.ms.toFixed(4), p25: +v.p25.toFixed(4) }])),
  }, null, 2) + '\n');
  console.log(`기준선 갱신: ${baselinePath}`);
}
console.log(failed ? `\n${failed}개 지표 실패` : '\n모든 지표 통과');
process.exit(failed ? 1 : 0);
