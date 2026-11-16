// 내 블록 (사용자 요청 10/30 알파 8): 블록 메뉴 › 내 블록으로 저장 → 넣기(＋) 메뉴 맨 위 '내 블록' → 누를 때마다 사본(블록 · 화살표, 겹치지 않게),
// 핀으로 도구 막대에 고정, 오른쪽 클릭으로 이름 바꾸기 · 빼기, 찾기, 새로 고침 뒤에도.
// 11/03: 저장할 때 양식 이름 · 넣을 때 블록 이름을 묻는 창, 넣은 상자들은 그 이름의 블록(묶음 모양째)으로 묶임 · 사이드바 블록 목록.
// 사용: dev 서버 실행 후 `node e2e/snippets.mjs [스크린샷 폴더]`
import { chromium } from 'playwright-core';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2] ?? '.';
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
const wait = (ms) => page.waitForTimeout(ms);
await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(() => window.__dn.newNote());
await wait(300);

const [A, B] = await ws(() => window.__dn.view.engine.transact((tx) => {
  const mk = (x, y, t) => { const b = tx.createBlock({ x, y, w: 220, h: 60 }); tx.createContent({ blockId: b, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] } }); return b; };
  const a = mk(0, 0, '회의 안건'), b = mk(320, 0, '결정 사항');
  tx.createArrow({ from: { blockId: a, side: 'auto' }, to: { blockId: b, side: 'auto' } });
  // 두 상자를 중괄호 블록 하나로 (저장하면 이 모양째)
  tx.set('block', a, { group: 'g-one' }); tx.set('block', b, { group: 'g-one' });
  tx.setNote({ groups: { 'g-one': { name: '안건 묶음', bracket: 'brace' } } });
  return [a, b];
}, { origin: 'user' }).value);
await ws(() => { const v = window.__dn.view; v.setCamera({ x: -200, y: -200, zoom: 1 }); });
await wait(200);
const counts = () => ws(() => { const e = window.__dn.view.engine; return { blocks: e.blockCount, arrows: [...e.arrows()].length }; });
const snips = () => ws(() => window.__dn.state.snippets.map((s) => ({ id: s.id, name: s.name, blocks: s.clip.blocks.length, arrows: s.clip.arrows.length, bracket: s.group?.bracket })));
const nameBox = page.locator('.dialog.snip-name .snip-name-input');

// 저장: 블록(묶음) 전체를 고르고 블록 메뉴 › 내 블록으로 저장 (묶음 이름표 · 테두리 오른쪽 클릭과 같은 메뉴)
const groupMenu = () => ws(([a, b]) => { const v = window.__dn.view; v.select([a, b]); v.onBlockMenu({ ids: [a, b], x: 500, y: 300 }); }, [A, B]);
await groupMenu();
await page.locator('.menu[aria-label="블록 메뉴"] button', { hasText: '내 블록으로 저장' }).click();
await nameBox.waitFor({ timeout: 3000 });
check('저장 → 양식 이름 창, 처음 값은 블록 이름 · 아직 저장 안 됨', (await nameBox.inputValue()) === '안건 묶음' && (await snips()).length === 0);
await page.screenshot({ path: `${OUT}/snippets-save-name.png` });
await nameBox.fill('회의 틀');
await page.keyboard.press('Enter');
await wait(150);
const s1 = await snips();
check('이름 창 Enter → 그 이름으로 저장 · 상자 둘 · 화살표 하나 · 묶음 모양째', s1.length === 1 && s1[0].blocks === 2 && s1[0].arrows === 1 && s1[0].name === '회의 틀' && s1[0].bracket === 'brace' && !(await nameBox.count()), JSON.stringify(s1));
check('저장 알림', (await page.locator('.toast').innerText()).includes('내 블록'));
// 취소하면 저장하지 않음
await groupMenu();
await page.locator('.menu[aria-label="블록 메뉴"] button', { hasText: '내 블록으로 저장' }).click();
await nameBox.waitFor({ timeout: 3000 });
await page.keyboard.press('Escape');
await wait(150);
check('이름 창 Esc → 저장 안 함', (await snips()).length === 1 && !(await nameBox.count()));

