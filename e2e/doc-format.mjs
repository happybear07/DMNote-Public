// 문서 서식 막대 보강: 위/아래 첨자(단추 · Ctrl+. · Ctrl+,) · 서식 지우기 · 줄 간격 · 들여쓰기/내어쓰기(단추 · Tab · Shift+Tab, 목록 안은 항목 단계)
// 사용: dev 서버 실행 후 `node e2e/doc-format.mjs [스크린샷 폴더]`
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
const ws = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(() => window.__dn.newNote());
await wait(300);
await ws(() => {
  const e = window.__dn.view.engine;
  const p = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] });
  e.transact((tx) => {
    const b = tx.createBlock({ x: 0, y: 0, w: 400, h: 50 }); tx.createContent({ blockId: b, type: 'text', role: 'body', doc: { type: 'doc', content: [p('물 H2O 공식'), p('둘째 줄')] } });
    const c = tx.createBlock({ x: 0, y: 120, w: 400, h: 50 }); tx.createContent({ blockId: c, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'bullet_list', content: [{ type: 'list_item', content: [p('항목 하나')] }, { type: 'list_item', content: [p('항목 둘')] }] }] } });
  }, { origin: 'user' });
});
await ws(() => window.__dn.setViewMode('doc'));
await wait(600);
const part = (i) => page.locator('.dn-doc .dn-doc-text').nth(i);
const btn = (label) => page.locator(`.doc-ribbon [aria-label^="${label}"]`);
const blockOf = (i) => ws((i) => { const id = document.querySelectorAll('.dn-doc .dn-doc-item')[i].dataset.id; return window.__dn.view.engine.getBlock(id); }, i);
const marksIn = (text) => ws((t) => { const c = [...window.__dn.view.engine.contents()].find((x) => JSON.stringify(x.doc ?? '').includes(t)); const out = []; const walk = (n) => { if (n.text?.includes(t)) out.push(...(n.marks ?? []).map((m) => m.type)); (n.content ?? []).forEach(walk); }; walk(c.doc); return out.sort(); }, text);

// 1. "2"를 골라 아래 첨자 단추 → sub, 위 첨자 단추 → sup으로 바뀜(함께 안 걸림)
const b0 = await part(0).boundingBox();
await page.mouse.click(b0.x + 4, b0.y + 8);
await page.keyboard.press('Home');
for (let i = 0; i < 3; i++) { await page.keyboard.press('ArrowRight'); await wait(60); } // '물 H' 뒤
await page.keyboard.press('Shift+ArrowRight');
await wait(150);
await btn('아래 첨자').click();
await wait(200);
check('아래 첨자 단추 → 고른 글자가 sub', JSON.stringify(await marksIn('2')) === '["sub"]', JSON.stringify(await marksIn('2')));
check('문서에 <sub>로 보임', (await page.locator('.dn-doc sub').count()) >= 1);
await page.keyboard.press('Control+.');
await wait(200);
check('Ctrl+. → 위 첨자로 바뀜 (아래 첨자는 풀림)', JSON.stringify(await marksIn('2')) === '["sup"]', JSON.stringify(await marksIn('2')));
// 2. 서식 지우기
await page.keyboard.press('Control+b');
await btn('서식 지우기').click();
await wait(200);
check('서식 지우기 → 글자 표시가 모두 빠짐', (await marksIn('2')).length === 0, JSON.stringify(await marksIn('2')));
// 3. 줄 간격
await btn('줄 · 문단 간격').click(); // 줄 간격 · 첫 줄 · 문단 앞뒤 간격 판
await wait(150);
await page.locator('.doc-ribbon .rb-pop-panel button', { hasText: /^2$/ }).click();
await wait(300);
const lh = await ws(() => { const el = document.querySelector('.dn-doc .dn-doc-item'); return [getComputedStyle(el).getPropertyValue('--dn-lh').trim(), parseFloat(getComputedStyle(el.querySelector('p')).lineHeight)]; });
check('줄 간격 2 → 블록 lineHeight 2 · 글 줄 높이 커짐', (await blockOf(0)).lineHeight === 2 && lh[0] === '2' && lh[1] >= 36, JSON.stringify(lh));
// 4. 들여쓰기: 단추 · Tab · Shift+Tab
const x0 = await ws(() => document.querySelector('.dn-doc .dn-doc-text p').getBoundingClientRect().left);
await btn('들여쓰기').click();
await wait(200);
await page.keyboard.press('Tab');
await wait(300);
const x1 = await ws(() => document.querySelector('.dn-doc .dn-doc-text p').getBoundingClientRect().left);
check('들여쓰기 단추 + Tab → 2단계, 글이 48px 오른쪽으로', (await blockOf(0)).indent === 2 && Math.round(x1 - x0) === 48, `${(await blockOf(0)).indent} ${x1 - x0}`);
await page.keyboard.press('Shift+Tab');
await wait(200);
await btn('내어쓰기').click();
await wait(200);
check('Shift+Tab + 내어쓰기 단추 → 들여쓰기 없음', (await blockOf(0)).indent === undefined);
// 5. 목록 안 Tab = 항목 단계
await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
const items = page.locator('.dn-doc li');
const li2 = await items.nth(1).boundingBox();
await page.mouse.click(li2.x + 40, li2.y + 6);
await page.keyboard.press('Tab');
await wait(300);
const nested = await ws(() => [...window.__dn.view.engine.contents()].some((c) => JSON.stringify(c.doc ?? '').match(/"list_item".*"bullet_list".*항목 둘/)));
check('목록 안 Tab → 항목이 한 단계 안으로 (상자 들여쓰기 아님)', nested && (await blockOf(1)).indent === undefined);
await page.keyboard.press('Escape');
await page.screenshot({ path: `${OUT}/doc-format.png` });
check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
