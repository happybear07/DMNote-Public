// 페이지 표시 옵션 (FR-072) · 창 크기 변경 (FR-155) · 블록 그리기 오류 (FR-149) · 저장 공간 부족 (FR-091).
// 사용: dev 서버 실행 후 `node e2e/page-options.mjs`
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
const bid = await ws(() => window.__dn.view.engine.transact((tx) => {
  const b = tx.createBlock({ x: 0, y: 0, w: 300, h: 80 });
  tx.createContent({ blockId: b, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '페이지 옵션 시험 글' }] }] } });
  return b;
}, { origin: 'user' }).value);
await page.waitForTimeout(200);
await ws(() => window.__dn.togglePanel(true));
await page.waitForSelector('.panel-page');
const toggle = (label) => page.locator('.panel-page label', { hasText: label }).locator('input');

// 편집 잠금
await toggle('편집 잠금').check();
await page.waitForTimeout(200);
check('편집 잠금 → 보기 전용 · 풀기 표시', (await ws(() => window.__dn.view.readOnly)) && (await page.locator('.read-pill', { hasText: '편집 잠금' }).count()) === 1);
await page.locator(`.dn-block[data-id="${bid}"]`).dblclick();
await page.waitForTimeout(150);
check('잠긴 동안 두 번 눌러도 편집 안 됨', !(await ws(() => window.__dn.view.editingId)));
await page.locator('.read-pill', { hasText: '편집 잠금' }).click();
await page.waitForTimeout(200);
check('풀기 → 다시 편집 가능', !(await ws(() => window.__dn.view.readOnly)) && (await page.locator('.panel-page label', { hasText: '편집 잠금' }).locator('input').isChecked()) === false);

// 작은 글자
const fontOf = () => page.locator(`.dn-block[data-id="${bid}"] .dn-text`).first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
const f0 = await fontOf();
await toggle('작은 글자').check();
await page.waitForTimeout(200);
const f1 = await fontOf();
check('작은 글자 → 이 노트의 글자가 작아짐', f1 < f0, `${f0} → ${f1}`);
await toggle('작은 글자').uncheck();

// 문서 뷰 전체 폭
await ws(() => window.__dn.setViewMode('doc'));
await page.waitForSelector('.dn-doc-page');
const w0 = (await page.locator('.dn-doc-page').boundingBox()).width;
await toggle('전체 폭').check();
await page.waitForTimeout(200);
const w1 = (await page.locator('.dn-doc-page').boundingBox()).width;
check('문서 뷰 전체 폭', w1 > w0 + 100, `${w0} → ${w1}`);
await toggle('전체 폭').uncheck();
await ws(() => window.__dn.setViewMode('canvas'));
await ws(() => window.__dn.togglePanel(false));
await page.waitForTimeout(300);

// 창 크기를 바꿔도 보던 가운데 그대로 (FR-155)
const center = () => ws(() => { const v = window.__dn.view, c = v.camera, r = v.root.getBoundingClientRect(); return { x: c.x + r.width / 2 / c.zoom, y: c.y + r.height / 2 / c.zoom }; });
const c0 = await center();
await page.setViewportSize({ width: 900, height: 1200 });
await page.waitForTimeout(400);
const c1 = await center();
check('창 크기 · 회전에도 보던 가운데 그대로', Math.abs(c0.x - c1.x) < 2 && Math.abs(c0.y - c1.y) < 2, JSON.stringify({ c0, c1 }));
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(300);

// 블록 하나 그리기 오류는 그 블록만 (FR-149)
const bad = await ws(() => window.__dn.view.engine.transact((tx) => {
  const b = tx.createBlock({ x: 0, y: 200, w: 200, h: 100 });
  tx.createContent({ blockId: b, type: 'image', attachment: 'nohash' });
  return b;
}, { origin: 'user' }).value);
await page.waitForTimeout(400);
check('그리기 오류 블록만 안내 · 다른 블록은 그대로', (await page.locator(`.dn-block[data-id="${bad}"].dn-render-error`).count()) === 1
  && (await page.locator(`.dn-block[data-id="${bid}"]`).innerText()).includes('페이지 옵션 시험 글'));

