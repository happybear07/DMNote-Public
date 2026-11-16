// 문서 뷰 편집이 흐름(화살표 단계) · 묶음 차례를 지키는지 (docs/review/DOC-EDIT-BUGS.md DE-005 ~ 007):
// 가운데 단계 지우기(블록 Delete · 여러 칸 범위) → 앞뒤가 이어져 번호 유지 · 단계 복제 → 바로 아래 · ⋮⋮로 흐름 밖 블록을 단계 사이에 → 흐름 끝에
// (놓을 자리 줄도 그 자리) · 묶음 한 블록 끌기 → 묶음 통째로 · Alt+↑ → 한 단계 위.
// 사용: dev 서버 실행 후 `node e2e/doc-flow.mjs [스크린샷 폴더]`
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
/** boxes: [이름, y, 묶음?], arrows: [앞, 뒤] — 이름으로 블록 id */
const seed = (boxes, arrows = []) => ws(([boxes, arrows]) => {
  const e = window.__dn.view.engine;
  e.transact((tx) => { for (const a of [...e.arrows()]) tx.delete('arrow', a.id); for (const b of [...e.blocks()]) { for (const c of e.contentsOf(b.id)) tx.delete('content', c.id); tx.delete('block', b.id); } }, { origin: 'user' });
  const id = {};
  e.transact((tx) => {
    for (const [t, y, g] of boxes) { const b = tx.createBlock({ x: 0, y, w: 400, h: 50, ...(g ? { group: g } : {}) }); id[t] = b; tx.createContent({ blockId: b, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] } }); }
    for (const [f, t] of arrows) tx.createArrow({ from: { blockId: id[f], side: 'auto' }, to: { blockId: id[t], side: 'auto' } });
  }, { origin: 'user' });
  return id;
}, [boxes, arrows]);
await ws(() => window.__dn.setViewMode('doc'));
await ws(() => window.__dn.setDocPages(false));
await wait(500);
/** 문서 차례: "글(단계 번호)" */
const doc = () => ws(() => [...document.querySelectorAll('.dn-doc .dn-doc-item[data-id]')].map((el) => `${el.querySelector('.dn-doc-text')?.textContent.trim()}${el.dataset.step ?? ''}`).join(' '));
const item = (t) => page.locator('.dn-doc .dn-doc-item', { has: page.locator('.dn-doc-text', { hasText: t }) }).first();
const selectBlock = async (t) => { const b = await item(t).locator('.dn-doc-text').boundingBox(); await page.mouse.click(b.x + 8, b.y + b.height / 2); await wait(150); await page.keyboard.press('Escape'); await wait(150); };
const charPt = (t, k) => ws(([t, k]) => {
  const el = [...document.querySelectorAll('.dn-doc .dn-doc-text')].find((x) => x.textContent.trim() === t);
  const n = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode();
  const r = document.createRange(); r.setStart(n, k); r.setEnd(n, k);
  const b = r.getBoundingClientRect();
  return { x: b.left + 0.5, y: b.top + b.height / 2 };
}, [t, k]);
const FLOW = [['일단계', 100], ['이단계', 200], ['삼단계', 300], ['사단계', 0]];
const CHAIN = [['일단계', '이단계'], ['이단계', '삼단계'], ['삼단계', '사단계']];

// 1. DE-005 블록 고르기 Delete로 가운데 단계 → 앞뒤가 이어져 번호 유지
await seed(FLOW, CHAIN);
await wait(400);
check('준비: 흐름 차례 1 · 2 · 3 · 4 (4단계가 캔버스 맨 위여도)', (await doc()) === '일단계1 이단계2 삼단계3 사단계4', await doc());
await selectBlock('이단계');
await page.keyboard.press('Delete');
await wait(400);
check('2단계 블록 Delete → 일1 삼2 사3', (await doc()) === '일단계1 삼단계2 사단계3', await doc());
await page.keyboard.press('Control+z'); await wait(300);
check('Ctrl+Z 한 번 → 원래 흐름', (await doc()) === '일단계1 이단계2 삼단계3 사단계4', await doc());

