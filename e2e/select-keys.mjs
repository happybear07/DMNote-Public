// /선택 · /블록 선택 → 화살표로 옮기기 · Ctrl+화살표로 크기 (10/28 사용자 요청).
// Ctrl+↓ 늘리기 · Ctrl+↑ 줄이기(위 변 그대로), Ctrl+← 왼쪽으로 · Ctrl+→ 오른쪽으로 늘리기(반대쪽 변 그대로), Shift를 같이 누르면 그쪽 변을 안으로.
// 사용: dev 서버 실행 후 `node e2e/select-keys.mjs [스크린샷 폴더]` (DN_URL로 주소 변경)
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
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push(m.text()); });
const ws = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
const slash = async (q) => { await page.keyboard.type('/'); await wait(120); await page.keyboard.type(q); await wait(250); await page.keyboard.press('Enter'); await wait(400); };
const rect = (id) => ws((id) => { const b = window.__dn.view.engine.getBlock(id); return { x: b.x, y: b.y, w: b.w, h: b.h }; }, id);

await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(() => window.__dn.newNote({ sheet: null }));
await wait(300);

// 1) /선택 → 편집이 끝나고 그 상자가 골라짐
const id = await ws(async () => { window.__dn.view.addBlockAtCenter(); await new Promise((r) => setTimeout(r, 200)); return window.__dn.view.editingId; });
await page.keyboard.type('고를 상자 ');
await page.keyboard.type('/');
await wait(120);
await page.keyboard.type('선택');
await wait(250);
const items = await page.locator('.dn-slash:visible .dn-slash-item').allInnerTexts();
check('/ 메뉴에 "선택" · "블록 선택"', items.some((t) => /^선택/.test(t)) && items.some((t) => t.includes('블록 선택')), items.join('|'));
await page.locator('.dn-slash:visible .dn-slash-item', { hasText: /^선택/ }).first().click();
await wait(400);
const st = await ws(() => ({ editing: window.__dn.view.editingId, sel: window.__dn.view.selectedBlocks }));
check('/선택 → 편집 끝 · 그 상자가 골라짐 · 글은 그대로', !st.editing && st.sel.length === 1 && st.sel[0] === id && (await ws((id) => window.__dn.view.engine.contentsOf(id)[0].doc.content[0].content?.[0]?.text ?? '', id)).startsWith('고를 상자'), JSON.stringify(st));

// 2) 화살표로 옮기기 (1px · Shift 10px)
const r0 = await rect(id);
await page.keyboard.press('ArrowRight');
await page.keyboard.press('Shift+ArrowDown');
const r1 = await rect(id);
check('화살표로 옮기기 (→ 1px · Shift+↓ 10px), 크기는 그대로', r1.x === r0.x + 1 && r1.y === r0.y + 10 && r1.w === r0.w, JSON.stringify(r1));

// 3) Ctrl+↓ · Ctrl+↑: 위 변 그대로, 높이만
await page.keyboard.press('Control+ArrowDown');
await page.keyboard.press('Control+ArrowDown');
await wait(150);
const r2 = await rect(id);
check('Ctrl+↓ 두 번 → 높이 +20, 위 변 그대로', r2.y === r1.y && r2.h === r1.h + 20 && r2.x === r1.x, JSON.stringify(r2));
await page.keyboard.press('Control+ArrowUp');
await wait(150);
const r3 = await rect(id);
check('Ctrl+↑ → 높이 −10, 위 변 그대로', r3.y === r1.y && r3.h === r2.h - 10, JSON.stringify(r3));

