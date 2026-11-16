// 노트형 정리 1단계 (docs/research/NOTE-SHEET-PLAN.md NS-01 ~ 05 · 18): 카드 묶음 — 카드 안 상자는 테두리 · 종류 꼬리표 없이,
// 카드 머리를 누르면 카드째 고름, 묶음 메뉴의 테두리 '카드' · 바탕색 · 번호 · 카드 격자로 맞추기, 카드 틀이 겹치면 '다시 맞추기' 단추(누를 때만) · 글이 늘면 카드 안 아래 상자는 레고처럼(AT-020),
// 구분선 메뉴(방향 · 선 모양 · 가운데 글), 문서 뷰는 '번호. 이름' 소제목 + 가로줄.
// 사용: dev 서버 실행 후 `node e2e/note-sheet.mjs [스크린샷 폴더]`
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
const CORE = fsPath('packages/engine-core/src/index.ts');

await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(() => window.__dn.newNote({ sheet: null }));
await page.waitForFunction(() => window.__dn.view.engine.blockCount === 0);
// 카드 셋(번호 · 이름) + 보통 묶음 하나 + 구분선 하나
const ids = await ws(async (CORE) => {
  const core = await import(CORE), v = window.__dn.view, e = v.engine;
  const box = (x, y, body, h) => core.createTextBlock(e, { x, y }, { body, w: 300, ...(h ? { h } : {}) }).value.blockId;
  const cards = [];
  [['요약', '겉으로: 차분\n실제로: 인정'], ['핵심 욕구', '소속감\n인정'], ['반복 패턴', '거리 두기']].forEach(([name, body], i) => {
    const a = box(i * 400, 0, body), b = box(i * 400, 90, '→ 결론');
    const g = core.groupBlocks(e, [a, b], name).value;
    core.setGroupMeta(e, g, { bracket: 'card', numbered: true });
    cards.push(g);
  });
  e.transact((tx) => tx.set('block', e.contentsOf([...e.blocks()].find((b) => b.group === cards[0]).id)[0].blockId, { nodeKind: 'claim' }), { origin: 'user' });
  const p = box(0, 600, '보통 묶음 1'), q = box(0, 700, '보통 묶음 2');
  const plain = core.groupBlocks(e, [p, q], '보통').value;
  const line = core.createDivider(e, { x: 0, y: 450 }, 'h', { len: 700, label: '정리' }).value.blockId;
  v.setCamera({ x: -80, y: -120, zoom: 1 });
  return { cards, plain, line };
}, CORE);
await wait(500);
if (OUT) await page.screenshot({ path: `${OUT}/note-sheet-cards.png` });

// 1. 카드 안 상자 모양
const look = await ws((g) => {
  const v = window.__dn.view, b = [...v.engine.blocks()].find((x) => x.group === g);
  const el = v.mounted.get(b.id).el, cs = getComputedStyle(el);
  return { inCard: el.classList.contains('dn-in-card'), border: cs.borderTopColor, bg: cs.backgroundColor, tag: el.querySelector('.dn-kind-tag')?.textContent ?? '' };
}, ids.cards[0]);
check('카드 안 상자는 테두리 · 바탕 없이 (카드 하나로 보임)', look.inCard && /rgba\(0, 0, 0, 0\)|transparent/.test(look.bg), JSON.stringify(look));
check('카드 안에서는 노드 종류 꼬리표를 숨김 (값은 그대로)', look.tag === '' && (await ws((g) => [...window.__dn.view.engine.blocks()].some((b) => b.group === g && b.nodeKind === 'claim'), ids.cards[0])));

// 2. 카드 머리를 누르면 카드째
const head = await ws(async ({ CORE, g }) => {
  const core = await import(CORE), v = window.__dn.view, c = core.noteCards(v.engine).find((x) => x.id === g), r = v.root.getBoundingClientRect(), cam = v.camera;
  return { x: r.left + (c.frame.x + 120 - cam.x) * cam.zoom, y: r.top + (c.frame.y + 26 - cam.y) * cam.zoom };
}, { CORE, g: ids.cards[1] });
await page.mouse.click(head.x, head.y);
await wait(200);
const sel = await ws((g) => { const v = window.__dn.view; return v.selectedBlocks.length === [...v.engine.blocks()].filter((b) => b.group === g).length && v.selectedBlocks.every((id) => v.engine.getBlock(id).group === g); }, ids.cards[1]);
check('카드 머리를 누르면 카드째 고른다', sel);

