// 노트 v6 의미 고르기: 화살표 오른쪽 클릭 → 관계 종류(모양이 따라 바뀜 · 실행 취소) · 라벨 고치기 · 지우기,
// 블록 메뉴 → 노드 종류(기본색은 종류에서, 사용자가 고른 색이 이김), AI가 만든 것을 고치면 출처에 "사람이 고침".
// 사용: dev 서버 실행 후 `node e2e/meaning.mjs [스크린샷 폴더]`
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
const ws = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(() => window.__dn.newNote());
await wait(300);
const ids = await ws(() => {
  const e = window.__dn.view.engine;
  const p = (t) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });
  const id = {};
  e.transact((tx) => {
    for (const [k, x, y] of [['원인', 100, 120], ['결과', 600, 120], ['AI 근거', 100, 400], ['AI 결론', 600, 400]]) { id[k] = tx.createBlock({ x, y, w: 200, h: 50 }); tx.createContent({ blockId: id[k], type: 'text', role: 'title', doc: p(k) }); }
    id.arrow = tx.createArrow({ from: { blockId: id['원인'], side: 'auto' }, to: { blockId: id['결과'], side: 'auto' } });
  }, { origin: 'user' });
  const ai = { generated: true, runId: 'r1', origin: 'claude' };
  e.transact((tx) => {
    tx.set('block', id['AI 근거'], { ai, nodeKind: 'evidence' }); tx.set('block', id['AI 결론'], { ai, nodeKind: 'conclusion' });
    id.aiArrow = tx.createArrow({ from: { blockId: id['AI 근거'], side: 'auto' }, to: { blockId: id['AI 결론'], side: 'auto' }, relation: 'supports', ai });
  }, { origin: 'ai' });
  return id;
});
await wait(400);
/** 화살표 위 한 점 (라벨을 피해 1/4 지점) — 화면 좌표 */
const onArrow = (id) => ws((id) => {
  const v = window.__dn.view, a = v.engine.getArrow(id), g = v.engine.arrowGeometry(a);
  const w = { x: g.a.x + (g.b.x - g.a.x) * 0.25, y: g.a.y + (g.b.y - g.a.y) * 0.25 };
  const s = v.toScreen(w), r = v.root.getBoundingClientRect();
  return { x: r.left + s.x, y: r.top + s.y };
}, id);
const arrow = (id) => ws((id) => window.__dn.view.engine.getArrow(id), id);
const block = (id) => ws((id) => window.__dn.view.engine.getBlock(id), id);
const menu = page.locator('[aria-label="화살표 메뉴"]');

// 1. 화살표 오른쪽 클릭 → 관계 종류
let p = await onArrow(ids.arrow);
await page.mouse.click(p.x, p.y, { button: 'right' });
await wait(200);
check('화살표 오른쪽 클릭 → 화살표 메뉴', await menu.isVisible());
await menu.locator('.menu-sub > button', { hasText: '관계' }).click(); // 관계 종류 · 기호 · 묶음 끝은 '관계 ▸' (DS-016)
check('관계는 처음엔 "정하지 않음"', (await menu.locator('select').inputValue()) === '');
await menu.locator('select').selectOption('causes');
await wait(200);
check('관계 고르기 → relation 저장 · 모양(style)은 그대로 비어 있음', (await arrow(ids.arrow)).relation === 'causes' && (await arrow(ids.arrow)).style === undefined);
await page.keyboard.press('Escape');
await page.keyboard.press('Control+z');
await wait(200);
check('Ctrl+Z → 관계가 미정으로', (await arrow(ids.arrow)).relation === undefined);

// 2. 라벨 고치기 · 지우기
await page.mouse.click(p.x, p.y, { button: 'right' });
await wait(200);
await menu.getByRole('menuitem', { name: /라벨 고치기/ }).click();
await wait(150);
check('라벨 고치기 → 화살표 위 입력 칸', await page.locator('.dn-label-input').isVisible());
await page.keyboard.type('그래서');
await page.keyboard.press('Enter');
await wait(200);
check('라벨 저장', (await arrow(ids.arrow)).label === '그래서');

