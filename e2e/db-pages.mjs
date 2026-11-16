// 데이터베이스 항목 페이지 확인 (FR-063): 항목 "열기" → 하위 노트(제목 = 항목 이름) · 머리에 데이터베이스 · 속성 · 돌아가기 ·
// 다시 열면 같은 노트 · 본문에 일반 블록 · 항목 템플릿 · 새로 고침 유지.
// 사용: dev 서버 실행 후 `node e2e/db-pages.mjs [스크린샷 폴더]`
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
const db = () => ws(() => { const v = window.__dn.view; for (const b of v.engine.blocks()) for (const c of v.engine.contentsOf(b.id)) if (c.type === 'database') return JSON.parse(JSON.stringify(c)); return null; });
const cur = () => ws(() => window.__dn.state.currentId);

await ws(() => { const v = window.__dn.view; v.setCamera({ ...v.cam, x: v.cam.x + 3000 }); });
await wait(100);
await page.evaluate(() => window.__dn.view.setTool('block')); await page.mouse.click(600, 250);
await wait(300);
await page.keyboard.type('항목 페이지 시험');
await page.keyboard.press('Enter');
await page.keyboard.type('/데이터');
await wait(250);
await page.keyboard.press('Enter');
await page.waitForSelector('.dn-db');
await page.locator('.dn-db-title').fill('프로젝트');
await page.locator('.dn-db-title').press('Enter');
let d = await db();
const [NAME, STATUS] = d.properties.map((p) => p.id);
let rows = [...d.rows].sort((a, b) => (a.order < b.order ? -1 : 1));
const cell = (r, p) => page.locator(`.dn-db [data-key="${r}:${p}"]`);
await cell(rows[0].id, NAME).fill('회의록');
await cell(rows[0].id, NAME).press('Enter');
await cell(rows[0].id, STATUS).click();
await page.locator('.dn-db-pop .dn-db-mi', { hasText: '진행 중' }).click();
await wait(100);
const home = await cur();

// ───── 열기 → 새 하위 노트 ─────
const nameCell = page.locator(`.dn-db tr[data-row="${rows[0].id}"] .dn-db-namecell`);
await nameCell.hover();
await nameCell.locator('.dn-db-open-page').click();
await page.waitForFunction((h) => window.__dn.state.currentId !== h, home);
await wait(300);
const pageId = await cur();
const meta = await ws((id) => window.__dn.state.notes.find((n) => n.id === id), pageId);
check('열기: 항목 이름으로 하위 노트를 만들고 연다', meta.title === '회의록' && meta.parentNoteId === home && meta.dbRef?.rowId === rows[0].id, JSON.stringify(meta));
await page.waitForSelector('.db-rowbar');
const bar = await page.locator('.db-rowbar').innerText();
check('페이지 머리: 데이터베이스 이름 · 속성', bar.includes('프로젝트') && bar.includes('상태') && bar.includes('진행 중'), bar);
await page.evaluate(() => window.__dn.view.setTool('block')); await page.mouse.click(700, 450);
await wait(250);
await page.keyboard.type('회의 안건');
await page.keyboard.press('Escape');
await wait(200);
check('항목 본문에 일반 블록', (await ws(() => [...window.__dn.view.engine.blocks()].length)) === 1);
await page.screenshot({ path: `${OUT}/db-page.png` });

// ───── 돌아가기 · 다시 열면 같은 노트 ─────
await page.locator('.db-rowbar-back').click();
await page.waitForFunction((h) => window.__dn.state.currentId === h, home);
await page.waitForSelector('.dn-db');
d = await db();
check('돌아가기 · 항목에 페이지 연결', d.rows.find((r) => r.id === rows[0].id).page === pageId);
const n0 = await ws(() => window.__dn.state.notes.length);
await page.locator(`.dn-db tr[data-row="${rows[0].id}"] .dn-db-grip`).click();
await page.locator('.dn-db-pop .dn-db-mi', { hasText: '페이지 열기' }).click();
await page.waitForFunction((p) => window.__dn.state.currentId === p, pageId);
check('다시 열면 같은 노트 (항목 메뉴에서)', (await ws(() => window.__dn.state.notes.length)) === n0);
await page.locator('.db-rowbar-back').click();
await page.waitForFunction((h) => window.__dn.state.currentId === h, home);
await page.waitForSelector('.dn-db');

// ───── 항목 템플릿 ─────
await page.locator('.dn-db-head .dn-db-btn[aria-label="데이터베이스 메뉴"]').click();
// 메뉴 맨 위는 'CSV로 내보내기'(GAP #13) — 템플릿은 그 아래
const tplItems = (await page.locator('.dn-db-pop .dn-db-mi').allInnerTexts()).filter((t) => !t.includes('CSV'));
check('데이터베이스 메뉴에 템플릿 목록', tplItems.length > 2 && tplItems[0].includes('빈 페이지'), tplItems.join(' / '));
await page.locator('.dn-db-pop .dn-db-mi', { hasText: tplItems[1].replace(/^[●○]\s*/, '').trim() }).click();
await page.keyboard.press('Escape');
await wait(100);
d = await db();
check('항목 템플릿 지정', !!d.pageTemplate);
await cell(rows[1].id, NAME).fill('발표 준비');
await cell(rows[1].id, NAME).press('Escape');
await wait(100);
await page.locator(`.dn-db tr[data-row="${rows[1].id}"] .dn-db-namecell`).hover();
await page.locator(`.dn-db tr[data-row="${rows[1].id}"] .dn-db-open-page`).click();
await page.waitForFunction((h) => window.__dn.state.currentId !== h, home);
await wait(400);
check('템플릿으로 만든 항목 페이지 (블록이 들어 있음 · 제목 = 항목 이름)', (await ws(() => [...window.__dn.view.engine.blocks()].length)) > 1 && (await ws(() => window.__dn.state.title)) === '발표 준비');

// ───── 새로 고침 ─────
const page2 = await cur();
await wait(800);
await page.reload();
await page.waitForSelector('.dn-block', { timeout: 15000 });
await page.waitForSelector('.db-rowbar');
check('새로 고침 후에도 항목 페이지 머리', (await cur()) === page2 && (await page.locator('.db-rowbar').innerText()).includes('프로젝트'));

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
