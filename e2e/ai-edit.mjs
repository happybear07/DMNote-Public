// 고른 글 AI 편집 · 작성 도우미 (FR-112) — Anthropic API는 가짜로 가로챈다(실제 호출 · 비용 없음).
// 글을 고르고 말풍선 'AI'(캔버스는 Ctrl+J도) → 요약 · 자세히 · 다듬기 · 말투 → 미리보기(흘러나옴) → 바꾸기 · 아래에 넣기 → 실행 취소 한 번.
// 키가 없으면 안내 · 원문에 없던 숫자 강조 · 고른 뒤 글이 바뀌면 넣지 않음 · 키보드만으로 (교차 검토 C5) · 문서 뷰에서도.
// 사용: dev 서버 실행 후 `node e2e/ai-edit.mjs [스크린샷 폴더]` (DN_URL로 주소 변경)
import { chromium } from 'playwright-core';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2] ?? '.';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const sse = (events) => events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');
/** 글을 세 조각으로 흘려 보내는 응답 */
const textStream = (text, stop = 'end_turn') => {
  const n = Math.ceil(text.length / 3), parts = [text.slice(0, n), text.slice(n, 2 * n), text.slice(2 * n)].filter(Boolean);
  return sse([
    ['message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 420, output_tokens: 1 } } }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ...parts.map((p) => ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: p } }]),
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 40 } }],
    ['message_stop', { type: 'message_stop' }],
  ]);
};

const browser = await chromium.launch({ channel: process.env.DN_CHANNEL ?? 'msedge', headless: true }); // CI(리눅스)는 DN_CHANNEL=chrome
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => localStorage.setItem('dn:no-env-key', '1'));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push(m.text()); });
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
let reply = '', stopReason = 'end_turn';
const sent = [];
await page.route('https://api.anthropic.com/**', async (route) => {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  if (req.url().includes('/v1/models/')) return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'model', id: 'claude-sonnet-5-5' }) });
  sent.push(req.postDataJSON());
  return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: textStream(reply, stopReason) });
});
const ws = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(async () => { await window.__dn.newNote({ sheet: null }); await window.__dn.acceptConsent(); });
await wait(300);

const ORIGINAL = '회의는 다음 주 화요일 3시에 합니다. 예산은 1,200만 원이고 담당은 민수입니다. 장소는 본관 2층이에요.';
await ws(() => window.__dn.view.addBlockAtCenter('text'));
await page.keyboard.type(ORIGINAL);
await page.keyboard.press('Escape');
await wait(200);
const bid = await ws(() => window.__dn.view.selectedBlocks[0]);
const text = () => ws((id) => { const d = window.__dn.view.engine.contentsOf(id).find((c) => c.doc).doc; return d.content.map((p) => (p.content ?? []).map((t) => t.text ?? '').join('')).join('\n'); }, bid);
/** 편집 중인 글에서 phrase를 DOM 범위로 고르기 */
const select = (root, phrase) => page.evaluate(([root, phrase]) => {
  const el = document.querySelector(root);
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let n; while ((n = walker.nextNode()) && !n.textContent.includes(phrase));
  const i = n.textContent.indexOf(phrase);
  const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + phrase.length);
  const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  document.dispatchEvent(new Event('selectionchange'));
}, [root, phrase]);
const done = () => page.waitForSelector('.ai-edit footer .btn.primary', { timeout: 15000 });

// 1) 글 고르기 → 말풍선 'AI' → 창 (고른 글자 수)
const PICK = '예산은 1,200만 원이고 담당은 민수입니다.';
await ws((id) => window.__dn.view.startEditing(id, 'end'), bid);
await wait(150);
await select('.dn-text-editing', PICK);
await page.waitForSelector('.dn-bubble:not([hidden]) .dn-bubble-ai', { timeout: 3000 });
check('말풍선 맨 앞에 AI 단추 (캔버스는 Ctrl+J 안내)', (await page.locator('.dn-bubble .dn-bubble-ai').getAttribute('title')).includes('Ctrl+J'));
await page.locator('.dn-bubble .dn-bubble-ai').click();
await page.waitForSelector('.ai-edit', { timeout: 3000 });
check('작성 도우미 창 · 고른 글 글자 수', (await page.locator('.ai-edit-title small').innerText()).includes(`${PICK.length}자`), await page.locator('.ai-edit-title small').innerText());

