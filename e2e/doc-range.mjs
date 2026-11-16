// 문서 뷰 여러 칸 글자 범위 — Fable 검토 버그(docs/review/DOC-EDIT-BUGS.md) 회귀:
// DE-001 정적 DOM ↔ 문서 위치 왕복(모든 노드 종류, 콜아웃 아이콘 같은 장식은 세지 않음) · 콜아웃 칸 범위 지우기
// DE-002 범위를 고른 채 다시 그려져도(실행 취소 · 다른 블록 높이 변경) 범위가 번지지 않음
// DE-003 · 004 표 칸 · DE-008 범위에서 글자 = 실행 취소 한 번 · DE-009 Enter = 지우고 줄 나누기 · DE-010 초점 밖 잘라내기 · DE-012 블록 붙여넣기
// 사용: dev 서버 실행 후 `node e2e/doc-range.mjs [스크린샷 폴더]`
import { chromium } from 'playwright-core';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2] ?? '.';
const ROOT = new URL('..', import.meta.url).pathname; // /C:/…/DamianNote/ — Vite /@fs로 모듈을 직접 불러 왕복 검사
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
const seed = (spec) => ws((spec) => {
  const e = window.__dn.view.engine;
  e.transact((tx) => { for (const b of [...e.blocks()]) { for (const c of e.contentsOf(b.id)) tx.delete('content', c.id); tx.delete('block', b.id); } for (const a of [...e.arrows()]) tx.delete('arrow', a.id); }, { origin: 'user' });
  const ids = [];
  e.transact((tx) => { for (const s of spec) { const b = tx.createBlock({ x: 0, y: s.y, w: 400, h: s.h ?? 50 }); ids.push(b); tx.createContent({ blockId: b, type: 'text', role: 'body', doc: s.doc }); } }, { origin: 'user' });
  return ids;
}, spec);
const T = (t, marks) => ({ type: 'text', text: t, ...(marks ? { marks } : {}) });
const P = (...c) => ({ type: 'paragraph', content: c.map((x) => (typeof x === 'string' ? T(x) : x)) });
const D = (...c) => ({ type: 'doc', content: c });
const CALLOUT = (...c) => ({ type: 'callout', attrs: { icon: 'bulb', color: 'yellow' }, content: c });
await ws(() => window.__dn.setViewMode('doc'));
await wait(500);
const texts = () => ws(() => [...document.querySelectorAll('.dn-doc .dn-doc-text')].map((el) => el.textContent.trim()));
const selText = () => ws(() => getSelection().toString().replace(/\s+/g, ''));
const charPt = (i, k) => ws(([i, k]) => {
  const el = document.querySelectorAll('.dn-doc .dn-doc-text')[i];
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let n, left = k;
  while ((n = w.nextNode())) { if (n.parentElement.closest('[contenteditable="false"]')) continue; if (left <= n.data.length) { const r = document.createRange(); r.setStart(n, left); r.setEnd(n, left); const b = r.getBoundingClientRect(); return { x: b.left + 0.5, y: b.top + b.height / 2 }; } left -= n.data.length; }
  return null;
}, [i, k]);
const drag = async (a, b) => { await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(a.x + 6, a.y, { steps: 2 }); await page.mouse.move(b.x, b.y, { steps: 10 }); await page.mouse.up(); await wait(150); };
const esc = async () => { await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await wait(100); };

