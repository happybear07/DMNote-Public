// 관계 · 집계 (FR-062): 속성 추가 → 관계(같은 노트의 다른 데이터베이스) → 양쪽 열, 칸에서 항목 잇기 · 새 항목 만들어 잇기,
// 저쪽에 거꾸로 보임, 집계(개수 · 합계), 항목 삭제 시 연결도 정리, 실행 취소 한 번, 관계 속성 메뉴(타입 바꾸기 없음).
// 사용: dev 서버 실행 후 `node e2e/db-relations.mjs [스크린샷 폴더]`
import { chromium } from 'playwright-core';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2] ?? '.';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
process.on('unhandledRejection', (e) => { if (!/TargetClosedError|has been closed/.test(String(e))) throw e; });

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
await ws(() => window.__dn.newNote());
await wait(300);

// 데이터베이스 둘: 프로젝트(홈페이지 · 앱) · 할 일(디자인 · 개발 · 시험, 시간 숫자)
const ids = await ws(() => window.__dn.view.engine.transact((tx) => {
  const mk = (title, x, names, extra = []) => {
    const b = tx.createBlock({ x, y: 0, w: 480, h: 200 });
    const nameP = `${title}-name`;
    const rows = names.map((n, i) => ({ id: `${title}-r${i}`, order: `a${i}`, values: { [nameP]: n, ...(extra[i] ?? {}) } }));
    const props = [{ id: nameP, name: '이름', type: 'text', width: 160 }];
    if (title === 'task') props.push({ id: 'task-hours', name: '시간', type: 'number', width: 90 });
    const c = tx.createContent({ blockId: b, type: 'database', title: title === 'proj' ? '프로젝트' : '할 일', properties: props, rows });
    return c;
  };
  return { proj: mk('proj', 0, ['홈페이지', '앱']), task: mk('task', 700, ['디자인', '개발', '시험'], [{ 'task-hours': 3 }, { 'task-hours': 5 }, { 'task-hours': 2 }]) };
}, { origin: 'user' }).value);
await ws(() => window.__dn.view.fit());
await wait(500);
const dbOf = (id) => ws((id) => JSON.parse(JSON.stringify(window.__dn.view.engine.getContent(id))), id);
const projEl = () => page.locator('.dn-db').nth(0);
const taskEl = () => page.locator('.dn-db').nth(1);

// 속성 추가 → 관계
await projEl().locator('.dn-db-add').click();
await page.waitForSelector('.dn-db-pop');
const menuText = await page.locator('.dn-db-pop').innerText();
check('속성 추가 메뉴: 관계 — 같은 노트의 다른 데이터베이스 · 집계', menuText.includes('관계 — 할 일') && menuText.includes('집계'), menuText.replace(/\n/g, ' | '));
await page.locator('.dn-db-pop button', { hasText: '관계 — 할 일' }).click();
await wait(300);
let proj = await dbOf(ids.proj), task = await dbOf(ids.task);
const rel = proj.properties.find((p) => p.type === 'relation'), pair = task.properties.find((p) => p.type === 'relation');
check('관계 → 양쪽에 짝 열 (이름 = 서로의 데이터베이스)', rel?.name === '할 일' && pair?.name === '프로젝트' && rel.relation.pair === pair.id);

// 칸에서 잇기
await projEl().locator(`[data-key="proj-r0:${rel.id}"]`).click();
await page.waitForSelector('.dn-db-pop');
await page.locator('.dn-db-pop button', { hasText: '디자인' }).click();
await wait(150);
await page.locator('.dn-db-pop button', { hasText: '개발' }).click();
await wait(150);
// 없는 이름 → 할 일에 새 항목을 만들어 잇기
await page.locator('.dn-db-pop input').fill('배포');
await page.keyboard.press('Enter');
await wait(200);
await page.keyboard.press('Escape');
await wait(300);
const chips = await projEl().locator(`[data-key="proj-r0:${rel.id}"] .dn-db-relchip`).allInnerTexts();
check('칸에서 고르기 · 새 이름은 저쪽에 항목을 만들어 잇기', JSON.stringify(chips) === JSON.stringify(['↗ 디자인', '↗ 개발', '↗ 배포']), JSON.stringify(chips));
task = await dbOf(ids.task);
const back = task.rows.filter((r) => (r.values[pair.id] ?? []).includes('proj-r0')).map((r) => r.values['task-name']);
check('저쪽(할 일)에 거꾸로 보임', JSON.stringify(back.sort()) === JSON.stringify(['개발', '디자인', '배포'].sort()) && (await taskEl().locator('.dn-db-relchip', { hasText: '홈페이지' }).count()) === 3, JSON.stringify(back));

