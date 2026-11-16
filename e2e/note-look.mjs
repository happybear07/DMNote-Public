// 노트 아이콘 · 커버 (FR-070): 위 막대 아이콘 → 이모지 · 선 아이콘 · 직접 입력 · 없애기, 사이드바 · 빠른 전환 · 홈에 같이 보임,
// 커버 추가(파일 고르기) → 위치 조정(끌기, 실행 취소 한 번) → 없애기, 다시 열어도 그대로, 노트 백업에 커버 이미지도. 사용: dev 서버 실행 후 `node e2e/note-look.mjs [폴더]`
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2] ?? '.';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
process.on('unhandledRejection', (e) => { if (!/TargetClosedError|has been closed/.test(String(e))) throw e; });

const browser = await chromium.launch({ channel: process.env.DN_CHANNEL ?? 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
await ctx.addInitScript(() => localStorage.setItem('dn:no-env-key', '1'));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });
const ws = (fn, arg) => page.evaluate(fn, arg);
await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(() => window.__dn.newNote());
await page.waitForTimeout(400);
await ws(() => window.__dn.setTitle('독서 기록'));
await page.waitForTimeout(600);
const noteId = await ws(() => window.__dn.state.currentId);
const noteIcon = () => ws(() => window.__dn.view.engine.note.icon ?? null);
const sideRow = () => page.locator('.note-item', { hasText: '독서 기록' }).first();

// ── 아이콘 ──
await page.locator('.topbar .doc-icon').click();
await page.waitForSelector('.icon-picker');
await page.screenshot({ path: `${OUT}/note-look-picker.png` });
await page.locator('.icon-picker .ip-cell', { hasText: '📚' }).click();
await page.waitForTimeout(200);
check('이모지 고르기 → 노트 아이콘 · 위 막대', (await noteIcon()) === '📚' && (await page.locator('.topbar .doc-icon').innerText()).includes('📚'));
check('사이드바에도 바로', (await sideRow().locator('.note-emoji').innerText().catch(() => '')) === '📚');
await page.locator('.topbar .doc-icon').click();
await page.locator('.icon-picker [role=tab]', { hasText: '아이콘' }).click();
await page.locator('.icon-picker .ip-cell[aria-label="아이콘 star"]').click();
await page.waitForTimeout(150);
check('선 아이콘 고르기 → icon:star', (await noteIcon()) === 'icon:star' && (await page.locator('.topbar .doc-icon svg').count()) === 1);
await ws(() => window.__dn.view.root.focus());
await page.keyboard.press('Control+z');
await page.waitForTimeout(150);
check('실행 취소 한 번 → 앞 아이콘(📚)', (await noteIcon()) === '📚' && (await page.locator('.topbar .doc-icon').innerText()).includes('📚'));
await page.locator('.topbar .doc-icon').click();
await page.locator('.ip-custom input').fill('🦄 유니콘');
await page.locator('.ip-custom button').click();
await page.waitForTimeout(150);
check('직접 입력 → 앞의 글자 둘까지 (🦄 + 공백은 다듬음)', (await noteIcon()) === '🦄', String(await noteIcon()));

// 빠른 전환 · 홈
await page.keyboard.press('Control+p');
await page.waitForSelector('.search-row');
const sw = await page.locator('.search-row', { hasText: '독서 기록' }).first().locator('.note-emoji').innerText().catch(() => '');
check('빠른 전환 목록에도 아이콘', sw === '🦄', sw);
await page.keyboard.press('Escape');

