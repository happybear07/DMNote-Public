// 표 칸 합치기 · 나누기 (워드 셀 병합): 칸을 고치는 중 Shift+클릭 → 사각형 고르기 → '칸 합치기' → rowspan · colspan,
// Tab은 덮인 칸을 건너뜀, '칸 나누기'로 되돌림 — 캔버스와 문서 뷰 모두, 실행 취소 한 번.
// 사용: dev 서버 실행 후 `node e2e/table-merge.mjs [스크린샷 폴더]`
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
const tool = (label, root = '') => page.locator(`${root} .dn-table-tools button`, { hasText: label });
const cell = (r, c, root = '.dn-canvas') => page.locator(`${root} .dn-table td[data-row="r${r}"][data-col="c${c}"]`);
const merges = () => ws(() => [...window.__dn.view.engine.contents()].find((c) => c.type === 'table')?.merges ?? null);

await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(() => window.__dn.newNote());
await wait(300);
await ws(() => {
  const p = (t) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });
  const columns = [0, 1, 2].map((i) => ({ id: `c${i}`, name: `열${i}` }));
  const rows = [0, 1, 2].map((r) => ({ id: `r${r}`, order: `a${r}`, cells: Object.fromEntries(columns.map((c, i) => [c.id, p(`${'가나다'[r]}${i}`)])) }));
  window.__dn.view.engine.transact((tx) => { const b = tx.createBlock({ x: 0, y: 0, w: 360, h: 140 }); tx.createContent({ blockId: b, type: 'table', columns, rows }); }, { origin: 'user' });
  window.__dn.view.fit?.();
});
await wait(500);

// ── 캔버스 ──
await cell(0, 0).dblclick();
await wait(300);
check('칸 편집 중 — 합치기는 꺼져 있음 · 나누기도 꺼짐', (await tool('칸 합치기').isDisabled()) && (await tool('칸 나누기').isDisabled()));
await cell(1, 1).click({ modifiers: ['Shift'] });
await wait(200);
check('Shift+클릭 → 2×2 고름 · 합치기 켜짐', (await page.locator('.dn-canvas td.dn-cell-sel').count()) === 4 && !(await tool('칸 합치기').isDisabled()));
await tool('칸 합치기').click();
await wait(400);
const anchor = cell(0, 0);
check('칸 합치기 → rowspan 2 · colspan 2, 칸 9 → 6', (await anchor.getAttribute('rowspan')) === '2' && (await anchor.getAttribute('colspan')) === '2' && (await page.locator('.dn-canvas .dn-table td').count()) === 6);
check('글은 왼쪽 위 칸으로 모임', (await anchor.innerText()).trim() === '가0 가1 나0 나1', await anchor.innerText());
check('합친 칸을 다시 고치는 중 · 나누기 켜짐', (await anchor.evaluate((td) => td.classList.contains('dn-cell-editing'))) && !(await tool('칸 나누기').isDisabled()));
if (OUT) await page.screenshot({ path: `${OUT}/table-merge-canvas.png` });
await page.keyboard.press('Tab');
await wait(300);
check('Tab → 덮인 칸을 건너뛰고 옆 칸(가2)으로', await cell(0, 2).evaluate((td) => td.classList.contains('dn-cell-editing')));
await page.keyboard.press('Tab');
await wait(300);
check('다음 줄에서도 덮인 칸을 건너뜀 (나2)', await cell(1, 2).evaluate((td) => td.classList.contains('dn-cell-editing')));
await cell(0, 0).click();
await wait(300);
check('고치는 중 다른 칸을 한 번 누르면 그 칸으로 (편집이 끝나지 않음)', await cell(0, 0).evaluate((td) => td.classList.contains('dn-cell-editing')));
await tool('칸 나누기').click();
await wait(400);
check('칸 나누기 → 칸 9개로', (await page.locator('.dn-canvas .dn-table td').count()) === 9 && (await merges()) === null);
await ws(() => window.__dn.view.endEditing());
await ws(() => window.__dn.view.engine.undo());
await wait(300);
check('실행 취소 → 다시 합친 칸', (await merges())?.length === 1);
await ws(() => window.__dn.view.engine.undo());
await wait(300);
check('한 번 더 → 합치기 전 (글도 그대로)', (await merges()) === null && (await cell(1, 1).innerText()).trim() === '나1');

// ── 문서 뷰 ──
await ws(() => window.__dn.setViewMode('doc'));
await wait(700);
await cell(0, 0, '.dn-doc').click();
await wait(300);
await cell(0, 2, '.dn-doc').click({ modifiers: ['Shift'] });
await wait(200);
check('문서 뷰 Shift+클릭 → 한 줄 3칸 고름', (await page.locator('.dn-doc td.dn-cell-sel').count()) === 3);
await tool('칸 합치기', '.dn-doc').click();
await wait(400);
check('문서 뷰 칸 합치기 → colspan 3', (await cell(0, 0, '.dn-doc').getAttribute('colspan')) === '3' && (await merges())?.length === 1);
if (OUT) await page.screenshot({ path: `${OUT}/table-merge-doc.png` });
await tool('칸 나누기', '.dn-doc').click();
await wait(400);
check('문서 뷰 칸 나누기', (await merges()) === null && (await page.locator('.dn-doc .dn-table td').count()) === 9);
check('콘솔 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close();
const bad = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
