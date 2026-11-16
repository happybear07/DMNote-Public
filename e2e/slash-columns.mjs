// 노션 /2열 ~ /5열: 문서 뷰에서는 지금 문단 아래에 문단 폭을 나눈 칸들(좌우 칸으로 보임) · 첫 칸에서 바로 쓰기,
// 캔버스에서는 지금 상자 아래에 같은 줄로 나란히. 빈 줄에서 넣으면 빈 줄은 남지 않는다.
// 사용: dev 서버 실행 후 `node e2e/slash-columns.mjs`
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
const slash = async (q) => { await page.keyboard.type('/'); await wait(120); await page.keyboard.type(q); await wait(220); await page.keyboard.press('Enter'); await wait(500); };
const rects = () => ws(() => [...window.__dn.view.engine.blocks()].sort((a, b) => a.y - b.y || a.x - b.x).map((b) => ({ x: b.x, y: b.y, w: b.w, text: JSON.stringify(window.__dn.view.engine.contentsOf(b.id)[0]?.doc ?? '').replace(/[^가-힣]/g, '') })));

await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(() => window.__dn.newNote());
await wait(300);
await ws(() => window.__dn.setViewMode('doc'));
await wait(400);
await page.locator('.dn-doc-page').click({ position: { x: 300, y: 200 } });
await wait(200);
await page.keyboard.type('앞 글');
await page.keyboard.press('Enter');
await page.keyboard.press('Enter');
await wait(250);
await slash('2열');
let r = await rects();
check('문서 /2열 → 앞 글 아래 같은 줄에 두 칸, 빈 줄은 안 남음', r.length === 3 && r[1].y === r[2].y && r[1].y > r[0].y, JSON.stringify(r));
check('두 칸 폭 = 문단 폭을 나눔', r.length === 3 && Math.abs(r[1].w + r[2].w + 16 - r[0].w) <= 2, JSON.stringify(r.map((x) => x.w)));
check('문서에서 좌우 칸으로 보임', (await page.locator('.dn-doc .dn-doc-row .dn-doc-item').count()) === 2);
check('첫 칸에서 바로 쓰기', (await page.locator('.dn-doc .dn-doc-row .dn-doc-item').first().locator('.dn-text-editing').count()) === 1);
await page.keyboard.type('왼쪽');
await page.locator('.dn-doc .dn-doc-row .dn-doc-item').nth(1).locator('.dn-doc-text').click();
await wait(250);
await page.keyboard.type('오른쪽');
await wait(250);
r = await rects();
check('두 칸에 각각 쓰기', r[1].text === '왼쪽' && r[2].text === '오른쪽', JSON.stringify(r.map((x) => x.text)));

// 캔버스
await ws(() => window.__dn.setViewMode('canvas'));
await wait(400);
await ws(() => window.__dn.newNote());
await wait(300);
await ws(() => window.__dn.view.addBlockAtCenter());
await wait(250);
await page.keyboard.type('위 상자 ');
await slash('3열');
r = await rects();
check('캔버스 /3열 → 상자 아래 같은 줄에 세 칸, 첫 칸 편집', r.length === 4 && r[1].y === r[2].y && r[2].y === r[3].y && r[1].y > r[0].y && (await ws(() => !!window.__dn.view.editingId)), JSON.stringify(r));
check('콘솔 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close();
const bad = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
