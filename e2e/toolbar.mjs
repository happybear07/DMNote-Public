// 아래 도구 막대: 선택 도구를 두 번 누르면 필기만 · 필기 뺀 콘텐츠 · 둘 다 (올가미는 따로 없음), '둘 다'로 상자 · 필기를 함께 고르고 옮기기
// (실행 취소 한 번), 글 상자 하나를 두 번 누르면 내용 · 제목 (고른 종류 기억), 화살표를 두 번 누르면 새 화살표 모양 8가지(고른 모양으로
// 그어짐 · 기억), 넣기 메뉴 📌로 사진 · 표 고정 → 막대에서 바로 넣기 ·
// 새로 고침 후에도 · 오른쪽 클릭으로 빼기.
// 사용: dev 서버 실행 후 `node e2e/toolbar.mjs [스크린샷 폴더]`
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
const tool = () => ws(() => window.__dn.view.tool);
const bar = page.locator('.toolbar');
const cursor = bar.locator('.select-tool > button');

check('올가미 단추는 따로 없음 (선택 도구로 합침)', (await bar.locator('button[aria-label="올가미 선택"]').count()) === 0);
await cursor.dblclick();
const modes = page.locator('.select-modes button');
check('선택 도구 두 번 누르기 → 세 가지 방식', (await modes.allInnerTexts()).map((t) => t.split('\n')[0]).join() === '필기 뺀 콘텐츠 선택,필기만 선택,둘 다 선택');
await page.screenshot({ path: `${OUT}/toolbar-modes.png` });
await modes.filter({ hasText: '필기만 선택' }).click();
await wait(100);
check('필기만 선택 → 올가미 도구', (await tool()) === 'lasso' && (await page.locator('.select-modes').count()) === 0);
await bar.locator('button[aria-label="펜"]').click();
await cursor.click();
check('다른 도구를 쓰다 선택 도구를 누르면 고른 방식 그대로', (await tool()) === 'lasso');

