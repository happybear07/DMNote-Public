// 인쇄 · 다른 파일로 저장 (FR-131 · 130): 위 막대 단추 → 미리보기 창 · A4 쪽 수 · 제목 · 쪽 번호 끄기 → PDF 파일(쪽마다 그림, 열리는 구조) ·
// HTML 파일(혼자 열림, 그림 · 글 포함) · Markdown 미리보기 = 파일 글 · 백업 요약 · Esc 닫기.
// 사용: dev 서버 실행 후 `node e2e/export-dialog.mjs [스크린샷 폴더]`
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2] ?? '.';
const results = [];
process.on('unhandledRejection', (e) => { if (!/TargetClosedError|has been closed/.test(String(e))) throw e; });
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const browser = await chromium.launch({ channel: process.env.DN_CHANNEL ?? 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
await ctx.addInitScript(() => { localStorage.setItem('dn:no-env-key', '1'); localStorage.removeItem('dn:export-format'); });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });
const ws = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
// 두 쪽이 넘게 긴 글 하나 더
await ws(() => window.__dn.view.engine.transact((tx) => {
  const b = tx.createBlock({ x: 0, y: 2000, w: 500, h: 400 });
  tx.createContent({ blockId: b, type: 'text', role: 'body', doc: { type: 'doc', content: Array.from({ length: 70 }, (_, i) => ({ type: 'paragraph', content: [{ type: 'text', text: `긴 글 ${i + 1}째 줄 — 쪽을 넘겨 봅니다.` }] })) } });
}, { origin: 'user' }));
await wait(300);
await page.locator('.topbar .more-btn').click(); // 인쇄 · 내보내기는 위 막대 ⋯ 안 (DS-009)
await page.locator('.topbar .export-btn').click();
await page.waitForSelector('.export-dialog');
await wait(800);
const pages = await page.locator('.export-paper .dn-doc-sheet').count();
check('위 막대 단추 → 미리보기 창 · PDF가 기본 · A4 여러 쪽', (await page.locator('.export-formats button.on').innerText()).startsWith('PDF') && pages >= 2 && (await page.locator('.export-meta').innerText()).includes(`${pages}쪽`), String(pages));
check('맨 위에 노트 제목', (await page.locator('.export-paper .dn-doc-header').innerText()).includes('Claude API'));
await page.screenshot({ path: `${OUT}/export-pdf.png` });
await page.locator('.export-opts label', { hasText: '쪽 번호' }).click();
await wait(100);
check('쪽 번호 끄기 → 미리보기에 반영', (await page.locator('.export-paper.no-page-num').count()) === 1);
const dl = page.waitForEvent('download', { timeout: 60000 });
await page.locator('.export-go').click();
const d = await dl;
const pdfPath = join(OUT, d.suggestedFilename());
await d.saveAs(pdfPath);
const pdf = readFileSync(pdfPath).toString('latin1');
const imgs = (pdf.match(/\/Subtype \/Image \/Width 1588 \/Height 2246/g) ?? []).length;
check('PDF로 저장 → 쪽 수만큼 A4 그림이 든 PDF', d.suggestedFilename().endsWith('.pdf') && pdf.startsWith('%PDF-1.4') && imgs === pages && pdf.includes(`/Count ${pages}`), `${d.suggestedFilename()} imgs=${imgs}`);
check('저장하면 창이 닫히고 알림', (await page.locator('.export-dialog').count()) === 0 && (await page.locator('.toast').innerText()).includes('PDF로 저장했어요'));

// HTML
await page.locator('.topbar .more-btn').click(); // 인쇄 · 내보내기는 위 막대 ⋯ 안 (DS-009)
await page.locator('.topbar .export-btn').click();
await page.locator('.export-formats button', { hasText: 'HTML' }).click();
await wait(500);
check('HTML: 쪽 없이 흐르는 미리보기', (await page.locator('.export-paper .dn-doc-sheet').count()) === 0 && (await page.locator('.export-paper .dn-doc-item').count()) > 3);
const dl2 = page.waitForEvent('download', { timeout: 60000 });
await page.locator('.export-go').click();
const d2 = await dl2;
const htmlPath = join(OUT, d2.suggestedFilename());
await d2.saveAs(htmlPath);
const html = readFileSync(htmlPath, 'utf8');
check('HTML 파일: 혼자 열림(스타일 안에) · 제목 · 글 · 편집 단추 없음', html.startsWith('<!doctype html>') && html.includes('<style>') && html.includes('긴 글 70째 줄') && html.includes('dn-doc-header') && !html.includes('class="dn-doc-gap'));
const p2 = await ctx.newPage();
await p2.goto('file:///' + htmlPath.replaceAll('\\', '/'));
check('HTML 파일을 브라우저로 열면 글이 보임', (await p2.locator('.dn-doc-item').count()) > 3 && (await p2.locator('.dn-doc-header').isVisible()));
await p2.close();

// Markdown · 백업 미리보기
await page.locator('.topbar .more-btn').click(); // 인쇄 · 내보내기는 위 막대 ⋯ 안 (DS-009)
await page.locator('.topbar .export-btn').click();
await page.locator('.export-formats button', { hasText: 'Markdown' }).click();
await wait(400);
check('Markdown: 파일 글 그대로 미리보기', (await page.locator('.export-text').innerText()).includes('# Claude API'));
await page.locator('.export-formats button', { hasText: '백업' }).click();
check('백업: 담기는 것 요약', (await page.locator('.export-summary').innerText()).includes('상자'));
await page.keyboard.press('Escape');
check('Esc로 닫기', (await page.locator('.export-dialog').count()) === 0);

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
