// 문서 뷰를 워드처럼 (FR-088): 서식 막대 · 빈 곳 눌러 새 문단 · 빈 줄 Enter로 상자 나누기 · ↑↓로 상자 넘기 · 맨 앞 Backspace로 합치기 ·
// Ctrl+B · Ctrl+E 워드 단축키 · Ctrl+Enter 쪽 나눔(종이 2장) · 실행 취소 한 번 · 캔버스에서도 겹치지 않음 · 어두운 테마 종이.
// 사용: dev 서버 실행 후 `node e2e/doc-word.mjs [스크린샷 폴더]`
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
await ws(() => window.__dn.newNote());
await wait(300);
await ws(() => window.__dn.setViewMode('doc'));
await wait(400);
const texts = () => ws(() => window.__dn.view.engine && [...window.__dn.view.engine.blocks()].sort((a, b) => a.y - b.y).map((b) => [...window.__dn.view.engine.contentsOf(b.id)].map((c) => (c.doc?.content ?? []).map((n) => (n.content ?? []).map((t) => t.text ?? '').join('')).join('/')).join('|')));

check('서식 막대 · 쪽 보기(종이)', (await page.locator('.doc-ribbon').count()) === 1 && (await page.locator('.dn-doc-sheet').count()) === 1);
// 빈 노트: 종이를 누르면 첫 문단
await page.locator('.dn-doc-page').click({ position: { x: 300, y: 200 } });
await wait(200);
check('빈 곳을 누르면 새 문단에 바로 커서', (await page.locator('.dn-doc .dn-text-editing').count()) === 1);
await page.keyboard.type('첫 문단');
await page.keyboard.press('Enter');
await page.keyboard.press('Enter');
await wait(250);
await page.keyboard.type('둘째 문단');
await wait(200);
check('빈 줄에서 Enter → 다음 상자로 나뉨', JSON.stringify(await texts()) === JSON.stringify(['첫 문단', '둘째 문단']), JSON.stringify(await texts()));
// ↑로 앞 상자, ↓로 다시
await page.keyboard.press('ArrowUp');
await page.keyboard.type('!');
await wait(150);
check('↑ → 앞 상자로 커서가 넘어감', (await texts())[0].includes('!'), JSON.stringify(await texts()));
await page.keyboard.press('ArrowDown');
await wait(300); // 브라우저는 방금 초점을 옮긴 직후의 이동 키를 한 번 놓칠 수 있다 (사람 손 빠르기면 문제 없음)
await page.keyboard.press('Home');
await wait(80); // 편집기는 커서 이동(selectionchange)을 한 박자 늦게 읽는다 — 바로 Backspace면 옛 자리로 판단
await page.keyboard.press('Backspace');
await wait(250);
const merged = await texts();
check('맨 앞 Backspace → 앞 상자와 합쳐짐 (상자 하나)', merged.length === 1 && merged[0].includes('둘째 문단'), JSON.stringify(merged));
await page.keyboard.type('*');
await wait(150);
check('합친 자리에 커서', /!\*둘째|\*둘째/.test((await texts())[0]), JSON.stringify(await texts()));
await ws(() => window.__dn.view.undo());
await ws(() => window.__dn.view.undo());
await wait(250);
check('실행 취소 → 다시 두 상자', (await texts()).length === 2, JSON.stringify(await texts()));

// 빈 상자에서 Backspace → 그 상자를 없애고 앞 문장 끝으로 — 바로 앞이 표여도 (10/29 사용자: 워드처럼 전 문장으로, 멈추던 것)
const tb = await ws(() => {
  const e = window.__dn.view.engine, bottom = Math.max(...[...e.blocks()].map((b) => b.y + b.h));
  return e.transact((tx) => {
    const t = tx.createBlock({ x: 24, y: bottom + 16, w: 320, h: 90 });
    tx.createContent({ blockId: t, type: 'table', columns: [{ id: 'c1', name: '항목' }, { id: 'c2', name: '값' }], rows: [{ id: 'r1', order: 'a0', cells: {} }] });
    const b = tx.createBlock({ x: 24, y: bottom + 122, w: 320, h: 32 });
    const c = tx.createContent({ blockId: b, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'paragraph' }] } });
    return { t, b, c };
  }, { origin: 'user' }).value;
});
await wait(400);
await page.locator(`.dn-doc .dn-doc-text[data-part="${tb.c}"]`).click();
await wait(200);
await page.keyboard.press('Backspace');
await wait(300);
const afterBs = await ws((tb) => ({ empty: !!window.__dn.view.engine.getBlock(tb.b), table: !!window.__dn.view.engine.getBlock(tb.t) }), tb);
await page.keyboard.type('@');
await wait(150);
const last = (await texts()).filter((t) => t && !t.startsWith('|'));
check('표 뒤 빈 상자에서 Backspace → 빈 상자는 없어지고 표 앞 문장 끝으로 (표는 그대로)', !afterBs.empty && afterBs.table && /둘째 문단@$/.test(last[last.length - 1] ?? ''), JSON.stringify({ afterBs, texts: await texts() }));

