// 용지 A4 (페이지 캔버스): 노트 정보 › 용지 → 종이 폭 맞춤 보기 · 책상 위 흰 종이, 내용을 종이 안으로(한 번에 실행 취소),
// 화면은 종이 둘레만, 블록 끌기 · 크기 조절 · 더블클릭 만들기 · 붙여넣기는 종이 폭 안, 넘치면 페이지가 늘어남, '+ 페이지', 가로, 끝없는 캔버스로.
// 사용: dev 서버 실행 후 `node e2e/sheet.mjs [스크린샷 폴더]`
import { chromium } from 'playwright-core';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2] ?? '.';
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
const wait = (ms) => page.waitForTimeout(ms);
await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(() => window.__dn.newNote());
await wait(300);
const PAD = 24, W = 794;
// 끝없는 캔버스에 넓게 흩어진 블록
const ids = await ws(() => window.__dn.view.engine.transact((tx) => [[-600, -200], [400, 100], [1600, 300]].map(([x, y], i) => {
  const b = tx.createBlock({ x, y, w: 300, h: 80 });
  tx.createContent({ blockId: b, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `블록 ${i + 1}` }] }] } });
  return b;
}), { origin: 'user' }).value);
await wait(200);
const boxes = () => ws((ids) => ids.map((id) => { const b = window.__dn.view.engine.getBlock(id); return b && { x: b.x, y: b.y, w: b.w, h: b.h }; }), ids);
const inPage = (r) => r.x >= PAD - 0.5 && r.x + r.w <= W - PAD + 0.5 && r.y >= PAD - 0.5;
const before = await boxes();

// 노트 정보 › 용지 → A4 세로
await ws(() => window.__dn.togglePanel(true));
await page.waitForSelector('.panel-page select[aria-label="용지"]');
await page.locator('.panel-page select[aria-label="용지"]').selectOption('a4');
await wait(700);
check('용지 A4 → 노트에 저장', JSON.stringify(await ws(() => window.__dn.view.engine.note.sheet)) === '{"size":"a4"}');
const after = await boxes();
check('흩어진 블록을 종이 안으로 (왼쪽 위 = 여백)', after.every(inPage) && Math.min(...after.map((r) => r.x)) === PAD && Math.min(...after.map((r) => r.y)) === PAD, JSON.stringify(after));
// 실행 취소 한 번 → 용지 · 블록 자리 모두 처음대로, 다시 실행 → A4
await ws(() => window.__dn.view.engine.undo());
await wait(200);
check('실행 취소 한 번에 A4 전환(용지 · 블록 자리) 되돌리기', !(await ws(() => window.__dn.view.engine.note.sheet)) && JSON.stringify((await boxes()).map((r) => [r.x, r.y])) === JSON.stringify(before.map((r) => [r.x, r.y])), JSON.stringify(await boxes()));
await ws(() => window.__dn.view.engine.redo());
await wait(200);
await ws(() => window.__dn.togglePanel(false));
await wait(500);
const cam = () => ws(() => ({ ...window.__dn.view.camera }));
const size = () => ws(() => window.__dn.view.root.getBoundingClientRect().toJSON());
let c = await cam(), sz = await size();
check('종이 한 장이 화면에 다 들어오게 (100% 이하)', c.zoom <= 1 && W * c.zoom <= sz.width - 96 + 1 && 1123 * c.zoom <= sz.height - 96 + 1, JSON.stringify(c));
// 책상(바깥)과 종이 색이 다르다
const px = (x, y) => ws(({ x, y }) => { const v = window.__dn.view, d = window.devicePixelRatio || 1; return [...v.under.getContext('2d').getImageData(Math.round(x * d), Math.round(y * d), 1, 1).data].slice(0, 3).join(','); }, { x, y });
const pageLeft = (0 - c.x) * c.zoom;
const desk = await px(Math.max(4, pageLeft / 2), 300), paper = await px(pageLeft + W * c.zoom / 2, 300);
check('책상 위 흰 종이 (바깥과 종이 색이 다름)', desk !== paper && paper === '255,255,255', `${desk} / ${paper}`);
await page.screenshot({ path: `${OUT}/sheet-a4.png` });

