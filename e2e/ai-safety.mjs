// AI 안전 고침 (10/28 교차 검토 높음 3건) — Anthropic API는 가짜로 가로챈다(실제 호출 · 비용 없음).
// ① 잠긴 노트의 필기는 손글씨 읽기 · AI로 구조화로 보내지 않는다 ② 노트를 바꾸면 작성 도우미 · 손글씨 창이 닫히고 보내던 요청도 그만 —
// 결과가 다른 노트에 들어가지 않는다 ③ '바꾸기'에서 노트 링크 · 날짜는 ⟦n⟧ 표지로 보내고 원래 물건으로 되돌린다(링크 · 알림 유지),
// 못 지키는 서식(글자 색 · 댓글 표시)은 미리 알리고 '아래에 넣기'를 주 단추로.
// 사용: dev 서버 실행 후 `node e2e/ai-safety.mjs [스크린샷 폴더]` (DN_URL로 주소 변경)
import { chromium } from 'playwright-core';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2] ?? '.';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const sse = (events) => events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');
const textStream = (text) => sse([
  ['message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 420, output_tokens: 1 } } }],
  ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
  ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }],
  ['content_block_stop', { type: 'content_block_stop', index: 0 }],
  ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 40 } }],
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
let reply = '', delay = 0;
const sent = [];
await page.route('https://api.anthropic.com/**', async (route) => {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  if (req.url().includes('/v1/models/')) return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'model', id: 'claude-sonnet-5-5' }) });
  sent.push(req.postDataJSON());
  if (delay) await new Promise((r) => setTimeout(r, delay));
  return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: textStream(reply) }).catch(() => {});
});
const ws = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(async () => { await window.__dn.newNote({ sheet: null }); window.__dn.setTitle('안전 시험 A'); await window.__dn.acceptConsent(); await window.__dn.saveKey('sk-ant-test-safety-0000'); window.__dn.closeDialog(); });
await wait(300);
const noteA = await ws(() => window.__dn.state.currentId);
/** 글 상자 하나 (doc JSON 그대로) */
const box = (doc) => ws((doc) => { const e = window.__dn.view.engine; return e.transact((tx) => { const b = tx.createBlock({ x: 0, y: 0, w: 420, h: 60 }); tx.createContent({ blockId: b, type: 'text', role: 'body', doc }); return b; }, { origin: 'user' }).value; }, doc);
const ctrlJ = async (id) => { await ws((id) => window.__dn.view.startEditing(id, 'end'), id); await wait(150); await page.keyboard.press('Control+j'); await page.waitForSelector('.ai-edit', { timeout: 3000 }); };
const done = () => page.waitForSelector('.ai-edit footer .btn.primary', { timeout: 15000 });

// ③ 노트 링크 · 날짜는 표지로 보내고 바꾼 뒤 원래 물건으로
const t = (text, marks) => ({ type: 'text', text, ...(marks ? { marks } : {}) });
const linked = await box({ type: 'doc', content: [{ type: 'paragraph', content: [t('회의 '), { type: 'note_link', attrs: { id: noteA, title: '안전 시험 A' } }, t(' 검토 '), { type: 'date_mention', attrs: { date: '2026-11-03', time: '09:00', repeat: '' } }, t(' 전까지 해야햠')] }] });
await ctrlJ(linked);
check('물건만 있는 글은 경고 없음 · 바꾸기가 주 단추 자리', (await page.locator('.ai-edit-warn').count()) === 0);
reply = '⟦2⟧까지 ⟦1⟧을 검토해야 함.';
await page.locator('.ai-edit-chip', { hasText: '다듬기' }).click();
await done();
const req = sent.at(-1).messages[0].content;
check('요청: 노트 링크 · 날짜는 ⟦1⟧ · ⟦2⟧ 표지로', req.includes('회의 ⟦1⟧ 검토 ⟦2⟧ 전까지 해야햠'), req.slice(-80));
check('미리보기는 표지 대신 물건의 글자', (await page.locator('.ai-edit-out').innerText()) === '2026-11-03 09:00까지 [[안전 시험 A]]을 검토해야 함.', await page.locator('.ai-edit-out').innerText());
await page.locator('.ai-edit footer .btn.primary', { hasText: '바꾸기' }).click();
await wait(250);
const types = await ws((id) => window.__dn.view.engine.contentsOf(id)[0].doc.content[0].content.map((n) => n.type).join(','), linked);
check('바꾸기 뒤에도 날짜(알림) · 노트 링크가 물건 그대로', types === 'date_mention,text,note_link,text', types);
await page.keyboard.press('Escape');

