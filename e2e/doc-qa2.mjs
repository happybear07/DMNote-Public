// 문서 뷰 QA 2회차 고침 회귀 (docs/DOC-QA.md DQ-016 ~): 웹 주소 칸 Backspace · 넣기 뒤 초점 · 표 칸 실행 취소 · BODY 초점 실행 취소 · Ctrl+L.
// 사용: dev 서버 실행 후 `node e2e/doc-qa2.mjs`
import { chromium } from 'playwright-core';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const browser = await chromium.launch({ channel: process.env.DN_CHANNEL ?? 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => localStorage.setItem('dn:no-env-key', '1'));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });
await page.route('**/api/unfurl?**', (r) => r.fulfill({ contentType: 'application/json', body: '{}' }));
const ws = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
const slash = async (q) => { await page.keyboard.type('/'); await wait(150); await page.keyboard.type(q); await wait(250); await page.keyboard.press('Enter'); await wait(500); };
const types = () => ws(() => { const e = window.__dn.view.engine; return [...e.blocks()].map((b) => e.contentsOf(b.id).map((c) => c.type).join(',')); });
const active = () => ws(() => { const a = document.activeElement; return a === document.body ? 'BODY' : a?.closest('.dn-doc') ? 'doc' : a?.closest('.canvas-host') ? 'canvas' : a?.tagName ?? null; });
const fresh = async () => { await ws(() => window.__dn.newNote()); await wait(300); await ws(() => window.__dn.setViewMode('doc')); await wait(500); await page.locator('.dn-doc-page').click({ position: { x: 300, y: 200 } }); await wait(250); };

await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });

// DQ-016: 블록을 고른 채 웹 주소 칸에서 Backspace · Ctrl+A
await fresh();
await slash('웹 북마크');
await page.locator('.dn-doc .dn-web-note').first().click();
await wait(200);
await page.locator('.dn-doc .dn-web-input input').click();
await page.keyboard.type('https://ab');
await page.keyboard.press('Backspace');
await wait(200);
check('DQ-016 주소 칸 Backspace → 글자만 지움 (블록은 그대로)', (await types()).includes('web') && (await page.locator('.dn-doc .dn-web-input input').inputValue()) === 'https://a');
await page.keyboard.press('Control+a');
await wait(150);
check('DQ-016 주소 칸 Ctrl+A → 칸 글자만 고름', (await ws(() => document.activeElement?.tagName)) === 'INPUT' && (await page.locator('.dn-doc .dn-doc-sel').count()) === 0);

// DQ-017: 빈 문단 /목차 → 초점이 캔버스로 가지 않고 문서에서 그 블록을 고름
await fresh();
await slash('목차');
await wait(300);
check('DQ-017 /목차 뒤 초점은 문서 (캔버스 아님) · 목차 블록을 고름', (await active()) === 'doc' && (await page.locator('.dn-doc .dn-doc-sel').count()) === 1, String(await active()));
await page.keyboard.press('ArrowLeft');
await wait(150);
check('DQ-017 방향키가 캔버스 블록을 옮기지 않음', (await ws(() => { const b = [...window.__dn.view.engine.blocks()].find((x) => window.__dn.view.engine.contentsOf(x.id)[0]?.type === 'toc'); return b ? b.x : null; })) !== null);

// DQ-028: 빈 문단 /표 → 첫 칸에서 바로 쓰기
await fresh();
await page.keyboard.type('/표');
await wait(250);
await page.keyboard.press('Enter');
await wait(300);
await page.keyboard.press('Enter'); // 크기 고르기 창 기본값
await wait(600);
check('DQ-028 /표 → 첫 칸 편집 중', (await page.locator('.dn-doc td.dn-cell-editing').count()) === 1);

// DQ-018: 표 칸 실행 취소 → 칸 화면도 되돌아감
await page.keyboard.type('XYZ');
await wait(1300);
await page.keyboard.press('Control+z');
await wait(300);
const cellText = await page.locator('.dn-doc td.dn-cell-editing').innerText();
check('DQ-018 표 칸 Ctrl+Z → 칸 화면도 되돌아감', !cellText.includes('XYZ'), cellText);
await page.keyboard.type('W');
await wait(300);
const saved = await ws(() => JSON.stringify([...window.__dn.view.engine.contents()].find((c) => c.type === 'table').rows));
check('DQ-018 그다음 입력에 되돌린 글이 다시 저장되지 않음', !saved.includes('XYZ') && saved.includes('W'), saved.slice(0, 120));

// DQ-019: 초점이 BODY여도 Ctrl+Z
await page.keyboard.press('Escape');
await wait(200);
await ws(() => { document.activeElement?.blur?.(); });
const before = JSON.stringify(await types());
check('DQ-019 준비: 초점 BODY', (await active()) === 'BODY');
await page.keyboard.press('Control+z');
await wait(300);
await page.keyboard.press('Control+z');
await wait(300);
await page.keyboard.press('Control+z');
await wait(300);
check('DQ-019 BODY에서도 Ctrl+Z가 실행 취소 (표가 빠짐)', JSON.stringify(await types()) !== before && !(await types()).includes('table'), `${before} → ${JSON.stringify(await types())}`);

