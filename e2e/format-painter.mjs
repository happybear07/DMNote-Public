// 서식 복사 (워드 붓): 붓 한 번 → 다음에 고른 글자에 글자 서식 · 그냥 누른 상자에 상자 모양, 한 번이면 끝 · 두 번 누르면 Esc까지 계속,
// Ctrl+Alt+C · Ctrl+Alt+V.
// 사용: dev 서버 실행 후 `node e2e/format-painter.mjs`
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
const marksOf = (t) => ws((t) => { for (const c of window.__dn.view.engine.contents()) { let out = null; const walk = (n) => { if (n.text?.trim() === t) out = (n.marks ?? []).map((m) => m.type).sort(); (n.content ?? []).forEach(walk); }; if (c.doc) walk(c.doc); if (out) return out; } return null; }, t);
const blocks = () => ws(() => { const e = window.__dn.view.engine; return [...e.blocks()].sort((a, b) => a.y - b.y).map((b) => ({ id: b.id, fs: b.fontScale ?? 1, ff: b.fontFamily ?? null })); });
const brush = page.locator('.doc-ribbon button[aria-label^="서식 복사"]');
/** 문서의 i번째 글 칸에서 글자 t를 마우스로 끌어 고르기 */
const dragSelect = async (i, t) => {
  const r = await ws(({ i, t }) => {
    const el = document.querySelectorAll('.dn-doc .dn-doc-text')[i];
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) { const k = n.textContent.indexOf(t); if (k >= 0) { const rg = document.createRange(); rg.setStart(n, k); rg.setEnd(n, k + t.length); const b = rg.getBoundingClientRect(); return { x0: b.left + 2, x1: b.right - 3, y: b.top + b.height / 2 }; /* 끝은 글자 안쪽 — 다음 글자(공백)까지 넘어가지 않게 */ } }
    return null;
  }, { i, t });
  await page.mouse.move(r.x0, r.y); await page.mouse.down(); await page.mouse.move(r.x1, r.y, { steps: 4 }); await page.mouse.up();
  await wait(250);
};

await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(() => window.__dn.newNote());
await wait(300);
await ws(() => {
  const e = window.__dn.view.engine;
  const para = (content) => ({ type: 'doc', content: [{ type: 'paragraph', content }] });
  e.transact((tx) => {
    const a = tx.createBlock({ x: 0, y: 0, w: 400, h: 40, fontScale: 1.3, fontFamily: 'serif' });
    tx.createContent({ blockId: a, type: 'text', role: 'body', doc: para([{ type: 'text', text: '원본', marks: [{ type: 'strong' }, { type: 'textColor', attrs: { color: 'red' } }] }, { type: 'text', text: ' 나머지' }]) });
    const b = tx.createBlock({ x: 0, y: 60, w: 400, h: 40 });
    tx.createContent({ blockId: b, type: 'text', role: 'body', doc: para([{ type: 'text', text: '대상 하나 대상 둘째' }]) });
    const c = tx.createBlock({ x: 0, y: 120, w: 400, h: 40 });
    tx.createContent({ blockId: c, type: 'text', role: 'body', doc: para([{ type: 'text', text: '세째 상자' }]) });
  }, { origin: 'user' });
});
await ws(() => window.__dn.setViewMode('doc'));
await wait(600);

// 1. 붓 한 번: "원본"을 고른 채 → 붓 → "하나"를 끌어 고름 → 글자 서식 · 붓 꺼짐
await dragSelect(0, '원본');
await brush.click();
await wait(150);
check('붓 → 칠하는 중 (단추 켜짐 · 커서)', (await brush.getAttribute('aria-pressed')) === 'true' && (await ws(() => document.querySelector('.dn-doc').classList.contains('dn-painting'))));
await dragSelect(1, '하나');
let m = await marksOf('하나');
check('고른 "하나"에 굵게 · 빨강', JSON.stringify(m) === JSON.stringify(['strong', 'textColor']), JSON.stringify(m));
check('한 번이면 붓이 꺼짐', (await brush.getAttribute('aria-pressed')) !== 'true');

// 2. 두 번 누르기: 계속 칠하기 — 상자를 누르면 상자 모양(글꼴 · 크기), 다른 글자도, Esc로 끝
await page.keyboard.press('End'); // 고르기 막대를 거둔다
await wait(150);
await page.locator('.dn-doc .dn-doc-text').nth(0).click({ position: { x: 5, y: 8 } });
await wait(200);
await brush.dblclick();
await wait(150);
check('두 번 누르면 계속 칠하기', (await brush.getAttribute('aria-pressed')) === 'true');
await page.locator('.dn-doc .dn-doc-text').nth(2).click({ position: { x: 5, y: 8 } });
await wait(400);
let b = await blocks();
check('그냥 누른 상자 → 상자 모양(명조 · 1.3배)', b[2].ff === 'serif' && b[2].fs === 1.3, JSON.stringify(b[2]));
await page.locator('.dn-doc .dn-doc-text').nth(1).click({ position: { x: 5, y: 8 } }); // 칸을 먼저 열고(상자 모양도 칠해짐) 그 화면에서 좌표를 잰다
await wait(300);
await dragSelect(1, '둘째');
check('계속 칠하기라 다음 고른 "둘째"에도', JSON.stringify(await marksOf('둘째')) === JSON.stringify(['strong', 'textColor']) && (await brush.getAttribute('aria-pressed')) === 'true');
await page.keyboard.press('Escape');
await wait(150);
check('Esc → 붓 꺼짐', (await brush.getAttribute('aria-pressed')) !== 'true' && !(await ws(() => document.querySelector('.dn-doc').classList.contains('dn-painting'))));

// 3. Ctrl+Alt+C · Ctrl+Alt+V
await dragSelect(1, '대상');
await page.keyboard.press('Control+Alt+c');
await wait(150);
await page.keyboard.press('Escape'); // 마우스 칠하기는 그만두고 담은 서식만
await dragSelect(2, '상자');
await page.keyboard.press('Control+Alt+v');
await wait(250);
check('Ctrl+Alt+C · V → 서식 없는 "대상"의 서식(없음)을 "상자"에', JSON.stringify(await marksOf('상자')) === '[]' || (await marksOf('상자')) === null, JSON.stringify(await marksOf('상자')));
await dragSelect(0, '원본');
await page.keyboard.press('Control+Alt+c');
await wait(100);
await page.keyboard.press('Escape');
await dragSelect(2, '세째');
await page.keyboard.press('Control+Alt+v');
await wait(250);
check('Ctrl+Alt+V → "세째"에 굵게 · 빨강', JSON.stringify(await marksOf('세째')) === JSON.stringify(['strong', 'textColor']), JSON.stringify(await marksOf('세째')));
check('콘솔 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close();
const bad = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
