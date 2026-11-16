// 찾아 바꾸기 확인 (FR-123): 지금 노트 · 모든 노트(닫힌 노트 포함), 하나씩 · 모두, 서식 유지, 실행 취소 · 되돌리기.
// 사용: dev 서버 실행 후 `node e2e/replace.mjs [스크린샷 폴더]`
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
const docOf = (id) => ws(async (n) => { await window.__dn.openById(n); return JSON.stringify([...window.__dn.view.engine.contents()].map((c) => c.doc)); }, id);

async function note(title, typer) {
  await ws(() => window.__dn.newNote());
  await wait(300);
  await ws((t) => window.__dn.setTitle(t), title);
  await ws(() => window.__dn.view.addBlockAtCenter());
  await wait(100);
  await typer();
  await page.keyboard.press('Escape');
  await wait(600);
  return ws(() => window.__dn.state.currentId);
}
const bId = await note('다른 노트', async () => { await page.keyboard.type('여기도 사과가 있다'); });
const aId = await note('과일', async () => {
  await page.keyboard.type('사과 ');
  await page.keyboard.press('Control+b');
  await page.keyboard.type('사과');
  await page.keyboard.press('Control+b');
  await page.keyboard.type(' 사과');
});

// ───── 지금 노트 ─────
await page.keyboard.press('Control+h');
await page.waitForSelector('.replace-box');
await page.locator('[aria-label="찾을 말"]').fill('사과');
await page.locator('[aria-label="바꿀 말"]').fill('배');
await wait(400);
check('지금 노트: 3곳', (await page.locator('.replace-count').innerText()).startsWith('3곳'), await page.locator('.replace-count').innerText());
check('문맥 · 바뀔 말 미리보기', (await page.locator('.replace-row mark').count()) === 3 && (await page.locator('.replace-row ins').first().innerText()) === '배');
await page.screenshot({ path: `${OUT}/replace.png` });
await page.locator('.replace-row').nth(1).locator('.btn').click();
await wait(400);
check('하나만 바꾸기 → 2곳 남음', (await page.locator('.replace-count').innerText()).startsWith('2곳'));
let d = await ws(() => JSON.stringify([...window.__dn.view.engine.contents()].map((c) => c.doc)));
check('굵게 서식 유지', d.includes('{"type":"text","marks":[{"type":"strong"}],"text":"배"}'), d.slice(0, 200));
await page.keyboard.press('Escape');
await ws(() => window.__dn.view.root.focus());
await page.keyboard.press('Control+z');
await wait(200);
d = await ws(() => JSON.stringify([...window.__dn.view.engine.contents()].map((c) => c.doc)));
check('실행 취소로 되돌아감', !d.includes('"배"') && (d.match(/사과/g) ?? []).length === 3);

// ───── 모든 노트 ─────
await page.keyboard.press('Control+h');
await page.waitForSelector('.replace-box');
await page.locator('[aria-label="찾을 말"]').fill('사과');
await page.locator('[aria-label="바꿀 말"]').fill('배');
await page.locator('.replace-box .search-modes button', { hasText: '모든 노트' }).click();
await wait(400);
check('모든 노트: 4곳 · 노트 2개', (await page.locator('.replace-count').innerText()) === '4곳 · 노트 2개', await page.locator('.replace-count').innerText());
await page.locator('.replace-box .btn.primary', { hasText: '모두 바꾸기' }).click();
await wait(600);
check('모두 바꾸기 → 남은 곳 0', (await page.locator('.search-empty strong').innerText().catch(() => '')).includes('찾지 못했어요'));
const toast = await page.locator('.toast').innerText();
check('알림: 노트 2개에서 4곳', toast.includes('노트 2개에서 4곳을 바꿨어요'), toast);
await page.locator('.toast button', { hasText: '되돌리기' }).click();
await wait(600);
await page.keyboard.press('Escape');
const back = await docOf(bId);
const backA = await docOf(aId);
check('되돌리기 → 닫혀 있던 노트까지 원래대로', back.includes('여기도 사과가 있다') && (backA.match(/사과/g) ?? []).length === 3, back.slice(0, 120));
const hits = await ws(() => window.__dn.search('사과').length);
check('검색 색인도 원래 글자로', hits === 2, String(hits));

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
