// 다크 테마 확인 (FR-086): 밝게 · 어둡게 · 시스템, 새로 고침 유지, 캔버스(격자 · 블록 · 블록 색)까지 테마를 따른다.
// 주요 화면을 어두운 테마로 찍어 남긴다 (눈으로 확인).
// 사용: dev 서버 실행 후 `node e2e/theme.mjs [스크린샷 폴더]`
import { chromium } from 'playwright-core';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2] ?? '.';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

const browser = await chromium.launch({ channel: process.env.DN_CHANNEL ?? 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
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
const look = () => ws(() => ({
  theme: document.documentElement.dataset.theme,
  body: [document.body, document.documentElement].map((e) => getComputedStyle(e).backgroundColor).find((c) => c !== 'rgba(0, 0, 0, 0)'),
  block: getComputedStyle(document.querySelector('.dn-block:not(.dn-box-title):not(.dn-colored)')).backgroundColor,
  canvas: getComputedStyle(document.querySelector('.dn-canvas')).backgroundColor,
  grid: window.__dn.view.theme.grid,
}));
const lum = (rgb) => { const [r, g, b] = rgb.match(/\d+/g).map(Number); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };

let l = await look();
check('기본은 시스템(밝게)', l.theme === 'light' && lum(l.body) > 240, JSON.stringify(l));

await ws(() => window.__dn.setTheme('dark'));
await wait(200);
l = await look();
// 상자 바탕은 비워 캔버스(무늬)가 비친다 (알파 10/31) — 캔버스가 어두우면 상자도 어둡게 보인다
check('어둡게: 바탕 · 캔버스가 어둡고 상자 바탕은 비어 캔버스가 비침', l.theme === 'dark' && lum(l.body) < 40 && lum(l.canvas) < 50 && l.block === 'rgba(0, 0, 0, 0)', JSON.stringify(l));
check('캔버스 격자 색도 테마를 따름', l.grid === '#343434', l.grid);
// 블록 색 (노랑) — 어두운 노랑
await ws(() => { const v = window.__dn.view; const id = [...v.engine.blocks()].find((b) => b.y > 50).id; v.select([id]); });
await ws(() => window.__dn.view.engine.transact((tx) => tx.set('block', window.__dn.view.selectedBlocks[0], { style: { color: 'yellow' } }), { origin: 'user' }));
await wait(200);
const yellow = await page.locator('.dn-block.dn-colored').first().evaluate((el) => getComputedStyle(el).backgroundColor);
check('블록 색도 어두운 테마 값', lum(yellow) < 70, yellow);
// 문서 뷰의 색 블록도 어두운 바탕 — 밝은 고정 바탕 위 밝은 글자로 안 보이던 것
await ws(() => window.__dn.setViewMode('doc'));
await wait(400);
const docTint = await page.locator('.dn-doc-item[data-color="yellow"]').first().evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, fg: getComputedStyle(el.querySelector('.dn-doc-text') ?? el).color }));
check('문서 뷰 색 블록: 어두운 바탕 · 밝은 글자 (글자가 보임)', lum(docTint.bg) < 70 && lum(docTint.fg) - lum(docTint.bg) > 120, JSON.stringify(docTint));
await ws(() => window.__dn.setViewMode('canvas'));
await wait(200);
await ws(() => window.__dn.view.select([]));
await page.screenshot({ path: `${OUT}/dark-canvas.png` });

// 새로 고침 유지 · 첫 그리기부터 어두움
await page.reload();
await page.waitForSelector('.dn-block', { timeout: 15000 });
check('새로 고침 후에도 어둡게', (await ws(() => document.documentElement.dataset.theme)) === 'dark' && (await ws(() => window.__dn.state.theme)) === 'dark');

// 주요 화면
await ws(() => window.__dn.showHome());
await wait(400);
await page.screenshot({ path: `${OUT}/dark-home.png` });
await ws((id) => window.__dn.openById(id), await ws(() => window.__dn.state.notes[0].id));
await ws(() => window.__dn.togglePanel(true));
await ws(() => window.__dn.openOverlay('command'));
await wait(300);
await page.screenshot({ path: `${OUT}/dark-palette.png` });
await page.keyboard.press('Escape');
await ws(() => window.__dn.togglePanel(false));
await ws(() => window.__dn.openSettings());
await wait(200);
await page.screenshot({ path: `${OUT}/dark-settings.png` });
await page.locator('.settings .x').click();

// 시스템 따라
await ws(() => window.__dn.setTheme('system'));
await wait(100);
check('시스템(밝게) → 밝게', (await ws(() => document.documentElement.dataset.theme)) === 'light');
await page.emulateMedia({ colorScheme: 'dark' });
await wait(200);
check('시스템이 어둡게 바뀌면 바로 어둡게 (캔버스 포함)', (await ws(() => document.documentElement.dataset.theme)) === 'dark' && (await ws(() => window.__dn.view.theme.grid)) === '#343434');
await page.emulateMedia({ colorScheme: 'light' });
await ws(() => window.__dn.setTheme('light'));

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