// DQ-020: 문서 뷰 Ctrl+L은 왼쪽 맞춤 — 캔버스 블록 링크 복사가 끼어들지 않음
await fresh();
await page.keyboard.type('맞춤');
await ws(() => { const v = window.__dn.view; v.select([...v.engine.blocks()].map((b) => b.id).slice(0, 1)); });
await page.locator('.dn-doc .dn-doc-text').first().click();
await page.keyboard.press('Control+e');
await page.keyboard.press('Control+l');
await wait(300);
check('DQ-020 문서 뷰 Ctrl+L → 왼쪽 맞춤 · 링크 복사 알림 없음', (await ws(() => [...window.__dn.view.engine.blocks()][0]?.align ?? 'left')) === 'left' && (await page.locator('.toast', { hasText: '블록 링크' }).count()) === 0);

// DQ-023: 표 칸 Shift+Tab → 앞 칸
await fresh();
await ws(() => { const e = window.__dn.view.engine; const p = (t) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] }); e.transact((tx) => { const b = tx.createBlock({ x: 0, y: 300, w: 360, h: 120 }); tx.createContent({ blockId: b, type: 'table', columns: [0, 1, 2].map((i) => ({ id: `c${i}`, name: `열${i}` })), rows: [0, 1, 2].map((r) => ({ id: `r${r}`, order: `a${r}`, cells: Object.fromEntries([0, 1, 2].map((i) => [`c${i}`, p(`${'가나다'[r]}${i}`)])) })) }); }, { origin: 'user' }); });
await wait(500);
const cell = (r, c) => page.locator(`.dn-doc .dn-table td[data-row="r${r}"][data-col="c${c}"]`);
await cell(1, 1).click();
await wait(250);
await page.keyboard.press('Shift+Tab');
await wait(300);
check('DQ-023 표 칸 Shift+Tab → 앞 칸 (나0)', await cell(1, 0).evaluate((td) => td.classList.contains('dn-cell-editing')));
// DQ-021: 합친 칸에서 '+ 아래에 행' → 합친 칸 아래에
await cell(0, 0).click();
await wait(250);
await cell(1, 1).click({ modifiers: ['Shift'] });
await wait(200);
await page.locator('.dn-doc .dn-table-tools button', { hasText: '칸 합치기' }).click();
await wait(400);
await page.locator('.dn-doc .dn-table-tools button', { hasText: '아래에 행' }).click();
await wait(400);
const tbl = () => ws(() => { const t = [...window.__dn.view.engine.contents()].find((c) => c.type === 'table'); return { rows: [...t.rows].sort((a, b) => (a.order < b.order ? -1 : 1)).map((r) => r.id), merges: t.merges ?? [] }; });
let tb = await tbl();
check('DQ-021 합친 칸에서 행 추가 → 합친 칸(2행) 아래 · 합친 칸은 그대로 2행', tb.rows.indexOf('r1') === 1 && tb.rows.length === 4 && tb.rows[2] !== 'r2' && tb.merges[0]?.r1 === 'r1', JSON.stringify(tb));
// DQ-022: 합친 칸을 고치는 채로 '행 지우기'(왼쪽 위 행) → 글은 남고 합친 칸은 한 줄
await cell(0, 0).click();
await wait(250);
await page.locator('.dn-doc .dn-table-tools button', { hasText: '행 지우기' }).click();
await wait(400);
tb = await tbl();
const kept = await ws(() => JSON.stringify([...window.__dn.view.engine.contents()].find((c) => c.type === 'table').rows));
check('DQ-022 왼쪽 위 행 지우기 → 모은 글이 남고 합침은 r1부터', kept.includes('가0') && tb.merges.length === 1 && tb.merges[0].r0 === 'r1' && !tb.rows.includes('r0'), JSON.stringify(tb));

// DQ-025: 빈 문단에 /웹 북마크 → 실행 취소 한 번에 넣기 전 (빈 문단 · 자리 되살아나지 않음)
await fresh();
await page.keyboard.type('첫 문단');
await page.keyboard.press('Enter');
await page.keyboard.press('Enter');
await wait(300);
const beforeIns = JSON.stringify(await types());
await slash('웹 북마크');
await wait(300);
await ws(() => window.__dn.view.undo());
await wait(300);
check('DQ-025 /웹 북마크 넣기 → 실행 취소 한 번에 넣기 전', !(await types()).includes('web'), `${beforeIns} → ${JSON.stringify(await types())}`);

// DQ-026: Alt+= 수식 → Enter → 이어 치는 글은 수식 뒤
await fresh();
await page.keyboard.type('보통 문단 ');
await page.keyboard.press('Alt+Equal');
await wait(300);
await page.keyboard.type('x^2');
await page.keyboard.press('Enter');
await wait(300);
await page.keyboard.type('abc');
await wait(300);
const order = await ws(() => { const c = [...window.__dn.view.engine.contents()].find((x) => JSON.stringify(x.doc ?? '').includes('math_inline')); return (c?.doc.content[0].content ?? []).map((n) => n.type === 'math_inline' ? '[m]' : n.text).join(''); });
check('DQ-026 수식 뒤에 이어 쓰기', /\[m\]abc$/.test(order), order);

