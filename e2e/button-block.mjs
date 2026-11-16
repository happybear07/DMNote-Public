// 버튼 블록 (GAP #17 — 노션 /button의 '블록 넣기'): 블록 메뉴 › 이 상자들로 버튼 만들기 → 누르면 그 상자들(사이 화살표째)이
// 버튼 바로 아래에 새로(아래 상자는 내림), 한 번 더 누르면 또 바로 아래에, 실행 취소 한 번에 빠짐. ⋯에서 이름 · 넣을 내용 바꾸기,
// /버튼은 빈 할 일 한 줄, 문서 뷰에서도 누르면 바로 뒤에, Markdown에는 버튼이 나오지 않음, 읽기 모드에서는 못 누름.
// 사용: dev 서버 실행 후 `node e2e/button-block.mjs [스크린샷 폴더]`
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
/** 위에서 아래로: 버튼은 'B:이름', 글은 첫 글자 */
const layout = () => ws(() => {
  const e = window.__dn.view.engine;
  return [...e.blocks()].sort((a, b) => a.y - b.y || a.x - b.x).map((b) => { const c = e.contentsOf(b.id)[0]; return c?.type === 'button' ? `B:${c.label}` : JSON.stringify(c?.doc ?? '').match(/"text":"([^"]*)"/)?.[1] ?? (JSON.stringify(c?.doc ?? '').includes('task_item') ? '[할 일]' : c?.type); });
});
const arrows = () => ws(() => [...window.__dn.view.engine.arrows()].length);
const overlaps = () => ws(() => { const bs = [...window.__dn.view.engine.blocks()]; let n = 0; for (const a of bs) for (const b of bs) if (a.id < b.id && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) n++; return n; });

await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(() => window.__dn.newNote({ sheet: null }));
await page.waitForFunction(() => window.__dn.view.engine.blockCount === 0);
const ids = await ws((ps) => {
  const v = window.__dn.view, e = v.engine;
  const r = e.transact((tx) => {
    const mk = (y, p, role = 'body') => { const b = tx.createBlock({ x: 100, y, w: 300, h: 50 }); tx.createContent({ blockId: b, type: 'text', role, doc: { type: 'doc', content: [p] } }); return b; };
    const a = mk(60, ps[0], 'title'), b = mk(150, ps[1]), c = mk(260, ps[2]);
    tx.createArrow({ from: { blockId: a, side: 'auto' }, to: { blockId: b, side: 'auto' } });
    return { a, b, c };
  }, { origin: 'user' }).value;
  v.setCamera({ x: 0, y: 0, zoom: 1 });
  return r;
}, [P('주간 회의'), P('안건'), P('맨 아래 상자')]);
await wait(400);

// 1) 고른 상자로 버튼 만들기
await ws((ids) => window.__dn.view.select([ids.a, ids.b]), ids);
const rb = await ws((id) => { const r = window.__dn.view.mounted.get(id).el.getBoundingClientRect(); return { x: r.left + 60, y: r.top + 20 }; }, ids.b);
await page.mouse.click(rb.x, rb.y, { button: 'right', modifiers: [] });
await wait(150);
// 오른쪽 클릭이 하나만 고르면 메뉴로 다시 둘 다 고른 요청을 보낸다
const menuIds = await ws(() => window.__dn.state.blockMenu?.ids?.length ?? 0);
if (menuIds !== 2) { await page.keyboard.press('Escape'); await ws((ids) => { const v = window.__dn.view; v.select([ids.a, ids.b]); v.host.onBlockMenu({ ids: [ids.a, ids.b], x: 600, y: 300 }); }, ids); await wait(150); }
await page.locator('.menu[aria-label="블록 메뉴"] button', { hasText: '이 상자들로 버튼 만들기' }).click();
await wait(400);
let L = await layout();
check('버튼이 고른 상자 바로 아래에 (맨 아래 상자는 내림)', JSON.stringify(L) === '["주간 회의","안건","B:버튼","맨 아래 상자"]' && (await overlaps()) === 0, JSON.stringify(L));

// 2) 누르기 → 바로 아래에 두 상자 + 사이 화살표, 새 상자를 고름
await page.locator('.dn-btn-press').first().click();
await wait(400);
L = await layout();
check('누르면 바로 아래에 두 상자 · 사이 화살표째', JSON.stringify(L) === '["주간 회의","안건","B:버튼","주간 회의","안건","맨 아래 상자"]' && (await arrows()) === 2 && (await overlaps()) === 0, `${JSON.stringify(L)} 화살표 ${await arrows()}`);
check('… 새 상자를 고름', (await ws(() => window.__dn.view.selectedBlocks.length)) === 2);
await page.locator('.dn-btn-press').first().click();
await wait(400);
check('한 번 더 → 또 버튼 바로 아래에 (전 것은 내려감)', (await layout()).length === 8 && (await arrows()) === 3 && (await overlaps()) === 0, JSON.stringify(await layout()));
await ws(() => window.__dn.view.engine.undo());
await wait(250);
check('실행 취소 한 번에 마지막 누름이 빠짐', (await layout()).length === 6 && (await arrows()) === 2);
await page.screenshot({ path: `${OUT}/button-pressed.png` });

// 3) ⋯ 고치기: 이름 · 넣을 내용 바꾸기(고른 상자)
await ws((ids) => window.__dn.view.select([ids.c]), ids);
await page.locator('.dn-button').first().hover();
await page.locator('.dn-btn-edit').first().click();
const pop = page.locator('.dn-db-pop[aria-label="버튼 고치기"]');
check('⋯ → 이름 · 넣는 것(상자 2개 — 주간 회의)', (await pop.innerText()).includes('상자 2개 — 주간 회의'), await pop.innerText());
await pop.locator('input').fill('회의 추가');
await pop.locator('input').press('Enter');
await wait(200);
check('이름 바꾸기', (await page.locator('.dn-btn-press').first().innerText()).includes('회의 추가'));
await page.locator('.dn-btn-edit').first().click();
await pop.locator('.dn-db-mi', { hasText: '지금 고른 상자 1개로 바꾸기' }).click();
await wait(200);
check('고른 상자로 넣을 내용 바꾸기', (await pop.innerText()).includes('상자 1개 — 맨 아래 상자'), await pop.innerText());
await page.keyboard.press('Escape');

// 4) /버튼 → 빈 할 일 한 줄
await ws((id) => { const v = window.__dn.view; v.select([]); }, null);
await page.evaluate(() => window.__dn.view.setTool('block'));
await page.mouse.click(900, 200);
await wait(250);
await page.keyboard.type('/버튼');
await wait(250);
check('슬래시 메뉴에 버튼', (await page.locator('.dn-slash-item b').first().innerText()) === '버튼');
await page.keyboard.press('Enter');
await wait(400);
const nb = await ws(() => { const e = window.__dn.view.engine; return [...e.blocks()].filter((b) => e.contentsOf(b.id)[0]?.type === 'button').length; });
check('/버튼 → 버튼 블록 (빈 글 상자는 남지 않음)', nb === 2 && (await layout()).filter((x) => x === undefined || x === 'text').length === 0, JSON.stringify(await layout()));
await page.locator('.dn-btn-press', { hasText: '버튼' }).click();
await wait(300);
check('… 누르면 할 일 한 줄', (await layout()).includes('[할 일]'), JSON.stringify(await layout()));

// 5) 문서 뷰: 버튼 그대로, 누르면 바로 뒤에
await ws(() => window.__dn.setViewMode('doc'));
await wait(700);
const docBtn = page.locator('.dn-doc .dn-btn-press', { hasText: '회의 추가' });
check('문서 뷰에 버튼', (await docBtn.count()) === 1);
const before = await page.locator('.dn-doc .dn-doc-item').count();
await docBtn.click();
await wait(500);
const items = await page.locator('.dn-doc .dn-doc-item').allInnerTexts();
const bi = items.findIndex((t) => t.includes('회의 추가'));
check('문서 뷰에서 누르면 버튼 바로 뒤에', items.length === before + 1 && items[bi + 1]?.includes('맨 아래 상자'), JSON.stringify(items.map((t) => t.slice(0, 12))));
await ws(() => window.__dn.setViewMode('canvas'));
await wait(300);

// 6) Markdown에는 버튼이 없음 · 읽기 모드는 못 누름
const md = await ws(() => window.__dn.noteMarkdown(window.__dn.state.currentId));
check('Markdown에 버튼 없음', !md.includes('회의 추가') && !md.includes('내보낼 수 없는'), md.slice(0, 160));
await ws(() => window.__dn.setReadMode(true));
await wait(300);
const n0 = (await layout()).length;
await page.locator('.dn-btn-press').first().click();
await wait(300);
check('읽기 모드: 눌러도 안 넣음 · ⋯ 안 보임', (await layout()).length === n0 && !(await page.locator('.dn-btn-edit').first().isVisible()));
await ws(() => window.__dn.setReadMode(false));

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
