// 블록을 다른 노트로 옮기기 (GAP #16 — 노션 '옮기기'): 블록 메뉴 › '다른 노트로 옮기기…' → 노트 고르기 → 그 노트 맨 아래에
// 상자 · 사이 화살표 · 묶음 이름째, 이 노트에서는 빠지고(실행 취소로 되살아나지 않음 — 두 노트에 생기지 않게), 알림 '그 노트로'.
// /옮기기 슬래시 · 문서 뷰 블록 메뉴에서도 같은 창.
// 사용: dev 서버 실행 후 `node e2e/move-blocks.mjs [스크린샷 폴더]`
import { chromium } from 'playwright-core';
import { fsPath } from './lib/fs-path.mjs';

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
const CORE = fsPath('packages/engine-core/src/index.ts');
const P = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] });
/** 지금 노트 상자들의 글 */
const texts = () => ws(() => { const e = window.__dn.view.engine; return [...e.blocks()].sort((a, b) => a.y - b.y).map((b) => e.contentsOf(b.id).map((c) => JSON.stringify(c.doc ?? '').match(/"text":"([^"]*)"/)?.[1] ?? c.type).join('|')); });
const openNote = async (title) => { await ws(async (t) => { const w = window.__dn, n = w.state.notes.find((x) => (x.title || x.preview || '').startsWith(t)); await w.openById(n.id); }, title); await wait(700); };

await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });

// 받을 노트 B: 상자 하나
await ws(() => window.__dn.newNote({ sheet: null }));
await page.waitForFunction(() => window.__dn.view.engine.blockCount === 0);
await ws((P0) => { const e = window.__dn.view.engine; e.transact((tx) => { const b = tx.createBlock({ x: 100, y: 100, w: 300, h: 60 }); tx.createContent({ blockId: b, type: 'text', role: 'title', doc: { type: 'doc', content: [P0] } }); }, { origin: 'user' }); }, P('받는 노트'));
await wait(900);

// 보낼 노트 A: 상자 셋 — 가 → 나 화살표, 가 · 나 묶음 '옮길 묶음', 다는 남음
await ws(() => window.__dn.newNote({ sheet: null }));
await page.waitForFunction(() => window.__dn.view.engine.blockCount === 0);
const ids = await ws(async ({ CORE, ps }) => {
  const core = await import(CORE), v = window.__dn.view, e = v.engine;
  const r = e.transact((tx) => {
    const mk = (x, y, p, role = 'body') => { const b = tx.createBlock({ x, y, w: 260, h: 60 }); tx.createContent({ blockId: b, type: 'text', role, doc: { type: 'doc', content: [p] } }); return b; };
    const t = mk(100, 40, ps[0], 'title'), a = mk(100, 140, ps[1]), b = mk(100, 260, ps[2]), c = mk(480, 140, ps[3]);
    tx.createArrow({ from: { blockId: a, side: 'auto' }, to: { blockId: b, side: 'auto' }, relation: 'causes' });
    tx.createArrow({ from: { blockId: b, side: 'auto' }, to: { blockId: c, side: 'auto' } });
    return { t, a, b, c };
  }, { origin: 'user' }).value;
  core.groupBlocks(e, [r.a, r.b], '옮길 묶음');
  v.setCamera({ x: 0, y: 0, zoom: 1 });
  return r;
}, { CORE, ps: [P('보내는 노트'), P('가 상자'), P('나 상자'), P('다 상자')] });
await wait(500);

// 상자 오른쪽 클릭 → 블록 메뉴 › 다른 노트로 옮기기… (묶음 안 상자는 그 상자 하나 — 메뉴만 보고 닫는다)
const r0 = await ws((id) => { const el = window.__dn.view.mounted.get(id).el.getBoundingClientRect(); return { x: el.left + 40, y: el.top + 20 }; }, ids.c);
await page.mouse.click(r0.x, r0.y, { button: 'right' });
const item = page.locator('.menu[aria-label="블록 메뉴"] button', { hasText: '다른 노트로 옮기기' });
check('블록 메뉴에 다른 노트로 옮기기', (await item.count()) === 1);
await item.click();
check('… 누르면 노트 고르기 창 (상자 1개)', (await page.locator('[aria-label="다른 노트로 옮기기"] input').getAttribute('placeholder'))?.includes('상자 1개'));
await page.keyboard.press('Escape');
await wait(200);
// 묶음(가 · 나)째 옮기기 — 묶음을 고른 채 블록 메뉴를 연 것과 같은 요청
await ws((ids) => window.__dn.openMoveTo([ids.a, ids.b]), ids);
const dlg = page.locator('[role="dialog"][aria-label="다른 노트로 옮기기"]');
await dlg.waitFor({ timeout: 3000 });
check('노트 고르기 창: 상자 2개 · 지금 노트는 목록에 없음', (await dlg.locator('input').getAttribute('placeholder')).includes('상자 2개') && !(await dlg.locator('.search-row').allInnerTexts()).some((t) => t.includes('보내는 노트')));
await page.keyboard.type('받는');
await wait(200);
await page.screenshot({ path: `${OUT}/move-dialog.png` });
await page.keyboard.press('Enter');
await page.waitForFunction(() => !document.querySelector('[aria-label="다른 노트로 옮기기"]'));
await wait(900);
let A = await texts();
check('보낸 노트에서 빠짐 (가 · 나), 다는 남음', JSON.stringify(A) === '["보내는 노트","다 상자"]', JSON.stringify(A));
const toast = await page.locator('.toast').innerText().catch(() => '');
check('알림: 상자 2개를 옮김 · 그 노트로', toast.includes('상자 2개') && toast.includes('그 노트로'), toast);
check('보낸 노트 묶음은 없어짐', (await ws(() => Object.keys(window.__dn.view.engine.note.groups ?? {}).filter((g) => [...window.__dn.view.engine.blocks()].some((b) => b.group === g)).length)) === 0);
check('밖으로 이어진 화살표(나 → 다)도 빠짐', (await ws(() => [...window.__dn.view.engine.arrows()].length)) === 0);
await ws(() => window.__dn.view.engine.undo());
await wait(200);
A = await texts();
check('실행 취소해도 되살아나지 않음 (두 노트에 생기지 않게)', !A.includes('가 상자'), JSON.stringify(A));

// 받은 노트: 원래 상자 아래에 가 · 나, 화살표(관계 그대로) · 묶음 이름
await openNote('받는');
const B = await ws(() => {
  const e = window.__dn.view.engine, bs = [...e.blocks()].sort((a, b) => a.y - b.y);
  const t = (b) => JSON.stringify(e.contentsOf(b.id)[0]?.doc).match(/"text":"([^"]*)"/)?.[1];
  const g = Object.values(e.note.groups ?? {})[0];
  return { titles: bs.map(t), ys: bs.map((b) => b.y), arrows: [...e.arrows()].map((a) => a.relation ?? ''), groups: Object.keys(e.note.groups ?? {}).length, gname: g?.name ?? null, grouped: bs.filter((b) => b.group).map(t) };
});
check('받은 노트: 원래 상자 아래에 가 · 나 (차례 · 간격 그대로)', JSON.stringify(B.titles) === '["받는 노트","가 상자","나 상자"]' && B.ys[1] >= B.ys[0] + 60 && B.ys[2] - B.ys[1] === 120, JSON.stringify(B));
check('사이 화살표 관계 그대로 (인과)', JSON.stringify(B.arrows) === '["causes"]', JSON.stringify(B.arrows));
check('묶음 이름 그대로', B.gname === '옮길 묶음' && JSON.stringify(B.grouped) === '["가 상자","나 상자"]', JSON.stringify(B));
await page.screenshot({ path: `${OUT}/move-target.png` });

