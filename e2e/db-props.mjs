// 데이터베이스 새 속성 (GAP #19 — 노션 상태 · 수식 · 파일 · 만든 때 · 고친 때): 속성 추가 메뉴 → 수식(속성 메뉴에서 쓰면 바로 결과 미리보기 ·
// 칸은 계산 값, 잘못 쓰면 #오류) · 상태(옵션마다 묶음, 칸은 옵션 고르기) · 파일(+ 파일 → 칩, 누르면 새 탭, × 빼기) · 만든 때 · 고친 때.
// 사용: dev 서버 실행 후 `node e2e/db-props.mjs [스크린샷 폴더]`
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2] ?? '.';
mkdirSync(OUT, { recursive: true });
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
const colTexts = (name) => page.evaluate((name) => {
  const ths = [...document.querySelectorAll('.dn-db thead th')];
  const i = ths.findIndex((th) => th.querySelector('.dn-db-pname')?.textContent === name);
  return [...document.querySelectorAll('.dn-db tbody tr[data-row]')].map((tr) => { const td = tr.children[i]; const inp = td?.querySelector('input'); return (inp ? inp.value : td?.textContent ?? '').trim(); });
}, name);
const addProp = async (label) => { await page.locator('.dn-db .dn-db-add').click(); await page.locator('.dn-db-pop .dn-db-mi', { hasText: label }).first().click(); await wait(250); };
const propMenu = async (name) => { await page.locator('.dn-db .dn-db-prop', { hasText: name }).click(); await wait(150); };

await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(() => window.__dn.newNote({ sheet: null }));
await wait(500);
await page.evaluate(() => window.__dn.view.setTool('block'));
await page.mouse.click(400, 160);
await wait(250);
await page.keyboard.type('/데이터');
await wait(250);
await page.keyboard.press('Enter');
await page.waitForSelector('.dn-db');
let d = await db();
const NAME = d.properties[0].id;
await ws(({ cid, NAME }) => {
  const e = window.__dn.view.engine;
  e.transact((tx) => { const c = e.getContent(cid); tx.set('content', cid, { rows: [...c.rows].sort((a, b) => (a.order < b.order ? -1 : 1)).map((r, i) => ({ ...r, values: { ...r.values, [NAME]: ['가', '나', '다'][i] } })) }); }, { origin: 'user' });
}, { cid: d.id, NAME });
await wait(200);

// 수식
await addProp('수식');
await propMenu('수식');
const area = page.locator('.dn-db-pop textarea[aria-label="수식"]');
await area.fill('prop("이름") + "!"');
await wait(150);
check('수식 칸: 첫 항목 결과 미리보기', (await page.locator('.dn-db-pop .dn-db-fres').innerText()).includes('가!'), await page.locator('.dn-db-pop .dn-db-fres').innerText());
await area.press('Enter');
await wait(300);
await page.keyboard.press('Escape');
check('수식 칸 = 계산 값', JSON.stringify(await colTexts('수식')) === '["가!","나!","다!"]', JSON.stringify(await colTexts('수식')));
await propMenu('수식');
await page.locator('.dn-db-pop textarea[aria-label="수식"]').fill('prop("없음") * 2');
check('잘못 쓰면 미리보기에 오류', (await page.locator('.dn-db-pop .dn-db-fres').innerText()).includes('없는 속성'));
await page.locator('.dn-db-pop textarea[aria-label="수식"]').press('Enter');
await wait(250);
await page.keyboard.press('Escape');
check('칸은 #오류 (이유는 마우스를 올리면)', (await colTexts('수식'))[0] === '#오류' && (await page.locator('.dn-db-computed.err').first().getAttribute('title'))?.includes('없는 속성'));

// 상태
await addProp('상태');
d = await db();
const st = d.properties.find((p) => p.type === 'status');
check('상태 속성: 기본 옵션 셋 · 묶음 할 일 / 진행 중 / 완료', JSON.stringify(st.options.map((o) => [o.name, o.group])) === '[["시작 전","todo"],["진행 중","doing"],["완료","done"]]', JSON.stringify(st.options));
await page.locator(`.dn-db tbody tr[data-row] [data-key$=":${st.id}"]`).first().click();
await page.locator('.dn-db-pop .dn-db-mi', { hasText: '진행 중' }).click();
await wait(200);
check('상태 칸에서 고르기', (await colTexts(st.name))[0] === '진행 중', JSON.stringify(await colTexts(st.name)));
await propMenu(st.name);
check('속성 메뉴: 옵션마다 묶음 고르기', (await page.locator('.dn-db-pop select.dn-db-group').count()) === 3);
await page.keyboard.press('Escape');

// 만든 때 · 고친 때
await addProp('만든 때');
await addProp('고친 때');
const created = await colTexts('만든 때'), edited = await colTexts('고친 때');
check('만든 때 · 고친 때 칸 (방금 값을 바꾼 첫 항목은 고친 때가 있다)', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(edited[0]) && created.length === 3, JSON.stringify({ created, edited }));

// 파일
await addProp('파일');
const tmp = join(OUT, '보고서 초안.txt');
writeFileSync(tmp, '파일 속성 시험');
const chooser = page.waitForEvent('filechooser');
await page.locator('.dn-db .dn-db-fadd').first().click();
await (await chooser).setFiles(tmp);
await wait(600);
check('+ 파일 → 이름 칩', (await page.locator('.dn-db .dn-db-fname').first().innerText()) === '보고서 초안.txt');
d = await db();
const fp = d.properties.find((p) => p.type === 'files');
const fv = d.rows.map((r) => r.values[fp.id]).find((v) => Array.isArray(v) && v.length);
check('값은 해시:이름', !!fv && /^[0-9a-f]{16,}:보고서 초안\.txt$/.test(fv[0]), JSON.stringify(fv));
const pop = ctx.waitForEvent('page', { timeout: 4000 }).catch(() => null);
await page.locator('.dn-db .dn-db-fname').first().click();
const tab = await pop;
await tab?.waitForURL(/^blob:/, { timeout: 4000 }).catch(() => {}); // 빈 탭을 먼저 열고 주소를 넣는다 (팝업 차단 피하기)
check('칩을 누르면 새 탭(blob)', !!tab && tab.url().startsWith('blob:'), tab?.url() ?? 'none');
await tab?.close().catch(() => {});
await page.locator('.dn-db .dn-db-fx').first().click();
await wait(250);
check('× → 파일 빼기', (await page.locator('.dn-db .dn-db-fname').count()) === 0);
await page.screenshot({ path: join(OUT, 'db-props.png') });

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
await browser.close().catch(() => {});
process.exit(fail ? 1 : 0);
