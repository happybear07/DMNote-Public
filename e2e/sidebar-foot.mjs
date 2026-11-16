// 사이드바 아래 줄(휴지통 · 노트에 묻기 · 설정 · 로그인)이 같은 모양인지: 글자 크기 · 굵기 · 색 · 높이 · 아이콘과 글 사이 — 단추로 된 줄만 커지거나 밝아지지 않게.
// 밝은 · 어두운 테마 둘 다. 사용: dev 서버 실행 후 `node e2e/sidebar-foot.mjs [스크린샷 폴더]`
import { chromium } from 'playwright-core';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2];
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const browser = await chromium.launch({ channel: process.env.DN_CHANNEL ?? 'msedge', headless: true });
for (const scheme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: scheme });
  await ctx.addInitScript(() => localStorage.setItem('dn:no-env-key', '1'));
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.waitForSelector('.side-foot .note-item', { timeout: 15000 });
  await page.waitForTimeout(400);
  const rows = await page.$$eval('.side-foot .note-item', (els) => els.map((el) => {
    const cs = getComputedStyle(el), r = el.getBoundingClientRect(), t = el.querySelector('.note-title');
    return { text: el.textContent.trim().slice(0, 6), fs: cs.fontSize, fw: cs.fontWeight, color: cs.color, h: Math.round(r.height), gap: Math.round(t.getBoundingClientRect().left - r.left), ff: cs.fontFamily };
  }));
  const same = (k) => rows.every((r) => r[k] === rows[0][k]);
  check(`${scheme}: 아래 줄 ${rows.length}개 — 글자 크기 · 굵기 · 색 · 높이 · 글 시작 · 글꼴이 같음`, rows.length >= 4 && ['fs', 'fw', 'color', 'h', 'gap', 'ff'].every(same), JSON.stringify(rows.map(({ ff, ...r }) => r)));
  // 마우스를 올리면 단추 줄도 다른 줄과 같은 바탕
  const hoverBg = async (text) => { const row = page.locator('.side-foot .note-item', { hasText: text }); await row.hover(); await page.waitForTimeout(120); return row.evaluate((el) => getComputedStyle(el).backgroundColor); };
  const bgs = [await hoverBg('휴지통'), await hoverBg('노트에 묻기'), await hoverBg('로그인')];
  check(`${scheme}: 마우스를 올리면 같은 바탕`, bgs.every((b) => b === bgs[0]) && bgs[0] !== 'rgba(0, 0, 0, 0)', JSON.stringify(bgs));
  await page.mouse.move(700, 400);
  if (OUT) await page.locator('.side-foot').screenshot({ path: `${OUT}/sidebar-foot-${scheme}.png` });
  await ctx.close();
}
await browser.close();
const bad = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
