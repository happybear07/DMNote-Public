// 필기 → AI 구조화 (FR-039) — Anthropic API는 가짜로 가로챈다(실제 호출 · 비용 없음).
// 올가미로 고른 필기 → 필기 막대 'AI로 구조화' → 손글씨 읽기 → (잘 읽혔으면 미리보기 없이) 붙여넣기와 같은 구조화 → 필기 옆에 결과.
// 필기는 그대로 · 실행 취소 한 번이면 결과만 사라짐 · 잘 안 읽혔으면 미리보기에서 고친 글로 '구조화하기'.
// 사용: dev 서버 실행 후 `node e2e/ai-ink.mjs [스크린샷 폴더]` (DN_URL로 주소 변경)
import { chromium } from 'playwright-core';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2] ?? '.';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const sse = (events) => events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');
const stream = (tool, input) => sse([
  ['message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1200, output_tokens: 1 } } }],
  ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: tool, input: {} } }],
  ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } }],
  ['content_block_stop', { type: 'content_block_stop', index: 0 }],
  ['message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 80 } }],
  ['message_stop', { type: 'message_stop' }],
]);
const STRUCT = {
  version: 'structure.v2', mode: 'diagram',
  nodes: [{ key: 'a', title: '금리 인상', kind: 'concept' }, { key: 'b', title: '대출 감소', kind: 'concept' }],
  edges: [{ from: 'a', to: 'b', relation: 'causes' }], charts: [], tables: [],
};

const browser = await chromium.launch({ channel: process.env.DN_CHANNEL ?? 'msedge', headless: true }); // CI(리눅스)는 DN_CHANNEL=chrome
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => localStorage.setItem('dn:no-env-key', '1'));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push(m.text()); });
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
let ocr = { lines: [{ text: '금리가 오르면 대출이 줄고', confidence: 0.93 }, { text: '대출이 줄면 소비도 줄어든다', confidence: 0.91 }], overallConfidence: 0.92 };
const sent = [];
let failStruct = false;
let structReply = null;
await page.route('https://api.anthropic.com/**', async (route) => {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  if (req.url().includes('/v1/models/')) return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'model', id: 'claude-sonnet-5-5' }) });
  const body = req.postDataJSON();
  const tool = body.tools?.[0]?.name;
  sent.push({ tool, text: JSON.stringify(body.messages) });
  if (tool === 'emit_structure' && failStruct) return route.fulfill({ status: 400, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'test' } }) });
  return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: tool === 'emit_ocr' ? stream('emit_ocr', ocr) : stream('emit_structure', structReply ?? STRUCT) });
});
const ws = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(async () => { await window.__dn.newNote({ sheet: null }); await window.__dn.acceptConsent(); await window.__dn.saveKey('sk-ant-test-ink-0000'); });
await wait(300);

// 펜으로 두 줄 → 올가미로 고르기
const root = await page.locator('.dn-canvas').boundingBox();
const write = async (y) => { await page.mouse.move(root.x + 300, root.y + y); await page.mouse.down(); for (let i = 1; i <= 12; i++) await page.mouse.move(root.x + 300 + i * 15, root.y + y + (i % 2 ? 12 : -12)); await page.mouse.up(); };
await ws(() => window.__dn.view.setTool('pen'));
await write(300);
await write(360);
const pick = () => ws(() => { const v = window.__dn.view; v.setTool('lasso'); for (const s of v.engine.strokes()) v.ink.selected.add(s.id); v.schedule(); v.notifyUi(); });
await pick();
await wait(200);
const strokes = await ws(() => [...window.__dn.view.engine.strokes()].length);
// 필기 오른쪽 끝(화면 x 480) → 월드 x
const inkRight = await ws(() => { const v = window.__dn.view, p0 = v.toScreen({ x: 0, y: 0, w: 0, h: 0 }); return (480 - p0.x) / v.cam.zoom; });

