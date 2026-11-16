// 내 노트에 질문하기 (FR-116~119): 사이드바 "노트에 묻기" → 범위(전체) → 질문 → 근거 조각이 document로(가짜 Claude) → 답 · 인용 번호 ·
// 출처 누르면 그 노트 · 블록으로 · 다음 질문에 이력 · 새 노트로 저장(출처 노트 링크) · 근거 없으면 부르지 않음 · 인용 없는 답은 접힘 · 잠긴 노트 제외.
// 사용: dev 서버 실행 후 `node e2e/qa.mjs [스크린샷 폴더]`
import { chromium } from 'playwright-core';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2] ?? '.';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const sse = (events) => events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');
/** 답 글 + (있으면) 첫 문서 인용 */
const stream = (text, cite) => sse([
  ['message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 800, output_tokens: 1 } } }],
  ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '', citations: [] } }],
  ...(cite ? [['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'citations_delta', citation: { type: 'char_location', cited_text: cite, document_index: 0, document_title: '회의록', start_char_index: 0, end_char_index: cite.length } } }]] : []),
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
let reply = { text: '예산은 300만 원입니다.', cite: '예산은 300만 원으로 정했다.' };
const sent = [];
await page.route('https://api.anthropic.com/**', async (route) => {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  if (req.url().includes('/v1/models/')) return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'model', id: 'claude-sonnet-5-5' }) });
  sent.push(req.postDataJSON());
  return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: stream(reply.text, reply.cite) });
});
const ws = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
// 근거가 될 노트
await ws(() => window.__dn.newNote());
await wait(300);
await ws(() => window.__dn.setTitle('회의록'));
const blockId = await ws(() => window.__dn.view.engine.transact((tx) => { const b = tx.createBlock({ x: 0, y: 0, w: 300, h: 60 }); tx.createContent({ blockId: b, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '예산은 300만 원으로 정했다.' }] }] } }); return b; }, { origin: 'user' }).value);
const noteId = await ws(() => window.__dn.state.currentId);
await wait(1500); // 저장 · 색인
await ws(() => window.__dn.newNote()); // 다른 노트에서 묻는다
await wait(300);
await ws(() => window.__dn.acceptConsent());
await ws(() => window.__dn.saveKey('sk-ant-test-key-abcd'));

await page.locator('.sidebar button', { hasText: '노트에 묻기' }).click();
await page.waitForSelector('.qa-panel');
await page.locator('.qa-scope select').selectOption('all');
await page.locator('.qa-input textarea').fill('회의에서 정한 예산은?');
await page.keyboard.press('Enter');
await page.waitForSelector('.qa-answer', { timeout: 15000 });
const req = sent[0];
const last = req?.messages?.at(-1)?.content ?? [];
check('보낸 요청: 근거 블록이 document(제목 · ref · 인용 켬)로 · 질문은 nonce 태그 안', last[0]?.type === 'document' && last[0]?.source?.data?.includes('300만 원') && last[0]?.title === '회의록' && last[0]?.context?.includes(`${noteId}#${blockId}`) && last.at(-1)?.text?.includes('회의에서 정한 예산은?'), JSON.stringify(last).slice(0, 200));
check('답 · 인용 번호 · 출처 목록', (await page.locator('.qa-text').first().innerText()).includes('300만 원입니다') && (await page.locator('.qa-cite').count()) === 1 && (await page.locator('.qa-sources li').innerText()).includes('회의록'));
await page.screenshot({ path: `${OUT}/qa-answer.png` });
await page.locator('.qa-cite').first().click();
await wait(600);
check('인용을 누르면 그 노트 · 블록으로', (await ws(() => window.__dn.state.currentId)) === noteId && (await ws(() => window.__dn.view.selectedBlocks.join())) === blockId);

// 이력 · 근거 없음 · 인용 없는 답
reply = { text: '아마 다음 달일 거예요.', cite: null };
await page.locator('.qa-input textarea').fill('예산 회의 다음 일정은?');
await page.keyboard.press('Enter');
await page.waitForSelector('.qa-ungrounded', { timeout: 15000 });
check('다음 질문에 앞 대화(이력)를 함께 보냄', sent.at(-1).messages.length === 3 && sent.at(-1).messages[0].content === '회의에서 정한 예산은?');
check('인용 없는 답 → "근거를 찾지 못한 답변"으로 접힘 · 저장 단추 없음', (await page.locator('.qa-turn').last().locator('.qa-actions').count()) === 0);
const n = sent.length;
await page.locator('.qa-input textarea').fill('우주선 연료');
await page.keyboard.press('Enter');
await wait(500);
check('근거가 없으면 Claude를 부르지 않고 "노트에서 답을 찾지 못했습니다."', sent.length === n && (await page.locator('.qa-turn').last().innerText()).includes('노트에서 답을 찾지 못했습니다'));

// 새 노트로 저장 (출처 노트 링크)
const notes0 = await ws(() => window.__dn.state.notes.length);
await page.locator('.qa-turn').first().locator('.qa-actions button', { hasText: '새 노트로 저장' }).click();
await wait(2500); // 노트 목록 정보는 잠시 뒤에 맞춰진다
const saved = await ws(() => JSON.stringify([...window.__dn.view.engine.contents()].map((c) => c.doc)));
const notes1 = await ws(() => window.__dn.state.notes.length);
check('새 노트로 저장: 질문 · 답 · 출처(노트 링크)', (await ws(() => window.__dn.state.notes.some((n) => n.title === '회의에서 정한 예산은?'))) && notes1 >= notes0 && saved.includes('300만 원입니다') && saved.includes('note_link') && saved.includes(noteId), JSON.stringify({ notes0, notes1, a: saved.includes('300만 원입니다'), l: saved.includes('note_link'), id: saved.includes(noteId) }));

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
