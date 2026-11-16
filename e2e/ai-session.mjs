// AI 자동 구조화 — Claude 세션 답으로 앱 전체 흐름 확인 (API 키 · 비용 없음).
// eval/session/runs/<id>.json(세션이 모델 역할로 낸 emit_structure 입력)을 가짜 Anthropic API가 SSE로 돌려준다.
// 케이스마다 새 노트에 원문을 붙여넣고 구조화 → 만든 블록 · 화살표 · 그래프 · 표 수가 채점 결과(eval/results)와 같고, 겹침 없음 · 출처 표시 · 실행 취소 한 번.
// 사용: dev 서버 실행 후 `node e2e/ai-session.mjs [스크린샷 폴더]` (DN_URL로 주소, DN_RUN으로 몇 번째 실행 답을 쓸지 — 기본 1)
import { chromium } from 'playwright-core';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2] ?? '.';
const RUN = Number(process.env.DN_RUN ?? 1);
const ROOT = new URL('../eval/', import.meta.url);
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

const report = JSON.parse(readFileSync(new URL('results/2026-10-05-claude-session.json', ROOT), 'utf8'));
const ONLY = process.env.DN_ONLY;
// 세션 답이 있는 케이스만 (10/05 세션 평가 12건 — 뒤에 더한 구조별 케이스는 실제 API 평가로 본다)
const cases = readdirSync(new URL('structure/', ROOT)).filter((f) => f.endsWith('.md') && (!ONLY || f.startsWith(ONLY)) && existsSync(new URL(`session/runs/${f.replace(/\.md$/, '')}.json`, ROOT))).sort().map((f) => {
  const id = f.replace(/\.md$/, '');
  const runs = JSON.parse(readFileSync(new URL(`session/runs/${id}.json`, ROOT), 'utf8'));
  const scored = report.perCase.find((c) => c.id === id).runs.find((r) => r.run === RUN);
  return { id, source: readFileSync(new URL(`structure/${f}`, ROOT), 'utf8'), answer: runs.find((r) => r.run === RUN).tool_input, counts: scored.score.counts };
});

const sse = (events) => events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');
const messagesStream = (input) => sse([
  ['message_start', { type: 'message_start', message: { id: 'msg_s', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 4000, output_tokens: 1 } } }],
  ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_s', name: 'emit_structure', input: {} } }],
  ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } }],
  ['content_block_stop', { type: 'content_block_stop', index: 0 }],
  ['message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 900 } }],
  ['message_stop', { type: 'message_stop' }],
]);

const browser = await chromium.launch({ channel: process.env.DN_CHANNEL ?? 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await ctx.addInitScript(() => localStorage.setItem('dn:no-env-key', '1'));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push(m.text()); });

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
let current = null;
const sent = [];
await page.route('https://api.anthropic.com/**', async (route) => {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  if (req.url().includes('/v1/models/')) {
    return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'model', id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5', created_at: '2026-01-01T00:00:00Z' }) });
  }
  sent.push({ id: current?.id, body: req.postDataJSON() });
  return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: messagesStream(current.answer) });
}).catch(() => {});

const ws = (fn, arg) => page.evaluate(fn, arg);
await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await page.waitForTimeout(300);
// 동의 · 시험용 키 (가짜 API가 확인해 줌 — 실제 키 아님)
await ws(async () => { await window.__dn.acceptConsent(); return window.__dn.saveKey('sk-ant-test-session-0000'); });
check('준비: 동의 · 시험용 키 저장', (await ws(() => window.__dn.state.ai.keyLast4)) === '0000');

