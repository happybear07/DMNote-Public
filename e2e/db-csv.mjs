// 데이터베이스 → CSV 내보내기 · CSV 가져오기 (GAP #13 — 노션 ••• › 내보내기 › CSV, CSV 가져오기):
// ⋯ 메뉴 › 'CSV로 내보내기' → 내려받은 파일(BOM · 머리 줄 · 쉼표/따옴표 · 지금 보기의 필터) → 그 파일을 가져오기 → 같은 이름 노트에 같은 값 · 타입.
// 사용: dev 서버 실행 후 `node e2e/db-csv.mjs [스크린샷 폴더]`
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2] ?? '.';
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

const browser = await chromium.launch({ channel: process.env.DN_CHANNEL ?? 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
await ctx.addInitScript(() => localStorage.setItem('dn:no-env-key', '1'));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });
const ws = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await wait(400);
const db = () => ws(() => { const v = window.__dn.view; for (const b of v.engine.blocks()) for (const c of v.engine.contentsOf(b.id)) if (c.type === 'database') return JSON.parse(JSON.stringify(c)); return null; });

// 준비: 새 노트에 슬래시로 데이터베이스 → 이름 · 상태 · 날짜 (이름에 쉼표 · 따옴표)
await ws(() => window.__dn.newNote({ sheet: null }));
await wait(600);
await page.evaluate(() => window.__dn.view.setTool('block')); await page.mouse.click(500, 200);
await wait(300);
await page.keyboard.type('CSV 시험');
await page.keyboard.press('Enter');
await page.keyboard.type('/데이터');
await wait(250);
await page.keyboard.press('Enter');
await page.waitForSelector('.dn-db');
let d = await db();
const [NAME, STATUS, DATE] = d.properties.map((p) => p.id);
const opt = (n) => d.properties[1].options.find((o) => o.name === n).id;
const items = [['보고서, 초안', '할 일', '2026-10-03'], ['발표 "최종"', '완료', '2026-10-10'], ['복습', '완료', '']];
await ws(({ cid, items, NAME, STATUS, DATE, opts }) => {
  const e = window.__dn.view.engine;
  e.transact((tx) => {
    const c = e.getContent(cid);
    const rows = [...c.rows].sort((a, b) => (a.order < b.order ? -1 : 1));
    tx.set('content', cid, { title: '과제 / 목록', rows: rows.map((r, i) => ({ ...r, values: { [NAME]: items[i][0], [STATUS]: opts[items[i][1]], ...(items[i][2] ? { [DATE]: items[i][2] } : {}) } })) });
  }, { origin: 'user', label: '시험 데이터' });
}, { cid: d.id, items, NAME, STATUS, DATE, opts: Object.fromEntries(['할 일', '진행 중', '완료'].map((n) => [n, opt(n)])) });
await wait(200);

// ───── 1. 내보내기 ─────
await page.locator('.dn-db [aria-label="데이터베이스 메뉴"]').click();
const mi = page.locator('.dn-db-pop .dn-db-mi', { hasText: 'CSV로 내보내기' });
check('⋯ 메뉴에 CSV로 내보내기 (항목 3개)', (await mi.innerText()).includes('항목 3개'), await mi.innerText());
await page.screenshot({ path: join(OUT, 'db-csv-menu.png') });
const dl = page.waitForEvent('download');
await mi.click();
const file = await dl;
const name = file.suggestedFilename();
check('파일 이름 = 데이터베이스 이름 (/ 는 빈칸으로)', name === '과제 목록.csv', name);
const path = join(OUT, name);
await file.saveAs(path);
const bytes = readFileSync(path);
check('BOM (엑셀이 한글을 바로 읽게)', bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf);
const lines = bytes.toString('utf8').replace(/^\uFEFF/, '').split('\r\n');
check('머리 줄 · 쉼표/따옴표 감싸기 · CRLF', JSON.stringify(lines) === JSON.stringify(['이름,상태,날짜', '"보고서, 초안",할 일,2026-10-03', '"발표 ""최종""",완료,2026-10-10', '복습,완료,', '']), JSON.stringify(lines));

// 지금 보기 기준: 필터(상태 = 완료)를 걸면 그 항목만
await ws(({ cid, STATUS, done }) => {
  const e = window.__dn.view.engine, c = e.getContent(cid);
  e.transact((tx) => tx.set('content', cid, { views: [{ id: 'v1', name: '완료만', kind: 'table', filters: [{ propId: STATUS, op: 'is', value: done }] }], activeView: 'v1' }), { origin: 'user', label: '필터' });
  return c.id;
}, { cid: d.id, STATUS, done: opt('완료') });
await wait(200);
await page.locator('.dn-db [aria-label="데이터베이스 메뉴"]').click();
const dl2 = page.waitForEvent('download');
await page.locator('.dn-db-pop .dn-db-mi', { hasText: 'CSV로 내보내기' }).click();
const f2 = await dl2;
const p2 = join(OUT, `filtered-${f2.suggestedFilename()}`);
await f2.saveAs(p2);
const l2 = readFileSync(p2, 'utf8').replace(/^\uFEFF/, '').trim().split('\r\n');
check('지금 보기(필터) 기준 — 완료 2개', l2.length === 3 && l2.slice(1).every((l) => l.includes(',완료,')), JSON.stringify(l2));

// ───── 2. 가져오기 (처음 내보낸 파일) ─────
const chooser = page.waitForEvent('filechooser');
await ws(() => window.__dnPickImport(false));
await (await chooser).setFiles(path);
const dlg = page.locator('.import-dialog');
await page.waitForSelector('.import-dialog', { timeout: 15000 });
check('가져오기 창: CSV 가져오기 · 항목 3개 안내', (await dlg.locator('h2').innerText()).includes('CSV') && (await dlg.locator('.import-warn').allInnerTexts()).join(' ').includes('항목 3개'), await dlg.locator('h2').innerText());
await dlg.locator('button.primary').click();
await page.waitForSelector('.import-dialog', { state: 'detached', timeout: 15000 });
await wait(500);
const back = await ws(async () => {
  const w = window.__dn, n = w.state.notes.find((x) => x.title === '과제 목록');
  if (!n) return null;
  await w.openById(n.id);
  await new Promise((r) => setTimeout(r, 700));
  const e = w.view.engine, cs = [...e.blocks()].flatMap((b) => e.contentsOf(b.id));
  const c = cs.find((x) => x.type === 'database');
  const rows = [...c.rows].sort((a, b) => (a.order < b.order ? -1 : 1));
  const [n0, s, dt] = c.properties;
  return { types: c.properties.map((p) => p.type), text: cs.filter((x) => x.type === 'text').length, rows: rows.map((r) => [r.values[n0.id], s.options?.find((o) => o.id === r.values[s.id])?.name, r.values[dt.id] ?? '']) };
});
check('가져온 노트: 이름 · 상태(선택) · 날짜, 빈 글 상자 없음', !!back && JSON.stringify(back.types) === '["text","select","date"]' && back.text === 0, JSON.stringify(back && { t: back.types, x: back.text }));
check('가져온 값이 내보낸 값과 같다', !!back && JSON.stringify(back.rows) === JSON.stringify(items), JSON.stringify(back?.rows));
await page.waitForSelector('.dn-db');
await page.screenshot({ path: join(OUT, 'db-csv-imported.png') });

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
// 엣지 headless는 내려받을 때마다 빈 탭을 하나 연다 — 닫지 않고 끝낸다(닫으면 플레이라이트 안에서 처리 안 된 거부가 난다)
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
