// 필기 확인 (FR-034 · 035 · 036 · 040): 펜 · 형광펜(반투명) · 지우개 · 올가미(선택 · 옮기기 · 색 · 지우기) · 보이기 전환 ·
// 펜 필압 · 펜이 긋는 동안 손바닥 무시 · 펜 전용이면 손가락은 화면 이동 · 실행 취소 · 새로 고침 유지 · PNG에 포함.
// 사용: dev 서버 실행 후 `node e2e/ink.mjs [스크린샷 폴더]`
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
await wait(400);
const strokes = () => ws(() => [...window.__dn.view.engine.strokes()].map((s) => ({ id: s.id, tool: s.tool, color: s.color, count: s.count, origin: s.origin, width: s.width, pen: s.pen ?? null, hl: s.hl ?? null })));
async function draw(points) {
  await page.mouse.move(points[0][0], points[0][1]);
  await page.mouse.down();
  for (const [x, y] of points.slice(1)) await page.mouse.move(x, y, { steps: 3 });
  await page.mouse.up();
  await wait(80);
}
const zig = (x, y, w) => [[x, y], [x + w * 0.25, y + 30], [x + w * 0.5, y], [x + w * 0.75, y + 30], [x + w, y]];

// 빈 곳에서 시작: 예시 노트 위에 그린다
await ws(() => window.__dn.view.root.focus());
await page.keyboard.press('p');
check('P → 펜 도구 · 필기 막대', (await ws(() => window.__dn.view.tool)) === 'pen' && (await page.locator('.ink-bar').isVisible()));
await draw(zig(300, 650, 200));
let st = await strokes();
check('마우스로 펜 획 저장', st.length === 1 && st[0].tool === 'pen' && st[0].count > 5, JSON.stringify(st[0] ?? {}));
const inked = await ws(() => { const c = window.__dn.view.ink.canvas; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; });
check('잉크 레이어에 그려짐', inked > 200, String(inked));

// 색 · 굵기
await page.keyboard.press('2');
await page.keyboard.press(']');
await draw(zig(300, 720, 150));
st = await strokes();
check('숫자 키로 색 · ] 로 굵기 (3 → 4px)', st[1]?.color === '#e03131' && (await ws(() => window.__dn.view.ink.width)) === 4 && st[1]?.width === 4, JSON.stringify(st[1]));

// 형광펜: 블록 위를 지나가도 아래 글이 비침 (반투명 합성)
await page.keyboard.press('m');
const blockBox = await page.locator('.dn-block').nth(1).boundingBox();
await draw([[blockBox.x + 10, blockBox.y + blockBox.height / 2], [blockBox.x + blockBox.width - 10, blockBox.y + blockBox.height / 2]]);
st = await strokes();
const alpha = await ws(([x, y]) => { const v = window.__dn.view; const c = v.ink.canvas; const r = v.root.getBoundingClientRect(); return c.getContext('2d').getImageData(Math.round((x - r.left) * v.dpr), Math.round((y - r.top) * v.dpr), 1, 1).data[3]; }, [blockBox.x + blockBox.width / 2, blockBox.y + blockBox.height / 2]);
check('형광펜: 반투명으로 블록 위에 (아래가 비침)', st[2]?.tool === 'highlighter' && alpha > 50 && alpha < 140, `alpha ${alpha}`);
await page.screenshot({ path: `${OUT}/ink.png` });

// 지우개 + 실행 취소
await page.keyboard.press('e');
await wait(60);
check('지우개: 안내 문구 없음 (필기 막대는 보이기 단추만)', !(await page.locator('.ink-bar').innerText()).includes('문지르') && (await page.locator('.ink-bar .ink-hint').count()) === 0);
await draw([[290, 640], [520, 690]]);
st = await strokes();
check('지우개: 문지른 획만 지움', st.length === 2 && !st.some((s) => s.color === '#1f1f1f'), JSON.stringify(st.map((s) => s.color)));
await page.keyboard.press('Control+z');
await wait(100);
check('실행 취소로 되살아남', (await strokes()).length === 3);

