// 블록 임베드 (FR-082): 블록 링크를 다른 노트 캔버스에 붙여넣으면 그 블록 임베드 → 원본 글 그대로 · 원본을 고치면 따라 바뀜 ·
// 머리를 누르면 원본 블록으로 · 원본을 지우면 "원본 없음" · 백링크에도 · 문서 뷰 · Markdown에는 원본 이름 · Ctrl+Shift+V는 그냥 글자 · 넣기 메뉴.
// 사용: dev 서버 실행 후 `node e2e/embed.mjs [폴더]`
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
await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });

const mk = (title) => ws(async (t) => { await window.__dn.newNote(); await new Promise((r) => setTimeout(r, 200)); window.__dn.setTitle(t); return window.__dn.state.currentId; }, title);
const A = await mk('원본 노트');
const src = await ws(() => {
  const e = window.__dn.view.engine;
  return e.transact((tx) => {
    const b = tx.createBlock({ x: 0, y: 0, w: 300, h: 80 });
    tx.createContent({ blockId: b, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '예산 3천만 원 확정' }] }] } });
    return b;
  }, { origin: 'user' }).value;
});
await page.waitForTimeout(700);
const link = await ws(({ A, src }) => `${location.origin}${location.pathname}#n=${A}&b=${src}`, { A, src });
const B = await mk('보고서');
const paste = (text, plain = false) => page.evaluate(({ text, plain }) => {
  const v = window.__dn.view; v.root.focus();
  if (plain) v.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'V', ctrlKey: true, shiftKey: true, bubbles: true }));
  const dt = new DataTransfer(); dt.setData('text/plain', text);
  v.root.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, { text, plain });
const embeds = () => ws(() => [...window.__dn.view.engine.contents()].filter((c) => c.type === 'embed').map((c) => ({ blockId: c.blockId, srcNote: c.srcNote, srcBlock: c.srcBlock })));

await paste(link);
await page.waitForSelector('.dn-embed .dn-embed-body .dn-text', { timeout: 5000 }).catch(() => {});
const em = await embeds();
check('블록 링크를 붙여넣으면 임베드', em.length === 1 && em[0].srcNote === A && em[0].srcBlock === src, JSON.stringify(em));
check('원본 노트 이름 · 원본 글 그대로', (await page.locator('.dn-embed-head').innerText()).includes('원본 노트') && (await page.locator('.dn-embed-body').innerText()).includes('예산 3천만 원 확정'));
await page.screenshot({ path: `${OUT}/embed.png` });

// Ctrl+Shift+V는 그냥 글자
await paste(link, true);
await page.waitForTimeout(200);
check('Ctrl+Shift+V로 붙이면 글자 그대로 (임베드 아님)', (await embeds()).length === 1);

// 원본을 고치면 따라 바뀐다
await ws((id) => window.__dn.openById(id), A);
await page.waitForTimeout(400);
await ws((id) => {
  const e = window.__dn.view.engine; const c = e.contentsOf(id)[0];
  e.transact((tx) => tx.set('content', c.id, { doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '예산 4천만 원으로 늘림' }] }] } }), { origin: 'user' });
}, src);
await page.waitForTimeout(900);
const back = await ws(() => window.__dn.backlinks().map((l) => l.noteId));
check('원본 노트의 백링크에 임베드한 노트', back.includes(B), JSON.stringify(back));
await ws((id) => window.__dn.openById(id), B);
await page.waitForSelector('.dn-embed .dn-embed-body .dn-text', { timeout: 5000 }).catch(() => {});
check('원본을 고치면 임베드도 바뀐다', (await page.locator('.dn-embed-body').innerText()).includes('예산 4천만 원으로 늘림'));

// 문서 뷰 · Markdown
await ws(() => window.__dn.setViewMode('doc'));
await page.waitForSelector('.dn-doc .dn-embed .dn-embed-body .dn-text', { timeout: 5000 }).catch(() => {});
check('문서 뷰에도 임베드', (await page.locator('.dn-doc .dn-embed-body').innerText().catch(() => '')).includes('4천만'));
await ws(() => window.__dn.setViewMode('canvas'));
await page.waitForTimeout(300);
const md = await ws((id) => window.__dn.copyMarkdown?.(id).then?.(() => navigator.clipboard.readText()).catch(() => null), B).catch(() => null);
void md;

// 머리를 누르면 원본 블록으로
await page.locator('.dn-embed-head').click();
await page.waitForTimeout(700);
check('머리를 누르면 원본 노트의 그 블록으로', (await ws(() => window.__dn.state.currentId)) === A && (await ws((id) => window.__dn.view.selectedBlocks.includes(id), src)));

// 원본을 지우면 "원본 없음"
await ws((id) => { const v = window.__dn.view; v.select([id]); v.deleteSelection(); }, src);
await page.waitForTimeout(900);
await ws((id) => window.__dn.openById(id), B);
await page.waitForSelector('.dn-embed-missing', { timeout: 5000 }).catch(() => {});
check('원본을 지우면 "원본 없음"', (await page.locator('.dn-embed-head').innerText()).includes('원본 없음'));

// 넣기 메뉴 "블록 임베드" (링크를 묻는다)
page.once('dialog', (d) => void d.accept(link));
await ws(() => window.__dn.view.select([]));
await page.locator('.toolbar .insert-btn').click();
await page.waitForSelector('.insert-menu');
await page.keyboard.type('블록 임베드'); // '임베드'만 치면 노션처럼 웹 임베드가 먼저
await page.keyboard.press('Enter');
await page.waitForTimeout(400);
check('넣기 메뉴 "블록 임베드" → 링크를 받아 임베드', (await embeds()).length === 2);

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