// 화면은 종이 둘레만
await ws(() => window.__dn.view.setCamera({ x: 5000, y: -4000, zoom: 1 }));
c = await cam();
check('멀리 옮겨도 종이 둘레로 돌아옴', c.x < W && c.x > -sz.width && c.y > -200 && c.y < 1123, JSON.stringify(c));
await ws(() => window.__dn.view.fit());
await wait(200);

// 끌어서 오른쪽 밖으로 → 종이 안에서 멈춤
const handle = async (id) => page.locator(`.dn-block[data-id="${id}"]`).boundingBox();
let bb = await handle(ids[0]);
await page.mouse.move(bb.x + 40, bb.y + 10);
await page.mouse.down();
await page.mouse.move(bb.x + 900, bb.y + 30, { steps: 8 });
await page.mouse.up();
await wait(250);
let r0 = (await boxes())[0];
check('끌어서 밖으로 → 종이 오른쪽 여백에서 멈춤', inPage(r0) && Math.abs(r0.x + r0.w - (W - PAD)) < 1, JSON.stringify(r0));
// 크기 조절로 밖으로 → 잘림
await ws((id) => window.__dn.view.select([id]), ids[1]);
await wait(100);
bb = await handle(ids[1]);
await page.mouse.move(bb.x + bb.width, bb.y + bb.height);
await page.mouse.down();
await page.mouse.move(bb.x + bb.width + 900, bb.y + bb.height, { steps: 6 });
await page.mouse.up();
await wait(250);
const r1 = (await boxes())[1];
check('크기 조절도 종이 오른쪽 여백까지', Math.abs(r1.x + r1.w - (W - PAD)) < 1, JSON.stringify(r1));

// 종이 밖(책상) 더블클릭 → 종이 안에 새 블록
c = await cam();
const n0 = await ws(() => window.__dn.view.engine.blockCount);
const rootBox = await size();
await page.evaluate(() => window.__dn.view.setTool('block'));
await page.mouse.click(rootBox.x + (W + 30 - c.x) * c.zoom, rootBox.y + 200);
await wait(300);
await page.keyboard.press('Escape');
const made = await ws(() => { const v = window.__dn.view, b = [...v.engine.blocks()].at(-1); return { n: v.engine.blockCount, r: { x: b.x, y: b.y, w: b.w, h: b.h } }; });
check('종이 밖을 눌러 상자를 만들어도 종이 안', made.n === n0 + 1 && inPage(made.r), JSON.stringify(made));

// 내용이 넘치면 페이지가 늘어나고, 마지막 페이지 옆 동그란 '+' (새 페이지)
await ws((id) => { const v = window.__dn.view; v.engine.transact((tx) => tx.set('block', id, { y: 1300 }), { origin: 'user' }); }, ids[2]);
await wait(300);
// 동그란 '+'는 마지막 페이지 바닥이 화면에 보일 때만 — 바닥을 화면에 넣는다
await ws(() => { const v = window.__dn.view; v.setCamera({ ...v.cam, y: 2 * 1123 + 40 - (v.size.h - 120) / v.cam.zoom }); });
await wait(200);
const addTop = async () => { const c = await cam(), b = await page.locator('.dn-sheet-add').boundingBox(), rb = await size(); return (b.y + b.height - rb.y) / c.zoom + c.y; };
const t2 = await addTop();
check('아래로 넘친 블록 → 2페이지 (마지막 페이지 옆 "+ 페이지")', Math.abs(t2 - (2 * 1123 + 40)) < 3, String(t2));
await page.locator('.dn-sheet-add').click();
await wait(300);
check('"+ 페이지" → 3페이지 · 새 페이지로 이동', (await ws(() => window.__dn.view.engine.note.sheet.pages)) === 3 && (await cam()).y > 1123, JSON.stringify(await cam()));

