// 문서 뷰 새 문단 (초안): Enter 한 번은 같은 상자 안 줄바꿈(문단 단위) · 빈 줄 Enter로 새 문단 자리만 잡고, 글이 들어와야 캔버스에 상자가 생긴다 ·
// 글 없이 떠나면 없어짐 · 글을 다 지우면 캔버스 상자도 없어짐 · 실행 취소.
// 사용: dev 서버 실행 후 `node e2e/doc-draft.mjs`
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
await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(() => window.__dn.newNote());
await wait(300);
await ws(() => window.__dn.setViewMode('doc'));
await wait(400);
const info = () => ws(() => {
  const e = window.__dn.view.engine;
  const all = [...e.blocks()].sort((a, b) => a.y - b.y);
  const seen = new Set(e.queryBlocks({ x: -1e6, y: -1e6, w: 2e6, h: 2e6 }));
  return { total: all.length, canvas: all.filter((b) => seen.has(b.id)).length, drafts: all.filter((b) => b.draft).length,
    texts: all.map((b) => e.contentsOf(b.id).map((c) => (c.doc?.content ?? []).map((n) => (n.content ?? []).map((t) => t.text ?? '').join('')).join('/')).join('|')) };
});

await page.locator('.dn-doc-page').click({ position: { x: 300, y: 200 } });
await wait(250);
await page.keyboard.type('가');
await page.keyboard.press('Enter');
await page.keyboard.type('나');
await wait(200);
let i = await info();
check('Enter 한 번은 같은 상자 안 줄바꿈 (문단 단위, 상자 하나)', i.total === 1 && i.texts[0] === '가/나', JSON.stringify(i));

await page.keyboard.press('Enter');
await page.keyboard.press('Enter');
await wait(300);
i = await info();
check('빈 줄 Enter → 새 문단 자리만 (초안) — 캔버스에는 아직 없음', i.total === 2 && i.drafts === 1 && i.canvas === 1, JSON.stringify(i));

await page.keyboard.type('다');
await wait(250);
i = await info();
check('글이 들어오면 캔버스에 상자가 생김', i.total === 2 && i.drafts === 0 && i.canvas === 2 && i.texts[1] === '다', JSON.stringify(i));

await page.keyboard.press('Enter');
await page.keyboard.press('Enter');
await wait(300);
i = await info();
check('또 새 문단 자리 (초안)', i.total === 3 && i.drafts === 1 && i.canvas === 2, JSON.stringify(i));
await page.keyboard.press('ArrowUp');
await wait(300);
i = await info();
check('글 없이 떠나면 초안이 없어짐', i.total === 2 && i.drafts === 0 && i.canvas === 2, JSON.stringify(i));

// 둘째 상자 글을 다 지우면 캔버스 상자도 없어진다
await page.keyboard.press('Control+a');
await page.keyboard.press('Delete');
await wait(200);
await page.keyboard.press('ArrowUp');
await wait(300);
i = await info();
check('글을 다 지우고 떠나면 캔버스 상자도 없어짐', i.total === 1 && i.canvas === 1, JSON.stringify(i));
await ws(() => window.__dn.view.undo());
await wait(300);
i = await info();
check('실행 취소 → 상자가 되살아남', i.total === 2, JSON.stringify(i));

await ws(() => window.__dn.setViewMode('canvas'));
await wait(500);
check('캔버스 화면에도 상자 수가 같음', (await page.locator('.dn-block').count()) === 2, String(await page.locator('.dn-block').count()));
check('콘솔 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close();
const bad = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
