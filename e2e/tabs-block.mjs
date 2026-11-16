// 탭 블록 (GAP #17 — 노션 /tabs): /탭 → 탭 1 · 탭 2, 글 칸을 두 번 눌러 그 탭 글 고치기(Esc로 끝), 탭을 누르면 그 탭 글,
// + 탭 추가 · × 지우기 · 탭 이름 두 번 눌러 고치기(실행 취소 한 번), 문서 뷰에서 탭 바꿔 보기, Markdown에는 모든 탭.
// 사용: dev 서버 실행 후 `node e2e/tabs-block.mjs [스크린샷 폴더]`
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
const tabs = () => ws(() => { const e = window.__dn.view.engine; for (const b of e.blocks()) for (const c of e.contentsOf(b.id)) if (c.type === 'tabs') return c.tabs.map((t) => [t.label, JSON.stringify(t.doc).match(/"text":"([^"]*)"/)?.[1] ?? '']); return null; });
const strip = (root = '.dn-block') => page.locator(`${root} .dn-tabs-strip .dn-tab`).allInnerTexts();
const body = (root = '.dn-block') => page.locator(`${root} .dn-tabs-body`).first().innerText();
const editBody = async (text) => {
  const b = await page.locator('.dn-block .dn-tabs-body').first().boundingBox();
  await page.mouse.dblclick(b.x + 30, b.y + 10);
  await wait(250);
  await page.keyboard.type(text);
  await wait(150);
  await page.keyboard.press('Escape');
  await wait(250);
};

await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(() => window.__dn.newNote({ sheet: null }));
await page.waitForFunction(() => window.__dn.view.engine.blockCount === 0);
await page.evaluate(() => window.__dn.view.setTool('block'));
await page.mouse.click(500, 200);
await wait(250);
await page.keyboard.type('/탭');
await wait(250);
check('슬래시 메뉴에 탭', (await page.locator('.dn-slash-item b').first().innerText()) === '탭');
await page.keyboard.press('Enter');
await wait(400);
check('/탭 → 탭 1 · 탭 2', JSON.stringify(await strip()) === '["탭 1","탭 2"]', JSON.stringify(await strip()));

await editBody('첫 탭 글');
check('글 칸 두 번 눌러 고치기 → 탭 1 글', JSON.stringify(await tabs()) === '[["탭 1","첫 탭 글"],["탭 2",""]]', JSON.stringify(await tabs()));
await page.locator('.dn-block .dn-tab', { hasText: '탭 2' }).click();
await wait(200);
check('탭 2를 누르면 탭 2 글(빈 안내)', (await body()).includes('두 번 눌러') || (await body()).trim() === '', await body());
await editBody('둘째 탭 글');
await page.locator('.dn-block .dn-tab', { hasText: '탭 1' }).click();
await wait(200);
check('탭 1로 돌아가면 첫 탭 글', (await body()).includes('첫 탭 글') && JSON.stringify(await tabs()) === '[["탭 1","첫 탭 글"],["탭 2","둘째 탭 글"]]', JSON.stringify(await tabs()));
await page.screenshot({ path: `${OUT}/tabs-canvas.png` });

// + 추가 · × 지우기
await page.locator('.dn-block .dn-tab-add').click();
await wait(300);
check('+ → 탭 3, 그 탭이 보임', JSON.stringify(await strip()) === '["탭 1","탭 2","탭 3"]' && (await page.locator('.dn-block .dn-tab.on').innerText()) === '탭 3');
await page.locator('.dn-block .dn-tab-x').click();
await wait(300);
check('× → 탭 3 지움', JSON.stringify(await strip()) === '["탭 1","탭 2"]', JSON.stringify(await strip()));

// 이름 고치기 · 실행 취소
await page.locator('.dn-block .dn-tab', { hasText: '탭 1' }).dblclick();
await wait(150);
await page.keyboard.press('Control+A');
await page.keyboard.type('개요');
await page.keyboard.press('Enter');
await wait(300);
check('탭 이름 두 번 눌러 고치기', JSON.stringify(await strip()) === '["개요","탭 2"]', JSON.stringify(await strip()));
await ws(() => window.__dn.view.engine.undo());
await wait(250);
check('실행 취소 한 번에 이름이 돌아옴', JSON.stringify(await strip()) === '["탭 1","탭 2"]', JSON.stringify(await strip()));
await ws(() => window.__dn.view.engine.redo());
await wait(250);

// 문서 뷰: 탭 바꿔 보기
await ws(() => window.__dn.setViewMode('doc'));
await wait(700);
check('문서 뷰에 탭 줄', JSON.stringify(await strip('.dn-doc')) === '["개요","탭 2"]', JSON.stringify(await strip('.dn-doc')));
await page.locator('.dn-doc .dn-tab', { hasText: '탭 2' }).click();
await wait(200);
check('문서 뷰에서 탭 2를 누르면 탭 2 글', (await body('.dn-doc')).includes('둘째 탭 글'), await body('.dn-doc'));
await ws(() => window.__dn.setViewMode('canvas'));
await wait(300);

// Markdown: 모든 탭
const md = await ws(() => window.__dn.noteMarkdown(window.__dn.state.currentId));
check('Markdown에 모든 탭 (이름 + 글)', /\*\*개요\*\*\s+첫 탭 글\s+\*\*탭 2\*\*\s+둘째 탭 글/.test(md), md.slice(-120));

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
