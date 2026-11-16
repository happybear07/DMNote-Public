// AI 자동 구조화 흐름 (FR-105~109 · FR-139, 화면 03 · 04 · 08) — Anthropic API는 가짜로 가로챈다(실제 호출 · 비용 없음).
// 사용: dev 서버 실행 후 `node e2e/ai.mjs [스크린샷 폴더]` (DN_URL로 주소 변경)
import { chromium } from 'playwright-core';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2] ?? '.';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

const STRUCTURE = {
  nodes: [
    { key: 'n1', title: '금리 인상', kind: 'concept', source: { quote: '금리 인상' } },
    { key: 'n2', title: '대출 감소', kind: 'concept' },
    { key: 'n3', title: '소비 위축', kind: 'concept' },
  ],
  edges: [{ from: 'n1', to: 'n2', relation: 'causes' }, { from: 'n2', to: 'n3', relation: 'leads-to' }],
  charts: [], tables: [],
};
const sse = (events) => events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');
const messagesStream = (input) => {
  const json = JSON.stringify(input);
  return sse([
    ['message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 900, output_tokens: 1 } } }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'emit_structure', input: {} } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: json } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 321 } }],
    ['message_stop', { type: 'message_stop' }],
  ]);
};

const browser = await chromium.launch({ channel: process.env.DN_CHANNEL ?? 'msedge', headless: true }) // CI(리눅스)는 DN_CHANNEL=chrome;
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
// .env.local 키가 있어도 실제 Claude를 부르지 않게 (가짜 응답 · 비용 방지)
await ctx.addInitScript(() => localStorage.setItem('dn:no-env-key', '1'));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|401|Failed to load resource/.test(m.text())) errors.push(m.text()); });

// 가짜 Anthropic API
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
let mode = 'ok'; // ok | unauthorized | slow
const sent = [];
await page.route('https://api.anthropic.com/**', async (route) => {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  if (mode === 'unauthorized') {
    return route.fulfill({ status: 401, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }) });
  }
  if (req.url().includes('/v1/models/')) {
    return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'model', id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5', created_at: '2026-01-01T00:00:00Z' }) });
  }
  sent.push({ headers: req.headers(), body: req.postDataJSON() });
  if (mode === 'slow') await new Promise((r) => setTimeout(r, 4000));
  return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: messagesStream(STRUCTURE) });
}).catch(() => {});

const ws = (fn, arg) => page.evaluate(fn, arg);
await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await page.waitForTimeout(300);

