// 데이터베이스 블록 확인 (FR-055 · 056 · 057): 슬래시로 넣기 · 칸 고치기(글 · 숫자 · 날짜 · 체크 · 선택 · 다중 선택) · 속성 추가/이름/타입/숨기기/너비 ·
// 항목 추가(버튼 · Enter) · 순서 바꾸기(끌기) · 삭제 · 실행 취소 · 블록 옮기기 · 새로 고침 유지 · 검색 · Markdown · 문서 뷰.
// 사용: dev 서버 실행 후 `node e2e/database.mjs [스크린샷 폴더]`
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
const db = () => ws(() => { const v = window.__dn.view; for (const b of v.engine.blocks()) for (const c of v.engine.contentsOf(b.id)) if (c.type === 'database') return JSON.parse(JSON.stringify(c)); return null; });
const sorted = (d) => [...d.rows].sort((a, b) => (a.order < b.order ? -1 : 1));

// ───── 슬래시로 넣기 ─────
await ws(() => { const v = window.__dn.view; v.setCamera({ ...v.cam, x: v.cam.x + 3000 }); });
await wait(100);
await page.evaluate(() => window.__dn.view.setTool('block')); await page.mouse.click(700, 300);
await wait(300);
await page.keyboard.type('데이터베이스 시험');
await page.keyboard.press('Enter');
await page.keyboard.type('/데이터');
await wait(250);
check('슬래시 메뉴에 데이터베이스', (await page.locator('.dn-slash').innerText()).includes('데이터베이스'));
await page.keyboard.press('Enter');
await page.waitForSelector('.dn-db');
let d = await db();
check('데이터베이스 블록 생성 (이름 · 상태 · 날짜, 빈 항목 3)', d && d.properties.map((p) => p.type).join() === 'text,select,date' && d.rows.length === 3);
check('편집 끝나고 새 블록이 선택됨', (await ws(() => window.__dn.view.selBlocks.size)) === 1);

// ───── 칸 고치기 ─────
const P = () => db().then((x) => x.properties);
let props = await P();
const cell = (r, p) => page.locator(`.dn-db [data-key="${r}:${p}"]`);
await page.locator('.dn-db-title').fill('과제 목록');
await page.locator('.dn-db-title').press('Enter');
let rows = sorted(await db());
await cell(rows[0].id, props[0].id).click();
await page.keyboard.type('보고서');
await page.keyboard.press('Enter');
await page.keyboard.type('발표');
await page.keyboard.press('Enter');
await page.keyboard.type('복습');
await page.keyboard.press('Enter'); // 마지막 이름 칸에서 Enter → 새 항목
await wait(150);
d = await db();
rows = sorted(d);
check('글 칸 · Enter로 아래 칸 · 마지막에서 새 항목', d.title === '과제 목록' && rows.slice(0, 3).map((r) => r.values[props[0].id]).join() === '보고서,발표,복습' && rows.length === 4,
  rows.map((r) => r.values[props[0].id]).join());
check('새 항목 이름 칸에 포커스', (await ws(() => document.activeElement?.dataset.key)) === `${rows[3].id}:${props[0].id}`);
await page.keyboard.press('Escape');

// 선택: 옵션 고르기 · 새 옵션 만들기
await cell(rows[0].id, props[1].id).click();
await page.waitForSelector('.dn-db-pop');
await page.locator('.dn-db-pop .dn-db-mi', { hasText: '진행 중' }).click();
await wait(100);
await cell(rows[1].id, props[1].id).click();
await page.keyboard.type('보류');
await page.keyboard.press('Enter');
await wait(100);
d = await db();
props = d.properties;
const opt = (name) => props[1].options.find((o) => o.name === name)?.id;
rows = sorted(d);
check('선택: 옵션 고르기 · 이름 쳐서 새 옵션', rows[0].values[props[1].id] === opt('진행 중') && rows[1].values[props[1].id] === opt('보류') && !!opt('보류'));
check('칸에 옵션 칩 표시', (await cell(rows[0].id, props[1].id).innerText()) === '진행 중');

// 날짜
await cell(rows[0].id, props[2].id).fill('2026-10-20');
await cell(rows[0].id, props[2].id).dispatchEvent('change');
await wait(80);
check('날짜 칸', sorted(await db())[0].values[props[2].id] === '2026-10-20');