// 4) Ctrl+← · Ctrl+→: 그쪽으로 늘리기, Ctrl+Shift면 그쪽 변을 안으로
await page.keyboard.press('Control+ArrowLeft');
await wait(100);
const r4 = await rect(id);
check('Ctrl+← → 왼쪽으로 10 늘림 (오른쪽 변 그대로)', r4.x === r3.x - 10 && r4.w === r3.w + 10 && r4.x + r4.w === r3.x + r3.w, JSON.stringify(r4));
await page.keyboard.press('Control+ArrowRight');
await wait(100);
const r5 = await rect(id);
check('Ctrl+→ → 오른쪽으로 10 늘림 (왼쪽 변 그대로)', r5.x === r4.x && r5.w === r4.w + 10, JSON.stringify(r5));
await page.keyboard.press('Control+Shift+ArrowLeft');
await page.keyboard.press('Control+Shift+ArrowRight');
await wait(100);
const r6 = await rect(id);
check('Ctrl+Shift+← · → → 양쪽 변을 안으로 10씩', r6.x === r5.x + 10 && r6.w === r5.w - 20, JSON.stringify(r6));
await page.screenshot({ path: `${OUT}/select-keys-01.png` });
await ws(() => window.__dn.view.undo());
await wait(150);
const r7 = await rect(id);
check('실행 취소 한 번 → 크기 바꾸기 전으로 (이어서 누른 크기 조절은 한 번에)', r7.w === r1.w && r7.h === r1.h && r7.x === r1.x, JSON.stringify(r7));

// 4-1) 붙여 둔 옆 상자 쪽으로는 안 커지고(덮지 않음), 옆 상자는 그대로 (10/29)
const nb = await ws((id) => {
  const e = window.__dn.view.engine, b = e.getBlock(id);
  return e.transact((tx) => { const n = tx.createBlock({ x: b.x + b.w + 16, y: b.y, w: 200, h: 56 }); tx.createContent({ blockId: n, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '옆 상자' }] }] } }); return n; }, { origin: 'user' }).value;
}, id);
await ws((id) => { window.__dn.view.select([id]); window.__dn.view.root.focus(); }, id);
const n0 = await rect(nb), r8 = await rect(id);
await page.keyboard.press('Control+ArrowRight');
await wait(150);
check('붙은 옆 상자 쪽 Ctrl+→ → 그대로(덮지 않음) · 옆 상자도 그대로 · 알림', JSON.stringify(await rect(id)) === JSON.stringify(r8) && JSON.stringify(await rect(nb)) === JSON.stringify(n0)
  && /닿아/.test(await page.locator('.dn-sr-live').first().textContent()), JSON.stringify(await rect(id)));
await page.keyboard.press('Control+ArrowLeft');
await wait(150);
const r9 = await rect(id);
check('반대쪽(Ctrl+←)은 그대로 커짐', r9.x === r8.x - 10 && r9.w === r8.w + 10, JSON.stringify(r9));

// 5) /블록 선택 → 묶음 전체
const ids = await ws(() => {
  const e = window.__dn.view.engine;
  const mk = (x, y, t) => e.transact((tx) => { const b = tx.createBlock({ x, y, w: 200, h: 56 }); tx.createContent({ blockId: b, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] } }); return b; }, { origin: 'user' }).value;
  return [mk(900, 0, '묶음 하나'), mk(900, 100, '묶음 둘')];
});
await ws((ids) => window.__dn.view.select(ids), ids);
await page.keyboard.press('Control+g');
await wait(200);
await ws((id) => window.__dn.view.startEditing(id, 'end'), ids[1]);
await wait(150);
await page.keyboard.type(' /'); // 슬래시 메뉴는 줄 맨 앞이나 띄어 쓴 뒤에서
await wait(120);
await page.keyboard.type('블록 선택');
await wait(250);
await page.locator('.dn-slash:visible .dn-slash-item', { hasText: '블록 선택' }).first().click();
await wait(400);
const gs = await ws(() => window.__dn.view.selectedBlocks.slice().sort());
check('/블록 선택 → 묶음 전체가 골라짐', JSON.stringify(gs) === JSON.stringify([...ids].sort()), JSON.stringify(gs));

check('콘솔 · 페이지 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close();
const fails = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fails}/${results.length} 통과`);
process.exit(fails ? 1 : 0);
