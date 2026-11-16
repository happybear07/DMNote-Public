// 버전 기록 확인 (FR-093): 직접 저장 · 노트를 떠날 때 자동 저장(바뀐 게 있을 때만) · 목록 · 미리보기(읽기) · 되돌리기(전 상태도 버전으로) ·
// 되돌리기 실행 취소 · 새로 고침 후에도 목록. 사용: dev 서버 실행 후 `node e2e/versions.mjs [스크린샷 폴더]`
import { chromium } from 'playwright-core';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2] ?? '.';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const browser = await chromium.launch({ channel: process.env.DN_CHANNEL ?? 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
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
const noteId = await ws(() => window.__dn.state.currentId);
const blocks = () => ws(() => window.__dn.view.engine.blockCount);
const versions = () => ws((id) => window.__dn.listVersions(id).then((l) => l.map((v) => v.reason)), noteId);
const orig = await blocks();

// 직접 저장 (대화상자 버튼)
await ws(() => window.__dn.openVersions());
await page.waitForSelector('.ver-dialog');
check('처음엔 버전 없음 안내', (await page.locator('.ver-empty').innerText()).includes('자동으로 남아요'));
await page.locator('.ver-dialog .btn', { hasText: '지금 상태 저장' }).click();
await wait(300);
check('지금 상태 저장 → 목록에', JSON.stringify(await versions()) === '["manual"]' && (await page.locator('.ver-item').count()) === 1);
await page.keyboard.press('Escape');

// 바뀐 게 없으면 떠나도 남기지 않음 → 고치고 떠나면 남김
await ws(() => window.__dn.newNote());
await wait(400);
await ws((id) => window.__dn.openById(id), noteId);
await wait(400);
check('바뀐 게 없으면 떠나도 안 남김', (await versions()).length === 1);
await ws(() => { const v = window.__dn.view; v.select([...v.engine.blocks()].map((b) => b.id).slice(0, 2)); v.deleteSelection(); });
await wait(200);
const damaged = await blocks();
await ws(() => window.__dn.newNote());
await wait(400);
await ws((id) => window.__dn.openById(id), noteId);
await wait(2200); // 떠날 때 버전은 다음 노트 열기를 막지 않게 1.5초 뒤에 쓴다
check('고치고 떠나면 자동으로 남김 (노트를 떠날 때)', JSON.stringify(await versions()) === '["close","manual"]', JSON.stringify(await versions()));

// 목록 · 미리보기 · 되돌리기
await ws(() => window.__dn.openVersions());
await page.waitForSelector('.ver-item');
check('목록: 새것부터 · 이유 표시', (await page.locator('.ver-item').first().innerText()).includes('노트를 떠날 때') && (await page.locator('.ver-item').nth(1).innerText()).includes('직접 저장'));
await page.locator('.ver-item').nth(1).click();
await page.waitForFunction((n) => document.querySelectorAll('.ver-preview .dn-doc-item').length === n, orig, { timeout: 5000 }).catch(() => {});
check('미리보기: 그때 내용 (읽기 전용 문서)', (await page.locator('.ver-preview .dn-doc-item').count()) === orig && (await page.locator('.ver-preview .dn-text-editing').count()) === 0,
  String(await page.locator('.ver-preview .dn-doc-item').count()));
await page.screenshot({ path: `${OUT}/versions.png` });
await page.locator('.ver-dialog .btn.primary').click();
await page.waitForSelector('.ver-dialog', { state: 'detached' });
await wait(300);
check('되돌리기: 그때 블록 수', (await blocks()) === orig && damaged < orig, JSON.stringify({ orig, damaged, now: await blocks() }));
check('되돌리기 전 상태도 버전으로', (await versions())[0] === 'before-restore');
await ws(() => window.__dn.view.root.focus());
await page.keyboard.press('Control+z');
await wait(200);
check('되돌리기도 실행 취소 한 번', (await blocks()) === damaged);

await wait(800);
await page.reload();
await page.waitForSelector('.dn-block', { timeout: 15000 });
check('새로 고침 후에도 목록', (await versions()).length >= 3);

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