// 집계: 개수 → 합계(시간)
await projEl().locator('.dn-db-add').click();
await page.locator('.dn-db-pop button', { hasText: '집계' }).click();
await wait(300);
proj = await dbOf(ids.proj);
const ru = proj.properties.find((p) => p.type === 'rollup');
check('집계 추가 → 개수', (await projEl().locator(`[data-key="proj-r0:${ru.id}"]`).innerText()) === '3' && (await projEl().locator(`[data-key="proj-r1:${ru.id}"]`).innerText()) === '0');
await projEl().locator('.dn-db-prop', { hasText: '집계' }).click();
await page.waitForSelector('.dn-db-pop');
check('집계 속성 메뉴: 타입 목록 대신 관계 · 계산', !(await page.locator('.dn-db-pop').innerText()).includes('다중 선택') && (await page.locator('.dn-db-pop').innerText()).includes('계산'));
await page.locator('.dn-db-pop button', { hasText: '합계' }).click();
await wait(150);
await page.locator('.dn-db-pop button', { hasText: '시간' }).click();
await wait(150);
await page.keyboard.press('Escape');
await wait(300);
check('합계(시간) = 3 + 5 (배포는 비어 있음)', (await projEl().locator(`[data-key="proj-r0:${ru.id}"]`).innerText()) === '8');
await page.screenshot({ path: `${OUT}/db-relations.png` });

// 저쪽 항목 삭제 → 연결 · 집계도 정리, 실행 취소 한 번에 복구
const growRow = task.rows.find((r) => r.values['task-name'] === '개발').id;
const gi = (await ws((id) => [...document.querySelectorAll('.dn-db')[1].querySelectorAll('tr[data-row]')].findIndex((tr) => tr.dataset.row === id), growRow));
await taskEl().locator('.dn-db-grip').nth(gi).click();
await page.locator('.dn-db-pop button', { hasText: '항목 삭제' }).click();
await wait(300);
const after = await projEl().locator(`[data-key="proj-r0:${rel.id}"] .dn-db-relchip`).allInnerTexts();
check('저쪽 항목을 지우면 연결에서도 빠지고 집계도 다시 계산', JSON.stringify(after) === JSON.stringify(['↗ 디자인', '↗ 배포']) && (await projEl().locator(`[data-key="proj-r0:${ru.id}"]`).innerText()) === '3', JSON.stringify(after));
await ws(() => window.__dn.view.engine.undo());
await wait(300);
check('실행 취소 한 번 → 항목 · 연결 · 집계 모두 복구', (await projEl().locator(`[data-key="proj-r0:${rel.id}"] .dn-db-relchip`).count()) === 3 && (await projEl().locator(`[data-key="proj-r0:${ru.id}"]`).innerText()) === '8');

// 관계 속성 삭제 → 저쪽 짝 · 집계도
await projEl().locator('.dn-db-prop', { hasText: '할 일' }).click();
await page.locator('.dn-db-pop button', { hasText: '속성 삭제' }).click();
await wait(300);
proj = await dbOf(ids.proj); task = await dbOf(ids.task);
check('관계 속성 삭제 → 저쪽 짝 열 · 이 관계의 집계도 지움', !proj.properties.some((p) => p.type === 'relation' || p.type === 'rollup') && !task.properties.some((p) => p.type === 'relation'));
await ws(() => window.__dn.view.engine.undo());
await wait(300);
check('실행 취소 → 양쪽 열 · 연결 복구', (await taskEl().locator('.dn-db-relchip', { hasText: '홈페이지' }).count()) === 3);

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