// 3. 묶음 메뉴: 카드 줄 · 격자로 맞추기
await page.mouse.click(head.x, head.y, { button: 'right' });
await page.waitForSelector('.menu[aria-label="블록 메뉴"]');
const menu = page.locator('.menu[aria-label="블록 메뉴"]');
await page.locator('.menu[aria-label="블록 메뉴"] .menu-sub > button[aria-haspopup="menu"]', { hasText: '묶음' }).click(); // 묶음 ▸ 하위 메뉴
check('묶음 메뉴에 테두리 "카드" · 카드 이름 · 바탕색 · 번호 · 격자로 맞추기', await menu.getByRole('menuitemradio', { name: '테두리 카드', exact: true }).isVisible() && await menu.locator('input[aria-label="카드 이름"]').isVisible()
  && await menu.getByRole('group', { name: '카드 바탕색' }).isVisible() && await menu.getByRole('menuitemcheckbox', { name: /머리에 번호/ }).isVisible() && await menu.getByRole('menuitem', { name: /카드 격자로 맞추기/ }).isVisible());
await menu.getByRole('menuitemradio', { name: '노랑 바탕' }).click();
check('카드 바탕색 고르기 → tone', (await ws((g) => window.__dn.view.engine.note.groups[g].tone, ids.cards[1])) === 'yellow');
await menu.getByRole('menuitem', { name: /카드 격자로 맞추기/ }).click();
await wait(300);
const grid = await ws(async (CORE) => { const core = await import(CORE); return core.noteCards(window.__dn.view.engine).map((c) => [Math.round(c.frame.x), Math.round(c.frame.y), c.number]); }, CORE);
check('카드 격자로 맞추기 → 한 줄 같은 높이 · 같은 간격, 번호 1 · 2 · 3', grid.length === 3 && grid.every((g) => g[1] === grid[0][1]) && grid[1][0] - grid[0][0] === grid[2][0] - grid[1][0] && grid.map((g) => g[2]).join() === '1,2,3', JSON.stringify(grid));

// 4. 글이 늘면 카드 안 아래 상자가 레고처럼 함께 내려감 (AT-020 — 11/02) — 겹침 · 단추 없음
const overlapCount = () => ws(async (CORE) => { const core = await import(CORE); return core.overlappingCards(window.__dn.view.engine).length; }, CORE);
await ws(async ({ CORE, g }) => {
  const core = await import(CORE), e = window.__dn.view.engine;
  const top = [...e.blocks()].filter((b) => b.group === g).sort((a, b) => a.y - b.y)[0];
  core.setText(e, e.contentsOf(top.id)[0].id, core.bodyDoc(Array.from({ length: 12 }, (_, i) => `줄 ${i + 1}`).join('\n')));
}, { CORE, g: ids.cards[0] });
await wait(500);
check('글이 늘면 카드 안 아래 상자가 함께 내려가 겹침 없음 · 단추 없음 (AT-020)', (await overlapCount()) === 0 && !(await page.locator('.card-fix-pill').isVisible()));
// 카드 틀이 겹치면(옮겨 놓아서) '다시 맞추기' 단추 — 누를 때만 아래로, 다른 상자는 저절로 안 움직임
await ws(async ({ CORE, a, b }) => {
  const core = await import(CORE), e = window.__dn.view.engine, cards = core.noteCards(e);
  const ca = cards.find((c) => c.id === a), cb = cards.find((c) => c.id === b);
  const dx = ca.frame.x - cb.frame.x, dy = ca.frame.y + ca.frame.h - 10 - cb.frame.y;
  e.transact((tx) => { for (const id of cb.ids) { const r = e.getBlock(id); tx.set('block', id, { x: r.x + dx, y: r.y + dy }); } }, { origin: 'user' });
}, { CORE, a: ids.cards[0], b: ids.cards[1] });
await page.waitForSelector('.card-fix-pill', { timeout: 3000 }).catch(() => {});
const before = await overlapCount();
check('카드 틀이 겹치면 "다시 맞추기" 단추 (다른 상자는 저절로 안 움직임)', before > 0 && await page.locator('.card-fix-pill').isVisible(), String(before));
if (OUT) await page.screenshot({ path: `${OUT}/note-sheet-overlap.png` });
await page.locator('.card-fix-pill').click();
await wait(500);
const after = await ws(async (CORE) => { const core = await import(CORE); return core.overlappingCards(window.__dn.view.engine).length; }, CORE);
check('다시 맞추기 → 겹침 0 · 단추 사라짐', after === 0 && !(await page.locator('.card-fix-pill').isVisible()));
await ws(() => window.__dn.view.engine.undo());
check('다시 맞추기는 실행 취소 한 번', (await ws(async (CORE) => { const core = await import(CORE); return core.overlappingCards(window.__dn.view.engine).length; }, CORE)) > 0);
await ws(() => window.__dn.view.engine.undo()); // 옮겨 놓은 카드도 제자리로 — 뒤의 문서 뷰 번호는 처음 한 줄 순서로 본다

