// 고른 글자만 글자 색 · 배경 색 (노션처럼): 고르기 막대 A → 판 → 글자 색 · 배경 색, 문서 서식 막대는 글자를 고르면 '고른 글자 색' 판(배경 색 줄 포함),
// 고르지 않으면 예전처럼 상자 전체 글자 색, 캔버스 글 상자에서도, 다시 그려도(정적) 색이 남는다.
// 사용: dev 서버 실행 후 `node e2e/text-color-marks.mjs`
import { chromium } from 'playwright-core';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2];
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
/** 글자별 표시 [text, textColor, highlight color] */
const runs = () => ws(() => { const out = []; for (const c of window.__dn.view.engine.contents()) { const walk = (n) => { if (n.text !== undefined) { const m = n.marks ?? []; out.push([n.text, m.find((x) => x.type === 'textColor')?.attrs.color ?? null, m.find((x) => x.type === 'highlight') ? (m.find((x) => x.type === 'highlight').attrs?.color || 'default') : null]); } (n.content ?? []).forEach(walk); }; if (c.doc) walk(c.doc); } return out; });
const selectLeft = async (n) => { for (let i = 0; i < n; i++) await page.keyboard.press('Shift+ArrowLeft'); await wait(200); };

await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(() => window.__dn.newNote());
await wait(300);
await ws(() => window.__dn.setViewMode('doc'));
await wait(400);
await page.locator('.dn-doc-page').click({ position: { x: 300, y: 200 } });
await wait(200);
await page.keyboard.type('앞 빨강 끝');
await wait(100);
for (let i = 0; i < 2; i++) await page.keyboard.press('ArrowLeft');
await wait(80);
await selectLeft(2); // "빨강"
await page.waitForSelector('.dn-bubble:not([hidden])', { timeout: 2000 }).catch(() => {});
await page.locator('.dn-bubble .dn-bubble-color').click();
await wait(150);
check('고르기 막대 A → 글자 색 · 배경 색 판', (await page.locator('.dn-bubble .dn-color-panel .dn-color-sw').count()) === 20);
if (OUT) await page.screenshot({ path: `${OUT}/text-color-bubble.png`, clip: { x: 300, y: 120, width: 900, height: 360 } });
await page.locator('.dn-bubble .dn-color-sw[aria-label="글자 색: 빨강"]').click();
await wait(250);
let r = await runs();
check('고른 "빨강"만 빨간 글자', JSON.stringify(r) === JSON.stringify([['앞 ', null, null], ['빨강', 'red', null], [' 끝', null, null]]), JSON.stringify(r));
await page.locator('.dn-bubble .dn-bubble-color').click();
await wait(150);
await page.locator('.dn-bubble .dn-color-sw[aria-label="배경 색: 노랑"]').click();
await wait(250);
r = await runs();
check('같은 글자에 노랑 배경', r[1]?.[1] === 'red' && r[1]?.[2] === 'yellow', JSON.stringify(r));

// 서식 막대: 글자를 고르면 고른 글자에만
await page.keyboard.press('End');
await page.keyboard.type(' 파랑');
await selectLeft(2);
await page.locator('.doc-ribbon button[aria-label="글자 색"]').click();
await wait(200);
check('서식 막대: 고른 글자 색 판 (배경 색 줄 포함)', (await page.locator('.rb-pop-panel .cp-title').first().innerText()) === '고른 글자 색' && (await page.locator('.rb-pop-panel .cp-bg').count()) === 10);
await page.locator('.rb-pop-panel .cp-sw[aria-label="글자 색 파랑"]').click();
await wait(250);
r = await runs();
const block = await ws(() => [...window.__dn.view.engine.blocks()][0]?.textColor ?? null);
check('고른 "파랑"만 파란 글자 · 상자 색은 그대로', r.some(([t, c]) => t === '파랑' && c === 'blue') && block === null, JSON.stringify(r));
// 고르지 않으면 상자 전체
await page.keyboard.press('End');
await wait(100);
await page.locator('.doc-ribbon button[aria-label="글자 색"]').click();
await wait(200);
check('고르지 않으면 예전처럼 상자 글자 색 판', (await page.locator('.rb-pop-panel .cp-title').first().innerText()) === '글자 색' && (await page.locator('.rb-pop-panel .cp-bg').count()) === 0);
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
await wait(400);
const css = await ws(() => { const s = document.querySelector('.dn-doc .dn-doc-text span[data-tc="red"]'); return s ? getComputedStyle(s).color : null; });
check('정적 화면에서도 빨간 글자로 그려짐', css === 'rgb(212, 76, 71)' || (css ?? '').startsWith('rgb('), String(css));

// 캔버스
await ws(() => window.__dn.setViewMode('canvas'));
await wait(400);
await ws(() => window.__dn.view.addBlockAtCenter());
await wait(250);
await page.keyboard.type('캔버스 초록');
await selectLeft(2);
await page.waitForSelector('.dn-bubble:not([hidden])', { timeout: 2000 }).catch(() => {});
await page.locator('.dn-bubble:not([hidden]) .dn-bubble-color').click();
await wait(150);
await page.locator('.dn-bubble:not([hidden]) .dn-color-sw[aria-label="글자 색: 초록"]').click();
await wait(250);
r = await runs();
check('캔버스 글 상자에서도 고른 글자만', r.some(([t, c]) => t === '초록' && c === 'green'), JSON.stringify(r.slice(-2)));
check('콘솔 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close();
const bad = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