// 3. AI 화살표의 관계를 고치면 출처에 "사람이 고침"
p = await onArrow(ids.aiArrow);
await page.mouse.click(p.x, p.y, { button: 'right' });
await wait(200);
await menu.locator('.menu-sub > button', { hasText: '관계' }).click(); // 관계 종류 · 기호 · 묶음 끝은 '관계 ▸' (DS-016)
check('AI 화살표 메뉴에 지금 관계가 보임', (await menu.locator('select').inputValue()) === 'supports');
await menu.locator('select').selectOption('implies');
await wait(200);
const aa = await arrow(ids.aiArrow);
check('AI 화살표 관계를 고치면 ai.editedAt이 찍힘 (claude_edited)', aa.relation === 'implies' && typeof aa.ai?.editedAt === 'number');
await page.keyboard.press('Escape');

// 4. 블록 메뉴 → 노드 종류 · 기본색은 종류에서
const bg = (id) => ws((id) => document.querySelector(`.dn-block[data-id="${id}"]`).style.background, id);
check('AI 결론 블록은 종류 기본색(초록)으로 칠해짐 — 저장된 색은 없음', (await bg(ids['AI 결론'])).includes('green') && (await block(ids['AI 결론'])).style === undefined, await bg(ids['AI 결론']));
const b1 = page.locator(`.dn-block[data-id="${ids['원인']}"]`);
await b1.click({ button: 'right' });
await wait(200);
await page.locator('.menu-sub > button', { hasText: '의미' }).click(); // 하위 메뉴 (DS-001)
const kind = page.locator('[aria-label="블록 메뉴"] select[aria-label="노드 종류"]');
check('블록 메뉴에 노드 종류 고르기', await kind.isVisible());
await kind.selectOption('question');
await wait(200);
check('노드 종류 저장 · 질문 기본색(노랑)', (await block(ids['원인'])).nodeKind === 'question' && (await bg(ids['원인'])).includes('yellow'), await bg(ids['원인']));
await page.locator('.menu-sub > button', { hasText: '배경색' }).click(); // 하위 메뉴 (DS-001)
await page.locator('[aria-label="블록 메뉴"] [aria-label="파랑 배경"]').click();
await wait(200);
check('사용자가 고른 색이 종류 기본색을 이김', (await bg(ids['원인'])).includes('blue') && (await block(ids['원인'])).nodeKind === 'question');
await page.screenshot({ path: `${OUT}/meaning.png` });

// 5. 화살표 메뉴 → 지우기
p = await onArrow(ids.arrow);
await page.mouse.click(p.x, p.y, { button: 'right' });
await wait(200);
await menu.getByRole('menuitem', { name: /지우기/ }).click();
await wait(200);
check('화살표 메뉴 → 지우기', !(await arrow(ids.arrow)));

// 6. 묶음 끝 화살표: 출발 상자가 묶음에 들면 메뉴에서 "출발을 묶음 전체에" → 묶음 둘레에서 출발
const g = await ws((ids) => {
  const e = window.__dn.view.engine;
  const p = (t) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });
  let extra = '', arrow = '';
  e.transact((tx) => { extra = tx.createBlock({ x: 100, y: 200, w: 200, h: 50 }); tx.createContent({ blockId: extra, type: 'text', role: 'title', doc: p('전제 둘') }); }, { origin: 'user' });
  e.transact((tx) => {
    for (const id of [ids['원인'], extra]) tx.set('block', id, { group: 'premises' });
    arrow = tx.createArrow({ from: { blockId: ids['원인'], side: 'auto' }, to: { blockId: ids['결과'], side: 'auto' } });
  }, { origin: 'user' });
  return { arrow, before: e.arrowGeometry(e.getArrow(arrow)).a };
}, ids);
await wait(300);
p = await onArrow(g.arrow);
await page.mouse.click(p.x, p.y, { button: 'right' });
await wait(200);
await menu.locator('.menu-sub > button', { hasText: '관계' }).click(); // 관계 종류 · 기호 · 묶음 끝은 '관계 ▸' (DS-016)
const toggle = menu.getByRole('menuitemcheckbox', { name: /출발을 묶음 전체에/ });
check('묶음에 든 상자에서 나가는 화살표 메뉴에 "출발을 묶음 전체에"', await toggle.isVisible());
await toggle.click();
await wait(200);
const ga = await arrow(g.arrow);
const after = await ws((id) => { const e = window.__dn.view.engine; return e.arrowGeometry(e.getArrow(id)).a; }, g.arrow);
check('누르면 출발이 묶음 전체 · 묶음 둘레에서 출발', ga.from.groupId === 'premises' && (after.x !== g.before.x || after.y !== g.before.y), `${JSON.stringify(g.before)} → ${JSON.stringify(after)}`);
check('메뉴에 켜짐 표시', (await toggle.getAttribute('aria-checked')) === 'true');
await page.keyboard.press('Escape');
await page.screenshot({ path: `${OUT}/meaning-group-end.png` });

