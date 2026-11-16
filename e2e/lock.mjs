// 잠금 확인 (FR-144 · 145 · 146): 잠금 비밀번호 정하기 → 노트 잠그기(저장 원본 암호화 · 미리보기 · 검색 · 내보내기 제외) →
// 금고 잠그면 노트 자리에 풀기 칸(틀린 비밀번호 안내) → 풀기 → 앱 잠금(새로 고침하면 잠금 화면 · 뒤 내용 가림) → 비밀번호 바꾸기 → 잠금 풀기.
// 사용: dev 서버 실행 후 `node e2e/lock.mjs [스크린샷 폴더]`
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
const PW = 'test-pass-123', PW2 = 'new-pass-456';
await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await wait(400);
const noteId = await ws(() => window.__dn.state.currentId);
const WORD = '구조 분석 파이프라인';
/** IDB 원본에 평문이 남았는지 (스냅샷 · 로그 · 버전) */
const rawHas = (word) => ws(async (word) => {
  const db = await new Promise((res) => { const r = indexedDB.open('dn-notes'); r.onsuccess = () => res(r.result); });
  let found = false;
  for (const s of ['snapshots', 'oplog', 'versions']) {
    const all = await new Promise((res) => { const r = db.transaction(s).objectStore(s).getAll(); r.onsuccess = () => res(r.result); });
    if (JSON.stringify(all, (_k, v) => (v instanceof ArrayBuffer || ArrayBuffer.isView(v) ? '' : v)).includes(word)) found = true;
  }
  db.close();
  return found;
}, word);

// ───── 비밀번호 정하기 ─────
await ws(() => window.__dn.set({ dialog: { kind: 'settings', reason: 'security' } }));
await page.waitForSelector('.security');
check('보안 설정: 비밀번호 분실 안내', (await page.locator('.security').innerText()).includes('되살릴 수 없어요'));
await page.locator('.security input[aria-label="새 비밀번호"]').fill(PW);
await page.locator('.security input[aria-label="비밀번호 확인"]').fill(PW);
await page.locator('.security button', { hasText: '비밀번호 정하기' }).click();
await wait(1500);
check('비밀번호 정하기 → 금고 풀림', (await ws(() => window.__dn.state.vault)) === 'open');
await page.keyboard.press('Escape');
await ws(() => window.__dn.closeDialog());

// ───── 노트 잠그기 ─────
check('잠그기 전: 원본에 평문', await rawHas(WORD));
await page.locator('.sidebar .note-list .note-item.active').click({ button: 'right' });
await page.locator('[role="menuitem"]', { hasText: '잠그기' }).click();
await wait(1200);
const meta = await ws((id) => window.__dn.state.notes.find((n) => n.id === id), noteId);
check('잠그기: 메타 표시 · 미리보기 없음 · 자물쇠 표시', meta.locked === true && !meta.preview && (await page.locator('.sidebar .note-item.active .lock-mark').count()) === 1);
check('저장 원본에 평문 없음 (암호화)', !(await rawHas(WORD)));
check('검색에서 빠짐', (await ws(() => window.__dn.index.query('파이프라인', window.__dn.state.notes, 5).length)) === 0);
await ws(() => { const v = window.__dn.view; const b = [...v.engine.blocks()][1]; v.startEditing(b.id, 'end'); });
await page.keyboard.type(' 기밀추가');
await page.keyboard.press('Escape');
await wait(1200);
check('잠긴 채 고친 것도 암호화로 저장', !(await rawHas('기밀추가')));
await ws((id) => window.__dn.exportNote(id), noteId);
await wait(200);
check('잠긴 노트는 내보내기 거절', (await page.locator('.toast').innerText()).includes('잠긴 노트는 내보낼 수 없어요'));

// ───── 금고 잠그기 → 풀기 칸 ─────
await ws(() => window.__dn.lockVault());
await page.waitForSelector('.note-unlock', { timeout: 5000 });
check('금고 잠그면 노트 내용 대신 풀기 칸', (await page.locator('.canvas-host .dn-block').count()) === 0 && (await page.locator('.note-unlock').isVisible()));
await page.locator('.note-unlock input').fill('wrong-pass');
await page.locator('.note-unlock button[type="submit"]').click();
await page.waitForSelector('.unlock-wrong', { timeout: 10000 });
check('틀린 비밀번호 안내', (await page.locator('.unlock-wrong').innerText()).includes('맞지 않아요'));
await page.locator('.note-unlock input').fill(PW);
await page.locator('.note-unlock button[type="submit"]').click();
await page.waitForSelector('.canvas-host .dn-block', { timeout: 10000 });
check('맞는 비밀번호 → 노트 열림 (고친 내용 그대로)', (await ws(() => JSON.stringify([...window.__dn.view.engine.contents()]))).includes('기밀추가'));
await page.screenshot({ path: `${OUT}/lock-unlocked.png` });

// ───── 앱 잠금 ─────
await ws(() => window.__dn.setAppLock(true, 5));
await wait(300);
await page.reload();
await page.waitForSelector('.lock-screen', { timeout: 15000 });
const hidden = await ws(() => ({ inert: document.querySelector('.app').inert, opaque: getComputedStyle(document.querySelector('.lock-screen')).backgroundColor }));
check('새로 고침하면 잠금 화면 · 뒤의 앱은 조작 불가', hidden.inert === true && !/rgba\(.*, 0\)/.test(hidden.opaque), JSON.stringify(hidden));
await page.screenshot({ path: `${OUT}/lock-screen.png` });
await page.locator('.lock-screen input').fill(PW);
await page.locator('.lock-screen button[type="submit"]').click();
await page.waitForSelector('.lock-screen', { state: 'detached', timeout: 10000 });
check('앱 잠금 풀기 → 금고도 풀림', (await ws(() => window.__dn.state.vault)) === 'open' && (await ws(() => window.__dn.state.appLocked)) === false);
await ws(() => window.__dn.lockApp());
await wait(100);
check('비활성 잠금 (lockApp)', (await page.locator('.lock-screen').count()) === 1);
await page.locator('.lock-screen input').fill(PW);
await page.locator('.lock-screen button[type="submit"]').click();
await page.waitForSelector('.lock-screen', { state: 'detached', timeout: 10000 });

// ───── 비밀번호 바꾸기 · 잠금 풀기 ─────
check('비밀번호 바꾸기: 틀리면 거절', (await ws((pw) => window.__dn.changeVaultPassword('nope', pw), PW2)) === 'wrong');
check('비밀번호 바꾸기', (await ws(({ a, b }) => window.__dn.changeVaultPassword(a, b), { a: PW, b: PW2 })) === 'ok');
await ws(() => window.__dn.setAppLock(false));
await ws(() => window.__dn.lockVault());
await page.waitForSelector('.note-unlock');
check('새 비밀번호로만 풀림', !(await ws((pw) => window.__dn.unlockVault(pw), PW)) && (await ws((pw) => window.__dn.unlockVault(pw), PW2)));
await page.waitForSelector('.canvas-host .dn-block', { timeout: 10000 });
await ws((id) => window.__dn.toggleNoteLock(id), noteId);
await wait(1200);
check('잠금 풀기 → 평문 저장 · 검색 복귀', (await rawHas(WORD)) && (await ws((id) => !window.__dn.state.notes.find((n) => n.id === id).locked, noteId)) && (await ws(() => window.__dn.index.query('파이프라인', window.__dn.state.notes, 5).length)) === 1);

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
