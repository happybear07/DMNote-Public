// AI로 노트 요약 (FR-115) — Anthropic API는 가짜로 가로챈다(실제 호출 · 비용 없음).
// 노트 ⋯ › AI로 노트 요약 → 노트 전체 글(제목 포함, 앞머리 · 그림 데이터 없이)을 digest로 → 미리보기 → 노트 맨 위 'AI 요약' 콜아웃.
// 캔버스는 아무것도 안 옮기고 맨 위 위에, A4는 용지 맨 위에 두고 상자 · 필기를 같이 내림 · 실행 취소 한 번 · 짧은 노트는 안내만.
// 동의 · 키가 없으면 그 창을 지난 뒤 요약을 이어서 (교차 검토 A8 · C4).
// 사용: dev 서버 실행 후 `node e2e/ai-summary.mjs [스크린샷 폴더]` (DN_URL로 주소 변경)
import { chromium } from 'playwright-core';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2] ?? '.';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const sse = (events) => events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');
const textStream = (text) => sse([
  ['message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 900, output_tokens: 1 } } }],
  ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
  ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: text.slice(0, 20) } }],
  ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: text.slice(20) } }],
  ['content_block_stop', { type: 'content_block_stop', index: 0 }],
  ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 70 } }],
  ['message_stop', { type: 'message_stop' }],
]);
const REPLY = '- 예산은 1,200만 원으로 확정\n- 출시는 10월 31일\n\n**결정**\n- 예산 확정\n\n**할 일**\n- [ ] 민수: 견적서 보내기 (금요일까지)';

const browser = await chromium.launch({ channel: process.env.DN_CHANNEL ?? 'msedge', headless: true }); // CI(리눅스)는 DN_CHANNEL=chrome
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
  return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: textStream(REPLY) });
});
const ws = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(async () => { await window.__dn.newNote({ sheet: null }); await window.__dn.acceptConsent(); await window.__dn.saveKey('sk-ant-test-sum-0000'); window.__dn.closeDialog(); });
await wait(300);

const write = async (lines) => {
  await ws(() => window.__dn.view.addBlockAtCenter('text'));
  for (const [i, l] of lines.entries()) { if (i) await page.keyboard.press('Enter'); await page.keyboard.type(l); }
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await wait(150);
};
const blocks = () => ws(() => [...window.__dn.view.engine.blocks()].map((b) => ({ id: b.id, x: b.x, y: b.y, ai: !!b.ai })));
const summarize = async () => {
  await page.locator('.top-more .more-btn').click();
  await page.locator('.top-more-menu .summary-btn').click();
};

// 1) 짧은 노트 → 안내만, 요청 없음
await ws(() => window.__dn.setTitle('메모'));
await write(['짧은 글']);
await summarize();
await wait(300);
check('글이 너무 적으면 안내만 · 요청 없음', (await page.locator('.toast').innerText()).includes('요약할 글이 너무 적어요') && sent.length === 0 && (await page.locator('.ai-edit').count()) === 0);

// 2) 캔버스 노트 → ⋯ › AI로 노트 요약 → 미리보기 → 맨 위에 넣기
await ws(async () => { await window.__dn.newNote({ sheet: null }); });
await wait(300);
await ws(() => window.__dn.setTitle('주간 회의'));
await write(['예산은 1,200만 원으로 확정했다.', '출시는 10월 31일로 잡았다.', '민수가 금요일까지 견적서를 보내기로 했다.']);
const before = await blocks();
await summarize();
await page.waitForSelector('.ai-edit footer .btn.primary:has-text("노트 맨 위에 넣기")', { timeout: 15000 });
const user = sent[0]?.messages[0].content ?? '';
check('보낸 글: action digest · 노트 제목과 글 · 앞머리 YAML 없음', user.includes('action: digest') && user.includes('# 주간 회의') && user.includes('견적서를 보내기로') && !/\ntitle: |\ncreated: /.test(user), user.slice(0, 160));
check('창: AI로 노트 요약 · 할 일 칩 없음 · 결과 미리보기 · "노트 맨 위에 넣기"', (await page.locator('.ai-edit-title').innerText()).includes('AI로 노트 요약') && (await page.locator('.ai-edit-chip').count()) === 0
  && (await page.locator('.ai-edit-out').innerText()).includes('견적서 보내기') && (await page.locator('.ai-edit footer .btn.primary').innerText()) === '노트 맨 위에 넣기');