// 7. 모양 (v6 2단계): 선 · 경로 · 색 고르기 → 바꾼 것만 저장, 관계는 그대로 · "관계 기본 모양으로"
p = await onArrow(ids.aiArrow);
await page.mouse.click(p.x, p.y, { button: 'right' });
await wait(200);
await menu.getByRole('menuitem', { name: /모양/ }).click();
await wait(100);
await menu.getByRole('menuitemradio', { name: '선 물결' }).click();
await wait(150);
await menu.getByRole('menuitemradio', { name: '경로 곡선' }).click();
await wait(150);
await menu.getByRole('menuitemradio', { name: '빨강 화살표' }).click();
await wait(150);
let st = await arrow(ids.aiArrow);
check('모양 › 물결 · 곡선 · 빨강 → style만 바뀌고 관계는 그대로', JSON.stringify(st.style) === JSON.stringify({ line: 'wavy', route: 'curve', color: 'red' }) && st.relation === 'implies', JSON.stringify(st.style));
check('고른 단추에 켜짐 표시', (await menu.getByRole('menuitemradio', { name: '선 물결' }).getAttribute('aria-checked')) === 'true');
await page.screenshot({ path: `${OUT}/meaning-style.png` });
await menu.getByRole('menuitem', { name: '관계 기본 모양으로' }).click();
await wait(150);
st = await arrow(ids.aiArrow);
check('관계 기본 모양으로 → style 비움', st.style === undefined);

// 8. 기호 (v6 3단계): ∴ · ⇏ · 번호 → 저장되고 칩에 함께
await menu.locator('.menu-sub > button', { hasText: '관계' }).click(); // 관계 종류 · 기호 · 묶음 끝은 '관계 ▸' (DS-016)
await menu.getByRole('menuitemradio', { name: '기호 그러므로' }).click();
await wait(150);
await menu.getByRole('menuitemcheckbox', { name: '성립하지 않음' }).click();
await wait(150);
await menu.getByLabel('화살표 번호').fill('2');
await wait(200);
st = await arrow(ids.aiArrow);
check('기호 ∴ · 성립 안 함 · 번호 2 저장', st.symbol === '∴' && st.negated === true && st.order === 2, JSON.stringify({ s: st.symbol, n: st.negated, o: st.order }));
const chip = await ws((id) => window.__dn.view.engine && (() => { const a = window.__dn.view.engine.getArrow(id); return [a.order, a.negated, a.symbol, a.label]; })(), ids.aiArrow);
check('칩 재료가 라벨과 따로 저장됨', chip[3] === undefined || !String(chip[3]).includes('∴'), JSON.stringify(chip));
await page.keyboard.press('Escape');
await page.screenshot({ path: `${OUT}/meaning-marks.png` });

