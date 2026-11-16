// 목차 블록 (FR-053): 넣기 메뉴 · 슬래시로 넣기 → 제목 상자 · 제목 1~3을 읽는 순서대로 → 제목을 고치면 바로 바뀜 →
// 누르면 그 블록으로(캔버스: 카메라 이동 · 문서 뷰: 스크롤) → 실행 취소 한 번. 사용: dev 서버 실행 후 `node e2e/toc.mjs [스크린샷 폴더]`
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
await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(() => window.__dn.newNote());
await page.waitForTimeout(400);

// 제목 셋: 맨 위 제목 상자 · 아래 내용 상자(제목 2) · 멀리 떨어진 내용 상자(제목 2 + 제목 3)
const ids = await ws(() => {
  const e = window.__dn.view.engine;
  const h = (level, text) => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] });
  const p = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
  const mk = (x, y, kind, doc) => e.transact((tx) => {
    const b = tx.createBlock({ x, y, w: 300, h: kind === 'title' ? 48 : 120 });
    tx.createContent({ blockId: b, type: 'text', role: kind === 'title' ? 'title' : 'body', doc });
    return b;
  }, { origin: 'user' }).value;
  return {
    a: mk(0, 0, 'title', { type: 'doc', content: [p('1장 시작')] }),
    b: mk(0, 200, 'body', { type: 'doc', content: [h(2, '배경'), p('왜 하는지')] }),
    c: mk(3000, 2400, 'body', { type: 'doc', content: [h(2, '결론'), p('정리'), h(3, '다음 할 일')] }),
  };
});
await ws(() => { window.__dn.view.setCamera({ x: -500, y: -100, zoom: 1 }); window.__dn.view.select([]); });
await page.locator('.toolbar .insert-btn').click();
await page.waitForSelector('.insert-menu');
await page.keyboard.type('목차');
await page.keyboard.press('Enter');
await page.waitForSelector('.dn-toc .dn-toc-link', { timeout: 3000 }).catch(() => {});
const links = () => page.locator('.dn-block .dn-toc-link').allInnerTexts();
check('넣기 메뉴 "목차" → 제목을 읽는 순서대로', JSON.stringify(await links()) === '["1장 시작","배경","결론","다음 할 일"]', JSON.stringify(await links()));
const indent = await page.evaluate(() => [...document.querySelectorAll('.dn-block .dn-toc li')].map((li) => li.className));
check('단계만큼 들여쓰기 (제목 상자 1 · 제목 2 → 2 · 제목 3 → 3)', JSON.stringify(indent) === '["dn-toc-l1","dn-toc-l2","dn-toc-l2","dn-toc-l3"]', JSON.stringify(indent));
await page.screenshot({ path: `${OUT}/toc.png` });

// 목차 블록은 건드리지 않고 다른 블록의 제목을 고친다
await ws((id) => window.__dn.view.startEditing(id, 'start'), ids.b);
await page.keyboard.press('End');
await page.keyboard.type('과 목표');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
check('제목을 고치면 목차가 바로 바뀐다', (await links())[1] === '배경과 목표', JSON.stringify(await links()));

// 누르면 그 블록으로
await page.locator('.dn-block .dn-toc-link', { hasText: '결론' }).click();
await page.waitForTimeout(600);
const went = await ws((id) => {
  const v = window.__dn.view, b = v.engine.getBlock(id), r = v.blockScreenRect(id);
  return { sel: v.selectedBlocks.includes(id), visible: r && r.x >= 0 && r.y >= 0 && r.x + r.w <= v.root.clientWidth && r.y + r.h <= v.root.clientHeight, b: b && { x: b.x, y: b.y } };
}, ids.c);
check('목차 항목을 누르면 그 블록으로 이동 · 선택', went.sel && went.visible, JSON.stringify(went));

// 블록 자리가 바뀌면 순서도
await ws((id) => window.__dn.view.engine.transact((tx) => tx.set('block', id, { x: 0, y: -300 }), { origin: 'user' }), ids.c);
// 목차 블록이 화면에 보이게 돌아와서 확인 (화면 밖 블록은 그리지 않는다)
await ws(() => { const v = window.__dn.view; const t = [...v.engine.contents()].find((c) => c.type === 'toc'); v.setCamera({ x: v.engine.getBlock(t.blockId).x - 200, y: v.engine.getBlock(t.blockId).y - 200, zoom: 1 }); });
await page.waitForTimeout(300);
check('블록을 옮기면 목차 순서도 따라간다', (await links())[0] === '결론', JSON.stringify(await links()));
await ws(() => window.__dn.view.undo());
await page.waitForTimeout(200);

// 문서 뷰
await ws(() => window.__dn.setViewMode('doc'));
await page.waitForSelector('.dn-doc .dn-toc-link');
check('문서 뷰에도 목차', (await page.locator('.dn-doc .dn-toc-link').count()) === 4);
// 문서가 화면보다 길도록 위에 긴 상자를 하나 더 (스크롤이 생기게)
await ws(() => window.__dn.view.engine.transact((tx) => {
  const b = tx.createBlock({ x: 0, y: 100, w: 300, h: 120 });
  tx.createContent({ blockId: b, type: 'text', role: 'body', doc: { type: 'doc', content: Array.from({ length: 60 }, (_, i) => ({ type: 'paragraph', content: [{ type: 'text', text: `줄 ${i + 1}` }] })) } });
}, { origin: 'user' }));
await page.waitForTimeout(400);
const scroller = () => page.evaluate(() => document.querySelector('.doc-scroll').scrollTop);
const s0 = await scroller();
await page.locator('.dn-doc .dn-toc-link', { hasText: '다음 할 일' }).click();
await page.waitForTimeout(900);
const seen = await page.evaluate((id) => {
  const el = document.querySelector(`.dn-doc-item[data-id="${id}"]`).getBoundingClientRect();
  const host = document.querySelector('.doc-host').getBoundingClientRect();
  return el.top >= host.top - 4 && el.top < host.bottom - 40;
}, ids.c);
const s1 = await scroller();
check('문서 뷰에서 누르면 그 블록으로 스크롤', seen && s1 > s0, JSON.stringify({ s0, s1, seen }));
await ws(() => window.__dn.setViewMode('canvas'));
await page.waitForTimeout(300);

// 실행 취소 한 번 · 슬래시
await ws(() => { window.__dn.view.root.focus(); });
const before = await ws(() => [...window.__dn.view.engine.contents()].filter((c) => c.type === 'toc').length);
await ws((id) => window.__dn.view.startEditing(id, 'end'), ids.b);
await page.keyboard.press('Enter');
await page.keyboard.type('/목차');
await page.waitForTimeout(200);
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
const after = await ws(() => [...window.__dn.view.engine.contents()].filter((c) => c.type === 'toc').length);
check('슬래시 "목차" → 목차 블록 하나 더', after === before + 1);
await ws(() => window.__dn.view.undo());
await page.waitForTimeout(150);
check('실행 취소 한 번 → 목차 블록이 사라짐', (await ws(() => [...window.__dn.view.engine.contents()].filter((c) => c.type === 'toc').length)) === before);

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
