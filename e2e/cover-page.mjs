// 표지 쪽 (11/03): 노트 설정(빈 곳 오른쪽 클릭) › 표지 쪽 만들기 → A4 노트 1쪽 위에 표지 · 화면이 표지로 → 펜으로 그리고 글을 놓으면
// 잠시 뒤 홈 책장의 그 책 표지가 그 그림(썸네일)으로. 표지 글은 문서 보기 본문에 안 나옴. 그림 붙이기 · 지우기(안의 것도) · 실행 취소 한 번.
// 사용: dev 서버 실행 후 `node e2e/cover-page.mjs [스크린샷 폴더]`
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
await ws(() => window.__dn.newNote({ sheet: { size: 'a4' } }));
await wait(400);
await ws(() => window.__dn.setTitle('표지 시험 노트'));
const noteId = await ws(() => window.__dn.state.currentId);
await ws(() => window.__dn.view.engine.transact((tx) => { const b = tx.createBlock({ x: 24, y: 100, w: 300, h: 60 }); tx.createContent({ blockId: b, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '본문 첫 줄' }] }] } }); }, { origin: 'user' }));
await wait(300);
const menu = page.locator('.note-menu');
const cover = () => ws(() => window.__dn.view.engine.note.coverPage ?? null);

// 1) 노트 설정 › 표지 쪽 만들기
await page.mouse.click(900, 600, { button: 'right' });
await menu.waitFor({ timeout: 3000 });
await menu.locator('.nm-row', { hasText: '표지 쪽 만들기' }).click();
await wait(700);
const c = await cover();
const seen = await ws(() => { const v = window.__dn.view, c = v.engine.note.coverPage; const r = v.visibleRect(); return c && r.y <= c.y + 10 && r.y + r.h >= c.y + 600; });
check('표지 쪽 만들기 → 1쪽 바로 위(0, -1163) · 화면이 표지로', c?.x === 0 && c?.y === -1163 && seen, JSON.stringify(c));

// 2) 펜으로 그리고 · 글 상자 놓기
const box = await page.locator('.dn-canvas').boundingBox();
const toScreen = (x, y) => ws(([x, y]) => { const v = window.__dn.view, r = v.root.getBoundingClientRect(), k = v.camera; return { x: r.left + (x - k.x) * k.zoom, y: r.top + (y - k.y) * k.zoom }; }, [x, y]);
await ws(() => window.__dn.view.setTool('pen'));
const s0 = await toScreen(150, -1163 + 500);
await page.mouse.move(s0.x, s0.y);
await page.mouse.down();
for (let i = 1; i <= 16; i++) await page.mouse.move(s0.x + i * 12, s0.y + (i % 2 ? 18 : -18));
await page.mouse.up();
await ws(() => window.__dn.view.setTool('select'));
await ws(() => window.__dn.view.engine.transact((tx) => { const b = tx.createBlock({ x: 100, y: -1163 + 160, w: 520, h: 80 }); tx.createContent({ blockId: b, type: 'text', role: 'title', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '나의 경제학 공책' }] }] } }); }, { origin: 'user' }));
await wait(300);
await page.screenshot({ path: `${OUT}/cover-page-canvas.png` });
check('표지 안에 필기 · 글 상자', box && (await ws(() => [...window.__dn.view.engine.strokes()].length)) === 1);

// 3) 잠시 뒤 썸네일 → 홈 책장의 책 표지
await page.waitForFunction((id) => window.__dn.state.notes.find((n) => n.id === id)?.coverThumb, noteId, { timeout: 8000 }).catch(() => {});
const thumb = await ws((id) => window.__dn.state.notes.find((n) => n.id === id)?.coverThumb ?? '', noteId);
check('표지가 바뀌면 썸네일(webp)을 목록 정보에', /^data:image\/webp;base64,/.test(thumb) && thumb.length > 500, `${thumb.slice(0, 30)} · ${thumb.length}`);
await ws(() => window.__dn.showHome());
await page.waitForSelector('.lib-shelf .book');
const face = page.locator('.lib-shelf .book.has-face', { has: page.locator('img.book-face') });
check('홈 서재: 그 책 표지가 썸네일 그림 · 이름은 aria-label로', (await face.count()) >= 1 && (await face.first().getAttribute('aria-label')).includes('표지 시험 노트'));
await page.screenshot({ path: `${OUT}/cover-page-home.png` });
await face.first().click();
await page.waitForFunction(() => window.__dn.state.page === 'note', null, { timeout: 3000 }); // 책 펼치기 전환 뒤
await wait(300);

// 4) 문서 보기: 표지 글은 본문에 안 나옴
await ws(() => window.__dn.setViewMode('doc'));
await wait(500);
const docText = await page.locator('.dn-doc').innerText();
check('문서 보기 본문에 표지 글이 안 나옴 · 본문은 그대로', !docText.includes('나의 경제학 공책') && docText.includes('본문 첫 줄'));
await ws(() => window.__dn.setViewMode('canvas'));
await wait(400);

// 5) 표지에 그림 붙이기 — 표지 안에 비율대로 가장 크게
await ws(async () => {
  const cv = document.createElement('canvas'); cv.width = 300; cv.height = 200;
  const g = cv.getContext('2d'); g.fillStyle = '#3f5a80'; g.fillRect(0, 0, 300, 200);
  const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
  await window.__dn.setCoverImage(new File([blob], '표지그림.png', { type: 'image/png' }));
});
await wait(400);
const img = await ws(() => { const e = window.__dn.view.engine, c = e.note.coverPage; const b = [...e.blocks()].find((b) => e.contentsOf(b.id).some((x) => x.type === 'image')); return b && c && { x: b.x - c.x, y: b.y - c.y, w: b.w, h: b.h }; });
check('그림 붙이기 → 표지 안쪽 폭 가득(746) · 비율대로(높이는 그린 뒤 다시 재서 몇 px 차이) · 가운데', img && img.w === 746 && Math.abs(img.h - 746 * 200 / 300) < 12 && img.x === 24 && Math.abs(img.y + img.h / 2 - 1123 / 2) < 12, JSON.stringify(img));

// 6) 표지 쪽 지우기 → 안의 것도 · 실행 취소 한 번
const before = await ws(() => ({ blocks: window.__dn.view.engine.blockCount, strokes: [...window.__dn.view.engine.strokes()].length }));
const p = await toScreen(600, -1163 + 1040); // 화면은 표지에 — 표지 아래쪽 빈 곳
await page.mouse.click(p.x, p.y, { button: 'right' });
await menu.waitFor({ timeout: 3000 });
await menu.locator('.nm-row', { hasText: '표지 쪽 지우기' }).click();
await wait(300);
const after = await ws(() => ({ blocks: window.__dn.view.engine.blockCount, strokes: [...window.__dn.view.engine.strokes()].length, cover: window.__dn.view.engine.note.coverPage ?? null }));
check('표지 쪽 지우기 → 표지 · 안의 글 · 그림 · 필기가 함께, 본문은 그대로', after.cover === null && after.blocks === 1 && after.strokes === 0, JSON.stringify({ before, after }));
await ws(() => window.__dn.view.root.focus());
await page.keyboard.press('Control+z');
await wait(300);
check('실행 취소 한 번 → 모두 돌아옴', JSON.stringify(await ws(() => ({ blocks: window.__dn.view.engine.blockCount, strokes: [...window.__dn.view.engine.strokes()].length }))) === JSON.stringify(before) && !!(await cover()));

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} 통과`);
await browser.close();
process.exit(results.every((r) => r.ok) ? 0 : 1);
