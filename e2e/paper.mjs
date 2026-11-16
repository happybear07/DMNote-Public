// 캔버스 배경 확인 (FR-041): 점(기본) · 괘선 · 모눈 · 무지 + 간격 · 바탕색(테마 따라 · 흰색 · 옥스퍼드 · 어둡게), 노트에 저장(새로 고침 유지 · 실행 취소),
// 위 막대 ⋯ › 캔버스 설정에서만(필기 막대 · 노트 정보 판에는 없음, 알파 10/31), PNG 내보내기에 배경 포함/미포함 선택. 사용: dev 서버 실행 후 `node e2e/paper.mjs [스크린샷 폴더]`
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
await page.waitForTimeout(400);

/** 아래 캔버스에서 빈 곳 세로줄 하나를 훑어 칠해진 줄 수 (점은 몇 개, 괘선은 많음) · 가로 한 줄의 칠한 칸 수 */
const scan = () => ws(() => {
  const v = window.__dn.view; v.setCamera({ x: -5000, y: -5000, zoom: 1 });
  return new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => {
    const c = v.under; const g = c.getContext('2d'); const d = g.getImageData(0, 0, c.width, c.height).data;
    const col = Math.floor(c.width / 2) + 3; let rows = 0;
    for (let y = 0; y < c.height; y++) if (d[(y * c.width + col) * 4 + 3] > 0) rows++;
    return res({ rows, h: c.height / v.dpr });
  })));
});
const dots = await scan();
check('기본: 점 그리드 (세로줄에 칠한 칸이 드묾)', dots.rows < dots.h * 0.05, JSON.stringify(dots));

// 위 막대 ⋯ › 캔버스 설정
const cs = page.locator('.canvas-settings');
const openSettings = async () => { if (await cs.count()) return; await page.locator('.topbar .more-btn').click(); await page.locator('.top-more-menu .canvas-settings-btn').click(); await cs.waitFor(); };
await openSettings();
check('⋯ 메뉴 › 캔버스 설정 → 바탕색 넷 · 무늬 넷 · 간격 넷', (await cs.locator('[aria-labelledby="cs-color"] [role="radio"]').allInnerTexts()).join() === '테마 따라,흰색,옥스퍼드,어둡게' && (await cs.locator('[aria-labelledby="cs-kind"] [role="radio"]').count()) === 4 && (await cs.locator('[aria-labelledby="cs-gap"] [role="radio"]').count()) === 4);
await page.locator('.panel-btn').click();
await page.waitForTimeout(150);
check('노트 정보 판에는 배경 고르기 없음 (캔버스 설정 한곳)', (await page.locator('.panel-paper, .paper-picker').count()) === 0);
await page.locator('.panel-btn').click();
await openSettings();
await cs.getByRole('radio', { name: '괘선' }).click();
await cs.getByRole('radio', { name: '24px' }).click();
await page.waitForTimeout(150);
const lines = await scan();
check('괘선 · 간격 24 (세로줄마다 선이 지나감)', (await ws(() => JSON.stringify(window.__dn.view.engine.note.paper))) === '{"kind":"lines","gap":24}' && lines.rows >= Math.floor(lines.h / 24) - 2, JSON.stringify(lines));
await page.screenshot({ path: `${OUT}/paper-lines.png` });
await cs.getByRole('radio', { name: '모눈' }).click();
await page.waitForTimeout(150);
const grid = await ws(() => { const c = window.__dn.view.under; const d = c.getContext('2d').getImageData(0, Math.floor(c.height / 2) + 2, c.width, 1).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; });
check('모눈: 가로줄에도 세로선', grid > 20, String(grid));
await cs.getByRole('radio', { name: '무지' }).click();
await page.waitForTimeout(150);
check('무지: 아무것도 안 그림 · 간격은 고를 수 없음', (await scan()).rows === 0 && (await cs.getByRole('radio', { name: '24px' }).isDisabled()));
await ws(() => window.__dn.view.root.focus());
await page.keyboard.press('Control+z');
await page.waitForTimeout(150);
check('실행 취소로 이전 배경', (await ws(() => window.__dn.view.engine.note.paper?.kind)) === 'grid');

// 배경은 노트 설정 판에서만 — 필기 막대(펜 · 형광펜)에는 없음 (사용자 요청 10/30)
await page.keyboard.press('p');
await page.waitForTimeout(100);
check('필기 막대에는 배경 고르기 없음', (await page.locator('.ink-bar').count()) === 1 && (await page.locator('.ink-bar .paper-picker').count()) === 0);
await page.keyboard.press('Escape');