// DQ-028: 글 있는 상자의 빈 줄에서 넣기 → 그 자리에 블록, 빈 줄은 남지 않음
const docOrder = () => ws(() => [...document.querySelectorAll('.dn-doc .dn-doc-item')].map((el) => (el.querySelector('.dn-toc') ? '[목차]' : el.querySelector('.dn-table') ? '[표]' : el.textContent.trim())));
const textLens = () => ws(() => [...window.__dn.view.engine.contents()].filter((c) => c.type === 'text').map((c) => c.doc.content.length));
await fresh();
await page.keyboard.type('문단1 내용입니다');
await page.keyboard.press('Enter'); // 같은 상자 안 빈 줄
await wait(200);
await slash('목차');
await wait(400);
let o28 = await docOrder();
check('DQ-028 끝 빈 줄에서 /목차 → 상자 바로 아래, 빈 줄은 남지 않음', JSON.stringify(o28.slice(0, 2)) === '["문단1 내용입니다","[목차]"]' && JSON.stringify(await textLens()) === '[1]', JSON.stringify({ o28, lens: await textLens() }));
// 가운데 빈 줄: 윗글 / (빈 줄) / 아랫글 에서 /표 → 윗글 · 표 · 아랫글, 커서는 첫 칸
await fresh();
await page.keyboard.type('윗글');
await page.keyboard.press('Enter');
await page.keyboard.type('아랫글');
await page.keyboard.press('ArrowUp');
await page.keyboard.press('End');
await page.keyboard.press('Enter');
await wait(200);
await slash('표');
await page.keyboard.press('Enter'); // 크기 고르기 창 기본값
await wait(600);
o28 = await docOrder();
check('DQ-028 가운데 빈 줄에서 /표 → 윗글 · 표 · 아랫글 (빈 줄 없음) · 첫 칸 편집 중', JSON.stringify(o28) === '["윗글","[표]","아랫글"]' && (await page.locator('.dn-doc td.dn-cell-editing').count()) === 1, JSON.stringify({ o28, lens: await textLens() }));
await page.keyboard.press('Control+z');
await wait(400);
check('DQ-028 실행 취소 한 번 → 넣기 전 (한 상자 세 줄, 표 없음)', JSON.stringify(await textLens()) === '[3]' && !(await docOrder()).includes('[표]'), JSON.stringify({ o: await docOrder(), lens: await textLens() }));

// DQ-024: 문서 뷰에서 북마크 카드를 '끼워 넣어 보기'로 → 커진 만큼 아래 상자를 내림 (캔버스에서 덮지 않음)
await ws(() => window.__dn.newNote({ sheet: null }));
await page.waitForFunction(() => window.__dn.view.engine.blockCount === 0);
await ws(() => {
  const e = window.__dn.view.engine;
  e.transact((tx) => {
    const mk = (y, t) => { const b = tx.createBlock({ x: 0, y, w: 600, h: 40 }); tx.createContent({ blockId: b, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] } }); };
    mk(0, '문단1');
    const w = tx.createBlock({ x: 0, y: 56, w: 440, h: 104 });
    tx.createContent({ blockId: w, type: 'web', url: 'https://youtu.be/dQw4w9WgXcQ', view: 'bookmark' });
    mk(176, '문단2');
    mk(232, '문단3');
  }, { origin: 'user' });
  window.__dn.setViewMode('doc');
});
await wait(500);
await page.locator('.dn-doc .dn-web-view', { hasText: '끼워 넣어 보기' }).click({ force: true });
await wait(400);
const overlap = await ws(() => { const bs = [...window.__dn.view.engine.blocks()]; return bs.flatMap((b) => bs.filter((c) => c !== b && c.y >= b.y && c.y < b.y + b.h && c.x < b.x + b.w && b.x < c.x + c.w).map(() => b.id)).length; });
const web24 = await ws(() => { const e = window.__dn.view.engine; const c = [...e.contents()].find((x) => x.type === 'web'); return c?.view; });
check('DQ-024 끼워 넣어 보기 → 아래 상자를 내려 캔버스에서 겹치지 않음', web24 === 'embed' && overlap === 0, JSON.stringify({ web24, overlap }));

// DQ-027: 친 뒤 1초 안에 Ctrl+B → Ctrl+Z 한 번은 굵게만
await fresh();
await page.keyboard.type('원래 글');
await wait(1300);
await page.keyboard.type(' 새말');
await wait(300);
for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowLeft');
await page.keyboard.press('Control+b');
await wait(300);
await page.keyboard.press('Control+z');
await wait(300);
const t27 = await ws(() => JSON.stringify([...window.__dn.view.engine.contents()][0].doc));
check('DQ-027 Ctrl+Z 한 번 = 굵게만 취소 · 친 글은 남음', t27.includes('새말') && !t27.includes('strong'), t27.slice(0, 160));
check('콘솔 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close();
const bad = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