// 넣기 메뉴 맨 위 '내 블록' → 사본
const bar = page.locator('.toolbar');
await bar.locator('.insert-btn').click();
await page.waitForSelector('.insert-menu');
check('넣기 메뉴 맨 위에 내 블록', (await page.locator('.insert-menu .menu-head').first().innerText()) === '내 블록' && (await page.locator('.insert-menu .insert-item').first().innerText()).includes('회의 틀'));
await page.screenshot({ path: `${OUT}/snippets-menu.png` });
const c0 = await counts();
await page.locator('.insert-menu .insert-item', { hasText: '회의 틀' }).click();
await nameBox.waitFor({ timeout: 3000 });
check('넣기 → 블록 이름 창(처음 값은 저장한 이름) · 아직 안 넣음', (await nameBox.inputValue()) === '회의 틀' && (await counts()).blocks === c0.blocks);
await nameBox.fill('이번 주 회의');
await page.keyboard.press('Enter');
await wait(250);
const c1 = await counts();
const placed = await ws(([a, b]) => {
  const e = window.__dn.view.engine, sel = [...window.__dn.view.selBlocks], olds = [a, b].map((id) => e.getBlock(id));
  const hit = sel.some((id) => { const n = e.getBlock(id); return olds.some((o) => n.x < o.x + o.w && n.x + n.w > o.x && n.y < o.y + o.h && n.y + n.h > o.y); });
  return { sel: sel.length, hit, texts: sel.map((id) => e.contentsOf(id)[0]?.doc?.content?.[0]?.content?.[0]?.text).sort() };
}, [A, B]);
check('누르면 사본 — 상자 둘 · 화살표 하나 더, 새 상자를 골라 둠 · 원본과 안 겹침', c1.blocks === c0.blocks + 2 && c1.arrows === c0.arrows + 1 && placed.sel === 2 && !placed.hit && placed.texts.join() === '결정 사항,회의 안건', JSON.stringify({ c0, c1, placed }));
const grp = await ws(() => {
  const e = window.__dn.view.engine, gs = [...window.__dn.view.selBlocks].map((id) => e.getBlock(id).group);
  return { same: gs.length === 2 && !!gs[0] && gs[0] === gs[1] && gs[0] !== 'g-one', meta: e.note.groups?.[gs[0]] ?? null };
});
check('넣은 상자 둘이 입력한 이름의 블록 하나 · 묶음 모양째', grp.same && grp.meta?.name === '이번 주 회의' && grp.meta?.bracket === 'brace', JSON.stringify(grp));
await wait(300);
check('사이드바 블록 목록에 그 이름', (await ws(() => window.__dn.state.outline.rows.filter((r) => r.kind === 'block').map((b) => b.name))).includes('이번 주 회의'));
await page.screenshot({ path: `${OUT}/snippets-placed.png` });
await ws(() => window.__dn.view.root.focus());
await page.keyboard.press('Control+z');
await wait(100);
check('실행 취소 한 번에 사본 · 묶음 전체가 빠짐', JSON.stringify(await counts()) === JSON.stringify(c0) && !Object.values(await ws(() => window.__dn.view.engine.note.groups ?? {})).some((g) => g.name === '이번 주 회의'));

// 핀 → 도구 막대에 고정 → 누르면 사본
await bar.locator('.insert-btn').click();
await page.waitForSelector('.insert-menu');
await page.locator('.insert-menu .insert-item', { hasText: '회의 틀' }).hover();
await page.locator('.insert-menu .insert-item', { hasText: '회의 틀' }).locator('.insert-pin').click();
await page.keyboard.press('Escape');
await wait(100);
const pin = bar.locator('.pinned[aria-label="내 블록 회의 틀 넣기"]');
check('핀 → 도구 막대에 내 블록 단추', (await pin.count()) === 1);
await pin.click();
await nameBox.waitFor({ timeout: 3000 });
await page.keyboard.press('Enter');
await wait(200);
check('고정한 단추 → 이름 창 → Enter면 저장한 이름의 블록', (await counts()).blocks === c0.blocks + 2 && (await ws(() => window.__dn.state.outline.rows.filter((r) => r.kind === 'block').map((b) => b.name))).includes('회의 틀'));

// 이름 바꾸기 (오른쪽 클릭) · 찾기
await bar.locator('.insert-btn').click();
await page.waitForSelector('.insert-menu');
await page.locator('.insert-menu .insert-item', { hasText: '회의 틀' }).click({ button: 'right' });
await page.locator('.insert-snip-ctx button', { hasText: '이름 바꾸기' }).click();
await page.locator('.insert-snip-name').fill('주간 회의 틀');
await page.keyboard.press('Enter');
await wait(100);
check('오른쪽 클릭 › 이름 바꾸기', (await snips())[0]?.name === '주간 회의 틀' && (await bar.locator('.pinned[aria-label="내 블록 주간 회의 틀 넣기"]').count()) === 1);
await page.locator('.insert-search').fill('주간');
await wait(100);
check('찾기 칸에서 내 블록 이름으로 찾기', (await page.locator('.insert-menu .insert-item').first().innerText()).includes('주간 회의 틀'));
await page.keyboard.press('Escape');

// 새로 고침 뒤에도
await wait(400);
await page.reload();
await page.waitForSelector('.toolbar', { timeout: 15000 });
await wait(300);
check('새로 고침 뒤에도 내 블록 · 고정 그대로', (await snips()).length === 1 && (await page.locator('.toolbar .pinned[aria-label="내 블록 주간 회의 틀 넣기"]').count()) === 1);

// 빼기 → 고정도 풀림
await page.locator('.toolbar .insert-btn').click();
await page.waitForSelector('.insert-menu');
await page.locator('.insert-menu .insert-item', { hasText: '주간 회의 틀' }).click({ button: 'right' });
await page.locator('.insert-snip-ctx button', { hasText: '빼기' }).click();
await wait(150);
check('오른쪽 클릭 › 빼기 → 목록 · 도구 막대 고정에서 빠짐', (await snips()).length === 0 && (await page.locator('.toolbar .pinned').count()) === 0 && (await page.locator('.insert-menu .menu-head').first().innerText()) !== '내 블록');
await page.keyboard.press('Escape');

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
