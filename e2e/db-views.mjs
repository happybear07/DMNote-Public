// 데이터베이스 뷰 확인 (FR-058 · 059 · 060 · 061): 필터(여러 조건) · 정렬(여러 기준) · 뷰별 저장 · 보드(묶음 · 개수 · 카드 끌기) ·
// 캘린더(달 · 날짜로 끌기 · 날 칸에서 새 항목) · 갤러리 · 리스트(카드 속성 고르기) · 새로 고침 유지.
// 사용: dev 서버 실행 후 `node e2e/db-views.mjs [스크린샷 폴더]`
import { chromium } from 'playwright-core';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2] ?? '.';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

const browser = await chromium.launch({ channel: process.env.DN_CHANNEL ?? 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
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
const db = () => ws(() => { const v = window.__dn.view; for (const b of v.engine.blocks()) for (const c of v.engine.contentsOf(b.id)) if (c.type === 'database') return JSON.parse(JSON.stringify(c)); return null; });

// 준비: 슬래시로 데이터베이스 → 이름 · 상태 · 날짜 채우기 (이번 달 날짜)
await ws(() => { const v = window.__dn.view; v.setCamera({ ...v.cam, x: v.cam.x + 3000 }); });
await wait(100);
await page.evaluate(() => window.__dn.view.setTool('block')); await page.mouse.click(500, 200);
await wait(300);
await page.keyboard.type('뷰 시험');
await page.keyboard.press('Enter');
await page.keyboard.type('/데이터');
await wait(250);
await page.keyboard.press('Enter');
await page.waitForSelector('.dn-db');
let d = await db();
const [NAME, STATUS, DATE] = d.properties.map((p) => p.id);
const opt = (n) => d.properties[1].options.find((o) => o.name === n).id;
const now = new Date();
const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
const items = [['가 보고서', '할 일', `${ym}-03`], ['나 발표', '완료', `${ym}-10`], ['다 복습', '진행 중', `${ym}-10`], ['라 정리', '할 일', '']];
await ws(({ cid, items, NAME, STATUS, DATE, opts }) => {
  const v = window.__dn.view; const e = v.engine;
  e.transact((tx) => {
    const c = e.getContent(cid);
    const rows = [...c.rows].sort((a, b) => (a.order < b.order ? -1 : 1));
    const extra = { ...rows[2], id: 'row-d', order: rows[2].order + 'V' };
    const all = [...rows, extra].map((r, i) => ({ ...r, values: { [NAME]: items[i][0], [STATUS]: opts[items[i][1]], ...(items[i][2] ? { [DATE]: items[i][2] } : {}) } }));
    tx.set('content', cid, { rows: all });
  }, { origin: 'user', label: '시험 데이터' });
}, { cid: d.id, items, NAME, STATUS, DATE, opts: Object.fromEntries(['할 일', '진행 중', '완료'].map((n) => [n, opt(n)])) });
await wait(150);
const visibleNames = () => page.locator('.dn-db .dn-db-table tbody tr[data-row] td:nth-child(2) input').evaluateAll((els) => els.map((e) => e.value));
check('준비: 항목 4개', (await visibleNames()).length === 4);

// ───── 필터 ─────
await page.locator('.dn-db-btn', { hasText: '필터' }).click();
await page.locator('.dn-db-pop .dn-db-mi', { hasText: '조건 추가' }).click();
const row0 = page.locator('.dn-db-pop .dn-db-frow').first();
await row0.locator('select').nth(0).selectOption(STATUS);
await page.locator('.dn-db-pop .dn-db-frow').first().locator('select').nth(2).selectOption(opt('할 일'));
await wait(100);
check('필터: 상태 = 할 일', JSON.stringify(await visibleNames()) === JSON.stringify(['가 보고서', '라 정리']), JSON.stringify(await visibleNames()));
await page.locator('.dn-db-pop .dn-db-mi', { hasText: '조건 추가' }).click();
await page.locator('.dn-db-pop .dn-db-frow').nth(1).locator('select').nth(1).selectOption('contains');
await page.locator('.dn-db-pop .dn-db-frow').nth(1).locator('input').fill('발표');
await page.locator('.dn-db-pop .dn-db-frow').nth(1).locator('input').press('Tab');
await wait(100);
check('필터 두 개 (모두): 결과 없음 안내', (await visibleNames()).length === 0 && (await page.locator('.dn-db-none').count()) === 1);
await page.locator('.dn-db-pop select[aria-label="조건 조합"]').selectOption('or');
await wait(100);
check('하나라도 만족으로 바꾸기', JSON.stringify(await visibleNames()) === JSON.stringify(['가 보고서', '나 발표', '라 정리']), JSON.stringify(await visibleNames()));
await page.keyboard.press('Escape');
check('필터 버튼에 개수', (await page.locator('.dn-db-btn', { hasText: '필터 2' }).count()) === 1);
// 필터 걸린 뷰에서 새 항목은 조건 값을 미리 채움 (and일 때) — or 이므로 그대로 만들어짐
// ───── 정렬 ─────
await page.locator('.dn-db-btn', { hasText: '필터' }).click();
for (let i = 0; i < 2; i++) { await page.locator('.dn-db-pop .dn-db-x').first().click(); await wait(60); }
await page.keyboard.press('Escape');
await page.locator('.dn-db-btn', { hasText: '정렬' }).click();
await page.locator('.dn-db-pop .dn-db-mi', { hasText: '정렬 추가' }).click();
await page.locator('.dn-db-pop .dn-db-frow').first().locator('select').nth(0).selectOption(DATE);
await page.locator('.dn-db-pop .dn-db-frow').first().locator('select').nth(1).selectOption('desc');
await page.locator('.dn-db-pop .dn-db-mi', { hasText: '정렬 추가' }).click();
await page.locator('.dn-db-pop .dn-db-frow').nth(1).locator('select').nth(0).selectOption(NAME);
await page.locator('.dn-db-pop .dn-db-frow').nth(1).locator('select').nth(1).selectOption('desc');
await page.keyboard.press('Escape');
await wait(100);
check('다중 정렬: 날짜 내림 → 이름 내림, 빈 날짜는 뒤', JSON.stringify(await visibleNames()) === JSON.stringify(['다 복습', '나 발표', '가 보고서', '라 정리']), JSON.stringify(await visibleNames()));

// ───── 보드 ─────
const addView = async (label) => { await page.locator('.dn-db-tab[aria-label="뷰 추가"]').click(); await page.locator('.dn-db-pop .dn-db-mi', { hasText: label }).click(); await wait(150); };
await addView('보드');
check('보드 뷰: 옵션마다 열 · 개수', (await page.locator('.dn-db-bcol').count()) === 3 && (await page.locator('.dn-db-bcol').first().locator('.dn-db-bcount').innerText()) === '2');
check('보드 뷰는 정렬이 없는 새 뷰 (뷰별 저장)', !(await db()).views.find((v) => v.kind === 'board').sorts);
const card = page.locator('.dn-db-bcol').first().locator('.dn-db-card').first();
const cb = await card.boundingBox();
const doneCol = await page.locator('.dn-db-bcol').nth(2).boundingBox();
await page.mouse.move(cb.x + cb.width - 8, cb.y + cb.height - 6);
await page.mouse.down();
await page.mouse.move(doneCol.x + 40, doneCol.y + doneCol.height - 10, { steps: 8 });
await page.mouse.up();
await wait(150);
d = await db();
const ga = d.rows.find((r) => r.values[NAME] === '가 보고서');
check('카드를 완료 열로 끌면 상태가 완료', ga.values[STATUS] === opt('완료') && (await page.locator('.dn-db-bcol').nth(2).locator('.dn-db-bcount').innerText()) === '2');
await ws(() => window.__dn.view.root.focus());
await page.keyboard.press('Control+z');
await wait(120);
check('카드 옮기기 실행 취소 한 번', (await db()).rows.find((r) => r.values[NAME] === '가 보고서').values[STATUS] === opt('할 일'));
await page.locator('.dn-db-bcol').nth(1).locator('.dn-db-new').click();
await wait(150);
check('열의 + 새 항목은 그 값으로', (await db()).rows.filter((r) => r.values[STATUS] === opt('진행 중')).length === 2);
await page.screenshot({ path: `${OUT}/db-board.png` });

// ───── 캘린더 ─────
await addView('캘린더');
const ev = page.locator('.dn-db-ev', { hasText: '가 보고서' });
check('캘린더: 이번 달 · 항목이 날짜 칸에', (await page.locator('.dn-db-calmonth').innerText()) === `${now.getFullYear()}년 ${now.getMonth() + 1}월` && (await ev.count()) === 1
  && (await page.locator(`.dn-db-day[data-day="${ym}-10"] .dn-db-ev`).count()) === 2);
const eb = await ev.boundingBox();
const target = await page.locator(`.dn-db-day[data-day="${ym}-15"]`).boundingBox();
await page.mouse.move(eb.x + 10, eb.y + 5);
await page.mouse.down();
await page.mouse.move(target.x + 20, target.y + 30, { steps: 8 });
await page.mouse.up();
await wait(150);
check('일정을 다른 날로 끌기', (await db()).rows.find((r) => r.values[NAME] === '가 보고서').values[DATE] === `${ym}-15`);
await page.locator(`.dn-db-day[data-day="${ym}-20"]`).hover();
await page.locator(`.dn-db-day[data-day="${ym}-20"] .dn-db-dadd`).click();
await wait(150);
check('날 칸 + 로 그 날짜의 새 항목', (await db()).rows.some((r) => r.values[DATE] === `${ym}-20`));
await page.locator('.dn-db-calnav button[aria-label="다음 달"]').click();
check('다음 달로 넘기기', (await page.locator('.dn-db-calmonth').innerText()) !== `${now.getFullYear()}년 ${now.getMonth() + 1}월`);
await page.screenshot({ path: `${OUT}/db-calendar.png` });

// ───── 갤러리 · 리스트 · 카드 속성 ─────
await addView('갤러리');
check('갤러리: 카드 격자', (await page.locator('.dn-db-gallery .dn-db-card').count()) === 6);
await page.locator('.dn-db-tab.on').click();
await page.locator('.dn-db-pop .dn-db-mi', { hasText: '날짜' }).click();
await page.keyboard.press('Escape');
await wait(100);
check('카드에 보일 속성 고르기 (날짜 끄기)', !(await page.locator('.dn-db-gallery').innerText()).includes(`${ym}-10`));
await addView('리스트');
check('리스트: 한 줄씩', (await page.locator('.dn-db-list .dn-db-line').count()) === 6);
// 뷰 이름 바꾸기 · 표로 돌아가면 정렬 유지
await page.locator('.dn-db-tab.on').click();
await page.locator('.dn-db-pop .dn-db-pin').first().fill('할 일 목록');
await page.locator('.dn-db-pop .dn-db-pin').first().press('Enter');
await wait(80);
check('뷰 이름 바꾸기', (await page.locator('.dn-db-tab.on').innerText()).includes('할 일 목록'));
await page.locator('.dn-db-tab', { hasText: '표' }).click();
await wait(100);
check('표 뷰로 돌아가면 그 뷰의 정렬 그대로', (await page.locator('.dn-db-btn', { hasText: '정렬 2' }).count()) === 1);

await wait(800);
await page.reload();
await page.waitForSelector('.dn-db', { timeout: 15000 });
d = await db();
check('새로 고침 후 뷰 5개 · 지금 뷰 유지', d.views.length === 5 && d.views.find((v) => v.id === d.activeView)?.kind === 'table');

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
