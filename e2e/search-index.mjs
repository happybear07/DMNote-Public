// 검색 색인 구축 · 갱신 (FR-120) — Anthropic API(손글씨 읽기)는 가짜로 가로챈다(실제 호출 · 비용 없음).
// 노트를 만들고 · 고치고 · 휴지통 · 되살리기 · 영구 삭제할 때 색인이 따라오는지, 손글씨를 글로 읽은 결과가 (글 상자로 바꾸지 않아도)
// 검색 · 노트에 묻기 근거에 걸리고 누르면 그 필기로 가는지, 설정 › 데이터 '색인 다시 만들기'의 진행률 · 결과, 색인이 실패해도 편집 · 저장이 되는지.
// 사용: dev 서버 실행 후 `node e2e/search-index.mjs [스크린샷 폴더]` (DN_URL로 주소 변경)
import { chromium } from 'playwright-core';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2] ?? '.';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const sse = (events) => events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');
const ocrStream = (input) => sse([
  ['message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1200, output_tokens: 1 } } }],
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
await page.route('https://api.anthropic.com/**', async (route) => {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  if (req.url().includes('/v1/models/')) return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'model', id: 'claude-sonnet-5-5' }) });
  return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: ocrStream({ lines: [{ text: '분기 목표 보라코끼리 회의', confidence: 0.95 }], overallConfidence: 0.95 }) });
});
const ws = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
/** 앱 검색(휴지통 · 잠긴 노트 제외)에 걸린 노트 id */
const found = (q) => ws((q) => window.__dn.search(q).map((h) => h.noteId), q);
const stored = (id) => ws(async (id) => (await window.__dn.meta.listSearchDocs()).some((d) => d.noteId === id), id);
await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(async () => { await window.__dn.newNote({ sheet: null }); window.__dn.setTitle('색인 시험'); await window.__dn.acceptConsent(); await window.__dn.saveKey('sk-ant-test-index-0000'); window.__dn.closeDialog(); });
await wait(300);
const id = await ws(() => window.__dn.state.currentId);

// 1) 증분 갱신: 쓰면 걸리고, 고치면 새 낱말만
await ws(() => window.__dn.view.addBlockAtCenter('text'));
await page.keyboard.type('오늘의 낱말은 초록하마');
await page.keyboard.press('Escape');
await wait(900);
check('쓰고 잠시 뒤 색인 (메모리 · 저장 둘 다)', (await found('초록하마')).includes(id) && (await stored(id)));
const bid = await ws(() => window.__dn.view.selectedBlocks[0]);
await ws((b) => window.__dn.view.startEditing(b, 'end'), bid);
await page.keyboard.press('Control+a');
await page.keyboard.type('오늘의 낱말은 파랑기린');
await page.keyboard.press('Escape');
await wait(900);
check('고치면 옛 낱말은 빠지고 새 낱말이 걸림', !(await found('초록하마')).includes(id) && (await found('파랑기린')).includes(id));

// 2) 손글씨를 글로 읽고 그냥 닫아도 필기가 검색 · 근거에 걸린다
const root = await page.locator('.dn-canvas').boundingBox();
await ws(() => window.__dn.view.setTool('pen'));
await page.mouse.move(root.x + 200, root.y + 600); await page.mouse.down();
for (let i = 1; i <= 12; i++) await page.mouse.move(root.x + 200 + i * 15, root.y + 600 + (i % 2 ? 12 : -12));
await page.mouse.up();
const strokes = await ws(() => [...window.__dn.view.engine.strokes()].map((s) => s.id));
await ws(() => { const v = window.__dn.view; v.setTool('lasso'); for (const s of v.engine.strokes()) v.ink.selected.add(s.id); v.schedule(); v.notifyUi(); });
await wait(200);
await page.locator('.ink-bar button', { hasText: '글로 바꾸기' }).click();
await page.waitForSelector('.ocr-dialog textarea', { timeout: 15000 });
await page.locator('.ocr-dialog footer .btn.ghost', { hasText: '취소' }).click();
await wait(600);
const hit = await ws((q) => window.__dn.search(q)[0], '보라코끼리');
check('읽은 글 → 필기 블록(ink:첫 획)으로 검색에 걸림 · 글 상자는 안 생김', hit?.noteId === id && hit.blocks[0]?.id === `ink:${strokes[0]}` && (await ws(() => window.__dn.view.engine.blockCount)) === 1, JSON.stringify(hit?.blocks?.[0] ?? null));
check('검색 필터 "필기 (읽은 글)"', (await ws(() => window.__dn.search('보라코끼리', { kind: 'ink' }).length)) === 1 && (await ws(() => window.__dn.search('파랑기린', { kind: 'ink' }).length)) === 0);
const qa = await ws(() => window.__dn.qa.findPassages('보라코끼리 회의에서 뭐 했지', { kind: 'note', id: window.__dn.state.currentId }).passages.map((p) => p.ref));
check('노트에 묻기 근거에도 필기 조각', qa.some((r) => r.endsWith(`#ink:${strokes[0]}`)), qa.join(','));