// 9. 묶음 종류 · 테두리 (v6 3단계): 묶음을 골라 블록 메뉴 → 전제 묶음 · 중괄호
const member = page.locator(`.dn-block[data-id="${ids['원인']}"]`);
// 묶음째 고르기는 이름표로 (상자를 누르면 그 상자 하나) — 이름표는 묶음 테두리(상자 바깥 8px) 위, 맨 위 상자에 종류 태그가 있으면 19px 더 위
const tagAt = await ws((id) => {
  const v = window.__dn.view, e = v.engine, gid = e.getBlock(id).group;
  const bs = [...e.blocks()].filter((b) => b.group === gid), top = Math.min(...bs.map((b) => b.y)), left = Math.min(...bs.map((b) => b.x));
  const lift = bs.some((b) => (b.nodeKind || b.role || b.speaker) && Math.abs(b.y - top) < 2) ? 19 : 0;
  const o = v.root.getBoundingClientRect(), c = v.camera;
  return { x: o.left + (left - c.x) * c.zoom - 8 + 10, y: o.top + (top - c.y) * c.zoom - 8 - 10 - lift * c.zoom };
}, ids['원인']);
await page.mouse.click(tagAt.x, tagAt.y);
await wait(150);
await page.mouse.click(tagAt.x, tagAt.y, { button: 'right' }); // 묶음째 메뉴는 이름표에서 (콘텐츠를 오른쪽 클릭하면 그 콘텐츠 메뉴)
await wait(200);
check('묶음 전체를 고르면 블록 메뉴에 묶음 ▸ (종류 select는 하위 메뉴 안)', (await page.locator('[aria-label="블록 메뉴"] select[aria-label="묶음 종류"]').count()) === 0);
await page.locator('.menu[aria-label="블록 메뉴"] .menu-sub > button[aria-haspopup="menu"]', { hasText: '묶음' }).click(); // 묶음 ▸ 하위 메뉴
const gkind = page.locator('[aria-label="블록 메뉴"] select[aria-label="묶음 종류"]');
check('묶음 ▸ 안에 묶음 종류', await gkind.isVisible());
await gkind.selectOption('premises');
await wait(150);
await page.locator('[aria-label="블록 메뉴"] [aria-label="테두리 중괄호 }"]').click();
await wait(200);
const gm = await ws(() => window.__dn.view.engine.note.groups?.premises);
check('묶음 종류 premises · 테두리 brace 저장', gm?.kind === 'premises' && gm?.bracket === 'brace', JSON.stringify(gm));
check('묶음 ▸ 줄에 지금 값', (await page.locator('[aria-label="블록 메뉴"] .menu-sub > button[aria-haspopup="menu"]', { hasText: '묶음' }).innerText()).includes('전제 묶음 ∧ · 중괄호'));
await page.keyboard.press('Escape');
await page.mouse.click(1300, 700);
await wait(200);
await page.screenshot({ path: `${OUT}/meaning-group-kind.png` });

// 10. 노드 종류 태그 · 상태 (v6 3단계): AI 결론 블록에 태그 "결론 · conclusion", 상태 › 경고 · 역할 · 발화자
const concl = page.locator(`.dn-block[data-id="${ids['AI 결론']}"]`);
check('노드 종류 태그가 블록 위에', (await concl.locator('.dn-kind-tag').innerText()).includes('결론 · conclusion'), await concl.locator('.dn-kind-tag').innerText());
await concl.click({ button: 'right' });
await wait(200);
const bm = page.locator('[aria-label="블록 메뉴"]');
await page.locator('.menu-sub > button', { hasText: '의미' }).click(); // 하위 메뉴 (DS-001)
await bm.getByRole('menuitem', { name: /상태 · 역할/ }).click();
await wait(100);
await bm.getByRole('menuitemradio', { name: '⚠ 경고' }).click();
await wait(150);
await bm.getByLabel('역할').fill('최종 판정');
await bm.getByLabel('역할').press('Enter');
await wait(150);
await bm.getByLabel('발화자').fill('갑설');
await bm.getByLabel('발화자').press('Enter');
await wait(200);
const cb = await block(ids['AI 결론']);
check('경고 · 역할 · 발화자 저장', cb.emphasis === 'warning' && cb.role === '최종 판정' && cb.speaker === '갑설', JSON.stringify({ e: cb.emphasis, r: cb.role, s: cb.speaker }));
const tagText = await concl.locator('.dn-kind-tag').innerText();
check('태그 "⚠ 최종 판정 · conclusion" + 발화자 칩, 경고 테두리', tagText.includes('⚠ 최종 판정 · conclusion') && tagText.includes('● 갑설') && (await concl.getAttribute('data-state')) === 'warning', tagText);
await page.keyboard.press('Escape');
await page.mouse.click(1300, 700);
await wait(200);
await page.screenshot({ path: `${OUT}/meaning-kind-tag.png` });
check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
