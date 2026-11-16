// 가져오기 확인 (FR-125 · FR-127): 백업 ZIP 되살리기(새 브라우저) · 같은 백업 다시 → 건너뛰기,
// 옵시디언식 폴더 · deflate ZIP(Markdown) → 폴더 · 태그 · [[링크]], 미리보기 · 되돌리기.
// 사용: dev 서버 실행 후 `node e2e/import.mjs [작업 폴더]`
import { chromium } from 'playwright-core';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';

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
/** 가져오기 버튼 → 파일 고르기 → 미리보기 대화상자 */
async function pick(page, files, folder = false) {
  const chooser = page.waitForEvent('filechooser');
  await page.evaluate((f) => window.__dnPickImport(f), folder);
  const fc = await chooser;
  // 폴더는 FileChooser.setFiles로 못 넘겨서 입력 요소에 직접 넣는다
  if (folder) await fc.element().setInputFiles(files);
  else await fc.setFiles(files);
  await page.waitForSelector('.import-dialog', { timeout: 10000 }).catch(async (e) => {
    throw new Error(`미리보기가 안 뜸 — 알림: ${await page.locator('.toast').innerText().catch(() => '(없음)')}`, { cause: e });
  });
}

// ───── 1. 원본 브라우저: 폴더 · 태그 · 링크 · 화살표가 있는 노트 → 모두 내보내기 ─────
const A = await fresh();
const folderId = await A.ws(() => window.__dn.createFolder('연구'));
await A.ws((f) => window.__dn.newNote({ folderId: f }), folderId);
await A.page.waitForTimeout(300);
await A.ws(() => window.__dn.setTitle('원본 노트'));
const origId = await A.ws(() => window.__dn.state.currentId);
await A.ws(() => window.__dn.view.addBlockAtCenter());
await A.page.keyboard.type('참고 [[');
await A.page.waitForTimeout(100);
await A.page.keyboard.type('Claude');
await A.page.keyboard.press('Enter');
await A.page.keyboard.press('Escape');
await A.ws(() => { const v = window.__dn.view; const a = v.selectedBlocks[0]; v.addBlockAtCenter(); const b = v.selectedBlocks[0];
  v.engine.transact((tx) => tx.createArrow({ from: { blockId: a, side: 'auto' }, to: { blockId: b, side: 'auto' } }), { origin: 'user' }); });
await A.page.keyboard.type('두 번째');
await A.page.keyboard.press('Escape');
await A.ws((id) => window.__dn.addTag(id, '중요'), origId);
await A.page.waitForTimeout(700);
const dl = A.page.waitForEvent('download');
await A.ws(() => window.__dn.exportAll());
const zipPath = join(OUT, 'backup-roundtrip.zip');
await (await dl).saveAs(zipPath);
const origCount = await A.ws(() => window.__dn.state.notes.length);
await A.ctx.close();

// ───── 2. 새 브라우저(빈 저장소)에서 백업 되살리기 ─────
const B = await fresh();
await pick(B.page, zipPath);
const dlg = B.page.locator('.import-dialog');
check('백업 ZIP → 되살리기 미리보기', (await dlg.locator('h2').innerText()).includes('백업') && (await dlg.locator('.import-stats').innerText()).includes(String(origCount)));
await B.page.screenshot({ path: `${OUT}/import-preview.png` });
await dlg.locator('select').selectOption('');
await dlg.locator('button.primary').click();
await B.page.waitForSelector('.import-dialog', { state: 'detached', timeout: 15000 });
await B.page.waitForTimeout(500);
const restored = await B.ws((id) => {
  const w = window.__dn; const n = w.state.notes.find((x) => x.id === id);
  return { has: !!n, folder: w.state.folders.find((f) => f.id === n?.folderId)?.name, tags: (n?.tagIds ?? []).map((t) => w.state.tags.find((x) => x.id === t)?.name) };
}, origId);
check('같은 id로 되살림 · 폴더 · 태그', restored.has && restored.folder === '연구' && restored.tags.join() === '중요', JSON.stringify(restored));
await B.ws((id) => window.__dn.openById(id), origId);
await B.page.waitForTimeout(400);
const shape = await B.ws(() => { const e = window.__dn.view.engine; return { blocks: e.blockCount, arrows: [...e.arrows()].length }; });
check('상자 · 화살표 그대로', shape.blocks === 2 && shape.arrows === 1, JSON.stringify(shape));
check('노트 링크가 살아 있음 (같은 id)', (await B.page.locator('.dn-block a.dn-note-link:not(.missing)').count()) === 1);
check('검색 색인도 만들어짐', (await B.ws(() => window.__dn.search('두 번째').length)) === 1);

// 같은 백업 다시 → 같은 노트가 있으니 기본은 건너뛰기
const beforeAgain = await B.ws(() => window.__dn.state.notes.length);
await pick(B.page, zipPath);
check('다시 가져오면 충돌 안내 · 기본 건너뛰기', (await dlg.locator('legend').innerText()).includes('이미') && (await dlg.locator('input[type=radio]').first().isChecked()));
await dlg.locator('button.primary').click();
await B.page.waitForSelector('.import-dialog', { state: 'detached', timeout: 15000 });
check('건너뛰면 늘지 않음', (await B.ws(() => window.__dn.state.notes.length)) === beforeAgain, String(await B.ws(() => window.__dn.state.notes.length)));

