// 이어 쓰기 · 초안 (FR-113) · 번역 (FR-114) — Anthropic API는 가짜로 가로챈다(실제 호출 · 비용 없음).
// 작성 도우미의 '이어 쓰기' → 이어서 넣기(문장 가운데면 그 문단에), '번역' 언어 → 바꾸기, 빈 상자 Ctrl+J → 초안 → 그 상자에,
// ⋯ 'AI로 초안 쓰기' → 노트 맨 끝 새 상자, ⋯ 'AI로 노트 번역' → 조각 표지로 보내고 → 새 노트(상자 자리 · 화살표 그대로, 원본은 그대로).
// 사용: dev 서버 실행 후 `node e2e/ai-write.mjs [스크린샷 폴더]` (DN_URL로 주소 변경)
import { chromium } from 'playwright-core';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2] ?? '.';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const sse = (events) => events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');
const textStream = (text) => {
  const n = Math.ceil(text.length / 3), parts = [text.slice(0, n), text.slice(n, 2 * n), text.slice(2 * n)].filter(Boolean);
  return sse([
    ['message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 420, output_tokens: 1 } } }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ...parts.map((p) => ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: p } }]),
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 40 } }],
    ['message_stop', { type: 'message_stop' }],
  ]);
};

const browser = await chromium.launch({ channel: process.env.DN_CHANNEL ?? 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => localStorage.setItem('dn:no-env-key', '1'));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push(m.text()); });
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
let reply = '';
const sent = [];
await page.route('https://api.anthropic.com/**', async (route) => {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  if (req.url().includes('/v1/models/')) return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'model', id: 'claude-sonnet-5-5' }) });
  sent.push(req.postDataJSON());
  return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: textStream(reply) });
});
const ws = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
const last = () => (sent.at(-1)?.messages[0].content) ?? '';
const done = () => page.waitForSelector('.ai-edit footer .btn.primary', { timeout: 15000 });
await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(async () => { await window.__dn.newNote({ sheet: null }); await window.__dn.acceptConsent(); await window.__dn.saveKey('sk-ant-test-write-0000'); window.__dn.closeDialog(); });
await wait(300);

const plain = (id) => ws((id) => { const d = window.__dn.view.engine.contentsOf(id).find((c) => c.doc).doc; return d.content.map((p) => (p.content ?? []).map((t) => t.text ?? '').join('')).join('\n'); }, id);
const typeBox = async (t) => { await ws(() => window.__dn.view.addBlockAtCenter('text')); if (t) await page.keyboard.type(t); await page.keyboard.press('Escape'); await wait(200); return ws(() => window.__dn.view.selectedBlocks[0]); };
const ctrlJ = async (id) => { await ws((id) => window.__dn.view.startEditing(id, 'end'), id); await wait(150); await page.keyboard.press('Control+j'); await page.waitForSelector('.ai-edit', { timeout: 3000 }); };

// 1) 이어 쓰기: 문장 가운데서 끝난 글 → 이어서 넣기 = 그 문단에 띄어 이어 붙임 → 실행 취소 한 번
const START = '이번 분기 목표는 결제 화면을 다시 만드는 것이고, 우리는';
const a = await typeBox(START);
await ctrlJ(a);
const chips = await page.locator('.ai-edit-row[aria-label="할 일"] .ai-edit-chip').allInnerTexts();
check('할 일에 이어 쓰기 · 번역 줄(한국어 글이면 English 먼저, 한국어 없음)', chips.includes('이어 쓰기') && (await page.locator('.ai-edit-row[aria-label="번역"] .ai-edit-chip').allInnerTexts()).join(',') === 'English,日本語,中文,Español,Français', chips.join(','));
reply = '다음 달 말까지 [날짜] 시안을 마무리하기로 했다.';
await page.locator('.ai-edit-chip', { hasText: '이어 쓰기' }).click();
await done();
check('요청: action continue · 고른 글 = 상자 전체', /action: continue\nlocale: ko/.test(last()) && last().includes(`>\n${START}\n</dn_selection_`) && sent.at(-1).max_tokens === 2048);
check('미리보기: 주 단추 "이어서 넣기" · [ ] 자리 안내', (await page.locator('.ai-edit footer .btn.primary').innerText()) === '이어서 넣기' && (await page.locator('.ai-edit-hint').allInnerTexts()).some((t) => t.includes('직접 채울 자리')));
await page.screenshot({ path: `${OUT}/ai-write-01-continue.png` });
await page.locator('.ai-edit footer .btn.primary').click();
await wait(250);
check('이어서 넣기: 같은 문단에 띄어 이어 붙음', (await plain(a)) === `${START} ${reply}`, await plain(a));
await page.keyboard.press('Escape');
await ws(() => window.__dn.view.undo());
await wait(200);
check('실행 취소 한 번 → 원문 그대로', (await plain(a)) === START);

