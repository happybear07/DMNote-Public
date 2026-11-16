// 캔버스 크기 제한: 확대 25% ~ 400% · 끝없는 캔버스도 보드(18000 × 18000) 밖으로는 화면 · 새 상자가 못 나감 ·
// 화면에서 누르는 '새 노트'는 A4 용지로 시작(설정으로 바꿈) · 줌 막대의 A4 단추로 켜고 끄기.
// 사용: dev 서버 실행 후 `node e2e/canvas-bounds.mjs`
import { chromium } from 'playwright-core';
import { fsPath } from './lib/fs-path.mjs';

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

// 1. 화면의 '새 노트' → A4
await page.locator('.note-item.add').first().click();
await wait(700);
const sheet = () => ws(() => window.__dn.view.engine.note.sheet ?? null);
check("사이드바 '새 노트' → A4 세로 용지로 시작", JSON.stringify(await sheet()) === '{"size":"a4"}', JSON.stringify(await sheet()));
// A4로 고정 (11/03): 줌 막대 단추 = 노트 전체 90도 돌리기 (세로 ↔ 가로), 끝없는 캔버스로는 안 감
const a4 = page.locator('.zoom .sheet-btn');
check('줌 막대에 A4 단추 (세로)', (await a4.count()) === 1 && (await a4.innerText()).includes('A4 세로') && (await a4.getAttribute('aria-pressed')) === 'false');
await a4.click();
await wait(400);
check('A4 단추 → 90도 돌려 가로', (await sheet())?.landscape === true && (await a4.innerText()).includes('A4 가로') && (await a4.getAttribute('aria-pressed')) === 'true');
await a4.click();
await wait(400);
check('다시 누르면 세로', JSON.stringify(await sheet()) === '{"size":"a4","pages":1}' || JSON.stringify(await sheet()) === '{"size":"a4"}', JSON.stringify(await sheet()));

// 2. 확대 범위 25% ~ 400%
for (let i = 0; i < 12; i++) await ws(() => window.__dn.view.zoomStep(-1));
await wait(200);
const zmin = await ws(() => window.__dn.view.cam.zoom);
await ws(() => window.__dn.view.setCamera({ ...window.__dn.view.cam, zoom: 0.05 }));
const zset = await ws(() => window.__dn.view.cam.zoom);
check('축소는 25%까지', Math.abs(zmin - 0.25) < 1e-6 && zset >= 0.25 - 1e-6, `${zmin} ${zset}`);
for (let i = 0; i < 14; i++) await ws(() => window.__dn.view.zoomStep(1));
check('확대는 400%까지', Math.abs((await ws(() => window.__dn.view.cam.zoom)) - 4) < 1e-6);

// 3. 끝없는 캔버스의 보드 범위
await ws(() => window.__dn.newNote());
await wait(500);
const cam = await ws(() => { const v = window.__dn.view; v.setCamera({ x: 90000, y: -90000, zoom: 1 }); return { x: v.cam.x, y: v.cam.y, w: v.size.w, h: v.size.h }; });
check('화면은 보드 끝(+ 여백)까지만', cam.x + cam.w <= 12000 + 60 && cam.y >= -6000 - 60, JSON.stringify(cam));
const desk = await ws(() => { const c = document.querySelector('.dn-canvas canvas'); const g = c.getContext('2d'); const d = g.getImageData(c.width - 4, 4, 1, 1).data; return [d[0], d[1], d[2]]; });
check('보드 밖은 책상 색으로 칠함', desk.join(',') !== '255,255,255', desk.join(','));
const placed = await ws(async (DOM) => {
  const dom = await import(DOM);
  const v = window.__dn.view;
  const id = dom.insertBlock(v, 'database', { at: { x: 50000, y: 50000 } });
  const b = id && v.engine.getBlock(id);
  return b ? { x: b.x, y: b.y, w: b.w, h: b.h } : null;
}, fsPath('packages/engine-dom/src/index.ts'));
check('보드 밖에 넣으려 하면 보드 안으로', !!placed && placed.x + placed.w <= 12000 && placed.y + placed.h <= 12000, JSON.stringify(placed));

check('콘솔 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close();
const bad = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