// 1) 잘 읽힘 → 미리보기 없이 바로 구조화
await page.locator('.ink-bar button', { hasText: 'AI로 구조화' }).click();
await page.waitForFunction(() => window.__dn.state.aiRun, null, { timeout: 15000 }).catch(() => {});
await page.waitForFunction(() => !window.__dn.state.aiRun && [...window.__dn.view.engine.blocks()].some((b) => b.ai), null, { timeout: 20000 }).catch(async () => {
  console.log('DEBUG', JSON.stringify({ sent: sent.map((s) => s.tool), st: await ws(() => ({ ocr: window.__dn.state.ocr && { ...window.__dn.state.ocr, image: '' }, aiRun: !!window.__dn.state.aiRun, keys: Object.keys(window.__dn.state) })), toast: await page.locator('.toast').allInnerTexts(), errors }));
  process.exit(1);
});
await wait(300);
check('보낸 요청: 손글씨 읽기(emit_ocr) → 읽은 글로 구조화(emit_structure)', sent[0]?.tool === 'emit_ocr' && sent[1]?.tool === 'emit_structure' && sent[1].text.includes('소비도 줄어든다'), sent.map((s) => s.tool).join(','));
check('잘 읽혔으면 미리보기 창 없이', (await page.locator('.ocr-dialog').count()) === 0);
const res = await ws(() => { const e = window.__dn.view.engine; return { ai: [...e.blocks()].filter((b) => b.ai).map((b) => ({ x: b.x })), arrows: [...e.arrows()].length, strokes: [...e.strokes()].length }; });
check('결과: 블록 2 · 화살표 1, 필기는 그대로', res.ai.length === 2 && res.arrows === 1 && res.strokes === strokes, JSON.stringify(res));
check('결과는 필기 오른쪽에', Math.min(...res.ai.map((b) => b.x)) > inkRight, `블록 x ${Math.round(Math.min(...res.ai.map((b) => b.x)))} · 필기 끝 ${Math.round(inkRight)}`);
check('알림: 구조화 완료 (블록 · 화살표)', (await page.locator('.toast').innerText().catch(() => '')).includes('블록 2개'));
await page.screenshot({ path: `${OUT}/ai-ink-01.png` });
await ws(() => window.__dn.view.undo());
await wait(200);
check('실행 취소 한 번 → 결과만 사라지고 필기는 그대로', (await ws(() => [...window.__dn.view.engine.blocks()].filter((b) => b.ai).length)) === 0 && (await ws(() => [...window.__dn.view.engine.strokes()].length)) === strokes);

// 1-1) 바로 구조화가 실패하면 읽은 글을 잃지 않게 — 알림의 '글 상자로 넣기' (교차 검토 B5)
failStruct = true;
sent.length = 0;
await pick();
await wait(150);
await page.locator('.ink-bar button', { hasText: 'AI로 구조화' }).click();
await page.waitForFunction(() => window.__dn.state.toast && !window.__dn.state.aiRun && [window.__dn.state.toast.action?.label, window.__dn.state.toast.alt?.label].includes('글 상자로 넣기'), null, { timeout: 20000 }).catch(() => {});
failStruct = false;
check('구조화 실패 → 알림에 "글 상자로 넣기"', sent.map((s) => s.tool).join() === 'emit_ocr,emit_structure' && (await page.locator('.toast').innerText().catch(() => '')).includes('글 상자로 넣기'), await page.locator('.toast').innerText().catch(() => ''));
const nb = await ws(() => window.__dn.view.engine.blockCount);
await page.locator('.toast button', { hasText: '글 상자로 넣기' }).click();
await wait(300);
const box = await ws(() => { const e = window.__dn.view.engine, b = [...e.blocks()].at(-1); return { n: e.blockCount, doc: JSON.stringify(e.contentsOf(b.id)[0].doc), ai: !!b.ai, sel: window.__dn.view.selectedBlocks.join() === b.id }; });
check('글 상자로 넣기 → 읽은 글 상자 하나 · AI 출처 없음(사람이 넣음) · 고른 채', box.n === nb + 1 && box.doc.includes('소비도 줄어든다') && !box.ai && box.sel, JSON.stringify(box).slice(0, 160));
await ws(() => window.__dn.view.undo());
await wait(200);