// ── 커버 ──
const png = Buffer.from(await page.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 900; c.height = 600;
  const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 0, 600); gr.addColorStop(0, '#4c6ef5'); gr.addColorStop(1, '#12b886');
  g.fillStyle = gr; g.fillRect(0, 0, 900, 600);
  return [...new Uint8Array(await (await new Promise((r) => c.toBlob(r, 'image/png'))).arrayBuffer())];
}));
const hostH0 = (await page.locator('.canvas-host').boundingBox()).height;
await page.locator('.topbar .doc-icon').click();
const chooser = page.waitForEvent('filechooser');
await page.locator('.icon-picker .ip-cover').click();
await (await chooser).setFiles({ name: '표지.png', mimeType: 'image/png', buffer: png });
await page.waitForSelector('.cover img', { timeout: 5000 }).catch(() => {});
const cover = await ws(() => window.__dn.view.engine.note.cover ?? null);
const hostH1 = (await page.locator('.canvas-host').boundingBox()).height;
check('커버 이미지 추가 → 띠 · 첨부 저장 · 가운데 위치', !!cover && cover.pos === 50 && (await page.locator('.cover img').count()) === 1 && hostH1 < hostH0, JSON.stringify({ cover, hostH0, hostH1 }));
await page.locator('.cover').hover();
await page.locator('.cover-actions button', { hasText: '위치 조정' }).click();
const cb = await page.locator('.cover').boundingBox();
await page.mouse.move(cb.x + cb.width / 2, cb.y + 40);
await page.mouse.down();
await page.mouse.move(cb.x + cb.width / 2, cb.y + 100, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(150);
const pos1 = await ws(() => window.__dn.view.engine.note.cover.pos);
check('위치 조정: 아래로 끌면 위쪽이 더 보이게 (pos 감소)', pos1 < 50, String(pos1));
await page.locator('.cover-actions button', { hasText: '완료' }).click();
await page.screenshot({ path: `${OUT}/note-look-cover.png` });
await ws(() => window.__dn.view.root.focus());
await page.keyboard.press('Control+z');
await page.waitForTimeout(150);
check('위치 조정도 실행 취소 한 번', (await ws(() => window.__dn.view.engine.note.cover?.pos)) === 50);
await page.keyboard.press('Control+Shift+z');
await page.waitForTimeout(800);

// 다시 열어도 그대로
await page.reload();
await page.waitForSelector('.dn-block, .empty-guide, .canvas-host', { timeout: 15000 });
await ws((id) => window.__dn.openById(id), noteId);
await page.waitForTimeout(800);
check('다시 열어도 아이콘 · 커버 그대로', (await noteIcon()) === '🦄' && (await page.locator('.cover img').count()) === 1 && (await ws(() => window.__dn.view.engine.note.cover.pos)) === pos1);
check('새로 고침 뒤 사이드바 아이콘(저장된 목록 정보)', (await sideRow().locator('.note-emoji').innerText().catch(() => '')) === '🦄');

// 노트 백업에 커버 이미지도
const dl = page.waitForEvent('download');
await ws((id) => window.__dn.exportNoteBackup(id), noteId);
const file = join(OUT, 'note-look-backup.json');
await (await dl).saveAs(file);
const backup = JSON.parse(readFileSync(file, 'utf8'));
check('노트 백업에 커버 이미지 포함', (backup.attachments ?? []).some((a) => a.hash === cover.attachment && a.data), JSON.stringify((backup.attachments ?? []).map((a) => a.hash.slice(0, 8))));

// 없애기
await page.locator('.cover').hover();
await page.locator('.cover-actions button', { hasText: '없애기' }).click();
await page.waitForTimeout(200);
await page.locator('.topbar .doc-icon').click();
await page.locator('.ip-head button', { hasText: '없애기' }).click();
await page.waitForTimeout(200);
check('커버 · 아이콘 없애기 → 기본 모양', (await page.locator('.cover').count()) === 0 && (await noteIcon()) === null && (await page.locator('.topbar .doc-icon .note-emoji').count()) === 0);

// 읽기 모드에서는 고를 수 없다
await ws(() => window.__dn.setReadMode(true));
await page.waitForTimeout(150);
check('읽기 모드: 아이콘 버튼 꺼짐', await page.locator('.topbar .doc-icon').isDisabled());
await ws(() => window.__dn.setReadMode(false));

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
