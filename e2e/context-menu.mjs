// 오른쪽 클릭 = 그 객체의 속성 메뉴: 블록(묶음) 이름표 · 상자 사이 빈 곳 → 묶음 메뉴(넣기 메뉴 아님), 묶음을 고른 채 안의 콘텐츠 → 그 콘텐츠 메뉴,
// 캡션 → 그 그림 메뉴, 빈 캔버스만 넣기 메뉴. 문서 뷰: 항목 오른쪽 클릭 → 같은 블록 메뉴(글꼴 바꾸기 · 캡션 자리), 고치는 글 안은 브라우저 메뉴, 닫으면 초점은 문서.
// 사용: dev 서버 실행 후 `node e2e/context-menu.mjs [스크린샷 폴더]`
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
  const core = await import(CORE), v = window.__dn.view, e = v.engine;
  const r = e.transact((tx) => {
    const mk = (x, y, w, role, text) => { const b = tx.createBlock({ x, y, w, h: 50 }); tx.createContent({ blockId: b, type: 'text', role, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } }); return b; };
    const title = mk(0, 0, 260, 'title', '실험 묶음'), a = mk(0, 80, 260, 'body', '첫 콘텐츠'), b = mk(320, 80, 260, 'body', '둘째 콘텐츠');
    const chart = tx.createBlock({ x: 0, y: 320, w: 320, h: 200 }); tx.createContent({ blockId: chart, type: 'chart', kind: 'bar', series: [{ id: 's', name: '값', points: [{ x: 'a', y: 1 }] }] });
    return { title, a, b, chart };
  }, { origin: 'user' }).value;
  core.groupBlocks(e, [r.title, r.a, r.b], '실험 묶음');
  core.setBlockCaption(e, r.chart, '분포');
  v.setCamera({ x: -120, y: -120, zoom: 1 });
  return r;
}, CORE);
await wait(500);
const box = (id) => page.locator(`.dn-block[data-id="${id}"]`).boundingBox();
const blockMenu = page.locator('.menu[aria-label="블록 메뉴"]');
const insertOpen = () => page.locator('.insert-menu, [aria-label="넣기 메뉴"], [aria-label="블록 넣기"]').count();
const sel = () => ws(() => [...window.__dn.view.selBlocks].sort());
const esc = async () => { await page.keyboard.press('Escape'); await wait(150); };

// 1. 이름표
const tb = await box(ids.title);
await page.mouse.click(tb.x + 12, tb.y - 18, { button: 'right' });
await wait(250);
check('묶음 이름표 오른쪽 클릭 → 묶음 메뉴 (넣기 메뉴 아님)', await blockMenu.isVisible() && (await blockMenu.locator('.menu-head').first().innerText()).includes('실험 묶음') && (await insertOpen()) === 0
  && JSON.stringify(await sel()) === JSON.stringify([ids.title, ids.a, ids.b].sort()));
if (OUT) await page.screenshot({ path: `${OUT}/ctx-group.png` });
await esc();
// 2. 상자 사이 빈 곳
const ab = await box(ids.a), bb = await box(ids.b);
await page.mouse.click((ab.x + ab.width + bb.x) / 2, ab.y + 25, { button: 'right' });
await wait(250);
check('묶음 안 상자 사이 빈 곳 → 묶음 메뉴', await blockMenu.isVisible() && (await blockMenu.locator('button', { hasText: '묶음 풀기' }).count()) === 1 && (await insertOpen()) === 0);
await esc();
// 3. 묶음을 고른 채 안의 콘텐츠
await ws((g) => window.__dn.view.select(g), [ids.title, ids.a, ids.b]);
await page.mouse.click(bb.x + 40, bb.y + 20, { button: 'right' });
await wait(250);
check('묶음을 고른 채 콘텐츠 오른쪽 클릭 → 그 콘텐츠 메뉴 (글자 서식 · 상자 종류)', await blockMenu.isVisible() && JSON.stringify(await sel()) === JSON.stringify([ids.b])
  && (await blockMenu.locator('.menu-sub > button', { hasText: '바꾸기' }).count()) === 1 && !(await blockMenu.locator('.menu-head').first().innerText()).startsWith('블록 ·'));
await esc();
// 4. 캡션
await page.locator(`.dn-block[data-id="${ids.chart}"] .dn-caption`).click({ button: 'right' });
await wait(250);
check('캡션 오른쪽 클릭 → 그 그래프 메뉴 (캡션 고치기)', await blockMenu.isVisible() && (await blockMenu.locator('button', { hasText: '캡션 고치기' }).count()) === 1 && JSON.stringify(await sel()) === JSON.stringify([ids.chart]));
await esc();
// 4-b. 목차 링크 글자 → 그 목차 블록 메뉴 (AT-014 — 브라우저 메뉴였다)
const tocId = await ws(() => window.__dn.view.engine.transact((tx) => { const b = tx.createBlock({ x: 640, y: 320, w: 240, h: 120 }); tx.createContent({ blockId: b, type: 'toc', depth: 3 }); return b; }, { origin: 'user' }).value);
await wait(400);
await page.locator(`.dn-block[data-id="${tocId}"] .dn-toc-link`).first().click({ button: 'right' });
await wait(250);
check('목차 링크 오른쪽 클릭 → 그 목차 블록 메뉴', await blockMenu.isVisible() && JSON.stringify(await sel()) === JSON.stringify([tocId]), JSON.stringify(await sel()));
await esc();
// 5. 빈 캔버스 → 노트 설정 (11/03), 넣기는 그 안의 '여기에 넣기'
await page.mouse.click(1100, 700, { button: 'right' });
await wait(250);
const nm = await page.locator('.note-menu').count();
await page.locator('.note-menu .nm-row', { hasText: '여기에 넣기' }).click();
await wait(200);
check('빈 캔버스 오른쪽 클릭 → 노트 설정 › 여기에 넣기 → 넣기 메뉴', nm === 1 && (await insertOpen()) === 1);
await esc();