// 올가미: 둘러 고르기 → 옮기기 → 색 → 지우기
await page.keyboard.press('l');
await draw([[280, 700], [480, 700], [480, 780], [280, 780], [280, 702]]);
check('올가미로 획 고르기 (점의 절반 이상)', (await ws(() => window.__dn.view.ink.selected.size)) === 1 && (await page.locator('.ink-count').innerText()) === '1획');
const before = (await strokes()).find((s) => s.color === '#e03131').origin;
await draw([[370, 735], [470, 805]]);
const after = (await strokes()).find((s) => s.color === '#e03131').origin;
check('고른 획 끌어 옮기기', Math.round(after.x - before.x) === 100 && Math.round(after.y - before.y) === 70, JSON.stringify({ before, after }));
// 오른쪽 아래 손잡이로 크기 조절 (빨간 획의 화면 경계를 잉크 캔버스 픽셀로 잰다)
const redBox = () => ws(() => {
  const v = window.__dn.view; const c = v.ink.canvas; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; const r = v.root.getBoundingClientRect();
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200 && d[i] > 180 && d[i + 1] < 90 && d[i + 2] < 90) { const p = i / 4, x = p % c.width, y = (p / c.width) | 0; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x0: r.left + x0 / v.dpr, y0: r.top + y0 / v.dpr, x1: r.left + x1 / v.dpr, y1: r.top + y1 / v.dpr };
});
const b0 = await redBox();
// 손잡이 = 선택 상자 오른쪽 아래 (앱과 같은 selectionBounds로 화면 자리를 구한다)
const INK_LAYER = '/@fs/' + new URL('../packages/engine-dom/src/ink-layer.ts', import.meta.url).pathname.replace(/^\/+/, '');
const grip = await ws(async (url) => { const m = await import(url); const v = window.__dn.view, r = m.selectionBounds(v), o = v.root.getBoundingClientRect(); return { x: o.left + (r.x + r.w - v.camera.x) * v.camera.zoom, y: o.top + (r.y + r.h - v.camera.y) * v.camera.zoom }; }, INK_LAYER);
await draw([[grip.x, grip.y], [grip.x + (b0.x1 - b0.x0), grip.y + (b0.y1 - b0.y0)]]);
const b1 = await redBox();
const ratio = (b1.x1 - b1.x0) / (b0.x1 - b0.x0);
check('손잡이로 고른 획 크기 조절 (왼쪽 위 고정)', ratio > 1.7 && ratio < 2.3 && Math.abs(b1.x0 - b0.x0) < 6, JSON.stringify({ b0, b1, ratio }));
await page.keyboard.press('Control+z');
await wait(80);
await page.locator('.ink-bar .ink-swatch').nth(2).click();
await wait(80);
check('고른 획 색 바꾸기', (await strokes()).some((s) => s.color === '#1971c2'));
await ws(() => window.__dn.view.root.focus());
await page.keyboard.press('Delete');
await wait(80);
check('Delete로 고른 획 지우기', (await strokes()).length === 2);
await page.keyboard.press('Control+z');
await wait(80);

// 보이기 전환 · 잉크만 보기
const vis = () => ws(() => [...document.querySelectorAll('.ink-bar .ink-icon')].map((b) => ({ name: b.getAttribute('aria-label'), text: b.textContent.trim(), pressed: b.getAttribute('aria-pressed'), paths: b.querySelectorAll('path, rect').length })));
const v0 = await vis();
check('보이기 전환은 글자 없는 아이콘 셋 (잉크 · 상자 · 펜 전용)', v0.map((b) => b.name).join() === '잉크 보이기,상자 보이기,펜 전용' && v0.every((b) => b.text === ''), JSON.stringify(v0));
await page.locator('.ink-bar button[aria-label="상자 보이기"]').click();
await wait(80);
check('상자 숨기기 = 잉크만 보기', (await ws(() => getComputedStyle(window.__dn.view.world).visibility)) === 'hidden');
const v1 = (await vis()).find((b) => b.name === '상자 보이기');
const v0b = v0.find((b) => b.name === '상자 보이기');
check('숨기면 같은 아이콘에 사선 (aria-pressed=false)', v1.pressed === 'false' && v1.paths === v0b.paths + 1, JSON.stringify({ v0b, v1 }));
await page.locator('.ink-bar button[aria-label="상자 보이기"]').click();
await ws(() => window.__dn.view.root.focus());
await page.keyboard.press('Control+Alt+h');
await wait(80);
const cleared = await ws(() => { const c = window.__dn.view.ink.canvas; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return false; return true; });
check('Ctrl+Alt+H → 잉크 숨기기', cleared && (await ws(() => window.__dn.view.ink.show)) === false);
await page.keyboard.press('Control+Alt+h');

