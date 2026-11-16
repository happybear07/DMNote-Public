// 쪽 설정 (워드 레이아웃 · 머리글/바닥글 · 쪽 번호): 문서 서식 막대 '쪽 설정' → 가로 · 좁은 여백 · 쪽 번호 자리 · 머리글/바닥글({제목} · {쪽} · {전체 쪽} · {날짜})
// · 첫 쪽 빼기 · 실행 취소, 그리고 PDF(가로 쪽) · 인쇄 HTML(@page)이 같은 설정을 따르는지.
// 사용: dev 서버 실행 후 `node e2e/page-setup.mjs [스크린샷 폴더]`
import { chromium } from 'playwright-core';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2];
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const browser = await chromium.launch({ channel: process.env.DN_CHANNEL ?? 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
await ctx.addInitScript(() => localStorage.setItem('dn:no-env-key', '1'));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });
const ws = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);

await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(() => window.__dn.newNote({ sheet: null }));
await page.waitForFunction(() => window.__dn.view.engine.blockCount === 0);
await ws(() => {
  const e = window.__dn.view.engine;
  e.transact((tx) => {
    const b = tx.createBlock({ x: 0, y: 0, w: 600, h: 2400 });
    const paras = Array.from({ length: 70 }, (_, i) => ({ type: 'paragraph', content: [{ type: 'text', text: `${i + 1}번째 문단 — 쪽 설정을 보려고 길게 쓴 글입니다.` }] }));
    tx.createContent({ blockId: b, type: 'text', role: 'body', doc: { type: 'doc', content: paras } });
  }, { origin: 'user' });
  window.__dn.setDocPages(true);
  window.__dn.setViewMode('doc');
});
await wait(900);
const sheet = (k) => ws((k) => {
  const s = document.querySelectorAll('.dn-doc .dn-doc-sheet')[k];
  if (!s) return null;
  const txt = (sel) => s.querySelector(sel)?.textContent ?? null;
  return { w: s.offsetWidth, h: s.offsetHeight, head: txt('.dn-sheet-head .dn-sheet-l'), headNum: txt('.dn-sheet-head .dn-sheet-num'), foot: txt('.dn-sheet-foot .dn-sheet-l'), footNum: txt('.dn-sheet-foot .dn-sheet-num'), numAt: s.querySelector('.dn-sheet-num')?.className ?? '' };
}, k);
const count = () => page.locator('.dn-doc .dn-doc-sheet').count();

let s0 = await sheet(0);
check('기본: A4 세로 · 쪽 번호 아래 가운데', s0?.w === 794 && s0.h === 1123 && s0.footNum === '1' && s0.numAt.includes('dn-sheet-c') && (await count()) >= 2, JSON.stringify(s0));

// 쪽 설정 판
await page.locator('button[title^="쪽 설정"]').click();
await wait(200);
const panel = page.locator('.rb-page-setup');
check('서식 막대 "쪽 설정" → 판 (방향 · 여백 · 쪽 번호 · 머리글 · 바닥글)', await panel.isVisible() && (await panel.locator('.rb-chip').count()) === 10 && (await panel.locator('input[aria-label="머리글"]').count()) === 1);
await panel.locator('.rb-chip', { hasText: '가로' }).click();
await wait(400);
s0 = await sheet(0);
check('가로 → 종이 1123 × 794 · 저장', s0?.w === 1123 && s0.h === 794 && (await ws(() => window.__dn.view.engine.note.pageSetup?.landscape)) === true, JSON.stringify(s0));
await panel.locator('.rb-chip', { hasText: /^좁게$/ }).click();
await wait(400);
const pad = await ws(() => { const p = document.querySelector('.dn-doc .dn-doc-page'); const cs = getComputedStyle(p); return [cs.paddingTop, cs.paddingLeft, p.offsetWidth]; });
check('좁게 → 여백 48px · 글 폭 넓어짐', pad[0] === '48px' && pad[1] === '48px' && pad[2] === 1123, JSON.stringify(pad));
await panel.locator('.rb-chip', { hasText: '위 오른쪽' }).click();
await wait(400);
s0 = await sheet(0);
check('쪽 번호 위 오른쪽', s0?.headNum === '1' && s0.footNum === null && s0.numAt.includes('dn-sheet-r'), JSON.stringify(s0));