// 1. DE-001 왕복: 모든 노드 종류가 든 칸에서 글자 자리마다 문서 위치 → 화면 지점 → 문서 위치가 같고, 그 자리 글자도 같다
await seed([{ y: 0, h: 600, doc: D(
  { type: 'heading', attrs: { level: 1 }, content: [T('제목줄')] },
  P(T('굵게', [{ type: 'strong' }]), ' 보통 ', { type: 'math_inline', attrs: { tex: 'x^2' } }, ' 수식 뒤', { type: 'hard_break' }, '줄바꿈 뒤'),
  P('날짜 ', { type: 'date_mention', attrs: { date: '2026-10-07' } }, ' 링크 ', { type: 'note_link', attrs: { id: 'nope', title: '없는 노트' } }, ' 끝'),
  { type: 'bullet_list', content: [{ type: 'list_item', content: [P('목록 하나'), { type: 'bullet_list', content: [{ type: 'list_item', content: [P('속 목록')] }] }] }] },
  { type: 'task_list', content: [{ type: 'task_item', attrs: { checked: true }, content: [P('할 일')] }] },
  CALLOUT(P('콜아웃 글')),
  P('콜아웃 뒤'),
  { type: 'toggle', attrs: { open: true }, content: [P('토글 요약'), P('토글 속')] },
  { type: 'blockquote', content: [P('인용 글')] },
  { type: 'code_block', attrs: { language: 'js' }, content: [T('const a = 1;')] },
  { type: 'horizontal_rule' },
  { type: 'math_block', attrs: { tex: 'a+b' } },
  P('맨 끝 문단'),
) }]);
await wait(500);
const rt = await ws(async (root) => {
  const cross = await import(`/@fs${root}packages/text-pm/src/cross.ts`);
  const codec = await import(`/@fs${root}packages/text-pm/src/codec.ts`);
  const el = document.querySelector('.dn-doc .dn-doc-text[data-part]');
  const doc = window.__dn.view.engine.getContent(el.dataset.part).doc, node = codec.toNode(doc);
  const skip = (x) => (x.nodeType === 3 ? x.parentElement : x).closest('[contenteditable="false"]');
  const charAfter = (n, off) => {
    if (n.nodeType === 3 && off < n.data.length) return n.data[off];
    const r = document.createRange(); r.setStart(n, off); r.setEnd(el, el.childNodes.length);
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let t;
    while ((t = w.nextNode())) { if (skip(t)) continue; if (t.data.length && r.comparePoint(t, 0) >= 0) return t.data[0]; }
    return '';
  };
  const bad = [];
  let n = 0;
  node.descendants((c, p) => {
    if (!c.isText) return true;
    for (let k = 0; k < c.text.length; k++) {
      n++;
      const u = cross.unitsAtPos(doc, p + k), pt = cross.domAtUnits(el, u);
      const back = cross.posAtUnits(doc, cross.unitsAtDom(el, pt.node, pt.offset));
      if (charAfter(pt.node, pt.offset) !== c.text[k] || back !== p + k) bad.push(`${c.text}[${k}] u=${u} back=${back}≠${p + k}`);
    }
    return false;
  });
  return { n, bad: bad.slice(0, 5), nbad: bad.length };
}, ROOT);
check('왕복: 모든 노드 종류(콜아웃 · 토글 · 수식 · 날짜 · 링크 · 할 일 · 코드 …)에서 글자 자리가 모두 맞음', rt.n > 80 && rt.nbad === 0, `${rt.n}자리 중 ${rt.nbad} 어긋남 ${rt.bad.join(' | ')}`);

// 2. DE-001: 콜아웃이 든 끝 칸까지 끌어 지우기 → 고르지 않은 글자는 남음
await seed([{ y: 0, doc: D(P('가나다라')) }, { y: 200, h: 120, doc: D(CALLOUT(P('콜')), P('마바사아')) }]);
await wait(500);
await drag(await charPt(0, 2), await charPt(1, 3)); // '가나|다라' ~ '콜' + '마바|사아'
check('콜아웃 칸까지 끌어 고름 → "다라 콜 마바"', (await selText()) === '다라콜마바', await selText());
await page.keyboard.press('Backspace');
await wait(400);
check('Backspace → "가나사아" (고르지 않은 "사"가 남음)', JSON.stringify(await texts()) === '["가나사아"]', JSON.stringify(await texts()));
await esc();
// 고치던 칸에 콜아웃이 있을 때 Shift+누르기 범위가 커서 자리에서 시작
await seed([{ y: 0, h: 120, doc: D(CALLOUT(P('콜')), P('가나다라')) }, { y: 200, doc: D(P('마바사아')) }]);
await wait(500);
const s0 = await charPt(0, 3), s1 = await charPt(1, 2);
await page.mouse.click(s0.x, s0.y); await wait(200);
await page.keyboard.down('Shift'); await page.mouse.click(s1.x, s1.y); await page.keyboard.up('Shift');
await wait(200);
check('콜아웃 칸 "가나|"에서 Shift+누르기 → 범위가 "다라"부터', (await selText()) === '다라마바', await selText());
await page.keyboard.press('Backspace');
await wait(400);
check('Backspace → "콜가나" + "사아"', JSON.stringify(await texts()) === '["콜가나사아"]', JSON.stringify(await texts()));
await esc();

