// 원문에서 상자 만들기 (11/02): 고치는 상자에서 글을 골라 말풍선 ⋯ › '새 상자로 (원문 연결)' 또는 캔버스로 끌어 놓기 →
// 새 상자(원문은 그대로) · 원문 연결(source, AI 표시 없음) · 새 상자를 고르면 원문에 그 구절 강조 · 블록 메뉴 '원문에서 보기' · 실행 취소 한 번.
// 사용: dev 서버 실행 후 `node e2e/source-box.mjs [스크린샷 폴더]`
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
await ws(() => window.__dn.newNote({ sheet: null }));
await wait(400);

const SOURCE = '금리가 오르면 대출이 줄어든다. 대출이 줄면 소비도 준다.';
await ws(() => window.__dn.view.setCamera({ x: -60, y: -60, zoom: 1 }));
await ws(() => window.__dn.view.addBlockAtCenter('text'));
await page.keyboard.type(SOURCE);
await page.keyboard.press('Escape');
await wait(150);
const src = await ws(() => window.__dn.view.selectedBlocks[0]);
await ws((id) => window.__dn.view.engine.transact((tx) => tx.set('block', id, { x: 0, y: 0 }), { origin: 'user' }), src);
await wait(150);
const srcContent = await ws((id) => window.__dn.view.engine.contentsOf(id)[0].id, src);
const textOf = (id) => ws((id) => { const d = window.__dn.view.engine.contentsOf(id).find((c) => c.doc)?.doc; return d ? d.content.map((p) => (p.content ?? []).map((t) => t.text ?? '').join('')).join('\n') : ''; }, id);
const blocks = () => ws(() => [...window.__dn.view.engine.blocks()].map((b) => ({ id: b.id, x: b.x, y: b.y, source: b.source ?? null, ai: !!b.ai })));
/** 고치는 상자에서 phrase를 DOM 범위로 고르기 */
const select = (phrase) => ws((phrase) => {
  const el = document.querySelector('.dn-text-editing');
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let n; while ((n = walker.nextNode()) && !n.textContent.includes(phrase));
  const i = n.textContent.indexOf(phrase);
  const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + phrase.length);
  const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  document.dispatchEvent(new Event('selectionchange'));
  const b = r.getBoundingClientRect();
  return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
}, phrase);

// 1) 말풍선 ⋯ › 새 상자로 (원문 연결)
const PICK = '대출이 줄면 소비도 준다.';
await ws((id) => window.__dn.view.startEditing(id, 'end'), src);
await wait(150);
await select(PICK);
await page.waitForSelector('.dn-bubble:not([hidden]) .dn-bubble-more', { timeout: 3000 });
await page.locator('.dn-bubble .dn-bubble-more').click();
await page.locator('.dn-bubble-copyout').click();
await wait(400);
let all = await blocks();
const made = all.find((b) => b.id !== src);
check('⋯ › 새 상자로 (원문 연결) → 고른 글로 새 상자 · 원문 오른쪽 · 고른 채', !!made && (await textOf(made.id)) === PICK && made.x > 200 && (await ws(() => window.__dn.view.selectedBlocks.join())) === made.id, JSON.stringify(made));
check('원문은 그대로', (await textOf(src)) === SOURCE);
check('원문 연결(source) · AI 표시 없음', made?.source?.contentId === srcContent && made.source.excerpt === PICK && !made.ai, JSON.stringify(made?.source));
await wait(200);
const hl = await ws(() => { const h = CSS.highlights?.get('dn-source'); return h ? [...h].map((r) => r.toString()).join('|') : null; });
check('새 상자를 고르면 원문에 그 구절 강조', hl === PICK, String(hl));
await page.screenshot({ path: `${OUT}/source-box-highlight.png` });
// 블록 메뉴 '원문에서 보기'
const mr = await ws((id) => { const r = window.__dn.view.mounted.get(id).el.getBoundingClientRect(); return { x: r.left + 30, y: r.top + 12 }; }, made.id);
await page.mouse.click(mr.x, mr.y, { button: 'right' });
await page.waitForSelector('.menu[aria-label="블록 메뉴"]', { timeout: 3000 });
check("블록 메뉴에 '원문에서 보기'", await page.locator('.menu[aria-label="블록 메뉴"]').getByRole('menuitem', { name: '원문에서 보기' }).isVisible());
await page.keyboard.press('Escape');
await wait(150);
// 실행 취소 한 번이면 새 상자만 사라짐
await ws(() => window.__dn.view.root.focus());
await page.keyboard.press('Control+z');
await wait(250);
all = await blocks();
check('실행 취소 한 번 → 새 상자만 사라지고 원문 그대로', all.length === 1 && (await textOf(src)) === SOURCE);

// 2) 고른 글을 캔버스 빈 곳으로 끌어 놓기
await ws((id) => window.__dn.view.startEditing(id, 'end'), src);
await wait(150);
const at = await select('금리가 오르면');
await wait(150);
await page.mouse.move(at.x, at.y);
await page.mouse.down();
await page.mouse.move(at.x + 20, at.y + 20, { steps: 4 });
await page.mouse.move(700, 450, { steps: 12 });
await page.mouse.up();
await wait(500);
all = await blocks();
const dropped = all.find((b) => b.id !== src);
const world = await ws(() => { const v = window.__dn.view, o = v.root.getBoundingClientRect(); return { x: (700 - o.left) / v.camera.zoom + v.camera.x, y: (450 - o.top) / v.camera.zoom + v.camera.y }; });
check('끌어 놓은 자리에 원문과 이어진 새 상자 · 원문 그대로', !!dropped && (await textOf(dropped.id)) === '금리가 오르면' && dropped.source?.contentId === srcContent && Math.abs(dropped.x - world.x) < 40 && Math.abs(dropped.y - world.y) < 40 && (await textOf(src)) === SOURCE, JSON.stringify({ dropped, world }));
await page.screenshot({ path: `${OUT}/source-box-drag.png` });

// 3) 저장 · 새로 고침 뒤에도 연결
await wait(800);
await page.reload();
await page.waitForSelector('.dn-canvas', { timeout: 15000 });
await wait(600);
const kept = await ws((id) => window.__dn.view.engine.getBlock(id)?.source?.excerpt ?? null, dropped?.id);
check('새로 고침 뒤에도 원문 연결이 남음', kept === '금리가 오르면', String(kept));

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} 통과${errors.length ? ` · 오류 ${errors.length}: ${errors.slice(0, 3).join(' | ')}` : ''}`);
await browser.close();
process.exit(results.every((r) => r.ok) && !errors.length ? 0 : 1);
