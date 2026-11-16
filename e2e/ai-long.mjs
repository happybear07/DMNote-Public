// 긴 붙여넣기 (FR-101 마지막 기준, 사용자 요청 10/13) — Anthropic API는 가짜로 가로챈다(실제 호출 · 비용 없음).
// 칩 보조 문구: 7,000자 넘으면 "긴 글이라 N번에 나눠 분석해요." · 12만 자 넘으면 "글이 너무 길어요" · 실제 요청 수가 그 N과 같다.
// 사용: dev 서버 실행 후 `node e2e/ai-long.mjs` (DN_URL로 주소 변경)
import { chromium } from 'playwright-core';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

const sentence = (i) => `문장 ${i}번은 긴 붙여넣기를 나눠 보내는지 시험하기 위한 내용입니다. `;
const section = (h, n) => `## ${h}\n\n` + Array.from({ length: n }, (_, i) => sentence(i)).join('') + '\n';
const LONG = section('하나', 80) + '\n' + section('둘', 80) + '\n' + section('셋', 80); // 약 1만 자
const STRUCT = (c) => ({ version: 'structure.v2', mode: 'diagram', nodes: [{ key: 'n1', title: `조각 ${c} 개념`, kind: 'concept' }], edges: [], charts: [], tables: [] });
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
let calls = 0;
await page.route('https://api.anthropic.com/**', (route) => {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  if (req.url().includes('/v1/models/')) return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'model', id: 'claude-sonnet-5-5', display_name: 'x', created_at: '2026-01-01T00:00:00Z' }) });
  const body = req.postDataJSON();
  if (body?.tools?.some((t) => t.name === 'emit_structure')) calls++;
  return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: stream(STRUCT(calls)) });
}).catch(() => {});

const ws = (fn, arg) => page.evaluate(fn, arg);
await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(async () => { await window.__dn.acceptConsent(); await window.__dn.saveKey('sk-ant-test-long-0000'); });
const paste = (text) => ws((t) => { const dt = new DataTransfer(); dt.setData('text/plain', t); const r = window.__dn.view.root; r.focus(); r.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, text);
const hint = () => page.locator('.ai-chip-hint').innerText().catch(() => '');

// 1) 짧은 글: 기본 문구
await ws(() => window.__dn.newNote({ sheet: null }));
await page.waitForTimeout(200);
await paste('금리 인상은 대출 감소로 이어지고, 대출 감소는 소비 위축을 낳습니다.');
await page.waitForTimeout(250);
check('짧은 글: 칩 기본 문구', (await hint()).includes('관계 · 수치 · 비교'));

// 2) 약 1만 자: 나눠 분석 안내 + 실제 요청 수가 같다
await ws(() => window.__dn.newNote({ sheet: null }));
await page.waitForTimeout(200);
await paste(LONG);
await page.waitForTimeout(300);
const h = await hint();
const n = Number(/(\d+)번에 나눠/.exec(h)?.[1] ?? 0);
check('약 1만 자: "긴 글이라 N번에 나눠 분석해요."', n >= 2, h);
await page.locator('.ai-chip .btn.ai').click();
await page.waitForFunction(() => !window.__dn.state.aiRun, null, { timeout: 30000 });
await page.waitForTimeout(300);
check('실제 구조화 요청 수 = 안내한 N', calls === n, `요청 ${calls} · 안내 ${n}`);

// 3) 12만 자 넘음: 상한 안내 (빨간 글자)
await ws(() => window.__dn.newNote({ sheet: null }));
await page.waitForTimeout(200);
await paste('가나다라마바사 '.repeat(15_500));
await page.waitForTimeout(400);
check('12만 자 넘음: "글이 너무 길어요" (경고 색)', (await hint()).includes('너무 길어요') && (await page.locator('.ai-chip-hint.warn').count()) === 1);

check('콘솔 · 페이지 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close();
const fails = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fails}/${results.length} 통과`);
process.exit(fails ? 1 : 0);