// 3. DE-002: 범위를 고른 채 실행 취소로 다시 그려져도 범위가 그대로
await ws(() => window.__dn.setDocPages(false));
await seed([{ y: 0, doc: D(P('가 문단')) }, { y: 100, doc: D(P('나 문단')) }, { y: 200, doc: D(P('다 문단')) }]);
await wait(400);
const q = await charPt(1, 1);
await page.mouse.click(q.x, q.y); await wait(150);
await page.keyboard.type('Q'); await wait(150);
await esc();
await drag(await charPt(0, 2), await charPt(2, 2)); // '가 |문단' ~ '다 |문단'
await page.keyboard.press('Control+z'); await wait(300);
check('범위 → Ctrl+Z → 범위가 첫 칸 앞으로 번지지 않음', (await selText()) === '문단나문단다', await selText());
await page.keyboard.press('Backspace'); await wait(400);
check('그 뒤 Backspace → "가 문단" (첫 칸 앞부분이 남음)', JSON.stringify(await texts()) === '["가 문단"]', JSON.stringify(await texts()));
await esc();
// 다른 블록 높이가 바뀌어(캔버스 자동 높이) 다시 그려져도
const ids = await seed([{ y: 0, doc: D(P('가 문단')) }, { y: 100, doc: D(P('나 문단')) }, { y: 200, doc: D(P('다 문단')) }, { y: 300, doc: D(P('라 문단')) }]);
await wait(400);
await drag(await charPt(0, 2), await charPt(2, 2));
await ws((id) => { const e = window.__dn.view.engine; e.transact((tx) => tx.set('block', id, { h: e.getBlock(id).h + 1 }), { origin: 'layout' }); }, ids[3]);
await wait(300);
await page.keyboard.press('Backspace'); await wait(400);
check('범위 → 다른 블록 높이 변경으로 다시 그려짐 → Backspace → "가 문단" · "라 문단"', JSON.stringify(await texts()) === '["가 문단","라 문단"]', JSON.stringify(await texts()));
await esc();
// 범위의 칸이 다른 쪽(실행 취소 · 동기화)에서 지워지면 범위를 푼다 — 엉뚱한 곳을 지우지 않게
const ids2 = await seed([{ y: 0, doc: D(P('가 문단')) }, { y: 100, doc: D(P('나 문단')) }, { y: 200, doc: D(P('다 문단')) }]);
await wait(400);
await drag(await charPt(0, 2), await charPt(2, 2));
await ws((id) => { const e = window.__dn.view.engine; e.transact((tx) => { for (const c of e.contentsOf(id)) tx.delete('content', c.id); tx.delete('block', id); }, { origin: 'remote' }); }, ids2[2]);
await wait(300);
check('범위 끝 칸이 다른 쪽에서 지워지면 범위가 풀림', (await selText()) === '', await selText());
await page.keyboard.press('Backspace'); await wait(300);
check('그 뒤 Backspace는 아무것도 지우지 않음', JSON.stringify(await texts()) === '["가 문단","나 문단"]', JSON.stringify(await texts()));
await ws(() => window.__dn.setDocPages(true));

// 4. DE-003 · DE-004 표 칸: 칸 안 선택은 칸 편집기 몫, 안 바꾸고 닫아도 칸 글이 보이고 다시 열린다
const seedTable = () => ws(() => {
  const e = window.__dn.view.engine;
  e.transact((tx) => { for (const b of [...e.blocks()]) { for (const c of e.contentsOf(b.id)) tx.delete('content', c.id); tx.delete('block', b.id); } }, { origin: 'user' });
  const cell = (t) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });
  e.transact((tx) => {
    const a = tx.createBlock({ x: 0, y: 0, w: 400, h: 50 }); tx.createContent({ blockId: a, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '표 위 문단' }] }] } });
    const t = tx.createBlock({ x: 0, y: 100, w: 400, h: 120 });
    tx.createContent({ blockId: t, type: 'table', title: '', columns: [{ id: 'c1', name: '이름' }, { id: 'c2', name: '값' }], rows: [{ id: 'r1', order: 'a0', cells: { c1: cell('사과'), c2: cell('3') } }] });
  }, { origin: 'user' });
});
const cellText = () => ws(() => { const t = [...window.__dn.view.engine.contents()].find((c) => c.type === 'table'); return (t.rows[0].cells.c1?.content ?? []).map((n) => (n.content ?? []).map((x) => x.text).join('')).join(''); });
const td = () => page.locator('.dn-doc .dn-table td[data-row="r1"][data-col="c1"]');
const openCell = async () => { await td().click(); await wait(300); await page.keyboard.press('End'); await wait(100); };
await seedTable();
await wait(500);
await openCell();
await page.keyboard.press('Shift+Home'); await wait(100);
await page.keyboard.type('x'); await wait(300);
check('표 칸 글을 고른 채 x 입력 → 칸이 "x"', (await cellText()) === 'x', await cellText());
await page.keyboard.press('Shift+Home'); await wait(100);
await page.keyboard.press('Delete'); await wait(300);
check('표 칸 글을 고른 채 Delete → 칸이 빔', (await cellText()) === '', await cellText());
await page.keyboard.type('사과'); await wait(200);
await page.keyboard.press('Escape'); await wait(300);
check('Esc 한 번에 칸 편집이 닫힘', (await page.locator('.dn-doc td.dn-cell-editing').count()) === 0);
await openCell();
await page.keyboard.press('Escape'); await wait(300);
check('표 칸을 열었다 안 바꾸고 Esc → 칸 글이 그대로 보임', (await td().innerText()).trim() === '사과' && !(await td().getAttribute('class'))?.includes('dn-cell-editing'), `${JSON.stringify(await td().innerText())} ${await td().getAttribute('class')}`);
await openCell();
await page.keyboard.type('z'); await wait(300);
await page.keyboard.press('Escape'); await wait(300);
check('같은 칸을 다시 눌러 고칠 수 있음 → "사과z"', (await cellText()) === '사과z', await cellText());
// 캔버스의 표 칸도 같다 (같은 그리기 코드)
await ws(() => window.__dn.setViewMode('canvas'));
await wait(500);
const ctd = page.locator('.dn-block .dn-table td[data-row="r1"][data-col="c1"]');
await ctd.dblclick(); await wait(300);
await page.keyboard.press('Escape'); await wait(300);
check('캔버스: 표 칸 열었다 안 바꾸고 Esc → 칸 글이 그대로', (await ctd.innerText()).trim() === '사과z' && !(await ctd.getAttribute('class'))?.includes('dn-cell-editing'), `${JSON.stringify(await ctd.innerText())} ${await ctd.getAttribute('class')}`);
await ws(() => window.__dn.setViewMode('doc'));
await wait(500);