// 2) 키가 없으면 키 등록 안내 — 창은 그대로, 등록 뒤 다시 누르면 된다
await page.locator('.ai-edit-chip', { hasText: '요약' }).click();
await wait(300);
check('키 없음 → 설정 창 · 안내 문구, 요청 없음', (await ws(() => window.__dn.state.dialog?.kind)) === 'settings' && (await ws(() => window.__dn.state.dialog?.reason ?? '')).includes('AI로 고칠 수') && sent.length === 0 && (await page.locator('.ai-edit').count()) === 1);
// DS-F9: 작성 도우미(떠 있는 판)가 창을 덮지 않는다 — 창이 떠 있는 동안 숨겼다가 닫히면 다시
const layer = await ws(() => { const d = document.querySelector('.dialog-backdrop > *'), r = d.getBoundingClientRect(), top = document.elementFromPoint(r.left + r.width / 2, r.top + 24); return { panel: getComputedStyle(document.querySelector('.ai-edit')).visibility, onTop: !!top && d.contains(top) }; });
check('DS-F9: 창이 떠 있는 동안 작성 도우미는 숨김 · 창이 맨 위', layer.panel === 'hidden' && layer.onTop, JSON.stringify(layer));
await ws(async () => { await window.__dn.saveKey('sk-ant-test-edit-0000'); window.__dn.closeDialog(); });
await wait(200);
check('창을 닫으면 작성 도우미가 다시 보임', (await page.locator('.ai-edit').evaluate((el) => getComputedStyle(el).visibility)) === 'visible');

// 3) 요약 → 흘러나온 결과 · 요청 모양 · 원문에 없던 숫자 강조
reply = '예산 1,200만 원(15% 늘림), 담당 민수.';
await page.locator('.ai-edit-chip', { hasText: '요약' }).click();
await done();
const body = sent[0];
const user = typeof body.messages[0].content === 'string' ? body.messages[0].content : '';
check('요청: 도구 없음 · 시스템 캐시 · 첫 request_meta에 nonce · action · 고른 글은 nonce 태그 안', !body.tools && body.system[0].cache_control?.type === 'ephemeral' && /^<request_meta>\nnonce: (\w{16})\naction: summarize\nlocale: ko\n<\/request_meta>/.test(user) && user.includes(`<dn_selection_${/nonce: (\w{16})/.exec(user)?.[1]}>\n${PICK}\n</dn_selection_`), user.slice(0, 80));
check('미리보기: 결과 · 원문에 없던 숫자(15)만 강조 · 확인 안내', (await page.locator('.ai-edit-out').innerText()).includes('담당 민수') && (await page.locator('.ai-edit-out mark.ai-edit-new').allInnerTexts()).join(',') === '15' && (await page.locator('.ai-edit-warn').innerText()).includes('15'));
await page.screenshot({ path: `${OUT}/ai-edit-01-preview.png` });

// 4) 바꾸기 → 고른 글만 결과로 · 실행 취소 한 번이면 원래대로
await page.locator('.ai-edit footer .btn.primary').click();
await wait(250);
const after = await text();
check('바꾸기: 고른 글만 바뀜 (앞뒤 문장 그대로) · 창 닫힘 · 알림', after === ORIGINAL.replace(PICK, reply) && (await page.locator('.ai-edit').count()) === 0 && (await page.locator('.toast').innerText()).includes('바꿨어요'), after);
await page.keyboard.press('Escape');
await ws(() => window.__dn.view.undo());
await wait(200);
check('실행 취소 한 번 → 원문 그대로', (await text()) === ORIGINAL, await text());