// 결과를 누르면 그 필기로 (문서 뷰였으면 캔버스로)
await ws(() => { window.__dn.view.ink.selected.clear(); window.__dn.view.setTool('select'); window.__dn.view.animateTo({ x: 5000, y: 5000, zoom: 1 }, 0); window.__dn.setViewMode('doc'); });
await wait(400);
await ws((ref) => window.__dn.openHit(window.__dn.state.currentId, ref), `ink:${strokes[0]}`);
await wait(600);
const at = await ws(() => ({ mode: window.__dn.state.viewMode, sel: [...window.__dn.view.ink.selected], cam: window.__dn.view.cam }));
check('검색 결과 → 캔버스로 · 그 획들을 고르고 화면을 그 자리로', at.mode === 'canvas' && at.sel.join() === strokes.join() && at.cam.x < 1000, JSON.stringify(at));
await page.screenshot({ path: `${OUT}/search-index-01-ink.png` });
// 블록으로 묶은 필기 → 그 블록을 고르고 블록으로 (교차 검토 B7 — 전에는 콘텐츠 기준 획 자리로 엉뚱한 곳 · 올가미로 못 고름)
await page.locator('.ink-bar button', { hasText: '블록으로 묶기' }).click();
await wait(200);
const bound = await ws(() => window.__dn.view.selectedBlocks[0]);
await ws(() => { window.__dn.view.select([]); window.__dn.view.animateTo({ x: 5000, y: 5000, zoom: 1 }, 0); });
await ws((ref) => window.__dn.openHit(window.__dn.state.currentId, ref), `ink:${strokes[0]}`);
await wait(600);
const atB = await ws((b) => { const v = window.__dn.view, r = v.engine.blockRect(b), c = v.cam; const cx = c.x + v.size.w / 2 / c.zoom, cy = c.y + v.size.h / 2 / c.zoom; return { sel: v.selectedBlocks, ink: v.ink.selected.size, tool: v.tool, inView: cx > r.x - 50 && cx < r.x + r.w + 50 && cy > r.y - 50 && cy < r.y + r.h + 50 }; }, bound);
check('묶은 필기 결과 → 그 블록을 고르고 화면 가운데로 (올가미 아님)', !!bound && atB.sel.join() === bound && atB.ink === 0 && atB.tool !== 'lasso' && atB.inView, JSON.stringify(atB));
await ws(() => window.__dn.view.undo());
await wait(300);