// 둘 다: 상자 하나 + 필기 한 획을 마키로 함께 고르고 옮기기
const box = await ws(() => window.__dn.view.engine.transact((tx) => {
  const b = tx.createBlock({ x: 0, y: 0, w: 240, h: 60 });
  tx.createContent({ blockId: b, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '상자' }] }] } });
  return b;
}, { origin: 'user' }).value);
await ws(() => { const v = window.__dn.view; v.setCamera({ x: -100, y: -100, zoom: 1 }); });
await wait(200);
const root = await page.locator('.dn-canvas').boundingBox();
await bar.locator('button[aria-label="펜"]').click();
await page.mouse.move(root.x + 120, root.y + 260);
await page.mouse.down();
await page.mouse.move(root.x + 260, root.y + 300, { steps: 8 });
await page.mouse.up();
await wait(200);
await cursor.dblclick();
await modes.filter({ hasText: '둘 다 선택' }).click();
await page.mouse.move(root.x + 40, root.y + 40);
await page.mouse.down();
await page.mouse.move(root.x + 400, root.y + 360, { steps: 6 });
await page.mouse.up();
await wait(150);
const picked = await ws(() => ({ blocks: window.__dn.view.selectedBlocks.length, ink: window.__dn.view.ink.selected.size }));
check('둘 다: 마키로 상자 · 필기를 함께 고름', picked.blocks === 1 && picked.ink === 1, JSON.stringify(picked));
const before = await ws((id) => ({ b: window.__dn.view.engine.getBlock(id).x, s: [...window.__dn.view.engine.strokes()][0].origin.x }), box);
const bb = await page.locator(`.dn-block[data-id="${box}"]`).boundingBox();
await page.mouse.move(bb.x + 50, bb.y + 20);
await page.mouse.down();
await page.mouse.move(bb.x + 130, bb.y + 60, { steps: 6 });
await page.mouse.up();
await wait(200);
const after = await ws((id) => ({ b: window.__dn.view.engine.getBlock(id).x, s: [...window.__dn.view.engine.strokes()][0].origin.x }), box);
check('둘 다: 끌면 상자와 필기가 같이 옮겨짐', Math.round(after.b - before.b) === 80 && Math.round(after.s - before.s) === 80, JSON.stringify({ before, after }));
await ws(() => window.__dn.view.engine.undo());
await wait(100);
const undone = await ws((id) => ({ b: window.__dn.view.engine.getBlock(id).x, s: [...window.__dn.view.engine.strokes()][0].origin.x }), box);
check('실행 취소 한 번에 둘 다 제자리', JSON.stringify(undone) === JSON.stringify(before), JSON.stringify(undone));
check('둘 다로 필기를 고르면 필기 막대(색 · 지우기)', (await page.locator('.ink-bar').count()) === 1 && (await page.locator('.ink-bar .ink-swatch').count()) > 0);
const pos = () => ws((id) => ({ b: window.__dn.view.engine.getBlock(id)?.x ?? null, s: [...window.__dn.view.engine.strokes()][0]?.origin.x ?? null }), box);
const counts = () => ws(() => ({ blocks: window.__dn.view.selectedBlocks.length, ink: window.__dn.view.ink.selected.size, tool: window.__dn.view.tool }));
const p0 = await pos();
await page.keyboard.press('ArrowRight');
const p1 = await pos();
check('둘 다: 화살표 키로 상자 · 필기 함께 한 칸', p1.b - p0.b === 1 && p1.s - p0.s === 1, JSON.stringify({ p0, p1 }));
await page.keyboard.press('Escape');
const esc = await counts();
check('둘 다: Esc 한 번에 상자 · 필기 선택 해제 (도구는 그대로)', esc.blocks === 0 && esc.ink === 0 && esc.tool === 'both', JSON.stringify(esc));
const marquee = async (x0, y0, x1, y1) => { await page.mouse.move(root.x + x0, root.y + y0); await page.mouse.down(); await page.mouse.move(root.x + x1, root.y + y1, { steps: 6 }); await page.mouse.up(); await wait(120); };
await marquee(40, 40, 400, 360);
const nb = await ws(() => window.__dn.view.engine.blockCount);
await page.keyboard.press('Delete');
await wait(100);
const del = await ws(() => ({ n: window.__dn.view.engine.blockCount, s: [...window.__dn.view.engine.strokes()].length }));
check('둘 다: Delete로 상자 · 필기를 함께 지움', del.n === nb - 1 && del.s === 0, JSON.stringify(del));
await ws(() => window.__dn.view.engine.undo());
await wait(100);
check('실행 취소 한 번에 상자 · 필기 모두 돌아옴', (await ws(() => window.__dn.view.engine.blockCount)) === nb && (await ws(() => [...window.__dn.view.engine.strokes()].length)) === 1);
// 필기만 고른 뒤 다른 상자를 누르면 필기 선택은 풀린다 (끌 때 따라오지 않게)
const box2 = await ws(() => window.__dn.view.engine.transact((tx) => tx.createBlock({ x: 520, y: 0, w: 200, h: 60 }), { origin: 'user' }).value);
await wait(150);
await marquee(100, 230, 300, 330);
const inkOnly = await counts();
const b2 = await page.locator(`.dn-block[data-id="${box2}"]`).boundingBox();
await page.mouse.click(b2.x + 40, b2.y + 20);
await wait(100);
const after2 = await counts();
check('둘 다: 다른 상자를 누르면 앞서 고른 필기는 풀림', inkOnly.ink === 1 && inkOnly.blocks === 0 && after2.ink === 0 && after2.blocks === 1, JSON.stringify({ inkOnly, after2 }));
// Shift+마키는 고른 필기에 더한다
await marquee(100, 230, 300, 330);
await page.keyboard.down('Shift');
await marquee(60, 60, 360, 140);
await page.keyboard.up('Shift');
const add = await counts();
check('둘 다: Shift+마키는 이미 고른 필기를 그대로 두고 더함', add.ink === 1 && add.blocks === 1, JSON.stringify(add));
// 고른 방식은 Esc · 다른 도구 뒤에도 그대로
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
check('고른 방식은 Esc 뒤에도 그대로 (둘 다)', (await tool()) === 'both');
// 키보드로 선택 방식 메뉴: ↑로 열고 ↓ · Enter로 고르기, Esc로 닫기
await cursor.focus();
await page.keyboard.press('ArrowUp');
await wait(80);
check('선택 단추에서 ↑ → 방식 메뉴 (고른 방식에 초점)', (await page.locator('.select-modes').count()) === 1 && (await ws(() => document.activeElement?.getAttribute('aria-checked'))) === 'true');
await page.keyboard.press('Escape');
await wait(80);
check('Esc → 메뉴 닫고 선택 단추로', (await page.locator('.select-modes').count()) === 0 && (await ws(() => document.activeElement?.closest('.select-tool') !== null)));
await page.keyboard.press('ArrowUp');
await page.keyboard.press('Home');
await page.keyboard.press('Enter');
await wait(80);
check('키보드로 방식 고르기 (Home → 필기 뺀 콘텐츠)', (await tool()) === 'select' && (await page.locator('.select-modes').count()) === 0);
// 좁은 화면(폰)에서도 방식 메뉴가 화면 안에 보임 (도구 막대가 가로로 스크롤돼도)
await page.setViewportSize({ width: 390, height: 800 });
await wait(300);
await cursor.click({ button: 'right' });
await wait(120);
const mb = await page.locator('.select-modes').boundingBox();
check('폰 폭에서도 방식 메뉴가 화면 안에', !!mb && mb.x >= 0 && mb.y >= 0 && mb.x + mb.width <= 390 && mb.y + mb.height <= 800 && (await page.locator('.select-modes button').first().isVisible()), JSON.stringify(mb));
await page.keyboard.press('Escape');
await page.setViewportSize({ width: 1440, height: 900 });
await wait(300);

