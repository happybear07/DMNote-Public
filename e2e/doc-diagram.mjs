// 문서에서 도식 그림으로 (워드 SmartArt 자리 · GAP-PLAN 24): 묶음(블록) 메뉴 › 문서에서 '도식 그림으로' →
// 문서 뷰에 상자 · 화살표가 캔버스 모양 그대로 그림 한 장(묶음 이름 아래), 묶음 상자 글 항목은 빠짐, 캔버스를 고치면 그림도 다시,
// 그림 오른쪽 클릭 → 묶음 메뉴에서 '글로' 되돌리기, 두 번 누르면 캔버스로, HTML · 워드로 내보내도 그림.
// 사용: dev 서버 실행 후 `node e2e/doc-diagram.mjs [스크린샷 폴더]`
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { fsPath } from './lib/fs-path.mjs';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2];
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const browser = await chromium.launch({ channel: process.env.DN_CHANNEL ?? 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
await ctx.addInitScript(() => { localStorage.setItem('dn:no-env-key', '1'); localStorage.removeItem('dn:export-format'); });
const page = await ctx.newPage();
// 내려받기 때 Edge가 여는 빈 탭이 닫히며 나는 오류는 시험과 무관 (docx-export.mjs와 같게)
process.on('unhandledRejection', (e) => { if (e?.name !== 'TargetClosedError') throw e; });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });
const ws = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);

await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(() => window.__dn.newNote({ sheet: null }));
await page.waitForFunction(() => window.__dn.view.engine.blockCount === 0);
const ids = await ws(() => {
  const e = window.__dn.view.engine;
  const r = e.transact((tx) => {
    const mk = (x, y, text, group) => { const b = tx.createBlock({ x, y, w: 160, h: 50, ...(group ? { group } : {}) }); tx.createContent({ blockId: b, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } }); return b; };
    const intro = mk(0, 0, '도식 앞 문단');
    const a = mk(0, 120, '입력', 'g1'), b = mk(240, 120, '처리', 'g1'), c = mk(480, 120, '출력', 'g1');
    tx.createArrow({ from: { blockId: a, side: 'auto' }, to: { blockId: b, side: 'auto' } });
    tx.createArrow({ from: { blockId: b, side: 'auto' }, to: { blockId: c, side: 'auto' }, label: '결과' });
    const after = mk(0, 300, '도식 뒤 문단');
    return { intro, a, b, c, after };
  }, { origin: 'user' }).value;
  e.transact((tx) => tx.setNote({ groups: { g1: { name: '처리 흐름' } } }), { origin: 'user' });
  return r;
});
await ws(() => window.__dn.setViewMode('doc'));
await wait(600);
const state = () => ws((ids) => {
  const fig = document.querySelector('.doc-scroll .dn-doc-diagram');
  const order = [...document.querySelectorAll('.doc-scroll .dn-doc-page > .dn-doc-item, .doc-scroll .dn-doc-page > .dn-doc-row')].map((el) => el.classList.contains('dn-doc-diagram') ? 'FIG' : el.textContent.trim().slice(0, 8));
  return { fig: !!fig, src: fig?.querySelector('img')?.getAttribute('src') ?? null, w: fig?.querySelector('img')?.naturalWidth ?? 0, cap: fig?.querySelector('figcaption')?.textContent ?? null, members: [ids.a, ids.b, ids.c].filter((id) => document.querySelector(`.doc-scroll .dn-doc-item[data-id="${id}"]`)).length, order };
}, ids);
const s0 = await state();
check('처음엔 글로: 묶음 상자 셋이 글 항목', !s0.fig && s0.members === 3, JSON.stringify(s0));

// 묶음 메뉴(묶음 전체 고르기)에서 '도식 그림으로'
await ws((ids) => { const v = window.__dn.view; v.select([ids.a, ids.b, ids.c]); const r = document.querySelector(`.dn-doc-item[data-id="${ids.b}"]`).getBoundingClientRect(); v.onBlockMenu?.({ ids: [ids.a, ids.b, ids.c], x: r.left + 10, y: r.top + 10, doc: true }); }, ids);
await wait(300);
await page.locator('.menu[aria-label="블록 메뉴"] .menu-sub > button[aria-haspopup="menu"]', { hasText: '묶음' }).click(); // 묶음 ▸ 하위 메뉴
await page.locator('.menu button', { hasText: '도식 그림으로' }).click();
await page.waitForFunction(() => document.querySelector('.doc-scroll .dn-doc-diagram img')?.getAttribute('src'), null, { timeout: 8000 }).catch(() => {});
await wait(300);
const s1 = await state();
check('도식 그림으로: 묶음 자리에 그림 하나 · 묶음 이름 · 상자 글 항목은 빠짐', s1.fig && !!s1.src && s1.w > 400 && s1.cap === '처리 흐름' && s1.members === 0, JSON.stringify(s1));
check('차례: 앞 문단 → 그림 → 뒤 문단', JSON.stringify(s1.order) === JSON.stringify(['도식 앞 문단', 'FIG', '도식 뒤 문단']), JSON.stringify(s1.order));
if (OUT) await page.screenshot({ path: `${OUT}/doc-diagram.png` });

