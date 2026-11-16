// 결과 재요청 · 수정 (FR-110) — Anthropic API는 가짜로 가로챈다(실제 호출 · 비용 없음).
// 고른 AI 상자만 다시: 그 상자들이 나온 문단만 보내고, 결과로 그 상자들을 바꾼다 · 실행 취소 한 번이면 이전 결과.
// 그래프 ↔ 표: AI에 다시 묻지 않고 블록 메뉴에서 바로 · 실행 취소 한 번.
// 사용: dev 서버 실행 후 `node e2e/ai-again.mjs [스크린샷 폴더]` (DN_URL로 주소 변경)
import { chromium } from 'playwright-core';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2] ?? '.';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

const P = ['배경: 이 글은 시험용 첫 문단으로 다시 구조화 때 보내지 않아야 한다.', '금리 인상은 대출 감소로 이어진다.', '대출 감소는 소비 위축을 낳고, 소비 위축은 기업 매출을 줄인다.', '2025년 1분기 매출 120억, 2분기 140억이었다.'];
const SRC = P.join('\n\n');
const FIRST = {
  version: 'structure.v2', mode: 'diagram',
  nodes: [
    { key: 'a', title: '금리 인상', kind: 'concept', source: { quote: '금리 인상은' } },
    { key: 'b', title: '대출 감소', kind: 'concept', source: { quote: '대출 감소는' } },
    { key: 'c', title: '소비 위축', kind: 'concept', source: { quote: '소비 위축을 낳고' } },
  ],
  edges: [{ from: 'a', to: 'b', relation: 'causes' }, { from: 'b', to: 'c', relation: 'causes' }],
  charts: [{ key: 'ch', kind: 'bar', title: '분기 매출', unit: '억', series: [{ name: '매출', points: [{ x: '1분기', y: 120 }, { x: '2분기', y: 140 }] }], source: { quote: '매출 120억' } }],
  tables: [],
};
const AGAIN = {
  version: 'structure.v2', mode: 'diagram',
  nodes: [
    { key: 'x', title: '대출 감소', kind: 'event', source: { quote: '대출 감소는' } },
    { key: 'y', title: '소비 위축', kind: 'concept', source: { quote: '소비 위축은' } },
    { key: 'z', title: '기업 매출 감소', kind: 'risk', source: { quote: '기업 매출을 줄인다' } },
  ],
  edges: [{ from: 'x', to: 'y', relation: 'causes' }, { from: 'y', to: 'z', relation: 'causes' }],
  charts: [], tables: [],
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
const sent = [];
await page.route('https://api.anthropic.com/**', (route) => {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  if (req.url().includes('/v1/models/')) return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'model', id: 'claude-sonnet-5-5', display_name: 'x', created_at: '2026-01-01T00:00:00Z' }) });
  sent.push(JSON.stringify(req.postDataJSON()?.messages ?? ''));
  return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: stream(sent.length === 1 ? FIRST : AGAIN) });
}).catch(() => {});

