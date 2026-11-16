// 표 머리 켜고 끄기 (노션 단순 표 · 워드 표 스타일): 블록 메뉴 › 머리 행(열 이름 줄) · 머리 열(첫 열) — 캔버스 · 문서 뷰, 실행 취소,
// 머리 행을 꺼도 칸 고치기는 그대로.
// 사용: dev 서버 실행 후 `node e2e/table-head.mjs [스크린샷 폴더]`
import { chromium } from 'playwright-core';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2];
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
await ws(() => window.__dn.newNote({ sheet: null }));
await page.waitForFunction(() => window.__dn.view.engine.blockCount === 0);
const ids = await ws(() => {
  const v = window.__dn.view;
  const cell = (t) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });
  const r = v.engine.transact((tx) => {
    const b = tx.createBlock({ x: 0, y: 0, w: 360, h: 120 });
    const c = tx.createContent({ blockId: b, type: 'table', columns: [{ id: 'c1', name: '항목' }, { id: 'c2', name: '값' }], rows: [{ id: 'r1', order: 'a0', cells: { c1: cell('사과'), c2: cell('3') } }, { id: 'r2', order: 'a1', cells: { c1: cell('배'), c2: cell('5') } }] });
    return { b, c };
  }, { origin: 'user' });
  v.setCamera({ x: -100, y: -100, zoom: 1 });
  return r.value;
});
await wait(500);
const tbl = `.dn-block[data-id="${ids.b}"] table`;
const state = (root) => ws((sel) => { const t = document.querySelector(sel); return t ? { head: !!t.querySelector('thead'), hcol: [...t.querySelectorAll('td.dn-td-head')].map((x) => x.textContent), w: getComputedStyle(t.querySelector('tbody td')).fontWeight } : null; }, root);
const menu = async () => {
  await ws((id) => { const v = window.__dn.view; v.select([id]); const r = v.mounted.get(id).el.getBoundingClientRect(); v.onBlockMenu?.({ ids: [id], x: r.left + 10, y: r.top + 10 }); }, ids.b);
  await wait(250);
  await page.locator('.menu-sub > button', { hasText: '표' }).click(); // 머리 행 · 열은 '표 ▸' 안 (DS-001)
  await wait(100);
};
const item = (t) => page.locator('.menu [role="menuitemcheckbox"]', { hasText: t });

await menu();
check('표 블록 메뉴: 머리 행 켬 · 머리 열 끔', (await item('머리 행').getAttribute('aria-checked')) === 'true' && (await item('머리 열').getAttribute('aria-checked')) === 'false');
await item('머리 행').click();
await wait(300);
let s = await state(tbl);
check('머리 행 끄기 → 열 이름 줄 없음 (캔버스)', s && !s.head, JSON.stringify(s));
await menu();
await item('머리 열').click();
await wait(300);
s = await state(tbl);
check("머리 열 켜기 → 첫 열 칸이 머리 모양 ('사과' · '배', 굵게)", s && JSON.stringify(s.hcol) === '["사과","배"]' && Number(s.w) >= 600, JSON.stringify(s));
if (OUT) await page.screenshot({ path: `${OUT}/table-head.png` });

// 머리 행이 없어도 칸 고치기
const td = page.locator(`${tbl} td[data-col="c2"]`).first();
await td.dblclick();
await wait(250);
await page.keyboard.press('End');
await page.keyboard.type('0');
await page.keyboard.press('Escape');
await wait(300);
const v1 = await ws((c) => JSON.stringify(window.__dn.view.engine.getContent(c).rows.find((r) => r.id === 'r1').cells.c2), ids.c);
check('머리 행이 없어도 칸 고치기 (3 → 30)', v1.includes('"30"'), v1);

// 문서 뷰에도 같게
await ws(() => window.__dn.setViewMode('doc'));
await wait(600);
s = await state('.dn-doc table');
check('문서 뷰도 머리 행 없음 · 첫 열 머리', s && !s.head && s.hcol.length === 2, JSON.stringify(s));
await page.locator('.dn-doc table td').first().click({ button: 'right' });
await wait(250);
await page.locator('.menu-sub > button', { hasText: '표' }).click(); // '표 ▸' 하위 메뉴 (DS-001)
await item('머리 행').click();
await wait(300);
s = await state('.dn-doc table');
check('문서 뷰 메뉴로 머리 행 다시 켜기', s && s.head, JSON.stringify(s));
await page.keyboard.press('Control+z');
await wait(300);
s = await state('.dn-doc table');
check('실행 취소 → 머리 행 다시 꺼짐', s && !s.head, JSON.stringify(s));

check('콘솔 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close();
const bad = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
