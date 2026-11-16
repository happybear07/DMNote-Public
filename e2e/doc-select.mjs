// 문서 뷰 블록 고르기 · 지우기 · 복사: 글 아닌 항목 누르기 · 끌어서 여러 블록 · Shift+누르기 · Esc · Ctrl+A 두 번 · Shift+↓ ·
// Delete/Backspace · 실행 취소 · Ctrl+D 복제 · Ctrl+C/V 붙여넣기 · 글 칸 안 끌기 선택.
// 사용: dev 서버 실행 후 `node e2e/doc-select.mjs [스크린샷 폴더]`
import { chromium } from 'playwright-core';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2] ?? '.';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const browser = await chromium.launch({ channel: process.env.DN_CHANNEL ?? 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(BASE).origin });
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
const seed = () => ws(() => {
  const e = window.__dn.view.engine;
  e.transact((tx) => { for (const b of [...e.blocks()]) { for (const c of e.contentsOf(b.id)) tx.delete('content', c.id); tx.delete('block', b.id); } }, { origin: 'user' });
  const p = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] });
  e.transact((tx) => {
    for (const [i, t] of ['가 문단', '나 문단', '다 문단', '라 문단'].entries()) { const b = tx.createBlock({ x: 0, y: i * 100, w: 400, h: 50 }); tx.createContent({ blockId: b, type: 'text', role: 'body', doc: { type: 'doc', content: [p(t)] } }); }
    const b = tx.createBlock({ x: 0, y: 400, w: 300, h: 120 }); tx.createContent({ blockId: b, type: 'toc' });
  }, { origin: 'user' });
});
await seed();
await ws(() => window.__dn.setViewMode('doc'));
await wait(600);
const texts = () => ws(() => [...document.querySelectorAll('.dn-doc .dn-doc-text')].map((el) => el.textContent.trim()));
const count = () => ws(() => window.__dn.view.engine.blockCount);
const sel = () => ws(() => document.querySelectorAll('.dn-doc .dn-doc-sel').length);
const part = (i) => page.locator('.dn-doc .dn-doc-text').nth(i);
const box = async (i) => { await part(i).scrollIntoViewIfNeeded(); return part(i).boundingBox(); };

// 1. 글 아닌 항목(목차) 누르기 → 고름 → Delete → 사라짐 → Ctrl+Z → 돌아옴
const toc = page.locator('.dn-doc .dn-doc-item').filter({ has: page.locator('.dn-toc, [class*="toc"]') }).first();
await toc.click();
await wait(200);
check('목차 블록을 누르면 그 블록이 골라짐', (await sel()) === 1 && (await ws(() => document.querySelector('.dn-doc-sel')?.querySelector('.dn-doc-text') === null)));
const n0 = await count();
await page.keyboard.press('Delete');
await wait(300);
check('Delete → 고른 블록 지움', (await count()) === n0 - 1);
await page.keyboard.press('Control+z');
await wait(300);
check('Ctrl+Z → 다시 돌아옴', (await count()) === n0);

