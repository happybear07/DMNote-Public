// 워드(.docx) 가져오기 (워드 빈칸 1 · 노션 "Word 가져오기"):
// 1) 진짜 워드로 만든 e2e/fixtures/word-sample.docx(만드는 법: make-word-sample.ps1) — 제목 · 목록 · 꾸밈 · 링크 · 각주 · 가운데 맞춤 ·
//    머리 행 표(세로로 합친 칸) · 대체 텍스트 그림 · 캡션 · 쪽 나눔이 노트로, 상자는 워드 차례대로 위에서 아래로 겹치지 않게.
// 2) 앱이 내보낸 docx를 다시 가져오기(왕복) — 글 · 표 · 수식 · 할 일이 돌아오는지.
// 사용: dev 서버 실행 후 `node e2e/docx-import.mjs`
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import { fsPath } from './lib/fs-path.mjs';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const SAMPLE = fileURLToPath(new URL('./fixtures/word-sample.docx', import.meta.url));
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
const dlg = page.locator('.import-dialog');

await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });

/** 가져온 노트를 열어 상자들을 문서 차례로 */
const openAndRead = (title) => ws(async (title) => {
  const w = window.__dn, n = w.state.notes.find((x) => x.title === title);
  if (!n) return null;
  await w.openById(n.id);
  await new Promise((r) => setTimeout(r, 700));
  const v = w.view, e = v.engine;
  const blocks = [...e.blocks()].sort((a, b) => a.y - b.y || a.x - b.x);
  const out = blocks.map((b) => {
    const c = e.contentsOf(b.id)[0];
    const el = v.mounted.get(b.id)?.el;
    return { id: b.id, y: b.y, h: b.h, drawn: el ? el.offsetHeight : 0, type: c?.type, doc: c?.doc, align: b.align, pageBreak: b.pageBreak, caption: b.caption, alt: c?.alt, hash: c?.attachment, columns: c?.columns?.map((x) => x.name), rows: c?.rows?.length, merges: c?.merges?.length ?? 0, noHeader: c?.noHeader };
  });
  return out;
}, title);
const has = (doc, pred) => { let ok = false; const walk = (n) => { if (pred(n)) ok = true; (n.content ?? []).forEach(walk); }; if (doc) walk(doc); return ok; };
const markOn = (doc, text, type, attr) => has(doc, (n) => n.type === 'text' && n.text?.includes(text) && n.marks?.some((m) => m.type === type && (!attr || Object.entries(attr).every(([k, v]) => m.attrs?.[k] === v))));

// ───── 1. 워드로 만든 문서 ─────
const chooser = page.waitForEvent('filechooser');
await ws(() => window.__dnPickImport(false));
await (await chooser).setFiles(SAMPLE);
await page.waitForSelector('.import-dialog', { timeout: 15000 });
check('가져오기 창: 워드 가져오기 · 노트 1개', (await dlg.locator('h2').innerText()).includes('워드') && (await dlg.locator('.import-stats b').first().innerText()) === '1', await dlg.locator('h2').innerText());
const warn = (await dlg.locator('.import-warn').allInnerTexts()).join(' ');
check('안내: 표 · 그림 · 각주 수', /표 1개/.test(warn) && /그림 1개/.test(warn) && /각주 1개/.test(warn), warn);
await dlg.locator('button.primary').click();
await page.waitForSelector('.import-dialog', { state: 'detached', timeout: 15000 });
await wait(500);
const A = await openAndRead('워드에서 만든 문서');
check('문서 제목 스타일 → 노트 제목', !!A, String(!!A));
const texts = A.filter((b) => b.type === 'text'), all = { type: 'doc', content: texts.flatMap((b) => b.doc.content) };
check('제목 1 · 제목 2', has(all, (n) => n.type === 'heading' && n.attrs.level === 1 && n.content?.[0]?.text === '첫째 장') && has(all, (n) => n.type === 'heading' && n.attrs.level === 2 && n.content?.[0]?.text === '표와 그림'));
check('굵게 · 기울임 · 빨강 · 링크', markOn(all, '굵게', 'strong') && markOn(all, '기울임', 'em') && markOn(all, '빨강', 'textColor', { color: '#ff0000' }) && markOn(all, '링크', 'link', { href: 'https://example.org/' }));
check('각주', has(all, (n) => n.type === 'footnote' && n.attrs.note === '워드 각주'));
check('글머리 목록(안쪽 단계까지) · 번호 목록', has(all, (n) => n.type === 'bullet_list' && has(n, (m) => m.type === 'bullet_list' && m !== n && has(m, (k) => k.text === '안쪽 글머리'))) && has(all, (n) => n.type === 'ordered_list' && n.content?.length === 2), JSON.stringify(all.content.filter((n) => /list/.test(n.type))).slice(0, 600));
check('인용 · 가운데 맞춤 상자', has(all, (n) => n.type === 'blockquote' && has(n, (m) => m.text === '인용 문단')) && A.some((b) => b.align === 'center' && has(b.doc, (n) => n.text === '가운데 문단')));
const tb = A.find((b) => b.type === 'table');
check('표: 머리 행 → 열 이름 · 행 2 · 세로로 합친 칸', !!tb && JSON.stringify(tb.columns) === '["이름","수량","비고"]' && tb.rows === 2 && tb.merges === 1 && !tb.noHeader, JSON.stringify(tb && { c: tb.columns, r: tb.rows, m: tb.merges }));
const im = A.find((b) => b.type === 'image');
check('그림: 첨부 · 대체 텍스트 · 캡션', !!im?.hash && im.alt === '파란 사각형' && im.caption === '파란 사각형', JSON.stringify(im && { alt: im.alt, cap: im.caption, hash: !!im.hash }));
check('쪽 나눔 → 다음 상자 새 쪽', A.some((b) => b.pageBreak && has(b.doc, (n) => n.text === '둘째 쪽 글')));
check('차례: 글 → 표 → 그림 → 글', JSON.stringify(A.map((b) => b.type).filter((t, i, a) => t !== a[i - 1])) === '["text","table","image","text"]', JSON.stringify(A.map((b) => [b.type, JSON.stringify(b.doc ?? '').slice(0, 80)])));
const overlap = A.slice(1).filter((b, i) => b.y < A[i].y + Math.max(A[i].h, A[i].drawn) - 1).length;
check('상자가 겹치지 않음 (그려진 높이로)', overlap === 0, JSON.stringify(A.map((b) => [b.type, b.y, b.h, b.drawn])));