// 워드 단축키 · 서식 막대 상태
await page.locator('.dn-doc-text').last().click();
await wait(300);
await page.keyboard.press('End');
await page.keyboard.press('Shift+Home');
await wait(150);
await page.keyboard.press('Control+b');
await wait(150);
check('Ctrl+B → 서식 막대 굵게 켜짐', (await page.locator('.doc-ribbon button[aria-label="굵게"].on').count()) === 1, JSON.stringify(await ws(() => [window.__dn.state.docUi, window.__dn.docView.word.editor?.ed.view.state.selection.toJSON(), document.querySelector('.dn-text-editing')?.innerHTML.slice(0, 120)])));
await page.keyboard.press('Control+e');
await wait(150);
check('Ctrl+E → 가운데 맞춤 (상자 정렬)', (await ws(() => [...window.__dn.view.engine.blocks()].sort((a, b) => a.y - b.y)[1].align)) === 'center');
await page.locator('.doc-ribbon button[aria-label="양쪽 맞춤"]').click();
await wait(150);
check('서식 막대 양쪽 맞춤 · 편집은 그대로', (await ws(() => [...window.__dn.view.engine.blocks()].sort((a, b) => a.y - b.y)[1].align)) === 'justify' && (await page.locator('.dn-doc .dn-text-editing').count()) === 1);

// Ctrl+Enter → 쪽 나눔 (종이 2장)
await page.keyboard.press('End');
await wait(200);
await page.keyboard.press('Control+Enter');
await wait(250);
await page.keyboard.type('새 쪽');
await wait(400);
check('Ctrl+Enter → 새 쪽 (종이 2장, 새 상자는 둘째 쪽)', (await page.locator('.dn-doc-sheet').count()) === 2 && (await ws(() => [...window.__dn.view.engine.blocks()].some((b) => b.pageBreak))), String(await page.locator('.dn-doc-sheet').count()));
await page.screenshot({ path: `${OUT}/doc-word.png` });

// 캔버스에서도 겹치지 않음 (위 → 아래 순서 그대로)
const overlap = await ws(() => { const bs = [...window.__dn.view.engine.blocks()].sort((a, b) => a.y - b.y); return bs.some((b, i) => i && bs[i - 1].y + bs[i - 1].h > b.y); });
check('나눈 상자들이 캔버스에서 겹치지 않음', !overlap);

// 쪽 보기 끄기 · 어두운 테마 종이
await page.locator('.doc-ribbon button[aria-label="쪽 보기 — A4 종이 · 쪽 번호"]').click();
await wait(200);
check('쪽 보기 끄기 → 종이 없음', (await page.locator('.dn-doc-sheet').count()) === 0 && (await ws(() => window.__dn.state.docPages)) === false);
await page.locator('.doc-ribbon button[aria-label="쪽 보기 — A4 종이 · 쪽 번호"]').click();
await ws(() => window.__dn.setTheme('dark'));
await wait(300);
const sheet = await page.locator('.dn-doc-sheet').first().evaluate((el) => getComputedStyle(el).backgroundColor);
const lum = (rgb) => { const [r, g, b] = rgb.match(/\d+/g).map(Number); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
check('어두운 테마: 종이도 어두움 (밝은 글자가 보임)', lum(sheet) < 60, sheet);
await ws(() => window.__dn.setTheme('system'));

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