// 3) 색인 다시 만들기: 설정 › 데이터 — 진행률 · 결과, 필기에서 읽은 글은 이어짐
await ws(() => window.__dn.openSettings());
await page.locator('.settings-nav button', { hasText: '데이터' }).click();
await page.locator('.reindex-btn').click();
await page.waitForFunction(() => !window.__dn.state.indexing, null, { timeout: 15000 });
const total = await ws(() => window.__dn.state.notes.length + window.__dn.state.trash.length);
check('다시 만들기 → 알림(노트 수) · 필기 글 · 낱말 그대로 걸림', (await page.locator('.toast').innerText()).includes(`노트 ${total}개`) && (await found('보라코끼리')).includes(id) && (await found('파랑기린')).includes(id), await page.locator('.toast').innerText());
// 저장소 오류로 멈춰도 진행 표시를 거두고 알림 — 단추가 계속 막히지 않게 (교차 검토 B11)
await ws(() => { const m = window.__dn.meta; m.__del = m.deleteSearchDoc; m.deleteSearchDoc = async () => { throw new Error('저장소 오류 시험'); }; });
await ws(async () => { const m = window.__dn.meta, docs = await m.listSearchDocs(); m.__list = m.listSearchDocs; m.listSearchDocs = async () => [...docs, { noteId: 'gone-note', blocks: [], updatedAt: 0 }]; });
await page.locator('.reindex-btn').click();
await wait(500);
const stuck = await ws(() => window.__dn.state.indexing);
check('다시 만들기 중 저장소 오류 → 진행 표시 거둠 · 알림 · 다시 누를 수 있음', stuck === null && (await page.locator('.toast').innerText()).includes('다시 만들지 못했어요') && !(await page.locator('.reindex-btn').isDisabled()), await page.locator('.toast').innerText());
await ws(() => { const m = window.__dn.meta; m.deleteSearchDoc = m.__del; m.listSearchDocs = m.__list; delete m.__del; delete m.__list; });
await ws(() => window.__dn.closeDialog());

// 4) 색인이 실패해도 편집 · 저장은 그대로 — 다음 편집에서 다시 맞춰진다
await ws(() => { const ix = window.__dn.index; ix.__put = ix.put; ix.put = () => { throw new Error('색인 실패 시험'); }; });
await ws((b) => window.__dn.view.startEditing(b, 'end'), bid);
await page.keyboard.type(' 노랑펭귄');
await page.keyboard.press('Escape');
await wait(1200);
const saved = await ws(async () => { await window.__dn.open.session.flush(); return window.__dn.state.status; });
check('색인 실패 중에도 편집 · 저장 (오류 화면 없음)', saved !== 'error' && (await ws((b) => JSON.stringify(window.__dn.view.engine.contentsOf(b)[0].doc), bid)).includes('노랑펭귄') && !(await found('노랑펭귄')).includes(id), String(saved));
await ws(() => { const ix = window.__dn.index; ix.put = ix.__put; delete ix.__put; });
await ws((b) => window.__dn.view.startEditing(b, 'end'), bid);
await page.keyboard.type('!');
await page.keyboard.press('Escape');
await wait(900);
check('다음 편집에서 다시 맞춰짐', (await found('노랑펭귄')).includes(id));

// 5) 필기를 모두 지우면 읽은 글도 빠지고, 되돌리면 다시 걸린다
await ws((ids) => { const v = window.__dn.view; v.setTool('lasso'); v.ink.selected.clear(); for (const s of ids) v.ink.selected.add(s); v.notifyUi(); }, strokes);
await page.keyboard.press('Delete');
await wait(900);
check('획을 지우면 읽은 글도 검색에서 빠짐', (await ws(() => [...window.__dn.view.engine.strokes()].length)) === 0 && !(await found('보라코끼리')).includes(id));
// 실행 취소로 획이 돌아오면 다시 걸린다 (교차 검토 B3 — 전에는 기록까지 버려 영영 사라졌다)
await ws(() => window.__dn.view.undo());
await wait(900);
check('실행 취소로 획이 돌아오면 읽은 글도 다시 걸림', (await ws(() => [...window.__dn.view.engine.strokes()].length)) === strokes.length && (await found('보라코끼리')).includes(id));
await ws(() => window.__dn.view.redo());
await wait(900);

// 6) 휴지통 · 되살리기 · 영구 삭제
await ws((id) => window.__dn.trash(id), id);
await wait(400);
check('휴지통 → 검색에서 빠짐 (색인은 남김)', !(await found('파랑기린')).includes(id) && (await stored(id)));
await ws((id) => window.__dn.restore([id]), id);
await wait(400);
check('되살리기 → 다시 걸림', (await found('파랑기린')).includes(id));
await ws((id) => window.__dn.trash(id), id);
await wait(300);
await ws((id) => window.__dn.deleteForever([id]), id);
await wait(400);
check('영구 삭제 → 메모리 · 저장 색인 모두 지움', !(await ws((id) => window.__dn.index.has(id), id)) && !(await stored(id)));

check('콘솔 · 페이지 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close();
const fails = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fails}/${results.length} 통과`);
process.exit(fails ? 1 : 0);
