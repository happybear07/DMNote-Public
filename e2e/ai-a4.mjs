// A4 용지 노트의 도식형 AI 결과 (FR-109 마지막 기준) — Anthropic API는 가짜로 가로챈다(실제 호출 · 비용 없음).
// 원문 아래 · 용지 안쪽 폭 안 · 쪽 사이 틈에 걸치지 않음 · 끝없는 캔버스는 지금처럼 원문 오른쪽.
// 사용: dev 서버 실행 후 `node e2e/ai-a4.mjs [스크린샷 폴더]` (DN_URL로 주소 변경)
import { chromium } from 'playwright-core';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2] ?? '.';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

const SRC = Array.from({ length: 10 }, (_, i) => `단계 ${i + 1}은 앞 단계의 결과를 받아 다음으로 넘긴다.`).join(' ');
const CHAIN = {
  version: 'structure.v2', mode: 'diagram', title: '긴 사슬',
  nodes: Array.from({ length: 10 }, (_, i) => ({ key: `n${i}`, title: `단계 ${i + 1}`, kind: 'step', body: '앞 단계의 결과를 받아 다음으로 넘긴다' })),
  edges: Array.from({ length: 9 }, (_, i) => ({ from: `n${i}`, to: `n${i + 1}`, relation: 'leads-to' })),
  charts: [], tables: [], patterns: [{ key: 'p1', id: 'S-07', pattern: 'chain', primary: true, nodes: Array.from({ length: 10 }, (_, i) => `n${i}`) }],
};
const sse = (events) => events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');
const stream = (input) => sse([
  ['message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 900, output_tokens: 1 } } }],
  ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'emit_structure', input: {} } }],
  ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } }],
  ['content_block_stop', { type: 'content_block_stop', index: 0 }],
  ['message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 321 } }],
  ['message_stop', { type: 'message_stop' }],
]);

const browser = await chromium.launch({ channel: process.env.DN_CHANNEL ?? 'msedge', headless: true }); // CI(리눅스)는 DN_CHANNEL=chrome
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await ctx.addInitScript(() => localStorage.setItem('dn:no-env-key', '1'));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|401|Failed to load resource/.test(m.text())) errors.push(m.text()); });
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
await page.route('https://api.anthropic.com/**', (route) => {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  if (req.url().includes('/v1/models/')) return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'model', id: 'claude-sonnet-5-5', display_name: 'x', created_at: '2026-01-01T00:00:00Z' }) });
  return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: stream(CHAIN) });
}).catch(() => {});

const ws = (fn, arg) => page.evaluate(fn, arg);
await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(async () => { await window.__dn.acceptConsent(); await window.__dn.saveKey('sk-ant-test-a4-0000'); });
const paste = (text) => ws((t) => { const dt = new DataTransfer(); dt.setData('text/plain', t); const r = window.__dn.view.root; r.focus(); r.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, text);
const run = async () => {
  const src = await ws(() => [...window.__dn.view.engine.blocks()].find((b) => !b.ai)?.id);
  await ws((id) => window.__dn.structure(id), src);
  await page.waitForFunction(() => !window.__dn.state.aiRun, null, { timeout: 15000 });
  await page.waitForTimeout(500);
  return ws(() => {
    const e = window.__dn.view.engine;
    const src = [...e.blocks()].find((b) => !b.ai);
    return { src: { x: src.x, y: src.y, w: src.w, h: src.h }, ai: [...e.blocks()].filter((b) => b.ai).map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h })) };
  });
};

// 1) A4 세로 노트
await ws(() => window.__dn.newNote({ sheet: { size: 'a4' } }));
await page.waitForTimeout(300);
await paste(SRC);
await page.waitForTimeout(300);
const a4 = await run();
const W = 794, PAD = 24, H = 1123, GAP = 40;
const inside = a4.ai.every((r) => r.x >= PAD - 0.5 && r.x + r.w <= W - PAD + 0.5);
check('A4: 도식 상자가 모두 용지 안쪽 폭 안', a4.ai.length === 10 && inside, `${a4.ai.length}개`);
check('A4: 원문 아래에 놓인다', Math.min(...a4.ai.map((r) => r.y)) > a4.src.y + a4.src.h);
const straddle = a4.ai.some((r) => { const top = r.y - 20, i = Math.floor(top / (H + GAP)); return r.y + r.h > i * (H + GAP) + H - PAD + 0.5; });
check('A4: 쪽 사이 틈에 걸친 상자 없음 (이름표까지)', !straddle);
const xs = a4.ai.map((r) => r.x), left = Math.min(...xs), right = Math.max(...a4.ai.map((r) => r.x + r.w));
check('A4: 용지 가운데', Math.abs((left - PAD) - (W - PAD - right)) <= 2, `${left - PAD} · ${W - PAD - right}`);
await ws(() => window.__dn.view.fit(false));
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/ai-a4-01.png` });

// 2) 끝없는 캔버스는 지금처럼 원문 오른쪽
await ws(() => window.__dn.newNote({ sheet: null }));
await page.waitForTimeout(300);
await paste(SRC);
await page.waitForTimeout(300);
const free = await run();
check('끝없는 캔버스: 원문 오른쪽 (용지 규칙 없음)', Math.min(...free.ai.map((r) => r.x)) >= free.src.x + free.src.w);

check('콘솔 · 페이지 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close();
const fails = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fails}/${results.length} 통과`);
process.exit(fails ? 1 : 0);
