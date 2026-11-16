// 실행 취소 · 다시 실행 여러 번 (알파 10/31 "한 번밖에 안 된다"): 캔버스 상자 · 필기 · 문서 뷰에서 Ctrl+Z를 이어 누르면 하나씩 끝까지,
// 도구 막대 · 필기 막대 단추를 누른 뒤(초점이 단추)에도 Ctrl+Z · Ctrl+Y가 먹는다. 글 입력 칸에서는 그 칸의 실행 취소.
// 사용: dev 서버 실행 후 `node e2e/undo.mjs`
import { chromium } from 'playwright-core';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
process.on('unhandledRejection', (e) => { if (!/TargetClosedError|has been closed/.test(String(e))) throw e; });

const browser = await chromium.launch({ channel: process.env.DN_CHANNEL ?? 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(() => localStorage.setItem('dn:no-env-key', '1'));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });
const wait = (ms) => page.waitForTimeout(ms);
await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
const fresh = async () => { await page.evaluate(() => window.__dn.newNote()); await wait(400); };
const count = () => page.evaluate(() => ({ b: window.__dn.view.engine.blockCount, s: [...window.__dn.view.engine.strokes()].length }));
const press = async (k, n = 1) => { for (let i = 0; i < n; i++) { await page.keyboard.press(k); await wait(120); } };
const bar = page.locator('.toolbar');
const makeBox = async (x, y, t) => {
  await bar.locator('.text-tool').first().click();
  await page.mouse.click(x, y);
  await page.keyboard.type(t);
  await page.keyboard.press('Escape');
  await wait(1100); // 다음 글은 다른 기록으로
};

// 캔버스: 상자 셋(만들기 + 글) → Ctrl+Z 여섯 번에 하나씩 빈 캔버스까지 → Ctrl+Y 여섯 번에 되살림
await fresh();
for (const [x, y, t] of [[300, 200, '하나'], [600, 300, '둘'], [400, 500, '셋']]) await makeBox(x, y, t);
const steps = [];
for (let i = 0; i < 6; i++) { await press('Control+z'); steps.push((await count()).b); }
check('캔버스 — Ctrl+Z 여섯 번에 상자 셋이 글 · 상자 차례로 끝까지', steps.join() === '3,2,2,1,1,0', steps.join());
for (let i = 0; i < 6; i++) await press('Control+y');
check('Ctrl+Y 여섯 번에 모두 되살림', (await count()).b === 3);

// 도구 막대 실행 취소 단추를 누른 뒤(초점이 단추) Ctrl+Z가 이어서 먹는다
await bar.locator('button[aria-label="실행 취소"]').click();
await wait(150);
const focusBtn = await page.evaluate(() => document.activeElement?.tagName);
await press('Control+z', 2);
check('단추로 되돌린 뒤 Ctrl+Z 두 번 더 — 초점이 단추여도', (await count()).b === 2 && focusBtn === 'BUTTON', `${JSON.stringify(await count())} 초점 ${focusBtn}`);
await press('Control+Shift+z', 3);
check('Ctrl+Shift+Z 세 번 — 다시 실행도', (await count()).b === 3);

// 필기: 펜 단추를 누르고(초점이 단추) 획 셋 → 필기 막대 단추를 누른 뒤에도 Ctrl+Z 셋
await fresh();
await bar.locator('button[aria-label="펜"]').click();
for (const [x0, y0, x1, y1] of [[300, 300, 500, 340], [300, 400, 500, 420], [600, 300, 650, 450]]) {
  await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move(x1, y1, { steps: 8 }); await page.mouse.up();
  await wait(100);
}
await page.locator('.ink-bar .ink-pen-btn').click();
await page.keyboard.press('Escape');
await page.locator('.ink-bar .ink-swatch').nth(1).click();
const s0 = (await count()).s;
const inkSteps = [];
for (let i = 0; i < 3; i++) { await press('Control+z'); inkSteps.push((await count()).s); }
check('필기 — 필기 막대 단추를 누른 뒤에도 Ctrl+Z 세 번에 획 하나씩', s0 === 3 && inkSteps.join() === '2,1,0', `${s0} → ${inkSteps.join()}`);

// 문서 뷰: 세 줄을 쓰고 Ctrl+Z 넷에 한 줄씩 → 빈 문서, Ctrl+Y로 되살림
await fresh();
await page.locator('.topbar button', { hasText: '문서' }).click();
await wait(500);
await page.locator('.dn-doc-empty').click();
for (const t of ['first line', 'second', 'third']) { await page.keyboard.type(t); await wait(1100); await page.keyboard.press('Enter'); }
await wait(200);
const docText = () => page.evaluate(() => [...document.querySelectorAll('.dn-doc .dn-doc-text')].map((el) => el.innerText.trim()).join('/'));
const docSteps = [];
for (let i = 0; i < 5; i++) { await press('Control+z'); docSteps.push(await docText()); }
check('문서 — Ctrl+Z에 한 줄씩 빈 문서까지', docSteps[1] === 'first line\n\nsecond' || docSteps.slice(0, 4).every((t, i, a) => i === 0 || t.length < a[i - 1].length), JSON.stringify(docSteps));
check('문서 — 끝까지 되돌리면 빈 문서', (await count()).b === 0, JSON.stringify(await count()));
for (let i = 0; i < 5; i++) await press('Control+y');
check('문서 — Ctrl+Y로 세 줄 되살림', (await docText()).includes('third'), await docText());

// 입력 칸(노트 찾기 등)에서는 그 칸의 실행 취소 — 노트를 되돌리지 않는다
await page.locator('.topbar button', { hasText: '캔버스' }).click();
await wait(300);
const before = await count();
await page.locator('.sidebar input, .side-search input, input[type="search"]').first().click().catch(() => {});
const inInput = await page.evaluate(() => document.activeElement?.tagName === 'INPUT');
if (inInput) {
  await page.keyboard.type('abc');
  await press('Control+z');
  check('입력 칸의 Ctrl+Z는 노트를 되돌리지 않는다', JSON.stringify(await count()) === JSON.stringify(before), JSON.stringify(await count()));
  await page.keyboard.press('Escape');
}

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
