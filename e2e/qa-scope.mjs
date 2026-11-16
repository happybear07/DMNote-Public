// 노트에 묻기 범위 좁히기 (2026-10-26): 글 속 #태그 → 노트 태그, 소제목으로 역할 추정 · 직접 정한 역할, 전체 노트 질문은
// 역할 · 태그 → 요약 카드 순으로 좁혀 그 노트의 근거만 보냄(가짜 Claude), 범위 표시, 어디에도 안 걸리면 부르지 않음, #낱말을 지우면 태그도 뗌.
// 사용: dev 서버 실행 후 `node e2e/qa-scope.mjs [스크린샷 폴더]`
import { chromium } from 'playwright-core';
import { fsPath } from './lib/fs-path.mjs';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2] ?? '.';
const CORE = fsPath('packages/engine-core/src/index.ts');
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const sse = (events) => events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');
const stream = (text, cite) => sse([
  ['message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 800, output_tokens: 1 } } }],
  ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '', citations: [] } }],
  ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'citations_delta', citation: { type: 'char_location', cited_text: cite, document_index: 0, document_title: '', start_char_index: 0, end_char_index: cite.length } } }],
  ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }],
  ['content_block_stop', { type: 'content_block_stop', index: 0 }],
  ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 30 } }],
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
  const body = req.postDataJSON();
  sent.push(body);
  const doc = body.messages.at(-1).content.find((c) => c.type === 'document');
  return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: stream('찾았어요.', (doc?.source?.data ?? '근거').slice(0, 20)) });
});
const ws = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });

/** 노트 하나: 제목 · 제목 상자(소제목) · 내용 상자 */
const mkNote = async (title, heads, bodies) => {
  await ws(() => window.__dn.newNote({ sheet: null }));
  await wait(300);
  await ws((t) => window.__dn.setTitle(t), title);
  await ws(([heads, bodies]) => window.__dn.view.engine.transact((tx) => {
    const p = (t) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });
    heads.forEach((h, i) => { const b = tx.createBlock({ x: 0, y: i * 90, w: 300, h: 50 }); tx.createContent({ blockId: b, type: 'text', role: 'title', doc: p(h) }); });
    bodies.forEach((t, i) => { const b = tx.createBlock({ x: 400, y: i * 120, w: 360, h: 60 }); tx.createContent({ blockId: b, type: 'text', role: 'body', doc: p(t) }); });
  }, { origin: 'user' }), [heads, bodies]);
  await wait(1200); // 저장 · 색인 · 메타
  return ws(() => window.__dn.state.currentId);
};
const metaOf = (id) => ws((id) => { const n = window.__dn.state.notes.find((x) => x.id === id); return { role: n?.role ?? null, roleGuess: n?.roleGuess ?? null, tags: (n?.tagIds ?? []).map((t) => window.__dn.state.tags.find((x) => x.id === t)?.name) }; }, id);

const meeting = await mkNote('10월 3주 회의', ['안건', '논의', '결정 사항'], ['#결제 연동은 금요일까지 끝내기로 함']);
const lecture = await mkNote('경제 수업 정리', [], ['결제 수단의 역사와 연동 방식']);
await ws(async (CORE) => { const core = await import(CORE); core.setNoteRole(window.__dn.view.engine, 'lecture'); }, CORE);
await wait(1200);
const trip = await mkNote('제주 여행', ['숙소', '예산'], ['숙소는 애월, 렌터카 예약 완료']);

let m = await metaOf(meeting);
check('글 속 #결제 → 노트 태그 "결제" (태그 목록에도)', m.tags.includes('결제') && (await ws(() => window.__dn.state.tags.some((t) => t.name === '결제'))), JSON.stringify(m));
check('소제목 안건 · 논의 · 결정 사항 → 역할 추정 회의록', m.roleGuess === 'meeting' && m.role === null, JSON.stringify(m));
const l = await metaOf(lecture);
check('직접 정한 역할(강의 필기)은 메타에 그대로, 추정은 없음', l.role === 'lecture' && l.roleGuess === null, JSON.stringify(l));

// 노트에 묻기: 전체 노트
await ws(async () => { await window.__dn.acceptConsent(); await window.__dn.saveKey('sk-ant-test-key-abcd'); });
await page.locator('.sidebar button', { hasText: '노트에 묻기' }).click();
await page.waitForSelector('.qa-panel');
check('범위 고르기에 역할(회의록 · 강의 필기 …)', (await page.locator('.qa-scope optgroup[label="역할"] option').allInnerTexts()).join() === '회의록,강의 필기,리서치,주간 계획');
await page.locator('.qa-scope select').selectOption('all');
const ask = async (q) => { const n = sent.length; await page.locator('.qa-input textarea').fill(q); await page.keyboard.press('Enter'); await page.waitForFunction(() => !document.querySelector('.qa-wait'), null, { timeout: 15000 }); await wait(300); return sent.length > n ? sent.at(-1) : null; };
const docTitles = (req) => (req?.messages.at(-1).content ?? []).filter((c) => c.type === 'document').map((c) => c.title);

let req = await ask('지난 회의에서 결제 연동 일정 어떻게 됐어?');
let used = await page.locator('.qa-used').last().innerText().catch(() => '');
check('회의 + 결제 → 회의록 · #결제 노트만 근거로 보냄 (강의 노트의 "결제 연동"은 안 보냄)', JSON.stringify(docTitles(req)) === JSON.stringify(['10월 3주 회의']), JSON.stringify(docTitles(req)));
check('답 위에 쓴 범위 표시', used.includes('회의록 노트 · #결제 1개'), used);
await page.screenshot({ path: `${OUT}/qa-scope.png` });

