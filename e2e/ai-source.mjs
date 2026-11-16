// 원문 출처 연결 (FR-111) — Anthropic API는 가짜로 가로챈다(실제 호출 · 비용 없음).
// AI 상자 하나를 고르면 원문 구절 강조(CSS Custom Highlight) · 고른 것이 없으면 강조 없음 · '원문에서 보기' · 원문을 지우면 '출처 없음', 되돌리면 사라짐.
// 사용: dev 서버 실행 후 `node e2e/ai-source.mjs [스크린샷 폴더]` (DN_URL로 주소 변경)
import { chromium } from 'playwright-core';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2] ?? '.';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

const SRC = '배경 문단입니다.\n\n금리 인상은 대출 감소로 이어진다.\n\n대출 감소는 소비 위축을 낳는다.';
const PLAN = {
  version: 'structure.v2', mode: 'diagram',
  nodes: [
    { key: 'a', title: '금리 인상', kind: 'concept', source: { quote: '금리 인상은' } },
    { key: 'b', title: '대출 감소', kind: 'concept', source: { quote: '대출 감소는 소비 위축을' } },
    { key: 'c', title: '소비 위축', kind: 'concept' },
  ],
  edges: [{ from: 'a', to: 'b', relation: 'causes' }, { from: 'b', to: 'c', relation: 'causes' }], charts: [], tables: [],
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
  return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: stream(PLAN) });
}).catch(() => {});

const ws = (fn, arg) => page.evaluate(fn, arg);
await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(async () => { await window.__dn.acceptConsent(); await window.__dn.saveKey('sk-ant-test-src-0000'); await window.__dn.newNote({ sheet: null }); });
await page.waitForTimeout(300);
await ws((t) => { const dt = new DataTransfer(); dt.setData('text/plain', t); const r = window.__dn.view.root; r.focus(); r.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, SRC);
await page.waitForTimeout(300);
const srcId = await ws(() => [...window.__dn.view.engine.blocks()].find((b) => !b.ai).id);
await ws((id) => window.__dn.structure(id), srcId);
await page.waitForFunction(() => !window.__dn.state.aiRun, null, { timeout: 15000 });
await page.waitForTimeout(400);
const ai = (t) => ws((x) => [...window.__dn.view.engine.blocks()].find((b) => b.ai && JSON.stringify(window.__dn.view.engine.contentsOf(b.id).map((c) => c.doc)).includes(x)).id, t);
const lit = () => ws(() => { const h = CSS.highlights?.get('dn-source'); return h ? [...h].map((r) => r.toString()).join('|') : ''; });
const frame = () => page.waitForTimeout(120);

// 1) 고르면 원문 구절 강조, 다른 것 · 없음이면 바뀌거나 사라짐
await ws((id) => window.__dn.view.select([id]), await ai('대출 감소'));
await frame();
check('AI 상자 하나 고름 → 원문에서 그 구절 강조', (await lit()).replace(/\s/g, '') === '대출감소는소비위축을', await lit());
await ws((id) => window.__dn.view.select([id]), await ai('금리 인상'));
await frame();
check('다른 AI 상자 → 그 상자의 구절로', (await lit()).includes('금리 인상은'));
await page.screenshot({ path: `${OUT}/ai-source-01.png` });
await ws((id) => window.__dn.view.select([id]), await ai('소비 위축'));
await frame();
check('출처가 없는 AI 상자 → 강조 없음', (await lit()) === '');
await ws(() => window.__dn.view.select([]));
await frame();
check('고른 것 없음 → 강조 없음', (await lit()) === '');

// 2) '원문에서 보기': 원문 상자가 화면 밖이어도 그쪽으로 (고른 채라 강조도 보임)
const b = await ai('대출 감소');
await ws((id) => { const v = window.__dn.view, r = v.engine.getBlock(id); v.applyCamera({ x: r.x + 2000, y: r.y + 2000, zoom: 1 }); }, b);
await frame();
await ws((id) => { const v = window.__dn.view; v.select([id]); v['onBlockMenu']({ ids: [id], x: 300, y: 200 }); }, b);
await page.waitForTimeout(150);
await page.getByRole('menuitem', { name: '원문에서 보기' }).click();
await page.waitForTimeout(700);
const onScreen = await ws((id) => { const r = window.__dn.view.blockScreenRect(id); return !!r && r.x + r.w > 0 && r.y + r.h > 0 && r.x < innerWidth && r.y < innerHeight; }, srcId);
check("'원문에서 보기' → 원문 상자가 화면 안 · 구절 강조", onScreen && (await lit()).replace(/\s/g, '') === '대출감소는소비위축을');

// 3) 원문을 지우면 '출처 없음', 되돌리면 사라짐 (출처가 없던 상자에는 붙지 않음)
await ws((id) => { window.__dn.view.select([id]); window.__dn.view.deleteSelection(); }, srcId);
await frame();
const nosrc = () => ws(() => [...document.querySelectorAll('.dn-block.dn-nosrc')].length);
check("원문을 지우면 출처가 있던 AI 상자 둘에 '출처 없음'", (await nosrc()) === 2);
const after = await ws(() => getComputedStyle(document.querySelector('.dn-block.dn-nosrc > .dn-kind-tag'), '::after').content);
check("태그 뒤에 '출처 없음' 글자", after.includes('출처 없음'), after);
await ws(() => window.__dn.view.undo());
await frame();
check("되돌리면 '출처 없음'이 사라진다", (await nosrc()) === 0);

check('콘솔 · 페이지 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close();
const fails = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fails}/${results.length} 통과`);
process.exit(fails ? 1 : 0);