await page.screenshot({ path: `${OUT}/ai-summary-01-preview.png` });
await page.locator('.ai-edit footer .btn.primary').click();
await wait(300);
const after = await blocks();
const added = after.find((b) => !before.some((x) => x.id === b.id));
const sum = await ws((id) => { const e = window.__dn.view.engine; const c = e.contentsOf(id)[0]; const order = [...window.__dn.view.engine.blocks()]; return { doc: JSON.stringify(c.doc), ai: e.getBlock(id).ai }; }, added?.id);
check('맨 위 콜아웃: AI 요약 · 보라 · 결정 · 할 일 체크박스 · AI 출처 표시', !!added && sum.doc.includes('"callout"') && sum.doc.includes('"purple"') && sum.doc.includes('AI 요약') && sum.doc.includes('task_item') && sum.ai?.generated === true && sum.ai?.promptVersion === 'edit.v1', sum.doc.slice(0, 120));
check('캔버스: 다른 상자는 그대로 · 새 상자는 맨 위 위쪽', before.every((b) => after.some((x) => x.id === b.id && x.x === b.x && x.y === b.y)) && added.y < Math.min(...before.map((b) => b.y)));
check('알림: 노트 맨 위에 요약을 넣었어요', (await page.locator('.toast').innerText()).includes('맨 위에 요약'));
await page.screenshot({ path: `${OUT}/ai-summary-02-canvas.png` });

// 문서 뷰에서도 첫 항목
await ws(() => window.__dn.setViewMode('doc'));
await wait(500);
check('문서 뷰 첫 항목이 요약', (await page.locator('.dn-doc-text').first().innerText()).includes('AI 요약'));
await ws(() => window.__dn.setViewMode('canvas'));
await wait(300);
await ws(() => window.__dn.view.undo());
await wait(200);
check('실행 취소 한 번 → 요약 상자만 사라짐', (await blocks()).length === before.length);

// 3) A4 노트: 용지 맨 위 · 상자 · 필기를 같은 만큼 내림
await ws(async () => { await window.__dn.newNote({ sheet: { size: 'a4' } }); });
await wait(400);
await ws(() => window.__dn.setTitle('A4 회의'));
await write(['예산은 1,200만 원으로 확정했다.', '민수가 금요일까지 견적서를 보내기로 했다.']);
const root = await page.locator('.dn-canvas').boundingBox();
await ws(() => window.__dn.view.setTool('pen'));
await page.mouse.move(root.x + 700, root.y + 300); await page.mouse.down();
for (let i = 1; i <= 10; i++) await page.mouse.move(root.x + 700 + i * 12, root.y + 300 + (i % 2 ? 10 : -10));
await page.mouse.up();
await ws(() => window.__dn.view.setTool('select'));
// 내용을 용지 위쪽으로 — 요약 들어갈 자리가 모자라게
await ws(() => { const e = window.__dn.view.engine; e.transact((tx) => { for (const b of e.blocks()) tx.set('block', b.id, { y: 40 }); for (const s of e.strokes()) tx.set('stroke', s.id, { origin: { x: s.origin.x, y: 120 } }); }, { origin: 'user', label: '시험 준비' }); });
await wait(150);
const a4Before = await ws(() => ({ blocks: [...window.__dn.view.engine.blocks()].map((b) => ({ id: b.id, y: b.y })), ink: [...window.__dn.view.engine.strokes()].map((s) => ({ id: s.id, y: s.origin.y })) }));
sent.length = 0;
await summarize();
await page.waitForSelector('.ai-edit footer .btn.primary:has-text("노트 맨 위에 넣기")', { timeout: 15000 });
await page.locator('.ai-edit footer .btn.primary').click();
await wait(300);
const a4After = await ws(() => ({ blocks: [...window.__dn.view.engine.blocks()].map((b) => ({ id: b.id, y: b.y, x: b.x, w: b.w, ai: !!b.ai, h: b.h })), ink: [...window.__dn.view.engine.strokes()].map((s) => ({ id: s.id, y: s.origin.y })) }));
const top = a4After.blocks.find((b) => b.ai);
const dys = [...a4Before.blocks.map((b) => a4After.blocks.find((x) => x.id === b.id).y - b.y), ...a4Before.ink.map((s) => a4After.ink.find((x) => x.id === s.id).y - s.y)];
check('A4: 요약은 용지 안쪽 맨 위 · 용지 폭', !!top && top.y === 24 && top.x === 24 && top.w === 794 - 48, JSON.stringify(top));
check('A4: 상자 · 필기를 같은 만큼 내림 (겹치지 않게)', dys.length >= 2 && dys.every((d) => d === dys[0]) && dys[0] > 0 && Math.min(...a4Before.blocks.map((b) => b.y)) + dys[0] >= top.y + top.h, dys.join(','));
await page.screenshot({ path: `${OUT}/ai-summary-03-a4.png` });
await ws(() => window.__dn.view.undo());
await wait(200);
const a4Undo = await ws(() => [...window.__dn.view.engine.strokes()].map((s) => s.origin.y));
check('A4 실행 취소 한 번 → 상자 · 필기 제자리', JSON.stringify(a4Undo) === JSON.stringify(a4Before.ink.map((s) => s.y)) && (await ws(() => [...window.__dn.view.engine.blocks()].length)) === a4Before.blocks.length);

