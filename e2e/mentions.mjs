// 멘션 (FR-133): '@' 메뉴에 노트와 날짜 — '@내일' · '@다음 주 금요일'(띄어 써도 메뉴 유지) · 빈 '@'는 오늘 · 내일도,
// 날짜는 오늘 기준 상대 표기(오늘 · 내일 · 10월 9일 (금)), 편집 중 누르면 날짜 바꾸기, 검색 · Markdown은 YYYY-MM-DD. 사용: dev 서버 실행 후 `node e2e/mentions.mjs`
import { chromium } from 'playwright-core';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2] ?? '.';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
process.on('unhandledRejection', (e) => { if (!/TargetClosedError|has been closed/.test(String(e))) throw e; });

const browser = await chromium.launch({ channel: process.env.DN_CHANNEL ?? 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
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

// 기대 날짜 (브라우저 시간대 기준)
const want = await ws(() => {
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const add = (n) => new Date(t.getFullYear(), t.getMonth(), t.getDate() + n);
  const monday = add(-((t.getDay() + 6) % 7));
  return { today: iso(t), tomorrow: iso(add(1)), nextFri: iso(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 11)) };
});
const dates = () => ws(() => {
  const out = [];
  const walk = (n) => { if (n.type === 'date_mention') out.push(n.attrs.date); for (const k of n.content ?? []) walk(k); };
  for (const c of window.__dn.view.engine.contents()) if (c.type === 'text') walk(c.doc);
  return out;
});
const menuItems = () => page.locator('.dn-link-menu:not([hidden]) .dn-slash-item').allInnerTexts();

await ws(() => window.__dn.view.addBlockAtCenter('text'));
await page.waitForTimeout(200);
await page.keyboard.type('기획 회의 @');
await page.waitForTimeout(200);
const empty = await menuItems();
check("빈 '@' → 노트 목록 뒤에 오늘 · 내일", empty.some((t) => t.startsWith('오늘')) && empty.some((t) => t.startsWith('내일')), JSON.stringify(empty));
await page.keyboard.type('내일');
await page.waitForTimeout(200);
check("'@내일' → 날짜가 맨 위", (await menuItems())[0]?.startsWith('내일'), JSON.stringify(await menuItems()));
await page.keyboard.press('Enter');
await page.waitForTimeout(150);
check('Enter → 날짜 멘션 (내일 날짜로 저장)', JSON.stringify(await dates()) === JSON.stringify([want.tomorrow]), JSON.stringify(await dates()));
await page.keyboard.type('마감 @다음 주 금');
await page.waitForTimeout(200);
check("띄어 쓴 날짜 말('다음 주 금')에도 메뉴 유지 · 날짜 후보", (await menuItems())[0]?.includes(want.nextFri.slice(5).replace('-', '월 ').replace(/^0/, '')) || (await menuItems())[0]?.includes('날짜'),
  JSON.stringify(await menuItems()));
await page.keyboard.press('Enter');
await page.waitForTimeout(150);
check('다음 주 금요일 멘션', (await dates())[1] === want.nextFri, JSON.stringify(await dates()));
// 메일 주소처럼 쓰인 @는 그대로
await page.keyboard.type(' 문의 team@example.com ');
await page.waitForTimeout(150);
check('글 속 @(메일 주소)는 메뉴 없이 글자로', (await page.locator('.dn-link-menu:not([hidden])').count()) === 0 && (await dates()).length === 2);
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
const shown = await page.locator('.dn-block .dn-date').allInnerTexts();
check('편집을 끝내면 상대 표기 (내일 · M월 D일 (요일))', shown[0] === '내일' && /^\d{1,2}월 \d{1,2}일 \([일월화수목금토]\)$/.test(shown[1] ?? ''), JSON.stringify(shown));
await page.screenshot({ path: `${OUT}/mentions.png` });

// 편집 중 날짜를 눌러 바꾸기 (브라우저 날짜 창 대신 입력 칸 값을 바꿔 change)
const bid = await ws(() => window.__dn.view.selectedBlocks[0] ?? [...window.__dn.view.engine.blocks()].pop().id);
await ws((id) => window.__dn.view.startEditing(id, 'end'), bid);
await page.waitForTimeout(150);
// 날짜를 누르면 작은 창 (날짜 · 알림 · 반복)
await page.locator('.dn-text-editing .dn-date').first().click();
await page.waitForSelector('.dn-date-pop');
check('편집 중 날짜를 누르면 날짜 · 알림 · 반복 창', (await page.locator('.dn-date-pop input[type=date]').count()) === 1 && (await page.locator('.dn-date-pop input[type=time]').count()) === 1);
await page.evaluate((d) => {
  const input = document.querySelector('.dn-date-pop .dn-date-input');
  input.value = d; input.dispatchEvent(new Event('change', { bubbles: true }));
}, want.today);
await page.waitForTimeout(150);
check('편집 중 날짜 바꾸기 → 오늘 · 오늘 색', (await dates())[0] === want.today && (await page.locator('.dn-text-editing .dn-date-today').count()) === 1);
await ws(() => document.querySelector('.dn-text-editing')?.focus());
await page.keyboard.press('Control+z');
await page.waitForTimeout(150);
check('날짜 바꾸기도 실행 취소 한 번', (await dates())[0] === want.tomorrow);
await page.keyboard.press('Escape');

// 검색은 YYYY-MM-DD로
await page.waitForTimeout(900);
const hits = await ws((d) => window.__dn.search(d).length, want.nextFri);
check('검색: 날짜(YYYY-MM-DD)로 노트 찾기', hits >= 1, String(hits));

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
