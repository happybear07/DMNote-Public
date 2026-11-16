// 블록(묶음) 이름표: 이름 없는 블록은 '블록'(첫 제목을 또 쓰지 않음 — 같은 글이 두 번 겹쳐 보이던 것), 위쪽 다른 상자를 덮으면 평소에는 숨김,
// 블록을 고르면 보임. 100% · 50%에서 위 제목 상자가 가려지지 않는지 (예시 노트 'AI 구조화 흐름' 모양).
// 사용: dev 서버 실행 후 `node e2e/group-tag.mjs [스크린샷 폴더]`
import { chromium } from 'playwright-core';
import { fsPath } from './lib/fs-path.mjs';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2];
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const browser = await chromium.launch({ channel: process.env.DN_CHANNEL ?? 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(() => localStorage.setItem('dn:no-env-key', '1'));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });
const ws = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
const CORE = fsPath('packages/engine-core/src/index.ts');

await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(() => window.__dn.newNote({ sheet: null }));
await page.waitForFunction(() => window.__dn.view.engine.blockCount === 0);
const ids = await ws(async (CORE) => {
  const core = await import(CORE), v = window.__dn.view, e = v.engine;
  const P = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] });
  const r = e.transact((tx) => {
    const mk = (x, y, w, role, content) => { const b = tx.createBlock({ x, y, w, h: 50 }); tx.createContent({ blockId: b, type: 'text', role, doc: { type: 'doc', content } }); return b; };
    const head = mk(120, 24, 320, 'title', [P('AI 구조화 흐름')]);
    const a = mk(120, 90, 300, 'body', [{ type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: '구조 분석 파이프라인' }] }, P('붙여넣은 텍스트를 나눠 처리한다.')]);
    const b = mk(120, 280, 260, 'body', [P('프롬프트 구성')]);
    return { head, a, b };
  }, { origin: 'user' }).value;
  core.groupBlocks(e, [r.a, r.b]);
  v.setCamera({ x: 0, y: 0, zoom: 1 });
  return r;
}, CORE);
await wait(500);
const tagSpot = () => ws((id) => { const v = window.__dn.view, b = v.engine.getBlock(id), o = v.root.getBoundingClientRect(), c = v.camera; return { x: o.left + (b.x - c.x) * c.zoom - 8 + 12, y: o.top + (b.y - c.y) * c.zoom - 8 - 10 }; }, ids.a);
const sel = () => ws(() => [...window.__dn.view.selBlocks].sort());
// 이름표 자리를 누르면: 숨었으므로 블록을 고르지 않는다
let s = await tagSpot();
await page.mouse.move(900, 600);
await page.mouse.click(s.x, s.y);
await wait(200);
check('위 상자를 덮는 이름표는 평소 숨김 (그 자리를 눌러도 블록이 골라지지 않음)', !(await sel()).includes(ids.a), JSON.stringify(await sel()));
if (OUT) await page.screenshot({ path: `${OUT}/group-tag-100.png`, clip: { x: 240, y: 40, width: 560, height: 420 } });
// 블록을 고르면 이름표 '블록' (첫 제목을 또 쓰지 않음)
await ws((g) => window.__dn.view.select(g), [ids.a, ids.b]);
await wait(200);
if (OUT) await page.screenshot({ path: `${OUT}/group-tag-selected.png`, clip: { x: 240, y: 40, width: 560, height: 420 } });
s = await tagSpot();
await page.mouse.click(s.x, s.y, { button: 'right' });
await wait(250);
check('고른 블록은 이름표가 보이고 오른쪽 클릭하면 묶음 메뉴', await page.locator('.menu[aria-label="블록 메뉴"]').isVisible() && (await page.locator('.menu[aria-label="블록 메뉴"] .menu-head').first().innerText()).startsWith('블록'));
await page.keyboard.press('Escape');
await ws(() => window.__dn.view.select([]));
// 50%: 위 제목 상자가 가려지지 않음 (제목 상자 위에 다른 그림이 덮이지 않았는지 — 이름표 칸에 묶음 이름표가 없는지)
await ws(() => window.__dn.view.setCamera({ x: 0, y: 0, zoom: 0.5 }));
await wait(300);
await page.mouse.move(900, 600);
await wait(150);
if (OUT) await page.screenshot({ path: `${OUT}/group-tag-50.png`, clip: { x: 240, y: 40, width: 400, height: 260 } });
s = await tagSpot();
await page.mouse.click(s.x, s.y);
await wait(200);
check('50%에서도 이름표가 위 상자를 덮지 않음', !(await sel()).includes(ids.a), JSON.stringify(await sel()));
check('콘솔 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close();
const bad = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