// ───── 속성 추가 · 타입 · 이름 ─────
const addProp = async (label) => { await page.locator('.dn-db-add').click(); await page.locator('.dn-db-pop .dn-db-mi', { hasText: label }).click(); await wait(100); };
await addProp('숫자');
await addProp('체크박스');
await addProp('다중 선택');
props = await P();
check('속성 추가 (숫자 · 체크박스 · 다중 선택) · 블록이 열만큼 넓어짐', (await ws(() => { const v = window.__dn.view; const b = [...v.engine.blocks()].find((x) => v.engine.contentsOf(x.id).some((c) => c.type === 'database')); return b.w; })) >= 22 + 200 + 120 + 130 + 420 + 60 && props.length === 6 && props.slice(3).map((p) => p.type).join() === 'number,checkbox,multiSelect');
await cell(rows[0].id, props[3].id).fill('1,250');
await cell(rows[0].id, props[3].id).press('Enter');
await cell(rows[1].id, props[3].id).fill('많이');
await cell(rows[1].id, props[3].id).press('Enter');
await cell(rows[0].id, props[4].id).click();
await wait(80);
rows = sorted(await db());
check('숫자 칸 (쉼표 허용 · 숫자 아니면 되돌림) · 체크', rows[0].values[props[3].id] === 1250 && rows[1].values[props[3].id] === undefined && rows[0].values[props[4].id] === true,
  JSON.stringify([rows[0].values[props[3].id], rows[1].values[props[3].id]]));
await cell(rows[0].id, props[5].id).click();
for (const t of ['수학', '영어']) { await page.keyboard.type(t); await page.keyboard.press('Enter'); await wait(60); }
await page.keyboard.press('Escape');
rows = sorted(await db());
check('다중 선택: 여러 개 고르기', (rows[0].values[props[5].id] ?? []).length === 2 && (await cell(rows[0].id, props[5].id).innerText()).includes('영어'));

// 속성 메뉴: 이름 바꾸기 · 타입 바꾸기(숫자 → 텍스트) · 숨기기 · 다시 보이기
await page.locator('.dn-db-prop', { hasText: '숫자' }).click();
await page.locator('.dn-db-pop .dn-db-pin').first().fill('점수');
await page.locator('.dn-db-pop .dn-db-pin').first().press('Enter');
await wait(80);
props = await P();
check('속성 이름 바꾸기', props[3].name === '점수');
await page.locator('.dn-db-prop', { hasText: '점수' }).click();
await page.locator('.dn-db-pop .dn-db-mi', { hasText: '텍스트' }).click();
await page.keyboard.press('Escape');
await wait(80);
rows = sorted(await db());
check('타입 바꾸기: 숫자 → 텍스트 (값 변환)', (await P())[3].type === 'text' && rows[0].values[props[3].id] === '1250');
await page.locator('.dn-db-prop', { hasText: '점수' }).click();
await page.locator('.dn-db-pop .dn-db-mi', { hasText: '숨기기' }).click();
await wait(80);
check('열 숨기기', (await page.locator('.dn-db-prop', { hasText: '점수' }).count()) === 0 && (await page.locator('.dn-db-btn', { hasText: '숨긴 속성 1' }).count()) === 1);
await page.locator('.dn-db-btn', { hasText: '숨긴 속성' }).click();
await page.locator('.dn-db-pop .dn-db-mi', { hasText: '점수 보이기' }).click();
await page.keyboard.press('Escape');
await wait(80);
check('숨긴 열 다시 보이기', (await page.locator('.dn-db-prop', { hasText: '점수' }).count()) === 1);

// 열 너비
const th = page.locator('.dn-db-table th').nth(1);
const box = await th.boundingBox();
await page.mouse.move(box.x + box.width - 1, box.y + 10);
await page.mouse.down();
await page.mouse.move(box.x + box.width + 80, box.y + 10, { steps: 5 });
await page.mouse.up();
await wait(100);
check('열 너비 끌어서 조절', Math.abs((await P())[0].width - 280) <= 3, String((await P())[0].width));

