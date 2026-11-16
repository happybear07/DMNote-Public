// 내보내기 확인 (FR-130): 노트 하나 → .md, 모든 노트 → ZIP(.md 폴더 구조 + 백업 JSON).
// 사용: dev 서버 실행 후 `node e2e/export.mjs [출력 폴더]` — 내려받은 파일도 그 폴더에 남긴다.
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2] ?? '.';
const results = [];
// 다운로드를 받은 브라우저를 닫을 때 playwright가 내부 약속을 거절한다 — 종료 과정의 소음이라 무시
process.on('unhandledRejection', (e) => { if (!/Target page, context or browser has been closed/.test(String(e))) throw e; });
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

const browser = await chromium.launch({ channel: process.env.DN_CHANNEL ?? 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
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

/** ZIP 읽기 (store 전용): 중앙 디렉터리 → 이름 · 내용 · CRC 일치 */
function readZip(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = {};
  for (let i = 0; i < count; i++) {
    const nameLen = buf.readUInt16LE(p + 28), extra = buf.readUInt16LE(p + 30), comment = buf.readUInt16LE(p + 32);
    const size = buf.readUInt32LE(p + 20), off = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const lName = buf.readUInt16LE(off + 26), lExtra = buf.readUInt16LE(off + 28);
    files[name] = buf.subarray(off + 30 + lName + lExtra, off + 30 + lName + lExtra + size).toString('utf8');
    p += 46 + nameLen + extra + comment;
  }
  return files;
}

// ───── 준비: 폴더 안 노트 · 서식 · 할 일 · 링크 · 화살표 ─────
const folderId = await ws(() => window.__dn.createFolder('업무/기록'));
await ws((f) => window.__dn.newNote({ folderId: f }), folderId);
await wait(300);
await ws(() => window.__dn.setTitle('내보내기 시험'));
const noteId = await ws(() => window.__dn.state.currentId);
await ws(() => window.__dn.view.addBlockAtCenter());
await wait(100);
await page.keyboard.type('## 소제목');
await page.keyboard.press('Enter');
await page.keyboard.type('[] 우유 사기');
await page.keyboard.press('Enter');
await page.keyboard.press('Enter');
await page.keyboard.type('참고 [[');
await wait(100);
await page.keyboard.type('Claude');
await wait(100);
await page.keyboard.press('Enter');
await page.keyboard.press('Escape');
await wait(200);
// 두 번째 상자 + 화살표
const ids = await ws(() => {
  const v = window.__dn.view; const e = v.engine; const a = v.selectedBlocks[0];
  v.addBlockAtCenter(); const b = v.selectedBlocks[0];
  return [a, b];
});
await page.keyboard.type('두 번째 상자');
await page.keyboard.press('Escape');
await ws(([a, b]) => window.__dn.view.engine.transact((tx) => tx.createArrow({ from: { blockId: a, side: 'auto' }, to: { blockId: b, side: 'auto' }, label: '다음' }), { origin: 'user' }), ids);
await ws((id) => window.__dn.addTag(id, '시험'), noteId);
await wait(700);

// ───── 노트 하나 → .md ─────
let dl = page.waitForEvent('download');
await page.keyboard.press('Control+Shift+P');
await page.keyboard.type('Markdown 파일로');
await page.keyboard.press('Enter');
let d = await dl;
const mdPath = join(OUT, d.suggestedFilename());
await d.saveAs(mdPath);
const md = readFileSync(mdPath, 'utf8');
check('파일 이름 = 노트 제목.md', d.suggestedFilename() === '내보내기 시험.md', d.suggestedFilename());
check('앞머리: 제목 · 날짜 · 태그', md.startsWith('---\ntitle: "내보내기 시험"') && /created: \d{4}-/.test(md) && md.includes('tags: ["시험"]'), md.slice(0, 120));
check('제목 · 소제목 · 할 일', md.includes('# 내보내기 시험') && md.includes('## 소제목') && md.includes('- [ ] 우유 사기'));
check('노트 링크 → [[지금 제목]]', md.includes('[[Claude API 구조 정리]]'));
check('화살표 → 관계 목록', md.includes('## 관계') && md.includes('→ 두 번째 상자 (다음)'), md.slice(md.indexOf('## 관계')));
// 화살표로 이어진 상자는 흐름 차례 (화살표가 나가는 상자 먼저 — 문서 뷰와 같은 순서)
check('문서 순서 (화살표 흐름 차례)', md.indexOf('소제목') < md.indexOf('두 번째 상자'));

// 클립보드 복사
await ws((id) => window.__dn.copyMarkdown(id), noteId);
const clip = await page.evaluate(() => navigator.clipboard.readText());
check('Markdown으로 복사 (Windows 클립보드는 줄바꿈이 CRLF)', clip.replaceAll('\r\n', '\n') === md, `${clip.length} vs ${md.length}: ${clip.slice(0, 60)}`);

// ───── 모든 노트 → ZIP ─────
await ws(() => window.__dn.openSettings());
await page.locator('.settings-nav button', { hasText: '데이터' }).click();
dl = page.waitForEvent('download');
await page.locator('button', { hasText: '모든 노트 내보내기' }).click();
d = await dl;
const zipPath = join(OUT, 'export-all.zip');
await d.saveAs(zipPath);
check('ZIP 이름', /^DamianNote-\d{4}-\d{2}-\d{2}\.zip$/.test(d.suggestedFilename()), d.suggestedFilename());
const files = readZip(readFileSync(zipPath));
const names = Object.keys(files);
check('폴더 구조 그대로 (금지 글자는 _)', names.includes('업무_기록/내보내기 시험.md'), names.join(' | '));
check('폴더 밖 노트는 맨 위', names.includes('Claude API 구조 정리.md'));
const backup = JSON.parse(files['_백업/damiannote-backup.json'] ?? '{}');
check('백업 JSON: 노트 · 폴더 · 태그 · 스냅샷', backup.app === 'DamianNote' && backup.notes?.length >= 2 && backup.folders?.length === 1 && backup.tags?.some((t) => t.name === '시험')
  && backup.notes.find((n) => n.meta.id === noteId)?.snapshot?.arrows && Object.keys(backup.notes.find((n) => n.meta.id === noteId).snapshot.arrows).length === 1);
check('ZIP 안 .md = 하나만 내보낸 것과 같은 내용', files['업무_기록/내보내기 시험.md'] === md);
check('설정에 마지막 내보내기 시각', (await page.locator('text=마지막 내보내기').count()) === 1);
await page.screenshot({ path: `${OUT}/export-settings.png` });

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await page.close();
await ctx.close();
await browser.close().catch(() => {});
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
