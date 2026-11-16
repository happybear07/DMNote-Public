// 상자를 글보다 작게 줄이기 (알파 AT-022): 손잡이 · Alt+↑로 줄여도 글 높이에서 멈춤(데이터 높이 = 화면 높이),
// 아래에 붙인 상자와 겹치지 않고, 새로 고침 뒤에도 겹치지 않음. 사용: dev 서버 실행 후 `node e2e/box-shrink.mjs [스크린샷 폴더]`
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
await ws(() => window.__dn.newNote({ sheet: null }));
await wait(400);

/** 데이터 높이 · 화면(DOM) 높이 */
const sizes = (id) => ws((id) => { const v = window.__dn.view, b = v.engine.getBlock(id); return { y: b.y, w: b.w, h: b.h, dom: v.mounted.get(id).el.offsetHeight }; }, id);
const domOverlaps = () => ws(() => {
  const els = [...document.querySelectorAll('.dn-world > .dn-block')].map((el) => el.getBoundingClientRect());
  let n = 0;
  for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) { const a = els[i], b = els[j]; if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) n++; }
  return n;
});
const make = async (x, y, lines) => {
  await ws(() => window.__dn.view.addBlockAtCenter('text'));
  for (const [i, l] of lines.entries()) { if (i) await page.keyboard.press('Enter'); await page.keyboard.type(l); }
  await page.keyboard.press('Escape');
  await wait(150);
  const id = await ws(() => window.__dn.view.selectedBlocks[0]);
  await ws(([id, x, y]) => window.__dn.view.engine.transact((tx) => tx.set('block', id, { x, y }), { origin: 'user' }), [id, x, y]);
  await wait(150);
  return id;
};
await ws(() => window.__dn.view.setCamera({ x: -60, y: -60, zoom: 1 }));
const A = await make(0, 0, ['줄인 상자 첫째 줄', '둘째 줄입니다']);
const a0 = await sizes(A);

// 손잡이(오른쪽 아래)를 위로만 크게 끌기 — 폭이 그대로면 화면 크기 알림이 안 와 데이터만 줄던 경우
await ws((id) => window.__dn.view.select([id]), A);
await wait(150);
const corner = await ws((id) => { const v = window.__dn.view, b = v.engine.getBlock(id), o = v.root.getBoundingClientRect(), p = v.toScreen({ x: b.x + b.w, y: b.y + b.h }); return { x: o.left + p.x, y: o.top + p.y }; }, A);
await page.mouse.move(corner.x, corner.y);
await page.mouse.down();
await page.mouse.move(corner.x, corner.y - 45, { steps: 6 });
await page.mouse.up();
await wait(400);
const a1 = await sizes(A);
check('AT-022: 손잡이로 줄여도 글 높이에서 멈춤 · 데이터 높이 = 화면 높이', a1.w === a0.w && a1.h >= a0.h - 1 && Math.abs(a1.h - a1.dom) < 1, JSON.stringify({ a0, a1 }));

// Alt+↑ 여러 번
await ws(() => window.__dn.view.root.focus());
for (let i = 0; i < 6; i++) { await page.keyboard.press('Alt+ArrowUp'); await wait(60); }
await wait(300);
const a2 = await sizes(A);
check('Alt+↑로 줄여도 글 높이 아래로는 안 감', Math.abs(a2.h - a2.dom) < 1 && a2.h >= a1.h - 1, JSON.stringify(a2));

// 아래에 붙인 상자와 안 겹침 · 새로 고침 뒤에도
const B = await make(0, a2.h + 16, ['아래에 붙인 상자']);
check('아래에 붙인 상자와 화면에서 안 겹침', (await domOverlaps()) === 0);
await wait(800);
await page.reload();
await page.waitForSelector('.dn-canvas', { timeout: 15000 });
await wait(800);
const after = await ws(([a, b]) => { const e = window.__dn.view.engine; return [e.getBlock(a), e.getBlock(b)].map((x) => x && { y: x.y, h: x.h }); }, [A, B]);
check('새로 고침 뒤에도 안 겹침 (데이터 · 화면)', after[0] && after[1] && after[1].y >= after[0].y + after[0].h && (await domOverlaps()) === 0, JSON.stringify(after));
if (OUT) await page.screenshot({ path: `${OUT}/box-shrink.png` });

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} 통과${errors.length ? ` · 오류 ${errors.length}: ${errors.slice(0, 3).join(' | ')}` : ''}`);
await browser.close();
process.exit(results.every((r) => r.ok) && !errors.length ? 0 : 1);
