// 손글씨 → 글 (FR-038 · 화면 11): 펜으로 쓰고 올가미로 고름 → 필기 막대 "글로 바꾸기" → (가짜 Claude) 미리보기 · 신뢰도 →
// 고쳐서 글로 바꾸기(필기 지움 · 실행 취소 한 번) · 글 상자 추가(필기 남김) · 낮은 신뢰도 안내 · 보낸 요청(그림 · 도구 · 모델) · 정밀 인식은 큰 모델.
// 사용: dev 서버 실행 후 `node e2e/ocr.mjs [스크린샷 폴더]`
import { chromium } from 'playwright-core';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2] ?? '.';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const sse = (events) => events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');
const stream = (input, model = 'claude-sonnet-5-5') => sse([
  ['message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1200, output_tokens: 1 } } }],
  ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'emit_ocr', input: {} } }],
  ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } }],
  ['content_block_stop', { type: 'content_block_stop', index: 0 }],
  ['message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 80 } }],
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
let reply = { lines: [{ text: '회의 메모', confidence: 0.95 }, { text: '- 예산 확인', confidence: 0.9 }], overallConfidence: 0.92 };
const sent = [];
await page.route('https://api.anthropic.com/**', async (route) => {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  if (req.url().includes('/v1/models/')) return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'model', id: 'claude-sonnet-5-5' }) });
  const body = req.postDataJSON();
  sent.push(body);
  return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: stream(reply, body.model) });
});
const ws = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(() => window.__dn.newNote());
await wait(300);
await ws(() => window.__dn.acceptConsent());
check('API 키 저장', (await ws(() => window.__dn.saveKey('sk-ant-test-key-abcd'))) === null);

// 펜으로 두 줄 쓰기 → 올가미로 고르기
const root = await page.locator('.dn-canvas').boundingBox();
const write = async (y) => { await page.mouse.move(root.x + 300, root.y + y); await page.mouse.down(); for (let i = 1; i <= 12; i++) await page.mouse.move(root.x + 300 + i * 15, root.y + y + (i % 2 ? 12 : -12)); await page.mouse.up(); };
await ws(() => window.__dn.view.setTool('pen'));
await write(300);
await write(360);
await ws(() => { const v = window.__dn.view; v.setTool('lasso'); for (const s of v.engine.strokes()) v.ink.selected.add(s.id); v.schedule(); v.notifyUi(); });
await wait(200);
await page.locator('.ink-bar button', { hasText: '글로 바꾸기' }).click();
await page.waitForSelector('.ocr-dialog textarea', { timeout: 15000 });
const req = sent[0];
const content = req?.messages?.[0]?.content ?? [];
check('보낸 요청: 그림(PNG) 다음 안내 · emit_ocr 도구 · Sonnet', content[0]?.type === 'image' && content[0]?.source?.media_type === 'image/png' && content[0]?.source?.data?.length > 100 && content[1]?.type === 'text' && req.tools?.[0]?.name === 'emit_ocr' && req.model === 'claude-sonnet-5-5');
check('미리보기: 고른 손글씨 그림 · 읽은 글 · 신뢰도 높음', (await page.locator('.ocr-ink img').count()) === 1 && (await page.locator('.ocr-dialog textarea').inputValue()) === '회의 메모\n- 예산 확인' && (await page.locator('.ocr-conf.hi').count()) === 1);
await page.screenshot({ path: `${OUT}/ocr-preview.png` });
await page.locator('.ocr-dialog textarea').fill('회의 메모\n- 예산 확인\n[ ] 메일 보내기');
const n0 = await ws(() => ({ b: window.__dn.view.engine.blockCount, s: [...window.__dn.view.engine.strokes()].length }));
await page.locator('.ocr-dialog .btn.primary', { hasText: '글로 바꾸기' }).click();
await wait(300);
const after = await ws(() => { const e = window.__dn.view.engine; const b = [...e.blocks()].at(-1); return { b: e.blockCount, s: [...e.strokes()].length, doc: JSON.stringify(e.contentsOf(b.id)[0].doc) }; });
check('글로 바꾸기: 고친 글이 상자로(목록 · 할 일) · 필기는 지움', after.b === n0.b + 1 && after.s === 0 && after.doc.includes('bullet_list') && after.doc.includes('task_list') && after.doc.includes('메일 보내기'), JSON.stringify(after).slice(0, 200));
await ws(() => window.__dn.view.undo());
await wait(200);
check('실행 취소 한 번 → 필기 되살아나고 상자 없음', (await ws(() => [...window.__dn.view.engine.strokes()].length)) === n0.s && (await ws(() => window.__dn.view.engine.blockCount)) === n0.b);
const inkText = () => ws(() => window.__dn.index.inkOf(window.__dn.view.engine.note.id).map((x) => x.text).join(' | '));
check('필기 검색 글은 미리보기에서 고친 글 (OCR 원문 아님, 교차 검토 B4)', (await inkText()) === '회의 메모\n- 예산 확인\n[ ] 메일 보내기', await inkText());

// 낮은 신뢰도 · 정밀 인식 · 글 상자 추가(필기 남김)
reply = { lines: [{ text: '□의 메□', confidence: 0.4 }], overallConfidence: 0.4 };
await ws(() => { const v = window.__dn.view; v.setTool('lasso'); for (const s of v.engine.strokes()) v.ink.selected.add(s.id); v.schedule(); v.notifyUi(); });
await wait(150);
await page.locator('.ink-bar button', { hasText: '글로 바꾸기' }).click();
await page.waitForSelector('.ocr-conf.lo', { timeout: 15000 });
check('낮은 신뢰도 → 경고 · "필기 그대로 묶기" 권함', (await page.locator('.ocr-hint').count()) === 1 && (await page.locator('.ocr-dialog footer button', { hasText: '필기 그대로 묶기' }).count()) === 1);
reply = { lines: [{ text: '회의 메모', confidence: 0.93 }], overallConfidence: 0.93 };
await page.locator('.ocr-dialog footer button', { hasText: '정밀 인식' }).click();
await page.waitForSelector('.ocr-conf.hi', { timeout: 15000 });
check('정밀 인식 → 큰 모델(Opus)로 다시', sent.at(-1).model === 'claude-opus-5-5' && (await page.locator('.ocr-dialog textarea').inputValue()) === '회의 메모');
await page.locator('.ocr-dialog footer button', { hasText: '글 상자 추가' }).click();
await wait(300);
check('글 상자 추가 → 필기는 남김', (await ws(() => [...window.__dn.view.engine.strokes()].length)) === n0.s && (await ws(() => window.__dn.view.engine.blockCount)) === n0.b + 1);

// 고치고 취소해도 필기 검색 글은 고친 글로 (글 상자로 바꾸지 않고 닫는 경우)
await ws(() => { const v = window.__dn.view; v.setTool('lasso'); for (const s of v.engine.strokes()) v.ink.selected.add(s.id); v.schedule(); v.notifyUi(); });
await wait(150);
await page.locator('.ink-bar button', { hasText: '글로 바꾸기' }).click();
await page.waitForSelector('.ocr-conf.hi', { timeout: 15000 });
check('다시 읽으면 검색 글은 새 OCR 결과', (await inkText()) === '회의 메모', await inkText());
await page.locator('.ocr-dialog textarea').fill('회의 메모 (화요일)');
await page.locator('.ocr-dialog footer button', { hasText: '취소' }).click();
await wait(200);
check('고치고 취소 → 검색 글은 고친 글', (await page.locator('.ocr-dialog').count()) === 0 && (await inkText()) === '회의 메모 (화요일)', await inkText());

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
