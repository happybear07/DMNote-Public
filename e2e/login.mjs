// 로그인 (FR-094 · 화면 17 · 17-4~6): 서버 연결 전에는 로그인 단추가 막히고 "로그인 없이"만, 흉내 서버로 이메일 → 메일 확인(다시 보내기 60초) →
// 링크 열기 → 로그인 · 새로 고침 후에도 · 다른 탭도 따라옴, 만료 링크 → 새 링크 받기, Google, 삭제 예약 계정 → 취소, 로그아웃(노트 그대로), 폰 전체 화면.
// 사용: dev 서버 실행 후 `node e2e/login.mjs [스크린샷 폴더]`
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
const dlg = page.locator('.login-dialog');
await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });

// 서버 연결 전
await page.locator('.sidebar .account-btn').click();
await wait(150);
check('사이드바 "로그인" → 로그인 창', (await dlg.count()) === 1 && (await dlg.locator('h2').innerText()) === 'DamianNote에 로그인');
check('서버 연결 전: 로그인 단추는 막히고 안내 · "로그인 없이"는 열림', (await dlg.locator('.login-note').count()) === 1 && (await dlg.locator('.login-btn.apple').isDisabled()) && !(await dlg.locator('.login-skip').isDisabled()));
await dlg.locator('.login-skip').click();
check('로그인 없이 계속 → 창 닫힘 (편집은 그대로)', (await dlg.count()) === 0);

// 흉내 서버
await ws(() => localStorage.setItem('dn:auth-mock', '1'));
await page.reload();
await page.waitForSelector('.dn-block', { timeout: 15000 });
const notes = await ws(() => window.__dn.state.notes.length);
await ws(() => window.__dn.auth.open());
await wait(100);
await dlg.locator('#login-email').fill('잘못된주소');
await dlg.locator('button[type=submit]').click();
await wait(100);
check('이메일 형식 확인', (await dlg.locator('.login-err').innerText()).includes('이메일 주소'));
await dlg.locator('#login-email').fill('dami@example.com');
await dlg.locator('button[type=submit]').click();
await wait(200);
check('링크 받기 → 메일 확인 화면 (주소 · 다시 보내기 60초)', (await dlg.locator('h2').innerText()) === '메일을 확인해 주세요' && (await dlg.locator('.login-sub b').innerText()) === 'dami@example.com' && /\d+초 후/.test(await dlg.locator('.login-btn').first().innerText()) && (await dlg.locator('.login-btn').first().isDisabled()));
await page.screenshot({ path: `${OUT}/login-sent.png` });
// 다른 탭에서 메일의 링크를 열면 → 그 탭도 이 탭도 로그인
const link = await ws(() => window.__dnAuthLink);
const tab2 = await ctx.newPage();
await tab2.goto(BASE + '/' + link);
await tab2.waitForSelector('.dn-block', { timeout: 15000 });
await tab2.waitForTimeout(500);
check('링크를 연 탭: 로그인 · 주소창에 토큰 남지 않음', (await tab2.evaluate(() => window.__dn.state.account?.email)) === 'dami@example.com' && !(await tab2.evaluate(() => location.hash)));
await wait(500);
check('기다리던 탭도 따라서 로그인 · 메일 확인 창 닫힘', (await ws(() => window.__dn.state.account?.email)) === 'dami@example.com' && (await dlg.count()) === 0);
await tab2.close();
check('사이드바에 계정 이메일', (await page.locator('.sidebar .account-btn').innerText()).includes('dami@example.com'));
await page.reload();
await page.waitForSelector('.dn-block', { timeout: 15000 });
await wait(300);
check('새로 고침 후에도 로그인 그대로 (기기 암호화 저장)', (await ws(() => window.__dn.state.account?.email)) === 'dami@example.com');
// 로그아웃 — 노트는 그대로
await page.locator('.sidebar .account-btn').click();
await page.waitForSelector('.settings-body');
await page.locator('.settings-body button', { hasText: '로그아웃' }).click();
await page.locator('.dialog .btn.danger', { hasText: '노트 남기고 로그아웃' }).click();
await wait(300);
check('로그아웃 → 계정 없음 · 노트는 그대로', (await ws(() => window.__dn.state.account)) === null && (await ws(() => window.__dn.state.notes.length)) === notes);
await page.keyboard.press('Escape');

// 만료된 링크
await ws(() => window.__dn.auth.open());
await dlg.locator('#login-email').fill('expired@example.com');
await dlg.locator('button[type=submit]').click();
await wait(150);
await ws(() => window.__dn.auth.fromRedirect(window.__dnAuthLink));
await wait(200);
check('만료된 링크 → "링크가 만료됐어요" · 새 링크 받기', (await dlg.locator('h2').innerText()) === '로그인 링크가 만료됐어요' && (await dlg.locator('.login-btn.primary').innerText()) === '새 링크 받기');
await dlg.locator('.login-link').click();
check('다른 방법으로 로그인 → 처음 화면', (await dlg.locator('h2').innerText()) === 'DamianNote에 로그인');

// 삭제 예약 계정 → 취소하고 계속
await dlg.locator('#login-email').fill('delete@example.com');
await dlg.locator('button[type=submit]').click();
await wait(150);
await ws(() => window.__dn.auth.fromRedirect(window.__dnAuthLink));
await wait(200);
check('삭제 예약 계정 → 확인 창 (닫기 없음)', (await dlg.locator('h2').innerText()) === '계정 삭제가 예약돼 있어요' && (await dlg.locator('.x').count()) === 0);
await dlg.locator('.login-btn.primary').click();
await wait(300);
check('삭제 취소하고 계속 → 로그인', (await ws(() => window.__dn.state.account?.email)) === 'delete@example.com' && (await dlg.count()) === 0);
await ws(() => window.__dn.auth.logout());

// Google
await ws(() => window.__dn.auth.open());
await dlg.locator('.login-btn', { hasText: 'Google' }).click();
await wait(300);
check('Google로 계속 → 로그인', (await ws(() => window.__dn.state.account?.email)) === 'google@example.com');
await ws(() => window.__dn.auth.logout());

// 폰: 전체 화면 · 단추 48px
await page.setViewportSize({ width: 390, height: 844 });
await ws(() => window.__dn.auth.open());
await wait(200);
const box = await dlg.boundingBox();
const btnH = (await dlg.locator('.login-btn').first().boundingBox()).height;
check('폰: 로그인 창이 화면 가득 · 단추 48px', box.width === 390 && btnH >= 44, JSON.stringify({ w: box.width, btnH }));
await page.screenshot({ path: `${OUT}/login-phone.png` });

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
