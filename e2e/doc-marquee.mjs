// 문서 뷰 끌어 고르기 · 블록 지정: 글 밖 빈 곳에서 끌면 사각형에 걸친 항목들이 골라지고(캔버스처럼),
// Ctrl+G로 한 블록(묶음) · Ctrl+Shift+G로 풀기 · ⋮⋮ 메뉴에도. 끌지 않고 누르면 원래대로 새 문단.
// 사용: dev 서버 실행 후 `node e2e/doc-marquee.mjs`
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
for (const [i, t] of ['가 문단', '나 문단', '다 문단'].entries()) {
  if (i) { await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); await wait(200); }
  await page.keyboard.type(t);
}
await wait(200);
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
await wait(300);
const rects = await ws(() => [...document.querySelectorAll('.dn-doc .dn-doc-item')].map((el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, b: r.bottom, r: r.right }; }));
check('준비: 문단 셋', rects.length === 3, JSON.stringify(rects.length));
// 왼쪽 여백(항목 밖)에서 시작
const sx = rects[0].l - 40, sy = rects[0].t + 4;
const bg = await ws(([x, y]) => { const el = document.elementFromPoint(x, y); return !!el && !el.closest('.dn-doc-item') && !!el.closest('.dn-doc'); }, [sx, sy]);
check('시작점은 글 밖 빈 곳', bg);
await page.mouse.move(sx, sy);
await page.mouse.down();
await page.mouse.move(sx + 30, sy + 10, { steps: 3 });
await page.mouse.move(rects[1].l + 60, rects[1].t + 8, { steps: 6 });
await wait(100);
const during = await page.locator('.dn-doc-marquee').count();
await page.mouse.up();
await wait(200);
const sel = await page.locator('.dn-doc .dn-doc-sel').count();
check('끄는 동안 파란 사각형', during === 1);
check('사각형에 걸친 두 문단이 골라짐', sel === 2, String(sel));
check('떼면 사각형은 사라짐', (await page.locator('.dn-doc-marquee').count()) === 0);

const groups = () => ws(() => { const e = window.__dn.view.engine; return [...e.blocks()].sort((a, b) => a.y - b.y).map((b) => b.group ?? null); });
await page.keyboard.press('Control+g');
await wait(300);
let g = await groups();
check('Ctrl+G → 두 상자가 한 블록(묶음)', !!g[0] && g[0] === g[1] && !g[2], JSON.stringify(g));
const marks = await ws(() => [...document.querySelectorAll('.dn-doc .dn-doc-item')].map((el) => el.dataset.grp ?? ''));
check('문서에 묶음 왼쪽 선 (첫 · 끝)', JSON.stringify(marks) === JSON.stringify(['first', 'last', '']), JSON.stringify(marks));
check('묶은 뒤에도 두 항목이 골라진 채', (await page.locator('.dn-doc .dn-doc-sel').count()) === 2);
await page.keyboard.press('Control+Shift+g');
await wait(300);
g = await groups();
check('Ctrl+Shift+G → 묶음 풀기', g.every((x) => !x), JSON.stringify(g));
await ws(() => window.__dn.view.undo());
await wait(300);
g = await groups();
check('실행 취소 → 다시 묶음', !!g[0] && g[0] === g[1], JSON.stringify(g));

// 끌지 않고 누르면 원래대로 — 맨 아래 빈 곳은 새 문단
await page.keyboard.press('Escape');
const last = await ws(() => { const its = document.querySelectorAll('.dn-doc .dn-doc-item'); return its[its.length - 1].getBoundingClientRect().bottom; });
await page.mouse.click(rects[0].l + 80, last + 60);
await wait(300);
check('빈 곳을 그냥 누르면 새 문단에 커서 (전과 같음)', (await page.locator('.dn-doc .dn-text-editing').count()) === 1);
check('콘솔 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close();
const bad = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
