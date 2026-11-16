// 블록 댓글 (FR-132): Ctrl+Alt+M · 블록 메뉴로 블록에, 서식 막대 "댓글"로 고른 글에(글 속 표시) → 말풍선 개수 →
// 해결하면 표시가 사라지고 해결한 댓글은 숨김(펼쳐 보기) · 실행 취소 한 번 · 지우기 · 노트 패널 목록 · 새로 고침 뒤에도 · Markdown 내보내기에는 없음.
// 사용: dev 서버 실행 후 `node e2e/comments.mjs [폴더]`
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2] ?? '.';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
process.on('unhandledRejection', (e) => { if (!/TargetClosedError|has been closed/.test(String(e))) throw e; });

const browser = await chromium.launch({ channel: process.env.DN_CHANNEL ?? 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
await ctx.addInitScript(() => localStorage.setItem('dn:no-env-key', '1'));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });
const ws = (fn, arg) => page.evaluate(fn, arg);
await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(() => window.__dn.newNote());
await page.waitForTimeout(300);
await ws(() => window.__dn.setTitle('예산 회의'));
const noteId = await ws(() => window.__dn.state.currentId);
await ws(() => window.__dn.view.addBlockAtCenter('text'));
await page.keyboard.type('예산은 3천만 원으로 확정');
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
const bid = await ws(() => window.__dn.view.selectedBlocks[0]);
const comments = () => ws((id) => (window.__dn.view.engine.getBlock(id).comments ?? []).map((c) => ({ text: c.text, quote: c.quote, anchor: c.anchor, resolved: !!c.resolved })), bid);
const docText = () => ws((id) => JSON.stringify(window.__dn.view.engine.contentsOf(id)[0].doc), bid);
const badge = () => page.locator(`.dn-block[data-id="${bid}"] .dn-comment-badge span`).innerText().catch(() => '');

// 블록에 (Ctrl+Alt+M)
await ws(() => window.__dn.view.root.focus());
await page.keyboard.press('Control+Alt+KeyM');
await page.waitForSelector('.comment-thread');
await page.keyboard.type('날짜는 언제?');
await page.keyboard.press('Control+Enter');
await page.waitForTimeout(200);
check('Ctrl+Alt+M → 댓글 창 · 달기 · 말풍선 1', (await comments()).length === 1 && (await badge()) === '1', await badge());
await page.keyboard.press('Escape');

// 고른 글에 (서식 막대 "댓글")
await ws((id) => window.__dn.view.startEditing(id, 'end'), bid);
await page.waitForTimeout(150);
await page.evaluate(() => {
  const root = document.querySelector('.dn-text-editing');
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n; while ((n = walker.nextNode()) && !n.textContent.includes('3천만 원'));
  const i = n.textContent.indexOf('3천만 원');
  const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + '3천만 원'.length);
  const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  document.dispatchEvent(new Event('selectionchange'));
});
await page.waitForSelector('.dn-bubble:not([hidden]) .dn-bubble-comment', { timeout: 3000 }).catch(() => {});
await page.locator('.dn-bubble .dn-bubble-comment').click();
await page.waitForSelector('.comment-thread .cm-new blockquote');
check('서식 막대 "댓글" → 고른 글 인용 · 글 속 표시', (await page.locator('.comment-thread .cm-new blockquote').innerText()) === '3천만 원' && (await docText()).includes('"comment"'));
await page.locator('.comment-thread textarea').fill('출처 확인 필요');
await page.locator('.comment-thread .btn.primary').click();
await page.waitForTimeout(200);
const cs = await comments();
check('고른 글 댓글: 인용 · 표시 id 함께 · 말풍선 2', cs.length === 2 && cs[1].quote === '3천만 원' && !!cs[1].anchor && (await docText()).includes(cs[1].anchor) && (await badge()) === '2', JSON.stringify(cs));
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
check('편집을 끝내도 글 속 표시가 보인다', (await page.locator(`.dn-block[data-id="${bid}"] .dn-comment-mark`).innerText()) === '3천만 원');
await page.screenshot({ path: `${OUT}/comments.png` });

// 해결 → 표시 사라짐 · 숨김 · 실행 취소
await page.locator(`.dn-block[data-id="${bid}"] .dn-comment-badge`).click();
await page.waitForSelector('.comment-thread');
await page.locator('.comment-thread .cm-item', { hasText: '출처 확인 필요' }).locator('.cm-act', { hasText: '해결' }).click();
await page.waitForTimeout(200);
check('해결 → 글 속 표시 지움 · 말풍선 1 · 해결한 댓글은 접힘', (await comments())[1].resolved && !(await docText()).includes('"comment"') && (await badge()) === '1'
  && (await page.locator('.comment-thread .cm-toggle').innerText()).includes('해결한 댓글 1개'));
await page.keyboard.press('Escape');
await ws(() => window.__dn.view.root.focus());
await page.keyboard.press('Control+z');
await page.waitForTimeout(200);
check('해결도 실행 취소 한 번 (표시 · 댓글 함께)', !(await comments())[1].resolved && (await docText()).includes('"comment"') && (await badge()) === '2');

// 노트 패널 · 지우기
await ws(() => window.__dn.togglePanel(true));
await page.waitForSelector('.panel-comment');
check('노트 패널에 열린 댓글 목록', (await page.locator('.panel-comment').count()) === 2);
await page.locator('.panel-comment', { hasText: '날짜는 언제?' }).click();
await page.waitForSelector('.comment-thread', { timeout: 3000 });
await page.locator('.comment-thread .cm-item', { hasText: '날짜는 언제?' }).locator('.cm-act', { hasText: '지우기' }).click();
await page.waitForTimeout(200);
check('패널에서 열어 지우기', (await comments()).length === 1 && (await badge()) === '1');
await page.keyboard.press('Escape');

// 블록 메뉴에도
await page.locator(`.dn-block[data-id="${bid}"]`).click({ button: 'right' });
await page.waitForSelector('.menu[aria-label="블록 메뉴"]');
check('블록 메뉴 "댓글 달기"', (await page.locator('.menu[aria-label="블록 메뉴"]').innerText()).includes('댓글 달기'));
await page.keyboard.press('Escape');

// Markdown 내보내기에는 댓글 없음 · 새로 고침 뒤에도
await page.waitForTimeout(900);
const dl = page.waitForEvent('download');
await ws((id) => window.__dn.exportNote(id), noteId);
const file = join(OUT, 'comments.md');
await (await dl).saveAs(file);
const md = readFileSync(file, 'utf8');
check('Markdown 내보내기: 본문은 있고 댓글은 없음', md.includes('예산은 3천만 원으로 확정') && !md.includes('출처 확인 필요') && !md.includes('comment'));
await page.reload();
await page.waitForSelector('.canvas-host', { timeout: 15000 });
await ws((id) => window.__dn.openById(id), noteId);
await page.waitForTimeout(800);
check('새로 고침 뒤에도 댓글 · 표시 · 말풍선', (await comments()).length === 1 && (await badge()) === '1' && (await page.locator('.dn-comment-mark').count()) === 1);

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