// 문서 뷰
await ws(() => window.__dn.setViewMode('doc'));
await wait(700);
const para = page.locator('.dn-doc .dn-doc-item', { hasText: '첫 콘텐츠' });
await para.click({ button: 'right' });
await wait(300);
check('문서 뷰: 항목 오른쪽 클릭 → 블록 메뉴 (글자 · 상자 종류)', await blockMenu.isVisible() && (await blockMenu.locator('.menu-sub > button', { hasText: '바꾸기' }).count()) === 1);
await blockMenu.locator('.menu-sub > button', { hasText: '글자 모양' }).click(); // 하위 메뉴 (DS-001)
await blockMenu.locator('.fc-btn').click(); // 글꼴은 지금 글꼴 단추 — 누르면 목록 (알파 10/31)
await blockMenu.locator('.fc-list [role="option"]', { hasText: '명조' }).click();
await wait(200);
await page.keyboard.press('Escape'); // 글자 서식은 여러 번 고르게 판이 열린 채 — Esc로 닫는다
await wait(200);
const font = await ws((id) => window.__dn.view.engine.getBlock(id).fontFamily, ids.a);
const focus = await ws(() => ({ doc: !!document.activeElement?.closest('.dn-doc'), canvas: document.activeElement === window.__dn.view.root }));
check('문서 뷰 메뉴로 글꼴 바꾸기 → 그 상자만 명조 · 닫으면 초점은 문서로', font === 'serif' && (await ws((id) => window.__dn.view.engine.getBlock(id).fontFamily ?? null, ids.b)) === null && focus.doc && !focus.canvas, JSON.stringify({ font, focus }));
// 고치는 글 안 → 그 상자 메뉴 (잘라내기 · 복사 · 붙여넣기 + 글자 · 상자) — 캔버스 편집 중과 같게 (AT-005). Shift+오른쪽 클릭은 브라우저 메뉴
await para.locator('.dn-doc-text').click();
await wait(250);
const shiftPrevented = await page.evaluate(() => {
  const t = document.querySelector('.dn-doc .dn-text-editing');
  const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10, shiftKey: true });
  t.dispatchEvent(ev);
  return ev.defaultPrevented;
});
await wait(150);
check('문서 뷰: 고치는 글 안 Shift+오른쪽 클릭은 브라우저 메뉴 (맞춤법)', !shiftPrevented && !(await blockMenu.isVisible()));
// '첫 콘텐츠'의 '콘텐츠'를 골라 오른쪽 클릭 → 편집 줄 + 글자 서식, 고른 글자만 고정폭 (상자는 위에서 명조)
await page.keyboard.press('End');
for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowLeft');
const er = await page.locator('.dn-doc .dn-text-editing').boundingBox();
await page.mouse.click(er.x + 20, er.y + er.height / 2, { button: 'right' });
await wait(250);
check('문서 뷰: 고치는 글 안 오른쪽 클릭 → 그 상자 메뉴 (잘라내기 · 복사 · 붙여넣기 + 상자 종류) · 편집은 그대로', await blockMenu.isVisible() && (await blockMenu.locator('.edit-row button', { hasText: '붙여넣기' }).count()) === 1 && (await blockMenu.locator('.menu-sub > button', { hasText: '바꾸기' }).count()) === 1 && (await page.locator('.dn-doc .dn-text-editing').count()) === 1);
await blockMenu.locator('.fc-btn').click();
await blockMenu.locator('.fc-list [role="option"]', { hasText: '고정폭' }).click();
await wait(250);
const marks = await ws((id) => JSON.stringify(window.__dn.view.engine.contentsOf(id)[0].doc), ids.a);
const boxFont = await ws((id) => window.__dn.view.engine.getBlock(id).fontFamily ?? null, ids.a);
check('… 글자를 골랐으면 고른 글자만 고정폭 (상자 전체는 그대로 명조)', marks.includes('fontFamily') && marks.includes('mono') && boxFont === 'serif', JSON.stringify({ marks: marks.slice(0, 200), boxFont }));
await esc();
const edFocus = await ws(() => !!document.activeElement?.closest('.dn-doc .dn-text-editing'));
check('… 메뉴를 닫으면 초점은 고치던 글로', edFocus);
// 그래프 항목 → 캡션 고치기 자리가 문서 항목 아래
const chartItem = page.locator(`.dn-doc .dn-doc-item[data-id="${ids.chart}"]`);
await chartItem.click({ button: 'right', position: { x: 60, y: 40 } });
await wait(300);
await blockMenu.locator('button', { hasText: '캡션 고치기' }).click();
await wait(250);
const ir = await page.locator('.dn-caption-input').boundingBox(), cr = await chartItem.boundingBox();
check('문서 뷰 메뉴 › 캡션 고치기 → 입력 칸이 그 항목 바로 아래', !!ir && Math.abs(ir.y - (cr.y + cr.height + 4)) < 6 && Math.abs(ir.x - cr.x) < 6, JSON.stringify({ ir, cr }));
await page.keyboard.press('Escape');
if (OUT) await page.screenshot({ path: `${OUT}/ctx-doc.png` });
check('콘솔 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close();
const bad = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
