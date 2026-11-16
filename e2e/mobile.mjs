// 모바일 · 태블릿 확인 (FR-152): 폰 — 처음엔 문서 뷰(흐름), 사이드바는 서랍(☰ · 바깥 누르기 · 노트 고르면 닫힘), 터치 대상 44px, 가로 넘침 없음,
// 캔버스로 바꿔 두 손가락 팬 · 줌. 태블릿 세로 = 서랍, 가로 = 사이드바 그대로. 데스크톱엔 ☰ 없음.
// 11/03: 홈 · 할 일 · 노트 그래프 · 휴지통에서도 ☰ → 서랍 (전엔 노트 화면에만 단추가 있어 좁으면 사이드바를 못 열었다) · 데스크톱 창을 줄여도.
// 사용: dev 서버 실행 후 `node e2e/mobile.mjs [스크린샷 폴더]`
import { chromium } from 'playwright-core';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2] ?? '.';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const errors = [];

const browser = await chromium.launch({ channel: process.env.DN_CHANNEL ?? 'msedge', headless: true });
async function open(viewport, touch) {
  const ctx = await browser.newContext({ viewport, ...(touch ? { hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : {}) });
  await ctx.addInitScript(() => localStorage.setItem('dn:no-env-key', '1'));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });
  await page.goto(BASE);
  await page.waitForFunction(() => window.__dn?.state?.currentId, null, { timeout: 15000 });
  await page.waitForTimeout(500);
  return { ctx, page, ws: (fn, arg) => page.evaluate(fn, arg) };
}
const sidebarShown = (page) => page.evaluate(() => { const r = document.querySelector('.sidebar').getBoundingClientRect(); return getComputedStyle(document.querySelector('.sidebar')).visibility !== 'hidden' && r.right > 10 && r.width > 0; });

// ───── 폰 ─────
const P = await open({ width: 390, height: 844 }, true);
check('폰: 처음엔 문서 뷰 (흐름 렌더링)', (await P.ws(() => window.__dn.state.viewMode)) === 'doc' && (await P.page.locator('.doc-host').isVisible()));
check('폰: 사이드바 접힘 · ☰ 보임', !(await sidebarShown(P.page)) && (await P.page.locator('.menu-btn').isVisible()));
check('폰: 가로 넘침 없음', (await P.ws(() => document.documentElement.scrollWidth <= innerWidth + 1)));
await P.page.locator('.menu-btn').tap();
await P.page.waitForTimeout(300);
check('☰ → 서랍 열림', (await sidebarShown(P.page)) && (await P.page.locator('.drawer-backdrop').count()) === 1);
await P.page.screenshot({ path: `${OUT}/mobile-drawer.png` });
await P.page.locator('.drawer-backdrop').tap({ position: { x: 370, y: 400 } });
await P.page.waitForTimeout(300);
check('바깥 누르면 닫힘', !(await sidebarShown(P.page)));
// 지금 열린 노트를 눌러도 서랍이 닫힌다 (AT-007)
await P.page.locator('.menu-btn').tap();
await P.page.waitForTimeout(300);
await P.page.locator('.sidebar .note-list .note-item.active').first().tap();
await P.page.waitForTimeout(400);
check('서랍에서 지금 열린 노트를 눌러도 닫힘', !(await sidebarShown(P.page)));
const firstNote = await P.ws(() => window.__dn.state.currentId);
const firstTitle = await P.ws(() => window.__dn.state.title);
await P.ws(() => window.__dn.newNote());
await P.page.waitForTimeout(400);
await P.page.locator('.menu-btn').tap();
await P.page.waitForTimeout(300);
const before = await P.ws(() => window.__dn.state.currentId);
const other = P.page.locator('.sidebar .note-list .note-item:not(.active) .note-title', { hasText: firstTitle }).first();
const otherName = await other.innerText();
await other.tap();
await P.page.waitForFunction((b) => window.__dn.state.currentId !== b, before, { timeout: 5000 }).catch(() => {});
await P.page.waitForTimeout(400);
check('노트를 고르면 열리고 서랍이 닫힘', (await P.ws(() => window.__dn.state.currentId)) === firstNote && !(await sidebarShown(P.page)), otherName);
const small = await P.ws(() => [...document.querySelectorAll('.menu-btn, .fav-btn, .panel-btn')].filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect()).filter((r) => r.height < 44 || r.width < 44).length);
check('터치 대상 44px 이상 (상단 버튼)', small === 0, String(small));
// 캔버스로 바꿔 두 손가락 팬 · 줌
await P.page.locator('.view-toggle button', { hasText: '캔버스' }).tap();
await P.page.waitForTimeout(400);
check('보기 전환으로 캔버스', (await P.ws(() => window.__dn.state.viewMode)) === 'canvas' && (await P.page.locator('.toolbar').isVisible()));
const tb = await P.ws(() => [...document.querySelectorAll('.toolbar button')].filter((e) => e.offsetParent).every((e) => e.getBoundingClientRect().height >= 44));
check('도구 막대 버튼 44px', tb);
const pinch = await P.ws(() => {
  const v = window.__dn.view; const root = v.root; const r = root.getBoundingClientRect();
  const ev = (type, id, x, y) => root.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: r.left + x, clientY: r.top + y, button: 0, buttons: 1, bubbles: true, isPrimary: id === 1 }));
  const z0 = v.cam.zoom, x0 = v.cam.x;
  ev('pointerdown', 1, 150, 300); ev('pointerdown', 2, 230, 300);
  for (let i = 1; i <= 8; i++) { ev('pointermove', 1, 150 - i * 6, 300 + i * 3); ev('pointermove', 2, 230 + i * 6, 300 + i * 3); }
  ev('pointerup', 1, 102, 324); ev('pointerup', 2, 278, 324);
  return { zoomed: v.cam.zoom > z0 * 1.2, moved: v.cam.x !== x0 };
});
check('두 손가락 벌리기 = 줌 · 화면 이동', pinch.zoomed && pinch.moved, JSON.stringify(pinch));
check('폰 캔버스: 가로 넘침 없음', (await P.ws(() => document.documentElement.scrollWidth <= innerWidth + 1)));
await P.page.screenshot({ path: `${OUT}/mobile-canvas.png` });
await P.ctx.close();