// 5. 보통 묶음을 카드로 (묶음 메뉴 테두리)
await ws((g) => { const v = window.__dn.view; v.select([...v.engine.blocks()].filter((b) => b.group === g).map((b) => b.id)); }, ids.plain);
// 보통 묶음의 이름표(테두리 위 왼쪽)를 오른쪽 클릭 → 묶음 메뉴
const pr = await ws((g) => { const v = window.__dn.view, bs = [...v.engine.blocks()].filter((x) => x.group === g), o = v.root.getBoundingClientRect(), c = v.camera; const x = Math.min(...bs.map((b) => b.x)), y = Math.min(...bs.map((b) => b.y)); return { x: o.left + (x - c.x) * c.zoom - 8 + 14, y: o.top + (y - c.y) * c.zoom - 8 - 10 }; }, ids.plain);
await page.mouse.click(pr.x, pr.y, { button: 'right' });
await page.waitForSelector('.menu[aria-label="블록 메뉴"]');
await page.locator('.menu[aria-label="블록 메뉴"] .menu-sub > button[aria-haspopup="menu"]', { hasText: '묶음' }).click(); // 묶음 ▸ 하위 메뉴
await page.locator('.menu[aria-label="블록 메뉴"]').getByRole('menuitemradio', { name: '테두리 카드', exact: true }).click();
check('묶음 메뉴 테두리 "카드" → 보통 묶음이 카드로', (await ws((g) => window.__dn.view.engine.note.groups[g].bracket, ids.plain)) === 'card');
await page.keyboard.press('Escape');

// 6. 구분선 메뉴
await ws((id) => window.__dn.view.select([id]), ids.line);
const lr = await ws((id) => { const r = window.__dn.view.mounted.get(id).el.getBoundingClientRect(); return { x: r.left + 30, y: r.top + r.height / 2 }; }, ids.line);
await page.mouse.click(lr.x, lr.y, { button: 'right' });
await page.waitForSelector('.menu[aria-label="블록 메뉴"]');
const lm = page.locator('.menu[aria-label="블록 메뉴"]');
await lm.getByRole('menuitemradio', { name: '점선' }).click();
await lm.getByRole('menuitemradio', { name: '세로' }).click();
const dv = await ws((id) => { const v = window.__dn.view, c = v.engine.contentsOf(id)[0], b = v.engine.getBlock(id); return { orient: c.orient, line: c.line, w: b.w, h: b.h }; }, ids.line);
check('구분선 메뉴: 점선 · 세로로 바꾸면 폭 · 높이도 맞바뀜', dv.orient === 'v' && dv.line === 'dashed' && dv.w === 24 && dv.h === 700, JSON.stringify(dv));
await page.keyboard.press('Escape');
await ws((id) => window.__dn.view.engine.undo(), ids.line); // 세로 → 가로로 되돌림
await wait(200);

// 7. 문서 뷰
await ws(() => window.__dn.setViewMode('doc'));
await page.waitForSelector('.dn-doc');
await wait(600);
const doc = await page.locator('.dn-doc').innerText();
check('문서 뷰: 번호 켠 카드는 "1. 요약" 소제목', /1\.\s*요약/.test(doc) && /2\.\s*핵심 욕구/.test(doc), doc.slice(0, 120));
check('문서 뷰: 구분선은 가로줄 (가운데 글)', (await page.locator('.dn-doc .dn-doc-divider').count()) === 1 && (await page.locator('.dn-doc .dn-doc-divider').innerText()).includes('정리'));
if (OUT) await page.screenshot({ path: `${OUT}/note-sheet-doc.png` });
check('콘솔 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close();
const bad = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