// 못 지키는 서식 → 미리 알리고 '아래에 넣기'가 주 단추
const colored = await box({ type: 'doc', content: [{ type: 'paragraph', content: [t('빨간 글로 강조한 문장이에요', [{ type: 'textColor', attrs: { color: 'red' } }])] }] });
await ws((id) => { const e = window.__dn.view.engine; e.transact((tx) => tx.set('block', id, { y: 200 }), { origin: 'user' }); }, colored);
await ctrlJ(colored);
check('서식 경고: 바꾸면 사라지는 서식 — 글자 색', (await page.locator('.ai-edit-warn').innerText().catch(() => '')).includes('글자 색'));
reply = '빨간 글로 강조한 문장입니다.';
await page.locator('.ai-edit-chip', { hasText: '다듬기' }).click();
await done();
check("주 단추가 '아래에 넣기'", (await page.locator('.ai-edit footer .btn.primary').innerText()) === '아래에 넣기');
await page.screenshot({ path: `${OUT}/ai-safety-01-lost.png` });
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');

// ② 노트를 바꾸면 창이 닫히고 결과가 다른 노트에 들어가지 않는다 (요약 보내는 중 → 다른 노트)
delay = 1500;
reply = '- 요약 하나';
const before = sent.length;
await ws(() => window.__dn.summarizeNote());
await page.waitForSelector('.ai-edit[aria-label="AI로 노트 요약"]');
await wait(200);
await ws(async () => { await window.__dn.newNote({ sheet: null }); });
await wait(2000);
const noteB = await ws(() => window.__dn.state.currentId);
const b = await ws(() => ({ open: !!window.__dn.state.aiEdit, blocks: window.__dn.view.engine.blockCount }));
check('노트를 바꾸면 작성 도우미 창이 닫힘 · 새 노트에 아무것도 안 들어감', noteB !== noteA && !b.open && b.blocks === 0 && sent.length === before + 1, JSON.stringify(b));
delay = 0;

// ① 잠긴 노트의 필기는 보내지 않는다 (잠금 판정만 켜서 — 금고 설정 없이)
const root = await page.locator('.dn-canvas').boundingBox();
await ws(() => window.__dn.view.setTool('pen'));
await page.mouse.move(root.x + 300, root.y + 300); await page.mouse.down();
for (let i = 1; i <= 10; i++) await page.mouse.move(root.x + 300 + i * 15, root.y + 300 + (i % 2 ? 12 : -12));
await page.mouse.up();
await ws(() => { const v = window.__dn.view; v.setTool('lasso'); for (const s of v.engine.strokes()) v.ink.selected.add(s.id); v.schedule(); v.notifyUi(); });
await wait(200);
await ws(() => { const st = window.__dn.store; st.__isLocked = st.isLocked; st.isLocked = () => true; });
const n0 = sent.length;
await page.locator('.ink-bar button', { hasText: 'AI로 구조화' }).click();
await wait(500);
check('잠긴 노트: AI로 구조화 → 보내지 않고 알림', sent.length === n0 && (await page.locator('.toast').innerText()).includes('잠긴 노트는 AI로 보내지 않아요') && !(await ws(() => !!window.__dn.state.ocr)));
await page.locator('.ink-bar button', { hasText: '글로 바꾸기' }).click();
await wait(400);
check('잠긴 노트: 글로 바꾸기도 보내지 않음', sent.length === n0);
await ws(() => { const st = window.__dn.store; st.isLocked = st.__isLocked; delete st.__isLocked; });

check('콘솔 · 페이지 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close();
const fails = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fails}/${results.length} 통과`);
process.exit(fails ? 1 : 0);
