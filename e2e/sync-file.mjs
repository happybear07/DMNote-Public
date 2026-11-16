// 기기 사이 동기화 파일 확인 (FR-096 · 097): 저장소가 따로인 두 "기기"(브라우저 컨텍스트)가 파일로 노트를 주고받는다.
// 처음 받으면 새 노트 → 양쪽에서 따로 고친 뒤 합치면 같은 문단 글자 단위 병합 · 지우기 ↔ 고치기 충돌은 남겨 두고 표시 →
// 남기기 → 다시 보내면 상대 기기도 같은 내용. 합치기 전 · 후 버전 기록. 사용: dev 서버 실행 후 `node e2e/sync-file.mjs [작업 폴더]`
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2] ?? '.';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
process.on('unhandledRejection', (e) => { if (!/TargetClosedError|has been closed/.test(String(e))) throw e; });
const browser = await chromium.launch({ channel: process.env.DN_CHANNEL ?? 'msedge', headless: true });
const errors = [];
async function device() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, acceptDownloads: true });
  await ctx.addInitScript(() => localStorage.setItem('dn:no-env-key', '1'));
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });
  await p.goto(BASE);
  await p.waitForSelector('.dn-block', { timeout: 15000 });
  await p.waitForTimeout(500);
  return { ctx, p, ws: (fn, arg) => p.evaluate(fn, arg) };
}
let n = 0;
async function exportFrom(d) {
  const dl = d.p.waitForEvent('download');
  await d.ws(() => window.__dn.exportSyncFile());
  const f = join(OUT, `sync-${++n}.json`);
  await (await dl).saveAs(f);
  return readFileSync(f, 'utf8');
}
const importTo = (d, text) => d.ws(async (text) => { await window.__dn.importSyncFile(new File([text], 'sync.json', { type: 'application/json' })); }, text);
/** 비교용: 콘텐츠를 id 순으로, 키도 정렬해서 (Y에서 다시 만든 객체는 키 순서가 다를 수 있다) */
const contentText = (d) => d.ws(() => { const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v); return JSON.stringify(canon([...window.__dn.view.engine.contents()].sort((a, b) => (a.id < b.id ? -1 : 1)))); });
const bodyOf = (d, blockId) => d.ws((id) => { const e = window.__dn.view.engine; return JSON.stringify(e.contentsOf(id)); }, blockId);
/** 블록 글 끝/앞에 글자 넣기 (에디터로) */
async function typeIn(d, blockId, text, where) {
  await d.ws(({ id, where }) => window.__dn.view.startEditing(id, where), { id: blockId, where });
  await d.p.keyboard.type(text);
  await d.p.keyboard.press('Escape');
  await d.p.waitForTimeout(300);
}

const A = await device();
const noteId = await A.ws(() => window.__dn.state.currentId);
const blocks = await A.ws(() => [...window.__dn.view.engine.blocks()].filter((b) => window.__dn.view.engine.contentsOf(b.id).some((c) => c.type === 'text' && c.role !== 'title')).map((b) => b.id));
const [b1, b2] = blocks;
// 첨부도 같이 간다: A에 그림 하나 (B의 저장소에는 없는 파일)
const imgHash = await A.ws(async () => {
  const c = document.createElement('canvas'); c.width = 80; c.height = 40;
  const g = c.getContext('2d'); g.fillStyle = 'tomato'; g.fillRect(0, 0, 80, 40);
  const file = new File([await new Promise((r) => c.toBlob(r, 'image/png'))], '점.png', { type: 'image/png' });
  await window.__dn.addImages([file], { x: 900, y: 0 });
  return [...window.__dn.view.engine.contents()].find((x) => x.type === 'image')?.attachment ?? null;
});
await A.p.waitForTimeout(900);
const f1 = await exportFrom(A);
check('A: 동기화 파일에 첨부(그림)도', (JSON.parse(f1).attachments ?? []).some((a) => a.hash === imgHash && a.data.length > 50));
check('A: 동기화 파일 만들기 (노트 · Y 기록)', JSON.parse(f1).notes.some((x) => x.id === noteId));

