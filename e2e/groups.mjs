// 블록 = 콘텐츠 묶음: 상자 여럿 고르고 Ctrl+G(또는 메뉴) → 한 블록 · 사이드바 노트 아래 블록 이름, 상자를 누르거나 끌면 그 상자만,
// 이름표 · 테두리 선으로 묶음째 고르고 옮기기(10/29 — 안쪽 빈 곳은 고르지 않고, 끌면 그 콘텐츠들만 하나씩) · 모서리로 같은 배율 크기 조절(글자까지), 밖에서 끈 마키는 묶음째, 사이드바 블록 → 이동 · 이름 바꾸기, 풀기 · 실행 취소.
// 사용: dev 서버 실행 후 `node e2e/groups.mjs [스크린샷 폴더]`
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
const ids = await ws(() => window.__dn.view.engine.transact((tx) => {
  const mk = (x, y, w, role, text) => { const b = tx.createBlock({ x, y, w, h: 50 }); tx.createContent({ blockId: b, type: 'text', role, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } }); return b; };
  const title = mk(0, 0, 300, 'title', '고양이 사진');
  const body = mk(0, 80, 300, 'body', '창가에서 졸고 있는 고양이');
  const pic = tx.createBlock({ x: 340, y: 0, w: 200, h: 150 });
  tx.createContent({ blockId: pic, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '(사진 자리)' }] }] } });
  const other = mk(0, 400, 300, 'body', '다른 메모');
  return [title, body, pic, other];
}, { origin: 'user' }).value);
const [title, body, pic, other] = ids;
await ws(() => window.__dn.view.fit());
await wait(400);
const sel = () => ws(() => [...window.__dn.view.selBlocks].sort());
const box = (id) => page.locator(`.dn-block[data-id="${id}"]`).boundingBox();
const rect = (id) => ws((id) => { const b = window.__dn.view.engine.getBlock(id); return { x: b.x, y: b.y, w: b.w, h: b.h, fs: b.fontScale ?? 1 }; }, id);

// 고르고 Ctrl+G
await ws((ids) => { window.__dn.view.select(ids); window.__dn.view.root.focus(); }, [title, body, pic]);
await page.keyboard.press('Control+g');
await wait(300);
const gid = await ws((id) => window.__dn.view.engine.getBlock(id).group, title);
check('Ctrl+G → 한 블록으로 묶임', !!gid && (await ws(({ ids, gid }) => ids.every((id) => window.__dn.view.engine.getBlock(id).group === gid), { ids: [title, body, pic], gid })));
await page.waitForSelector('.note-blocks .block-item');
check('사이드바: 노트 아래에 블록 (이름 = 첫 제목)', (await page.locator('.note-blocks .block-item').allInnerTexts()).map((t) => t.replace('▣', '').trim()).join() === '고양이 사진');
await page.screenshot({ path: `${OUT}/groups.png` });

// 상자를 누르면 그 상자 하나 · 이름표 · 테두리 선을 누르면 묶음째 · 안쪽 빈 곳은 묶음을 고르지 않음 (10/29)
await ws(() => window.__dn.view.select([]));
let b = await box(body);
await page.mouse.click(b.x + 40, b.y + 20);
await wait(150);
check('묶음의 상자를 누르면 그 상자 하나만', JSON.stringify(await sel()) === JSON.stringify([body]), JSON.stringify(await sel()));
const tb = await box(title), pcb = await box(pic);
const tag = { x: tb.x + 12, y: tb.y - 8 - 10 }; // 이름표: 묶음 테두리(상자 바깥 8px) 위 18px
await page.mouse.click(tag.x, tag.y);
await wait(150);
check('이름표를 누르면 블록 전체', JSON.stringify(await sel()) === JSON.stringify([title, body, pic].sort()), JSON.stringify(await sel()));
await ws(() => window.__dn.view.select([]));
const bb = await box(body);
await page.mouse.click(tb.x - 8, bb.y + bb.height / 2); // 왼쪽 테두리 선 (상자 바깥 8px)
await wait(150);
check('테두리 선을 누르면 블록 전체', JSON.stringify(await sel()) === JSON.stringify([title, body, pic].sort()), JSON.stringify(await sel()));
const gap = { x: (tb.x + tb.width + pcb.x) / 2, y: pcb.y + pcb.height - 10 }; // 글 상자와 사진 사이 빈 곳 (테두리 안)
await page.mouse.click(gap.x, gap.y);
await wait(150);
check('안쪽 빈 곳을 누르면 블록이 골라지지 않음 (선택 풀림)', (await sel()).length === 0, JSON.stringify(await sel()));
await wait(600); // 두 번 누르기로 잡히지 않게
await page.mouse.move(gap.x, tb.y + 5); // 제목 상자와 사진 사이 위쪽 빈 곳 → 본문 상자 아래쪽까지 (사진은 안 걸침)
await page.mouse.down();
await page.mouse.move(tb.x + 20, bb.y + bb.height - 10, { steps: 6 });
await page.mouse.up();
await wait(200);
check('안쪽 빈 곳에서 끌면 걸친 콘텐츠만 하나씩 (묶음째 아님)', JSON.stringify(await sel()) === JSON.stringify([title, body].sort()), JSON.stringify(await sel()));

