// 손글씨 읽기 동의 · 키 흐름 (알파 AT-029): '글로 바꾸기' → 동의 창 '동의하고 계속' → 한 번 더 누르지 않아도 키 안내로,
// 키를 저장하면 기다리던 읽기를 이어서(미리보기), 동의 창을 닫으면 잊는다. Anthropic API는 가짜로 가로챈다(실제 호출 · 비용 없음).
// 사용: dev 서버 실행 후 `node e2e/ocr-consent.mjs [스크린샷 폴더]`
import { chromium } from 'playwright-core';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2] ?? '.';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const sse = (events) => events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');
const stream = (tool, input) => sse([
  ['message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 900, output_tokens: 1 } } }],
  ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: tool, input: {} } }],
  ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } }],
  ['content_block_stop', { type: 'content_block_stop', index: 0 }],
  ['message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 40 } }],
  ['message_stop', { type: 'message_stop' }],
]);

const browser = await chromium.launch({ channel: process.env.DN_CHANNEL ?? 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => localStorage.setItem('dn:no-env-key', '1'));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push(m.text()); });
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const sent = [];
await page.route('https://api.anthropic.com/**', async (route) => {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  if (req.url().includes('/v1/models/')) return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'model', id: 'claude-sonnet-5-5' }) });
  const tool = req.postDataJSON().tools?.[0]?.name;
  sent.push(tool);
  return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: stream('emit_ocr', { lines: [{ text: '손글씨 시험', confidence: 0.9 }], overallConfidence: 0.9 }) });
});
const ws = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(() => window.__dn.newNote({ sheet: null }));
await wait(300);
check('처음: 동의 · 키 없음', await ws(() => !window.__dn.state.ai.consent && !window.__dn.state.ai.keyLast4));

const root = await page.locator('.dn-canvas').boundingBox();
await ws(() => window.__dn.view.setTool('pen'));
await page.mouse.move(root.x + 300, root.y + 300); await page.mouse.down();
for (let i = 1; i <= 10; i++) await page.mouse.move(root.x + 300 + i * 15, root.y + 300 + (i % 2 ? 12 : -12));
await page.mouse.up();
const pick = () => ws(() => { const v = window.__dn.view; v.setTool('lasso'); for (const s of v.engine.strokes()) v.ink.selected.add(s.id); v.schedule(); v.notifyUi(); });
await pick();
await wait(150);
const toText = page.locator('.ink-bar button', { hasText: '글로 바꾸기' });

// 1) 동의 창을 닫으면 잊는다 — 나중에 키를 저장해도 저절로 읽지 않음
await toText.click();
await wait(200);
check('글로 바꾸기 → 동의 창', (await ws(() => window.__dn.state.dialog?.kind)) === 'consent');
await page.keyboard.press('Escape');
await wait(200);
check('Esc로 닫으면 아무것도 이어지지 않음', (await ws(() => window.__dn.state.dialog)) === null && sent.length === 0);

// 2) 동의하고 계속 → 한 번 더 누르지 않아도 키 안내
await pick();
await toText.click();
await wait(200);
await page.getByRole('button', { name: '동의하고 계속' }).click();
await wait(400);
const dlg = await ws(() => window.__dn.state.dialog);
check('AT-029: 동의하면 이어서 키 안내(설정 창)', dlg?.kind === 'settings' && /손글씨/.test(dlg.reason ?? '') && /이어서/.test(dlg.reason ?? ''), JSON.stringify(dlg));
await page.screenshot({ path: `${OUT}/ocr-consent-key.png` });

// 3) 키를 저장하면 기다리던 읽기를 이어서 → 미리보기
const err = await ws(() => window.__dn.saveKey('sk-ant-test-ocr-0000'));
await page.waitForFunction(() => window.__dn.state.ocr?.step === 'done', null, { timeout: 15000 }).catch(() => {});
const st = await ws(() => ({ step: window.__dn.state.ocr?.step, text: window.__dn.state.ocr?.text, dialog: window.__dn.state.dialog }));
check('키를 저장하면 창이 닫히고 읽기를 이어서 (미리보기)', !err && st.dialog === null && st.step === 'done' && st.text === '손글씨 시험' && sent.filter((t) => t === 'emit_ocr').length === 1, JSON.stringify({ err, st, sent }));
check('이어서 했다는 알림', (await page.locator('.toast').allInnerTexts()).some((t) => /이어서/.test(t)));
await page.screenshot({ path: `${OUT}/ocr-consent-preview.png` });

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} 통과${errors.length ? ` · 오류 ${errors.length}: ${errors.slice(0, 3).join(' | ')}` : ''}`);
await browser.close();
process.exit(results.every((r) => r.ok) && !errors.length ? 0 : 1);
