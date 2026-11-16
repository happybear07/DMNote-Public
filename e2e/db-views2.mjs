// 데이터베이스 보기 더하기 (GAP #20 — 노션 열 계산 · 타임라인 · 차트): 표 아래 '계산' → 합계 · 체크 비율(필터 뒤 항목으로),
// 타임라인 뷰(시작 · 끝 날짜 막대, 끌면 날짜가 같이 옮겨짐 · 실행 취소 한 번), 차트 뷰(상태별 개수 · 값을 점수 합으로 바꾸기).
// 사용: dev 서버 실행 후 `node e2e/db-views2.mjs [스크린샷 폴더]`
import { chromium } from 'playwright-core';
import { fsPath } from './lib/fs-path.mjs';

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
const db = () => ws(() => { const v = window.__dn.view; for (const b of v.engine.blocks()) for (const c of v.engine.contentsOf(b.id)) if (c.type === 'database') return JSON.parse(JSON.stringify(c)); return null; });

await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(() => window.__dn.newNote({ sheet: null }));
await wait(500);
await page.evaluate(() => window.__dn.view.setTool('block'));
await page.mouse.click(300, 140);
await wait(250);
await page.keyboard.type('/데이터');
await wait(250);
await page.keyboard.press('Enter');
await page.waitForSelector('.dn-db');
let d = await db();
// 점수 · 끝 날짜 속성 + 항목 셋
const now = new Date(), ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
await ws(({ cid, ym }) => {
  const e = window.__dn.view.engine;
  e.transact((tx) => {
    const c = e.getContent(cid);
    const [NAME, STATUS, DATE] = c.properties.map((p) => p.id);
    const opt = (n) => c.properties[1].options.find((o) => o.name === n).id;
    const props = [...c.properties, { id: 'score', name: '점수', type: 'number', width: 100 }, { id: 'end', name: '끝', type: 'date', width: 130 }, { id: 'ok', name: '확인', type: 'checkbox', width: 80 }];
    const rows = [...c.rows].sort((a, b) => (a.order < b.order ? -1 : 1)).map((r, i) => ({ ...r, values: {
      [NAME]: ['가', '나', '다'][i], [STATUS]: opt(['할 일', '완료', '할 일'][i]), [DATE]: [`${ym}-02`, `${ym}-05`, ''][i], score: [30, 90, 60][i], end: [`${ym}-06`, '', ''][i], ok: [true, false, true][i],
    } }));
    tx.set('content', cid, { properties: props, rows });
  }, { origin: 'user', label: '시험 데이터' });
}, { cid: d.id, ym });
await wait(300);

// 1) 열 계산
const calcBtn = (i) => page.locator('.dn-db .dn-db-calcrow td').nth(i).locator('.dn-db-calc');
const colIndex = async (name) => (await page.locator('.dn-db thead th').allInnerTexts()).findIndex((t) => t.includes(name));
await calcBtn(await colIndex('점수')).click();
await page.locator('.dn-db-pop .dn-db-mi', { hasText: '합계' }).click();
await wait(250);
check('점수 열 합계 = 180', (await calcBtn(await colIndex('점수')).innerText()).replace(/\s+/g, ' ').includes('합계 180'), await calcBtn(await colIndex('점수')).innerText());
await calcBtn(await colIndex('확인')).click();
await page.locator('.dn-db-pop .dn-db-mi', { hasText: '체크 비율' }).click();
await wait(250);
check('확인 열 체크 비율 = 67%', (await calcBtn(await colIndex('확인')).innerText()).includes('67%'));
d = await db();
check('계산은 뷰에 저장', JSON.stringify(d.views?.[0]?.calcs) === '{"score":"sum","ok":"checkedPct"}', JSON.stringify(d.views?.[0]?.calcs));