// 2) 잘 안 읽힘 → 미리보기(주 단추 '구조화하기')에서 고친 글로
ocr = { lines: [{ text: '금□가 오르면 대출이 □고', confidence: 0.4 }, { text: '대출이 줄면 소□도 줄어든다', confidence: 0.45 }], overallConfidence: 0.42 };
sent.length = 0;
await pick();
await wait(150);
await page.locator('.ink-bar button', { hasText: 'AI로 구조화' }).click();
await page.waitForSelector('.ocr-dialog textarea', { timeout: 15000 });
check('잘 안 읽힘 → 미리보기 · 주 단추 "구조화하기"', (await page.locator('.ocr-dialog .btn.primary').innerText()) === '구조화하기' && sent.length === 1);
await page.locator('.ocr-dialog textarea').fill('금리가 오르면 대출이 줄고\n대출이 줄면 소비도 줄어든다');
await page.locator('.ocr-dialog .btn.primary').click();
await page.waitForFunction(() => !window.__dn.state.aiRun && [...window.__dn.view.engine.blocks()].some((b) => b.ai), null, { timeout: 20000 });
check('고친 글로 구조화 요청', sent[1]?.tool === 'emit_structure' && sent[1].text.includes('소비도 줄어든다') && !sent[1].text.includes('□'));

await ws(() => window.__dn.view.undo());
await wait(200);

// 3) 잘 읽혔어도 짧으면(공백 빼고 20자 미만) 바로 구조화하지 않고 미리보기 — 읽은 글을 잃지 않게
ocr = { lines: [{ text: '금리 → 대출 감소', confidence: 0.95 }], overallConfidence: 0.95 };
sent.length = 0;
await pick();
await wait(150);
await page.locator('.ink-bar button', { hasText: 'AI로 구조화' }).click();
await page.waitForSelector('.ocr-dialog textarea', { timeout: 15000 });
check('짧은 글 → 미리보기 · 안내 "글이 짧아", 구조화 요청 없음', sent.length === 1 && (await page.locator('.ocr-dialog .ocr-hint', { hasText: '글이 짧아' }).count()) === 1);
await page.locator('.ocr-dialog .btn.primary').click();
await wait(200);
check('짧은 글로 "구조화하기" → 알림, 창은 그대로', (await page.locator('.ocr-dialog').count()) === 1 && (await page.locator('.toast').innerText().catch(() => '')).includes('글이 짧아요') && sent.length === 1);
await page.locator('.ocr-dialog .btn.ghost').click();

// 3-1) 미리보기에서 정밀 인식 → 잘 읽혀도 바로 구조화하지 않고 새 결과를 미리보기로 (교차 검토 B6 — 확인 없이 구조화됐다)
ocr = { lines: [{ text: '금□가 오르면 대출이 □고', confidence: 0.4 }, { text: '대출이 줄면 소□도 줄어든다', confidence: 0.45 }], overallConfidence: 0.42 };
sent.length = 0;
await pick();
await wait(150);
await page.locator('.ink-bar button', { hasText: 'AI로 구조화' }).click();
await page.waitForSelector('.ocr-conf.lo', { timeout: 15000 });
ocr = { lines: [{ text: '금리가 오르면 대출이 줄고', confidence: 0.93 }, { text: '대출이 줄면 소비도 줄어든다', confidence: 0.91 }], overallConfidence: 0.92 };
await page.locator('.ocr-dialog footer button', { hasText: '정밀 인식' }).click();
await page.waitForSelector('.ocr-conf.hi', { timeout: 15000 });
await wait(300);
check('정밀 인식 → 새 결과를 미리보기로 · 구조화 요청 없음', sent.map((s) => s.tool).join() === 'emit_ocr,emit_ocr' && (await page.locator('.ocr-dialog textarea').inputValue()).includes('소비도') && (await page.locator('.ocr-dialog .btn.primary').innerText()) === '구조화하기', sent.map((s) => s.tool).join());
await page.locator('.ocr-dialog .btn.ghost').click();

