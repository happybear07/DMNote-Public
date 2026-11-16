// 변경 이력 보기 (FR-135): 버전 미리보기에서 지금과 다른 곳 강조 — 지금은 없는 블록(빨강) · 그 뒤 고친 블록(노랑) · 요약 줄(새로 생긴 블록 수 포함).
// 사용: dev 서버 실행 후 `node e2e/version-diff.mjs`
import { chromium } from 'playwright-core';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
process.on('unhandledRejection', (e) => { if (!/TargetClosedError|has been closed/.test(String(e))) throw e; });

const browser = await chromium.launch({ channel: process.env.DN_CHANNEL ?? 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => localStorage.setItem('dn:no-env-key', '1'));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });
const ws = (fn, arg) => page.evaluate(fn, arg);
await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(() => window.__dn.newNote());
await page.waitForTimeout(300);
const para = (text) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const ids = await ws((docs) => window.__dn.view.engine.transact((tx) => docs.map((doc, i) => {
  const b = tx.createBlock({ x: 0, y: i * 150, w: 320, h: 80 });
  tx.createContent({ blockId: b, type: 'text', role: 'body', doc });
  return b;
}), { origin: 'user' }).value, [para('그대로 둘 글'), para('고치기 전 글'), para('지울 글')]);
const [keep, edit, gone] = ids;
await page.waitForTimeout(200);
await ws(() => window.__dn.saveVersion('manual', true));

// 같으면 "같아요"
await ws(() => window.__dn.openVersions());
await page.waitForSelector('.ver-diff');
check('바뀐 것이 없으면 "같아요"', (await page.locator('.ver-diff').innerText()).includes('같아요'));
await page.keyboard.press('Escape');

// 고치기 · 지우기 · 새로 만들기 · 옮기기
await ws(({ keep, edit, gone, doc }) => {
  const e = window.__dn.view.engine, c = e.contentsOf(edit)[0];
  e.transact((tx) => { tx.set('content', c.id, { doc }); tx.set('block', keep, { x: 500 }); }, { origin: 'user' });
  const v = window.__dn.view; v.select([gone]); v.deleteSelection();
  e.transact((tx) => { const b = tx.createBlock({ x: 0, y: 600, w: 300, h: 80 }); tx.createContent({ blockId: b, type: 'text', role: 'body', doc }); }, { origin: 'user' });
}, { keep, edit, gone, doc: para('고친 뒤 글') });
await page.waitForTimeout(200);
await ws(() => window.__dn.openVersions());
await page.waitForSelector('.ver-preview .dn-doc-item');
await page.waitForSelector('.ver-diff .d-gone', { timeout: 5000 }).catch(() => {});
const sum = await page.locator('.ver-diff').innerText();
check('요약: 이 버전에만 1 · 고침 1 · 그 뒤 새로 1', sum.includes('이 버전에만 1') && sum.includes('고침 1') && sum.includes('그 뒤 새로 1'), sum.replace(/\n/g, ' '));
const cls = (id) => page.locator(`.ver-preview .dn-doc-item[data-id="${id}"]`).getAttribute('class');
check('지운 블록은 빨강 (지금은 없는 블록)', (await cls(gone)).includes('diff-gone')
  && (await page.locator(`.ver-preview .dn-doc-item[data-id="${gone}"]`).getAttribute('title')) === '지금은 없는 블록');
check('고친 블록은 노랑', (await cls(edit)).includes('diff-changed') && (await page.locator(`.ver-preview .dn-doc-item[data-id="${edit}"]`).innerText()).includes('고치기 전 글'));
check('옮기기만 한 블록은 표시 없음', !/diff-/.test(await cls(keep)));
const bg = await page.locator(`.ver-preview .dn-doc-item[data-id="${gone}"]`).evaluate((el) => getComputedStyle(el).backgroundColor);
check('강조 색이 보임', bg !== 'rgba(0, 0, 0, 0)', bg);
await page.keyboard.press('Escape');

// 연결(화살표)만 바꿔도 같지 않음 · 댓글 표시는 고침이 아님
await ws(() => window.__dn.saveVersion('manual', true));
await ws(({ keep, edit }) => {
  const e = window.__dn.view.engine;
  e.transact((tx) => tx.createArrow({ from: { blockId: keep, side: 'auto' }, to: { blockId: edit, side: 'auto' } }), { origin: 'user' });
  const c = e.contentsOf(keep)[0];
  const doc = JSON.parse(JSON.stringify(c.doc));
  doc.content[0].content[0].marks = [{ type: 'comment', attrs: { id: 'cmt1' } }];
  e.transact((tx) => tx.set('content', c.id, { doc }), { origin: 'user' });
}, { keep, edit });
await page.waitForTimeout(200);
await ws(() => window.__dn.openVersions());
await page.waitForSelector('.ver-diff');
await page.waitForTimeout(400);
const sum2 = await page.locator('.ver-diff').innerText();
check('연결만 바뀜 → "연결 바뀜 1", 댓글 표시는 고침으로 안 셈', sum2.includes('연결 바뀜 1') && !sum2.includes('고침'), sum2.replace(/\n/g, ' '));
await page.keyboard.press('Escape');

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
