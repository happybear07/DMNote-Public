// 크기 조절 · 창 크기 (FR-016 · FR-155 · FR-153).
// 블록: 좁히면 글이 다시 흐르고(잘리지 않음), 사진은 비율 유지. 창 크기가 바뀌어도 입력 · 필기가 끊기지 않음.
// 다른 앱과 나란히(좁은 창): 옆 노트는 접혔다가 넓어지면 그대로, 가로 스크롤 없음. 사용: dev 서버 실행 후 `node e2e/resize.mjs`
import { chromium } from 'playwright-core';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
process.on('unhandledRejection', (e) => { if (!/TargetClosedError|has been closed/.test(String(e))) throw e; });

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
await page.waitForTimeout(300);
const box = (id) => ws((id) => { const b = window.__dn.view.engine.getBlock(id); return { x: b.x, y: b.y, w: b.w, h: b.h }; }, id);
const handle = async (id, corner) => { const r = await page.locator(`.dn-block[data-id="${id}"]`).boundingBox(); return { x: corner.includes('e') ? r.x + r.width : r.x, y: corner.includes('s') ? r.y + r.height : r.y }; };
async function drag(id, dx, dy) {
  await ws((id) => window.__dn.view.select([id]), id);
  await page.waitForTimeout(100);
  const p = await handle(id, 'se');
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + dx / 2, p.y + dy / 2, { steps: 4 });
  await page.mouse.move(p.x + dx, p.y + dy, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

// ── 글: 좁히면 다시 흐름 ──
const long = '줄이 길어서 블록을 좁히면 여러 줄로 다시 흘러야 하는 글입니다. '.repeat(3);
const text = await ws((t) => window.__dn.view.engine.transact((tx) => {
  const b = tx.createBlock({ x: 0, y: 0, w: 520, h: 60 });
  tx.createContent({ blockId: b, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] } });
  return b;
}, { origin: 'user' }).value, long);
await ws(() => window.__dn.view.fit());
await page.waitForTimeout(400);
const t0 = await box(text);
await drag(text, -260, 0);
const t1 = await box(text);
const clipped = await page.locator(`.dn-block[data-id="${text}"]`).evaluate((el) => el.scrollHeight > el.clientHeight + 1);
check('글 블록을 좁히면 다시 흘러 높이가 늘고 잘리지 않음', t1.w < t0.w - 100 && t1.h > t0.h && !clipped, JSON.stringify({ t0, t1, clipped }));

// ── 사진: 비율 유지 ──
await ws(async () => {
  const c = document.createElement('canvas'); c.width = 400; c.height = 200;
  const g = c.getContext('2d'); g.fillStyle = '#3d5fe0'; g.fillRect(0, 0, 400, 200);
  const f = new File([await new Promise((r) => c.toBlob(r, 'image/png'))], 'wide.png', { type: 'image/png' });
  const dt = new DataTransfer(); dt.items.add(f);
  const root = window.__dn.view.root; root.focus();
  window.__dn.view.select([]);
  root.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
});
await page.waitForFunction(() => document.querySelector('.dn-image img')?.complete && document.querySelector('.dn-image img').naturalWidth > 0, null, { timeout: 8000 }).catch(() => {});
const img = await ws(() => [...window.__dn.view.engine.blocks()].find((b) => window.__dn.view.engine.contentsOf(b.id)[0]?.type === 'image')?.id);
await ws(() => window.__dn.view.fit());
await page.waitForTimeout(400);
await drag(img, 160, -60); // 넓히면서 높이는 줄이기 — 사진은 늘어나지 않고 비율대로
const ratio = await page.locator(`.dn-block[data-id="${img}"] .dn-image img`).evaluate((el) => el.getBoundingClientRect().width / el.getBoundingClientRect().height);
const imgClipped = await page.locator(`.dn-block[data-id="${img}"]`).evaluate((el) => { const a = el.getBoundingClientRect(), i = el.querySelector('img').getBoundingClientRect(); return i.bottom > a.bottom + 1; });
check('사진 블록 크기를 바꿔도 사진 비율 유지 (2:1) · 잘리지 않음', Math.abs(ratio - 2) < 0.05 && !imgClipped, `ratio=${ratio.toFixed(3)} clipped=${imgClipped}`);