req = await ask('숙소 어디로 했지?');
used = await page.locator('.qa-used').last().innerText().catch(() => '');
check('역할 · 태그가 안 걸리면 요약 카드(소제목 "숙소")로 고른 노트에서', docTitles(req).every((t) => t === '제주 여행') && docTitles(req).length > 0 && used.includes('요약 카드로 고른 노트 1개'), `${JSON.stringify(docTitles(req))} ${used}`);

req = await ask('우주 망원경 관측 결과는?');
used = await page.locator('.qa-used').last().innerText().catch(() => '');
check('어디에도 안 걸리면 Claude를 부르지 않음 · 범위에 "없음"', req === null && used.includes('없음') && (await page.locator('.qa-turn').last().innerText()).includes('찾지 못했'), used);

// #결제를 지우면 그 태그도 뗀다
await page.locator('.qa-panel .x').click();
await ws((id) => window.__dn.openById(id), meeting);
await wait(400);
await ws(() => { const e = window.__dn.view.engine; const c = [...e.contents()].find((x) => x.type === 'text' && JSON.stringify(x.doc).includes('#결제')); e.transact((tx) => tx.set('content', c.id, { doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '결제 연동은 금요일까지 끝내기로 함' }] }] } }), { origin: 'user' }); });
await wait(1500);
m = await metaOf(meeting);
check('글에서 #결제를 지우면 #으로 붙었던 태그도 뗌', !m.tags.includes('결제'), JSON.stringify(m));

// ── 화면: 노트 정보 패널의 역할 · 요약 카드, 역할 만들기, 템플릿 역할, 검색 #태그 · 역할 필터, 태그 추천 ──
await ws(() => window.__dn.togglePanel(true));
await page.waitForSelector('.panel-role select');
check('패널 역할: 직접 정한 게 없으면 "자동 (추정: 회의록)"', (await page.locator('.panel-role select option').first().innerText()) === '자동 (추정: 회의록)');
check('패널 요약 카드 md (제목 · 역할(추정) · 소제목 · 키워드)', /# 10월 3주 회의\n- 역할: 회의록 \(추정\)\n- 소제목: [^\n]*안건[^\n]*\n- 키워드: /.test(await page.locator('.panel-digest').innerText()), await page.locator('.panel-digest').innerText());
await page.locator('.panel-role select').selectOption('+');
await page.locator('.role-form input[aria-label="역할 이름"]').fill('거래처 미팅');
await page.locator('.role-form input[aria-label="이 역할을 가리키는 낱말"]').fill('거래처, 견적');
await page.locator('.role-form button[type="submit"]').click();
await wait(1500);
const custom = await ws(() => window.__dn.state.noteRoles);
m = await metaOf(meeting);
check('역할 만들기 → 설정에 저장 · 이 노트 역할이 됨 (추정은 지움)', custom.length === 1 && custom[0].name === '거래처 미팅' && JSON.stringify(custom[0].keywords) === '["거래처","견적"]' && m.role === custom[0].id && m.roleGuess === null, JSON.stringify({ custom, m }));
check('패널: 만든 역할이면 "지우기" 단추', await page.locator('.panel-role .link-btn', { hasText: "'거래처 미팅' 역할 지우기" }).isVisible());
await page.screenshot({ path: `${OUT}/qa-scope-panel.png` });

const tplRole = await ws(async (path) => { const t = await import(path); await window.__dn.newFromTemplate(t.BUILTIN_TEMPLATES.find((x) => x.id === 'meeting')); return window.__dn.view.engine.note.role; }, fsPath('apps/web/src/templates.ts'));
check('회의록 템플릿으로 만든 노트는 처음부터 역할 회의록', tplRole === 'meeting', String(tplRole));

await ws(() => window.__dn.openOverlay('search'));
await page.waitForSelector('.search-filters select[aria-label="역할"]');
await ws((id) => window.__dn.addTag(id, '결제'), lecture);
await wait(300);
await page.locator('.search-box input, .search-overlay input').first().fill('#결제 연동');
await wait(400);
const hitNotes = await ws(() => window.__dn.search('#결제 연동').map((h) => h.noteId));
check('검색어 속 #결제 → 결제 태그 노트에서만 "연동"을 찾음', JSON.stringify(hitNotes) === JSON.stringify([lecture]), JSON.stringify(hitNotes));
const byRole = await ws((id) => window.__dn.search('', { roleId: id }).map((h) => h.noteId), 'lecture');
check('검색 역할 필터 → 그 역할 노트만', JSON.stringify(byRole) === JSON.stringify([lecture]), JSON.stringify(byRole));
await page.keyboard.press('Escape');

await ws((id) => window.__dn.openById(id), trip);
await wait(400);
await page.locator('.tag-add-btn').click();
await wait(200);
const recs = await page.locator('.tag-suggest [role="option"]').allInnerTexts();
check('태그 추가: 이 노트에 자주 나온 낱말을 "추천 #…"으로', recs.some((t) => t.startsWith('추천 #')), JSON.stringify(recs));
await page.keyboard.press('Escape');

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