const B = await device();
await importTo(B, f1);
await B.p.waitForTimeout(500);
check('B: 처음 받으면 새 노트로', await B.ws((id) => window.__dn.state.notes.some((n) => n.id === id), noteId));
await B.ws((id) => window.__dn.openById(id), noteId);
await B.p.waitForTimeout(700);
check('B: 같은 내용', (await contentText(B)) === (await contentText(A)));
check('B: 그림 파일도 저장소에 들어와 보인다', !!imgHash && await B.ws((h) => window.__dn.fileUrl(h).then((u) => !!u), imgHash));

// 따로 고치기: A — b1 끝에 쓰고 b2 지우기, B — b1 앞에 쓰고 b2 고치기
await typeIn(A, b1, ' [A끝]', 'end');
await A.ws((id) => { const v = window.__dn.view; v.select([id]); v.deleteSelection(); }, b2);
await typeIn(B, b1, '[B앞] ', 'start');
await typeIn(B, b2, ' [B가 고침]', 'end');
await A.p.waitForTimeout(1200);
await B.p.waitForTimeout(1200);

const f2 = await exportFrom(A);
await importTo(B, f2);
await B.p.waitForTimeout(800);
const b1Text = await bodyOf(B, b1);
check('합치기: 같은 문단을 양쪽이 고친 것 글자 단위로', b1Text.includes('[A끝]') && b1Text.includes('[B앞]'), b1Text.slice(0, 160));
const conflict = await B.ws((id) => window.__dn.view.engine.getBlock(id)?.conflict, b2);
check('지우기 ↔ 고치기 충돌: 지우지 않고 남겨 두고 표시', conflict?.kind === 'remote-deleted' && (await bodyOf(B, b2)).includes('B가 고침'), JSON.stringify(conflict));
await B.p.waitForSelector('.dn-conflict');
check('충돌 안내 · 남기기 · 지우기 버튼', (await B.p.locator('.dn-conflict').innerText()).includes('다른 기기에서 지운 블록'));
await B.p.screenshot({ path: `${OUT}/sync-conflict.png` });
const reasons = await B.ws((id) => window.__dn.listVersions(id).then((l) => l.map((v) => v.reason)), noteId);
check('합치기 전 · 후 버전 기록', reasons.includes('before-sync') && reasons.includes('sync'), JSON.stringify(reasons));
await B.p.locator('.dn-conflict-keep').click();
await B.p.waitForTimeout(300);
check('남기기 → 충돌 표시 없어짐', !(await B.ws((id) => window.__dn.view.engine.getBlock(id)?.conflict, b2)) && (await B.p.locator('.dn-conflict').count()) === 0);
await B.p.waitForTimeout(1200);

// B → A: 남긴 블록 · 합친 글이 A에도
const f3 = await exportFrom(B);
await importTo(A, f3);
await A.p.waitForTimeout(800);
const aB2 = await bodyOf(A, b2);
check('다시 보내면 A도 같은 내용 (남긴 블록 되살아남)', aB2.includes('B가 고침') && (await bodyOf(A, b1)).includes('[B앞]'));
check('양쪽 최종 내용 같음', (await contentText(A)) === (await contentText(B)));

// 새로 고침 뒤에도 동기화 노트 기록 유지 → 또 합쳐도 충돌 없음
await A.p.reload();
await A.p.waitForSelector('.dn-block', { timeout: 15000 });
await typeIn(A, b1, ' [A다시]', 'end');
await A.p.waitForTimeout(1500);
const f4 = await exportFrom(A);
await importTo(B, f4);
await B.p.waitForTimeout(800);
check('새로 고침 뒤에도 기록이 이어져 깔끔히 합쳐짐', (await bodyOf(B, b1)).includes('[A다시]') && (await B.p.locator('.dn-conflict').count()) === 0);

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await A.ctx.close().catch(() => {}); await B.ctx.close().catch(() => {});
await browser.close().catch(() => {});
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