// /옮기기 슬래시 → 같은 창 (상자 1개)
await ws(() => { const v = window.__dn.view, e = v.engine; const b = [...e.blocks()].sort((a, b) => a.y - b.y)[2]; v.select([b.id]); v.editBlock?.(b.id); });
await wait(200);
const nb = await ws(() => { const v = window.__dn.view, e = v.engine; const b = [...e.blocks()].sort((a, b) => a.y - b.y)[2]; const r = v.mounted.get(b.id).el.getBoundingClientRect(); return { x: r.left + r.width - 10, y: r.top + r.height / 2 }; });
await page.mouse.dblclick(nb.x, nb.y);
await wait(250);
await page.keyboard.press('End');
await page.keyboard.press('Enter');
await page.keyboard.type('/옮기기');
await wait(250);
const slash = await page.locator('.dn-slash-item b').allInnerTexts().catch(() => []);
check('슬래시 메뉴에 다른 노트로 옮기기', slash[0] === '다른 노트로 옮기기', JSON.stringify(slash.slice(0, 3)));
await page.keyboard.press('Enter');
await wait(300);
check('/옮기기 → 노트 고르기 창 (상자 1개)', (await dlg.count()) === 1 && (await dlg.locator('input').getAttribute('placeholder')).includes('상자 1개'));
await page.keyboard.press('Escape');
await wait(200);
check('Esc → 창 닫힘 · 그대로', (await dlg.count()) === 0 && (await texts()).length === 3, JSON.stringify(await texts()));

// 문서 뷰 블록 메뉴에서도
await ws(() => window.__dn.setViewMode('doc'));
await wait(700);
const it = page.locator('.dn-doc .dn-doc-item').nth(1);
const ib = await it.boundingBox();
await page.mouse.click(ib.x + 30, ib.y + 10, { button: 'right' });
await wait(200);
check('문서 뷰 블록 메뉴에도', (await page.locator('.menu[aria-label="블록 메뉴"] button', { hasText: '다른 노트로 옮기기' }).count()) === 1);
await page.keyboard.press('Escape');
await ws(() => window.__dn.setViewMode('canvas'));

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
