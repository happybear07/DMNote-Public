// 문서 뷰 상태 줄 (워드 상태 표시줄): 글자 수(공백 제외) · 낱말 수, 치면 바로 바뀜, 글을 고르면 '고른 범위 / 전체', 캔버스에선 없음.
// 사용: dev 서버 실행 후 `node e2e/doc-status.mjs [스크린샷 폴더]`
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
await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(() => window.__dn.newNote({ sheet: null }));
await page.waitForFunction(() => window.__dn.view.engine.blockCount === 0);
await ws(() => {
  const e = window.__dn.view.engine;
  e.transact((tx) => {
    const mk = (y, text) => { const b = tx.createBlock({ x: 0, y, w: 400, h: 50 }); tx.createContent({ blockId: b, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } }); };
    mk(0, '하나 둘 셋');
    mk(80, '넷 다섯');
  }, { origin: 'user' });
});
await ws(() => window.__dn.setViewMode('doc'));
await wait(600);
const status = () => page.locator('.doc-status .ds-count').innerText().catch(() => '');

check('상태 줄: 글자 7 · 낱말 5 (공백 제외)', (await status()) === '글자 7 · 낱말 5', await status());
const sr = await page.locator('.doc-status').boundingBox(), sc = await page.locator('.doc-scroll').boundingBox();
check('상태 줄은 문서 아래 · 문서와 겹치지 않음', !!sr && !!sc && sc.y + sc.height <= sr.y + 0.5 && sr.y + sr.height <= 900.5, JSON.stringify({ sr, sc }));

// 치면 바로 바뀜
const b0 = await page.locator('.dn-doc .dn-doc-text').first().boundingBox();
await page.mouse.click(b0.x + b0.width - 4, b0.y + 8);
await wait(200);
await page.keyboard.press('End');
await page.keyboard.type(' 여섯');
await wait(500);
check('치면 바로: 글자 9 · 낱말 6', (await status()) === '글자 9 · 낱말 6', await status());

// 고르면 '고른 범위 / 전체'
await page.keyboard.press('Home');
for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight');
await wait(250);
check("'둘 셋'을 고르면 글자 2 / 9 · 낱말 2 / 6", (await status()) === '글자 2 / 9 · 낱말 2 / 6', await status());
if (OUT) await page.screenshot({ path: `${OUT}/doc-status.png` });
await page.keyboard.press('ArrowRight');
await wait(250);
check('고르기를 풀면 전체 수로', (await status()) === '글자 9 · 낱말 6', await status());

// 여러 칸에 걸친 고르기도 (Shift+누르기)
await page.keyboard.press('Home');
const b1 = await page.locator('.dn-doc .dn-doc-text').nth(1).boundingBox();
await page.keyboard.down('Shift'); await page.mouse.click(b1.x + 30, b1.y + b1.height / 2); await page.keyboard.up('Shift');
await wait(300);
const cross = await status();
check('두 칸에 걸쳐 고르면 고른 범위 수', /^글자 [1-9]\d* \/ 9 · 낱말 [1-9]\d* \/ 6$/.test(cross), cross);

await page.keyboard.press('Escape');
await ws(() => window.__dn.setViewMode('canvas'));
await wait(300);
check('캔버스에서는 상태 줄 없음', (await page.locator('.doc-status').count()) === 0);

check('콘솔 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close();
const bad = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