// 묶음 안 상자를 끌면 그 상자만 (묶음을 고른 채여도)
const drag = async (p, dx, dy) => { await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + dx, p.y + dy, { steps: 6 }); await page.mouse.up(); await wait(250); };
const r0 = await Promise.all([title, body, pic].map(rect));
await drag({ x: pcb.x + 40, y: pcb.y + 30 }, 60, 40);
const ra = await Promise.all([title, body, pic].map(rect));
const movedA = ra.map((r, i) => [Math.round(r.x - r0[i].x), Math.round(r.y - r0[i].y)]);
check('묶음 안 상자를 끌면 그 상자만 옮겨짐', (movedA[2][0] || movedA[2][1]) && !movedA[0][0] && !movedA[0][1] && !movedA[1][0] && !movedA[1][1] && JSON.stringify(await sel()) === JSON.stringify([pic]), JSON.stringify(movedA));
check('옮긴 상자는 여전히 그 블록 안', (await ws((id) => window.__dn.view.engine.getBlock(id).group, pic)) === gid);
await ws(() => window.__dn.view.engine.undo());
await wait(200);

// 이름표를 끌면 묶음째 옮기기
await ws(() => window.__dn.view.select([]));
await drag(tag, 100, 60);
const r1 = await Promise.all([title, body, pic].map(rect));
const moved = r1.map((r, i) => [Math.round(r.x - r0[i].x), Math.round(r.y - r0[i].y)]);
check('이름표를 끌면 블록째 함께 옮겨짐 (세 상자 모두 같은 만큼)', moved.every((m) => m[0] === moved[0][0] && m[1] === moved[0][1] && (m[0] || m[1])), JSON.stringify(moved));

// 모서리 손잡이로 같은 배율 크기 조절
await ws((ids) => window.__dn.view.select(ids), [title, body, pic]);
await wait(150);
const corner = await ws(() => {
  const v = window.__dn.view, ids = [...v.selBlocks], rs = ids.map((id) => v.engine.blockRect(id));
  const x1 = Math.max(...rs.map((r) => r.x + r.w)), y1 = Math.max(...rs.map((r) => r.y + r.h)), o = v.root.getBoundingClientRect(), c = v.camera;
  return { x: o.left + (x1 - c.x) * c.zoom + 8, y: o.top + (y1 - c.y) * c.zoom + 8 };
});
const u0 = await ws(() => { const v = window.__dn.view, rs = [...v.selBlocks].map((id) => v.engine.blockRect(id)); return Math.max(...rs.map((r) => r.x + r.w)) - Math.min(...rs.map((r) => r.x)); });
await page.mouse.move(corner.x, corner.y);
await page.mouse.down();
await page.mouse.move(corner.x + u0 * 0.5 * (await ws(() => window.__dn.view.camera.zoom)), corner.y + 40, { steps: 8 });
await page.mouse.up();
await wait(300);
const r2 = await Promise.all([title, body, pic].map(rect));
const f = r2[2].w / r1[2].w;
check('모서리로 크기 조절 → 세 상자가 같은 배율 · 글자도 (왼쪽 위 고정)', f > 1.3 && f < 1.7 && Math.abs(r2[0].fs - f) < 0.05 && Math.abs(r2[0].x - r1[0].x) < 1 && Math.abs(r2[2].x - (r1[0].x + (r1[2].x - r1[0].x) * f)) < 2, JSON.stringify({ f, r1, r2 }));
await ws(() => window.__dn.view.engine.undo());
await wait(200);

// 마키가 한 상자만 걸쳐도 블록째
await ws(() => window.__dn.view.select([]));
const pb = await box(pic);
await page.mouse.move(pb.x + pb.width + 30, pb.y - 30);
await page.mouse.down();
await page.mouse.move(pb.x + pb.width - 10, pb.y + 10, { steps: 5 });
await page.mouse.up();
await wait(150);
check('마키가 한 상자만 걸쳐도 블록 전체', JSON.stringify(await sel()) === JSON.stringify([title, body, pic].sort()), JSON.stringify(await sel()));

