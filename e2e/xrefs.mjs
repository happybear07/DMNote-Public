// 상호 참조 (워드 삽입 › 상호 참조): /상호 참조 → 캡션 단 그림 · 표 목록 → 고르면 글 속 '그림 2',
// 차례가 바뀌거나 캡션을 지우면 번호가 따라감 (지우면 흐리게), 누르면 그 그림으로, 문서 뷰 · 서식 막대 단추 · Markdown 내보내기.
// 사용: dev 서버 실행 후 `node e2e/xrefs.mjs [스크린샷 폴더]`
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
const ids = await ws(async (CORE) => {
  const core = await import(CORE), v = window.__dn.view, e = v.engine;
  const chart = (tx, y, name) => { const b = tx.createBlock({ x: 0, y, w: 320, h: 200 }); tx.createContent({ blockId: b, type: 'chart', kind: 'bar', series: [{ id: 's', name, points: [{ x: 'a', y: 1 }, { x: 'b', y: 3 }] }] }); return b; };
  const r = e.transact((tx) => {
    const t = tx.createBlock({ x: 0, y: 0, w: 420, h: 60 });
    tx.createContent({ blockId: t, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'paragraph' }] } });
    return { t, a: chart(tx, 150, '가'), b: chart(tx, 450, '나') };
  }, { origin: 'user' }).value;
  core.setBlockCaption(e, r.a, '첫 그래프');
  core.setBlockCaption(e, r.b, '둘째 그래프');
  v.fit?.(true);
  return r;
}, CORE);
await wait(500);
const xrefText = () => ws((id) => { const a = window.__dn.view.mounted.get(id)?.el.querySelector('a.dn-xref'); return a ? { text: a.textContent, missing: a.classList.contains('missing') } : null; }, ids.t);

// /상호 참조 → 목록 → 둘째 고르기
await ws((id) => window.__dn.view.startEditing(id), ids.t);
await wait(200);
await page.keyboard.type('결과는 ');
await page.keyboard.type('/상호');
await wait(200);
check('슬래시 메뉴에 "상호 참조"', (await page.locator('.dn-slash .dn-slash-item.on').innerText()).includes('상호 참조'));
await page.keyboard.press('Enter');
await wait(200);
const rows = await page.locator('.dn-xref-menu .dn-slash-item').allInnerTexts();
check('고르기 판: 캡션 단 그림 둘 (문서 차례)', rows.length === 2 && rows[0].includes('그림 1') && rows[0].includes('첫 그래프') && rows[1].includes('그림 2'), JSON.stringify(rows));
if (OUT) await page.screenshot({ path: `${OUT}/xref-picker.png` });
await page.keyboard.press('ArrowDown');
await page.keyboard.press('Enter');
await wait(150);
await page.keyboard.type('를 보라');
await page.keyboard.press('Escape');
await wait(300);
const body = await ws((id) => window.__dn.view.engine.contentsOf(id)[0].doc, ids.t);
const node = body.content[0].content.find((n) => n.type === 'xref');
check('글 속에 상호 참조 노드 (그 그림 id · 그때 번호)', node?.attrs.id === ids.b && node?.attrs.label === '그림 2', JSON.stringify(body.content[0].content));
let x = await xrefText();
check('보이는 글자 "그림 2"', x?.text === '그림 2' && !x.missing, JSON.stringify(x));

// 차례가 바뀌면 번호도
await ws(async ({ CORE, b }) => { const core = await import(CORE); core.moveBlocks(window.__dn.view.engine, [b], 0, -800); }, { CORE, b: ids.b });
await wait(300);
x = await xrefText();
check('둘째 그래프를 맨 위로 옮기면 "그림 1"', x?.text === '그림 1', JSON.stringify(x));
// 캡션을 지우면 흐리게, 실행 취소로 돌아옴
await ws(async ({ CORE, b }) => { const core = await import(CORE); core.setBlockCaption(window.__dn.view.engine, b, ''); }, { CORE, b: ids.b });
await wait(300);
x = await xrefText();
check('가리키던 캡션을 지우면 흐리게 (넣을 때 번호)', x?.missing === true && x.text === '그림 2', JSON.stringify(x));
await ws(() => window.__dn.view.engine.undo());
await wait(300);
x = await xrefText();
check('실행 취소 → 다시 "그림 1"', x?.text === '그림 1' && !x.missing, JSON.stringify(x));

// 누르면 그 그림으로
await ws(() => window.__dn.view.select([]));
await page.locator(`.dn-block[data-id="${ids.t}"] a.dn-xref`).click();
await wait(500);
check('상호 참조를 누르면 그 그림을 고름', JSON.stringify(await ws(() => [...window.__dn.view.selBlocks])) === JSON.stringify([ids.b]));

// 문서 뷰
await ws(() => window.__dn.setViewMode('doc'));
await wait(600);
check('문서 뷰에도 "그림 1"', (await page.locator('.dn-doc a.dn-xref').innerText()) === '그림 1');
await page.locator('.dn-doc a.dn-xref').click();
await wait(300);
check('문서 뷰: 누르면 그 그림으로 (반짝)', await ws((id) => !!document.querySelector(`.dn-doc [data-id="${id}"].dn-doc-flash, .dn-doc .dn-doc-flash[data-block="${id}"]`) || [...document.querySelectorAll('.dn-doc-flash')].some((el) => el.textContent.includes('둘째 그래프')), ids.b));
// 서식 막대 단추
await page.locator('.dn-doc .dn-doc-text[data-part]').first().click();
await wait(250);
await page.locator('button[title^="상호 참조"]').click();
await wait(250);
check('서식 막대 "상호 참조" 단추 → 고르기 판', (await page.locator('.dn-xref-menu .dn-slash-item').count()) === 2);
if (OUT) await page.screenshot({ path: `${OUT}/xref-doc.png` });
await page.keyboard.press('Escape');
await wait(150);
check('Esc로 닫힘', (await page.locator('.dn-xref-menu').count()) === 0);

// Markdown
const md = await ws(async () => {
  const m = await import('/src/export.ts'), t = Date.now();
  return m.noteToMarkdown(window.__dn.view.engine, { id: 'n', title: '참조', createdAt: t, updatedAt: t }, { noteTitle: () => null });
});
check('Markdown: 지금 번호로 "결과는 그림 1를 보라"', md.includes('결과는 그림 1를 보라'), md.slice(0, 300));
check('콘솔 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close();
const bad = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