// 2) 번역: 상자 전체 → English → 바꾸기
await ctrlJ(a);
reply = 'Our goal this quarter is to rebuild the checkout screen, and we';
await page.locator('.ai-edit-row[aria-label="번역"] .ai-edit-chip', { hasText: 'English' }).click();
await done();
check('번역 요청: target en (English) · 길이 16,384', last().includes('action: translate\ntarget: en (English)\nlocale: ko') && sent.at(-1).max_tokens === 16_384);
await page.locator('.ai-edit footer .btn.primary').click();
await wait(250);
check('번역 바꾸기 → 알림 "번역한 글로"', (await plain(a)) === reply && (await page.locator('.toast').innerText()).includes('번역한 글로'), await plain(a));
await page.keyboard.press('Escape');
await ws(() => window.__dn.view.undo());
await wait(200);

// 3) 빈 상자에서 Ctrl+J → 초안 → 그 상자에
const empty = await typeBox('');
await ctrlJ(empty);
check('빈 상자 Ctrl+J → 초안 창 (주제 입력)', (await page.locator('.ai-edit').getAttribute('aria-label')) === 'AI로 초안 쓰기' && (await page.locator('.ai-edit-brief textarea').count()) === 1);
reply = '## 첫 주 안내\n\n- 첫날: 노트북 받기\n- 둘째 날: [담당자 이름]과 점심';
await page.locator('.ai-edit-brief textarea').fill('신입 사원 첫 주 안내, 목록으로');
await page.keyboard.press('Enter');
await done();
check('초안 요청: action draft · 주제가 선택 자리에', /action: draft\nlocale: ko/.test(last()) && last().includes('>\n신입 사원 첫 주 안내, 목록으로\n</dn_selection_'));
check('초안 미리보기 · 주 단추 "이 상자에 넣기"', (await page.locator('.ai-edit-out').innerText()).includes('첫날: 노트북 받기') && (await page.locator('.ai-edit footer .btn.primary').innerText()) === '이 상자에 넣기');
await page.screenshot({ path: `${OUT}/ai-write-02-draft.png` });
await page.locator('.ai-edit footer .btn.primary').click();
await wait(250);
check('초안 → 빈 상자가 채워짐 (제목 · 목록)', (await plain(empty)).startsWith('첫 주 안내') && (await ws((id) => window.__dn.view.engine.contentsOf(id)[0].doc.content.map((n) => n.type).join(','), empty)) === 'heading,bullet_list');
await page.keyboard.press('Escape');

// 4) ⋯ 'AI로 초안 쓰기' → 노트 맨 끝 새 상자 (AI 표시) → 실행 취소 한 번
const before = await ws(() => window.__dn.view.engine.blockCount);
await page.locator('.top-more .more-btn').click();
await page.locator('.top-more-menu .draft-btn').click();
await page.waitForSelector('.ai-edit-brief textarea');
reply = '팀 회고 초안입니다. [날짜]에 모여 잘된 점과 바꿀 점을 나눕니다.';
await page.locator('.ai-edit-brief textarea').fill('팀 회고 공지');
await page.locator('.ai-edit-brief button[type="submit"]').click();
await done();
check('⋯ 초안: 주 단추 "노트 맨 끝에 넣기"', (await page.locator('.ai-edit footer .btn.primary').innerText()) === '노트 맨 끝에 넣기');
await page.locator('.ai-edit footer .btn.primary').click();
await wait(300);
const endInfo = await ws(() => { const e = window.__dn.view.engine, bs = [...e.blocks()], nb = bs.at(-1); return { n: e.blockCount, ai: nb.ai?.promptVersion, lowest: bs.every((b) => b === nb || b.y + b.h <= nb.y) }; });
check('노트 맨 끝 새 상자 · AI 출처 표시 · 다른 상자 아래', endInfo.n === before + 1 && endInfo.ai === 'edit.v1' && endInfo.lowest, JSON.stringify(endInfo));
await ws(() => window.__dn.view.undo());
await wait(200);
check('실행 취소 한 번 → 새 상자 없어짐', (await ws(() => window.__dn.view.engine.blockCount)) === before);