// 5) Ctrl+J (고른 글 없음 = 상자 전체) → 해요체 → 아래에 넣기
await ws((id) => window.__dn.view.startEditing(id, 'end'), bid);
await wait(150);
await page.keyboard.press('Control+j');
await page.waitForSelector('.ai-edit', { timeout: 3000 });
check('Ctrl+J → 상자 전체 글로 창', (await page.locator('.ai-edit-title small').innerText()).includes(`${ORIGINAL.length}자`));
reply = '회의는 다음 주 화요일 3시에 해요.';
sent.length = 0;
await page.locator('.ai-edit-chip', { hasText: '해요체' }).click();
await done();
check('말투: tone 줄 · 고른 칩 표시', (sent[0].messages[0].content).includes('action: tone\ntone: casual\n') && (await page.locator('.ai-edit-chip.on').innerText()) === '해요체');
await page.locator('.ai-edit footer .btn', { hasText: '아래에 넣기' }).click();
await wait(250);
check('아래에 넣기: 원문 그대로 + 아래 문단', (await text()) === `${ORIGINAL}\n${reply}`, await text());
await page.keyboard.press('Escape');
await ws(() => window.__dn.view.undo());
await wait(200);
check('실행 취소 한 번 → 넣은 문단만 사라짐', (await text()) === ORIGINAL);

// 6) 결과를 받은 뒤 글이 바뀌었으면 넣지 않는다
await ws((id) => window.__dn.view.startEditing(id, 'end'), bid);
await wait(150);
await page.keyboard.press('Control+j');
await page.waitForSelector('.ai-edit');
reply = '다듬은 글';
await page.locator('.ai-edit-chip', { hasText: '다듬기' }).click();
await done();
await ws((id) => window.__dn.view.startEditing(id, 'end'), bid);
await page.keyboard.type(' 추가');
await page.locator('.ai-edit footer .btn.primary').click();
await wait(200);
check('고른 뒤 글이 바뀜 → 넣지 않고 알림', (await text()) === `${ORIGINAL} 추가` && (await page.locator('.toast').innerText()).includes('바뀌어서'));
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
await ws(() => window.__dn.view.undo());
await wait(200);

// 6-1) 끝이 잘린 결과(max_tokens) → 바꾸기 없음 · 아래에 넣기만 (교차 검토 A5 — 고른 글 뒷부분이 사라지지 않게)
await ws((id) => window.__dn.view.startEditing(id, 'end'), bid);
await wait(150);
await page.keyboard.press('Control+j');
await page.waitForSelector('.ai-edit');
reply = '회의는 다음 주 화요일 3시에 하고 예산은';
stopReason = 'max_tokens';
await page.locator('.ai-edit-chip', { hasText: '다듬기' }).click();
await done();
stopReason = 'end_turn';
const btns = await page.locator('.ai-edit footer .btn').allInnerTexts();
check('잘린 결과: 바꾸기 단추 없음 · 아래에 넣기가 주 단추 · 경고', !btns.includes('바꾸기') && (await page.locator('.ai-edit footer .btn.primary').innerText()) === '아래에 넣기' && (await page.locator('.ai-edit-warn').innerText()).includes('잘렸어요'), JSON.stringify(btns));
await page.locator('.ai-edit footer .btn.primary').click();
await wait(200);
check('잘린 결과 아래에 넣기 → 원문은 그대로', (await text()) === `${ORIGINAL}
${reply}`, await text());
await page.keyboard.press('Escape');
await ws(() => window.__dn.view.undo());
await wait(200);

