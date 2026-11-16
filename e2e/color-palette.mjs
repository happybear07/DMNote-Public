// 글자 색 팔레트: 문서 서식 막대의 색 버튼 → 테마 견본 아래 "팔레트에서 더 고르기" → 색 원 · #코드로 직접 · 최근 쓴 색,
// 캔버스 오른쪽 클릭 › 글자에도 같은 팔레트. 직접 고른 색은 #rrggbb로 저장되고 글자에 그대로 칠해진다.
// 사용: dev 서버 실행 후 `node e2e/color-palette.mjs`
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
await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(() => window.__dn.newNote());
await wait(300);
await ws(() => window.__dn.setViewMode('doc'));
await wait(400);
await page.locator('.dn-doc-page').click({ position: { x: 300, y: 200 } });
await wait(200);
await page.keyboard.type('팔레트 시험');
await wait(200);
const color = () => ws(() => { const b = [...window.__dn.view.engine.blocks()][0]; return b?.textColor ?? null; });
const painted = () => ws(() => getComputedStyle(document.querySelector('.dn-doc .dn-doc-text p') ?? document.body).color);
const colorBtn = page.locator('.doc-ribbon button[aria-label="글자 색"]');

await colorBtn.click();
await wait(200);
check('색 버튼 → 테마 견본 + 팔레트 버튼', (await page.locator('.rb-pop-panel .cp-sw').count()) === 10 && (await page.locator('.rb-pop-panel .cp-more').count()) === 1);
await page.locator('.rb-pop-panel .cp-more').click();
await wait(150);
const dots = await page.locator('.rb-pop-panel .cp-grid .cp-dot').count();
check('팔레트에서 더 고르기 → 색 원 60개 + 직접 고르기', dots === 60 && (await page.locator('.rb-pop-panel .cp-code').count()) === 1, String(dots));
const pick = await page.locator('.rb-pop-panel .cp-grid .cp-dot').nth(27).getAttribute('title');
await page.locator('.rb-pop-panel .cp-grid .cp-dot').nth(27).click();
await wait(300);
check('색 원 → 그 색(#rrggbb)으로 저장 · 판 닫힘', (await color()) === pick && (await page.locator('.rb-pop-panel').count()) === 0, `${await color()} ${pick}`);
const rgb = (h) => `rgb(${parseInt(h.slice(1, 3), 16)}, ${parseInt(h.slice(3, 5), 16)}, ${parseInt(h.slice(5, 7), 16)})`;
check('글자가 그 색으로 칠해짐', (await painted()) === rgb(pick), `${await painted()} ${rgb(pick)}`);
check('편집은 그대로 (계속 쓸 수 있음)', (await page.locator('.dn-doc .dn-text-editing').count()) === 1);

await colorBtn.click();
await wait(200);
check('최근 쓴 색에 방금 고른 색', (await page.locator('.rb-pop-panel .cp-dot[title="' + pick + '"]').count()) >= 1);
if (!(await page.locator('.rb-pop-panel .cp-code').count())) await page.locator('.rb-pop-panel .cp-more').click();
await page.locator('.rb-pop-panel .cp-code').fill('#36f');
await page.keyboard.press('Enter');
await wait(300);
check('#코드로 직접 → #3366ff', (await color()) === '#3366ff', String(await color()));
await colorBtn.click();
await wait(200);
await page.locator('.rb-pop-panel .cp-sw[aria-label="기본 글자 색"]').click();
await wait(200);
check('기본 글자 색 → 색 지움', (await color()) === null);
await colorBtn.click();
await wait(200);
if (!(await page.locator('.rb-pop-panel .cp-code').count())) await page.locator('.rb-pop-panel .cp-more').click();
await page.locator('.rb-pop-panel .cp-code').fill('파랑');
await page.locator('.rb-pop-panel .cp-apply').click();
await wait(200);
check('잘못된 코드는 빨간 테두리, 색은 그대로', (await page.locator('.rb-pop-panel .cp-code.bad').count()) === 1 && (await color()) === null);
await page.keyboard.press('Escape');
await wait(150);

// 캔버스 오른쪽 클릭 › 글자
await page.keyboard.press('Escape');
await ws(() => window.__dn.setViewMode('canvas'));
await wait(500);
const blk = page.locator('.dn-block').first();
await blk.click({ button: 'right' });
await wait(250);
const textItem = page.locator('.menu[aria-label="블록 메뉴"] button', { hasText: /^글자/ });
if (await textItem.count()) { await textItem.first().click(); await wait(200); }
const more = page.locator('.menu .color-palette .cp-more');
check('캔버스 글자 메뉴에도 팔레트', (await more.count()) === 1);
if (await more.count()) {
  await more.click();
  await wait(150);
  await page.locator('.menu .color-palette .cp-code').fill('#aa3377');
  await page.keyboard.press('Enter');
  await wait(300);
  const c = await color();
  const canvasColor = await blk.locator('.dn-text').first().evaluate((el) => getComputedStyle(el).color);
  check('캔버스: #aa3377 저장 · 칠해짐', c === '#aa3377' && canvasColor === 'rgb(170, 51, 119)', `${c} ${canvasColor}`);
}
check('콘솔 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close();
const bad = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
