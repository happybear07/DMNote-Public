// 노트 설정 (11/03): 노트 안 빈 곳 · 종이 오른쪽 클릭 → 누른 자리에 노트 설정 — 여기에 넣기 · 용지 · 이 쪽만 가로/세로(쪽마다) ·
// 바탕 무늬 · 노트 정보. 쪽 하나를 가로로 → 그 쪽만 넓고 낮게, 아래 쪽 상자는 따라 올라감 · 실행 취소 한 번. 상자 오른쪽 클릭은 블록 메뉴 그대로.
// 사용: dev 서버 실행 후 `node e2e/note-menu.mjs [스크린샷 폴더]`
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
await ws(() => window.__dn.newNote({ sheet: { size: 'a4', pages: 3 } }));
await wait(400);

// 상자 둘: 1쪽 · 2쪽
const [B1, B2] = await ws(() => window.__dn.view.engine.transact((tx) => {
  const mk = (y, t) => { const b = tx.createBlock({ x: 24, y, w: 300, h: 60 }); tx.createContent({ blockId: b, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] } }); return b; };
  return [mk(100, '1쪽 글'), mk(1163 + 100, '2쪽 글')];
}, { origin: 'user' }).value);
/** 월드 → 화면 좌표 */
const screen = (x, y) => ws(([x, y]) => { const v = window.__dn.view, r = v.root.getBoundingClientRect(), c = v.camera; return { x: r.left + (x - c.x) * c.zoom, y: r.top + (y - c.y) * c.zoom }; }, [x, y]);
const sheet = () => ws(() => window.__dn.view.engine.note.sheet);
const menu = page.locator('.note-menu');

// 2쪽 빈 곳을 오른쪽 클릭
await ws(() => window.__dn.view.setCamera({ x: -300, y: 1163 - 100, zoom: 0.6 }));
await wait(200);
const p2 = await screen(500, 1163 + 600);
await page.mouse.click(p2.x, p2.y, { button: 'right' });
await menu.waitFor({ timeout: 3000 });
const mb = await menu.boundingBox();
check('종이 빈 곳 오른쪽 클릭 → 그 자리에 노트 설정 · 용지 A4 세로 · 이 쪽만 (2쪽)',
  Math.abs(mb.x - p2.x) < 4 && (await menu.locator('[aria-labelledby="nm-sheet"] [aria-checked="true"]').innerText()).includes('A4 세로') && (await menu.locator('#nm-page').innerText()).includes('2쪽'));
await page.screenshot({ path: `${OUT}/note-menu.png` });
// 이 노트만 책 표지 색 (11/11) — 서재 책 색이 바뀐다 · 폴더 색 따르기로 되돌림
await menu.locator('.lib-palette button[aria-label="자주"]').click();
await wait(300);
const own = () => ws(() => window.__dn.state.notes.find((n) => n.id === window.__dn.state.currentId)?.bookColor ?? null);
const picked = await own();
await menu.locator('.lib-palette button', { hasText: '폴더 색 따르기' }).click();
await wait(300);
check('노트 설정 › 책 표지 색: 자주 → 노트 정보에 · 폴더 색 따르기 → 지움', picked === 'plum' && (await own()) === null, String(picked));

// 이 쪽만 가로
await menu.locator('[aria-labelledby="nm-page"] button', { hasText: '가로' }).click();
await wait(250);
const s1 = await sheet();
const ys = await ws(([a, b]) => { const e = window.__dn.view.engine; return [e.getBlock(a).y, e.getBlock(b).y]; }, [B1, B2]);
check('이 쪽만 가로 → 2쪽만 가로(노트 기본은 세로) · 메뉴는 그대로 열려 바로 보임', s1.orient?.[1] === 'landscape' && !s1.landscape && (await menu.locator('[aria-labelledby="nm-page"] [aria-checked="true"]').innerText()).includes('가로'), JSON.stringify(s1));
check('1쪽 · 2쪽 상자는 그 자리 (2쪽 위 끝은 그대로)', ys[0] === 100 && ys[1] === 1163 + 100, JSON.stringify(ys));
await page.keyboard.press('Escape');
await wait(150);
check('Esc → 노트 설정 닫힘', !(await menu.count()));
await ws(() => window.__dn.view.setCamera({ x: -200, y: 900, zoom: 0.45 }));
await wait(250);
await page.screenshot({ path: `${OUT}/note-menu-landscape-page.png` });