// ── 붙여 둔 상자 (10/29): 크게 끌어도 옆 · 아래 상자를 덮지 않고 이음매(16) 앞에서 멈춤 · 다른 상자는 그대로 ──
const [na, nb, nc] = await ws(() => {
  const mk = (tx, x, y, t) => { const b = tx.createBlock({ x, y, w: 220, h: 56 }); tx.createContent({ blockId: b, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] } }); return b; };
  return window.__dn.view.engine.transact((tx) => [mk(tx, 0, 900, '왼쪽'), mk(tx, 236, 900, '오른쪽'), mk(tx, 0, 1000, '아래')], { origin: 'user' }).value;
});
await ws(() => window.__dn.view.fit());
await page.waitForTimeout(400);
const nb0 = await box(nb), nc0 = await box(nc);
await drag(na, 300, 300);
const na1 = await box(na);
check('붙은 상자를 크게 끌면 옆 · 아래 이음매 앞에서 멈춤, 옆 · 아래 상자는 그대로',
  na1.x + na1.w === nb0.x - 16 && na1.y + na1.h === nc0.y - 16 && JSON.stringify(await box(nb)) === JSON.stringify(nb0) && JSON.stringify(await box(nc)) === JSON.stringify(nc0),
  JSON.stringify({ na1, nb0, nc0 }));

// ── 창 크기가 바뀌어도 입력이 끊기지 않음 (FR-155) ──
await ws((id) => window.__dn.view.startEditing(id, 'end'), text);
await page.waitForSelector('.dn-text-editing');
await page.keyboard.type('가나');
await page.setViewportSize({ width: 1100, height: 820 });
await page.waitForTimeout(300);
await page.keyboard.type('다라');
await page.waitForTimeout(150);
const typed = await ws((id) => JSON.stringify(window.__dn.view.engine.contentsOf(id)[0].doc), text);
check('입력 중 창 크기가 바뀌어도 이어서 입력', typed.includes('가나다라') && (await ws(() => window.__dn.view.editingId)) === text, typed.slice(-40));
await page.keyboard.press('Escape');
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(300);

// ── 필기 중 창 크기 변경 ──
await ws(() => { window.__dn.view.select([]); window.__dn.view.setTool('pen'); });
const s0 = await ws(() => [...window.__dn.view.engine.strokes()].length);
await page.mouse.move(700, 650);
await page.mouse.down();
await page.mouse.move(740, 670, { steps: 5 });
await page.setViewportSize({ width: 1300, height: 860 });
await page.waitForTimeout(200);
await page.mouse.move(780, 700, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(300);
const strokes = await ws(() => [...window.__dn.view.engine.strokes()]);
const last = strokes[strokes.length - 1];
check('필기 중 창 크기가 바뀌어도 획이 끊기지 않음 (한 획으로 저장)', strokes.length === s0 + 1 && (last?.points?.length ?? 0) >= 6, `${s0} → ${strokes.length}, points=${last?.points?.length}`);
await ws(() => window.__dn.view.setTool('select'));
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(200);

// ── 다른 앱과 나란히 (FR-153): 옆 노트를 연 채 창을 좁히기 ──
const other = await ws(async () => { const cur = window.__dn.state.currentId; await window.__dn.newNote(); const id = window.__dn.state.currentId; await window.__dn.openById(cur); return id; });
await page.waitForTimeout(400);
await ws((id) => window.__dn.openSide(id), other);
await page.waitForSelector('.side-pane');
const wide = await page.locator('.canvas-wrap').boundingBox();
for (const w of [700, 375]) {
  await page.setViewportSize({ width: w, height: 900 });
  await page.waitForTimeout(400);
  const cw = (await page.locator('.canvas-host').boundingBox())?.width ?? 0;
  const overflow = await ws(() => document.documentElement.scrollWidth > innerWidth + 1);
  const sideShown = await page.locator('.side-pane').isVisible();
  const main = await page.locator('.note-page, main').first().boundingBox();
  check(`창 ${w}px: 옆 노트는 접고 캔버스는 화면 폭을 다 씀 · 가로 스크롤 없음`, !sideShown && !overflow && cw >= (main?.width ?? w) - 2, `canvas=${cw} main=${main?.width} side=${sideShown} overflow=${overflow}`);
}
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(400);
check('다시 넓히면 옆 노트가 그대로', (await page.locator('.side-pane').isVisible()) && (await ws(() => window.__dn.state.side?.noteId)) === other
  && Math.abs(((await page.locator('.canvas-wrap').boundingBox())?.width ?? 0) - wide.width) < 4);

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
