// 그림 · 표 캡션 (워드 캡션 삽입): 블록 메뉴 › 캡션 달기 → 입력 → '표 1. …'(표 위) · '그림 1. …'(그림 아래), 번호는 문서 차례로,
// 캡션을 눌러 고치기 · 비우면 지움, 문서 뷰에서도 · Markdown 내보내기.
// 사용: dev 서버 실행 후 `node e2e/captions.mjs [스크린샷 폴더]`
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
  const r = v.engine.transact((tx) => {
    const t = tx.createBlock({ x: 0, y: 0, w: 320, h: 90 }); tx.createContent({ blockId: t, type: 'table', columns: [{ id: 'c1', name: '항목' }, { id: 'c2', name: '값' }], rows: [{ id: 'r1', order: 'a0', cells: {} }] });
    const g = tx.createBlock({ x: 0, y: 200, w: 320, h: 220 }); tx.createContent({ blockId: g, type: 'chart', kind: 'bar', series: [{ id: 's', name: '계열', points: [{ x: 'a', y: 2 }, { x: 'b', y: 4 }] }] });
    return { t, g };
  }, { origin: 'user' });
  v.fit?.(true);
  return r.value;
});
await wait(600);
const caption = async (id, text) => {
  await ws((id) => { const v = window.__dn.view; v.select([id]); const r = v.mounted.get(id).el.getBoundingClientRect(); v.onBlockMenu?.({ ids: [id], x: r.left + 10, y: r.top + 10 }); }, id);
  await wait(250);
  await page.locator('.menu button', { hasText: '캡션 달기' }).click();
  await wait(200);
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await wait(350);
};
await caption(ids.t, '조사 결과');
await caption(ids.g, '월별 추이');
const caps = await ws((ids) => [ids.t, ids.g].map((id) => { const el = window.__dn.view.mounted.get(id).el, c = el.querySelector(':scope > .dn-caption'); return c ? { text: c.textContent, first: el.firstElementChild === c, last: el.lastElementChild === c } : null; }), ids);
check('캔버스: 표 위 "표 1. 조사 결과" · 그래프 아래 "그림 1. 월별 추이"', caps[0]?.text === '표 1. 조사 결과' && caps[0].first && caps[1]?.text === '그림 1. 월별 추이' && caps[1].last, JSON.stringify(caps));
if (OUT) await page.screenshot({ path: `${OUT}/captions-canvas.png` });
// 캡션을 눌러 고치기
await page.locator(`.dn-block[data-id="${ids.g}"] .dn-caption`).click();
await wait(200);
await page.keyboard.press('Control+a');
await page.keyboard.type('월별 매출 추이');
await page.keyboard.press('Enter');
await wait(300);
check('캡션을 눌러 고치기', (await ws((id) => window.__dn.view.engine.getBlock(id).caption, ids.g)) === '월별 매출 추이');
// 문서 뷰
await ws(() => window.__dn.setViewMode('doc'));
await wait(600);
const docCaps = await page.locator('.dn-doc .dn-caption').allInnerTexts();
check('문서 뷰에도 캡션 (차례대로)', JSON.stringify(docCaps) === JSON.stringify(['표 1. 조사 결과', '그림 1. 월별 매출 추이']), JSON.stringify(docCaps));
if (OUT) await page.screenshot({ path: `${OUT}/captions-doc.png` });
// 비우면 지움
await page.locator('.dn-doc .dn-caption').first().click();
await wait(200);
await page.keyboard.press('Control+a');
await page.keyboard.press('Backspace');
await page.keyboard.press('Enter');
await wait(400);
check('비우고 Enter → 캡션 지움', (await ws((id) => window.__dn.view.engine.getBlock(id).caption ?? null, ids.t)) === null && (await page.locator('.dn-doc .dn-caption').count()) === 1);
// Markdown 내보내기
const md = await ws(async () => {
  const m = await import('/src/export.ts'), t = Date.now();
  return m.noteToMarkdown(window.__dn.view.engine, { id: 'n', title: '캡션', createdAt: t, updatedAt: t }, { noteTitle: () => null });
}).catch((e) => `ERR ${e}`);
check('Markdown: 그래프 아래 캡션 줄 · 지운 표 캡션은 없음', md.includes('*그림 1. 월별 매출 추이*') && !md.includes('*표 1.'), md.slice(0, 300));
check('콘솔 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close();
const bad = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