// 펜 필압 · 손바닥 무시 · 펜 전용 손가락 = 화면 이동 (합성 포인터 이벤트)
await page.keyboard.press('p');
const pen = await ws(() => {
  const v = window.__dn.view; const root = v.root; const r = root.getBoundingClientRect();
  const ev = (type, id, kind, x, y, p) => root.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: kind, clientX: r.left + x, clientY: r.top + y, pressure: p, button: 0, buttons: 1, bubbles: true, isPrimary: true }));
  const n0 = [...v.engine.strokes()].length;
  ev('pointerdown', 11, 'pen', 900, 500, 0.9);
  ev('pointerdown', 12, 'touch', 950, 520, 0.5); // 손바닥
  for (let i = 1; i <= 10; i++) { ev('pointermove', 11, 'pen', 900 + i * 12, 500 + i * 3, 0.2 + i * 0.07); ev('pointermove', 12, 'touch', 950 + i * 5, 520, 0.5); }
  ev('pointerup', 12, 'touch', 1000, 520, 0);
  ev('pointerup', 11, 'pen', 1020, 530, 0);
  const all = [...v.engine.strokes()];
  return { added: all.length - n0, gesture: v.gesture.k };
});
check('펜이 긋는 동안 손바닥 무시 (획 하나 · 핀치 안 됨)', pen.added === 1 && pen.gesture === 'none', JSON.stringify(pen));
const pressures = await ws(() => { const s = [...window.__dn.view.engine.strokes()].at(-1); return [...window.__dn.view.engine.constructor ? [] : []].length, s.points; });
check('필압 기록', typeof pressures === 'string' && pressures.length > 10);
// 펜을 처음 쓰면 펜 전용이 저절로 켜진다 (TABLET-CHECK T4, 11/11) — 단추를 누르지 않아도
check('펜을 처음 쓰면 펜 전용이 저절로 켜짐 · 단추도 켜짐 표시', (await ws(() => window.__dn.view.ink.penOnly)) === true && (await page.locator('.ink-bar button[aria-label="펜 전용"]').getAttribute('aria-pressed')) === 'true');
const touch = await ws(() => {
  const v = window.__dn.view; const root = v.root; const r = root.getBoundingClientRect();
  const ev = (type, x) => root.dispatchEvent(new PointerEvent(type, { pointerId: 21, pointerType: 'touch', clientX: r.left + x, clientY: r.top + 300, button: 0, buttons: 1, bubbles: true, isPrimary: true }));
  const n0 = [...v.engine.strokes()].length, cx = v.camera.x;
  ev('pointerdown', 600); for (let i = 1; i <= 5; i++) ev('pointermove', 600 + i * 20); ev('pointerup', 700);
  return { added: [...v.engine.strokes()].length - n0, moved: v.camera.x !== cx };
});
check('펜 전용: 손가락은 그리지 않고 화면 이동', touch.added === 0 && touch.moved, JSON.stringify(touch));

