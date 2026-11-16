// 새 페이지 단추: 캔버스(A4 용지) · 문서 뷰(쪽 보기) 모두 마지막 페이지 오른쪽 아래 동그란 '+',
// 마지막 페이지 바닥이 보일 때만 보이고, 누르면 새 페이지 — 문서 뷰는 새 쪽에서 바로 쓰기(글이 들어와야 남음).
// 사용: dev 서버 실행 후 `node e2e/page-add.mjs`
import { chromium } from 'playwright-core';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
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

// ── 캔버스: A4 노트 ──
await page.locator('.note-item.add').first().click();
await wait(700);
const add = page.locator('.dn-sheet-add');
check('A4 노트: 페이지 바닥이 보이면 동그란 + 단추', await add.isVisible());
const shape = await add.evaluate((el) => { const s = getComputedStyle(el); return { w: el.offsetWidth, h: el.offsetHeight, r: s.borderRadius, label: el.getAttribute('aria-label') }; });
check('동그란 모양 · 이름은 새 페이지', shape.w === shape.h && shape.r === '50%' && shape.label === '새 페이지', JSON.stringify(shape));
await add.click();
await wait(400);
check('누르면 2페이지', (await ws(() => window.__dn.view.engine.note.sheet.pages)) === 2);
await ws(() => window.__dn.view.setCamera({ x: -48, y: -48, zoom: 1 }));
await wait(200);
check('맨 위를 보면(마지막 페이지 바닥이 화면 밖) 숨음', !(await add.isVisible()));

// ── 문서 뷰: 쪽 보기 ──
await ws(() => { window.__dn.setDocPages(true); window.__dn.setViewMode('doc'); });
await wait(600);
await page.locator('.dn-doc-page').click({ position: { x: 300, y: 200 } });
await wait(200);
await page.keyboard.type('첫 쪽 글');
await wait(300);
const docAdd = page.locator('.dn-doc .dn-page-add');
check('문서 쪽 보기에도 동그란 + 단추', (await docAdd.count()) === 1 && (await docAdd.evaluate((el) => getComputedStyle(el).borderRadius)) === '50%');
await docAdd.scrollIntoViewIfNeeded();
await docAdd.click();
await wait(400);
const sheets = () => page.locator('.dn-doc .dn-doc-sheet').count();
// 화면의 '새 노트'는 표지 쪽이 맨 앞 (11/09) — 표지 + 본문 2장
check('누르면 새 쪽 (표지 + 종이 2장) · 바로 쓸 수 있음', (await sheets()) === 3 && (await page.locator('.dn-doc .dn-text-editing').count()) === 1, String(await sheets()));
await page.keyboard.type('둘째 쪽 글');
await wait(300);
const last = await ws(() => { const e = window.__dn.view.engine; const b = [...e.blocks()].sort((a, c) => a.y - c.y).at(-1); return { pageBreak: !!b.pageBreak, draft: !!b.draft }; });
check('새 쪽 상자는 쪽 나눔 · 글이 들어오면 초안이 풀림', last.pageBreak && !last.draft, JSON.stringify(last));
const pos = await ws(() => { const b = document.querySelector('.dn-doc .dn-page-add').getBoundingClientRect(); const s = [...document.querySelectorAll('.dn-doc .dn-doc-sheet')].at(-1).getBoundingClientRect(); return { right: b.left - s.right, bottom: Math.round(s.bottom - b.bottom) }; });
check('단추는 마지막 쪽 오른쪽 아래 바깥', pos.right > 0 && pos.bottom === 0, JSON.stringify(pos));

check('콘솔 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close();
const bad = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
