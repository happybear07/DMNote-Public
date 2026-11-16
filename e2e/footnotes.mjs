// 각주 (워드 참조 › 각주): Ctrl+Alt+F → 입력 칸 → Enter → 글 속 번호 · 문서 끝 각주 목록, 번호는 문서 차례대로,
// 번호를 눌러 고치기 · 비우면 지움, /각주 · 서식 막대 단추, 캔버스에서도, Markdown ^[글].
// 사용: dev 서버 실행 후 `node e2e/footnotes.mjs [스크린샷 폴더]`
import { chromium } from 'playwright-core';
import { fsPath } from './lib/fs-path.mjs';

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
const notes = () => ws(() => { const out = []; for (const c of window.__dn.view.engine.contents()) { const walk = (n) => { if (n.type === 'footnote') out.push(n.attrs.note); (n.content ?? []).forEach(walk); }; if (c.doc) walk(c.doc); } return out; });
const list = () => page.locator('.dn-doc .dn-doc-footnotes li').allInnerTexts();
const nums = () => ws(() => [...document.querySelectorAll('.dn-doc .dn-fn')].map((el) => getComputedStyle(el, '::after').content));

await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(() => window.__dn.newNote());
await wait(300);
await ws(() => window.__dn.setViewMode('doc'));
await wait(400);
await page.locator('.dn-doc-page').click({ position: { x: 300, y: 200 } });
await wait(200);
await page.keyboard.type('첫 주장');
await page.keyboard.press('Control+Alt+f');
await wait(300);
check('Ctrl+Alt+F → 각주 입력 칸', (await page.locator('.dn-fn-editor textarea').count()) === 1);
await page.keyboard.type('출처 하나');
await page.keyboard.press('Enter');
await wait(300);
await page.keyboard.type(' 그리고 이어서');
await wait(200);
check('Enter → 각주 들어가고 이어 쓰기는 각주 뒤', JSON.stringify(await notes()) === '["출처 하나"]' && (await ws(() => JSON.stringify([...window.__dn.view.engine.contents()][0].doc))).includes('"그리고 이어서'.replace('"', '') ), JSON.stringify(await notes()));
// 둘째 문단 · /각주
await page.keyboard.press('Enter');
await page.keyboard.press('Enter');
await wait(250);
await page.keyboard.type('둘째 문단 ');
await page.keyboard.type('/각주');
await wait(250);
await page.keyboard.press('Enter');
await wait(300);
await page.keyboard.type('출처 둘');
await page.keyboard.press('Enter');
await wait(300);
check('/각주로도', JSON.stringify(await notes()) === '["출처 하나","출처 둘"]', JSON.stringify(await notes()));
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
await wait(400);
check('문서 끝 각주 목록 (차례대로)', JSON.stringify(await list()) === '["출처 하나","출처 둘"]', JSON.stringify(await list()));
check('글 속 번호 자리 둘 (번호는 CSS 카운터 — 스크린샷으로 1 · 2 확인)', (await nums()).length === 2 && (await ws(() => getComputedStyle(document.querySelector('.dn-doc-page')).counterReset)).includes('dn-fn'));
if (OUT) await page.screenshot({ path: `${OUT}/footnotes-doc.png` });
// 첫 번호 눌러 고치기
await page.locator('.dn-doc .dn-fn').first().click();
await wait(300);
await page.keyboard.press('Control+a');
await page.keyboard.type('고친 출처');
await page.keyboard.press('Enter');
await wait(400);
check('번호를 눌러 고치기', JSON.stringify(await notes()) === '["고친 출처","출처 둘"]', JSON.stringify(await notes()));
// 둘째를 비우면 지움
await page.locator('.dn-doc .dn-fn').nth(1).click();
await wait(300);
await page.keyboard.press('Control+a');
await page.keyboard.press('Backspace');
await page.keyboard.press('Enter');
await wait(400);
check('비우고 Enter → 각주 지움 · 목록도', JSON.stringify(await notes()) === '["고친 출처"]' && (await list()).length === 1, JSON.stringify(await notes()));
// 서식 막대 단추 → 넣자마자 Esc → 빈 각주는 남지 않음
await page.locator('.dn-doc .dn-doc-text').first().click();
await page.keyboard.press('End');
await page.locator('.doc-ribbon button[aria-label^="각주"]').click();
await wait(300);
await page.keyboard.press('Escape');
await wait(300);
check('서식 막대 각주 → 바로 Esc → 빈 각주 안 남음', (await notes()).length === 1, JSON.stringify(await notes()));
// Markdown 내보내기
const md = await ws(async (MD) => { const m = await import(MD); return m.docToMarkdown([...window.__dn.view.engine.contents()][0].doc, {}); }, fsPath('packages/text-pm/src/to-markdown.ts')).catch(() => '');
check('Markdown: ^[각주 글]', md.includes('^[고친 출처]'), md.slice(0, 80));
// 캔버스에서도 번호
await ws(() => window.__dn.setViewMode('canvas'));
await wait(500);
const cn = await ws(() => [...document.querySelectorAll('.canvas-host .dn-fn')].map((el) => getComputedStyle(el, '::after').content));
check('캔버스에서도 번호 자리 · 상자마다 새로 셈', cn.length === 1 && (await ws(() => getComputedStyle(document.querySelector('.canvas-host .dn-fn').closest('.dn-block')).counterReset)).includes('dn-fn'), JSON.stringify(cn));
if (OUT) await page.screenshot({ path: `${OUT}/footnotes-canvas.png` });
// 입력 칸에 쓰고 종이 바깥(회색) · 종이 아래 빈 곳을 누르면 쓴 글이 남는다 (AT-003 — 편집기가 먼저 닫혀 글이 사라지던 것)
await ws(() => { window.__dn.setDocPages(true); window.__dn.setViewMode('doc'); });
await wait(500);
for (const [where, spot] of [['종이 바깥 회색', async () => { const r = await page.locator('.dn-doc-sheet').first().boundingBox(); return { x: r.x + r.width + 60, y: r.y + 300 }; }], ['종이 아래 빈 곳', async () => { const r = await page.locator('.dn-doc .dn-doc-item').last().boundingBox(); return { x: r.x + 40, y: r.y + r.height + 200 }; }]]) {
  await page.locator('.dn-doc .dn-doc-text').first().click();
  await page.keyboard.press('End');
  await page.locator('.doc-ribbon button[aria-label^="각주"]').click();
  await wait(300);
  await page.keyboard.type(`${where} 메모`);
  const p = await spot();
  await page.mouse.click(p.x, p.y);
  await wait(500);
  check(`각주 칸에 쓰고 ${where}을 누르면 쓴 글이 남음`, (await notes()).includes(`${where} 메모`) && (await list()).includes(`${where} 메모`), JSON.stringify({ notes: await notes(), list: await list() }));
}
check('콘솔 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close();
const bad = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