// 2. 글 칸에서 누른 채 다른 칸까지 끌기 → 워드처럼 글자 범위 → Backspace = 첫 칸 앞부분 + 끝 칸 뒷부분, 사이 칸은 지움
let a = await box(0), c = await box(2);
const selText = () => ws(() => getSelection().toString());
await page.mouse.move(a.x + 18, a.y + 8);
await page.mouse.down();
await page.mouse.move(a.x + 40, a.y + 8, { steps: 3 });
await page.mouse.move(c.x + 18, c.y + 8, { steps: 8 });
await page.mouse.up();
await wait(200);
const st = await selText();
check('글을 누른 채 셋째 칸까지 끌면 칸을 넘어 글자가 골라짐 (블록 아님)', /나 문단/.test(st) && (await sel()) === 0 && !/^가 문단/.test(st.trim()), JSON.stringify(st));
await page.keyboard.press('Backspace');
await wait(400);
const t2 = await texts();
check('Backspace → 첫 칸 앞부분 + 셋째 칸 뒷부분이 이어지고 둘째 칸은 지움', t2.length === 2 && t2[0].startsWith('가') && t2[0].endsWith('단') && !t2[0].includes('나') && t2[1] === '라 문단', JSON.stringify(t2));
check('이어진 자리에 커서 (바로 입력 가능)', await ws(() => !!document.querySelector('.dn-doc .dn-text-editing')));
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
await page.keyboard.press('Control+z');
await wait(400);
check('Ctrl+Z 한 번에 모두 돌아옴', JSON.stringify(await texts()) === '["가 문단","나 문단","다 문단","라 문단"]', JSON.stringify(await texts()));
// 범위에서 글자 입력 = 바꿔 쓰기
a = await box(1); c = await box(2);
await page.mouse.move(a.x + 18, a.y + 8); await page.mouse.down();
await page.mouse.move(c.x + 18, c.y + 8, { steps: 8 }); await page.mouse.up();
await wait(150);
await page.keyboard.type('X');
await wait(300);
const tx = await texts();
check('범위에서 글자를 치면 그 글자로 바뀜', tx.length === 3 && tx[1].includes('X') && !tx[1].includes('나 문단'), JSON.stringify(tx));
await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
await page.keyboard.press('Control+z'); await wait(300);
check('Ctrl+Z 한 번에 원래대로 (지우기 + 입력이 한 번, DE-008)', (await texts()).length === 4, JSON.stringify(await texts()));
// 잘라내기 → 다른 칸에 붙여넣기
a = await box(1); c = await box(2);
await page.mouse.move(a.x + 1, a.y + 8); await page.mouse.down();
await page.mouse.move(c.x + 1, c.y + 8, { steps: 8 }); await page.mouse.up();
await wait(150);
await page.keyboard.press('Control+x');
await wait(300);
check('Ctrl+X → 고른 글이 빠짐', JSON.stringify(await texts()) === '["가 문단","다 문단","라 문단"]', JSON.stringify(await texts()));
c = await box(2);
await page.mouse.click(c.x + c.width - 4, c.y + 8);
await page.keyboard.press('End');
await page.keyboard.press('Control+v');
await wait(300);
check('Ctrl+V → 잘라낸 글이 들어감', (await texts()).join('|').includes('나 문단'), JSON.stringify(await texts()));
await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
await seed();
await wait(500);

// 3. 같은 칸 안 끌기 = 글자 고르기 (블록 고르기 아님)
a = await box(1);
await page.mouse.move(a.x + 2, a.y + 8);
await page.mouse.down();
await page.mouse.move(a.x + 60, a.y + 8, { steps: 5 });
await page.mouse.up();
await wait(150);
const picked = await ws(() => getSelection().toString());
check('한 칸 안에서 끌면 글자가 골라짐 (블록 고르기 아님)', picked.length >= 1 && (await sel()) === 0, JSON.stringify(picked));

// 4. 고치는 중 Esc → 그 블록 고름 → Delete
a = await box(1);
await page.mouse.click(a.x + 20, a.y + 8);
await wait(200);
await page.keyboard.press('Escape');
await wait(200);
check('고치다 Esc → 그 블록이 골라짐', (await sel()) === 1);
await page.keyboard.press('Delete');
await wait(300);
check('이어서 Delete → 그 블록 지움', JSON.stringify(await texts()) === '["가 문단","다 문단","라 문단"]', JSON.stringify(await texts()));
await page.keyboard.press('Control+z');
await wait(400);

// 5. Shift+누르기 = 고치던 커서부터 글자 범위 · 칸 끝에서 Shift+↓ = 다음 칸으로 넘어가는 글자 범위
a = await box(0);
await page.mouse.click(a.x + 18, a.y + 8);
await wait(150);
c = await box(2);
await page.keyboard.down('Shift');
await page.mouse.click(c.x + 18, c.y + 8);
await page.keyboard.up('Shift');
await wait(200);
check('Shift+누르기 → 고치던 자리부터 누른 자리까지 글자 범위', /나 문단/.test(await selText()) && (await sel()) === 0, JSON.stringify(await selText()));
await page.keyboard.press('Escape');
a = await box(0);
await page.mouse.click(a.x + 18, a.y + 8);
await page.keyboard.press('End');
await page.keyboard.press('Shift+ArrowDown');
await wait(200);
const s1 = await selText();
check('칸 끝에서 Shift+↓ → 다음 칸 글자까지 범위', s1.length > 0 && /나/.test(s1), JSON.stringify(s1));
await page.keyboard.press('Shift+ArrowDown');
await wait(150);
const s2 = await selText();
check('Shift+↓ 한 번 더 → 더 넓어짐', /다/.test(s2) && s2.length > s1.length, JSON.stringify(s2));
await page.keyboard.press('Escape');