// 캔버스를 고치면 그림도 다시
await ws((id) => { const e = window.__dn.view.engine; const c = e.contentsOf(id)[0]; e.transact((tx) => tx.set('content', c.id, { doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '처리(바뀜)' }] }] } }), { origin: 'user' }); }, ids.b);
await page.waitForFunction((old) => { const s = document.querySelector('.doc-scroll .dn-doc-diagram img')?.getAttribute('src'); return s && s !== old; }, s1.src, { timeout: 8000 }).catch(() => {});
check('묶음 상자 글을 고치면 그림을 다시 그림', (await state()).src !== s1.src);

// HTML로 내보내기 → 그림이 data 주소로
await ws(() => window.__dn.printNote());
await wait(400);
await page.locator('.export-formats button', { hasText: 'HTML' }).click();
await wait(800);
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.locator('.export-go').click()]);
const html = readFileSync(await dl.path(), 'utf8');
check('HTML 내보내기: 도식 그림이 파일 안에(data:image/png)', /class="dn-doc-item dn-doc-diagram"[^>]*>\s*<img[^>]*src="data:image\/png/.test(html), html.match(/dn-doc-diagram[^>]{0,200}/)?.[0] ?? '없음');

// 워드: 그림 한 장 + 묶음 이름 캡션, 상자 글은 없음
const x = await ws(async ({ DOCX, UNZIP }) => {
  const { noteToDocx } = await import(DOCX), { unzip } = await import(UNZIP);
  const v = window.__dn.view;
  const bytes = await noteToDocx(v.engine, '도식', { title: false, colors: true, pageNumbers: false }, { noteTitle: () => null, file: async () => null, diagram: (ids) => v.exportPng({ ids, scale: 2, pad: 12 }) });
  const files = await unzip(bytes), doc = new TextDecoder().decode(files.find((f) => f.path === 'word/document.xml').data);
  return { drawings: (doc.match(/<w:drawing>/g) ?? []).length, media: files.filter((f) => f.path.startsWith('word/media/')).length, cap: doc.includes('처리 흐름'), member: doc.includes('입력') };
}, { DOCX: fsPath('apps/web/src/docx/docx-export.ts'), UNZIP: fsPath('apps/web/src/unzip.ts') });
check('워드: 도식 그림 한 장 · 묶음 이름 캡션 · 상자 글은 없음', x.drawings === 1 && x.media === 1 && x.cap && !x.member, JSON.stringify(x));

// 그림 오른쪽 클릭 → 묶음 메뉴 '글로'
await ws(() => window.__dn.setViewMode('canvas'));
await ws(() => window.__dn.setViewMode('doc'));
await wait(600);
await page.locator('.doc-scroll .dn-doc-diagram').click({ button: 'right' });
await wait(300);
const head = await page.locator('.menu .menu-head').first().innerText().catch(() => '');
await page.locator('.menu[aria-label="블록 메뉴"] .menu-sub > button[aria-haspopup="menu"]', { hasText: '묶음' }).click(); // 묶음 ▸ 하위 메뉴
await page.locator('.menu').getByRole('menuitemradio', { name: '글로', exact: true }).click(); // 'Mermaid 글로 복사'와 겹치지 않게
await wait(500);
const s2 = await state();
check("그림 오른쪽 클릭 → 묶음 메뉴 → '글로' 되돌리기", /처리 흐름/.test(head) && !s2.fig && s2.members === 3, JSON.stringify({ head, s2 }));
await page.keyboard.press('Escape'); // 묶음 메뉴는 여러 번 고르도록 열려 있다 — 닫으면 초점이 문서로
await wait(200);
await page.keyboard.press('Control+z');
await wait(600);
check('실행 취소 → 다시 그림', (await state()).fig);
// 두 번 누르면 캔버스로
await page.waitForFunction(() => document.querySelector('.doc-scroll .dn-doc-diagram img')?.getAttribute('src'), null, { timeout: 8000 }).catch(() => {});
await page.locator('.doc-scroll .dn-doc-diagram img').dblclick();
await wait(500);
check('그림을 두 번 누르면 캔버스로', (await ws(() => window.__dn.state.viewMode)) === 'canvas');

check('콘솔 오류 없음', errors.length === 0, errors.join(' | '));
await page.close();
await ctx.close();
await browser.close().catch(() => {});
const bad = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
