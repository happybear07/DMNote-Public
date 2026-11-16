// 이동 경로 (GAP #17 — 노션 위쪽 경로): 노트 이름 앞에 든 폴더 · 상위 노트, 폴더를 누르면 사이드바에서 펼쳐 그 줄로,
// 상위 노트(데이터베이스 항목 페이지의 노트)를 누르면 연다. 맨 위 노트는 경로 없음, 위 막대 높이는 그대로(52px).
// 사용: dev 서버 실행 후 `node e2e/breadcrumb.mjs`
import { chromium } from 'playwright-core';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
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
const crumbs = () => page.locator('.topbar .crumbs .crumb').allInnerTexts();

await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
check('맨 위 노트는 경로 없음', (await crumbs()).length === 0);
const ids = await ws(async () => {
  const w = window.__dn, f1 = await w.createFolder('바깥 폴더'), f2 = await w.createFolder('안쪽 폴더', f1);
  await w.newNote({ folderId: f2, sheet: null });
  await new Promise((r) => setTimeout(r, 500));
  w.setTitle('경로 노트');
  return { f1, f2 };
});
await wait(400);
check('폴더 속 노트: 바깥 폴더 › 안쪽 폴더', JSON.stringify(await crumbs()) === '["바깥 폴더","안쪽 폴더"]', JSON.stringify(await crumbs()));
check('위 막대 높이 그대로 (52px)', (await page.locator('.topbar').evaluate((e) => e.offsetHeight)) === 52);
await ws((ids) => { const w = window.__dn; w.setExpanded(`f:${ids.f1}`, false); w.setExpanded(`f:${ids.f2}`, false); }, ids);
await wait(200);
await page.locator('.topbar .crumb', { hasText: '안쪽 폴더' }).click();
await wait(300);
const open = await ws((ids) => [window.__dn.state.expanded[`f:${ids.f1}`], window.__dn.state.expanded[`f:${ids.f2}`]], ids);
check('폴더를 누르면 사이드바에서 바깥까지 펼침', open[0] === true && open[1] === true, JSON.stringify(open));
check('… 그 폴더 줄이 보임', await page.locator(`.note-item[data-key="f:${ids.f2}"]`).isVisible());

// 데이터베이스 항목 페이지: 상위 노트가 경로에 — 누르면 그 노트로
await ws(async () => {
  const w = window.__dn, v = w.view;
  v.setTool('block');
});
await page.mouse.click(600, 300);
await wait(250);
await page.keyboard.type('/데이터');
await wait(250);
await page.keyboard.press('Enter');
await page.waitForSelector('.dn-db');
await page.locator('.dn-db .dn-db-open-page').first().click({ force: true });
await wait(1200);
const c2 = await crumbs();
check('항목 페이지: 폴더 › 상위 노트', JSON.stringify(c2) === '["바깥 폴더","안쪽 폴더","경로 노트"]', JSON.stringify(c2));
await page.locator('.topbar .crumb', { hasText: '경로 노트' }).click();
await wait(800);
check('상위 노트를 누르면 그 노트로', (await page.locator('.title-input').inputValue()) === '경로 노트');

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