// 머리글 · 바닥글
await panel.locator('input[aria-label="머리글"]').fill('{제목} — {쪽}/{전체 쪽}');
await page.keyboard.press('Enter');
await panel.locator('input[aria-label="바닥글"]').fill('바닥 {날짜}');
await page.keyboard.press('Enter');
await wait(500);
const n = await count();
const s1 = await sheet(1);
check('머리글: {쪽} · {전체 쪽}이 쪽마다', !!s1?.head?.endsWith(`— 2/${n}`) && s1.head.length > `— 2/${n}`.length, JSON.stringify({ n, head: s1?.head }));
check('바닥글: {날짜}', /^바닥 \d{4}\. \d{1,2}\. \d{1,2}\.$/.test(s1?.foot ?? ''), s1?.foot ?? '');
await panel.locator('input[type="checkbox"]').check();
await wait(400);
s0 = await sheet(0);
const s1b = await sheet(1);
check('첫 쪽(표지)에는 안 보이기 → 1쪽만 비고 2쪽은 그대로', s0?.head === null && s0.foot === null && s0.headNum === null && s1b?.headNum === '2' && !!s1b.head, JSON.stringify({ s0, s1b }));
if (OUT) await page.screenshot({ path: `${OUT}/page-setup.png` });
await page.keyboard.press('Escape');
await wait(200);
check('Esc로 판 닫힘', (await panel.count()) === 0);
await ws(() => window.__dn.view.engine.undo());
await wait(400);
check('실행 취소 → 첫 쪽 빼기만 되돌림', (await ws(() => window.__dn.view.engine.note.pageSetup?.skipFirst)) === undefined && (await sheet(0))?.headNum === '1');

// PDF · 인쇄도 같은 설정
const out = await ws(async () => {
  const r = await import('/src/print-render.ts'), p = await import('/src/pdf.ts');
  const root = document.querySelector('.dn-doc');
  const { pages: imgs } = await r.rasterizePages(root, { pageNumbers: true, colors: true, scale: 1 });
  const pdf = await p.imagesToPdf(imgs, '쪽 설정').text();
  const html = await r.standaloneHtml(root, '쪽 설정', { pageNumbers: true, colors: true });
  return { sizes: [...new Set(imgs.map((i) => `${i.w}x${i.h}`))], n: imgs.length, landscapeBox: pdf.includes('/MediaBox [0 0 841.89 595.28]'), page: html.slice(html.indexOf('@page{size'), html.indexOf('.dn-doc-page{padding:0}')) };
});
check('PDF: 가로 쪽 그림 · 가로 MediaBox · 쪽 수 같음', out.sizes.join() === '1123x794' && out.landscapeBox && out.n === (await count()), JSON.stringify({ ...out, page: undefined }));
check('인쇄 HTML @page: 가로 · 좁은 여백 · 머리글(counter(page)/counter(pages)) · 번호 위 오른쪽',
  out.page.includes('size:A4 landscape') && out.page.includes('margin:12.7mm 12.7mm 12.7mm 12.7mm') && out.page.includes('counter(pages)') && out.page.includes('@top-right{content:counter(page)'), out.page);

// 쪽 보기를 끄면 종이 폭 · 여백 원래대로
await ws(() => window.__dn.setDocPages(false));
await wait(400);
const plain = await ws(() => { const p = document.querySelector('.dn-doc .dn-doc-page'); return [p.style.width, p.style.padding, document.querySelectorAll('.dn-doc .dn-doc-sheet').length]; });
check('쪽 보기 끄면 종이 · 폭 · 여백 지움', plain[0] === '' && plain[1] === '' && plain[2] === 0, JSON.stringify(plain));
await ws(() => window.__dn.setDocPages(true));
check('콘솔 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close();
const bad = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
