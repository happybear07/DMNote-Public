// 오른쪽 클릭 › 글자 모양: 글꼴(지금 글꼴 · 누르면 목록) · 블록 글자 크기(px 숫자 · ▾ 목록) · 글자 색 · 정렬, 메뉴는 열린 채 여러 번, 배경색과 따로, 실행 취소,
// 글 편집 중 오른쪽 클릭 → 같은 메뉴 + 잘라내기/복사/붙여넣기/모두 선택(편집 유지), Shift+오른쪽 클릭은 브라우저 메뉴, Ctrl+Shift+> / <, 문서 뷰에도.
// 사용: dev 서버 실행 후 `node e2e/text-style.mjs [스크린샷 폴더]`
import { chromium } from 'playwright-core';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2] ?? '.';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
process.on('unhandledRejection', (e) => { if (!/TargetClosedError|has been closed/.test(String(e))) throw e; });

const browser = await chromium.launch({ channel: process.env.DN_CHANNEL ?? 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
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
const id = await ws(() => window.__dn.view.engine.transact((tx) => {
  const b = tx.createBlock({ x: 0, y: 0, w: 320, h: 60 });
  tx.createContent({ blockId: b, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '글자 모양 시험 문장' }] }] } });
  return b;
}, { origin: 'user' }).value);
await ws(() => window.__dn.view.fit());
await wait(400);
const blk = page.locator(`.dn-block[data-id="${id}"]`);
const style = () => ws((id) => { const b = window.__dn.view.engine.getBlock(id); return Object.fromEntries(['fontScale', 'textColor', 'align'].filter((k) => b[k] !== undefined).map((k) => [k, b[k]])); }, id);
const css = () => blk.locator('.dn-text').first().evaluate((el) => { const s = getComputedStyle(el); return { fs: parseFloat(s.fontSize), color: s.color, align: s.textAlign }; });
const menu = page.locator('.menu[aria-label="블록 메뉴"]');
const base = await css();
const h0 = await ws((id) => window.__dn.view.engine.getBlock(id).h, id);

// 오른쪽 클릭 → 글자
const bb = await blk.boundingBox();
await page.mouse.click(bb.x + 40, bb.y + 20, { button: 'right' });
await menu.waitFor();
await menu.locator('.menu-sub > button', { hasText: '글자 모양' }).click(); // 글자는 '글자 모양' 하위 메뉴 (DS-001)
const sizeBox = menu.locator('input[aria-label="글자 크기 (px)"]');
const typeSize = async (v) => { await sizeBox.click(); await page.keyboard.press('Control+a'); await page.keyboard.type(v); await page.keyboard.press('Enter'); await wait(250); };
check('오른쪽 클릭 → 글자 모양: 글꼴 단추 하나 · 크기 칸(px, 기본 12.5) — 가−/가+ · 작게~아주 크게 단추 없음 · 글자 색 10', (await menu.locator('.menu-head:not(.menu-head-one)').first().innerText()) === '글자' && (await menu.locator('.menu-head').first().getAttribute('class')).includes('menu-head-one') && (await sizeBox.inputValue()) === '12.5' && (await menu.locator('.fc-btn').innerText()).includes('기본 (고딕)') && (await menu.locator('.fs-step, .fs-presets, button[aria-label="글자 크게"]').count()) === 0 && (await menu.locator('.tc').count()) === 10);
// 글꼴: 지금 글꼴만 — 누르면 목록, 고르면 그 글꼴
await menu.locator('.fc-btn').click();
const fontOpts = await menu.locator('.fc-list[aria-label="글꼴"] [role="option"]').allInnerTexts();
await menu.locator('.fc-list [role="option"]', { hasText: '명조' }).click();
await wait(150);
check('글꼴 단추 → 목록(기본 (고딕) · 명조 · 고정폭) → 명조를 고르면 상자 글꼴 · 단추 글자가 명조 · 목록은 닫힘', fontOpts.join() === '기본 (고딕),명조,고정폭' && (await ws((id) => window.__dn.view.engine.getBlock(id).fontFamily, id)) === 'serif' && (await menu.locator('.fc-btn').innerText()).includes('명조') && (await menu.locator('.fc-list').count()) === 0, fontOpts.join());
await menu.locator('.fc-btn').click();
await menu.locator('.fc-list [role="option"]', { hasText: '기본 (고딕)' }).click();
await wait(100);
// 크기: px 숫자를 치기 — 16 Enter → 16px (배율 1.28)
await typeSize('16');
check('크기 칸에 16 Enter → 16px (메뉴는 열린 채)', Math.abs((await css()).fs - 16) < 0.2 && Math.abs((await style()).fontScale - 1.28) < 1e-6 && (await sizeBox.inputValue()) === '16' && (await menu.count()) === 1, JSON.stringify({ ...(await style()), css: await css() }));
// ▾ 목록에서 고르기 — 기준 크기는 '기본'
await menu.locator('button[aria-label="글자 크기 목록"]').click();
const sizeOpts = await menu.locator('.fc-sizes [role="option"]').allInnerTexts();
await menu.locator('.fc-sizes [role="option"]', { hasText: /^24$/ }).click();
await wait(200);
check('▾ 목록(px · 기본 12.5 표시)에서 24 → 24px', sizeOpts.some((t) => t.includes('12.5') && t.includes('기본')) && Math.abs((await css()).fs - 24) < 0.2 && (await sizeBox.inputValue()) === '24', sizeOpts.join(' | '));
await typeSize('31.25');
const big = await css();
const h1 = await ws((id) => window.__dn.view.engine.getBlock(id).h, id);
check('31.25px → 글자 2.5배 · 블록이 내용에 맞게 커짐', Math.abs(big.fs / base.fs - 2.5) < 0.05 && h1 > h0 + 12 && (await style()).fontScale === 2.5, `${base.fs} → ${big.fs}px, h ${h0} → ${h1}`);
// 범위 밖은 끝값으로 (9999 → 50px = 4배)
await typeSize('9999');
check('범위 밖 숫자는 끝값으로 (9999 → 50px)', (await style()).fontScale === 4 && (await sizeBox.inputValue()) === '50', JSON.stringify(await style()));
await typeSize('31.25');
await menu.locator('.tc[aria-label="파랑 글자"]').click();
await menu.locator('.align-row button[aria-label="가운데 정렬"]').click();
await wait(150);
const c2 = await css();
check('글자 색 파랑 · 가운데 정렬', c2.color === 'rgb(51, 126, 169)' && c2.align === 'center', JSON.stringify(c2));
await page.screenshot({ path: `${OUT}/text-style.png` });
await page.keyboard.press('Escape');
await wait(100);

