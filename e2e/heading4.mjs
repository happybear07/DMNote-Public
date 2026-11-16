// 제목 4 (노션 · 워드): '#### ' 입력 규칙, /제목 4, 서식 막대 문단 스타일, 붙여넣은 <h4>는 그대로 제목 4, Markdown 내보내기 '####'.
// 사용: dev 서버 실행 후 `node e2e/heading4.mjs`
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
const heads = () => ws(() => { const out = []; for (const c of window.__dn.view.engine.contents()) for (const n of c.doc?.content ?? []) if (n.type === 'heading') out.push([n.attrs.level, (n.content ?? []).map((t) => t.text).join('')]); return out; });

await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(() => window.__dn.newNote());
await wait(300);
await ws(() => window.__dn.setViewMode('doc'));
await wait(400);
await page.locator('.dn-doc-page').click({ position: { x: 300, y: 200 } });
await wait(200);
await page.keyboard.type('#### 넷째 제목');
await wait(200);
check("'#### ' → 제목 4", JSON.stringify(await heads()) === JSON.stringify([[4, '넷째 제목']]), JSON.stringify(await heads()));
check('서식 막대 문단 스타일이 "제목 4"', (await page.locator('.doc-ribbon select[aria-label="문단 스타일"]').inputValue()) === 'h4');
const size = await ws(() => { const h = document.querySelector('.dn-doc h4'), p = document.querySelector('.dn-doc h3, .dn-doc p'); return h ? parseFloat(getComputedStyle(h).fontSize) : 0; });
check('제목 4 글자 크기가 따로 (12.5px 기준)', size > 12 && size < 14, String(size));
await page.keyboard.press('Enter');
await page.keyboard.type('/제목 4');
await wait(250);
await page.keyboard.press('Enter');
await wait(250);
await page.keyboard.type('슬래시 제목');
await wait(200);
check('/제목 4 → 제목 4', (await heads()).some(([l, t]) => l === 4 && t === '슬래시 제목'), JSON.stringify(await heads()));
// 붙여넣은 <h4> · <h6>
await page.keyboard.press('Enter');
await ws(() => { const dt = new DataTransfer(); dt.setData('text/html', '<h4>붙인 넷</h4><h6>붙인 여섯</h6>'); dt.setData('text/plain', '붙인 넷\n붙인 여섯'); document.querySelector('.dn-text-editing').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); });
await wait(300);
const h = await heads();
check('붙여넣은 h4 · h6 → 제목 4', h.some(([l, t]) => l === 4 && t === '붙인 넷') && h.some(([l, t]) => l === 4 && t === '붙인 여섯'), JSON.stringify(h));
check('콘솔 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close();
const bad = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
