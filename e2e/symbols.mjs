// 기호 · 이모지 (워드 삽입 › 기호, 노션 /emoji · ':'): ' :하트' → 이모지 메뉴 → Enter, '10:30'은 메뉴 없음, /기호 판 · /이모지 찾기,
// 화살표 자동 바꾸기(-> → · => ⇒ · <=> ⇔), 서식 막대 기호 단추 · 캔버스에서도.
// 사용: dev 서버 실행 후 `node e2e/symbols.mjs [스크린샷 폴더]`
import { chromium } from 'playwright-core';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2];
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
const text = () => ws(() => [...window.__dn.view.engine.contents()].map((c) => (c.doc?.content ?? []).map((p) => (p.content ?? []).map((t) => t.text ?? '').join('')).join('/')).join('|'));

await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(() => window.__dn.newNote());
await wait(300);
await ws(() => window.__dn.setViewMode('doc'));
await wait(400);
await page.locator('.dn-doc-page').click({ position: { x: 300, y: 200 } });
await wait(200);

// ':' 이모지
await page.keyboard.type('좋아요 :하트');
await wait(250);
const first = await page.locator('.dn-emoji-menu:not([hidden]) .dn-slash-item .dn-slash-icon').first().innerText().catch(() => '');
check("' :하트' → 이모지 메뉴 (맨 위 ❤️)", first === '❤️', first);
if (OUT) await page.screenshot({ path: `${OUT}/symbols-emoji-menu.png` });
await page.keyboard.press('Enter');
await wait(200);
check('Enter → ":하트"가 ❤️로', (await text()).includes('좋아요 ❤️'), await text());
await page.keyboard.type(' 10:30 회의');
await wait(200);
check("'10:30'처럼 붙은 ':'는 메뉴 없음", (await page.locator('.dn-emoji-menu:not([hidden])').count()) === 0 && (await text()).includes('10:30 회의'));

// 화살표 자동 바꾸기
await page.keyboard.type(' A->B C=>D E<=>F');
await wait(200);
check('-> → · => ⇒ · <=> ⇔', (await text()).includes('A→B C⇒D E⇔F'), await text());

// /기호 판
await page.keyboard.type(' /기호');
await wait(250);
await page.keyboard.press('Enter');
await wait(250);
check('/기호 → 기호 판 (묶음 단추 · 칸)', (await page.locator('.dn-symbols-symbol .dn-symbols-tabs button').count()) >= 6);
if (OUT) await page.screenshot({ path: `${OUT}/symbols-picker.png` });
await page.locator('.dn-symbols-tabs button', { hasText: '수학' }).click();
await page.locator('.dn-symbols-grid button', { hasText: '≠' }).click();
await wait(200);
check('기호 판에서 ≠ → 커서 자리에 · 판 닫힘', (await text()).includes('≠') && (await page.locator('.dn-symbols').count()) === 0, await text());

// /이모지 찾기
await page.keyboard.type(' /이모지');
await wait(250);
await page.keyboard.press('Enter');
await wait(300);
await page.keyboard.type('완료');
await wait(200);
await page.keyboard.press('Enter');
await wait(250);
check('/이모지 → "완료" 찾기 → Enter → ✅ (빈 줄이 생기지 않음)', (await text()).includes('✅') && !(await text()).includes('✅/'), await text());

// 서식 막대 기호 단추
await page.locator('.doc-ribbon button[aria-label^="기호"]').click();
await wait(250);
check('서식 막대 기호 단추 → 기호 판', (await page.locator('.dn-symbols-symbol').count()) === 1);
await page.keyboard.press('Escape');
await wait(150);
check('Esc → 판 닫힘', (await page.locator('.dn-symbols').count()) === 0);

// 캔버스에서도 ':' 이모지
await ws(() => window.__dn.setViewMode('canvas'));
await wait(400);
await ws(() => { const v = window.__dn.view; v.select([]); v.addBlockAtCenter(); });
await wait(250);
await page.keyboard.type(':done');
await wait(250);
await page.keyboard.press('Enter');
await wait(250);
check('캔버스 상자에서 :done → ✅', (await text()).split('|').some((t) => t === '✅'), await text());
check('콘솔 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close();
const bad = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