// 2) 타임라인
await page.locator('.dn-db .dn-db-tab', { hasText: '+' }).click();
await page.locator('.dn-db-pop .dn-db-mi', { hasText: '타임라인' }).click();
await wait(300);
check('타임라인: 날짜 있는 항목 두 막대 · 날짜 없음 1', (await page.locator('.dn-db-tlbar').count()) === 2 && (await page.locator('.dn-db-tl .dn-db-calnote').innerText()).includes('1'));
// 끝 날짜 속성 고르기
await page.locator('.dn-db .dn-db-tab.on').click();
await page.locator('.dn-db-pop select[aria-label="끝 날짜 속성"]').selectOption('end');
await page.keyboard.press('Escape');
await wait(250);
const bar = page.locator('.dn-db-tlbar', { hasText: '가' });
const w = await bar.evaluate((e) => e.offsetWidth), dw = await page.locator('.dn-db-tl').evaluate((e) => parseFloat(getComputedStyle(e).getPropertyValue('--dw')));
check('끝 날짜를 고르면 가 막대가 5일 길이', Math.round((w + 2) / dw) === 5, `${w} / ${dw}`);
const bb = await bar.boundingBox();
await page.mouse.move(bb.x + 10, bb.y + bb.height / 2);
await page.mouse.down();
await page.mouse.move(bb.x + 10 + dw * 2, bb.y + bb.height / 2, { steps: 6 });
await page.mouse.up();
await wait(300);
d = await db();
const ga = d.rows.find((r) => r.values[d.properties[0].id] === '가');
check('막대를 2일 끌면 시작 · 끝이 같이 2일 뒤로', ga.values[d.properties[2].id] === `${ym}-04` && ga.values.end === `${ym}-08`, JSON.stringify(ga.values));
await ws(() => window.__dn.view.engine.undo());
await wait(200);
d = await db();
const ga2 = d.rows.find((r) => r.values[d.properties[0].id] === '가');
check('실행 취소 한 번에 둘 다 돌아옴', ga2.values[d.properties[2].id] === `${ym}-02` && ga2.values.end === `${ym}-06`, JSON.stringify(ga2.values));
await page.screenshot({ path: `${OUT}/db-timeline.png` });

// 3) 차트
await page.locator('.dn-db .dn-db-tab', { hasText: '+' }).click();
await page.locator('.dn-db-pop .dn-db-mi', { hasText: '차트' }).click();
await wait(300);
const rows = () => page.locator('.dn-db-chartrow').evaluateAll((els) => els.map((e) => `${e.querySelector('.dn-db-chartlabel').textContent}:${e.querySelector('.dn-db-chartval b').textContent}`));
check('차트: 상태별 항목 수', JSON.stringify(await rows()) === '["할 일:2","완료:1"]', JSON.stringify(await rows()));
await page.locator('.dn-db .dn-db-tab.on').click();
await page.locator('.dn-db-pop select[aria-label="차트 값"]').selectOption('score');
await page.keyboard.press('Escape');
await wait(250);
check('값을 점수 합으로', JSON.stringify(await rows()) === '["할 일:90","완료:90"]' && (await page.locator('.dn-db-charthead').innerText()).includes('점수 합계'), JSON.stringify(await rows()));
await page.screenshot({ path: `${OUT}/db-chart.png` });

// 4) 다른 노트에 임베드(링크된 데이터베이스 대신): 원본의 지금 보기(차트)를 읽기 전용으로
const src = await ws(() => { const v = window.__dn.view; const b = [...v.engine.blocks()].find((x) => v.engine.contentsOf(x.id)[0]?.type === 'database'); return { note: v.engine.note.id, block: b.id }; });
await ws(() => window.__dn.newNote({ sheet: null }));
await wait(600);
await ws(async ({ src, CORE }) => { const core = await import(CORE); core.createEmbedBlock(window.__dn.view.engine, { x: 100, y: 100 }, { srcNote: src.note, srcBlock: src.block }, { w: 640, h: 260 }); }, { src, CORE: fsPath('packages/engine-core/src/index.ts') });
await page.waitForSelector('.dn-embed .dn-db', { timeout: 5000 }).catch(() => {});
check('임베드에 데이터베이스가 원본 보기(차트)로 · 읽기 전용', (await page.locator('.dn-embed .dn-db-chartrow').count()) === 2 && (await page.locator('.dn-embed .dn-db-ro').count()) === 1, String(await page.locator('.dn-embed').innerText().catch(() => '')).slice(0, 120));

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
