// 표 열 머리 정렬 (워드 레이아웃 › 정렬): 머리 칸 정렬 단추 → 오름차순(숫자는 크기, 빈 칸은 뒤) → 다시 누르면 내림차순 · ↑ ↓ 표시,
// 실행 취소, 두 번 눌러도 이름 고치기가 아님, 문서 뷰에서도, 세로로 합친 칸이면 알림, 보기 전용이면 안 바뀜.
// 사용: dev 서버 실행 후 `node e2e/table-sort.mjs [스크린샷 폴더]`
import { chromium } from 'playwright-core';
import { fsPath } from './lib/fs-path.mjs';

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
const CORE = fsPath('packages/engine-core/src/index.ts');

await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(() => window.__dn.newNote({ sheet: null }));
await page.waitForFunction(() => window.__dn.view.engine.blockCount === 0);
const ids = await ws(async (CORE) => {
  const core = await import(CORE), v = window.__dn.view;
  const r = v.engine.transact((tx) => {
    const b = tx.createBlock({ x: 0, y: 0, w: 360, h: 200 });
    const c = tx.createContent({ blockId: b, type: 'table', ...core.makeTable(['이름', '점수'], [['다', '3'], ['가', ''], ['나', '10'], ['라', '3'], ['마', '2']]) });
    return { b, c };
  }, { origin: 'user' }).value;
  v.setCamera({ x: -100, y: -100, zoom: 1 });
  return r;
}, CORE);
await wait(500);
const names = (root = '') => page.locator(`${root} [data-part="${ids.c}"] td[data-col]`).evaluateAll((tds) => {
  const first = tds[0]?.dataset.col;
  return tds.filter((td) => td.dataset.col === first).map((td) => td.textContent.trim());
});
const th = (name, root = '') => page.locator(`${root} [data-part="${ids.c}"] th`, { hasText: name });

// 캔버스
await th('점수').hover();
await wait(150);
const btn = th('점수').locator('.dn-table-sort');
check('머리 칸에 마우스를 올리면 정렬 단추', await btn.isVisible() && !(await th('이름').locator('.dn-table-sort').isVisible()));
await btn.click();
await wait(300);
check('누르면 오름차순 (숫자는 크기 · 빈 칸은 뒤 · 같은 값은 원래 차례)', JSON.stringify(await names()) === JSON.stringify(['마', '다', '라', '나', '가']), JSON.stringify(await names()));
await page.mouse.move(700, 600);
await wait(150);
const on = th('점수').locator('.dn-table-sort.on');
check('정렬한 열은 ↑ 표시가 늘 보임 · 이름 고치기 안 열림', await on.isVisible() && (await page.locator('.dn-th-input').count()) === 0 && (await th('점수').innerText()).trim() === '점수');
await on.click();
await wait(300);
check('다시 누르면 내림차순', JSON.stringify(await names()) === JSON.stringify(['나', '다', '라', '마', '가']), JSON.stringify(await names()));
if (OUT) await page.screenshot({ path: `${OUT}/table-sort.png`, clip: { x: 0, y: 0, width: 700, height: 400 } });
await ws(() => window.__dn.view.engine.undo());
await wait(300);
check('실행 취소 → 오름차순으로', JSON.stringify(await names()) === JSON.stringify(['마', '다', '라', '나', '가']));
await th('점수').locator('.dn-table-sort').dblclick();
await wait(300);
check('정렬 단추를 두 번 눌러도 이름 고치기가 아님', (await page.locator('.dn-th-input').count()) === 0);
// 보기 전용
await ws(() => window.__dn.view.setReadOnly(true));
await wait(150);
const before = JSON.stringify(await names());
await th('이름').hover();
check('보기 전용: 정렬 안 한 열은 단추가 안 보임', !(await th('이름').locator('.dn-table-sort').isVisible()));
await th('점수').locator('.dn-table-sort').click({ force: true });
await wait(250);
check('보기 전용: 눌러도 안 바뀜', JSON.stringify(await names()) === before);
await ws(() => window.__dn.view.setReadOnly(false));

// 문서 뷰
await ws(() => window.__dn.setViewMode('doc'));
await wait(600);
await th('이름', '.dn-doc').hover();
await th('이름', '.dn-doc').locator('.dn-table-sort').click();
await wait(400);
check('문서 뷰: 이름 열 오름차순 (한글 순)', JSON.stringify(await names('.dn-doc')) === JSON.stringify(['가', '나', '다', '라', '마']), JSON.stringify(await names('.dn-doc')));
check('문서 뷰: 이름 고치기 · 칸 고치기가 열리지 않음', (await page.locator('.dn-doc .dn-th-input, .dn-doc .dn-cell-editing').count()) === 0);

// 세로로 합친 칸 → 알림
await ws(async ({ CORE, c }) => {
  const core = await import(CORE), e = window.__dn.view.engine, t = e.getContent(c), rows = core.sortedRows(t);
  core.mergeCells(e, c, { row: rows[0].id, col: t.columns[0].id }, { row: rows[1].id, col: t.columns[0].id });
}, { CORE, c: ids.c });
await wait(400);
await th('점수', '.dn-doc').hover();
await th('점수', '.dn-doc').locator('.dn-table-sort').click();
await wait(400);
const toast = await page.locator('.toast').allInnerTexts();
check('세로로 합친 칸이 있으면 정렬 안 하고 알림', toast.some((t) => t.includes('합친 칸')), JSON.stringify(toast));

check('콘솔 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close();
const bad = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