// 배경색은 따로 — 기본 배경으로 되돌려도 글자 모양은 그대로
await ws((id) => window.__dn.view.select([id]), id);
await ws(() => window.__dn.view.setSelectionColor('yellow'));
await ws(() => window.__dn.view.setSelectionColor(undefined));
check('배경색을 지워도 글자 크기 · 색 · 정렬은 그대로', JSON.stringify(await style()) === JSON.stringify({ fontScale: 2.5, textColor: 'blue', align: 'center' }), JSON.stringify(await style()));
await ws(() => { const e = window.__dn.view.engine; e.undo(); e.undo(); e.undo(); });
check('실행 취소 → 정렬 · 색 순서로 되돌림', JSON.stringify(await style()) === JSON.stringify({ fontScale: 2.5, textColor: 'blue' }), JSON.stringify(await style()));

// 키보드: Ctrl+Shift+< / >
await ws((id) => { window.__dn.view.select([id]); window.__dn.view.root.focus(); }, id);
await page.keyboard.press('Control+Shift+Comma');
await wait(100);
check('Ctrl+Shift+< → 한 칸 작게 (250% → 200%)', (await style()).fontScale === 2, JSON.stringify(await style()));
await page.keyboard.press('Control+Shift+Period');
await wait(100);
check('Ctrl+Shift+> → 한 칸 크게', (await style()).fontScale === 2.5);

// 여러 블록 한 칸씩: 각자 제 크기에서
const other = await ws(() => window.__dn.view.engine.transact((tx) => {
  const b = tx.createBlock({ x: 0, y: 400, w: 320, h: 60 });
  tx.createContent({ blockId: b, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '제목 줄' }] }] } });
  return b;
}, { origin: 'user' }).value);
await wait(200);
await ws((ids) => { window.__dn.view.select(ids); window.__dn.view.root.focus(); }, [id, other]);
await page.keyboard.press('Control+Shift+Period');
await wait(150);
const both = await ws((ids) => ids.map((x) => window.__dn.view.engine.getBlock(x).fontScale ?? 1), [id, other]);
check('여러 블록 한 칸 크게 → 각자 제 크기에서 (250% → 300%, 100% → 115%)', JSON.stringify(both) === '[3,1.15]', JSON.stringify(both));
await ws(() => window.__dn.view.engine.undo());
await ws((o) => { window.__dn.view.fit(); window.__dn.view.select([o]); }, other);
await wait(300);
await page.mouse.click((await page.locator(`.dn-block[data-id="${other}"]`).boundingBox()).x + 30, (await page.locator(`.dn-block[data-id="${other}"]`).boundingBox()).y + 15, { button: 'right' });
await menu.waitFor();
await menu.locator('.menu-sub > button', { hasText: '글자 모양' }).click(); // 글자는 '글자 모양' 하위 메뉴 (DS-001)
await menu.locator('.tc[aria-label="빨강 글자"]').click();
await page.keyboard.press('Escape');
await wait(150);
const hcolor = await page.locator(`.dn-block[data-id="${other}"] h2`).evaluate((el) => getComputedStyle(el).color);
check('글자 색이 제목 줄까지', hcolor === 'rgb(212, 76, 71)', hcolor);