const paste = (text) => page.evaluate((t) => {
  const dt = new DataTransfer(); dt.setData('text/plain', t);
  const root = window.__dn.view.root; root.focus();
  root.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, text);
const snapshot = () => ws(() => {
  const e = window.__dn.view.engine;
  const blocks = [...e.blocks()];
  return {
    blocks: blocks.map((b) => b.id), arrows: [...e.arrows()].length,
    charts: [...e.contents()].filter((c) => c.type === 'chart').length, tables: [...e.contents()].filter((c) => c.type === 'table').length,
  };
});

for (const c of cases) {
  current = c;
  await ws(() => window.__dn.newNote());
  await page.waitForTimeout(400);
  const before = await snapshot();
  await paste(c.source);
  await page.waitForTimeout(250);
  const mid = await snapshot();
  const fresh = mid.blocks.filter((id) => !before.blocks.includes(id));
  // 붙여넣기가 블록 여러 개를 만들었으면(표 등) 가장 큰 글 블록을 원문으로
  const srcId = await ws((ids) => {
    const e = window.__dn.view.engine;
    const len = (id) => JSON.stringify(e.contentsOf(id)).length;
    return [...ids].sort((a, b) => len(b) - len(a))[0];
  }, fresh);
  const n0 = sent.length;
  await ws((id) => window.__dn.structure(id), srcId);
  await page.waitForFunction(() => !window.__dn.state.aiRun, null, { timeout: 15000 });
  await page.waitForTimeout(300);
  const after = await snapshot();
  const made = { nodes: after.blocks.length - mid.blocks.length - (after.charts - mid.charts) - (after.tables - mid.tables), edges: after.arrows - mid.arrows, charts: after.charts - mid.charts, tables: after.tables - mid.tables };
  const want = c.counts;
  const same = made.nodes === want.nodes && made.edges === want.edges && made.charts === want.charts && made.tables === want.tables;
  const req = sent[n0]?.body;
  const userText = JSON.stringify(req?.messages ?? '');
  // 원문이 요청에 들어갔나: 가장 긴 줄에서 글자 · 숫자 · 공백만 8자 이상 이어진 조각 (마크다운 기호 · 따옴표는 직렬화가 바꿀 수 있다)
  const probe = [...c.source.split('\n')].sort((a, b) => b.length - a.length)[0].match(/[가-힣A-Za-z0-9 ]{8,}/)[0].trim().slice(0, 16);
  const toast = await page.locator('.toast').innerText().catch(() => '');
  // 겹침 · 출처
  const geo = await ws(() => {
    const e = window.__dn.view.engine;
    const bs = [...e.blocks()];
    let overlap = 0;
    for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
      const a = bs[i], b = bs[j];
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) overlap++;
    }
    const pairs = [];
    for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
      const a = bs[i], b = bs[j];
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) pairs.push([a, b].map((x) => `${x.ai ? 'ai' : 'src'} ${e.contentsOf(x.id)[0]?.type} (${Math.round(x.x)},${Math.round(x.y)} ${Math.round(x.w)}x${Math.round(x.h)})`).join(' ↔ '));
    }
    return { overlap, ai: bs.filter((b) => b.ai).length, pairs };
  });
  check(`${c.id}: 요청에 원문 · 결과 수가 채점과 같음 · 겹침 없음 · 출처 표시`,
    !!req && userText.includes(probe) && same && geo.overlap === 0 && geo.ai === made.nodes + made.charts + made.tables,
    `요청 ${!!req && userText.includes(probe)} · ai ${geo.ai} · ${geo.pairs.join(' | ')} · 만듦 ${JSON.stringify(made)} / 채점 ${JSON.stringify(want)} · 겹침 ${geo.overlap} · ${toast.slice(0, 40)}`);
  if (['01-relation-rate-hike', '05-numeric-quarterly-revenue', '08-comparison-databases', '11-mixed-ev-battery', '12-injection-meeting-notes'].includes(c.id)) {
    await ws(() => window.__dn.view.fit(false));
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/ai-session-${c.id.slice(0, 2)}.png` });
  }
  // 실행 취소 한 번이면 원문만 남는다
  await ws(() => window.__dn.view.undo());
  const undone = await snapshot();
  check(`${c.id}: 실행 취소 한 번 → 원문만`, undone.blocks.length === mid.blocks.length && undone.arrows === mid.arrows);
}

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
