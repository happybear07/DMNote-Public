// 노트 하나 백업 확인 (FR-092): 노트(+ 하위 노트 · 이미지 · 태그) → .json 한 파일 → 새 브라우저에서 되살리기(상자 · 화살표 · 이미지 그대로) →
// 같은 노트가 있을 때 "백업 내용으로 바꾸기"(같은 id, 내용만 교체).
// 사용: dev 서버 실행 후 `node e2e/backup-note.mjs [작업 폴더]`
import { chromium } from 'playwright-core';
import { join } from 'node:path';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2] ?? '.';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const errors = [];
const browser = await chromium.launch({ channel: process.env.DN_CHANNEL ?? 'msedge', headless: true });
async function session() {
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
const shape = (ws) => ws(() => { const e = window.__dn.view.engine; return { blocks: e.blockCount, arrows: [...e.arrows()].length, images: [...e.contents()].filter((c) => c.type === 'image').length, title: e.note.title, id: e.note.id }; });

// ───── 준비: 이미지 넣기 · 하위 노트 ─────
const A = await session();
const rootId = await A.ws(() => window.__dn.state.currentId);
await A.ws(async () => {
  const c = document.createElement('canvas'); c.width = 40; c.height = 30;
  const g = c.getContext('2d'); g.fillStyle = '#e03131'; g.fillRect(0, 0, 40, 30);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  await window.__dn.addImages([new File([blob], '빨강.png', { type: 'image/png' })], { x: -400, y: 0 });
});
await A.page.waitForTimeout(300);
const orig = await shape(A.ws);
await A.ws((id) => window.__dn.newNote({ parentNoteId: id }), rootId);
await A.page.waitForTimeout(300);
await A.ws(() => window.__dn.setTitle('하위 메모'));
await A.page.waitForTimeout(600);
await A.ws((id) => window.__dn.openById(id), rootId);
await A.page.waitForTimeout(500);
const dl = A.page.waitForEvent('download');
await A.ws((id) => window.__dn.exportNoteBackup(id), rootId);
const file = join(OUT, 'note-backup.damiannote.json');
await (await dl).saveAs(file);
check('노트 백업 파일 내려받기 (.damiannote.json)', (await (await dl).suggestedFilename()).endsWith('.damiannote.json'));
// 내려받기(blob 주소 이동)가 남긴 내부 대기가 닫을 때 거부되지 않게 — 이 창은 여기서 끝낸다
process.on('unhandledRejection', (e) => { if (!/TargetClosedError|has been closed/.test(String(e))) throw e; });
await A.page.waitForTimeout(300);
await A.ctx.close().catch(() => {});

// ───── 새 브라우저에서 되살리기 ─────
async function pick(S) {
  const chooser = S.page.waitForEvent('filechooser');
  await S.ws(() => window.__dnPickImport(false));
  await (await chooser).setFiles(file);
  await S.page.waitForSelector('.import-dialog', { timeout: 10000 });
}
const B = await session();
await pick(B);
const dlg = B.page.locator('.import-dialog');
check('미리보기: 노트 2개 (하위 노트 포함)', (await dlg.locator('.import-stats b').first().innerText()) === '2');
await dlg.locator('button.primary').click();
await B.page.waitForSelector('.import-dialog', { state: 'detached', timeout: 15000 });
await B.page.waitForTimeout(500);
await B.ws((id) => window.__dn.openById(id), rootId);
await B.page.waitForTimeout(600);
const restored = await shape(B.ws);
check('되살린 노트: 같은 id · 상자 · 화살표 · 이미지', restored.id === rootId && restored.blocks === orig.blocks && restored.arrows === orig.arrows && restored.images === 1, JSON.stringify({ orig, restored }));
const imgOk = await B.ws(async () => { const el = document.querySelector('.dn-image img'); if (!el) return false; for (let i = 0; i < 20 && !el.complete; i++) await new Promise((r) => setTimeout(r, 100)); return el.naturalWidth === 40; });
check('이미지 파일도 함께 (base64)', imgOk);
check('하위 노트 관계 유지', await B.ws((id) => window.__dn.state.notes.some((n) => n.title === '하위 메모' && n.parentNoteId === id), rootId));

// ───── 같은 노트가 있을 때: 백업 내용으로 바꾸기 ─────
await B.ws(() => { const v = window.__dn.view; v.select([...v.engine.blocks()].map((b) => b.id).slice(0, 3)); v.deleteSelection(); });
await B.page.waitForTimeout(800);
const damaged = await shape(B.ws);
await pick(B);
await dlg.locator('label', { hasText: '백업 내용으로 바꾸기' }).locator('input').click();
await dlg.locator('button.primary').click();
await B.page.waitForSelector('.import-dialog', { state: 'detached', timeout: 15000 });
await B.page.waitForTimeout(600);
const back = await shape(B.ws);
check('바꾸기: 같은 노트(id)의 내용이 백업대로', damaged.blocks < orig.blocks && back.id === rootId && back.blocks === orig.blocks && back.images === 1, JSON.stringify({ damaged, back }));
check('노트가 늘지 않음 (사본 아님)', (await B.ws(() => window.__dn.state.notes.filter((n) => n.title === '하위 메모').length)) === 1);
await B.ws(() => window.__dn.view.root.focus());
await B.page.keyboard.press('Control+z');
await B.page.waitForTimeout(200);
check('바꾸기도 실행 취소 한 번으로 되돌림', (await shape(B.ws)).blocks === damaged.blocks);

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await B.ctx.close().catch(() => {});
await browser.close().catch(() => {});
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