// 글 상자: 제목 · 내용 단추를 하나로 — 누르면 고른 종류, 두 번 누르면 내용 · 제목 고르기(기억), 단축키 T · B는 그대로
const textBtn = bar.locator('.text-tool > button');
check('제목 · 내용 상자 단추는 따로 없음 (글 상자 하나로)', (await bar.locator('button[aria-label="제목 상자"], button[aria-label="내용 상자"]').count()) === 0 && (await textBtn.count()) === 1);
await textBtn.click();
check('글 상자를 처음 누르면 내용 상자', (await tool()) === 'block' && (await textBtn.getAttribute('aria-label')) === '글 상자: 내용 상자');
await textBtn.dblclick();
const tmodes = page.locator('.text-modes button');
check('글 상자 두 번 누르기 → 내용 · 제목 상자', (await tmodes.allInnerTexts()).map((t) => t.split('\n')[0]).join() === '내용 상자,제목 상자');
await tmodes.filter({ hasText: '제목 상자' }).click();
await wait(80);
check('제목 상자 고르기 → 제목 도구 · 메뉴 닫힘', (await tool()) === 'title' && (await page.locator('.text-modes').count()) === 0);
const titles = () => ws(() => [...window.__dn.view.engine.contents()].filter((c) => c.role === 'title').length);
const t0 = await titles();
const cv = await page.locator('.dn-canvas').boundingBox();
await page.mouse.click(cv.x + cv.width - 260, cv.y + 220);
await wait(150);
await page.keyboard.type('글 상자 제목');
await page.keyboard.press('Escape');
await wait(150);
check('제목 상자로 빈 곳 누르기 → 제목 상자가 생김', (await titles()) === t0 + 1);
await bar.locator('button[aria-label="펜"]').click();
await textBtn.click();
check('다른 도구를 쓰다 글 상자를 누르면 고른 종류(제목) 그대로', (await tool()) === 'title' && (await textBtn.getAttribute('aria-label')) === '글 상자: 제목 상자');
await page.keyboard.press('b');
await wait(60);
const byKey = await textBtn.getAttribute('aria-label');
await page.keyboard.press('p');
await wait(60);
check('단축키 B는 지금만 내용 상자 — 기억은 제목 그대로', byKey === '글 상자: 내용 상자' && (await textBtn.getAttribute('aria-label')) === '글 상자: 제목 상자');