// 복제 · 화살표 이동도 종이 안
await ws((id) => { const v = window.__dn.view; v.select([id]); v.root.focus(); }, ids[0]);
await page.keyboard.press('Control+d');
await wait(300);
const dup = await ws(() => { const v = window.__dn.view, id = v.selectedBlocks[0], b = v.engine.getBlock(id); return { x: b.x, y: b.y, w: b.w, h: b.h }; });
check('복제한 블록도 종이 안 (위 · 오른쪽으로 나가지 않음)', inPage(dup), JSON.stringify(dup));
for (let i = 0; i < 12; i++) await page.keyboard.press('Shift+ArrowRight');
await wait(200);
const nud = await ws(() => { const v = window.__dn.view, b = v.engine.getBlock(v.selectedBlocks[0]); return { x: b.x, y: b.y, w: b.w, h: b.h }; });
check('화살표로 옮겨도 종이 오른쪽 여백에서 멈춤', inPage(nud) && Math.abs(nud.x + nud.w - (W - PAD)) < 1, JSON.stringify(nud));

// 가로
await ws(() => window.__dn.setNoteSheet({ size: 'a4', landscape: true, pages: 3 }));
await wait(500);
await ws((id) => window.__dn.view.select([id]), ids[1]);
bb = await handle(ids[1]);
await page.mouse.move(bb.x + 30, bb.y + 10);
await page.mouse.down();
await page.mouse.move(bb.x + 1500, bb.y + 10, { steps: 6 });
await page.mouse.up();
await wait(250);
const rl = (await boxes())[1];
check('A4 가로 → 종이 폭 1123', Math.abs(rl.x + rl.w - (1123 - PAD)) < 1, JSON.stringify(rl));

// 끝없는 캔버스로 → 제한 없음 · '+ 페이지' 숨김, 실행 취소 한 번에 A4 전환 되돌리기
await ws(() => window.__dn.setNoteSheet(null));
await wait(300);
await ws(() => window.__dn.view.setCamera({ x: 5000, y: -4000, zoom: 1 }));
check('끝없는 캔버스로 → 화면 제한 없음 · "+ 페이지" 숨김', (await cam()).x === 5000 && !(await page.locator('.dn-sheet-add').isVisible()));

// 필기만 있는 노트: A4로 바꾸면 필기가 종이 안으로, 아래까지 페이지가 생김
await ws(() => window.__dn.newNote());
await wait(300);
await ws(() => { const v = window.__dn.view; v.setTool('pen'); });
const rb = await size();
await page.mouse.move(rb.x + 200, rb.y + 200);
await page.mouse.down();
await page.mouse.move(rb.x + 300, rb.y + 260, { steps: 6 });
await page.mouse.up();
await ws(() => { const v = window.__dn.view, e = v.engine, s = [...e.strokes()][0]; e.transact((tx) => tx.set('stroke', s.id, { origin: { x: -400, y: 2600 } }), { origin: 'user' }); v.setTool('select'); });
await ws(() => window.__dn.setNoteSheet({ size: 'a4' }));
await wait(400);
const st = await ws(() => { const s = [...window.__dn.view.engine.strokes()][0]; return s.origin; });
check('필기만 있는 노트도 A4로 바꾸면 종이 안으로', st.x >= 0 && st.y >= 0 && st.y < 200, JSON.stringify(st));
await ws(() => { const e = window.__dn.view.engine, s = [...e.strokes()][0]; e.transact((tx) => tx.set('stroke', s.id, { origin: { x: 100, y: 2500 } }), { origin: 'user' }); });
await wait(200);
await ws(() => window.__dn.view.setCamera({ x: 0, y: 2300, zoom: 1 }));
check('아래쪽 필기까지 페이지가 늘고 화면이 따라감', (await cam()).y > 2000, JSON.stringify(await cam()));

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
