// 할 일 모아보기 확인 (FR-137): 여러 노트의 할 일 · 기한 묶음 · 여기서 체크 → 원래 노트 반영 · 누르면 이동.
// 사용: dev 서버 실행 후 `node e2e/todos.mjs [스크린샷 폴더]`
import { chromium } from 'playwright-core';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2] ?? '.';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

const browser = await chromium.launch({ channel: process.env.DN_CHANNEL ?? 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => localStorage.setItem('dn:no-env-key', '1'));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });
const ws = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await wait(400);

async function noteWith(title, lines) {
  await ws(() => window.__dn.newNote());
  await wait(300);
  await ws((t) => window.__dn.setTitle(t), title);
  await ws(() => window.__dn.view.addBlockAtCenter());
  await wait(100);
  await page.keyboard.type('[] ');
  for (const [i, l] of lines.entries()) { if (i) await page.keyboard.press('Enter'); await page.keyboard.type(l); }
  await page.keyboard.press('Escape');
  await wait(500);
  return ws(() => window.__dn.state.currentId);
}
const workId = await noteWith('업무', ['보고서 오늘 제출', '예전 일 2020-01-01', '날짜 없는 일']);
const homeId = await noteWith('집', ['장보기 내일']);

// ───── 페이지 열기 ─────
await page.locator('.side-nav .note-item', { hasText: '할 일' }).click();
await page.waitForSelector('.todo-group');
const groups = await page.locator('.todo-group h2').allInnerTexts();
check('기한 묶음 순서: 지남 · 오늘 · (이번 주/나중) · 날짜 없음', groups[0].startsWith('기한 지남') && groups[1].startsWith('오늘') && groups[groups.length - 1].startsWith('날짜 없음'), groups.join(' | '));
const rows = await page.locator('.todo-row .todo-text span').allInnerTexts();
check('모든 노트의 할 일 4개', rows.length === 4, rows.join(' | '));
check('요약: 남은 일 · 노트 수', (await page.locator('.todo-sum').innerText()).includes('남은 일 4개 · 노트 2개'));
await page.screenshot({ path: `${OUT}/todos.png` });

// ───── 열려 있지 않은 노트의 할 일 체크 → 원래 노트에 반영 ─────
const row = page.locator('.todo-row', { hasText: '보고서 오늘 제출' });
await row.locator('input').click();
await wait(400);
check('체크한 항목은 목록에서 바로 줄 그음', await row.evaluate((el) => el.classList.contains('done')));
const workDoc = await ws(async (id) => {
  await window.__dn.openById(id);
  return JSON.stringify([...window.__dn.view.engine.contents()].map((c) => c.doc));
}, workId);
check('닫혀 있던 노트에도 체크가 저장됨', /"checked":true[^}]*}[^\]]*"보고서 오늘 제출"/.test(workDoc) || workDoc.includes('{"checked":true},"content":[{"type":"paragraph","content":[{"type":"text","text":"보고서 오늘 제출"'), workDoc.slice(0, 200));

// ───── 열린 노트의 할 일 체크 (실행 취소도 그 노트에서) ─────
await ws(() => window.__dn.showTodos());
await page.waitForSelector('.todo-group');
await wait(300);
await page.locator('.todo-row', { hasText: '날짜 없는 일' }).locator('input').click();
await wait(300);
await ws(() => window.__dn.openById(window.__dn.state.currentId));
const undoable = await ws(() => window.__dn.view.engine.canUndo());
check('열린 노트에서 체크하면 그 노트의 실행 취소로 되돌릴 수 있음', undoable === true);

// ───── 끝난 일 숨기기/보기 · 누르면 이동 ─────
await ws(() => window.__dn.showTodos());
await page.waitForSelector('.todo-group');
await wait(300);
check('끝난 일은 기본으로 숨김', (await page.locator('.todo-row').count()) === 2);
await page.locator('.todo-done input').check();
check('끝난 일도 보기', (await page.locator('.todo-row').count()) === 4);
await page.locator('.todo-row', { hasText: '장보기 내일' }).locator('.todo-text').click();
await wait(400);
check('항목을 누르면 그 노트로', (await ws(() => window.__dn.state.currentId)) === homeId && (await ws(() => window.__dn.state.page)) === 'note');

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
