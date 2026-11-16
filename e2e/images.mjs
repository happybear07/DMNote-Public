// 이미지 (스키마 v4, FR-018 · FR-125): 붙여넣기 · 끌어 놓기 → 이미지 블록, 같은 그림은 한 번만 저장, 새로 고침 유지,
// 모두 내보내기 ZIP에 attachments/ · Markdown ![](...), 새 브라우저에서 백업 되살리기, 옵시디언 ![[그림]] 가져오기.
// 사용: dev 서버 실행 후 `node e2e/images.mjs [작업 폴더]`
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2] ?? '.';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
process.on('unhandledRejection', (e) => { if (!/Target page, context or browser has been closed/.test(String(e))) throw e; });

const browser = await chromium.launch({ channel: process.env.DN_CHANNEL ?? 'msedge', headless: true });
const errors = [];
async function fresh() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await ctx.addInitScript(() => localStorage.setItem('dn:no-env-key', '1'));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });
  await page.goto(BASE);
  await page.waitForSelector('.dn-block', { timeout: 15000 });
  await page.waitForTimeout(400);
  return { ctx, page, ws: (fn, arg) => page.evaluate(fn, arg) };
}
const loaded = (page) => page.locator('.dn-image img').evaluateAll((imgs) => imgs.map((i) => i.complete && i.naturalWidth > 0));

/** 페이지 안에서 그림(PNG) 만들기 → 붙여넣기 / 끌어 놓기 */
const PNG = (color, w, h) => `(async () => { const c = document.createElement('canvas'); c.width = ${w}; c.height = ${h};
  const g = c.getContext('2d'); g.fillStyle = '${color}'; g.fillRect(0, 0, ${w}, ${h}); g.fillStyle = '#fff'; g.fillRect(10, 10, 20, 20);
  return new File([await new Promise((r) => c.toBlob(r, 'image/png'))], '${color}.png', { type: 'image/png' }); })()`;

const A = await fresh();
await A.ws(() => window.__dn.newNote());
await A.page.waitForTimeout(300);
await A.ws(() => window.__dn.setTitle('그림 노트'));
const noteId = await A.ws(() => window.__dn.state.currentId);

// ───── 붙여넣기 ─────
await A.page.evaluate(async (code) => {
  const f = await eval(code);
  const dt = new DataTransfer(); dt.items.add(f);
  const root = window.__dn.view.root; root.focus();
  root.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, PNG('tomato', 400, 200));
await A.page.waitForSelector('.dn-image img[src]', { timeout: 5000 });
await A.page.waitForTimeout(300);
const img1 = await A.ws(() => { const c = [...window.__dn.view.engine.contents()].find((x) => x.type === 'image'); const b = window.__dn.view.engine.getBlock(c.blockId); return { natural: c.natural, alt: c.alt, w: b.w, ratio: b.h / b.w }; });
check('이미지 붙여넣기 → 이미지 블록 (원래 비율)', img1.natural.w === 400 && img1.natural.h === 200 && img1.alt === 'tomato' && img1.w === 400, JSON.stringify(img1));
check('이미지가 실제로 보임', (await loaded(A.page)).every(Boolean));

// ───── 끌어 놓기 (같은 그림 + 다른 그림) ─────
await A.page.evaluate(async ([a, b]) => {
  const dt = new DataTransfer(); dt.items.add(await eval(a)); dt.items.add(await eval(b));
  const r = window.__dn.view.root.getBoundingClientRect();
  window.__dn.view.root.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: r.left + 200, clientY: r.top + 500 }));
}, [PNG('tomato', 400, 200), PNG('teal', 120, 240)]);
await A.page.waitForFunction(() => document.querySelectorAll('.dn-image img[src]').length === 3, null, { timeout: 5000 });
const count = await A.page.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('dn-files'); r.onsuccess = () => { const q = r.result.transaction('attachments').objectStore('attachments').count(); q.onsuccess = () => res(q.result); };
}));
check('끌어 놓기 · 여러 장 → 블록 3개, 같은 그림은 첨부 하나 (내용 해시)', (await A.page.locator('.dn-image').count()) === 3 && count === 2, `첨부 ${count}개`);
await A.page.screenshot({ path: `${OUT}/images.png` });

