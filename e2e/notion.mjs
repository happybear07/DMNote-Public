// 노션 가져오기 확인 (FR-124): 노션 "Markdown & CSV" 내보내기 ZIP → 미리보기(노션 표시 · 보고) → 하위 노트 · 데이터베이스 블록 ·
// 항목 페이지 · 노트 링크 · 표 · 콜아웃 · 토글. 사용: dev 서버 실행 후 `node e2e/notion.mjs [작업 폴더]`
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2] ?? '.';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

function deflateZip(entries) {
  const loc = [], cen = []; let off = 0;
  for (const [name, text] of entries) {
    const n = Buffer.from(name), raw = Buffer.from(text), data = deflateRawSync(raw), crc = crc32(raw);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42);
    loc.push(h, n, data); cen.push(c, n); off += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(cen), e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(entries.length, 8); e.writeUInt16LE(entries.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...loc, cd, e]);
}

const A = 'a'.repeat(32), B = 'b'.repeat(32), D = 'd'.repeat(32), R1 = '1'.repeat(32);
const enc = (s) => encodeURIComponent(s);
const csv = '﻿이름,상태,마감,점수\n보고서,진행 중,"October 4, 2026",80\n발표,완료,2026/10/10,95\n복습,진행 중,,60\n';
const zipPath = join(OUT, 'notion-export.zip');
writeFileSync(zipPath, deflateZip([
  [`Export/노션 프로젝트 ${A}.md`, `# 노션 프로젝트\n\n자세한 건 [노션 회의록](${enc(`노션 프로젝트 ${A}`)}/${enc(`노션 회의록 ${B}`)}.md) 참고.\n\n[과제 목록](${enc(`노션 프로젝트 ${A}`)}/${enc(`과제 목록 ${D}`)}.csv)\n\n<aside>\n💡 노션 콜아웃\n</aside>\n\n<details>\n<summary>노션 토글</summary>\n토글 안쪽\n</details>\n\n| 항목 | 값 |\n| --- | --- |\n| 가 | 1 |\n\n[계약서](계약서.pdf)\n`],
  [`Export/노션 프로젝트 ${A}/노션 회의록 ${B}.md`, '# 노션 회의록\n\n안건 정리\n'],
  [`Export/노션 프로젝트 ${A}/과제 목록 ${D}.csv`, csv],
  [`Export/노션 프로젝트 ${A}/과제 목록 ${D}/보고서 ${R1}.md`, '# 보고서\n\n상태: 진행 중\n마감: October 4, 2026\n\n보고서 본문\n'],
]));

const browser = await chromium.launch({ channel: process.env.DN_CHANNEL ?? 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => localStorage.setItem('dn:no-env-key', '1'));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text()) && !/가져오기 실패/.test(m.text())) errors.push(m.text()); });
const ws = (fn, arg) => page.evaluate(fn, arg);
await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await page.waitForTimeout(400);

const chooser = page.waitForEvent('filechooser');
await ws(() => window.__dnPickImport(false));
await (await chooser).setFiles(zipPath);
await page.waitForSelector('.import-dialog', { timeout: 10000 });
const dlg = page.locator('.import-dialog');
const dlgText = await dlg.innerText();
check('미리보기: 노션으로 알아봄 · 노트 3개', dlgText.includes('노션') && (await dlg.locator('.import-stats b').first().innerText()) === '3', dlgText.slice(0, 200));
check('보고: 데이터베이스 · 변환 못 한 첨부', dlgText.includes('데이터베이스 1개') && dlgText.includes('첨부 파일 (.pdf) 1개'));
await dlg.locator('button.primary').click();
await page.waitForSelector('.import-dialog', { state: 'detached', timeout: 15000 });
await page.waitForTimeout(500);

const notes = await ws(() => window.__dn.state.notes.map((n) => ({ id: n.id, title: n.title, parent: n.parentNoteId, dbRef: n.dbRef })));
const by = (t) => notes.find((n) => n.title === t);
const root = by('노션 프로젝트'), meeting = by('노션 회의록'), report = by('보고서');
check('페이지 계층 → 하위 노트 · 항목 페이지', !!root && meeting?.parent === root.id && report?.parent === root.id && report?.dbRef?.noteId === root.id, JSON.stringify(notes.slice(-4)));
await ws((id) => window.__dn.openById(id), root.id);
await page.waitForSelector('.dn-db', { timeout: 10000 });
await page.waitForTimeout(300);
const info = await ws(() => {
  const v = window.__dn.view; const cs = [...v.engine.contents()];
  const db = cs.find((c) => c.type === 'database');
  const text = cs.find((c) => c.type === 'text');
  return { db: db && { title: db.title, types: db.properties.map((p) => p.type), rows: db.rows.length, page: db.rows.find((r) => r.page)?.page },
    kinds: text.doc.content.map((n) => n.type), table: cs.some((c) => c.type === 'table'), links: JSON.stringify(text.doc).match(/"note_link"/g)?.length ?? 0 };
});
check('CSV → 데이터베이스 블록 (타입 추정)', info.db?.title === '과제 목록' && info.db.types.join() === 'text,select,date,number' && info.db.rows === 3, JSON.stringify(info.db));
check('항목 페이지 연결', info.db?.page === report.id);
check('콜아웃 · 토글 · 표 · 페이지 링크', info.kinds.includes('callout') && info.kinds.includes('toggle') && info.table && info.links === 1, JSON.stringify(info));
await page.screenshot({ path: `${OUT}/notion.png` });
// 항목 페이지 열기 → 머리에 데이터베이스
await page.locator('.dn-db .dn-db-open-page.has').first().click({ force: true });
await page.waitForSelector('.db-rowbar', { timeout: 10000 });
check('가져온 항목 페이지를 데이터베이스에서 열기', (await ws(() => window.__dn.state.currentId)) === report.id && (await page.locator('.db-rowbar').innerText()).includes('과제 목록'));

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