const paste = (text) => page.evaluate((t) => {
  const dt = new DataTransfer(); dt.setData('text/plain', t);
  const root = window.__dn.view.root; root.focus();
  root.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, text);
const SRC = '## 금리 인상의 영향\n\n금리 인상은 대출 감소로 이어지고, 대출 감소는 소비 위축을 낳습니다.\n- 금리 인상 → 대출 감소\n- 대출 감소 → 소비 위축';

// 03: 붙여넣기 → 칩
await paste(SRC);
await page.waitForTimeout(150);
check('03 붙여넣기 후 "구조화하기" 칩', await page.locator('.ai-chip').isVisible());
await page.screenshot({ path: `${OUT}/ai-03-chip.png` });
const before = await ws(() => ({ b: window.__dn.view.engine.blockCount, a: [...window.__dn.view.engine.arrows()].length }));

// 동의 → 키 등록 → 이어서 실행
await page.locator('.ai-chip .btn.ai').click();
check('처음 실행 시 AI 동의 다이얼로그', await page.locator('.dialog', { hasText: 'AI를 쓰기 전에' }).isVisible());
await page.locator('.dialog .btn.primary').click();
await page.waitForSelector('.settings');
check('키가 없으면 설정(08)이 이유와 함께 열림', (await page.locator('.settings-reason').innerText()).includes('API 키가 있어야'));
mode = 'unauthorized';
await page.locator('.key-input input').fill('sk-ant-wrong-key-0000');
await page.locator('.key-row .btn').click();
await page.waitForSelector('.key-msg.err');
check('잘못된 키는 저장하지 않고 안내', (await page.locator('.key-msg').innerText()).includes('연결하지 못했어요') && !(await ws(() => window.__dn.state.ai.keyLast4)));
mode = 'ok';
await page.locator('.key-input input').fill('sk-ant-test-key-abcd');
await page.screenshot({ path: `${OUT}/ai-08-settings.png` });
await page.locator('.key-row .btn').click();
await page.waitForFunction(() => !document.querySelector('.settings'), null, { timeout: 5000 });
check('키 확인 후 저장 · 대기 중이던 구조화 이어서 실행', (await ws(() => window.__dn.state.ai.keyLast4)) === 'abcd');

await page.waitForFunction(() => !window.__dn.state.aiRun, null, { timeout: 10000 });
await page.waitForTimeout(400);
const after = await ws(() => ({ b: window.__dn.view.engine.blockCount, a: [...window.__dn.view.engine.arrows()].length }));
check('결과: 블록 3개 · 화살표 2개 생성', after.b - before.b === 3 && after.a - before.a === 2, JSON.stringify({ blocks: after.b - before.b, arrows: after.a - before.a }));
const toast = await page.locator('.toast').innerText().catch(() => '');
check('완료 토스트 (MSG-AI-024)', toast.includes('블록 3개 · 화살표 2개를 만들었어요'), toast);
await page.screenshot({ path: `${OUT}/ai-05-result.png` });
const prov = await ws(() => [...window.__dn.view.engine.blocks()].filter((b) => b.ai).length);
check('AI가 만든 블록에 출처 표시(AiProvenance)', prov === 3);

// 요청 형태 (BYOK 직접 호출)
const r0 = sent[0];
check('직접 호출 헤더 · 모델 · 원문 nonce 감싸기',
  r0 && r0.headers['anthropic-dangerous-direct-browser-access'] === 'true' && r0.headers['x-api-key'] === 'sk-ant-test-key-abcd' && r0.body.model === 'claude-sonnet-5-5'
  && !('temperature' in r0.body) && JSON.stringify(r0.body.messages).includes('대출 감소'),
  r0 ? `model=${r0.body.model} max_tokens=${r0.body.max_tokens}` : '요청 없음');

// 실행 취소 한 번으로 전부 사라짐
await page.locator('.toast button', { hasText: '실행 취소' }).click();
const undone = await ws(() => ({ b: window.__dn.view.engine.blockCount, a: [...window.__dn.view.engine.arrows()].length }));
check('토스트의 실행 취소 한 번 → AI 결과 전부 제거, 원문은 남음', undone.b === before.b && undone.a === before.a);

// 키는 평문으로 저장되지 않는다
const raw = await ws(() => new Promise((res) => {
  const r = indexedDB.open('dn-app');
  r.onsuccess = () => { const g = r.result.transaction('secrets').objectStore('secrets').getAll(); g.onsuccess = () => res(JSON.stringify(g.result.map((x) => ({ ...x, key: undefined, data: [...new Uint8Array(x.data ?? [])].length })))); };
}));
check('API 키는 IDB에 암호화돼 저장 (평문 없음)', !raw.includes('sk-ant'));

// 취소 (FR-103)
mode = 'slow';
const srcId = await ws(() => [...window.__dn.view.engine.blocks()].find((b) => JSON.stringify(window.__dn.view.engine.contentsOf(b.id)[0]?.doc ?? '').includes('금리 인상의 영향')).id);
await ws((id) => { window.__dn.view.select([id]); }, srcId);
await page.keyboard.press('Control+Alt+KeyS');
await page.waitForSelector('.ai-progress', { timeout: 3000 });
await page.screenshot({ path: `${OUT}/ai-04-progress.png` });
await page.locator('.ai-progress .btn').click();
await page.waitForFunction(() => !window.__dn.state.aiRun, null, { timeout: 5000 });
const t2 = await page.locator('.toast').innerText().catch(() => '');
const afterCancel = await ws(() => window.__dn.view.engine.blockCount);
check('진행 중 취소 → 노트 그대로 · 안내', afterCancel === before.b && t2.includes('취소했어요'), t2);

// 블록 메뉴에서도 요청
mode = 'ok';
await ws((id) => { const v = window.__dn.view; v.select([id]); v['onBlockMenu']({ ids: [id], x: 300, y: 200 }); }, srcId);
await page.locator('.menu .ai-item').click();
await page.waitForFunction(() => !window.__dn.state.aiRun, null, { timeout: 10000 });
check('블록 메뉴 "AI로 구조화"', (await ws(() => window.__dn.view.engine.blockCount)) === before.b + 3);

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
