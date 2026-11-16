// 첫 쪽 = 표지 (11/09): 화면의 '새 노트'는 표지 쪽을 넣어 만든다(처음 화면은 1쪽) · 문서 보기 첫 쪽은 표지 — 비었으면 제목 쪽,
// 그리면 표지 그림 · 쪽 보기에서 본문은 다음 쪽부터 · 표지 필기는 본문 손그림으로 안 나옴 · 두 번 누르면 캔버스의 표지로.
// 코드로 표지 없이 만든 노트(newNote({ sheet }))는 표지 없음 그대로.
// 사용: dev 서버 실행 후 `node e2e/cover-default.mjs [스크린샷 폴더]`
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

// 1) 사이드바 '새 노트' → 표지 쪽이 있는 A4 · 처음 화면은 1쪽
await page.locator('.note-item.add').first().click();
await wait(800);
const cover = await ws(() => window.__dn.view.engine.note.coverPage ?? null);
const cam = await ws(() => window.__dn.view.camera);
check("화면의 '새 노트' → 표지 쪽(1쪽 바로 위)이 있는 A4 · 처음 화면은 1쪽", cover?.x === 0 && cover?.y === -1163 && cam.y >= -120 && cam.y < 100, JSON.stringify({ cover, cam }));
await ws(() => window.__dn.setTitle('표지 기본 노트'));
await ws(() => window.__dn.view.engine.transact((tx) => { const b = tx.createBlock({ x: 24, y: 60, w: 400, h: 60 }); tx.createContent({ blockId: b, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '본문 첫 문단' }] }] } }); }, { origin: 'user' }));
await wait(300);

// 2) 문서 보기: 첫 쪽은 제목 쪽(표지가 비었음), 본문은 다음 쪽부터
await ws(() => window.__dn.setViewMode('doc'));
await wait(900);
const doc = await ws(() => {
  const page = document.querySelector('.dn-doc-page'), kids = [...page.children].filter((el) => !el.classList.contains('dn-doc-sheets'));
  const cov = page.querySelector('.dn-doc-cover'), body = [...page.querySelectorAll('.dn-doc-item')].find((el) => el.textContent.includes('본문 첫 문단'));
  const top = (el) => el.getBoundingClientRect().top - page.getBoundingClientRect().top;
  return { first: kids[0]?.className, title: cov?.querySelector('.dn-doc-cover-title h1')?.textContent ?? null, bodyTop: body ? Math.round(top(body)) : null, coverH: cov ? Math.round(cov.getBoundingClientRect().height) : 0, paged: document.querySelector('.dn-doc')?.classList.contains('dn-doc-paged') };
});
check('문서 보기 맨 앞 = 표지 · 비었으면 제목 쪽(노트 제목)', doc.first?.includes('dn-doc-cover') && doc.title === '표지 기본 노트', JSON.stringify(doc));
check('쪽 보기: 표지가 첫 쪽 본문 칸을 다 쓰고 본문은 둘째 쪽부터', doc.paged && doc.coverH > 800 && doc.bodyTop > 1123, JSON.stringify(doc));
await page.screenshot({ path: `${OUT}/cover-default-doc-title.png` });

// 3) 표지에 그리면 → 문서 보기 표지가 그림으로 · 표지 필기는 본문 손그림으로 안 나옴
await ws(() => window.__dn.setViewMode('canvas'));
await wait(500);
await ws(() => window.__dn.view.setCamera({ x: -100, y: -1163 - 60, zoom: 0.6 }));
await wait(200);
const s0 = await ws(() => { const v = window.__dn.view, r = v.root.getBoundingClientRect(), k = v.camera; return { x: r.left + (200 - k.x) * k.zoom, y: r.top + (-1163 + 400 - k.y) * k.zoom }; });
await ws(() => window.__dn.view.setTool('pen'));
await page.mouse.move(s0.x, s0.y);
await page.mouse.down();
for (let i = 1; i <= 14; i++) await page.mouse.move(s0.x + i * 14, s0.y + (i % 2 ? 16 : -16));
await page.mouse.up();
await ws(() => window.__dn.view.setTool('select'));
await wait(200);
await ws(() => window.__dn.setViewMode('doc'));
await page.waitForSelector('.dn-doc-cover img', { timeout: 5000 }).catch(() => {});
const drawn = await ws(() => ({ src: document.querySelector('.dn-doc-cover img')?.getAttribute('src')?.slice(0, 22) ?? null, inks: document.querySelectorAll('.dn-doc-ink').length }));
check('표지에 그리면 문서 보기 표지가 그림(data URL — 인쇄 · PDF에도) · 본문 손그림 없음', drawn.src?.startsWith('data:image/png') && drawn.inks === 0, JSON.stringify(drawn));
await page.screenshot({ path: `${OUT}/cover-default-doc-image.png` });

// 4) 문서 보기 표지를 두 번 누르면 캔버스의 표지로
await page.locator('.dn-doc-cover').dblclick();
await wait(800);
const back = await ws(() => { const v = window.__dn.view, k = v.camera; return { mode: window.__dn.state.viewMode, sees: k.y <= -1163 + 50 && k.y + v.size.h / k.zoom >= -1163 + 600 }; });
check('표지를 두 번 누르면 캔버스의 표지 쪽으로', back.mode === 'canvas' && back.sees, JSON.stringify(back));

// 5) 코드로 표지 없이 만든 노트는 그대로
await ws(() => window.__dn.newNote({ sheet: { size: 'a4' } }));
await wait(500);
await ws(() => window.__dn.setViewMode('doc'));
await wait(600);
check('표지 없이 만든 노트는 표지 없음 · 문서 보기에도 없음', !(await ws(() => window.__dn.view.engine.note.coverPage)) && !(await page.locator('.dn-doc-cover').count()));
await ws(() => window.__dn.setViewMode('canvas'));

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} 통과`);
await browser.close();
process.exit(results.every((r) => r.ok) ? 0 : 1);