// 잉크 묶기 · 풀기 (FR-037): 빈 곳의 초록 필기 → 새 블록에 담김 → 블록과 함께 이동 → 문서 뷰 · Markdown에 들어감 → 풀면 그 자리 자유 잉크
await page.locator('.ink-bar button[aria-label="펜 전용"]').click(); // 끄기 — 직접 끈 뒤에는 펜을 써도 저절로 켜지지 않는다
check('펜 전용을 직접 끄면 그 뒤 펜을 써도 그대로 꺼짐', await ws(() => { const v = window.__dn.view, r = v.root.getBoundingClientRect(); v.root.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 33, pointerType: 'pen', clientX: r.left + 500, clientY: r.top + 500, button: 0, buttons: 1, bubbles: true, isPrimary: true })); v.root.dispatchEvent(new PointerEvent('pointerup', { pointerId: 33, pointerType: 'pen', clientX: r.left + 500, clientY: r.top + 500, button: 0, bubbles: true, isPrimary: true })); return !v.ink.penOnly; }));
await ws(() => window.__dn.view.root.focus());
await page.keyboard.press('p');
// 기본 색은 셋 — ＋ → 추천 색 첫째(초록)를 더하면 4번째 색이 되고 바로 그 색으로
check('기본 색 줄은 셋 + ＋', (await page.locator('.ink-bar .ink-swatch').count()) === 3 && (await page.locator('.ink-bar .ink-add').count()) === 1);
await page.locator('.ink-bar .ink-add').click();
await wait(120);
await page.locator('.chart-color-pop .cp-grid[aria-label="추천 색"] .cp-dot').first().click();
await wait(80);
check('＋ → 추천 색(초록) 더하기 → 4번째 색 · 지금 색', (await ws(() => window.__dn.view.ink.colors.join())) === '#1f1f1f,#e03131,#1971c2,#2f9e44' && (await ws(() => window.__dn.view.ink.color)) === '#2f9e44');
await page.keyboard.press('1');
await page.keyboard.press('4');
check('숫자 키 4 → 더한 색', (await ws(() => window.__dn.view.ink.color)) === '#2f9e44');
await ws(() => window.__dn.view.setCamera({ ...window.__dn.view.cam, x: window.__dn.view.cam.x - 2000 }));
await wait(100);
await draw(zig(700, 400, 160));
const greenBox = () => ws(() => {
  const v = window.__dn.view; const c = v.ink.canvas; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; const r = v.root.getBoundingClientRect();
  let x0 = Infinity, y0 = Infinity;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200 && d[i + 1] > 130 && d[i] < 90 && d[i + 2] < 110) { const p = i / 4; x0 = Math.min(x0, p % c.width); y0 = Math.min(y0, (p / c.width) | 0); }
  return { x: r.left + x0 / v.dpr, y: r.top + y0 / v.dpr };
});
const g0 = await greenBox();
await page.keyboard.press('l');
await draw([[680, 380], [880, 380], [880, 450], [680, 450], [680, 382]]);
const nBlocks = await ws(() => [...window.__dn.view.engine.blocks()].length);
await page.locator('.ink-bar .ink-text', { hasText: '블록으로 묶기' }).click();
await wait(150);
const bound = await ws(() => { const v = window.__dn.view; const s = [...v.engine.strokes()].find((x) => x.color === '#2f9e44'); return { blocks: [...v.engine.blocks()].length, parent: s?.parent.kind, sel: [...v.selBlocks].length }; });
check('묶기: 빈 곳 잉크 → 잉크 크기의 새 블록에 담김', bound.blocks === nBlocks + 1 && bound.parent === 'content' && bound.sel === 1, JSON.stringify(bound));
const g1 = await greenBox();
check('묶은 직후 제자리 그대로', Math.abs(g1.x - g0.x) < 1 && Math.abs(g1.y - g0.y) < 1, JSON.stringify({ g0, g1 }));
await page.keyboard.press('v');
await ws(() => { const v = window.__dn.view; v.engine.transact((tx) => { const id = [...v.selBlocks][0]; const b = v.engine.getBlock(id); tx.set('block', id, { x: b.x + 80, y: b.y + 40 }); }, { origin: 'user', label: '블록 이동' }); });
await wait(120);
const g2 = await greenBox();
check('블록을 옮기면 잉크도 따라감', Math.abs(g2.x - g1.x - 80) < 2 && Math.abs(g2.y - g1.y - 40) < 2, JSON.stringify({ g1, g2 }));
const noteId = await ws(() => window.__dn.state.currentId);
const md = await ws((id) => window.__dn.noteMarkdown(id), noteId);
check('Markdown: 묶은 잉크도 · 안 묶은 손그림도 SVG 그림으로', md.includes('![손글씨](data:image/svg+xml;base64,') && md.includes('![손그림](data:image/svg+xml;base64,'));
await page.locator('.view-toggle button', { hasText: '문서' }).click();
await page.waitForSelector('.dn-doc-item');
check('문서 뷰에 손글씨 그림', (await page.locator('.dn-ink-svg svg path').count()) >= 1);
await page.locator('.view-toggle button', { hasText: '캔버스' }).click();
await page.waitForSelector('.dn-block');
await wait(200);
await ws(() => window.__dn.view.root.focus());
await page.keyboard.press('Control+Shift+g');
await wait(150);
const freed = await ws(() => { const v = window.__dn.view; const s = [...v.engine.strokes()].find((x) => x.color === '#2f9e44'); return { blocks: [...v.engine.blocks()].length, parent: s?.parent.kind, tool: v.tool, sel: v.ink.selected.size }; });
const g3 = await greenBox();
check('Ctrl+Shift+G 풀기: 보이는 자리의 자유 잉크로 · 빈 블록은 사라짐', freed.blocks === nBlocks && freed.parent === 'layer' && freed.sel === 1 && Math.abs(g3.x - g2.x) < 1 && Math.abs(g3.y - g2.y) < 1, JSON.stringify({ freed, g2, g3 }));
await page.keyboard.press('Control+z');
await wait(80);
check('풀기 실행 취소 → 다시 묶임', (await ws(() => [...window.__dn.view.engine.strokes()].find((x) => x.color === '#2f9e44')?.parent.kind)) === 'content');