// 4) 동의 · 키 없이 요약 → 동의 창 → 키 창 → 저장하면 요약을 이어서 (교차 검토 A8 · C4 — 전에는 창이 단추 없이 멈춤)
await ws(async () => { await window.__dn.withdrawConsent(); await window.__dn.deleteKey(); await window.__dn.newNote({ sheet: null }); });
await wait(300);
await ws(() => window.__dn.setTitle('다시 요약'));
await write(['예산은 1,200만 원으로 확정했다.', '민수가 금요일까지 견적서를 보내기로 했다.']);
sent.length = 0;
await summarize();
await page.waitForSelector('.consent-dialog', { timeout: 5000 });
// 요약 창은 동의 창이 떠 있는 동안 숨겨진다(DS-F9) — 보이는 글(innerText) 대신 textContent
check('동의가 없으면 동의 창 · 요약 창에 요약하기 단추', sent.length === 0 && (await page.locator('.ai-edit footer .btn.primary').textContent()) === '요약하기');
await page.locator('.consent-dialog .btn.primary').click();
await page.waitForSelector('.settings .key-input input', { timeout: 5000 });
check('동의하면 이어서 → 키가 없어 키 창', sent.length === 0 && (await page.locator('.consent-dialog').count()) === 0);
await page.locator('.settings .key-input input').fill('sk-ant-test-sum-1111');
await page.locator('.settings .key-input input').press('Enter');
await page.waitForSelector('.ai-edit footer .btn.primary:has-text("노트 맨 위에 넣기")', { timeout: 15000 });
check('키를 저장하면 창이 닫히고 요약을 이어서 받음 · 알림', sent.length === 1 && (await page.locator('.settings').count()) === 0 && (await page.locator('.toast').innerText()).includes('이어서 할게요'));
await page.screenshot({ path: `${OUT}/ai-summary-04-resume.png` });
await page.locator('.ai-edit .x').click();
// 동의 창을 닫으면(취소) 기다리던 요약은 잊는다 — 나중에 동의해도 저절로 보내지 않음
await ws(() => window.__dn.withdrawConsent());
sent.length = 0;
await summarize();
await page.waitForSelector('.consent-dialog', { timeout: 5000 });
await page.locator('.consent-dialog .dialog-actions .btn:not(.primary)').first().click();
await ws(() => window.__dn.acceptConsent());
await wait(400);
check('동의 창을 취소하면 요약은 보내지 않음 · 요약하기로 다시', sent.length === 0 && (await page.locator('.ai-edit footer .btn.primary').innerText()) === '요약하기');
await page.locator('.ai-edit footer .btn.primary').click();
await page.waitForSelector('.ai-edit footer .btn.primary:has-text("노트 맨 위에 넣기")', { timeout: 15000 });
check('요약하기 → 요약 받음', sent.length === 1);

// 5) 다시 요약: 이전 'AI 요약'은 입력에서 빼고 새 요약으로 바꾼다 — 쌓이지 않게 · 실행 취소 한 번이면 이전 요약 (교차 검토 A12)
const summaries = () => ws(() => { const e = window.__dn.view.engine; return [...e.blocks()].filter((b) => b.ai && JSON.stringify(e.contentsOf(b.id)[0]?.doc ?? '').includes('AI 요약')).map((b) => b.id); });
await page.locator('.ai-edit footer .btn.primary').click();
await wait(300);
const first = await summaries();
sent.length = 0;
await summarize();
await page.waitForSelector('.ai-edit footer .btn.primary:has-text("노트 맨 위에 넣기")', { timeout: 15000 });
const again = sent[0]?.messages[0].content ?? '';
check('다시 요약: 입력에 이전 요약 없음 (원래 글은 있음)', first.length === 1 && !again.includes('AI 요약') && !again.includes('견적서 보내기 (금요일까지)') && again.includes('견적서를 보내기로'), again.slice(0, 200));
await page.locator('.ai-edit footer .btn.primary').click();
await wait(300);
const second = await summaries();
check('다시 요약 넣기 → 요약 상자는 하나 (새 것) · 알림 "바꿨어요"', second.length === 1 && second[0] !== first[0] && (await page.locator('.toast').innerText()).includes('새 요약으로 바꿨어요'), JSON.stringify({ first, second }));
await ws(() => window.__dn.view.undo());
await wait(200);
check('실행 취소 한 번 → 이전 요약이 돌아옴', JSON.stringify(await summaries()) === JSON.stringify(first));

check('콘솔 · 페이지 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close();
const fails = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fails}/${results.length} 통과`);
process.exit(fails ? 1 : 0);
