// 고칠 때와 볼 때 같은 모양 (10-13 사용자 보고): 글을 눌러 고치기 시작해도 글자 크기 · 굵기 · 자리가 그대로(캔버스 제목 · 내용 상자, 문서 뷰 제목 · 본문),
// 표 칸 · 머리 칸을 고치기 시작해도 표가 밑으로 밀리지 않음(도구 줄은 표 위에 떠 있다) · 고치는 칸의 글자 · 높이 그대로.
// 사용: dev 서버 실행 후 `node e2e/edit-same-look.mjs [스크린샷 폴더]`
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

await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(() => window.__dn.newNote({ sheet: null }));
await page.waitForFunction(() => window.__dn.view.engine.blockCount === 0);
const ids = await ws(() => {
  const v = window.__dn.view, e = v.engine;
  const P = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] });
  const r = e.transact((tx) => {
    const t = tx.createBlock({ x: 100, y: 40, w: 360, h: 50 }); tx.createContent({ blockId: t, type: 'text', role: 'title', doc: { type: 'doc', content: [P('제목 상자 글')] } });
    const b = tx.createBlock({ x: 100, y: 130, w: 360, h: 80 }); tx.createContent({ blockId: b, type: 'text', role: 'body', doc: { type: 'doc', content: [P('내용 상자 첫 줄'), { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '제목 2' }] }, { type: 'bullet_list', content: [{ type: 'list_item', content: [P('목록')] }] }] } });
    const tb = tx.createBlock({ x: 100, y: 330, w: 360, h: 120 });
    tx.createContent({ blockId: tb, type: 'table', columns: [{ id: 'c1', name: '이름' }, { id: 'c2', name: '값' }], rows: [{ id: 'r1', order: 'a0', cells: { c1: { type: 'doc', content: [P('가')] }, c2: { type: 'doc', content: [P('1')] } } }, { id: 'r2', order: 'a1', cells: { c1: { type: 'doc', content: [P('나')] }, c2: { type: 'doc', content: [P('2')] } } }] });
    return { t, b, tb };
  }, { origin: 'user' }).value;
  v.setCamera({ x: 0, y: 0, zoom: 1 });
  return r;
}, null);
await wait(500);
/** 글자 조각마다 크기 · 굵기 · 자리 (도구 줄 단추는 빼고) */
const look = (sel) => page.evaluate((sel) => {
  const root = document.querySelector(sel);
  const out = [];
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = w.nextNode())) {
    if (!n.nodeValue.trim() || n.parentElement.closest('.dn-table-tools')) continue;
    const r = document.createRange(); r.selectNodeContents(n); const b = r.getBoundingClientRect();
    const cs = getComputedStyle(n.parentElement);
    out.push(`${n.nodeValue}|${cs.fontSize}|${cs.fontWeight}|${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.height)}`);
  }
  return out.join(' / ');
}, sel);
const blk = (id) => `.dn-block[data-id="${id}"]`;

// 캔버스 글 상자
for (const [k, name] of [['t', '제목 상자'], ['b', '내용 상자']]) {
  const before = await look(blk(ids[k]));
  const r = await page.locator(blk(ids[k])).boundingBox();
  await page.mouse.dblclick(r.x + 40, r.y + 18);
  await wait(300);
  const during = await look(blk(ids[k]));
  check(`캔버스 ${name}: 고칠 때 글자 · 자리 그대로`, before === during && (await page.locator(`${blk(ids[k])} .dn-text-editing`).count()) === 1, `${before}  ≠  ${during}`);
  await page.keyboard.press('Escape'); await wait(150);
  await ws(() => window.__dn.view.select([]));
}
// 캔버스 표 칸 · 머리 칸
const tableLook = () => look(blk(ids.tb));
let before = await tableLook();
await page.locator(`${blk(ids.tb)} td[data-row="r1"][data-col="c1"]`).dblclick();
await wait(300);
check('캔버스 표 칸: 고칠 때 표가 밀리지 않음 · 칸 글자 그대로', before === await tableLook() && (await page.locator(`${blk(ids.tb)} .dn-table-tools`).count()) === 1, `${before}  ≠  ${await tableLook()}`);
const tools = await page.locator(`${blk(ids.tb)} .dn-table-tools`).boundingBox(), box = await page.locator(blk(ids.tb)).boundingBox();
check('… 도구 줄은 상자 위에 떠 있다 (상자 테두리 밖)', tools.y + tools.height <= box.y, JSON.stringify({ tools, box }));
await page.screenshot({ path: `${OUT}/edit-same-canvas-table.png` });
await page.keyboard.press('Escape'); await wait(150);
before = await tableLook();
await page.locator(`${blk(ids.tb)} th[data-col="c1"]`).dblclick();
await wait(300);
const thDuring = await page.locator(`${blk(ids.tb)} td[data-row="r1"][data-col="c1"]`).boundingBox();
await page.keyboard.press('Escape'); await wait(150);
const thAfter = await page.locator(`${blk(ids.tb)} td[data-row="r1"][data-col="c1"]`).boundingBox();
check('캔버스 머리 칸: 고칠 때 아래 칸이 밀리지 않음', thDuring.y === thAfter.y && thDuring.height === thAfter.height, JSON.stringify({ thDuring, thAfter }));

// 문서 뷰
await ws(() => window.__dn.setViewMode('doc'));
await wait(800);
const item = (id) => `.dn-doc .dn-doc-item[data-id="${id}"]`;
for (const [k, name] of [['t', '제목'], ['b', '본문']]) {
  const b0 = await look(item(ids[k]));
  const r = await page.locator(item(ids[k])).boundingBox();
  await page.mouse.click(r.x + 30, r.y + 12);
  await wait(300);
  const b1 = await look(item(ids[k]));
  check(`문서 뷰 ${name}: 고칠 때 글자 크기 · 자리 그대로`, b0 === b1 && (await page.locator(`${item(ids[k])} .dn-text-editing`).count()) === 1, `${b0}  ≠  ${b1}`);
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await wait(150);
}
const dt0 = await look(item(ids.tb));
await page.locator(`${item(ids.tb)} td[data-row="r1"][data-col="c1"]`).click();
await wait(300);
check('문서 뷰 표 칸: 고칠 때 표가 밀리지 않음 · 칸 글자 그대로', dt0 === await look(item(ids.tb)) && (await page.locator(`${item(ids.tb)} .dn-table-tools`).count()) === 1, `${dt0}  ≠  ${await look(item(ids.tb))}`);
await page.screenshot({ path: `${OUT}/edit-same-doc-table.png` });

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