// 바탕색 — 캔버스 안만 바뀐다 (앱 화면은 테마 그대로)
await ws(() => { const v = window.__dn.view; v.engine.transact((tx) => { const b = tx.createBlock({ x: -4800, y: -4800, w: 200, h: 60 }); tx.createContent({ blockId: b, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '바탕색 시험' }] }] } }); }, { origin: 'user' }); v.setCamera({ x: -5000, y: -5000, zoom: 1 }); });
await page.waitForTimeout(200);
const look = () => ws(() => {
  const r = window.__dn.view.root, t = [...document.querySelectorAll('.dn-block .dn-text')].find((el) => el.textContent.includes('바탕색 시험'));
  return { paper: r.dataset.paper ?? '', bg: getComputedStyle(r).backgroundColor, text: t ? getComputedStyle(t).color : null, grid: window.__dn.view.theme.grid, side: getComputedStyle(document.querySelector('.sidebar') ?? document.body).backgroundColor };
});
const lum = (rgb) => { const [r, g, b] = rgb.match(/\d+/g).map(Number); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
await openSettings();
await cs.getByRole('radio', { name: '옥스퍼드' }).click();
await page.waitForTimeout(150);
let lk = await look();
check('옥스퍼드: 옅은 노란 바탕 · 따뜻한 무늬 색 · 글은 어둡게', lk.paper === 'oxford' && lk.bg === 'rgb(253, 248, 228)' && lk.grid === '#e4d8ae' && lum(lk.text) < 90, JSON.stringify(lk));
await page.screenshot({ path: `${OUT}/paper-oxford.png` });
await cs.getByRole('radio', { name: '어둡게' }).click();
await page.waitForTimeout(150);
lk = await look();
check('어둡게: 캔버스만 어둡고 글은 밝게 — 사이드바는 밝은 테마 그대로', lk.paper === 'dark' && lum(lk.bg) < 50 && lum(lk.text) > 200 && lum(lk.side) > 240 && lk.grid === '#343434', JSON.stringify(lk));
await page.screenshot({ path: `${OUT}/paper-dark.png` });
await cs.getByRole('radio', { name: '흰색' }).click();
await page.waitForTimeout(150);
check('흰색', (await look()).paper === 'white' && (await look()).bg === 'rgb(255, 255, 255)');
await cs.getByRole('radio', { name: '테마 따라' }).click();
await page.waitForTimeout(150);
check('테마 따라: 표시를 떼고 노트에도 색을 지움', (await look()).paper === '' && (await ws(() => window.__dn.view.engine.note.paper?.color ?? null)) === null);
await ws(() => window.__dn.view.root.focus());
await page.keyboard.press('Control+z');
await page.waitForTimeout(150);
check('실행 취소 → 흰색으로', (await look()).paper === 'white' && (await cs.getByRole('radio', { name: '흰색' }).getAttribute('aria-checked')) === 'true');
await openSettings();
await cs.getByRole('radio', { name: '옥스퍼드' }).click();
await page.keyboard.press('Escape');
await page.waitForTimeout(100);
check('Esc로 창 닫힘', (await cs.count()) === 0);

// PNG: 배경 포함 / 미포함
const sizes = await ws(async () => {
  const v = window.__dn.view;
  const count = async (paper) => {
    const b = await v.exportPng({ paper });
    const bmp = await createImageBitmap(b); const c = new OffscreenCanvas(bmp.width, bmp.height); const g = c.getContext('2d'); g.drawImage(bmp, 0, 0);
    const d = g.getImageData(4, 0, 1, bmp.height).data; // 왼쪽 여백 세로줄 (상자 없음)
    const bg = [d[0], d[1], d[2]]; let n = 0;
    for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) > 12) n++;
    return n;
  };
  return { plain: await count(false), paper: await count(true) };
});
check('PNG: 기본은 단색 배경, 고르면 배경 포함', sizes.plain === 0 && sizes.paper > 10, JSON.stringify(sizes));

await page.waitForTimeout(800);
await page.reload();
await page.waitForFunction(() => window.__dn?.view?.engine, null, { timeout: 15000 });
check('새로 고침 후 노트 배경 유지 (모눈 · 옥스퍼드)', (await ws(() => window.__dn.view.engine.note.paper?.kind)) === 'grid' && (await ws(() => window.__dn.view.root.dataset.paper)) === 'oxford');
// 다른 노트는 제 바탕(없으면 테마 따라)
await ws(() => window.__dn.newNote());
await page.waitForTimeout(400);
check('다른 노트로 가면 그 노트 바탕 (새 노트는 테마 따라)', (await ws(() => window.__dn.view.root.dataset.paper ?? '')) === '');

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