// ───── 항목 순서 · 삭제 · 실행 취소 ─────
await page.locator('.dn-db-new').click();
await wait(100);
rows = sorted(await db());
check('+ 새 항목 버튼', rows.length === 5);
const grip = page.locator(`.dn-db tr[data-row="${rows[2].id}"] .dn-db-grip`);
const gb = await grip.boundingBox();
const firstRow = await page.locator(`.dn-db tr[data-row="${rows[0].id}"]`).boundingBox();
await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2);
await page.mouse.down();
await page.mouse.move(gb.x + gb.width / 2, firstRow.y + 4, { steps: 6 });
await page.mouse.up();
await wait(100);
let names = sorted(await db()).map((r) => r.values[props[0].id] ?? '');
check('행 손잡이 끌어 순서 바꾸기', names.slice(0, 3).join() === '복습,보고서,발표', names.join());
await page.locator(`.dn-db tr[data-row="${rows[1].id}"] .dn-db-grip`).click();
await page.locator('.dn-db-pop .dn-db-mi', { hasText: '항목 삭제' }).click();
await wait(80);
check('항목 메뉴로 삭제', !sorted(await db()).some((r) => r.id === rows[1].id));
await ws(() => window.__dn.view.root.focus());
await page.keyboard.press('Control+z');
await wait(100);
check('실행 취소로 되살림', sorted(await db()).some((r) => r.id === rows[1].id));

// ───── 블록 이동 · 키 격리 ─────
await cell(rows[3].id, props[0].id).click();
await page.keyboard.press('Backspace'); // 칸 안 글자 지우기 — 블록이 지워지면 안 된다
await page.keyboard.press('Escape');
check('칸 안 Backspace는 블록을 지우지 않음', (await page.locator('.dn-db').count()) === 1);
const blk = await ws(() => { const v = window.__dn.view; const b = [...v.engine.blocks()].find((x) => v.engine.contentsOf(x.id).some((c) => c.type === 'database')); return { id: b.id, x: b.x, y: b.y }; });
const dbEl = await page.locator('.dn-db').boundingBox();
await page.mouse.move(dbEl.x + 300, dbEl.y + dbEl.height - 8);
await page.mouse.down();
await page.mouse.move(dbEl.x + 400, dbEl.y + dbEl.height + 22, { steps: 6 });
await page.mouse.up();
await wait(120);
const moved = await ws((id) => window.__dn.view.engine.getBlock(id), blk.id);
check('데이터베이스 블록을 캔버스에서 옮김', Math.abs(moved.x - blk.x - 100) < 4 && Math.abs(moved.y - blk.y - 30) < 4, JSON.stringify({ blk, moved: { x: moved.x, y: moved.y } }));
await page.screenshot({ path: `${OUT}/database.png` });

// ───── 저장 · 검색 · Markdown · 문서 뷰 ─────
await wait(800);
await page.reload();
await page.waitForSelector('.dn-db', { timeout: 15000 });
d = await db();
check('새로 고침 후 유지', d.title === '과제 목록' && d.rows.length === 5 && d.properties.length === 6);
const noteId = await ws(() => window.__dn.state.currentId);
const md = await ws((id) => window.__dn.noteMarkdown(id), noteId);
check('Markdown: 표로 (옵션 이름 · 체크 = 예)', md.includes('**과제 목록**') && md.includes('| 이름 | 상태 | 날짜 | 점수 | 체크박스 | 다중 선택 |') && /\| 보고서 \| 진행 중 \| 2026-10-20 \| 1250 \| 예 \| 수학, 영어 \|/.test(md), md.split('**과제 목록**')[1]?.slice(0, 300));
const hits = await ws(() => window.__dn.index.query('보류', window.__dn.state.notes, 5).map((h) => h.snippet ?? h.text ?? JSON.stringify(h)).join(' / '));
check('검색: 데이터베이스 칸 글자 (선택 옵션 이름)', hits.includes('보류'), hits.slice(0, 120));
await page.locator('.view-toggle button', { hasText: '문서' }).click();
await page.waitForSelector('.dn-doc-item .dn-db');
check('문서 뷰에 데이터베이스 (읽기)', (await page.locator('.dn-doc-item .dn-db-ro tbody tr').count()) === 5);
await page.locator('.view-toggle button', { hasText: '캔버스' }).click();

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
