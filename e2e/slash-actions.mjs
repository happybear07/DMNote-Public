// / 명령의 블록 동작: /블록 링크 복사 → 블록 메뉴와 같은 주소가 클립보드에 + 알림, /댓글 → 그 블록 댓글 창 — 캔버스 · 문서 뷰.
// 사용: dev 서버 실행 후 `node e2e/slash-actions.mjs`
import { chromium } from 'playwright-core';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const browser = await chromium.launch({ channel: process.env.DN_CHANNEL ?? 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
await ctx.addInitScript(() => localStorage.setItem('dn:no-env-key', '1'));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });
const ws = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
const slash = async (q) => { await page.keyboard.type('/'); await wait(120); await page.keyboard.type(q); await wait(220); await page.keyboard.press('Enter'); await wait(500); };
const clip = () => ws(() => navigator.clipboard.readText());

await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });

// 캔버스
await ws(() => window.__dn.newNote());
await wait(300);
const id = await ws(async () => { window.__dn.view.addBlockAtCenter(); await new Promise((r) => setTimeout(r, 200)); return window.__dn.view.editingId; });
await page.keyboard.type('링크 줄 블록 ');
await slash('블록 링크');
const url = await clip();
check('캔버스 /블록 링크 복사 → 그 블록 주소', url.includes(`&b=${id}`) && url.includes('#n='), url);
check('알림', (await page.locator('.toast').innerText().catch(() => '')).includes('블록 링크를 복사'));
await slash('댓글');
check('캔버스 /댓글 → 그 블록 댓글 창', (await page.locator('.comment-thread[role="dialog"]').count()) === 1);
await page.keyboard.press('Escape');
await wait(200);

// 문서 뷰
await ws(() => window.__dn.newNote());
await wait(300);
await ws(() => window.__dn.setViewMode('doc'));
await wait(400);
await page.locator('.dn-doc-page').click({ position: { x: 300, y: 200 } });
await wait(200);
await page.keyboard.type('문서 문단 ');
await slash('블록 링크');
const did = await ws(() => [...window.__dn.view.engine.blocks()][0]?.id);
check('문서 /블록 링크 복사 → 그 블록 주소', (await clip()).includes(`&b=${did}`), await clip());
await slash('댓글');
check('문서 /댓글 → 댓글 창', (await page.locator('.comment-thread[role="dialog"]').count()) === 1);
check('콘솔 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close();
const bad = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
