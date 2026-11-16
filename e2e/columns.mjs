// 문서 뷰 컬럼 (FR-049): 캔버스에서 같은 줄인 블록은 문서 뷰에서 좌우 컬럼 · 너비는 캔버스 폭 비율 · 사이 막대를 끌면 두 블록 폭(합은 그대로) ·
// 실행 취소 한 번 · 다른 줄 블록은 한 줄 전체 · 좁은 화면은 세로로. 사용: dev 서버 실행 후 `node e2e/columns.mjs [폴더]`
import { chromium } from 'playwright-core';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2] ?? '.';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
process.on('unhandledRejection', (e) => { if (!/TargetClosedError|has been closed/.test(String(e))) throw e; });

const browser = await chromium.launch({ channel: process.env.DN_CHANNEL ?? 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
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
const ids = await ws(() => {
  const e = window.__dn.view.engine;
  const mk = (x, y, w, t) => e.transact((tx) => { const b = tx.createBlock({ x, y, w, h: 80 }); tx.createContent({ blockId: b, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] } }); return b; }, { origin: 'user' }).value;
  return { a: mk(0, 0, 300, '왼쪽 컬럼 — 장점'), b: mk(400, 10, 200, '오른쪽 컬럼 — 단점'), c: mk(0, 200, 300, '아래 결론') };
});
await page.waitForTimeout(300);
await ws(() => window.__dn.setViewMode('doc'));
await page.waitForSelector('.dn-doc-row', { timeout: 3000 }).catch(() => {});
const item = (id) => page.locator(`.dn-doc-item[data-id="${id}"]`);
const inRow = await page.evaluate((ids) => [ids.a, ids.b, ids.c].map((id) => !!document.querySelector(`.dn-doc-item[data-id="${id}"]`)?.parentElement?.classList.contains('dn-doc-row')), ids);
check('캔버스에서 같은 줄인 두 블록은 컬럼 · 다른 줄은 한 줄 전체', JSON.stringify(inRow) === '[true,true,false]', JSON.stringify(inRow));
const wa = (await item(ids.a).boundingBox()).width, wb = (await item(ids.b).boundingBox()).width;
check('컬럼 너비는 캔버스 폭 비율 (300:200, 안쪽 여백 차이 허용)', Math.abs(wa / wb - 1.5) < 0.1, (wa / wb).toFixed(2));
await page.screenshot({ path: `${OUT}/columns.png` });

// 사이 막대 끌기 → 두 블록 캔버스 폭 (합 500 그대로) → 실행 취소 한 번
const g = await page.locator('.dn-doc-gap').first().boundingBox();
await page.mouse.move(g.x + g.width / 2, g.y + 20);
await page.mouse.down();
await page.mouse.move(g.x + g.width / 2 + 90, g.y + 20, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(200);
const w1 = await ws((ids) => [ids.a, ids.b].map((id) => window.__dn.view.engine.getBlock(id).w), ids);
check('사이 막대를 오른쪽으로 끌면 왼쪽이 넓어진다 (합 그대로)', w1[0] > 300 && w1[0] + w1[1] === 500, JSON.stringify(w1));
await ws(() => window.__dn.view.undo());
await page.waitForTimeout(150);
const w2 = await ws((ids) => [ids.a, ids.b].map((id) => window.__dn.view.engine.getBlock(id).w), ids);
check('컬럼 너비 바꾸기는 실행 취소 한 번', JSON.stringify(w2) === '[300,200]', JSON.stringify(w2));

// 문서 뷰에서 컬럼 안 글 고치기
await item(ids.b).locator('.dn-doc-text').click();
await page.keyboard.press('End');
await page.keyboard.type(' 추가');
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
check('컬럼 안에서도 글 고치기', (await ws((id) => JSON.stringify(window.__dn.view.engine.contentsOf(id)[0].doc), ids.b)).includes('단점 추가'));

// 좁은 화면 → 세로로
await page.setViewportSize({ width: 640, height: 900 });
await page.waitForTimeout(300);
const stacked = await page.evaluate((ids) => {
  const a = document.querySelector(`.dn-doc-item[data-id="${ids.a}"]`).getBoundingClientRect(), b = document.querySelector(`.dn-doc-item[data-id="${ids.b}"]`).getBoundingClientRect();
  return b.top >= a.bottom - 1;
}, ids);
check('좁은 화면에서는 세로로 쌓기', stacked);

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