// ───── 태블릿 ─────
const T = await open({ width: 820, height: 1180 }, true);
check('태블릿 세로: 서랍 · 처음엔 캔버스', !(await sidebarShown(T.page)) && (await T.page.locator('.menu-btn').isVisible()) && (await T.ws(() => window.__dn.state.viewMode)) === 'canvas');
for (const [name, show, sel] of [['홈', 'showHome', '.home-page'], ['할 일', 'showTodos', '.todo-page'], ['노트 그래프', 'showGraph', '.graph-page'], ['휴지통', 'showTrash', '.trash-page:not(.home-page):not(.todo-page)']]) {
  await T.ws((f) => window.__dn[f](), show);
  await T.page.waitForTimeout(400);
  const btn = T.page.locator(`${sel} .menu-btn`);
  const vis = await btn.isVisible();
  if (vis) await btn.tap();
  await T.page.waitForTimeout(300);
  const opened = await sidebarShown(T.page);
  if (name === '홈') await T.page.screenshot({ path: `${OUT}/tablet-home-drawer.png` });
  if (opened) await T.page.locator('.drawer-backdrop').tap({ position: { x: 780, y: 600 } });
  await T.page.waitForTimeout(300);
  check(`태블릿 세로 ${name}: ☰ → 서랍 열림 · 바깥 누르면 닫힘`, vis && opened && !(await sidebarShown(T.page)), JSON.stringify({ vis, opened }));
}
await T.page.setViewportSize({ width: 1180, height: 820 });
await T.page.waitForTimeout(300);
check('태블릿 가로: 사이드바 그대로 · ☰ 없음', (await sidebarShown(T.page)) && (await T.page.locator('.menu-btn:visible').count()) === 0);
// TABLET-CHECK (11/11): T1 아래 도구 막대와 확대 막대가 겹치지 않음 · T2 손가락으로 고른 상자에 손잡이 ⋮⋮ · T4 펜을 처음 쓰면 펜 전용
await T.ws(() => window.__dn.showHome());
await T.ws((id) => window.__dn.openById(id), await T.ws(() => window.__dn.state.notes[0].id));
await T.page.waitForTimeout(500);
const bars = await T.page.evaluate(() => { const a = document.querySelector('.toolbar')?.getBoundingClientRect(), b = document.querySelector('.zoom')?.getBoundingClientRect(); return a && b ? !(a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom) : null; });
check('태블릿 가로(T1): 아래 도구 막대와 확대 막대가 겹치지 않음', bars === true, String(bars));
const blk = T.page.locator('.dn-block').first();
await blk.tap();
await T.page.waitForTimeout(300);
const grip = await T.page.evaluate(() => { const g = document.querySelector('.dn-grip'); return g && !g.hidden ? Math.round(g.getBoundingClientRect().width) : 0; });
check('손가락으로 상자를 고르면 손잡이 ⋮⋮가 뜸 · 누르기 넉넉히 (T2)', grip >= 36, String(grip));
await T.ws(() => window.__dn.view.setTool('pen'));
const box = await T.page.locator('.canvas-host').boundingBox();
await T.page.evaluate(({ x, y }) => {
  const host = document.querySelector('.canvas-host');
  const ev = (type, dx) => host.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: 'pen', isPrimary: true, bubbles: true, clientX: x + dx, clientY: y, button: type === 'pointermove' ? -1 : 0, buttons: type === 'pointerup' ? 0 : 1, pressure: 0.5 }));
  ev('pointerdown', 0); ev('pointermove', 20); ev('pointerup', 20);
}, { x: box.x + box.width / 2, y: box.y + box.height - 220 });
await T.page.waitForTimeout(300);
check('펜을 처음 쓰면 펜 전용이 켜지고 알림 (T4)', (await T.ws(() => window.__dn.view.ink.penOnly)) === true && /펜을 찾았어요/.test(await T.page.locator('.toast').innerText().catch(() => '')));
await T.ctx.close();

// ───── 데스크톱 ─────
const D = await open({ width: 1440, height: 900 }, false);
check('데스크톱: ☰ 없음 · 사이드바 · 캔버스', !(await D.page.locator('.menu-btn').isVisible()) && (await sidebarShown(D.page)) && (await D.ws(() => window.__dn.state.viewMode)) === 'canvas');
// 창을 줄이면 홈에서도 ☰ → 서랍, 늘리면 사이드바 그대로
await D.ws(() => window.__dn.showHome());
await D.page.setViewportSize({ width: 900, height: 900 });
await D.page.waitForTimeout(300);
await D.page.locator('.home-page .menu-btn').click();
await D.page.waitForTimeout(300);
const narrowOpen = await sidebarShown(D.page);
await D.page.keyboard.press('Escape');
await D.page.waitForTimeout(300);
const escClosed = !(await sidebarShown(D.page));
await D.page.setViewportSize({ width: 1440, height: 900 });
await D.page.waitForTimeout(300);
check('데스크톱 창을 줄인 홈: ☰ → 서랍 · Esc로 닫힘 · 다시 넓히면 사이드바', narrowOpen && escClosed && (await sidebarShown(D.page)) && !(await D.page.locator('.home-page .menu-btn').isVisible()), JSON.stringify({ narrowOpen, escClosed }));
await D.ctx.close();

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