// ───── 새로 고침 · 실행 취소 ─────
await A.page.waitForTimeout(700);
await A.page.reload();
await A.page.waitForSelector('.dn-block', { timeout: 15000 });
await A.ws((id) => window.__dn.openById(id), noteId);
await A.page.waitForFunction(() => document.querySelectorAll('.dn-image img[src]').length === 3, null, { timeout: 5000 });
check('새로 고침 후 이미지 유지', (await loaded(A.page)).every(Boolean));
check('검색: 대체 글로 찾기', (await A.ws(() => window.__dn.search('teal').map((h) => h.noteId))).includes(noteId));

// ───── 모두 내보내기 → ZIP 안 이미지 ─────
const dl = A.page.waitForEvent('download');
await A.ws(() => window.__dn.exportAll());
const zipPath = join(OUT, 'images-backup.zip');
await (await dl).saveAs(zipPath);
const buf = readFileSync(zipPath);
const names = []; { let p = buf.readUInt32LE(buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])) + 16); const n = buf.readUInt16LE(buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])) + 10);
  for (let i = 0; i < n; i++) { const len = buf.readUInt16LE(p + 28); names.push(buf.subarray(p + 46, p + 46 + len).toString('utf8')); p += 46 + len + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32); } }
const pngs = names.filter((n) => /^attachments\/[0-9a-f]{64}\.png$/.test(n));
check('ZIP에 attachments/<해시>.png 2개', pngs.length === 2, names.join(' | '));
const md = await A.ws((id) => window.__dn.noteMarkdown(id), noteId);
check('노트 하나 Markdown은 이미지 캡션', md.includes('*이미지: tomato*'));
await A.ctx.close();

// ───── 새 브라우저에서 되살리기 ─────
const B = await fresh();
const chooser = B.page.waitForEvent('filechooser');
await B.page.evaluate(() => window.__dnPickImport(false));
await (await chooser).setFiles(zipPath);
await B.page.waitForSelector('.import-dialog');
await B.page.locator('.import-dialog button.primary').click();
await B.page.waitForSelector('.import-dialog', { state: 'detached', timeout: 15000 });
await B.ws((id) => window.__dn.openById(id), noteId);
await B.page.waitForFunction(() => document.querySelectorAll('.dn-image img[src]').length === 3, null, { timeout: 5000 }).catch(() => {});
check('백업 ZIP 되살리기 → 이미지까지 (같은 해시)', (await B.page.locator('.dn-image img[src]').count()) === 3 && (await loaded(B.page)).every(Boolean));

// ───── 옵시디언 볼트의 이미지 ─────
const vault = join(OUT, 'img-vault');
rmSync(vault, { recursive: true, force: true });
mkdirSync(join(vault, 'assets'), { recursive: true });
const png = Buffer.from(await B.page.evaluate(async (code) => [...new Uint8Array(await (await eval(code)).arrayBuffer())], PNG('navy', 64, 32)));
writeFileSync(join(vault, 'assets', '도표.png'), png);
writeFileSync(join(vault, '여행.md'), '# 여행\n\n지도를 붙였다.\n\n![[도표.png]]\n\n없는 그림 ![[없음.png]]\n');
const chooser2 = B.page.waitForEvent('filechooser');
await B.page.evaluate(() => window.__dnPickImport(true));
await (await chooser2).element().setInputFiles(vault);
await B.page.waitForSelector('.import-dialog');
const warns = await B.page.locator('.import-warn').allInnerTexts();
check('미리보기: 이미지 1개 함께 · 없는 그림 1개 경고', warns.some((w) => w.includes('이미지 1개를 이미지 블록으로')) && warns.some((w) => w.includes('1개는 파일이 함께 없어')), warns.join(' | '));
await B.page.locator('.import-dialog button.primary').click();
await B.page.waitForSelector('.import-dialog', { state: 'detached', timeout: 15000 });
await B.page.waitForTimeout(500);
const trip = await B.ws(() => { const e = window.__dn.view.engine; const c = [...e.contents()]; return { title: window.__dn.state.title, images: c.filter((x) => x.type === 'image').map((x) => x.natural), text: JSON.stringify(c.filter((x) => x.type === 'text').map((x) => x.doc)) }; });
check('![[그림]] → 이미지 블록 · 글에서는 빠지고 없는 그림은 글자로', trip.title === '여행' && trip.images.length === 1 && trip.images[0].w === 64 && !trip.text.includes('도표.png') && trip.text.includes('없음.png'), JSON.stringify(trip).slice(0, 200));

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await B.ctx.close();
await browser.close().catch(() => {});
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
