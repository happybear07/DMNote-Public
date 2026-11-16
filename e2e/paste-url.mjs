// 주소 붙여넣기 › 링크 · 언급 · 북마크 · 임베드 고르기 (노션 "Paste as", FR-050 · GAP #14): 빈 줄에 주소만 붙여넣으면 고르기 메뉴,
// 임베드(허용 목록 주소만) · 북마크를 고르면 주소만 있던 상자 자리에 웹 블록, Esc · 링크로 두기는 링크 그대로,
// 글 사이에 붙인 주소는 링크 · 언급만 — 언급은 사이트 제목 칩(atom), Markdown은 [제목](주소).
// 문서 뷰에서도 같은 메뉴 — 고르면 아래에 웹 블록, 빈 상자는 남지 않음.
// 사용: dev 서버 실행 후 `node e2e/paste-url.mjs`
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
page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text()) && m.location()?.url?.startsWith(BASE)) errors.push(m.text()); });
await page.route('**/api/unfurl?**', (r) => r.fulfill({ contentType: 'application/json', body: '{"title":"예시"}' }));
await page.route(/youtube-nocookie\.com/, (r) => r.fulfill({ contentType: 'text/html', body: '<html></html>' }));
await ctx.route('https://example.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<html><title>예시</title></html>' })); // 칩을 눌러 연 새 탭이 밖으로 나가지 않게
const ws = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
const YT = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
/** 지금 편집 중인 글 상자에 붙여넣기 */
const paste = (t) => ws((t) => {
  const dt = new DataTransfer(); dt.setData('text/plain', t);
  document.querySelector('.dn-text-editing').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, t);
const menu = () => page.locator('.dn-paste-url:not([hidden]) .dn-slash-item b').allInnerTexts();
const state = () => ws(() => { const e = window.__dn.view.engine; return [...e.blocks()].map((b) => e.contentsOf(b.id).map((c) => c.type === 'web' ? `web:${c.view}:${c.url}` : `text:${JSON.stringify(c.doc).includes('"link"') ? 'link' : 'plain'}:${(JSON.stringify(c.doc).match(/"text":"[^"]*"/g) ?? []).map((x) => x.slice(8, -1)).join('')}`).join('|')); });
/** 링크 언급 노드들 (주소 · 제목) */
const mentions = () => ws(() => { const e = window.__dn.view.engine, out = []; const walk = (n) => { if (n.type === 'link_mention') out.push([n.attrs.href, n.attrs.title]); (n.content ?? []).forEach(walk); }; for (const b of e.blocks()) for (const c of e.contentsOf(b.id)) if (c.doc) walk(c.doc); return out; });
const newBox = async () => { await ws(() => { const v = window.__dn.view; v.endEditing(); v.select([]); v.addBlockAtCenter(); }); await wait(250); };

await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(() => window.__dn.newNote());
await wait(300);

// 1. 빈 상자에 유튜브 주소 → 링크 · 북마크 · 임베드 → 임베드
await newBox();
await paste(YT);
await wait(250);
check('빈 상자에 주소만 → 고르기 메뉴 (링크로 두기 · 언급 · 북마크 · 임베드)', JSON.stringify(await menu()) === JSON.stringify(['링크로 두기', '언급', '북마크', '임베드']), JSON.stringify(await menu()));
await page.keyboard.press('ArrowDown');
await page.keyboard.press('ArrowDown');
await page.keyboard.press('ArrowDown');
await page.keyboard.press('Enter');
await wait(500);
let s = await state();
check('임베드 → 주소만 있던 상자 자리에 웹 임베드 (빈 상자 안 남음)', JSON.stringify(s) === JSON.stringify([`web:embed:${YT}`]), JSON.stringify(s));
check('iframe으로 보임', (await page.locator('.dn-web-embed iframe').count()) === 1);

// 2. 글 사이에 붙인 주소 → 링크 · 언급만, 언급 → 사이트 제목 칩
await newBox();
await page.keyboard.type('참고 ');
await paste('https://example.com/a');
await wait(250);
check('글 사이 주소 → 링크 · 언급만 (그대로면 링크)', JSON.stringify(await menu()) === '["링크로 두기","언급"]' && (await state()).some((x) => x.startsWith('text:link:참고')), JSON.stringify(await menu()));
await page.keyboard.press('ArrowDown');
await page.keyboard.press('Enter');
await wait(500);
check('언급 → 주소 글자 대신 칩 · 사이트 제목(예시)을 채움', JSON.stringify(await mentions()) === '[["https://example.com/a","예시"]]' && (await page.locator('.dn-text-editing a.dn-link-mention', { hasText: '예시' }).count()) === 1, JSON.stringify(await mentions()));
await page.keyboard.type(' 끝');
await wait(150);
const md = await ws(async () => { const v = window.__dn.view; v.endEditing(); await new Promise((r) => setTimeout(r, 150)); return window.__dn.noteMarkdown(window.__dn.state.currentId); });
check('Markdown: [예시](주소)', md.includes('참고 [예시](https://example.com/a) 끝'), md.slice(0, 200));
const chip = page.locator('.dn-block a.dn-link-mention').first();
const pop = ctx.waitForEvent('page', { timeout: 3000 }).catch(() => null);
await chip.click();
const tab = await pop;
// 새 탭은 막 열린 순간 주소가 빈 글이다 — 첫 문서가 뜰 때까지 기다린다
for (let i = 0; tab && !tab.url() && i < 30; i++) await wait(100);
check('편집 중이 아닌 칩을 누르면 새 탭', !!tab && (tab.url() === 'https://example.com/a' || tab.url() === 'about:blank'), tab?.url() ?? 'none');
await tab?.close().catch(() => {});

// 3. 허용 목록 밖 주소 → 임베드 없음, Esc → 링크 그대로
await newBox();
await paste('https://example.com/b');
await wait(250);
check('끼워 넣을 수 없는 주소 → 링크로 두기 · 언급 · 북마크만', JSON.stringify(await menu()) === JSON.stringify(['링크로 두기', '언급', '북마크']), JSON.stringify(await menu()));
await page.keyboard.press('Escape');
await wait(200);
check('Esc → 메뉴 닫힘 · 링크 그대로', (await menu()).length === 0 && (await state()).filter((x) => x.startsWith('text:link:')).length === 1);
// 계속 입력하면 닫힘
await newBox();
await paste('https://example.com/c');
await wait(200);
await page.keyboard.type(' 이어서');
await wait(200);
check('메뉴가 떠 있어도 계속 쓰면 닫히고 링크로', (await menu()).length === 0 && (await state()).filter((x) => x.startsWith('text:link:')).length === 2);

// 4. 북마크
await newBox();
await paste('https://example.com/d');
await wait(250);
await page.keyboard.press('ArrowDown');
await page.keyboard.press('ArrowDown');
await page.keyboard.press('Enter');
await wait(600);
s = await state();
check('북마크 → 카드 블록 · 제목 채움', s.includes('web:bookmark:https://example.com/d') && (await page.locator('.dn-web-card .dn-web-title', { hasText: '예시' }).count()) >= 1, JSON.stringify(s));
const blankBoxes = await ws(() => { const e = window.__dn.view.engine; return [...e.blocks()].filter((b) => e.contentsOf(b.id).every((c) => c.type === 'text' && !JSON.stringify(c.doc).includes('"text":'))).length; });
check('주소만 있던 상자는 남지 않음', blankBoxes === 0, String(blankBoxes));
// 실행 취소: 웹 블록이 빠지고 → 한 번 더면 주소 상자가 돌아옴
await ws(() => window.__dn.view.endEditing());
await ws(() => window.__dn.view.engine.undo());
await wait(200);
check('실행 취소 → 북마크 블록이 빠짐', !(await state()).includes('web:bookmark:https://example.com/d'));

// 5. 문서 뷰
await ws(() => window.__dn.setViewMode('doc'));
await wait(700);
const before = (await state()).filter((x) => x.startsWith('web:')).length;
const last = page.locator('.dn-doc .dn-doc-text').last();
const lb = await last.boundingBox();
await page.mouse.click(lb.x + lb.width - 4, lb.y + lb.height - 6);
await wait(200);
await page.keyboard.press('End');
await page.keyboard.press('Enter');
await page.keyboard.press('Enter');
await wait(300);
await paste(YT);
await wait(300);
check('문서 뷰에서도 고르기 메뉴', (await menu()).length === 4, JSON.stringify(await menu()));
await page.keyboard.press('ArrowDown');
await page.keyboard.press('ArrowDown');
await page.keyboard.press('Enter');
await wait(700);
const after = await state();
const docBlank = await ws(() => { const e = window.__dn.view.engine; return [...e.blocks()].filter((b) => e.contentsOf(b.id).every((c) => c.type === 'text' && !JSON.stringify(c.doc).includes('"text":'))).length; });
check('문서 뷰 북마크 → 웹 블록 하나 더 · 빈 상자 없음', after.filter((x) => x.startsWith('web:')).length === before + 1 && docBlank === 0 && (await page.locator('.dn-doc .dn-web-card').count()) >= 1, `${before}→${after.filter((x) => x.startsWith('web:')).length} blank ${docBlank}`);
// 빈 캔버스에 주소만 붙여넣기 → 링크 글 상자 + 같은 고르기 메뉴, 임베드 고르면 그 자리에 웹 블록 (AT-012)
await ws(() => window.__dn.setViewMode('canvas'));
await wait(500);
const canvasPaste = (t) => page.evaluate((t) => { const dt = new DataTransfer(); dt.setData('text/plain', t); const r = window.__dn.view.root; window.__dn.view.select([]); r.focus(); r.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, t);
const before2 = (await state()).filter((x) => x.startsWith('web:')).length;
await canvasPaste('https://youtu.be/dQw4w9WgXcQ');
await wait(400);
check('빈 캔버스에 주소 → 링크 상자 + 고르기 메뉴 (링크 · 언급 · 북마크 · 임베드)', JSON.stringify(await menu()) === '["링크로 두기","언급","북마크","임베드"]', JSON.stringify(await menu()));
await page.keyboard.press('ArrowDown');
await page.keyboard.press('ArrowDown');
await page.keyboard.press('ArrowDown');
await page.keyboard.press('Enter');
await wait(500);
const after2 = await state();
check('… 임베드 → 링크 상자 자리에 웹 임베드 (링크 상자는 남지 않음)', after2.filter((x) => x.startsWith('web:embed:')).length === 1 + after.filter((x) => x.startsWith('web:embed:')).length && !after2.some((x) => x.includes('dQw4w9WgXcQ') && x.startsWith('text:')) && (await menu()).length === 0, JSON.stringify(after2));
await canvasPaste('https://example.com/page');
await wait(400);
check('… 임베드 못 하는 주소는 링크 · 언급 · 북마크', JSON.stringify(await menu()) === '["링크로 두기","언급","북마크"]', JSON.stringify(await menu()));
await page.keyboard.press('Escape');
await wait(300);
check('… Esc → 링크 글 상자 그대로', (await menu()).length === 0 && (await state()).some((x) => x.startsWith('text:link:') && x.includes('example.com/page')) && (await state()).filter((x) => x.startsWith('web:')).length === before2 + 1, JSON.stringify(await state()));
await canvasPaste('https://example.com/m');
await wait(400);
await page.keyboard.press('ArrowDown');
await page.keyboard.press('Enter');
await wait(600);
check('… 언급 → 그 상자 글이 칩 하나 · 제목 채움', (await mentions()).some(([h, t]) => h === 'https://example.com/m' && t === '예시') && !(await state()).some((x) => x.includes('example.com/m') && x.startsWith('text:link:')), JSON.stringify(await mentions()));
await page.screenshot({ path: `${process.argv[2] ?? '.'}/paste-url-mention.png` });
check('콘솔 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close();
const bad = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