// ───── 3. 옵시디언식 볼트 (폴더 고르기) ─────
const vault = join(OUT, 'vault');
rmSync(vault, { recursive: true, force: true });
mkdirSync(join(vault, '프로젝트', '하위'), { recursive: true });
mkdirSync(join(vault, '.obsidian'), { recursive: true });
writeFileSync(join(vault, '.obsidian', 'app.json'), '{}');
const files = {
  '시작.md': '---\ntitle: 시작하기\ntags: [볼트, "가이드"]\ncreated: 2025-01-02\n---\n# 시작하기\n\n[[계획]]을 먼저 보고 #할일 정리.\n\n![[그림.png]]\n',
  '프로젝트/계획.md': '---\ntags:\n  - 볼트\n---\n- [ ] 일정 잡기\n- [x] 팀 꾸리기\n\n[[없는 노트]]와 [[시작|처음으로]]\n',
  '프로젝트/하위/메모.md': '그냥 메모 **굵게**\n',
};
for (const [p, t] of Object.entries(files)) writeFileSync(join(vault, ...p.split('/')), t);
await pick(B.page, vault, true);
check('폴더 → Markdown 미리보기 (숨김 폴더 제외)', (await dlg.locator('h2').innerText()).includes('Markdown') && (await dlg.locator('.import-stats b').first().innerText()) === '3');
check('이미지 경고', (await dlg.locator('.import-warn').allInnerTexts()).some((t) => t.includes('이미지')));
await dlg.locator('.import-field input:not([type=radio])').fill('옵시디언');
await dlg.locator('button.primary').click();
await B.page.waitForSelector('.import-dialog', { state: 'detached', timeout: 15000 });
await B.page.waitForTimeout(500);
const md = await B.ws(() => {
  const w = window.__dn; const by = (t) => w.state.notes.find((n) => n.title === t);
  const fname = (id) => w.state.folders.find((f) => f.id === id)?.name;
  const parentOf = (id) => w.state.folders.find((f) => f.id === w.state.folders.find((x) => x.id === id)?.parentId)?.name;
  const tags = (n) => (n?.tagIds ?? []).map((t) => w.state.tags.find((x) => x.id === t)?.name).sort().join();
  const s = by('시작하기'), p = by('계획'), m = by('메모');
  return { s: !!s, sTags: tags(s), sCreated: s && new Date(s.createdAt).getFullYear(), pFolder: fname(p?.folderId), pRoot: parentOf(p?.folderId), mFolder: fname(m?.folderId), mParent: parentOf(m?.folderId), pTags: tags(p) };
});
check('제목(앞머리) · 날짜 · 태그(앞머리 · #본문 · 공통)', md.s && md.sTags === '가이드,볼트,옵시디언,할일' && md.sCreated === 2025, JSON.stringify(md));
check('폴더 구조 보존 (새 폴더 아래)', md.pFolder === '프로젝트' && md.pRoot?.startsWith('가져온 노트') && md.mFolder === '하위' && md.mParent === '프로젝트', JSON.stringify(md));
await B.ws(() => window.__dn.openById(window.__dn.state.notes.find((n) => n.title === '계획').id));
await B.page.waitForTimeout(400);
const planDoc = await B.ws(() => JSON.stringify([...window.__dn.view.engine.contents()].map((c) => c.doc)));
check('[[링크]] → 노트 링크 (별칭 포함) · 없는 노트는 글자 그대로', (planDoc.match(/"note_link"/g) ?? []).length === 1 && planDoc.includes('[[없는 노트]]') && planDoc.includes('task_item'), planDoc.slice(0, 200));

// ───── 4. deflate ZIP (일반 압축 프로그램이 만든 것) ─────
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
const dz = join(OUT, 'notes-deflate.zip');
writeFileSync(dz, deflateZip([['압축/첫째.md', '# 첫째\n\n압축된 노트 '.repeat(20)], ['압축/둘째.md', '둘째 노트 [[첫째]]']]));
await pick(B.page, dz);
check('deflate ZIP 읽기', (await dlg.locator('.import-stats b').first().innerText()) === '2');
await dlg.locator('button.primary').click();
await B.page.waitForSelector('.import-dialog', { state: 'detached', timeout: 15000 });
await B.page.waitForTimeout(400);
const zipNotes = await B.ws(() => window.__dn.state.notes.filter((n) => n.title === '첫째' || n.title === '둘째').map((n) => n.id));
check('ZIP의 노트 2개 생김', zipNotes.length === 2, JSON.stringify(await B.ws(() => window.__dn.state.notes.map((n) => n.title || n.preview))));

// ───── 5. 되돌리기 ─────
await B.page.locator('.toast button', { hasText: '되돌리기' }).click();
await B.page.waitForTimeout(500);
check('되돌리기 → 이번 가져오기만 휴지통으로', (await B.ws((ids) => ids.every((id) => window.__dn.state.trash.some((n) => n.id === id)), zipNotes))
  && (await B.ws(() => window.__dn.state.notes.some((n) => n.title === '계획'))));

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await B.ctx.close();
await browser.close().catch(() => {});
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
