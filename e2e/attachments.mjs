// 파일 첨부 확인 (FR-052): 끌어 놓기 → 파일 카드(형식 · 이름 · 크기) · 내려받기(같은 내용) · 50MB 넘으면 안내 · 새로 고침 유지 ·
// 검색(파일 이름) · 모든 노트 ZIP에 파일 · Markdown 링크 · 이미지는 여전히 이미지 블록.
// 사용: dev 서버 실행 후 `node e2e/attachments.mjs [작업 폴더]`
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2] ?? '.';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const browser = await chromium.launch({ channel: process.env.DN_CHANNEL ?? 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
await ctx.addInitScript(() => localStorage.setItem('dn:no-env-key', '1'));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });
process.on('unhandledRejection', (e) => { if (!/TargetClosedError|has been closed/.test(String(e))) throw e; });
const ws = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await wait(400);

/** 캔버스 빈 곳에 파일 끌어 놓기 (합성 DragEvent) */
const drop = (files, x = 300, y = 650) => ws(async ({ files, x, y }) => {
  const dt = new DataTransfer();
  for (const f of files) dt.items.add(new File([f.big ? new Uint8Array(f.big) : f.text], f.name, { type: f.type }));
  const root = window.__dn.view.root; const r = root.getBoundingClientRect();
  const opts = { dataTransfer: dt, clientX: r.left + x, clientY: r.top + y, bubbles: true, cancelable: true };
  root.dispatchEvent(new DragEvent('dragover', opts));
  root.dispatchEvent(new DragEvent('drop', opts));
  await new Promise((res) => setTimeout(res, 400));
}, { files, x, y });
const fileContents = () => ws(() => [...window.__dn.view.engine.contents()].filter((c) => c.type === 'file').map((c) => ({ name: c.name, size: c.size, mime: c.mime })));

const text = '분기 보고서 내용\n'.repeat(200);
await drop([{ name: '분기 보고서.pdf', type: 'application/pdf', text }, { name: '데이터.csv', type: 'text/csv', text: 'a,b\n1,2\n' }]);
let fc = await fileContents();
check('끌어 놓기 → 파일 블록 2개 (이름 · 크기 · 형식)', fc.length === 2 && fc[0].name === '분기 보고서.pdf' && fc[0].size === new TextEncoder().encode(text).length && fc[0].mime === 'application/pdf', JSON.stringify(fc));
const card = page.locator('.dn-file').first();
check('파일 카드: 형식 · 이름 · 크기', (await card.locator('.dn-file-ext').innerText()) === 'PDF' && (await card.locator('.dn-file-name').innerText()) === '분기 보고서.pdf' && /KB/.test(await card.locator('.dn-file-size').innerText()));
await page.screenshot({ path: `${OUT}/attachments.png` });

const dl = page.waitForEvent('download');
await card.locator('.dn-file-dl').click();
const d = await dl;
const saved = join(OUT, 'attach-download.pdf');
await d.saveAs(saved);
check('내려받기: 같은 이름 · 같은 내용', d.suggestedFilename() === '분기 보고서.pdf' && readFileSync(saved, 'utf8') === text);
check('카드의 내려받기를 눌러도 블록이 끌리지 않음', (await ws(() => window.__dn.view.selBlocks.size)) <= 2);

// 50MB 상한
await drop([{ name: '큰 영상.mp4', type: 'video/mp4', big: 51 * 1024 * 1024 }], 300, 760);
check('50MB 넘으면 안내 · 안 넣음', (await fileContents()).length === 2 && (await page.locator('.toast').innerText()).includes('50MB'));

// 이미지는 이미지 블록 그대로
await ws(async () => {
  const c = document.createElement('canvas'); c.width = 20; c.height = 20; c.getContext('2d').fillRect(0, 0, 20, 20);
  window.__img = await new Promise((r) => c.toBlob(r, 'image/png'));
});
await ws(async () => {
  const dt = new DataTransfer(); dt.items.add(new File([window.__img], '그림.png', { type: 'image/png' })); dt.items.add(new File(['메모'], '메모.txt', { type: 'text/plain' }));
  const root = window.__dn.view.root; const r = root.getBoundingClientRect();
  root.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, clientX: r.left + 900, clientY: r.top + 650, bubbles: true, cancelable: true }));
  await new Promise((res) => setTimeout(res, 500));
});
check('이미지와 파일을 함께 놓으면 각각 이미지 · 파일 블록', (await ws(() => [...window.__dn.view.engine.contents()].filter((c) => c.type === 'image').length)) === 1 && (await fileContents()).length === 3);

// 검색 · 새로 고침 · 내보내기
await wait(800);
const hits = await ws(() => window.__dn.index.query('분기 보고서', window.__dn.state.notes, 5).length);
check('검색: 파일 이름', hits === 1);
await page.reload();
await page.waitForSelector('.dn-file', { timeout: 15000 });
check('새로 고침 후 유지', (await fileContents()).length === 3);
const noteId = await ws(() => window.__dn.state.currentId);
const md = await ws((id) => window.__dn.noteMarkdown(id), noteId);
check('Markdown에 첨부 표시', md.includes('첨부 파일: 분기 보고서.pdf') || md.includes('첨부 파일:'));
const zdl = page.waitForEvent('download');
await ws(() => window.__dn.exportAll());
const zip = join(OUT, 'attach-all.zip');
await (await zdl).saveAs(zip);
const zbuf = readFileSync(zip);
check('모든 노트 ZIP에 파일 · Markdown 링크', zbuf.includes(Buffer.from('분기 보고서.pdf')) && zbuf.includes(Buffer.from(text.slice(0, 40))));

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await ctx.close().catch(() => {});
await browser.close().catch(() => {});
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
