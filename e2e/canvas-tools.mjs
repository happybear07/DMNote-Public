// 캔버스 도구 · 블록 메뉴 다듬기 (알파 테스트 2026-10-09): 화살표 도구는 한 번 이으면 고르기로(AT-013),
// 묶음 안 상자 하나만 Ctrl+D → 사본도 같은 묶음(AT-006), 상자 하나 메뉴에도 무엇의 메뉴인지 머리(AT-015),
// 데이터베이스 제목 줄로 끌기 · 누르면 제목 고치기(CQ-021).
// 사용: dev 서버 실행 후 `node e2e/canvas-tools.mjs [스크린샷 폴더]`
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

await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(() => window.__dn.newNote({ sheet: null }));
await page.waitForFunction(() => window.__dn.view.engine.blockCount === 0);
const ids = await ws(() => {
  const v = window.__dn.view, e = v.engine;
  const r = e.transact((tx) => {
    const mk = (x, y, text, group) => { const b = tx.createBlock({ x, y, w: 200, h: 50, ...(group ? { group } : {}) }); tx.createContent({ blockId: b, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } }); return b; };
    return { a: mk(0, 0, '첫 상자'), b: mk(400, 0, '둘째 상자'), c: mk(0, 200, '셋째 상자'), g1: mk(400, 200, '묶음 하나', 'g'), g2: mk(400, 280, '묶음 둘', 'g') };
  }, { origin: 'user' }).value;
  v.setCamera({ x: -100, y: -100, zoom: 1 });
  return r;
});
await wait(400);
const box = (id) => page.locator(`.dn-block[data-id="${id}"]`).boundingBox();
const tool = () => ws(() => window.__dn.view.tool);

// AT-013: 화살표 도구 → 두 상자 잇기 → 고르기 도구로
await page.locator('.canvas-host').click({ position: { x: 900, y: 650 } });
await page.keyboard.press('a');
const ba = await box(ids.a), bb = await box(ids.b);
await page.mouse.move(ba.x + ba.width / 2, ba.y + ba.height / 2);
await page.mouse.down();
await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps: 8 });
await page.mouse.up();
await wait(250);
const arrows = await ws(() => [...window.__dn.view.engine.arrows()].length);
check('화살표 도구로 이으면 화살표 하나 · 도구는 고르기로', arrows === 1 && (await tool()) === 'select', JSON.stringify({ arrows, tool: await tool() }));
// 이어서 상자를 누르면 고르기 (화살표가 시작되지 않음)
const bc = await box(ids.c);
await page.mouse.click(bc.x + 30, bc.y + 20);
await wait(200);
check('… 이어서 상자를 누르면 그 상자를 고름', JSON.stringify(await ws(() => [...window.__dn.view.selBlocks])) === JSON.stringify([ids.c]));

// AT-006: 묶음 안 상자 하나만 Ctrl+D → 사본도 같은 묶음 (상자 하나짜리 새 묶음 아님)
const bg = await box(ids.g1);
await page.mouse.click(bg.x + 30, bg.y + 20);
await wait(150);
await page.keyboard.press('Control+d');
await wait(300);
const grp = await ws(() => { const e = window.__dn.view.engine; const out = {}; for (const b of e.blocks()) if (b.group) out[b.group] = (out[b.group] ?? 0) + 1; return out; });
check('묶음 안 상자 하나만 Ctrl+D → 사본도 같은 묶음 (묶음 하나, 상자 셋)', JSON.stringify(grp) === '{"g":3}', JSON.stringify(grp));

// AT-015: 상자 하나 메뉴에도 무엇의 메뉴인지 머리 (첫 글줄)
await page.keyboard.press('Escape');
const bb2 = await box(ids.b);
await page.mouse.click(bb2.x + 30, bb2.y + 20, { button: 'right' });
await wait(250);
const head = await page.locator('.menu[aria-label="블록 메뉴"] .menu-head').first().innerText().catch(() => '');
check('상자 하나 오른쪽 클릭 메뉴 머리: 그 상자의 첫 글줄', head.includes('둘째 상자'), head);
if (OUT) await page.screenshot({ path: `${OUT}/canvas-tools-menu.png` });
await page.keyboard.press('Escape');
await wait(150);
// 사이드바 가까운 상자: 메뉴가 길어도 사이드바 위로 밀려 뜨지 않음 (AT-015)
const ba2 = await box(ids.a);
await page.mouse.click(ba2.x + 20, ba2.y + 20, { button: 'right' });
await wait(250);
const mr = await page.locator('.menu[aria-label="블록 메뉴"]').boundingBox();
const mainLeft = await ws(() => document.querySelector('.main').getBoundingClientRect().left);
check('사이드바 가까운 상자 메뉴는 사이드바를 덮지 않고 화면 안에', !!mr && mr.x >= mainLeft && mr.y >= 0 && mr.y + mr.height <= 800 + 1, JSON.stringify({ mr, mainLeft }));
await page.keyboard.press('Escape');

// CQ-021: 데이터베이스 제목 줄을 끌면 블록이 옮겨지고, 그냥 누르면 제목 고치기
const dbId = await ws(async (DOM) => { const dom = await import(DOM); return dom.insertBlock(window.__dn.view, 'database', { at: { x: 0, y: 500 } }); }, fsPath('packages/engine-dom/src/index.ts'));
await wait(500);
await page.keyboard.press('Escape');
await page.mouse.click(1150, 120);
await wait(150);
const dbPos = () => ws((id) => { const b = window.__dn.view.engine.getBlock(id); return [b.x, b.y]; }, dbId);
const p0 = await dbPos();
const tt = await page.locator(`.dn-block[data-id="${dbId}"] .dn-db-title`).boundingBox();
await page.mouse.move(tt.x + tt.width - 40, tt.y + tt.height / 2);
await page.mouse.down();
await page.mouse.move(tt.x + tt.width + 40, tt.y + tt.height / 2 + 60, { steps: 8 });
await page.mouse.up();
await wait(250);
const p1 = await dbPos();
check('데이터베이스 제목 줄을 끌면 블록이 옮겨짐', p1[0] !== p0[0] || p1[1] !== p0[1], JSON.stringify({ p0, p1 }));
const tt2 = await page.locator(`.dn-block[data-id="${dbId}"] .dn-db-title`).boundingBox();
await page.mouse.click(tt2.x + 30, tt2.y + tt2.height / 2);
await wait(200);
await page.keyboard.type('X');
const focused0 = await ws(() => document.activeElement?.classList.contains('dn-db-title'));
await page.keyboard.press('Enter'); // 제목은 바꾼 뒤(change) 저장
await wait(300);
const focused = await ws(() => document.activeElement?.classList.contains('dn-db-title'));
const dbTitleNow = await ws((id) => window.__dn.view.engine.contentsOf(id)[0]?.title ?? '', dbId);
check('… 그냥 누르면 제목 칸에 커서 · 친 글이 제목에', focused0 && String(dbTitleNow).endsWith('X'), JSON.stringify({ focused0, focused, dbTitleNow }));

check('콘솔 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close();
const bad = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