// 3쪽에 상자를 놓고 2쪽을 다시 세로로 → 3쪽 상자가 늘어난 만큼 내려감 · 실행 취소 한 번
const B3 = await ws(() => window.__dn.view.engine.transact((tx) => { const b = tx.createBlock({ x: 24, y: 1163 + 794 + 40 + 100, w: 300, h: 60 }); tx.createContent({ blockId: b, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '3쪽 글' }] }] } }); return b; }, { origin: 'user' }).value);
const p2b = await screen(900, 1163 + 400);
await page.mouse.click(p2b.x, p2b.y, { button: 'right' });
await menu.waitFor({ timeout: 3000 });
await menu.locator('[aria-labelledby="nm-page"] button', { hasText: '세로' }).click();
await wait(250);
const y3 = await ws((id) => window.__dn.view.engine.getBlock(id).y, B3);
check('2쪽을 다시 세로 → 3쪽 상자가 쪽이 길어진 만큼 아래로 · 적어 둔 방향 빠짐', y3 === 1163 + 1123 + 40 + 100 && !(await sheet()).orient, String(y3));
await page.keyboard.press('Escape');
await ws(() => window.__dn.view.root.focus());
await page.keyboard.press('Control+z');
await wait(200);
check('실행 취소 한 번 → 2쪽 가로 · 3쪽 상자 제자리', (await sheet()).orient?.[1] === 'landscape' && (await ws((id) => window.__dn.view.engine.getBlock(id).y, B3)) === 1163 + 794 + 40 + 100);

// 무늬 · 노트 정보
await ws(() => window.__dn.view.setCamera({ x: -300, y: -50, zoom: 0.6 }));
await wait(200);
const q1 = await screen(500, 600);
await page.mouse.click(q1.x, q1.y, { button: 'right' });
await menu.waitFor({ timeout: 3000 });
check('1쪽에서 열면 이 쪽만 (1쪽)', (await menu.locator('#nm-page').innerText()).includes('1쪽'));
await menu.locator('button[role="radio"]', { hasText: '괘선' }).click();
await wait(150);
check('무늬 괘선 → 노트 바탕', (await ws(() => window.__dn.view.engine.note.paper?.kind)) === 'lines');
await menu.locator('.nm-row', { hasText: '노트 정보' }).click();
await wait(250);
check('노트 정보 → 오른쪽 패널 · 노트 설정 닫힘', (await page.locator('.note-panel').count()) === 1 && !(await menu.count()));

// 상자 오른쪽 클릭은 블록 메뉴 그대로
await page.locator(`.dn-block[data-id="${B1}"]`).click({ button: 'right' });
await wait(200);
check('상자 오른쪽 클릭은 블록 메뉴 (노트 설정 아님)', (await page.locator('.menu[aria-label="블록 메뉴"]').count()) === 1 && !(await menu.count()));
await page.keyboard.press('Escape');

// 예전 끝없는 캔버스 노트 (A4로 고정 11/03): 용지는 A4 세로 · 가로만 — 고르면 A4로 바꾸기, 이 쪽 줄 없음
await ws(() => window.__dn.newNote({ sheet: null }));
await wait(400);
await page.mouse.click(900, 500, { button: 'right' });
await menu.waitFor({ timeout: 3000 });
check('예전 끝없는 캔버스 노트: 용지는 A4 세로 · 가로뿐(골라진 것 없음) · 안내 · 이 쪽 줄 없음', (await menu.locator('[aria-labelledby="nm-sheet"] button').allInnerTexts()).join() === 'A4 세로,A4 가로' && !(await menu.locator('[aria-labelledby="nm-sheet"] [aria-checked="true"]').count()) && (await menu.locator('.cs-desc').innerText()).includes('예전') && (await menu.locator('#nm-sheet').innerText()) === '용지' && !(await menu.locator('#nm-page').count()));
await menu.locator('[aria-labelledby="nm-sheet"] button', { hasText: 'A4 가로' }).click();
await wait(300);
check('용지 A4 가로로 바꾸기', (await ws(() => window.__dn.view.engine.note.sheet?.landscape)) === true);

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} 통과`);
await browser.close();
process.exit(results.every((r) => r.ok) ? 0 : 1);