// 저장 공간 부족 (FR-091): IndexedDB 쓰기가 QuotaExceededError
await ws(() => {
  const put = IDBObjectStore.prototype.put;
  window.__restorePut = () => { IDBObjectStore.prototype.put = put; };
  IDBObjectStore.prototype.put = function () { throw new DOMException('quota', 'QuotaExceededError'); };
});
await ws((id) => {
  const e = window.__dn.view.engine, c = e.contentsOf(id)[0];
  e.transact((tx) => tx.set('content', c.id, { doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '공간 부족 중 고침' }] }] } }), { origin: 'user' });
}, bid);
await page.waitForFunction(() => document.querySelector('.toast')?.textContent?.includes('저장 공간이 부족해요'), null, { timeout: 8000 }).catch(() => {});
const toast = await page.locator('.toast').innerText().catch(() => '');
check('저장 공간 부족 → 사용량 · 백업 내보내기 안내', toast.includes('저장 공간이 부족해요') && toast.includes('백업 내보내기'), toast.replace(/\n/g, ' '));
await ws(() => window.__restorePut());

// 문서 뷰도 편집 잠금을 따른다: 잠근 채 문서 뷰로 → 눌러도 편집 안 됨, 풀면 다시
await ws(() => window.__dn.setNotePage({ editLock: true }));
await ws(() => window.__dn.setViewMode('doc'));
await page.waitForSelector('.dn-doc-page');
await page.locator(`.dn-doc-item[data-id="${bid}"] .dn-doc-text`).first().click();
await page.waitForTimeout(200);
check('문서 뷰도 편집 잠금 (눌러도 편집 안 됨)', (await page.locator('.doc-host [contenteditable="true"]').count()) === 0);
await ws(() => window.__dn.setNotePage({ editLock: false }));
await page.waitForTimeout(200);
await page.locator(`.dn-doc-item[data-id="${bid}"] .dn-doc-text`).first().click();
await page.waitForTimeout(200);
check('풀면 문서 뷰에서 다시 편집', (await page.locator('.doc-host [contenteditable="true"]').count()) === 1);
await page.keyboard.press('Escape');
await ws(() => window.__dn.setViewMode('canvas'));
await page.waitForTimeout(200);

// 보던 자리: 커버 있는 노트 ↔ 없는 노트를 오가도 밀리지 않음 (가운데로 저장)
const noteA = await ws(() => window.__dn.state.currentId);
await ws(() => window.__dn.newNote());
await page.waitForTimeout(400);
const noteB = await ws(() => window.__dn.state.currentId);
await ws(() => window.__dn.setNoteCover({ attachment: 'nohash', pos: 50 }));
await page.waitForTimeout(300);
await ws((id) => window.__dn.openById(id), noteA);
await page.waitForTimeout(900);
const v0 = await center();
for (let i = 0; i < 3; i++) {
  await ws((id) => window.__dn.openById(id), noteB);
  await page.waitForTimeout(700);
  await ws((id) => window.__dn.openById(id), noteA);
  await page.waitForTimeout(900);
}
const v3 = await center();
check('커버 있는 노트와 오가도 보던 자리 그대로 (쌓여 밀리지 않음)', Math.abs(v0.x - v3.x) < 2 && Math.abs(v0.y - v3.y) < 2, JSON.stringify({ v0, v3 }));

// 노트를 여는 보기 (FR-143): 설정 › 편집에서 '늘 문서' → 다시 열면 문서 뷰, '마지막으로 쓴 보기'로 되돌림
await ws(() => window.__dn.openSettings());
await page.locator('.settings label', { hasText: '늘 문서' }).locator('input').check();
await ws(() => window.__dn.closeDialog());
await ws(() => window.__dn.setViewMode('canvas'));
await page.reload();
await page.waitForSelector('.dn-block', { timeout: 15000 });
await page.waitForTimeout(300);
check('기본 보기 = 문서 → 다시 열면 문서 뷰 (마지막에 캔버스를 썼어도)', (await ws(() => window.__dn.state.viewMode)) === 'doc' && (await page.locator('.doc-host:not([hidden])').count()) === 1);
await ws(() => window.__dn.setViewMode('canvas'));
await ws(async () => { const cur = window.__dn.state.currentId; await window.__dn.newNote(); await window.__dn.openById(cur); });
await page.waitForTimeout(300);
check('기본 보기 = 문서 → 노트를 열 때마다 문서 뷰 (중간에 캔버스로 바꿨어도)', (await ws(() => window.__dn.state.viewMode)) === 'doc');
await ws(() => window.__dn.setDefaultView('last'));
await ws(() => window.__dn.setViewMode('canvas'));
await page.reload();
await page.waitForSelector('.dn-block', { timeout: 15000 });
check('마지막으로 쓴 보기로 되돌리면 캔버스', (await ws(() => window.__dn.state.viewMode)) === 'canvas');

const real = errors.filter((e) => !/QuotaExceeded|quota|블록을 그리지 못함/.test(e));
check('콘솔 오류 없음 (일부러 낸 오류 제외)', real.length === 0, real.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
