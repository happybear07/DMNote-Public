// 발표 모드 (GAP #21 — 노션 발표 · Ctrl+Alt+P): 위 막대 '발표' · Ctrl+Alt+P → 장면 1 / N, 장면 밖 상자는 옅게, → · Space · 누르기로 다음,
// ← 앞, End 끝, 발표 중에는 고칠 수 없음, Esc로 끝 — 화면 위치 · 보기 전용이 발표 전으로. 문서 뷰에서 시작하면 캔버스로 바꿔 발표.
// 사용: dev 서버 실행 후 `node e2e/present.mjs [스크린샷 폴더]`
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
const P = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] });
const hud = () => page.locator('.dn-present-hud').innerText().catch(() => '');
const onTexts = () => page.locator('.dn-block.dn-present-on').allInnerTexts().then((a) => a.map((t) => t.trim()));

await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(() => window.__dn.newNote({ sheet: null }));
await page.waitForFunction(() => window.__dn.view.engine.blockCount === 0);
await ws((ps) => {
  const e = window.__dn.view.engine;
  e.transact((tx) => {
    const mk = (x, y, role, p) => { const b = tx.createBlock({ x, y, w: 300, h: 50 }); tx.createContent({ blockId: b, type: 'text', role, doc: { type: 'doc', content: [p] } }); return b; };
    mk(0, 0, 'title', ps[0]); mk(0, 80, 'body', ps[1]);
    mk(0, 600, 'title', ps[2]); const a = mk(0, 680, 'body', ps[3]), b = mk(400, 680, 'body', ps[4]);
    tx.createArrow({ from: { blockId: a, side: 'auto' }, to: { blockId: b, side: 'auto' } });
    mk(0, 1300, 'title', ps[5]);
  }, { origin: 'user' });
  window.__dn.view.setCamera({ x: -100, y: -50, zoom: 1 });
}, [P('표지'), P('부제'), P('1장 흐름'), P('원인'), P('결과'), P('끝')]);
await wait(400);
const cam0 = await ws(() => ({ ...window.__dn.view.cam }));

await page.locator('.topbar .more-btn').click(); // 발표는 위 막대 ⋯ 안 (DS-009)
await page.locator('.present-btn').click();
await wait(600);
check('발표 시작: 1 / 3 · 첫 장면 상자만 또렷', (await hud()) === '1 / 3' && JSON.stringify((await onTexts()).sort()) === JSON.stringify(['부제', '표지']), `${await hud()} ${JSON.stringify(await onTexts())}`);
check('장면 밖 상자는 옅게 (화면에 들어온 것만 그려진다)', await page.locator('.dn-block:not(.dn-present-on)').evaluateAll((els) => els.every((e) => Number(getComputedStyle(e).opacity) < 0.5)));
check('발표 중에는 보기 전용', await ws(() => window.__dn.view.readOnly));
await page.keyboard.press('ArrowRight');
await wait(600);
check('→ 다음 장면 (2 / 3) · 그 상자들에 맞춰 화면 이동', (await hud()) === '2 / 3' && JSON.stringify((await onTexts()).sort()) === JSON.stringify(['1장 흐름', '결과', '원인']), JSON.stringify(await onTexts()));
await page.screenshot({ path: `${OUT}/present-2.png` });
await page.mouse.click(700, 450);
await wait(500);
check('누르기 → 다음 (3 / 3)', (await hud()) === '3 / 3');
await page.keyboard.press('ArrowLeft');
await wait(400);
await page.keyboard.press('End');
await wait(400);
check('← 앞 · End 끝', (await hud()) === '3 / 3');
await page.keyboard.press('Escape');
await wait(400);
const cam1 = await ws(() => ({ ...window.__dn.view.cam }));
check('Esc → 끝: 장면 번호 없음 · 화면 위치 · 고칠 수 있음 원래대로', (await page.locator('.dn-present-hud').count()) === 0 && !(await ws(() => window.__dn.view.readOnly)) && Math.abs(cam1.x - cam0.x) < 1 && Math.abs(cam1.zoom - cam0.zoom) < 0.01, JSON.stringify({ cam0, cam1 }));
check('옅게 표시도 걷힘', (await page.locator('.dn-present-on').count()) === 0 && (await page.locator('.dn-present').count()) === 0);

// 문서 뷰에서 Ctrl+Alt+P → 캔버스로 바꿔 발표
await ws(() => window.__dn.setViewMode('doc'));
await wait(600);
await page.keyboard.press('Control+Alt+KeyP');
await wait(600);
check('문서 뷰에서 Ctrl+Alt+P → 캔버스로 바꿔 발표', (await ws(() => window.__dn.state.viewMode)) === 'canvas' && (await hud()) === '1 / 3', await hud());
await page.keyboard.press('Escape');
await wait(300);

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
