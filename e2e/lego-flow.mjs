// 글이 늘면 아래 상자를 레고처럼 (알파 AT-020 — 사용자 결정 11/02, ADR-0014의 예외): 캔버스에서 줄을 더하면 붙은 아래 상자가
// 이음매(16px) 그대로 내려가고 옆 상자는 그대로, 줄을 지우면(실행 취소) 내린 만큼 돌아옴. 문서 뷰에서 줄을 더해도 캔버스에서 안 겹침.
// 사용: dev 서버 실행 후 `node e2e/lego-flow.mjs [스크린샷 폴더]`
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

const rect = (id) => ws((id) => { const b = window.__dn.view.engine.getBlock(id); return { x: b.x, y: b.y, w: b.w, h: b.h }; }, id);
/** 화면(DOM)에서 겹친 상자 쌍 수 — 데이터 높이가 아니라 실제 그려진 높이로 */
const domOverlaps = () => ws(() => {
  const els = [...document.querySelectorAll('.dn-world > .dn-block')].map((el) => el.getBoundingClientRect());
  let n = 0;
  for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) { const a = els[i], b = els[j]; if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) n++; }
  return n;
});
const make = async (x, y, text) => {
  await ws(() => window.__dn.view.addBlockAtCenter('text'));
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
  await wait(150);
  const id = await ws(() => window.__dn.view.selectedBlocks[0]);
  await ws(([id, x, y]) => window.__dn.view.engine.transact((tx) => tx.set('block', id, { x, y }), { origin: 'user' }), [id, x, y]);
  await wait(150);
  return id;
};

// 캔버스: A · 바로 아래 붙은 B · 그 아래 C · A 오른쪽 D
const A = await make(0, 0, '위 상자');
const a0 = await rect(A);
const B = await make(0, a0.h + 16, '아래 상자');
const b0 = await rect(B);
const C = await make(0, b0.y + b0.h + 16, '맨 아래 상자');
const D = await make(a0.w + 40, 0, '옆 상자');
const c0 = await rect(C), d0 = await rect(D);
await ws(() => window.__dn.view.setCamera({ x: -60, y: -60, zoom: 1 }));
await ws((id) => window.__dn.view.startEditing(id, 'end'), A);
await wait(150);
for (let i = 1; i <= 4; i++) { await page.keyboard.press('Enter'); await page.keyboard.type(`더한 줄 ${i}`); }
await page.keyboard.press('Escape');
await wait(500);
const a1 = await rect(A), b1 = await rect(B), c1 = await rect(C), d1 = await rect(D);
check('AT-020: 줄을 더하면 A가 커짐', a1.h > a0.h + 40, `${a0.h} → ${a1.h}`);
check('붙은 B는 이음매 16 그대로 내려감', Math.abs(b1.y - (a1.y + a1.h + 16)) < 1, JSON.stringify({ a1, b1 }));
check('그 아래 C도 줄줄이', Math.abs(c1.y - (b1.y + b1.h + 16)) < 1, JSON.stringify(c1));
check('옆 상자 D는 그대로', d1.y === d0.y && d1.x === d0.x);
check('화면에서 겹친 상자 없음', (await domOverlaps()) === 0);
await page.screenshot({ path: `${OUT}/lego-grow.png` });

// 실행 취소로 줄이 빠지면 내린 만큼 돌아옴
await ws(() => window.__dn.view.root.focus());
for (let i = 0; i < 12 && (await rect(A)).h > a0.h + 1; i++) { await page.keyboard.press('Control+z'); await wait(250); }
const a2 = await rect(A), b2 = await rect(B), c2 = await rect(C);
check('줄이 빠지면 B · C가 내린 만큼 돌아옴', Math.abs(a2.h - a0.h) < 1 && Math.abs(b2.y - b0.y) < 1 && Math.abs(c2.y - c0.y) < 1, JSON.stringify({ a2, b2, c2 }));

// 문서 뷰에서 줄을 더해도 캔버스에서 안 겹침 (AT-020-B)
await ws(() => window.__dn.newNote({ sheet: null }));
await wait(300);
await ws(() => window.__dn.setViewMode('doc'));
await wait(400);
await page.locator('.dn-doc-page').click({ position: { x: 300, y: 200 } });
await wait(200);
for (const t of ['첫 문단', '둘째 문단', '셋째 문단']) { await page.keyboard.type(t); await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); await wait(250); }
await page.keyboard.press('Backspace');
await wait(200);
await page.locator('.dn-doc .dn-doc-item').first().click();
await page.keyboard.press('End');
for (let i = 1; i <= 4; i++) { await page.keyboard.press('Shift+Enter'); await page.keyboard.type(`문서에서 더한 줄 ${i}`); }
await wait(300);
await ws(() => window.__dn.setViewMode('canvas'));
await wait(800);
const docBlocks = await ws(() => [...window.__dn.view.engine.blocks()].map((b) => ({ y: b.y, h: b.h })).sort((a, b) => a.y - b.y));
const dataOverlap = docBlocks.some((b, i) => i > 0 && b.y < docBlocks[i - 1].y + docBlocks[i - 1].h);
check('AT-020-B: 문서에서 줄을 더해도 캔버스에서 안 겹침 (데이터 · 화면)', docBlocks.length >= 3 && !dataOverlap && (await domOverlaps()) === 0, JSON.stringify(docBlocks));
await page.screenshot({ path: `${OUT}/lego-doc.png` });

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} 통과${errors.length ? ` · 오류 ${errors.length}: ${errors.slice(0, 3).join(' | ')}` : ''}`);
await browser.close();
process.exit(results.every((r) => r.ok) && !errors.length ? 0 : 1);
