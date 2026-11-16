// 문서 뷰 확대 (워드 상태 줄): －  배율  ＋ · 쪽 너비 · 한 쪽 · Ctrl+휠, 다시 열어도 그대로.
// 확대해도 쪽 나누기 · 누른 자리에 글 쓰기 · ⋮⋮ 손잡이 자리가 맞는지.
// 사용: dev 서버 실행 후 `node e2e/doc-zoom.mjs [스크린샷 폴더]`
import { chromium } from 'playwright-core';

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

await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(() => window.__dn.newNote({ sheet: null }));
await page.waitForFunction(() => window.__dn.view.engine.blockCount === 0);
await ws(() => {
  window.__dn.view.engine.transact((tx) => {
    for (let i = 0; i < 40; i++) {
      const b = tx.createBlock({ x: 0, y: i * 80, w: 600, h: 60 });
      tx.createContent({ blockId: b, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `${i + 1}번째 문단입니다. 쪽 보기 확대 시험용 글이 조금 길게 들어갑니다. 두 줄이 넘도록 글을 더 씁니다. 가나다라마바사 아자차카타파하.` }] }] } });
    }
  }, { origin: 'user' });
});
await ws(() => window.__dn.setViewMode('doc'));
await wait(900);
const pct = () => page.locator('.doc-status .ds-pct').innerText();
const zoomBtn = (t) => (t === '＋' || t === '－' ? page.locator(`.doc-status .ds-zoom button[aria-label="${t === '＋' ? '확대' : '축소'}"]`) : page.locator('.doc-status .ds-zoom button', { hasText: t })); // ＋ · －는 선 아이콘이라 이름(aria-label)으로 (DS-F6)
/** 쪽 나누기: 항목이 모두 한 종이 안에 · 종이 크기 · 배율 */
const layout = () => ws(() => {
  const root = document.querySelector('.doc-scroll .dn-doc'), pg = root.querySelector('.dn-doc-page'), pr = pg.getBoundingClientRect();
  const sheets = [...root.querySelectorAll('.dn-doc-sheet')].map((s) => { const r = s.getBoundingClientRect(); return [r.top - pr.top, r.height, r.width]; });
  const items = [...pg.querySelectorAll(':scope > .dn-doc-item')].map((el) => { const r = el.getBoundingClientRect(); return [r.top - pr.top, r.bottom - pr.top]; });
  const bad = items.filter(([t, b]) => !sheets.some(([st, sh]) => t >= st - 0.5 && b <= st + sh + 0.5)).length;
  const sc = document.querySelector('.doc-scroll');
  return { zoom: pg.style.zoom || '1', pw: pr.width, sh: sheets[0]?.[1] ?? 0, sheets: sheets.length, bad, cw: sc.clientWidth, ch: sc.clientHeight };
});

check('처음 100%', (await pct()) === '100%', await pct());
await zoomBtn('＋').click();
await wait(400);
let l = await layout();
check('＋ → 110% · 종이에 확대', (await pct()) === '110%' && l.zoom === '1.1' && Math.abs(l.pw - 794 * 1.1) < 2, JSON.stringify(l));
check('확대해도 쪽 나누기: 모든 문단이 종이 안', l.bad === 0 && l.sheets >= 3, JSON.stringify(l));
await zoomBtn('－').click();
await zoomBtn('－').click();
await wait(400);
l = await layout();
check('－ 두 번 → 90%, 쪽 나누기 그대로', (await pct()) === '90%' && l.bad === 0, JSON.stringify({ pct: await pct(), ...l }));

await zoomBtn('쪽 너비').click();
await wait(400);
l = await layout();
check('쪽 너비: 종이 너비가 칸 너비 - 32', Math.abs(l.pw - (l.cw - 32)) < 3 && (await zoomBtn('쪽 너비').getAttribute('aria-pressed')) === 'true', JSON.stringify(l));
await zoomBtn('한 쪽').click();
await wait(400);
l = await layout();
check('한 쪽: 종이 한 장 높이가 칸 높이 안', l.sh <= l.ch - 47 && l.sh > l.ch - 120 && l.bad === 0, JSON.stringify(l));
if (OUT) await page.screenshot({ path: `${OUT}/doc-zoom-page.png` });

// 확대한 채 누른 자리에 쓰기 · ⋮⋮ 손잡이 자리
await ws(() => document.querySelector('.doc-scroll').scrollTop = 0);
await wait(200);
const t5 = await ws(() => { const r = document.querySelectorAll('.doc-scroll .dn-doc-item .dn-doc-text')[4].getBoundingClientRect(); return { x: r.left, y: r.top, h: r.height }; });
await page.mouse.click(t5.x + 1, t5.y + 4);
await wait(250);
await page.keyboard.press('Home');
await page.keyboard.type('Z');
await wait(300);
const txt5 = await ws(() => { const out = []; for (const c of window.__dn.view.engine.contents()) { const t = JSON.stringify(c.doc).match(/"text":"([^"]*)"/)?.[1]; if (t?.includes('Z')) out.push(t.slice(0, 12)); } return out; });
check('확대한 채 다섯째 문단을 누르고 치면 그 문단에', JSON.stringify(txt5) === '["Z5번째 문단입니다. "]', JSON.stringify(txt5));
await page.keyboard.press('Escape');
await page.mouse.move(t5.x + 40, t5.y + 4);
await wait(250);
const grip = await ws(() => { const g = document.querySelector('.dn-doc-grip'), it = document.querySelectorAll('.doc-scroll .dn-doc-item')[4]; if (!g || getComputedStyle(g).display === 'none') return null; const a = g.getBoundingClientRect(), b = it.getBoundingClientRect(); return { gx: a.right, gy: a.top, ix: b.left, iy: b.top, ib: b.bottom }; });
check('⋮⋮ 손잡이가 그 문단 왼쪽 옆에', !!grip && grip.gx <= grip.ix + 1 && grip.gx > grip.ix - 40 && grip.gy >= grip.iy - 8 && grip.gy < grip.ib, JSON.stringify(grip));

// Ctrl+휠 · 다시 열어도 그대로
const before = await pct();
await page.mouse.move(700, 400);
await page.keyboard.down('Control');
await page.mouse.wheel(0, -100);
await page.keyboard.up('Control');
await wait(400);
const after = await pct();
check('Ctrl+휠 위로 → 한 단계 확대 (브라우저 확대 아님)', parseInt(after) > parseInt(before) && (await ws(() => window.devicePixelRatio)) === 1, `${before} → ${after}`);
await zoomBtn('한 쪽').click();
await wait(300);
await page.reload();
await page.waitForSelector('.doc-status', { timeout: 15000 });
await wait(900);
check('다시 열어도 한 쪽 맞춤 그대로', (await zoomBtn('한 쪽').getAttribute('aria-pressed')) === 'true' && (await layout()).zoom !== '1', JSON.stringify(await layout()));
await page.locator('.doc-status .ds-pct').click();
await wait(300);
check('배율 누르면 100%로', (await pct()) === '100%' && (await layout()).zoom === '1');

check('콘솔 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close();
const bad = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
