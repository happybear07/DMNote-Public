// 다단계 번호 (워드 '다단계 목록' · GAP-PLAN 23): 서식 막대 '1.1' 판 —
// 번호 목록 모양 1. · a. · i. ↔ 1. · 1.1. · 1.1.1.(안쪽 번호 목록도), 목록 밖이면 그 자리를 다단계 번호 목록으로,
// 제목 번호(노트 전체: 제목 상자 · 제목 1 = 1., 제목 2 = 1.1) — 문서 뷰 · 목차, 실행 취소, 캔버스에서도 목록 모양,
// 워드로 내보내면 워드 번호 매기기(다단계 · 제목 스타일에 묶인 번호), 다시 가져오면 그대로.
// 사용: dev 서버 실행 후 `node e2e/multilevel.mjs [저장 폴더]` — 폴더를 주면 multilevel.docx를 남긴다(워드로 열어 보기)
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
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

await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(() => window.__dn.newNote({ sheet: null }));
await page.waitForFunction(() => window.__dn.view.engine.blockCount === 0);
await ws(() => {
  const e = window.__dn.view.engine;
  const t = (text) => ({ type: 'text', text });
  const p = (s) => ({ type: 'paragraph', content: [t(s)] });
  const li = (s, sub) => ({ type: 'list_item', content: [p(s), ...(sub ? [sub] : [])] });
  e.transact((tx) => {
    const mk = (y, doc, role = 'body') => { const b = tx.createBlock({ x: 0, y, w: 560, h: 60 }); tx.createContent({ blockId: b, type: 'text', role, doc }); return b; };
    mk(0, { type: 'doc', content: [p('서론')] }, 'title');
    mk(80, { type: 'doc', content: [{ type: 'heading', attrs: { level: 2 }, content: [t('배경')] }, { type: 'ordered_list', attrs: { order: 1 }, content: [li('첫째', { type: 'ordered_list', attrs: { order: 1 }, content: [li('첫째의 하나'), li('첫째의 둘')] }), li('둘째')] }, p('목록 밖 문단')] });
    mk(320, { type: 'doc', content: [p('본론')] }, 'title');
    const toc = tx.createBlock({ x: 0, y: 400, w: 400, h: 120 });
    tx.createContent({ blockId: toc, type: 'toc' });
  }, { origin: 'user' });
});
await ws(() => window.__dn.setViewMode('doc'));
await wait(700);
const lists = () => ws(() => { const out = []; for (const c of window.__dn.view.engine.contents()) { const walk = (n, d) => { if (n.type === 'ordered_list') out.push([d, n.attrs?.nums ?? '']); (n.content ?? []).forEach((k) => walk(k, n.type === 'ordered_list' ? d + 1 : d)); }; if (c.doc) walk(c.doc, 0); } return out; });
const pop = async (label) => {
  await page.locator('.doc-ribbon button[aria-label^="다단계 번호"]').click();
  await wait(150);
  await page.locator('.rb-pop-panel button', { hasText: label }).click();
  await wait(300);
};
const clickText = async (text) => { const b = await page.locator('.dn-doc li p, .dn-doc p', { hasText: text }).first().boundingBox(); await page.mouse.click(b.x + b.width - 4, b.y + b.height / 2); await wait(250); };

