// AI 설정 · 마무리 (FR-140 추론 강도 · FR-141 사용량 · FR-021 종류별 기본색) + 블록 링크의 블록이 없을 때 안내 (FR-025).
// Anthropic API는 가짜로 가로채 세션 답(eval/session/runs/01)을 돌려준다. 사용: dev 서버 실행 후 `node e2e/ai-settings.mjs`
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
process.on('unhandledRejection', (e) => { if (!/TargetClosedError|has been closed/.test(String(e))) throw e; });
const answer = JSON.parse(readFileSync(new URL('../eval/session/runs/01-relation-rate-hike.json', import.meta.url), 'utf8'))[0].tool_input;
const source = readFileSync(new URL('../eval/structure/01-relation-rate-hike.md', import.meta.url), 'utf8');
const sse = (events) => events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');
const stream = (input) => sse([
  ['message_start', { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 4321, output_tokens: 1, cache_read_input_tokens: 1000 } } }],
  ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 't', name: 'emit_structure', input: {} } }],
  ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } }],
  ['content_block_stop', { type: 'content_block_stop', index: 0 }],
  ['message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 987 } }],
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
  sent.push(req.postDataJSON());
  return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: stream(answer) });
}).catch(() => {});
const ws = (fn, arg) => page.evaluate(fn, arg);
await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(async () => { await window.__dn.acceptConsent(); await window.__dn.saveKey('sk-ant-test-settings-0000'); });

// 설정: 추론 강도 높음
await ws(() => window.__dn.openSettings());
await page.waitForSelector('.settings');
await page.locator('.settings [role=tab], .settings button', { hasText: 'AI' }).first().click().catch(() => {});
await page.locator('[role=radiogroup][aria-label="추론 강도"] button', { hasText: '높음' }).click();
await page.waitForFunction(() => window.__dn.state.ai.effort === 'high', null, { timeout: 2000 }).catch(() => {});
check('추론 강도 기본은 보통 → 높음으로 바꾸면 기억', (await ws(() => window.__dn.state.ai.effort)) === 'high');
await page.keyboard.press('Escape');
await ws(() => window.__dn.closeDialog());

// 구조화 → 요청에 effort high · 사용량 기록 · 종류별 색
await ws(() => window.__dn.newNote());
await page.waitForTimeout(300);
await page.evaluate((t) => { const dt = new DataTransfer(); dt.setData('text/plain', t); const r = window.__dn.view.root; r.focus(); r.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, source);
await page.waitForTimeout(300);
const src = await ws(() => window.__dn.view.selectedBlocks[0] ?? [...window.__dn.view.engine.blocks()][0].id);
await ws((id) => window.__dn.structure(id), src);
await page.waitForFunction(() => !window.__dn.state.aiRun, null, { timeout: 15000 });
await page.waitForTimeout(300);
check('요청에 추론 강도 high', sent[0]?.output_config?.effort === 'high', JSON.stringify(sent[0]?.output_config));
// v6: AI는 노드 종류만 적고(저장된 색 없음) 색은 그릴 때 종류에서 정한다 — 화면에 그려진 바탕색으로 본다
const colors = await ws(() => {
  const v = window.__dn.view, e = v.engine;
  const by = (t) => {
    const b = [...e.blocks()].find((x) => x.ai && JSON.stringify(e.contentsOf(x.id)).includes(t));
    if (!b) return 'missing';
    const bg = v.mounted.get(b.id)?.el.style.background ?? '';
    return { kind: b.nodeKind ?? null, stored: b.style?.color ?? null, shown: /--dn-block-(\w+)/.exec(bg)?.[1] ?? null };
  };
  return { 결론: by('물가 안정'), 개념: by('대출 금리 상승') };
});
check('AI 블록 종류별 기본색 (결론 → 초록, 개념 → 기본) — 저장은 종류만, 색은 그릴 때', colors.결론?.shown === 'green' && colors.결론?.stored === null && colors.개념?.shown === null && colors.개념 !== 'missing', JSON.stringify(colors));
await ws(() => window.__dn.openSettings());
await page.waitForSelector('.settings');
await page.locator('.settings button', { hasText: 'AI' }).first().click().catch(() => {});
await page.waitForSelector('.usage-list', { timeout: 3000 }).catch(() => {});
const usage = await page.locator('.usage-list').innerText().catch(() => '');
check('설정 › AI에 사용량 (요청 1회 · 입력 4,321 · 출력 987)', usage.includes('1회') && usage.includes('4,321') && usage.includes('987'), usage.replace(/\n/g, ' '));
check('요청별 기록 (최근 요청)', (await page.locator('.usage-recent summary').innerText().catch(() => '')).includes('최근 요청 1개'));
await page.keyboard.press('Escape');
await ws(() => window.__dn.closeDialog());

// 블록 링크의 블록이 지워졌으면 안내
const note = await ws(() => window.__dn.state.currentId);
await ws((n) => { location.hash = `#n=${n}&b=AAAAAAAAAAAAAAAAAAAAAA`; }, note);
await page.waitForTimeout(600);
check('블록 링크의 블록이 없으면 노트만 열고 안내', (await page.locator('.toast').innerText().catch(() => '')).includes('링크한 블록을 찾지 못했어요'));

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
