// 문서 뷰 누르기 회귀 (DOC-QA DQ-001~003): 다른 문단을 눌러도 앞 문단 글이 사라지지 않음 · 같은 상자 제목 → 본문 · 누른 자리에 커서.
// 사용: dev 서버 실행 후 `node e2e/doc-click.mjs [스크린샷 폴더]`
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
await ws(() => {
  const e = window.__dn.view.engine;
  const p = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] });
  e.transact((tx) => {
    for (const [i, t] of ['문단1 내용입니다', '문단2 내용입니다', '문단3 내용입니다'].entries()) { const b = tx.createBlock({ x: 0, y: i * 100, w: 400, h: 50 }); tx.createContent({ blockId: b, type: 'text', role: 'body', doc: { type: 'doc', content: [p(t)] } }); }
    const b = tx.createBlock({ x: 0, y: 400, w: 400, h: 90 });
    tx.createContent({ blockId: b, type: 'text', role: 'title', doc: { type: 'doc', content: [p('제목 글자')] } });
    tx.createContent({ blockId: b, type: 'text', role: 'body', doc: { type: 'doc', content: [p('본문 글자 하나')] } });
  }, { origin: 'user' });
});
await ws(() => window.__dn.setViewMode('doc'));
await wait(500);
const texts = () => ws(() => [...document.querySelectorAll('.dn-doc .dn-doc-text')].map((el) => el.textContent.trim()));
const part = (i) => page.locator('.dn-doc .dn-doc-text').nth(i);
const clickAt = async (i, dx = 40) => { await part(i).scrollIntoViewIfNeeded(); const b = await part(i).boundingBox(); await page.mouse.click(b.x + dx, b.y + 8); await wait(300); };
await clickAt(0);
await clickAt(1);
await clickAt(2);
const t1 = await texts();
check('다른 문단을 차례로 눌러도 앞 문단 글이 그대로 (DQ-001)', t1[0] === '문단1 내용입니다' && t1[1] === '문단2 내용입니다', JSON.stringify(t1));
await page.keyboard.press('Escape');
await wait(200);
// 누른 자리에 커서 (DQ-003)
for (const i of [0, 1, 2]) { await clickAt(i, 40); await page.keyboard.type('#'); await wait(150); }
await page.keyboard.press('Escape');
await wait(200);
const t2 = await texts();
check('두 번째 · 세 번째로 누른 문단도 누른 자리에 커서 (DQ-003)', t2.slice(0, 3).every((t) => /^문단\d [^#]*#[^#]*입니다$|^문단\d#|^문\S*#/.test(t) && !t.endsWith('#')), JSON.stringify(t2.slice(0, 3)));
// 같은 상자: 제목 → 본문 (DQ-002)
await clickAt(3);
await clickAt(4);
await page.keyboard.type('x');
await wait(300);
const t3 = await texts();
check('같은 상자의 제목 → 본문을 눌러도 제목 글이 그대로 (DQ-002)', t3[3] === '제목 글자', JSON.stringify(t3.slice(3)));
// 표 고치기 (DQ-005): 칸 누르기 → 입력 → Tab 다음 칸 → 마지막 칸 Enter = 행 추가 · 머리글 이름 · 실행 취소
await page.keyboard.press('Escape');
await ws(() => { const e = window.__dn.view.engine; e.transact((tx) => { const b = tx.createBlock({ x: 0, y: 700, w: 420, h: 120 }); tx.createContent({ blockId: b, type: 'table', title: '', columns: [{ id: 'c1', name: '이름' }, { id: 'c2', name: '값' }], rows: [{ id: 'r1', order: 'a0', cells: {} }] }); }, { origin: 'user' }); });
await wait(500);
const cellText = () => ws(() => { const t = [...window.__dn.view.engine.contents()].find((c) => c.type === 'table'); return { rows: t.rows.length, cols: t.columns.map((c) => c.name), cells: t.rows.map((r) => t.columns.map((c) => (r.cells[c.id]?.content ?? []).map((n) => (n.content ?? []).map((x) => x.text).join('')).join(''))) }; });
await page.locator('.dn-doc .dn-table td[data-row="r1"][data-col="c1"]').click();
await wait(300);
await page.keyboard.type('사과');
await page.keyboard.press('Tab');
await wait(200);
await page.keyboard.type('3');
await page.keyboard.press('Enter');
await wait(300);
await page.keyboard.type('배');
await wait(300);
const tb = await cellText();
check('문서에서 표 칸 고치기 · Tab 다음 칸 · 마지막 칸 Enter = 새 행', tb.rows === 2 && tb.cells.flat().includes('사과') && tb.cells.flat().includes('3') && tb.cells.flat().includes('배'), JSON.stringify(tb));
await page.keyboard.press('Escape');
await wait(200);
await page.locator('.dn-doc .dn-table th[data-col="c2"]').click();
await wait(200);
await page.keyboard.press('Control+a');
await page.keyboard.type('개수');
await page.keyboard.press('Enter');
await wait(300);
check('머리글을 눌러 열 이름 바꾸기', (await cellText()).cols.join() === '이름,개수');
await page.locator('.dn-doc .dn-table td').first().click();
await wait(300);
await page.locator('.dn-table-tools button', { hasText: '오른쪽에 열' }).click();
await wait(300);
check('표 도구: 오른쪽에 열 추가', (await cellText()).cols.length === 3);
await page.keyboard.press('Escape');
// 토글 화살표 한 번에 접기 (DQ-012)
await ws(() => { const e = window.__dn.view.engine; const p = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] }); e.transact((tx) => { const b = tx.createBlock({ x: 0, y: 900, w: 400, h: 80 }); tx.createContent({ blockId: b, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'toggle', attrs: { open: true }, content: [p('토글 요약'), p('토글 속 글')] }] } }); }, { origin: 'user' }); });
await wait(500);
const toggleOpen = () => ws(() => { const c = [...window.__dn.view.engine.contents()].find((x) => x.doc?.content?.[0]?.type === 'toggle'); return c.doc.content[0].attrs.open; });
await page.locator('.dn-doc .dn-toggle-btn').first().click();
await wait(300);
check('문서에서 토글 화살표 한 번 누르면 접힘 (DQ-012)', (await toggleOpen()) === false);
// 제목 Enter → Backspace 뒤에도 나뉜 글이 보임 (DQ-010)
await ws(() => { const e = window.__dn.view.engine; const p = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] }); e.transact((tx) => { const b = tx.createBlock({ x: 0, y: 1100, w: 400, h: 50 }); tx.createContent({ blockId: b, type: 'text', role: 'title', doc: { type: 'doc', content: [p('제목가나다라')] } }); }, { origin: 'user' }); });
await wait(500);
const ti = (await texts()).indexOf('제목가나다라');
await clickAt(ti, 4);
await page.keyboard.press('Home');
for (let i = 0; i < 3; i++) { await page.keyboard.press('ArrowRight'); await wait(60); } // 화살표는 브라우저가 옮기고 편집기가 조금 뒤에 읽는다 — 사람 속도로
await page.keyboard.press('Enter');
await wait(300);
await page.keyboard.press('Backspace');
await wait(300);
const t10 = (await texts()).slice(ti, ti + 2);
check('제목에서 나눈 뒤 Backspace — 나뉜 글이 화면에 그대로 (DQ-010)', t10.every(Boolean) && t10.join('') === '제목가나다라', JSON.stringify(t10));
await page.keyboard.press('Escape');
// 편집 잠금이면 서식 막대 숨김 (DQ-014)
await ws(() => window.__dn.setNotePage({ editLock: true }));
await wait(400);
check('편집 잠금 중에는 서식 막대가 숨음 (DQ-014)', (await page.locator('.doc-ribbon').count()) === 0);
await ws(() => window.__dn.setNotePage({ editLock: false }));
// 서식 막대 "표" → 크기 고르기 → 고친 칸 아래에 그 크기 표
await clickAt(0);
const nt0 = await ws(() => [...window.__dn.view.engine.contents()].filter((c) => c.type === 'table').length);
await page.locator('.doc-ribbon button[aria-label^="표 넣기"]').click();
await page.waitForSelector('.dn-table-picker');
await page.locator('.dn-tp-cell[data-c="2"][data-r="4"]').click();
await wait(400);
const nt = await ws(() => { const t = [...window.__dn.view.engine.contents()].filter((c) => c.type === 'table'); return [t.length, t.at(-1).columns.length, t.at(-1).rows.length]; });
check('문서 서식 막대 표 → 2 × 4 고르면 2열 · 머리글 + 3행 표', nt[0] === nt0 + 1 && nt[1] === 2 && nt[2] === 3, JSON.stringify(nt));
await page.keyboard.press('Escape');
// 쪽 보기: 한 쪽보다 긴 글 상자도 줄이 여백 · 쪽 사이 틈에 걸리지 않음 (DQ-015)
await ws(() => { const e = window.__dn.view.engine; const p = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] }); e.transact((tx) => { const b = tx.createBlock({ x: 0, y: 1300, w: 400, h: 2000 }); tx.createContent({ blockId: b, type: 'text', role: 'body', doc: { type: 'doc', content: Array.from({ length: 90 }, (_, i) => p(`긴 글 ${i + 1}째 줄`)) } }); }, { origin: 'user' }); });
await wait(1200);
const bad = await ws(() => {
  const page = document.querySelector('.dn-doc-sheet')?.parentElement;
  const top0 = page.getBoundingClientRect().top, STEP = 1123 + 24;
  const out = [];
  for (const p of document.querySelectorAll('.dn-doc .dn-doc-text p')) {
    const r = p.getBoundingClientRect(), t = r.top - top0, b = r.bottom - top0, k = Math.floor(t / STEP);
    if (t < k * STEP + 96 - 1 || b > k * STEP + 1123 - 96 + 1) out.push(`${p.textContent}@${Math.round(t)}`);
  }
  return { pages: document.querySelectorAll('.dn-doc-sheet').length, out: out.slice(0, 5), n: out.length };
});
check('긴 글도 줄 단위로 다음 쪽에 — 여백 · 틈에 걸린 줄 없음 (DQ-015)', bad.n === 0 && bad.pages >= 3, JSON.stringify(bad));
// 쪽 보기: 쪽을 넘는 긴 표는 행 단위로 끊기고, 칸(테두리)이 여백 · 쪽 사이 틈을 가로지르지 않음 — 세로로 합친 칸은 통째로 (DQ-029)
await ws(() => {
  const e = window.__dn.view.engine;
  const cols = [{ id: 'c1', name: '항목' }, { id: 'c2', name: '값' }];
  const cell = (t) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });
  const rows = Array.from({ length: 70 }, (_, i) => ({ id: `r${i}`, order: `a${String(i).padStart(3, '0')}`, cells: { c1: cell(`행 ${i + 1}`), c2: cell(String(i * 3)) } }));
  // 둘째 표: 3행마다 첫 열을 세로로 합침
  const merges = Array.from({ length: 20 }, (_, k) => ({ r0: `mr${k * 3}`, c0: 'c1', r1: `mr${k * 3 + 2}`, c1: 'c1' }));
  e.transact((tx) => {
    const top = Math.max(...[...e.blocks()].map((b) => b.y + b.h)) + 16;
    const a = tx.createBlock({ x: 0, y: top, w: 400, h: 2100 });
    tx.createContent({ blockId: a, type: 'table', columns: cols, rows });
    const b = tx.createBlock({ x: 0, y: top + 2120, w: 400, h: 1900 });
    tx.createContent({ blockId: b, type: 'table', columns: cols, rows: rows.slice(0, 60).map((r) => ({ ...r, id: `m${r.id}` })), merges });
  }, { origin: 'user' });
});
await wait(1500);
const tbl = await ws(() => {
  const page = document.querySelector('.dn-doc-sheet')?.parentElement;
  const top0 = page.getBoundingClientRect().top, STEP = 1123 + 24;
  const cut = [];
  for (const td of document.querySelectorAll('.dn-doc .dn-table td:not(.dn-page-gap), .dn-doc .dn-table th')) {
    const r = td.getBoundingClientRect(), t = r.top - top0 + 1, b = r.bottom - top0 - 1, k = Math.floor(t / STEP);
    if (t < k * STEP + 96 - 2 || b > k * STEP + 1123 - 96 + 2) cut.push(`${td.textContent}@${Math.round(t)}-${Math.round(b)}`);
  }
  return { tables: document.querySelectorAll('.dn-doc .dn-table').length, gaps: document.querySelectorAll('.dn-doc tr[data-dn-spacer]').length, cut: cut.slice(0, 5), n: cut.length };
});
check('긴 표: 행 단위로 다음 쪽에 — 여백 · 틈을 가로지르는 칸 없음 · 합친 칸도 (DQ-029)', tbl.n === 0 && tbl.gaps >= 2, JSON.stringify(tbl));
if (OUT) { await page.locator('.dn-doc tr[data-dn-spacer]').first().scrollIntoViewIfNeeded(); await page.screenshot({ path: `${OUT}/doc-table-page-break.png` }); }
check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