// 번호 목록 안 (안쪽 항목)에서 다단계로
await clickText('첫째의 하나');
await pop('1.1.1.');
check('안쪽 항목에서 다단계 → 바깥 번호 목록에 모양 (안쪽은 따른다)', JSON.stringify(await lists()) === '[[0,"outline"],[1,""]]', JSON.stringify(await lists()));
const css = await ws(() => { const inner = document.querySelector('.dn-doc ol[data-nums="outline"] ol > li'); const s = inner && getComputedStyle(inner, '::before'); return inner ? { ls: getComputedStyle(inner.parentElement).listStyleType, content: s.content } : null; });
check('문서 뷰: 안쪽 번호도 1.1. 모양 (CSS 카운터)', css?.ls === 'none' && /counters\(dn-ol/.test(css.content), JSON.stringify(css));
if (OUT) await page.screenshot({ path: `${OUT}/multilevel-list.png` });
// 다시 기본으로
await clickText('둘째');
await pop('a.  i.');
check('기본 모양으로 되돌리기', JSON.stringify(await lists()) === '[[0,""],[1,""]]', JSON.stringify(await lists()));
// 목록 밖 문단에서 다단계 → 그 자리가 다단계 번호 목록
await clickText('목록 밖 문단');
await pop('1.1.1.');
const l3 = await lists();
check('목록 밖 문단 → 다단계 번호 목록으로 감싼다', l3.length === 3 && l3[2][1] === 'outline', JSON.stringify(l3));
await page.keyboard.press('Control+z');
await wait(300);
check('실행 취소 한 번 → 감싸기 전으로', (await lists()).length === 2, JSON.stringify(await lists()));

// 제목 번호
await pop('제목에 번호');
await wait(300);
const h = await ws(() => {
  const root = document.querySelector('.doc-scroll .dn-doc'), title = document.querySelector('.dn-doc .dn-doc-title p'), h2 = [...document.querySelectorAll('.dn-doc h2')].find((x) => x.textContent === '배경');
  return { on: root.classList.contains('dn-hnum'), flag: window.__dn.view.engine.note.headingNumbers, t: title && getComputedStyle(title, '::before').content, h2: h2 && getComputedStyle(h2, '::before').content, toc: [...document.querySelectorAll('.dn-doc .dn-toc-link')].map((a) => a.textContent) };
});
check('제목 번호 켜기: 노트 설정 · 문서 뷰 번호', h.on && h.flag === true && /counter\(dn-h1\)/.test(h.t) && /counter\(dn-h2\)/.test(h.h2), JSON.stringify(h));
check('목차에도 번호: 1. 서론 · 1.1 배경 · 2. 본론', JSON.stringify(h.toc) === '["1. 서론","1.1 배경","2. 본론"]', JSON.stringify(h.toc));
if (OUT) await page.screenshot({ path: `${OUT}/multilevel-headings.png` });
await ws(() => window.__dn.view.undo());
await wait(300);
check('실행 취소 → 제목 번호 꺼짐', !(await ws(() => document.querySelector('.doc-scroll .dn-doc').classList.contains('dn-hnum'))) && !(await ws(() => window.__dn.view.engine.note.headingNumbers)));
await ws(() => window.__dn.view.redo());
await clickText('첫째의 하나');
await pop('1.1.1.');

// 캔버스에서도 목록 모양
await ws(() => window.__dn.setViewMode('canvas'));
await wait(500);
check('캔버스 글에도 다단계 번호 목록', (await ws(() => !!document.querySelector('.dn-block ol[data-nums="outline"]'))));

// 워드로 내보내기 → 번호 매기기 · 다시 가져오기
const x = await ws(async ({ DOCX, UNZIP }) => {
  const { noteToDocx } = await import(DOCX);
  const { unzip } = await import(UNZIP);
  const bytes = await noteToDocx(window.__dn.view.engine, '다단계 문서', { title: false, colors: true, pageNumbers: false }, { noteTitle: () => null, file: async () => null });
  const files = Object.fromEntries((await unzip(bytes)).map((f) => [f.path, new TextDecoder().decode(f.data)]));
  const doc = files['word/document.xml'];
  const nums = [...doc.matchAll(/<w:numPr><w:ilvl w:val="(\d)"\/><w:numId w:val="(\d+)"\/><\/w:numPr><\/w:pPr><w:r><w:t xml:space="preserve">([^<]*)</g)].map((m) => [m[3], Number(m[1]), m[2]]);
  window.__docx = bytes;
  return { nums, outlineAbs: files['word/numbering.xml'].includes('<w:lvlText w:val="%1.%2."/>'), headAbs: files['word/numbering.xml'].includes('<w:pStyle w:val="Heading1"/>'), headStyle: /styleId="Heading2"[\s\S]*?<w:numPr><w:ilvl w:val="1"\/><w:numId w:val="99"\/>/.test(files['word/styles.xml']), b64: btoa(String.fromCharCode(...bytes)) };
}, { DOCX: fsPath('apps/web/src/docx/docx-export.ts'), UNZIP: fsPath('apps/web/src/unzip.ts') });
if (OUT) writeFileSync(`${OUT}/multilevel.docx`, Buffer.from(x.b64, 'base64'));
const same = x.nums.find((n) => n[0] === '첫째')?.[2] === x.nums.find((n) => n[0] === '첫째의 하나')?.[2];
check('워드: 다단계 번호 목록 — 안쪽 항목도 같은 번호 매기기(단계 1)', x.outlineAbs && same && x.nums.find((n) => n[0] === '첫째의 하나')?.[1] === 1, JSON.stringify(x.nums));
check('워드: 제목 스타일에 묶인 제목 번호', x.headAbs && x.headStyle, JSON.stringify({ headAbs: x.headAbs, headStyle: x.headStyle }));
await ws(async () => { await window.__dn.prepareImport([new File([window.__docx], '다단계 문서.docx')]); });
await page.waitForSelector('.import-dialog', { timeout: 15000 });
await page.locator('.import-dialog button.primary').click();
await page.waitForSelector('.import-dialog', { state: 'detached', timeout: 15000 });
await wait(400);
const back = await ws(async () => {
  const w = window.__dn, n = w.state.notes.find((x) => x.title === '다단계 문서');
  await w.openById(n.id);
  await new Promise((r) => setTimeout(r, 500));
  const e = w.view.engine, out = [];
  for (const c of e.contents()) { const walk = (k) => { if (k.type === 'ordered_list') out.push(k.attrs?.nums ?? ''); (k.content ?? []).forEach(walk); }; if (c.doc) walk(c.doc); }
  return { hn: !!e.note.headingNumbers, lists: out };
});
check('다시 가져오기: 제목 번호 · 다단계 번호 목록 그대로', back.hn && back.lists[0] === 'outline', JSON.stringify(back));

check('콘솔 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close();
const bad = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