// 글 편집 중 오른쪽 클릭 → 같은 메뉴 + 편집 줄, 편집은 그대로
await ws((id) => window.__dn.view.startEditing(id, 'end'), id);
await page.waitForSelector('.dn-text-editing');
const eb = await blk.locator('.dn-text-editing').boundingBox();
await page.mouse.click(eb.x + 30, eb.y + 20, { button: 'right' });
await menu.waitFor();
await menu.locator('.menu-sub > button', { hasText: '글자 모양' }).click(); // 글자는 '글자 모양' 하위 메뉴 (DS-001)
check('편집 중 오른쪽 클릭 → 블록 메뉴 + 잘라내기 · 복사 · 붙여넣기 · 모두 선택', (await menu.locator('.edit-row button').allInnerTexts()).join() === '잘라내기,복사,붙여넣기,모두 선택' && (await ws(() => window.__dn.view.editingId)) === id);
await typeSize('25');
check('편집 중에도 글자 크기 바로 적용(25px = 2배) · 편집 유지', (await style()).fontScale === 2 && (await ws(() => window.__dn.view.editingId)) === id);
await menu.locator('.edit-row button', { hasText: '모두 선택' }).click();
await wait(100);
await page.mouse.click(eb.x + 30, eb.y + 20, { button: 'right' });
await menu.waitFor();
await menu.locator('.edit-row button', { hasText: '복사' }).click();
await wait(150);
const clip = await ws(() => navigator.clipboard.readText().catch((e) => `ERR ${e}`));
check('모두 선택 → 복사 → 클립보드', clip.includes('글자 모양 시험 문장'), clip);
await page.keyboard.press('End');
await ws(() => navigator.clipboard.writeText(' 붙임'));
await page.mouse.click(eb.x + 30, eb.y + 20, { button: 'right' });
await menu.waitFor();
await menu.locator('.edit-row button', { hasText: '붙여넣기' }).click();
await wait(300);
check('메뉴 붙여넣기 → 글에 들어감', (await ws((id) => JSON.stringify(window.__dn.view.engine.contentsOf(id)[0].doc), id)).includes('붙임'));
const beforeShift = await menu.count();
await page.keyboard.down('Shift');
await page.mouse.click(eb.x + 30, eb.y + 20, { button: 'right' });
await page.keyboard.up('Shift');
await wait(150);
check('Shift+오른쪽 클릭 → 블록 메뉴 대신 브라우저 메뉴', (await menu.count()) === 0, `before=${beforeShift}`);
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
await wait(150);

// 글 편집 중 고른 글자만 px로: 상자가 25px(2배)일 때 37.5 Enter → 고른 글자만 1.5배, 편집은 이어짐
await ws((id) => window.__dn.view.startEditing(id, 'end'), id);
await wait(250);
for (let i = 0; i < 2; i++) await page.keyboard.press('Shift+ArrowLeft');
await page.evaluate(() => { const t = document.querySelector('.canvas-host .dn-text-editing'); t.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 600, clientY: 300 })); });
await menu.waitFor();
await menu.locator('.menu-sub > button', { hasText: '글자 모양' }).click(); // 글자는 '글자 모양' 하위 메뉴 (DS-001)
const selHead = await menu.locator('.menu-head:not(.menu-head-one)').first().innerText();
await typeSize('37.5');
const markDoc = await ws((id) => JSON.stringify(window.__dn.view.engine.contentsOf(id)[0].doc), id);
check('편집 중 고른 글자 → 크기 칸 37.5 Enter → 고른 글자만 1.5배 · 편집은 이어짐', selHead === '고른 글자' && /"fontSize","attrs":\{"scale":1\.5\}/.test(markDoc) && (await page.locator('.canvas-host .dn-text-editing').count()) === 1, JSON.stringify({ selHead, markDoc: markDoc.slice(0, 220) }));
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
await wait(150);

// 문서 뷰에도
await ws(() => window.__dn.setViewMode('doc'));
await page.waitForSelector('.dn-doc-page');
const dcss = await page.locator(`.dn-doc-item[data-id="${id}"] .dn-doc-text`).first().evaluate((el) => { const s = getComputedStyle(el); return { fs: parseFloat(s.fontSize), color: s.color, align: s.textAlign }; });
check('문서 뷰에도 글자 크기 · 색', Math.abs(dcss.fs - 14.5 * 2) < 0.5 && dcss.color === 'rgb(51, 126, 169)', JSON.stringify(dcss));
await ws(() => window.__dn.setViewMode('canvas'));

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
