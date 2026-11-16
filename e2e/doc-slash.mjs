// 문서 뷰 슬래시(/) 명령 (노션처럼): 목차 · 데이터베이스 · 그래프 · 수식이 문서 뷰에서도 실제로 들어가고,
// 빈 줄에서 넣으면 빈 줄이 남지 않는다. 수식은 미리보기 카드 + 완료 버튼.
// 사용: dev 서버 실행 후 `node e2e/doc-slash.mjs`
import { chromium } from 'playwright-core';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
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
await ws(() => window.__dn.newNote());
await wait(300);
await ws(() => window.__dn.setViewMode('doc'));
await wait(400);
/** 문서 차례대로 블록의 내용 종류 (글은 글자) */
const order = () => ws(() => {
  const e = window.__dn.view.engine;
  return [...e.blocks()].sort((a, b) => a.y - b.y).map((b) => e.contentsOf(b.id).map((c) => c.type === 'text' ? `text:${(c.doc?.content ?? []).map((n) => (n.content ?? []).map((t) => t.text ?? '').join('')).join('/')}` : c.type).join('|'));
});
const slash = async (q) => {
  await page.keyboard.type('/');
  await wait(150);
  await page.keyboard.type(q);
  await wait(250);
  const shown = await page.locator('.dn-slash').count();
  await page.keyboard.press('Enter');
  await wait(500);
  return shown;
};
const newLineAfterFirst = async () => {
  const p = page.locator('.dn-doc-text').first();
  await p.click();
  await wait(150);
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await wait(300);
};

await page.locator('.dn-doc-page').click({ position: { x: 300, y: 200 } });
await wait(200);
await page.keyboard.type('첫 줄');
await page.keyboard.press('Enter');
await page.keyboard.press('Enter');
await wait(300);
const menu = await slash('목차');
let o = await order();
check('/목차 → 메뉴가 뜨고 목차 블록이 들어감, 빈 줄은 안 남음', menu === 1 && JSON.stringify(o) === JSON.stringify(['text:첫 줄', 'toc']), JSON.stringify(o));

await newLineAfterFirst();
await slash('데이터베이스');
o = await order();
check('/데이터베이스 → 첫 줄 바로 아래에 데이터베이스', JSON.stringify(o) === JSON.stringify(['text:첫 줄', 'database', 'toc']), JSON.stringify(o));

await newLineAfterFirst();
await slash('그래프');
o = await order();
check('/그래프 → 그래프 블록', o[1] === 'chart' && o.length === 4, JSON.stringify(o));
await page.keyboard.press('Escape');
await wait(300);
await page.keyboard.press('Escape');
await wait(200);

// 수식: 글 있는 줄 끝에서 /수식 → 미리보기 카드 · 완료
await newLineAfterFirst();
await page.keyboard.type('식: ');
await slash('수식');
check('/수식 → 수식 창 (미리보기 카드 · 완료 버튼)', (await page.locator('.dn-math-editor .dn-math-card').count()) === 1 && (await page.locator('.dn-math-editor .dn-math-done').count()) === 1);
await page.keyboard.type('a^2+b^2');
await wait(250);
check('미리보기 카드에 그려진 수식', (await page.locator('.dn-math-card .katex').count()) === 1);
await page.locator('.dn-math-done').click();
await wait(300);
const tex = await ws(() => [...window.__dn.view.engine.contents()].map((c) => JSON.stringify(c.doc ?? '')).find((s) => s.includes('math_block')) ?? '');
check('완료 → 수식이 문서에 들어감', tex.includes('a^2+b^2') && (await page.locator('.dn-math-editor').count()) === 0, tex.slice(0, 160));

check('콘솔 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close();
const bad = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