// 5. DE-008 · 009 · 010 · 012
const three = () => seed([{ y: 0, doc: D(P('가 문단')) }, { y: 100, doc: D(P('나 문단')) }, { y: 200, doc: D(P('다 문단')) }]);
const pick = async () => { await drag(await charPt(0, 2), await charPt(2, 2)); }; // '가 |문단' ~ '다 |문단'
await ws(() => window.__dn.setDocPages(false));
await three(); await wait(400);
await pick();
await page.keyboard.type('X'); await wait(300);
check('범위에서 X → "가 X문단"', JSON.stringify(await texts()) === '["가 X문단"]', JSON.stringify(await texts()));
await page.keyboard.press('Control+z'); await wait(400);
check('Ctrl+Z 한 번에 세 칸 모두 돌아옴 (지우기 + 입력이 한 번)', JSON.stringify(await texts()) === '["가 문단","나 문단","다 문단"]', JSON.stringify(await texts()));
await esc();
await three(); await wait(400);
await pick();
await page.keyboard.press('Enter'); await wait(300);
const paras = await ws(() => [...document.querySelectorAll('.dn-doc .dn-doc-text p')].map((p) => p.textContent));
check('범위에서 Enter → 지우고 그 자리에서 줄 나눔 ("가 " / "문단")', JSON.stringify(paras.map((x) => x.trim())) === '["가","문단"]', JSON.stringify(paras));
await esc();
await three(); await wait(400);
await pick();
await ws(() => document.querySelector('.dn-doc').blur());
await page.keyboard.press('Control+x'); await wait(300);
check('초점이 문서 뷰 밖이면 Ctrl+X가 범위를 지우지 않음 (Delete와 같게)', JSON.stringify(await texts()) === '["가 문단","나 문단","다 문단"]', JSON.stringify(await texts()));
await esc();
// 블록을 복사해 두고 글자 범위에 붙여넣기 → 범위를 지우고 그 자리 블록 아래에 블록
await three(); await wait(400);
const box2 = await page.locator('.dn-doc .dn-doc-text').nth(1).boundingBox();
await page.mouse.click(box2.x + 8, box2.y + box2.height / 2); await wait(150);
await page.keyboard.press('Escape'); await wait(150);
await page.keyboard.press('Control+c'); await wait(200);
await page.keyboard.press('Escape'); await wait(100);
const n0 = await ws(() => window.__dn.view.engine.blockCount);
await pick();
await page.keyboard.press('Control+v'); await wait(500);
check('블록 복사 → 글자 범위에 Ctrl+V → 범위를 지우고 블록이 붙음', JSON.stringify(await texts()) === '["가 문단","나 문단"]' && (await ws(() => window.__dn.view.engine.blockCount)) === n0 - 2 + 1, `${JSON.stringify(await texts())} 블록 ${n0} → ${await ws(() => window.__dn.view.engine.blockCount)}`);
await esc();
await ws(() => window.__dn.setDocPages(true));

await page.screenshot({ path: `${OUT}/doc-range.png` });
check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