// 블록 메뉴: 이름 · 풀기 — 묶음째 메뉴는 이름표를 오른쪽 클릭 (콘텐츠를 오른쪽 클릭하면 그 콘텐츠 메뉴)
const tb3 = await box(title);
await page.mouse.click(tb3.x + 12, tb3.y - 18, { button: 'right' });
const menu = page.locator('.menu[aria-label="블록 메뉴"]');
await menu.waitFor();
check('블록 메뉴: 블록 이름 · 묶음 풀기', (await menu.locator('.menu-head').first().innerText()).includes('고양이 사진') && (await menu.locator('button', { hasText: '묶음 풀기' }).count()) === 1);
await page.keyboard.press('Escape');

// 사이드바: 블록 → 이동 · 이름 바꾸기
await ws(() => { window.__dn.view.setCamera({ x: 3000, y: 3000, zoom: 1 }); window.__dn.view.select([]); });
await page.locator('.note-blocks .block-item').first().click();
await wait(500);
const inView = await ws((id) => { const v = window.__dn.view, r = v.engine.blockRect(id), c = v.camera, s = v.root.getBoundingClientRect(); const x = (r.x - c.x) * c.zoom, y = (r.y - c.y) * c.zoom; return x >= 0 && y >= 0 && x < s.width && y < s.height; }, title);
check('사이드바 블록을 누르면 그 블록으로 이동 · 블록 선택', inView && (await sel()).length === 3);
await page.locator('.note-blocks .block-item').first().dblclick();
await page.locator('.note-blocks input').fill('반려묘');
await page.keyboard.press('Enter');
await wait(400);
check('사이드바에서 두 번 눌러 블록 이름 바꾸기', (await page.locator('.note-blocks .block-item').first().innerText()).includes('반려묘'));
// 사이드바 블록 오른쪽 클릭 → 이동 · 이름 바꾸기 · 묶음 풀기 (AT-004 — 브라우저 메뉴였다)
const prevented4 = await page.evaluate(() => { const el = document.querySelector('.note-blocks .block-item'); const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 300 }); el.dispatchEvent(ev); return ev.defaultPrevented; });
await wait(250);
const rowItems = await page.locator('.row-menu [role=menuitem], .row-menu button').allInnerTexts();
check('사이드바 블록 오른쪽 클릭 → 블록 메뉴 (이동 · 이름 바꾸기 · 묶음 풀기)', prevented4 && ['이 블록으로 이동', '이름 바꾸기', '묶음 풀기'].every((t) => rowItems.some((x) => x.includes(t))), JSON.stringify(rowItems));
await page.keyboard.press('Escape');
await wait(150);

// 메뉴로 묶기 (다른 상자와), 풀기 · 실행 취소
await ws((ids) => window.__dn.view.select(ids), [other, title]);
const ob = await box(other);
await page.mouse.click(ob.x + 30, ob.y + 15, { button: 'right' });
await menu.waitFor();
check('다른 상자와 함께 고르면 "블록으로 묶기" (묶음째 합침)', (await menu.locator('button', { hasText: '블록으로 묶기' }).count()) === 1);
await page.keyboard.press('Escape');
await ws((id) => { window.__dn.view.select([id]); window.__dn.view.root.focus(); }, title);
await page.keyboard.press('Control+Shift+g');
await wait(300);
check('Ctrl+Shift+G → 풀기 · 사이드바 블록 없어짐', !(await ws((id) => window.__dn.view.engine.getBlock(id).group, title)) && (await page.locator('.note-blocks .block-item').count()) === 0);
await ws(() => window.__dn.view.engine.undo());
await wait(300);
check('실행 취소 → 다시 블록', (await page.locator('.note-blocks .block-item').count()) === 1);

// 사이드바 '이 노트'는 지금 노트의 블록만 (11/09 개편) — 다른 노트로 가면 그 노트 것으로, 열린 노트 탭으로 돌아오면 다시
const firstNote = await ws(() => window.__dn.state.currentId);
await ws(() => window.__dn.newNote());
await wait(500);
check('새 노트로 가면 블록 목록이 비어 섹션째 숨음', (await page.locator('.note-blocks .block-item').count()) === 0);
await page.locator('.open-tabs .tab-item', { hasText: '고양이 사진' }).first().click();
await wait(700);
const back = page.locator('.note-blocks .block-item', { hasText: '반려묘' });
check('열린 노트 탭으로 돌아오면 그 노트의 블록이 다시', (await ws(() => window.__dn.state.currentId)) === firstNote && (await back.count()) === 1);
await back.click();
await wait(500);
check('블록 줄을 누르면 그 블록(상자 셋)을 고름', (await sel()).length === 3);
// 블록 안 콘텐츠 줄 → 그 상자 하나
const item = page.locator('.note-blocks .box-items .box-item').first();
const itemId = await item.getAttribute('data-id');
await item.click();
await wait(500);
check('블록 안 콘텐츠 줄을 누르면 그 상자 하나를 고름', JSON.stringify(await sel()) === JSON.stringify([itemId]), JSON.stringify({ itemId, sel: await sel() }));

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