// ───── 2. 앱이 내보낸 docx를 다시 가져오기 ─────
await ws(() => window.__dn.newNote({ sheet: null }));
await page.waitForFunction(() => window.__dn.view.engine.blockCount === 0);
await ws(async (DOCX) => {
  const w = window.__dn, e = w.view.engine;
  const t = (text, marks) => ({ type: 'text', text, ...(marks ? { marks } : {}) });
  const p = (...content) => ({ type: 'paragraph', content });
  const cell = (s) => ({ type: 'doc', content: [p(t(s))] });
  e.transact((tx) => {
    const b = tx.createBlock({ x: 0, y: 0, w: 600, h: 60 });
    tx.createContent({ blockId: b, type: 'text', role: 'body', doc: { type: 'doc', content: [
      { type: 'heading', attrs: { level: 3 }, content: [t('왕복 제목')] },
      p(t('밑줄', [{ type: 'underline' }]), t(' 수식 '), { type: 'math_inline', attrs: { tex: 'a^2+b^2' } }),
      { type: 'task_list', content: [{ type: 'task_item', attrs: { checked: true }, content: [p(t('한 일'))] }, { type: 'task_item', attrs: { checked: false }, content: [p(t('할 일'))] }] },
      { type: 'code_block', attrs: { language: '' }, content: [t('x = 1\ny = 2')] },
    ] } });
    const tb = tx.createBlock({ x: 0, y: 200, w: 400, h: 100 });
    tx.createContent({ blockId: tb, type: 'table', columns: [{ id: 'a', name: '가' }, { id: 'b', name: '나' }], rows: [{ id: 'r1', order: 'a0', cells: { a: cell('1'), b: cell('2') } }, { id: 'r2', order: 'a1', cells: { a: cell('3'), b: cell('4') } }], merges: [{ r0: 'r1', c0: 'a', r1: 'r1', c1: 'b' }] });
  }, { origin: 'user' });
  const { noteToDocx } = await import(DOCX);
  const bytes = await noteToDocx(e, '왕복 문서', { title: true, colors: true, pageNumbers: true }, { noteTitle: () => null, file: async () => null });
  await w.prepareImport([new File([bytes], '왕복 문서.docx')]);
}, fsPath('apps/web/src/docx/docx-export.ts'));
await page.waitForSelector('.import-dialog', { timeout: 15000 });
await dlg.locator('button.primary').click();
await page.waitForSelector('.import-dialog', { state: 'detached', timeout: 15000 });
await wait(500);
const B = await ws(() => window.__dn.state.notes.filter((n) => n.title === '왕복 문서').length);
check('왕복: 가져온 노트 (제목은 문서 제목)', B === 1, String(B));
const R = await ws(async () => {
  const w = window.__dn, n = w.state.notes.filter((x) => x.title === '왕복 문서').sort((a, b) => b.createdAt - a.createdAt)[0];
  await w.openById(n.id);
  await new Promise((r) => setTimeout(r, 600));
  return [...w.view.engine.blocks()].sort((a, b) => a.y - b.y).map((b) => w.view.engine.contentsOf(b.id)[0]);
});
const rt = { type: 'doc', content: R.filter((c) => c.type === 'text').flatMap((c) => c.doc.content) };
check('왕복: 제목 3 · 밑줄 · 수식 · 할 일(체크) · 코드', has(rt, (n) => n.type === 'heading' && n.attrs.level === 3) && markOn(rt, '밑줄', 'underline') && has(rt, (n) => n.type === 'math_inline' && n.attrs.tex === 'a^2+b^2') && has(rt, (n) => n.type === 'task_item' && n.attrs.checked === true) && has(rt, (n) => n.type === 'task_item' && n.attrs.checked === false) && has(rt, (n) => n.type === 'code_block' && n.content?.[0]?.text === 'x = 1\ny = 2'), JSON.stringify(rt).slice(0, 300));
const rtt = R.find((c) => c.type === 'table');
check('왕복: 표 열 이름 · 가로로 합친 칸', !!rtt && rtt.columns.map((c) => c.name).join() === '가,나' && rtt.rows.length === 2 && rtt.merges?.length === 1, JSON.stringify(rtt && { c: rtt.columns.map((c) => c.name), m: rtt.merges }));

check('콘솔 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close();
const bad = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
