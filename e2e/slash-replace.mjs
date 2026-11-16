// 캔버스 빈 글 상자에서 슬래시 넣기 → 노션처럼 그 상자 자리를 대신 (빈 상자가 남지 않음). 글이 있거나 화살표가 걸린 상자는 그대로 두고 아래에.
// 사용: dev 서버 실행 후 `node e2e/slash-replace.mjs`
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
const slash = async (q) => { await page.keyboard.type('/'); await wait(150); await page.keyboard.type(q); await wait(250); await page.keyboard.press('Enter'); await wait(500); };
const blocks = () => ws(() => { const e = window.__dn.view.engine; return [...e.blocks()].map((b) => ({ id: b.id, x: Math.round(b.x), y: Math.round(b.y), types: e.contentsOf(b.id).map((c) => c.type).join(',') })); });
const fresh = async () => { await ws(() => window.__dn.newNote()); await wait(300); await ws(() => window.__dn.view.addBlockAtCenter()); await wait(250); };

await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });

// 1. 빈 상자 /목차 → 그 자리에 목차 하나
await fresh();
const at = (await blocks())[0];
await slash('목차');
let b = await blocks();
check('빈 상자 /목차 → 상자 자리에 목차 (빈 상자 안 남음)', b.length === 1 && b[0].types === 'toc' && Math.abs(b[0].x - at.x) < 2 && Math.abs(b[0].y - at.y) < 2, JSON.stringify(b));
await ws(() => window.__dn.view.engine.undo());
await wait(200);
await ws(() => window.__dn.view.engine.undo());
await wait(200);
b = await blocks();
check('실행 취소 두 번 → 빈 상자로 되돌아옴', b.length === 1 && b[0].types === 'text', JSON.stringify(b));

// 2. 글 있는 상자 /목차 → 상자는 그대로, 아래에
await fresh();
await page.keyboard.type('제목 글');
await page.keyboard.press('Enter');
await slash('목차');
b = await blocks();
check('글 있는 상자 /목차 → 상자 그대로 + 아래에 목차', b.length === 2 && b.some((x) => x.types === 'text') && b.some((x) => x.types === 'toc'), JSON.stringify(b));

// 3. 빈 상자 /2열 → 두 칸, 첫 칸에서 바로 쓰기
await fresh();
await slash('2열');
b = await blocks();
const editing = await ws(() => window.__dn.view.editingId);
check('빈 상자 /2열 → 칸 둘 (빈 상자 안 남음) · 첫 칸 편집 중', b.length === 2 && b.every((x) => x.types === 'text') && b.some((x) => x.id === editing), JSON.stringify(b));
await page.keyboard.type('왼쪽');
await wait(150);
check('첫 칸에 바로 글이 들어감', await ws((id) => JSON.stringify(window.__dn.view.engine.contentsOf(id)[0].doc).includes('왼쪽'), editing));

// 4. 화살표가 걸린 빈 상자는 지우지 않는다
await fresh();
await ws(() => {
  const v = window.__dn.view, e = v.engine, src = v.editingId;
  e.transact((tx) => { const o = tx.createBlock({ x: 2000, y: 2000, w: 200, h: 60 }); tx.createContent({ blockId: o, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '다른 상자' }] }] } }); tx.createArrow({ from: { blockId: src, side: 'auto' }, to: { blockId: o, side: 'auto' } }); }, { origin: 'user' });
});
await wait(200);
await slash('목차');
b = await blocks();
check('화살표가 걸린 빈 상자 → 지우지 않고 아래에', b.length === 3 && (await ws(() => [...window.__dn.view.engine.arrows()].length)) === 1, JSON.stringify(b));
check('콘솔 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close();
const bad = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