// 2. DE-005 여러 칸 범위로 2 · 3단계를 통째로 지우기 → 1 → 4로 이어짐
await page.keyboard.press('Escape');
const a = await charPt('일단계', 3), b = await charPt('삼단계', 3);
await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(a.x + 6, a.y, { steps: 2 }); await page.mouse.move(b.x, b.y, { steps: 10 }); await page.mouse.up();
await wait(150);
await page.keyboard.press('Backspace'); await wait(400);
check('범위로 2 · 3단계를 지우면 일1 사2', (await doc()) === '일단계1 사단계2', await doc());
await page.keyboard.press('Escape'); await page.keyboard.press('Escape');

// 3. DE-006 1단계 복제 → 문서에서도 바로 아래 (같은 단계)
await seed(FLOW, CHAIN);
await wait(400);
await selectBlock('일단계');
await page.keyboard.press('Control+d'); await wait(400);
check('1단계 Ctrl+D → 사본이 1단계 바로 아래, 번호는 그대로', (await doc()) === '일단계1 일단계 이단계2 삼단계3 사단계4', await doc());
await page.keyboard.press('Escape');

// 4. DE-007 흐름 밖 메모를 1 · 2단계 사이로 끌기 → 놓을 자리 줄이 흐름 끝에, 놓으면 흐름 뒤로
await seed([['일단계', 0], ['이단계', 100], ['삼단계', 200], ['메모', 400]], [['일단계', '이단계'], ['이단계', '삼단계']]);
await wait(400);
const grip = page.locator('.dn-doc-grip');
const m = await item('메모').boundingBox();
await page.mouse.move(m.x + 40, m.y + 10); await wait(100);
const g = await grip.boundingBox();
const s1 = await item('일단계').boundingBox(), s3 = await item('삼단계').boundingBox();
await page.mouse.move(g.x + 8, g.y + 10); await page.mouse.down();
await page.mouse.move(g.x + 8, g.y - 20, { steps: 4 });
await page.mouse.move(s1.x + 40, s1.y + s1.height + 4, { steps: 10 });
await wait(100);
const lineY = (await page.locator('.dn-doc-drop').boundingBox())?.y ?? -1;
check('1단계 아래로 끄는 중 → 놓을 자리 줄은 흐름 끝(3단계 아래)', lineY > s3.y + s3.height - 2, `줄 y=${Math.round(lineY)} 3단계 바닥=${Math.round(s3.y + s3.height)}`);
await page.mouse.up(); await wait(400);
check('놓으면 메모는 흐름 뒤 (흐름 번호 그대로)', (await doc()) === '일단계1 이단계2 삼단계3 메모', await doc());
await page.keyboard.press('Escape');

// 5. DE-007 묶음의 한 블록을 끌면 묶음 통째로 · Alt+↑ 한 단계 위
await seed([['가', 0], ['나', 100, 'g'], ['다', 200, 'g'], ['라', 300]]);
await wait(400);
const d0 = await item('다').boundingBox();
await page.mouse.move(d0.x + 40, d0.y + 10); await wait(100);
const g2 = await grip.boundingBox(), top = await item('가').boundingBox();
await page.mouse.move(g2.x + 8, g2.y + 10); await page.mouse.down();
await page.mouse.move(g2.x + 8, g2.y - 20, { steps: 4 });
await page.mouse.move(top.x + 40, top.y + 4, { steps: 10 });
await page.mouse.up(); await wait(400);
check('묶음의 "다"를 맨 위로 끌면 묶음(나 · 다)이 통째로', (await doc()) === '나 다 가 라', await doc());
await page.keyboard.press('Escape');
await seed([['일단계', 0], ['이단계', 100], ['삼단계', 200]], [['일단계', '이단계'], ['이단계', '삼단계']]);
await wait(400);
await selectBlock('삼단계');
await page.keyboard.press('Alt+ArrowUp'); await wait(400);
check('3단계 Alt+↑ → 2단계가 됨', (await doc()) === '일단계1 삼단계2 이단계3', await doc());
await page.keyboard.press('Escape');

await ws(() => window.__dn.setDocPages(true));
await page.screenshot({ path: `${OUT}/doc-flow.png` });
check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