// 화살표: 두 번 눌러 새 화살표 모양 — 고른 모양으로 그어짐(기본은 style 없음 = 관계 기본), 상자에서 빈 곳으로 끈 화살표(끝이 점, 11/09)도 같은 모양
const arrowBtn = bar.locator('.arrow-tool > button');
const [L, R, D] = await ws(() => window.__dn.view.engine.transact((tx) => {
  const mk = (x, y, t) => { const b = tx.createBlock({ x, y, w: 200, h: 60 }); tx.createContent({ blockId: b, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] } }); return b; };
  return [mk(2000, 0, '왼쪽'), mk(2500, 0, '오른쪽'), mk(2000, 300, '아래')];
}, { origin: 'user' }).value);
await ws(() => window.__dn.view.setCamera({ x: 1900, y: -150, zoom: 1 }));
await wait(200);
await arrowBtn.dblclick();
const amodes = page.locator('.arrow-modes button');
check('화살표 두 번 누르기 → 새 화살표 모양 8가지', (await amodes.allInnerTexts()).map((t) => t.split('\n')[0]).join() === '기본 화살표,파선 화살표,점선 화살표,물결 화살표,한 번 감긴 화살표,용수철 화살표,곡선 화살표,꺾은선 화살표');
await amodes.filter({ hasText: '한 번 감긴 화살표' }).click();
await wait(80);
check('한 번 감긴 화살표 고르기 → 화살표 도구', (await tool()) === 'arrow' && (await arrowBtn.getAttribute('aria-label')) === '화살표: 한 번 감긴 화살표');
const mid = async (id) => { const r = await page.locator(`.dn-block[data-id="${id}"]`).boundingBox(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; };
const drag = async (p, q) => { await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(q.x, q.y, { steps: 10 }); await page.mouse.up(); await wait(200); };
const arrowOf = (f, t) => ws(([f, t]) => { const a = [...window.__dn.view.engine.arrows()].find((x) => x.from.blockId === f && (!t || x.to.blockId === t)); return a ? { to: a.to.blockId, point: a.to.point ?? null, style: a.style ?? null } : null; }, [f, t]);
await drag(await mid(L), await mid(R));
const curlArrow = await arrowOf(L, R);
check('고른 모양으로 그어짐 (line: curl)', curlArrow?.style?.line === 'curl', JSON.stringify(curlArrow));
await page.screenshot({ path: `${OUT}/toolbar-arrow-curl.png` });
await arrowBtn.dblclick();
await amodes.filter({ hasText: '기본 화살표' }).click();
await drag(await mid(L), await mid(D));
check('기본 화살표 → 모양을 저장하지 않음 (관계 기본)', (await arrowOf(L, D))?.style === null);
await arrowBtn.dblclick();
await amodes.filter({ hasText: '용수철 화살표' }).click();
const dm = await mid(D), nBlocks = await ws(() => window.__dn.view.engine.blockCount);
await drag(dm, { x: dm.x + 520, y: dm.y + 40 });
await page.keyboard.press('Escape');
await wait(100);
const toNew = await arrowOf(D);
check('상자에서 빈 곳으로 끈 화살표 — 새 상자 없이 끝이 점, 고른 모양 (용수철)', !!toNew?.point && !toNew.to && toNew.style?.line === 'spring' && (await ws(() => window.__dn.view.engine.blockCount)) === nBlocks, JSON.stringify(toNew));

// 넣기 메뉴 📌 → 도구 막대에 고정
await bar.locator('.insert-btn').click();
await page.waitForSelector('.insert-menu');
await page.locator('#ins-image .insert-pin').click();
// 키보드: 찾기 칸에서 Ctrl+P → 지금 항목 고정 (빠른 전환 창은 열리지 않음)
await page.locator('.insert-search').fill('표');
await wait(100);
await page.keyboard.press('Control+p');
await wait(150);
check('넣기 메뉴에서 Ctrl+P → 고정 (빠른 전환은 안 열림)', (await page.locator('#ins-table .insert-pin.on').count()) === 1 && (await page.locator('.insert-menu').count()) === 1 && (await ws(() => window.__dn.state.overlay ?? null)) == null);
await page.keyboard.press('Escape');
await wait(150);
check('넣기 메뉴 📌 → 사진 · 표가 도구 막대에', (await bar.locator('.pinned').count()) === 2 && (await bar.locator('.pinned[aria-label="표 넣기"]').count()) === 1);
await page.reload();
await page.waitForSelector('.toolbar', { timeout: 15000 });
await wait(300);
check('새로 고침 후에도 고정 그대로', (await page.locator('.toolbar .pinned').count()) === 2);
check('새로 고침 후에도 글 상자 종류 기억 (제목)', (await page.locator('.toolbar .text-tool > button').getAttribute('aria-label')) === '글 상자: 제목 상자');
check('새로 고침 후에도 새 화살표 모양 기억 (용수철)', (await page.locator('.toolbar .arrow-tool > button').getAttribute('aria-label')) === '화살표: 용수철 화살표' && (await ws(() => window.__dn.view.arrowStyle?.line)) === 'spring');
const n0 = await ws(() => window.__dn.view.engine.blockCount);
await page.locator('.toolbar .pinned[aria-label="표 넣기"]').click();
await page.waitForSelector('.dn-table-picker');
await page.locator('.dn-tp-form input[name="열"]').fill('4');
await page.locator('.dn-tp-form button').click();
await wait(300);
await page.keyboard.press('Escape');
const tables = await ws(() => [...window.__dn.view.engine.contents()].filter((c) => c.type === 'table').length);
check('고정한 표 단추 → 바로 표 넣기', (await ws(() => window.__dn.view.engine.blockCount)) === n0 + 1 && tables >= 1);
await page.locator('.toolbar .pinned[aria-label="사진 넣기"]').click({ button: 'right' });
await wait(150);
check('오른쪽 클릭으로 고정 풀기', (await page.locator('.toolbar .pinned').count()) === 1);
await page.locator('.toolbar .pinned').click({ button: 'right' });

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
