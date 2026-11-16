// 캔버스 QA 1회차 고침 회귀 (docs/CANVAS-QA.md CQ-001 ~): 고치는 상자가 맨 위 · 표/그래프 Enter · 고른 상자에 바로 쓰기 · 만들기까지 되돌린 뒤 초점.
// 사용: dev 서버 실행 후 `node e2e/canvas-qa1.mjs`
import { chromium } from 'playwright-core';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const browser = await chromium.launch({ channel: process.env.DN_CHANNEL ?? 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
await ctx.addInitScript(() => localStorage.setItem('dn:no-env-key', '1'));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });
const ws = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
const para = (t) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });
const make = (specs) => ws((specs) => {
  const e = window.__dn.view.engine;
  const r = e.transact((tx) => specs.map((s) => { const b = tx.createBlock({ x: s.x, y: s.y, w: s.w ?? 280, h: s.h ?? 56 }); if (s.table) tx.createContent({ blockId: b, type: 'table', columns: [{ id: 'c1', name: '열' }], rows: [{ id: 'r1', order: 'a0', cells: {} }] }); else if (s.chart) tx.createContent({ blockId: b, type: 'chart', kind: 'bar', series: [{ id: 's1', name: '계열', points: [{ x: 'a', y: 1 }] }] }); else tx.createContent({ blockId: b, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: s.text }] }] } }); return b; }), { origin: 'user' });
  window.__dn.view.fit?.(true);
  return r.value;
}, specs);
const fresh = async () => { await ws(() => window.__dn.newNote({ sheet: null })); await page.waitForFunction(() => window.__dn.view.engine.blockCount === 0 && !window.__dn.view.engine.note.sheet); await wait(200); };

await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });

// CQ-001: 늘어난 상자가 아래 상자 밑에 깔리지 않는다
await fresh();
const [a] = await make([{ x: 0, y: 0, text: '위 상자' }, { x: 0, y: 72, text: '바로 아래 상자' }]);
await wait(400);
await ws((id) => window.__dn.view.startEditing(id, 'end'), a);
await wait(200);
for (const t of ['늘어난 줄 1', '늘어난 줄 2', '늘어난 줄 3']) { await page.keyboard.press('Enter'); await page.keyboard.type(t); }
await wait(400);
const top = await ws((id) => { const el = window.__dn.view.mounted.get(id).el; const ps = el.querySelectorAll('p'); const r = ps[ps.length - 1].getBoundingClientRect(); return document.elementFromPoint(r.left + 8, r.top + r.height / 2)?.closest('.dn-block')?.dataset.id === id; }, a);
check('CQ-001 늘어난 상자의 마지막 줄이 아래 상자 위에 보임', top);
await page.keyboard.press('Escape');

// CQ-002: 표 · 그래프를 고르고 Enter
await fresh();
const [tb, ch, tx] = await make([{ x: 0, y: 0, table: true, w: 300, h: 80 }, { x: 0, y: 200, chart: true, w: 300, h: 200 }, { x: 400, y: 0, text: '글' }]);
await wait(400);
await ws((id) => { window.__dn.view.select([id]); window.__dn.view.root.focus(); }, tb);
await page.keyboard.press('Enter');
await wait(300);
check('CQ-002 표를 고르고 Enter → 첫 칸 편집', (await page.locator('.dn-canvas td.dn-cell-editing, .canvas-host td.dn-cell-editing').count()) === 1);
await page.keyboard.press('Escape');
await wait(200);
await ws((id) => { window.__dn.view.select([id]); window.__dn.view.root.focus(); }, ch);
await page.keyboard.press('Enter');
await wait(300);
check('CQ-002 그래프를 고르고 Enter → 데이터 창 · 편집 중 상태로 갇히지 않음', (await ws(() => window.__dn.state.dialog?.kind)) === 'chart' && (await ws(() => window.__dn.view.editingId)) === null);
await page.keyboard.press('Escape');
await wait(200);