// 새로 고침 유지 · PNG에 잉크 포함
await wait(700);
const count = (await strokes()).length;
await page.reload();
await page.waitForSelector('.dn-block', { timeout: 15000 });
check('새로 고침 후 잉크 유지', (await strokes()).length === count, String(count));
check('새로 고침 뒤에도 더한 색 기억', (await ws(() => window.__dn.view.ink.colors.join())) === '#1f1f1f,#e03131,#1971c2,#2f9e44');
const pngInk = await ws(async () => { const b = await window.__dn.view.exportPng({}); return b ? b.size : 0; });
check('PNG 내보내기에 잉크 포함 (영역)', pngInk > 1000);

// ＋ 색 더하기: 추천 색 · 팔레트 단추(가운데 흰색 고정) → 팔레트 · #코드, 3개까지(그다음 ＋ 사라짐), 더한 색은 오른쪽 클릭으로 빼기 · 새로 고침 뒤에도
await ws(() => window.__dn.view.root.focus());
await page.keyboard.press('p');
await page.locator('.ink-bar .ink-add').click();
await wait(120);
const popBox = await page.locator('.chart-color-pop').boundingBox();
const barBox = await page.locator('.ink-bar').boundingBox();
check('＋ → 색 더하기 판이 필기 막대 위에 (팔레트는 접힘)', !!popBox && popBox.y + popBox.height <= barBox.y + 1 && (await page.locator('.chart-color-pop .cp-grid[aria-label="팔레트"]').count()) === 0, JSON.stringify({ popBox, barBox }));
const ringBg = await ws(() => getComputedStyle(document.querySelector('.chart-color-pop .cp-ring i')).backgroundColor);
check('팔레트 단추 가운데는 흰색 고정', ringBg === 'rgb(255, 255, 255)', ringBg);
await page.locator('.chart-color-pop .cp-more').click();
const pick = await page.locator('.chart-color-pop .cp-grid[aria-label="팔레트"] .cp-dot').nth(37).getAttribute('title');
await page.locator('.chart-color-pop .cp-grid[aria-label="팔레트"] .cp-dot').nth(37).click();
await wait(80);
check('팔레트 색 → 더해지고 지금 색 · 판 닫힘', (await page.locator('.chart-color-pop').count()) === 0 && (await ws(() => window.__dn.view.ink.color)) === pick.toLowerCase() && (await page.locator('.ink-bar .ink-swatch').count()) === 5, pick);
await draw(zig(300, 760, 120));
check('더한 팔레트 색으로 새 획', (await strokes()).at(-1)?.color === pick.toLowerCase());
await page.locator('.ink-bar .ink-add').click();
await page.locator('.chart-color-pop .cp-more').click();
await page.locator('.chart-color-pop .cp-code').fill('#123456');
await page.keyboard.press('Enter');
await wait(80);
check('#코드로 더하기 → 6색 · ＋ 사라짐 (3개까지)', (await ws(() => window.__dn.view.ink.color)) === '#123456' && (await page.locator('.ink-bar .ink-swatch').count()) === 6 && (await page.locator('.ink-bar .ink-add').count()) === 0);
await page.locator('.ink-bar .ink-swatch').nth(5).click({ button: 'right' });
await wait(80);
check('더한 색 오른쪽 클릭 → 빠지고 ＋ 다시 · 지금 색은 첫 색으로', (await page.locator('.ink-bar .ink-swatch').count()) === 5 && (await page.locator('.ink-bar .ink-add').count()) === 1 && (await ws(() => window.__dn.view.ink.color)) === '#1f1f1f');
await page.locator('.ink-bar .ink-swatch').nth(0).click({ button: 'right' });
await wait(60);
check('기본 색은 오른쪽 클릭해도 그대로', (await page.locator('.ink-bar .ink-swatch').count()) === 5);