// 6. Ctrl+A 두 번 → 모든 블록
a = await box(0);
await page.mouse.click(a.x + 20, a.y + 8);
await page.keyboard.press('Control+a');
await wait(100);
check('Ctrl+A 한 번 = 칸 안 글 모두 (블록은 아직)', (await sel()) === 0);
await page.keyboard.press('Control+a');
await wait(150);
const all = await ws(() => document.querySelectorAll('.dn-doc .dn-doc-item').length);
check('Ctrl+A 두 번 = 문서의 모든 블록', (await sel()) === all, `${await sel()}/${all}`);
await page.keyboard.press('Escape');

// 7. Ctrl+D 복제 · Ctrl+C → 다른 칸 고치며 Ctrl+V = 그 아래에 붙여넣기
a = await box(0);
await page.mouse.click(a.x + 20, a.y + 8);
await page.keyboard.press('Escape');
await page.keyboard.press('Control+d');
await wait(300);
check('Ctrl+D → 바로 아래에 복제', JSON.stringify((await texts()).slice(0, 2)) === '["가 문단","가 문단"]', JSON.stringify(await texts()));
await page.keyboard.press('Control+z');
await wait(300);
a = await box(1);
await page.mouse.click(a.x + 20, a.y + 8);
await page.keyboard.press('Escape');
await page.keyboard.press('Control+c');
await wait(150);
c = await box(3);
await page.mouse.click(c.x + 20, c.y + 8);
await page.keyboard.press('Control+v');
await wait(400);
const tv = await texts();
check('Ctrl+C로 블록 복사 → 다른 칸에서 Ctrl+V = 그 칸 아래에 블록', JSON.stringify(tv.slice(3, 5)) === '["라 문단","나 문단"]', JSON.stringify(tv));
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');

// 8. 손잡이 ⋮⋮: 끌어서 순서 바꾸기 · 누르면 메뉴(위로 옮기기) · Alt+↓
await seed();
await wait(500);
const order = async () => (await texts()).join(',');
const grip = page.locator('.dn-doc-grip');
let r0 = await box(3);
await page.mouse.move(r0.x + 40, r0.y + 8);
await wait(100);
check('블록에 마우스를 올리면 손잡이가 보임', await grip.isVisible());
const g = await grip.boundingBox();
const r1 = await box(0);
await page.mouse.move(g.x + 8, g.y + 10);
await page.mouse.down();
await page.mouse.move(g.x + 8, g.y - 20, { steps: 4 });
await page.mouse.move(r1.x + 40, r1.y + r1.height + 6, { steps: 10 });
await wait(100);
check('끄는 동안 놓을 자리 줄이 보임', await page.locator('.dn-doc-drop').isVisible());
await page.mouse.up();
await wait(300);
check('라 문단을 가 문단 아래로 끌어 옮김', (await order()) === '가 문단,라 문단,나 문단,다 문단', await order());
await page.keyboard.press('Control+z');
await wait(300);
check('Ctrl+Z → 원래 순서', (await order()) === '가 문단,나 문단,다 문단,라 문단', await order());
r0 = await box(2);
await page.mouse.move(r0.x + 40, r0.y + 8);
await wait(100);
await grip.click();
await page.waitForSelector('.dn-doc-menu');
await page.locator('.dn-doc-menu button', { hasText: '위로 옮기기' }).click();
await wait(300);
check('손잡이 메뉴 → 위로 옮기기', (await order()) === '가 문단,다 문단,나 문단,라 문단', await order());
await page.keyboard.press('Alt+ArrowDown');
await wait(300);
check('고른 채 Alt+↓ → 한 칸 아래로', (await order()) === '가 문단,나 문단,다 문단,라 문단', await order());
await page.keyboard.press('Escape');
await page.screenshot({ path: `${OUT}/doc-select.png` });
// 캔버스도 같은 데이터
check('캔버스와 같은 엔진 — 블록 수 일치', (await count()) === (await ws(() => document.querySelectorAll('.dn-doc .dn-doc-item').length)));
check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
