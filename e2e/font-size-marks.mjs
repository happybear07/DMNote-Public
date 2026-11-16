// 고른 글자만 글자 크기 (워드): 문서 서식 막대의 글자 크기 칸 · Ctrl+] · Ctrl+[는 글자를 골랐으면 고른 글자만, 아니면 상자 전체.
// 캔버스 오른쪽 클릭 › 글자 메뉴도 글자를 골라 두면 '고른 글자' — 크기 · 글자 색이 고른 글자에만.
// 사용: dev 서버 실행 후 `node e2e/font-size-marks.mjs`
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
/** 글자별 [글, 크기 배율, 글자 색] */
const runs = () => ws(() => { const out = []; for (const c of window.__dn.view.engine.contents()) { const walk = (n) => { if (n.text !== undefined) { const m = n.marks ?? []; out.push([n.text, m.find((x) => x.type === 'fontSize')?.attrs.scale ?? 1, m.find((x) => x.type === 'textColor')?.attrs.color ?? null]); } (n.content ?? []).forEach(walk); }; if (c.doc) walk(c.doc); } return out; });
const selectLeft = async (n) => { for (let i = 0; i < n; i++) await page.keyboard.press('Shift+ArrowLeft'); await wait(200); };
const block = () => ws(() => [...window.__dn.view.engine.blocks()][0]?.fontScale ?? 1);

await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(() => window.__dn.newNote());
await wait(300);
await ws(() => window.__dn.setViewMode('doc'));
await wait(400);
await page.locator('.dn-doc-page').click({ position: { x: 300, y: 200 } });
await wait(200);
await page.keyboard.type('작은 큰 끝');
for (let i = 0; i < 2; i++) await page.keyboard.press('ArrowLeft');
await selectLeft(1); // "큰"
const sizeSel = page.locator('.doc-ribbon input[aria-label="글자 크기 (px)"]'); // px 칸 (알파 10/31 — 본문 기준 12.5px)
check('글자를 고르면 크기 칸이 고른 글자 기준(12.5px)', (await sizeSel.inputValue()) === '12.5', await sizeSel.inputValue());
await sizeSel.click();
await page.keyboard.press('Control+a');
await page.keyboard.type('18.75');
await page.keyboard.press('Enter');
await wait(250);
let r = await runs();
check('서식 막대 18.75px → "큰"만 1.5배 · 상자 크기는 그대로', JSON.stringify(r.map((x) => [x[0], x[1]])) === JSON.stringify([['작은 ', 1], ['큰', 1.5], [' 끝', 1]]) && (await block()) === 1, JSON.stringify(r));
const px = await ws(() => { const s = document.querySelector('.dn-doc .dn-text-editing span[data-fs]'); const p = s?.closest('p'); return s && p ? [parseFloat(getComputedStyle(s).fontSize), parseFloat(getComputedStyle(p).fontSize)] : null; });
check('화면에서도 1.5배로 보임', !!px && Math.abs(px[0] / px[1] - 1.5) < 0.02, JSON.stringify(px));
await page.keyboard.press('Control+]');
await wait(250);
r = await runs();
check('Ctrl+] → 고른 글자만 한 칸 (1.75)', r.find((x) => x[0] === '큰')?.[1] === 1.75 && (await block()) === 1, JSON.stringify(r));
await page.keyboard.press('End');
await wait(100);
await page.keyboard.press('Control+]');
await wait(250);
check('고르지 않고 Ctrl+] → 상자 전체 한 칸 (1.15)', (await block()) === 1.15 && (await sizeSel.inputValue()) === '14.4', String(await block()));
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
await wait(400);
const stat = await ws(() => { const s = document.querySelector('.dn-doc .dn-doc-text span[data-fs]'); return s ? s.dataset.fs : null; });
check('정적 화면에서도 크기 표시가 남음', stat === '1.75', String(stat));

// 캔버스: 오른쪽 클릭 › 글자 (고른 글자)
await ws(() => window.__dn.setViewMode('canvas'));
await wait(400);
await ws(() => { const v = window.__dn.view; v.select([]); v.addBlockAtCenter(); });
await wait(250);
await page.keyboard.type('캔버스 글자');
await selectLeft(2);
const target = page.locator('.dn-block .dn-text-editing').last();
const box = await target.boundingBox();
await page.mouse.click(box.x + box.width - 14, box.y + box.height / 2, { button: 'right' });
await wait(300);
const head = await page.locator('.menu-head', { hasText: '고른 글자' }).count();
check('글자를 골라 둔 채 오른쪽 클릭 → "고른 글자" 메뉴', head === 1);
await page.locator('.menu input[aria-label="글자 크기 (px)"]').click();
await page.keyboard.press('Control+a');
await page.keyboard.type('14.375');
await page.keyboard.press('Enter');
await wait(200);
await page.locator('button[aria-label="빨강 글자"]').click().catch(() => {});
await wait(250);
r = await runs();
const g = r.find((x) => x[0] === '글자');
check('메뉴 크기 14.375px · 빨강 → 고른 "글자"만 1.15배 · 빨강', !!g && g[1] === 1.15 && g[2] === 'red' && r.find((x) => x[0].startsWith('캔버스'))?.[1] === 1, JSON.stringify(r.slice(-2)));
check('콘솔 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close();
const bad = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