// 4) A4 노트 → 결과는 필기 아래 (오른쪽은 용지 밖)
ocr = { lines: [{ text: '금리가 오르면 대출이 줄고', confidence: 0.93 }, { text: '대출이 줄면 소비도 줄어든다', confidence: 0.91 }], overallConfidence: 0.92 };
await ws(() => window.__dn.newNote({ sheet: { size: 'a4' } }));
await wait(400);
await ws(() => window.__dn.view.setTool('pen'));
await write(300);
await write(360);
const inkBottom = await ws(() => { const v = window.__dn.view, p0 = v.toScreen({ x: 0, y: 0, w: 0, h: 0 }); return (372 - p0.y) / v.cam.zoom; });
await pick();
await wait(150);
await page.locator('.ink-bar button', { hasText: 'AI로 구조화' }).click();
await page.waitForFunction(() => !window.__dn.state.aiRun && [...window.__dn.view.engine.blocks()].some((b) => b.ai), null, { timeout: 20000 });
const a4 = await ws(() => { const e = window.__dn.view.engine; return { ys: [...e.blocks()].filter((b) => b.ai).map((b) => b.y), right: Math.max(...[...e.blocks()].filter((b) => b.ai).map((b) => b.x + b.w)), sheetW: e.note.sheet ? 794 : 0 }; });
check('A4 → 결과는 필기 아래 · 용지 안', Math.min(...a4.ys) > inkBottom && a4.right <= a4.sheetW, `블록 y ${Math.round(Math.min(...a4.ys))} · 필기 끝 ${Math.round(inkBottom)} · 오른쪽 ${Math.round(a4.right)}`);
await page.screenshot({ path: `${OUT}/ai-ink-02-a4.png` });

// 4-1) A4에서 고른 필기 아래에 다른 필기가 있으면 결과가 덮지 않는다 — 도식형 · 노트형 (교차 검토 B6)
for (const [mode, reply] of [['도식형', null], ['노트형', { version: 'structure.v2', mode: 'sheet', nodes: [], edges: [], charts: [], tables: [], sheet: { title: '금리와 소비', sections: [{ title: '흐름', pieces: [{ type: 'text', md: '- 금리가 오르면 대출이 준다\n- 대출이 줄면 소비도 준다' }] }] } }]]) {
  structReply = reply;
  await ws(() => window.__dn.newNote({ sheet: { size: 'a4' } }));
  await wait(400);
  await ws(() => window.__dn.view.setTool('pen'));
  await write(300);
  await write(360);
  await write(440);
  await ws(() => { const v = window.__dn.view, ss = [...v.engine.strokes()]; v.setTool('lasso'); v.ink.selected.clear(); for (const s of ss.slice(0, 2)) v.ink.selected.add(s.id); v.schedule(); v.notifyUi(); });
  await wait(150);
  await page.locator('.ink-bar button', { hasText: 'AI로 구조화' }).click();
  await page.waitForFunction(() => !window.__dn.state.aiRun && [...window.__dn.view.engine.blocks()].some((b) => b.ai), null, { timeout: 20000 });
  // 아래 필기(화면 x 300~480 · y 428~452)의 월드 자리
  const cover = await ws(() => {
    const v = window.__dn.view, e = v.engine, p0 = v.toScreen({ x: 0, y: 0, w: 0, h: 0 }), z = v.cam.zoom;
    const r = { x: (300 - p0.x) / z, y: (428 - p0.y) / z, w: 180 / z, h: 24 / z };
    const hit = [...e.blocks()].filter((b) => b.ai && b.x < r.x + r.w && r.x < b.x + b.w && b.y < r.y + r.h && r.y < b.y + b.h).length;
    return { hit, top: Math.min(...[...e.blocks()].filter((b) => b.ai).map((b) => b.y)), inkBottom: r.y + r.h };
  });
  check(`A4 ${mode}: 아래 필기를 덮지 않고 그 아래에`, cover.hit === 0 && cover.top > cover.inkBottom, JSON.stringify(cover));
}
structReply = null;

check('콘솔 · 페이지 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close();
const fails = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fails}/${results.length} 통과`);
process.exit(fails ? 1 : 0);
