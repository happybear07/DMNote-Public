// 지우개 막대 '지우기' (알파 10/31): 지우개를 고르면 '숨기기'(잉크 · 상자 보이기) · '지우기'(필기 모두 · 모두) 이름이 아이콘 위에.
// 누르면 무엇을 몇 개 지우는지 묻고 → 지우기 · Esc 취소 · Enter 지우기, 지운 뒤 알림의 실행 취소 · Ctrl+Z로 한 번에 되돌림.
// 사용: dev 서버 실행 후 `node e2e/ink-clear.mjs [스크린샷 폴더]`
import { chromium } from 'playwright-core';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2] ?? '.';
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
const ws = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(() => window.__dn.newNote());
await wait(300);
// 글 상자 둘 · 화살표 하나 · 자유 필기 셋
await ws(() => {
  const e = window.__dn.view.engine;
  e.transact((tx) => {
    const mk = (x, y, t) => { const b = tx.createBlock({ x, y, w: 200, h: 60 }); tx.createContent({ blockId: b, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] } }); return b; };
    const a = mk(0, 0, '하나'), b = mk(320, 0, '둘');
    tx.createArrow({ from: { blockId: a, side: 'auto' }, to: { blockId: b, side: 'auto' } });
  }, { origin: 'user' });
  window.__dn.view.setCamera({ x: -300, y: -200, zoom: 1 });
});
await wait(200);
await page.locator('.toolbar button[aria-label="펜"]').click();
for (const [x0, y0, x1, y1] of [[300, 450, 500, 480], [300, 520, 520, 540], [650, 450, 700, 560]]) {
  await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move(x1, y1, { steps: 8 }); await page.mouse.up(); await wait(80);
}
const count = () => ws(() => { const e = window.__dn.view.engine; return { b: e.blockCount, s: [...e.strokes()].length, a: [...e.arrows()].length }; });
check('준비: 상자 2 · 필기 3 · 화살표 1', JSON.stringify(await count()) === '{"b":2,"s":3,"a":1}', JSON.stringify(await count()));

// 펜일 때는 이름 없음 · 지우기 없음
const bar = page.locator('.ink-bar');
check('펜일 때는 숨기기 · 지우기 이름이 없고 지우기 단추도 없다', (await bar.locator('.ink-cap').count()) === 0 && (await bar.locator('button[aria-label="필기 모두 지우기"]').count()) === 0);
await page.locator('.toolbar button[aria-label="지우개"]').click();
await wait(150);
check('지우개 → 아이콘 위에 "숨기기" · "지우기"', JSON.stringify(await bar.locator('.ink-cap').allInnerTexts()) === '["숨기기","지우기"]', JSON.stringify(await bar.locator('.ink-cap').allInnerTexts()));
check('지우기 단추 둘 (필기 모두 지우기 · 모두 지우기) · 숨기기 단추 둘은 그대로', (await bar.locator('.ink-clear .ink-icon').count()) === 2 && (await bar.locator('button[aria-label="잉크 보이기"]').count()) === 1 && (await bar.locator('button[aria-label="상자 보이기"]').count()) === 1);

// 필기 모두 지우기 → 묻기 → 지우기
await bar.locator('button[aria-label="필기 모두 지우기"]').click();
const askInk = await bar.locator('.ink-confirm').innerText();
check('필기 모두 지우기 → "필기 3획 — 모두 지울까요?"', askInk.includes('필기 3획') && !askInk.includes('상자'), askInk);
await page.screenshot({ path: `${OUT}/ink-clear-ask.png`, clip: { x: 300, y: 560, width: 680, height: 200 } });
await bar.locator('.ink-confirm button', { hasText: '지우기' }).click();
await wait(150);
check('지우기 → 필기만 0 · 상자 · 화살표는 그대로', JSON.stringify(await count()) === '{"b":2,"s":0,"a":1}', JSON.stringify(await count()));
const toast = page.locator('.toast');
check('알림 "필기를 모두 지웠어요" + 실행 취소', (await toast.innerText()).includes('필기를 모두 지웠어요') && (await toast.locator('button', { hasText: '실행 취소' }).count()) === 1);
await toast.locator('button', { hasText: '실행 취소' }).click();
await wait(150);
check('알림의 실행 취소 → 필기 3획이 한 번에 돌아옴', (await count()).s === 3, JSON.stringify(await count()));

// 모두 지우기: Esc는 취소 · Enter는 지우기
await bar.locator('button[aria-label="모두 지우기"]').click();
const askAll = await bar.locator('.ink-confirm').innerText();
check('모두 지우기 → "상자 2개 · 필기 3획 — 모두 지울까요?"', askAll.includes('상자 2개') && askAll.includes('필기 3획'), askAll);
await page.keyboard.press('Escape');
await wait(100);
check('Esc → 묻는 창 닫힘 · 아무것도 안 지움', (await bar.locator('.ink-confirm').count()) === 0 && JSON.stringify(await count()) === '{"b":2,"s":3,"a":1}');
await bar.locator('button[aria-label="모두 지우기"]').click();
await page.keyboard.press('Enter');
await wait(150);
check('Enter → 상자 · 화살표 · 필기 전부 0', JSON.stringify(await count()) === '{"b":0,"s":0,"a":0}', JSON.stringify(await count()));
await page.keyboard.press('Control+z');
await wait(150);
check('Ctrl+Z 한 번에 모두 되살림', JSON.stringify(await count()) === '{"b":2,"s":3,"a":1}', JSON.stringify(await count()));

// 지울 것이 없을 때
await ws(() => window.__dn.newNote());
await wait(300);
await page.locator('.toolbar button[aria-label="지우개"]').click();
await bar.locator('button[aria-label="필기 모두 지우기"]').click();
check('지울 필기가 없으면 그렇다고만', (await bar.locator('.ink-confirm').innerText()).includes('지울 필기가 없어요') && (await bar.locator('.ink-confirm button.danger').count()) === 0);
await page.keyboard.press('Escape');

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