const ws = (fn, arg) => page.evaluate(fn, arg);
await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(async () => { await window.__dn.acceptConsent(); await window.__dn.saveKey('sk-ant-test-again-0000'); await window.__dn.newNote({ sheet: null }); });
await page.waitForTimeout(300);
await ws((t) => { const dt = new DataTransfer(); dt.setData('text/plain', t); const r = window.__dn.view.root; r.focus(); r.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, SRC);
await page.waitForTimeout(300);
await ws(() => window.__dn.structure([...window.__dn.view.engine.blocks()].find((b) => !b.ai).id));
await page.waitForFunction(() => !window.__dn.state.aiRun, null, { timeout: 15000 });
await page.waitForTimeout(400);

const blocks = () => ws(() => { const e = window.__dn.view.engine; return [...e.blocks()].map((b) => ({ id: b.id, ai: !!b.ai, x: b.x, y: b.y, type: e.contentsOf(b.id)[0]?.type, text: JSON.stringify(e.contentsOf(b.id)) })); });
const first = await blocks();
const find = (list, t) => list.find((b) => b.ai && b.text.includes(t));
const pick = [find(first, '대출 감소'), find(first, '소비 위축')];
const menu = (ids) => ws((list) => { const v = window.__dn.view; v.select(list); v['onBlockMenu']({ ids: list, x: 300, y: 200 }); }, ids);

// 1) AI가 아닌 상자 메뉴는 'AI로 구조화', AI 상자를 고르면 'AI로 다시 구조화'
await menu([first.find((b) => !b.ai).id]);
await page.waitForTimeout(150);
check('원문 상자 메뉴: "AI로 구조화" (다시 아님)', (await page.getByRole('menuitem', { name: /AI로 구조화/ }).count()) === 1 && (await page.getByRole('menuitem', { name: /다시 구조화/ }).count()) === 0);
await page.keyboard.press('Escape');
await menu(pick.map((b) => b.id));
await page.waitForTimeout(150);
const again = page.getByRole('menuitem', { name: /AI로 다시 구조화/ });
check('AI 상자 둘 고른 메뉴: "AI로 다시 구조화"', await again.isVisible());
await again.click();
await page.waitForFunction(() => !window.__dn.state.aiRun, null, { timeout: 15000 });
await page.waitForTimeout(400);

// 2) 보낸 글은 그 상자들이 나온 문단만
const req = sent[1] ?? '';
check('다시 보낸 글: 고른 상자가 나온 문단만 (첫 문단 · 매출 문단은 없음)', req.includes('대출 감소는 소비 위축을 낳고') && !req.includes('시험용 첫 문단') && !req.includes('120억'), `요청 ${sent.length}번`);
const second = await blocks();
check('고른 두 상자는 바뀌고, 나머지(금리 인상 · 그래프 · 원문)는 그대로', pick.every((p) => !second.some((b) => b.id === p.id)) && ['금리 인상', '분기 매출'].every((t) => second.some((b) => b.id === find(first, t).id)) && !!find(second, '기업 매출 감소'));
const linked = await ws((from) => [...window.__dn.view.engine.arrows()].filter((a) => a.from.blockId === from).map((a) => JSON.stringify(window.__dn.view.engine.contentsOf(a.to.blockId))), find(first, '금리 인상').id);
check('바깥(금리 인상) → 대출 감소 화살표는 새 "대출 감소"로 다시 이어진다', linked.length === 1 && linked[0].includes('대출 감소'));
check('새 결과는 고른 상자들이 있던 자리 (왼쪽 위)', Math.abs(Math.min(...second.filter((b) => b.ai && !first.some((f) => f.id === b.id)).map((b) => b.x)) - Math.min(...pick.map((p) => p.x))) < 1);
check('알림: "고른 상자 2개를 다시 정리했어요"', (await page.locator('.toast').innerText().catch(() => '')).includes('고른 상자 2개를 다시 정리했어요'));
await page.screenshot({ path: `${OUT}/ai-again-01.png` });
await page.locator('.toast button', { hasText: '실행 취소' }).click();
await page.waitForTimeout(300);
const undone = await blocks();
check('실행 취소 한 번 → 이전 결과 그대로', first.every((f) => undone.some((b) => b.id === f.id)) && undone.length === first.length);

// 3) 그래프 ↔ 표 (AI 없이)
const chart = find(undone, '분기 매출');
const calls = sent.length;
await menu([chart.id]);
await page.waitForTimeout(150);
await page.getByRole('menuitem', { name: '표로 바꾸기' }).click();
await page.waitForTimeout(300);
const asTable = (await blocks()).find((b) => b.id === chart.id);
check('그래프 → 표: 같은 상자 · 같은 수치 (항목 · 매출 (억) 열)', asTable.type === 'table' && asTable.text.includes('매출 (억)') && asTable.text.includes('140'));
await menu([chart.id]);
await page.waitForTimeout(150);
await page.getByRole('menuitem', { name: '그래프로 바꾸기' }).click();
await page.waitForTimeout(300);
const back = (await blocks()).find((b) => b.id === chart.id);
check('표 → 그래프: 단위 억 · 매출 계열', back.type === 'chart' && back.text.includes('"unit":"억"') && back.text.includes('"매출"'));
check('그래프 ↔ 표는 AI를 부르지 않는다', sent.length === calls);
await ws(() => window.__dn.view.undo());
await page.waitForTimeout(200);
check('실행 취소 한 번 → 표로', (await blocks()).find((b) => b.id === chart.id).type === 'table');

check('콘솔 · 페이지 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close();
const fails = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fails}/${results.length} 통과`);
process.exit(fails ? 1 : 0);