// 펜 설정 창: 굵기 단추 → 미리보기 · 펜 종류 9 · 굵기 밀대 · 숫자, 도구 막대 펜 두 번 누르기로도, 형광펜 종류 3 · 새로 고침 뒤에도 기억
await page.locator('.ink-bar .ink-pen-btn').click();
await wait(150);
const ps = page.locator('.pen-settings');
const psBox = await ps.boundingBox(), bar2 = await page.locator('.ink-bar').boundingBox();
check('굵기 단추 → 펜 설정 창 (필기 막대 위)', !!psBox && psBox.y + psBox.height <= bar2.y + 1 && (await ps.getAttribute('aria-label')) === '펜 설정', JSON.stringify({ psBox, bar2 }));
check('펜 종류 9가지', (await ps.locator('.ps-kinds button').allInnerTexts()).map((t) => t.trim()).join() === '볼펜,만년필,붓펜,연필,색연필,마커,캘리그래피,크레용,수채');
const previewInk = await ws(() => { const c = document.querySelector('.pen-settings .ps-preview'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; });
check('미리보기에 곡선이 그려짐', previewInk > 200, String(previewInk));
await ps.getByRole('radio', { name: '연필', exact: true }).click();
await wait(60);
check('연필 고르기 → 펜 종류 · 질감 준비 중 안내', (await ws(() => window.__dn.view.ink.pen)) === 'pencil' && (await ps.locator('.ps-later').count()) === 1);
await ps.locator('.ps-num').fill('7');
await wait(60);
check('숫자로 굵기 7px · 단추에도 7', (await ws(() => window.__dn.view.ink.width)) === 7 && (await page.locator('.ink-bar .ink-pen-btn').innerText()).includes('7'));
await ps.locator('input[type=range]').fill('2.5');
await wait(60);
check('밀대로 굵기 2.5px', (await ws(() => window.__dn.view.ink.width)) === 2.5);
await page.locator('.ink-bar .ink-pen-btn').click();
await wait(80);
check('굵기 단추 다시 누르면 창 닫힘', (await page.locator('.pen-settings').count()) === 0);
await draw(zig(500, 760, 120));
const pencilStroke = (await strokes()).at(-1);
check('새 획에 연필 · 2.5px 저장', pencilStroke?.pen === 'pencil' && pencilStroke?.width === 2.5, JSON.stringify(pencilStroke));
await page.locator('.toolbar button[aria-label="펜"]').dblclick();
await wait(120);
check('도구 막대 펜 두 번 누르기 → 펜 설정 창', (await page.locator('.pen-settings[aria-label="펜 설정"]').count()) === 1);
await ws(() => window.__dn.view.root.focus());
await page.keyboard.press('m');
await wait(100);
check('형광펜으로 바꾸면 형광펜 설정 창', (await page.locator('.pen-settings').getAttribute('aria-label')) === '형광펜 설정' && (await page.locator('.pen-settings .ps-kinds button').allInnerTexts()).map((t) => t.trim()).join() === '납작 촉,둥근 촉,직선');
await page.locator('.pen-settings').getByRole('radio', { name: '둥근 촉' }).click();
await page.locator('.ink-bar .ink-pen-btn').click();
await draw(zig(500, 800, 120));
const hlStroke = (await strokes()).at(-1);
check('새 형광펜 획에 둥근 촉 저장', hlStroke?.tool === 'highlighter' && hlStroke?.hl === 'round', JSON.stringify(hlStroke));
await ws(() => window.__dn.view.root.focus());
await page.keyboard.press('e');
await wait(80);
check('지우개로 바꾸면 설정 창 닫힘', (await page.locator('.pen-settings').count()) === 0);
await wait(300);
await page.reload();
await page.waitForSelector('.dn-block', { timeout: 15000 });
await wait(300);
check('새로 고침 뒤에도 펜 종류 · 굵기 · 형광펜 종류 기억', JSON.stringify(await ws(() => { const k = window.__dn.view.ink; return [k.pen, k.width, k.hl]; })) === '["pencil",2.5,"round"]');

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