// 5) 노트 번역 → 새 노트 (상자 자리 · 화살표 그대로, 원본은 그대로)
await ws(async () => {
  await window.__dn.newNote({ sheet: null });
  window.__dn.setTitle('결제 회의');
  const e = window.__dn.view.engine;
  const mk = (x, y, t) => e.transact((tx) => { const b = tx.createBlock({ x, y, w: 260, h: 60 }); tx.createContent({ blockId: b, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] } }); return b; }, { origin: 'user' }).value;
  const p = mk(0, 0, '결제 화면을 새로 만든다'), q = mk(420, 0, '카드 등록을 줄인다');
  e.transact((tx) => tx.createArrow({ from: { blockId: p, side: 'auto' }, to: { blockId: q, side: 'auto' }, label: '그래서' }), { origin: 'user' });
});
await wait(600);
const srcId = await ws(() => window.__dn.state.currentId);
const sentBefore = sent.length;
const srcBlocks = await ws(() => [...window.__dn.view.engine.blocks()].map((b) => `${b.x},${b.y}`).sort().join('|'));
await page.locator('.top-more .more-btn').click();
await page.locator('.top-more-menu .translate-btn').click();
await page.waitForSelector('.ai-edit[aria-label="AI로 노트 번역"]');
check('노트 번역 창: 바로 보내지 않음 · 언어 단추', sent.length === sentBefore && (await page.locator('.ai-edit-row[aria-label="번역"] .ai-edit-chip').first().innerText()) === 'English', String(sent.length));
// 넷째 조각(화살표 이름)은 빠뜨린 답 — 원문 그대로 남아야 한다
reply = '<<<SEG 1>>>\nPayment meeting\n\n<<<SEG 2>>>\nRebuild the checkout screen\n\n<<<SEG 3>>>\nReduce card sign-up';
await page.locator('.ai-edit-row[aria-label="번역"] .ai-edit-chip', { hasText: 'English' }).click();
await done();
const req = last();
check('요청: 조각 표지 4개(제목 · 상자 둘 · 화살표 이름) · target en', ['<<<SEG 1>>>\n결제 회의', '<<<SEG 2>>>\n결제 화면을 새로 만든다', '<<<SEG 3>>>\n카드 등록을 줄인다', '<<<SEG 4>>>\n그래서'].every((s) => req.includes(s)) && req.includes('target: en (English)'), req.slice(0, 200));
check('미리보기에 표지 줄 없음', !(await page.locator('.ai-edit-out').innerText()).includes('<<<SEG') && (await page.locator('.ai-edit footer .btn.primary').innerText()) === '새 노트로 만들기');
await page.screenshot({ path: `${OUT}/ai-write-03-note.png` });
await page.locator('.ai-edit footer .btn.primary').click();
await page.waitForFunction((src) => window.__dn.state.currentId && window.__dn.state.currentId !== src, srcId, { timeout: 5000 });
await wait(400);
const copy = await ws(() => { const e = window.__dn.view.engine; return { title: e.note.title, texts: [...e.contents()].filter((c) => c.doc).map((c) => c.doc.content[0].content[0].text).sort().join('|'), pos: [...e.blocks()].map((b) => `${b.x},${b.y}`).sort().join('|'), label: [...e.arrows()][0]?.label, ai: [...e.contents()].every((c) => c.ai?.promptVersion === 'edit.v1') }; });
check('새 노트: 번역한 제목 · 상자 글 · AI 표시', copy.title === 'Payment meeting' && copy.texts === 'Rebuild the checkout screen|Reduce card sign-up' && copy.ai, JSON.stringify(copy));
check('새 노트: 상자 자리 그대로 · 받지 못한 화살표 이름은 원문 · 알림에 알림', copy.pos === srcBlocks && copy.label === '그래서' && (await page.locator('.toast').innerText()).includes('1개 조각은 원문 그대로'), `${copy.pos} / ${copy.label}`);
const border = await ws(() => { const v = window.__dn.view; return [...v.engine.blocks()].map((b) => !!b.ai && !!v.mounted.get(b.id)?.el.classList.contains('dn-ai')); });
check('새 노트: 번역한 상자는 블록에도 AI 출처 · AI 테두리 (교차 검토 N2)', border.length === 2 && border.every(Boolean), JSON.stringify(border));
const orig = await ws((id) => window.__dn.readNoteTitle?.(id) ?? window.__dn.state.notes.find((n) => n.id === id)?.title, srcId);
check('원본 노트는 그대로', orig === '결제 회의', String(orig));

check('콘솔 · 페이지 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close();
const fails = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fails}/${results.length} 통과`);
process.exit(fails ? 1 : 0);