// CQ-003: 마우스로 고른 글 상자에 바로 치면 그 상자에 · 도구는 그대로
const box = await ws((id) => { const r = window.__dn.view.mounted.get(id).el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, tx);
await page.mouse.click(box.x, box.y);
await wait(200);
await page.keyboard.type('1번 메모');
await wait(300);
const txt = await ws((id) => JSON.stringify(window.__dn.view.engine.contentsOf(id)[0].doc), tx);
check('CQ-003 고른 상자에 바로 "1번 메모" → 그 상자에 글로 · 도구는 선택 그대로', txt.includes('글1번 메모') && (await ws(() => window.__dn.view._tool)) === 'select', `${txt.slice(-60)} ${await ws(() => window.__dn.view._tool)}`);
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
await wait(200);
// Tab으로 고르면 C는 연결
await ws(() => { window.__dn.view.select([]); window.__dn.view.root.focus(); });
await page.keyboard.press('Tab');
await wait(150);
await page.keyboard.press('c');
await wait(150);
const liveText = await page.locator('.dn-sr-live').innerText();
check('CQ-003 Tab으로 고른 뒤 C → 연결 모드 (키보드 접근 그대로, 글로 안 들어감)', /연결/.test(liveText) && !(await ws(() => JSON.stringify([...window.__dn.view.engine.contents()].map((c) => c.doc)))).includes('메모c'), liveText);
await page.keyboard.press('Escape');

// CQ-004: 편집 중 만들기까지 되돌리면 초점은 캔버스 → 다시 실행 · 단축키 동작
await fresh();
await ws(() => window.__dn.view.addBlockAtCenter());
await wait(200);
await page.keyboard.type('곧 사라질 글');
await wait(1200);
for (let i = 0; i < 4; i++) { await page.keyboard.press('Control+z'); await wait(150); }
const n0 = await ws(() => window.__dn.view.engine.blockCount);
const focusCanvas = await ws(() => !!document.activeElement?.closest?.('.canvas-host'));
await page.keyboard.press('Control+Shift+z');
await wait(250);
check('CQ-004 만들기까지 되돌린 뒤 초점은 캔버스 · Ctrl+Shift+Z로 다시 실행', n0 === 0 && focusCanvas && (await ws(() => window.__dn.view.engine.blockCount)) === 1, `${n0} ${focusCanvas}`);
await page.keyboard.press('t');
check('CQ-004 그 뒤 도구 단축키도 동작 (T → 제목 상자 도구)', (await ws(() => window.__dn.view._tool)) === 'title');

// CQ-005: 방향키로 옮겨도 다른 상자에 겹쳐 들어가지 않는다
await fresh();
const [qa, qc] = await make([{ x: 0, y: 0, text: '위 A' }, { x: 0, y: 300, text: '아래 C' }]);
await wait(400);
await ws((id) => { window.__dn.view.select([id]); window.__dn.view.root.focus(); }, qc);
for (let i = 0; i < 30; i++) await page.keyboard.press('Shift+ArrowUp');
await wait(200);
const AC = await ws(({ a, c }) => [window.__dn.view.engine.getBlock(a), window.__dn.view.engine.getBlock(c)].map((b) => ({ y: b.y, h: b.h })), { a: qa, c: qc });
check('CQ-005 Shift+↑로 올려도 A와 겹치지 않음 (닿기 직전까지)', AC[1].y >= AC[0].y + AC[0].h - 0.5, JSON.stringify(AC));

// CQ-006 · CQ-007: 연결점에서 이으면 받는 끝은 auto, 두 번 이어도 하나
const [ca, cb] = await make([{ x: 0, y: 600, text: '이을 A' }, { x: 500, y: 600, text: '받을 B' }]);
await wait(400);
const connectOnce = async () => {
  const pts = await ws(({ a, b }) => { const v = window.__dn.view, ra = v.mounted.get(a).el.getBoundingClientRect(), rb = v.mounted.get(b).el.getBoundingClientRect(); return { cx: ra.left + ra.width / 2, cy: ra.top + ra.height / 2, rx: ra.right + 12, ry: ra.top + ra.height / 2, tx: rb.left + 40, ty: rb.top + rb.height / 2 }; }, { a: ca, b: cb });
  await page.mouse.move(pts.cx, pts.cy); await wait(150);
  await page.mouse.move(pts.rx, pts.ry); await wait(150);
  await page.mouse.down(); await page.mouse.move(pts.tx, pts.ty, { steps: 6 }); await page.mouse.up();
  await wait(300);
};
await connectOnce();
let arrows = await ws(({ a, b }) => window.__dn.view.engine.arrowsOf(a).filter((x) => x.from.blockId === a && x.to.blockId === b).map((x) => x.to.side), { a: ca, b: cb });
check('CQ-006 연결점에서 이은 화살표의 받는 끝은 보이는 변으로 (auto)', JSON.stringify(arrows) === '["auto"]', JSON.stringify(arrows));
await connectOnce();
arrows = await ws(({ a, b }) => window.__dn.view.engine.arrowsOf(a).filter((x) => x.from.blockId === a && x.to.blockId === b).length, { a: ca, b: cb });
check('CQ-007 같은 두 상자를 다시 이어도 화살표는 하나', arrows === 1, String(arrows));

// CQ-008: Ctrl+C → 빈 곳 → Ctrl+V 로 블록 사본, Ctrl+X는 지우고 붙여넣기
const n1 = await ws(() => window.__dn.view.engine.blockCount);
await ws((id) => { window.__dn.view.select([id]); window.__dn.view.root.focus(); }, ca);
await page.keyboard.press('Control+c');
await wait(200);
await ws(() => { window.__dn.view.select([]); window.__dn.view.root.focus(); });
await page.keyboard.press('Control+v');
await wait(500);
check('CQ-008 Ctrl+C · Ctrl+V → 블록 사본', (await ws(() => window.__dn.view.engine.blockCount)) === n1 + 1, `${n1} → ${await ws(() => window.__dn.view.engine.blockCount)}`);
await ws((id) => { window.__dn.view.select([id]); window.__dn.view.root.focus(); }, cb);
await page.keyboard.press('Control+x');
await wait(300);
const cut = await ws((id) => !window.__dn.view.engine.getBlock(id), cb);
await ws(() => window.__dn.view.root.focus());
await page.keyboard.press('Control+v');
await wait(500);
check('CQ-008 Ctrl+X → 지워지고 Ctrl+V로 다시', cut && (await ws(() => JSON.stringify([...window.__dn.view.engine.contents()].map((c) => c.doc)))).includes('받을 B'));

// CQ-009: A4 두 쪽 — 쪽 아래로 밀면 틈에 걸치지 않고 다음 쪽으로
await ws(() => window.__dn.newNote({ sheet: { size: 'a4', pages: 2 } }));
await wait(400);
const [pg] = await make([{ x: 40, y: 1000, text: '쪽 끝 상자' }]);
await wait(300);
await ws((id) => { window.__dn.view.select([id]); window.__dn.view.root.focus(); }, pg);
for (let i = 0; i < 6; i++) await page.keyboard.press('Shift+ArrowDown');
await wait(200);
const py = await ws((id) => { const b = window.__dn.view.engine.getBlock(id); return { y: b.y, h: b.h }; }, pg);
check('CQ-009 쪽 아래로 밀면 틈에 걸치지 않고 2쪽 위 여백 아래로', py.y + py.h <= 1123 - 24 + 0.5 || py.y >= 1123 + 40 + 24 - 0.5, JSON.stringify(py));
for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowUp');
await wait(200);
const py2 = await ws((id) => window.__dn.view.engine.getBlock(id).y, pg);
check('CQ-009 위로 밀면 1쪽 아래로 돌아갈 수 있음', py2 + py.h <= 1123 - 24 + 0.5, String(py2));

// CQ-019: 25%에서 두 번 눌러 편집 → 100%로 다가감
await fresh();
const [z1] = await make([{ x: 0, y: 0, text: '작게 본 상자' }]);
await wait(300);
await ws(() => window.__dn.view.setCamera({ zoom: 0.25, x: -800, y: -600 }));
await wait(300);
// 25%에서는 블록을 간략 그림으로 그린다(DOM 없음) — 월드 좌표를 화면 좌표로
const zb = await ws((id) => { const v = window.__dn.view, b = v.engine.getBlock(id), o = v.root.getBoundingClientRect(), p = v.toScreen({ x: b.x + b.w / 2, y: b.y + b.h / 2, w: 0, h: 0 }); return { x: o.left + p.x, y: o.top + p.y }; }, z1);
await page.mouse.dblclick(zb.x, zb.y);
await wait(400);
check('CQ-019 25%에서 편집 시작 → 100%로', (await ws(() => window.__dn.view.cam.zoom)) === 1 && (await ws(() => window.__dn.view.editingId)) === z1);

// CQ-011: 편집 중 고르기 막대 → 휠로 화면을 옮기면 거둠
await page.keyboard.press('End');
for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowLeft');
await wait(250);
const bubbleOn = await page.locator('.dn-bubble:not([hidden])').count();
await page.mouse.move(700, 450);
await page.mouse.wheel(0, 400);
await wait(300);
check('CQ-011 화면을 옮기면 고르기 막대를 거둠', bubbleOn > 0 && (await page.locator('.dn-bubble:not([hidden])').count()) === 0, String(bubbleOn));
await page.keyboard.press('Escape');

// CQ-020: 25%로도 다 안 들어가면 왼쪽 위 블록이 보이게
await fresh();
const [far1] = await make([{ x: -5500, y: -5500, text: '왼쪽 위 멀리' }, { x: 11500, y: 11500, text: '오른쪽 아래 멀리' }]);
await ws(() => window.__dn.view.fit());
await wait(400);
const vis = await ws((id) => { const v = window.__dn.view, b = v.engine.getBlock(id), p = v.toScreen({ x: b.x, y: b.y, w: b.w, h: b.h }), w = b.w * v.cam.zoom, h = b.h * v.cam.zoom; return p.x + w > 0 && p.x < v.size.w && p.y + h > 0 && p.y < v.size.h; }, far1);
check('CQ-020 맞춤: 다 안 들어가면 왼쪽 위 블록부터 보임', vis);

// CQ-021: 데이터베이스 블록 오른쪽 클릭 → 블록 메뉴
await fresh();
await ws(() => window.__dn.view.root.focus());
await page.keyboard.press('/');
await page.waitForSelector('.insert-menu');
await page.keyboard.type('데이터베이스');
await page.keyboard.press('Enter');
await wait(600);
const db = await ws(() => { const el = document.querySelector('.canvas-host .dn-db'); const t = el?.querySelector('.dn-db-title, .dn-db-head, h3, input') ?? el; const r = (el?.closest('.dn-block') ?? el).getBoundingClientRect(); return { x: r.left + r.width - 10, y: r.top + 6 }; });
await page.keyboard.press('Escape');
await page.mouse.click(db.x, db.y, { button: 'right' });
await wait(300);
check('CQ-021 데이터베이스 블록 오른쪽 클릭 → 블록 메뉴', (await page.locator('.menu[aria-label="블록 메뉴"]').count()) === 1);
await page.keyboard.press('Escape');
check('콘솔 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close();
const bad = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
