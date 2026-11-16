// 홈 화면에 추가 안내 (FR-148 · D1): iPad · iPhone Safari에서 설치하지 않았으면 열 때마다 안내 (7일 미사용 시 지워질 수 있음),
// '이번만 닫기'는 이번 실행만, 홈 화면에서 연 앱(standalone)에는 안내 없음. 사용: dev 서버 실행 후 `node e2e/install-hint.mjs`
import { chromium } from 'playwright-core';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const browser = await chromium.launch({ channel: process.env.DN_CHANNEL ?? 'msedge', headless: true });
const errors = [];

async function open(ua, viewport, standalone = false) {
  const ctx = await browser.newContext({ userAgent: ua, viewport, hasTouch: true, isMobile: viewport.width < 600 });
  await ctx.addInitScript((sa) => {
    localStorage.setItem('dn:no-env-key', '1');
    if (sa) Object.defineProperty(navigator, 'standalone', { get: () => true });
  }, standalone);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE);
  await page.waitForSelector('.dn-block, .dn-doc-page', { timeout: 15000 });
  await page.waitForTimeout(300);
  return { ctx, page };
}

{
  const { ctx, page } = await open(IPAD, { width: 1024, height: 1366 });
  const hint = page.locator('.install-hint');
  check('iPad Safari: 홈 화면에 추가 안내', await hint.isVisible() && (await hint.innerText()).includes('홈 화면에 추가'));
  check('안내에 이유 (7일 미사용 시 지워질 수 있음)', (await hint.innerText()).includes('7일'));
  await hint.locator('button', { hasText: '이번만 닫기' }).click();
  check('이번만 닫기 → 사라짐', (await hint.count()) === 0);
  await page.reload();
  await page.waitForSelector('.dn-block, .dn-doc-page', { timeout: 15000 });
  await page.waitForTimeout(300);
  check('다시 열면 또 안내 (설치 전까지 필수)', await page.locator('.install-hint').isVisible());
  await ctx.close();
}
{
  const { ctx, page } = await open(IPHONE, { width: 390, height: 844 });
  check('iPhone Safari도 안내', await page.locator('.install-hint').isVisible());
  await ctx.close();
}
{
  const { ctx, page } = await open(IPAD, { width: 1024, height: 1366 }, true);
  check('홈 화면에서 연 앱에는 안내 없음', (await page.locator('.install-hint').count()) === 0);
  await ctx.close();
}

check('오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