// 6-2) 키보드만으로 (교차 검토 C5 — 창이 따로 떠서 Tab으로 닿지 않았다): Ctrl+J → 첫 할 일(요약)에 초점 → Tab · Enter로 다듬기
//      → 결과가 나오면 바꾸기에 초점 → Enter → 창이 닫히면 그 상자를 고른 채 캔버스에 초점 (Enter면 다시 고치기)
await ws((id) => window.__dn.view.startEditing(id, 'end'), bid);
await wait(150);
await page.keyboard.press('Control+j');
await page.waitForSelector('.ai-edit');
const focused = () => ws(() => { const a = document.activeElement; return a?.closest('.ai-edit') ? a.textContent : a?.className ?? ''; });
check('키보드: 창이 열리면 첫 할 일(요약)에 초점', (await focused()) === '요약', await focused());
await page.keyboard.press('Tab');
await page.keyboard.press('Tab');
reply = '회의는 다음 주 화요일 3시입니다. 예산은 1,200만 원이고 담당은 민수입니다. 장소는 본관 2층이에요.';
sent.length = 0;
await page.keyboard.press('Enter');
await done();
await wait(150);
check('키보드: Tab · Enter로 다듬기 → 결과가 나오면 바꾸기에 초점', sent.length === 1 && sent[0].messages[0].content.includes('action: polish') && (await focused()) === '바꾸기', await focused());
await page.keyboard.press('Enter');
await wait(250);
check('키보드: Enter로 바꾸기 → 창 닫힘 · 그 상자를 고른 채 캔버스에 초점', (await text()) === reply && (await page.locator('.ai-edit').count()) === 0
  && (await ws(() => document.activeElement === window.__dn.view.root)) && JSON.stringify(await ws(() => window.__dn.view.selectedBlocks)) === JSON.stringify([bid]), await focused());
await page.keyboard.press('Enter');
await wait(150);
check('키보드: Enter → 그 상자를 다시 고치기', (await ws((id) => !!document.querySelector(`.dn-block[data-id="${id}"] .dn-text-editing`), bid)));
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
await ws(() => window.__dn.view.undo());
await wait(200);
// 바깥(캔버스 빈 곳)을 눌러 닫으면 초점을 되돌리지 않는다
await ws((id) => window.__dn.view.startEditing(id, 'end'), bid);
await wait(150);
await page.keyboard.press('Control+j');
await page.waitForSelector('.ai-edit');
await page.locator('.topbar').click({ position: { x: 5, y: 5 } });
await wait(200);
check('바깥을 눌러 닫음 → 초점을 캔버스로 끌어오지 않음', (await page.locator('.ai-edit').count()) === 0 && !(await ws(() => document.activeElement === window.__dn.view.root)), await focused());

// 7) 문서 뷰: 말풍선 'AI' (Ctrl+J는 양쪽 맞춤이라 안내 없음) → 다듬기 → 바꾸기
await ws(() => window.__dn.setViewMode('doc'));
await wait(500);
await page.locator('.dn-doc-text', { hasText: '본관 2층' }).first().click();
await wait(200);
await select('.dn-doc-editing', '장소는 본관 2층이에요.');
await page.waitForSelector('.dn-bubble:not([hidden]) .dn-bubble-ai', { timeout: 3000 });
check('문서 뷰 말풍선 AI — 단축키 안내 없음', !(await page.locator('.dn-bubble:not([hidden]) .dn-bubble-ai').getAttribute('title')).includes('Ctrl+J'));
await page.locator('.dn-bubble:not([hidden]) .dn-bubble-ai').click();
await page.waitForSelector('.ai-edit');
reply = '장소는 본관 2층 회의실이에요.';
await page.locator('.ai-edit-chip', { hasText: '다듬기' }).click();
await done();
await page.screenshot({ path: `${OUT}/ai-edit-02-doc.png` });
await page.locator('.ai-edit footer .btn.primary').click();
await wait(250);
check('문서 뷰 바꾸기 → 캔버스 글도 같이', (await text()) === ORIGINAL.replace('장소는 본관 2층이에요.', reply), await text());

check('콘솔 · 페이지 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close();
const fails = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fails}/${results.length} 통과`);
process.exit(fails ? 1 : 0);
