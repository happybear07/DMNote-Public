// 사진 대체 텍스트 (워드 › 대체 텍스트): 블록 메뉴 › 대체 텍스트 달기 → 입력 → img alt · 다시 열면 '고치기' · 비우면 지움 · 문서 뷰에서도.
// 사용: dev 서버 실행 후 `node e2e/image-alt.mjs`
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
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push(m.text()); });
const ws = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);

await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(() => window.__dn.newNote({ sheet: null }));
await page.waitForFunction(() => window.__dn.view.engine.blockCount === 0);
const ids = await ws(() => {
  const v = window.__dn.view;
  const r = v.engine.transact((tx) => {
    const t = tx.createBlock({ x: 0, y: 0, w: 320, h: 40 }); tx.createContent({ blockId: t, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '글 상자' }] }] } });
    const g = tx.createBlock({ x: 0, y: 100, w: 320, h: 200 }); const c = tx.createContent({ blockId: g, type: 'image', attachment: 'no-such-hash', natural: { w: 320, h: 200 } });
    return { t, g, c };
  }, { origin: 'user' });
  v.setCamera({ x: -100, y: -100, zoom: 1 });
  return r.value;
});
await wait(500);
const alt = () => ws((c) => window.__dn.view.engine.getContent(c).alt ?? null, ids.c);
const imgAlt = (sel) => page.locator(sel).first().getAttribute('alt');
const openMenu = (id) => ws((id) => { const v = window.__dn.view; v.select([id]); const r = v.mounted.get(id).el.getBoundingClientRect(); v.onBlockMenu?.({ ids: [id], x: r.left + 10, y: r.top + 10 }); }, id);

await openMenu(ids.t);
await wait(250);
check('글 상자 메뉴에는 대체 텍스트 없음', (await page.locator('.menu button', { hasText: '대체 텍스트' }).count()) === 0);
await page.keyboard.press('Escape');
await openMenu(ids.g);
await wait(250);
await page.locator('.menu button', { hasText: '대체 텍스트 달기' }).click();
await wait(200);
check('입력 칸이 뜨고 초점', (await ws(() => document.activeElement?.getAttribute('aria-label'))) === '대체 텍스트');
await page.keyboard.type('바다 위 노을');
await page.keyboard.press('Enter');
await wait(300);
check('Enter → 저장 · 캔버스 img alt', (await alt()) === '바다 위 노을' && (await imgAlt(`.dn-block[data-id="${ids.g}"] img`)) === '바다 위 노을', JSON.stringify([await alt(), await imgAlt(`.dn-block[data-id="${ids.g}"] img`)]));
await openMenu(ids.g);
await wait(250);
check("다시 열면 '대체 텍스트 고치기'", (await page.locator('.menu button', { hasText: '대체 텍스트 고치기' }).count()) === 1);
await page.locator('.menu button', { hasText: '대체 텍스트 고치기' }).click();
await wait(200);
check('고치기 칸에 지금 글', (await ws(() => document.activeElement?.value)) === '바다 위 노을');
await page.keyboard.press('Escape');
await wait(200);
check('Esc → 그대로', (await alt()) === '바다 위 노을');

// 문서 뷰: 오른쪽 클릭 메뉴 · img alt
await ws(() => window.__dn.setViewMode('doc'));
await wait(600);
check('문서 뷰 img alt', (await imgAlt('.dn-doc img')) === '바다 위 노을', String(await imgAlt('.dn-doc img')));
await page.locator('.dn-doc img').first().click({ button: 'right' });
await wait(250);
await page.locator('.menu button', { hasText: '대체 텍스트 고치기' }).click();
await wait(200);
await page.keyboard.press('Control+a');
await page.keyboard.press('Delete');
await page.keyboard.press('Enter');
await wait(300);
check('문서 뷰에서 비우면 지움', (await alt()) === null && (await imgAlt('.dn-doc img')) === '', JSON.stringify([await alt(), await imgAlt('.dn-doc img')]));
await page.keyboard.press('Control+z');
await wait(300);
check('실행 취소 → 되돌아옴', (await alt()) === '바다 위 노을', String(await alt()));

check('콘솔 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close();
const bad = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
