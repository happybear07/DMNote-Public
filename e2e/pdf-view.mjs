// PDF 보기 (GAP #22 — 노션 PDF 블록): PDF를 첨부하면 펼친 채(브라우저 PDF 보기 iframe · blob), '접기' ↔ '펼쳐 보기'(펼치면 아래 상자를 내림),
// 이름만 .pdf인 HTML은 펼쳐 보지 않음(보안 — 같은 출처 iframe에서 스크립트가 돌지 않게), 문서 뷰에서도 펼쳐 보기.
// 사용: dev 서버 실행 후 `node e2e/pdf-view.mjs`
import { chromium } from 'playwright-core';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const browser = await chromium.launch({ channel: process.env.DN_CHANNEL ?? 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await ctx.addInitScript(() => localStorage.setItem('dn:no-env-key', '1'));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });
const ws = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
const PDF = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF';
const blocks = () => ws(() => { const e = window.__dn.view.engine; return [...e.blocks()].sort((a, b) => a.y - b.y).map((b) => { const c = e.contentsOf(b.id)[0]; return { id: b.id, y: b.y, h: b.h, w: b.w, type: c?.type, name: c?.name, preview: !!c?.preview }; }); });

await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(() => window.__dn.newNote({ sheet: null }));
await page.waitForFunction(() => window.__dn.view.engine.blockCount === 0);
// 아래에 글 상자 하나, 위에 PDF
await ws(() => { const e = window.__dn.view.engine; e.transact((tx) => { const b = tx.createBlock({ x: 100, y: 800, w: 300, h: 50 }); tx.createContent({ blockId: b, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '아래 상자' }] }] } }); }, { origin: 'user' }); window.__dn.view.setCamera({ x: 0, y: 0, zoom: 1 }); });
await ws(async (PDF) => { await window.__dn.addFiles([new File([PDF], '계약서.pdf', { type: 'application/pdf' })], { x: 100, y: 100 }); }, PDF);
await wait(800);
let B = await blocks();
const pdf = B.find((b) => b.type === 'file');
check('PDF 첨부 → 펼친 채 (520 × 640)', pdf?.preview && pdf.w === 520 && pdf.h === 640, JSON.stringify(pdf));
const src = await page.locator('.dn-block .dn-pdf-frame').getAttribute('src').catch(() => null);
check('브라우저 PDF 보기 iframe (앱이 만든 blob)', !!src && src.startsWith('blob:'), String(src));
check('캔버스에서는 덮개 (두 번 눌러 안을 쓴다)', (await page.locator('.dn-block .dn-pdf-view .dn-web-shield').count()) === 1);
// 접기 → 카드 높이, 펼치기 → 아래 상자가 겹치지 않게 내려감
await page.locator('.dn-block .dn-file-pv').click();
await wait(300);
B = await blocks();
check('접기 → 카드 높이 · iframe 없음', B.find((b) => b.type === 'file').h <= 80 && (await page.locator('.dn-block .dn-pdf-frame').count()) === 0, JSON.stringify(B.find((b) => b.type === 'file')));
await ws((id) => window.__dn.view.engine.transact((tx) => tx.set('block', id, { y: 200 }), { origin: 'user' }), B.find((b) => b.name === undefined).id);
await wait(200);
await page.locator('.dn-block .dn-file-pv').click();
await wait(400);
B = await blocks();
const f = B.find((b) => b.type === 'file'), t = B.find((b) => b.type === 'text');
check('펼쳐 보기 → 아래 상자를 내림 (겹치지 않음)', f.preview && t.y >= f.y + f.h, JSON.stringify({ f, t }));
await ws(() => window.__dn.view.engine.undo());
await wait(250);
check('실행 취소 한 번에 접힌 상태 · 자리로', !(await blocks()).find((b) => b.type === 'file').preview);
await ws(() => window.__dn.view.engine.redo());
await wait(250);

// 이름만 .pdf인 HTML
await ws(async () => { await window.__dn.addFiles([new File(['<script>window.__pwned = 1</script>'], '가짜.pdf', { type: 'application/pdf' })], { x: 700, y: 100 }); });
await wait(800);
const fake = page.locator('.dn-block .dn-file-pdf', { hasText: '가짜.pdf' });
check('머리 바이트가 %PDF-가 아니면 펼쳐 보지 않음', (await fake.locator('.dn-pdf-bad').count()) === 1 && !(await fake.locator('.dn-pdf-frame').getAttribute('src').catch(() => null)), await fake.innerText());
check('스크립트가 돌지 않음', !(await ws(() => !!window.__pwned)));

// 문서 뷰
await ws(() => window.__dn.setViewMode('doc'));
await wait(900);
const dsrc = await page.locator('.dn-doc .dn-pdf-frame').first().getAttribute('src').catch(() => null);
check('문서 뷰에서도 펼쳐 보기', !!dsrc && dsrc.startsWith('blob:'), String(dsrc));
await ws(() => window.__dn.setViewMode('canvas'));

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
