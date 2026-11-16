// 코드 구문 강조 (FR-026) · 표 · 이미지 붙여넣기 (FR-031).
// 코드: 언어 표시 · 토큰 색 (보기 · 편집 중), 편집 중 언어 고르기, ```언어 펜스 붙여넣기.
// 붙여넣기: 캔버스에 글 + 표 HTML → 글 블록 + 표 블록, 표만 → 표 블록만, 편집 중 표 → 글은 그 자리 · 표는 아래 블록, 편집 중 이미지 → 아래 이미지 블록.
// 사용: dev 서버 실행 후 `node e2e/code-paste.mjs`
import { chromium } from 'playwright-core';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
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
await ws(() => window.__dn.newNote());
await page.waitForTimeout(300);
const count = () => ws(() => [...window.__dn.view.engine.blocks()].length);

// ── 코드 강조 ──
const code = await ws(() => window.__dn.view.engine.transact((tx) => {
  const b = tx.createBlock({ x: 0, y: 0, w: 380, h: 120 });
  tx.createContent({ blockId: b, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'code_block', attrs: { language: 'javascript' }, content: [{ type: 'text', text: 'const n = sum(1, 2); // 합\nreturn "끝"' }] }] } });
  return b;
}, { origin: 'user' }).value);
await page.waitForTimeout(300);
const blk = page.locator(`.dn-block[data-id="${code}"]`);
check('보기: 언어 이름 표시', (await blk.locator('pre').getAttribute('data-lang-name')) === 'JavaScript');
const toks = await blk.locator('[class^="dn-tok-"]').evaluateAll((els) => els.map((e) => `${e.className.slice(7)}:${e.textContent}`));
check('보기: 키워드 · 함수 · 숫자 · 주석 · 문자열 색', ['kw:const', 'fn:sum', 'num:1', 'com:// 합', 'kw:return', 'str:"끝"'].every((k) => toks.includes(k)), toks.join(' '));
const kwColor = await blk.locator('.dn-tok-kw').first().evaluate((el) => getComputedStyle(el).color);
check('토큰 색이 글자색과 다름', kwColor !== (await blk.locator('pre').evaluate((el) => getComputedStyle(el).color)), kwColor);

await ws((id) => window.__dn.view.startEditing(id, 'end'), code);
await page.waitForSelector('.dn-text-editing .dn-code-lang select');
check('편집 중에도 색 (데코레이션)', (await page.locator('.dn-text-editing .dn-tok-kw').count()) >= 2);
await page.locator('.dn-text-editing .dn-code-lang select').selectOption('python');
await page.waitForTimeout(200);
const lang = await ws((id) => window.__dn.view.engine.contentsOf(id)[0].doc.content[0].attrs.language, code);
check('편집 중 언어 고르기 → 저장', lang === 'python', lang);
check('언어를 바꾸면 강조도 바뀜 (python에는 const 키워드 없음)', (await page.locator('.dn-text-editing .dn-tok-kw', { hasText: 'const' }).count()) === 0);
await page.keyboard.press('Control+End');
await page.keyboard.type(' x');
await page.waitForTimeout(100);
check('언어를 고른 뒤에도 바로 이어서 입력', (await ws((id) => window.__dn.view.engine.contentsOf(id)[0].doc.content[0].content[0].text, code)).endsWith(' x'));
await ws(() => { window.__dn.view.endEditing(); window.__dn.view.select([]); window.__dn.view.root.focus(); });

// ```언어 펜스 붙여넣기
const paste = (data) => ws((data) => {
  const dt = new DataTransfer();
  for (const [k, v] of Object.entries(data)) dt.setData(k, v);
  const r = window.__dn.view.root;
  r.focus();
  r.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, data);
const before = await count();
await paste({ 'text/plain': '설명\n\n```py\ndef f():\n    return None\n```' });
await page.waitForTimeout(300);
const pyLang = await ws(() => { const v = window.__dn.view, id = v.selectedBlocks[0]; return v.engine.contentsOf(id)[0].doc.content.find((n) => n.type === 'code_block')?.attrs?.language; });
check('```py 펜스 붙여넣기 → 파이썬 코드 블록', pyLang === 'python' && (await count()) === before + 1, String(pyLang));

// ── 표 붙여넣기 (캔버스) ──
const html = '<p><b>분기 실적</b></p><table><thead><tr><th>분기</th><th>매출</th></tr></thead><tbody><tr><td>1분기</td><td>120</td></tr><tr><td>2분기</td><td>150</td></tr></tbody></table>';
await ws(() => window.__dn.view.select([]));
await paste({ 'text/html': html, 'text/plain': '분기 실적\n분기\t매출\n1분기\t120\n2분기\t150' });
await page.waitForTimeout(400);
const desc = () => ws(() => { const v = window.__dn.view; return v.selectedBlocks.map((id) => { const c = v.engine.contentsOf(id)[0]; return c.type === 'table' ? { t: 'table', cols: c.columns.map((x) => x.name), rows: c.rows.length, first: c.columns.map((col) => (c.rows[0].cells[col.id]?.content?.[0]?.content?.[0]?.text ?? '')) } : { t: c.type, text: JSON.stringify(c.doc) }; }); });
const sel = await desc();
check('글 + 표 HTML → 글 블록(굵게 유지) + 표 블록', sel.length === 2 && sel[0].t === 'text' && sel[0].text.includes('strong') && sel[0].text.includes('분기 실적') && !sel[0].text.includes('1분기'), JSON.stringify(sel[0]));
check('표 블록: 머리글 · 행 · 칸', sel[1]?.t === 'table' && JSON.stringify(sel[1].cols) === '["분기","매출"]' && sel[1].rows === 2 && JSON.stringify(sel[1].first) === '["1분기","120"]', JSON.stringify(sel[1]));
const below = await ws(() => { const v = window.__dn.view, [x, y] = v.selectedBlocks, a = v.engine.getBlock(x), b = v.engine.getBlock(y); return b.y >= a.y + a.h; });
check('표 블록은 글 블록 아래', below);
const n1 = await count();
await ws(() => window.__dn.view.select([]));
await paste({ 'text/html': '<table><tr><td>가</td><td>나</td></tr><tr><td>다</td><td>라</td></tr></table>', 'text/plain': '가\t나\n다\t라' });
await page.waitForTimeout(300);
const only = await ws(() => { const v = window.__dn.view; return v.selectedBlocks.map((id) => { const c = v.engine.contentsOf(id)[0]; return c.type === 'table' ? `${c.columns.map((x) => x.name).join(',')}/${c.rows.length}` : c.type; }); });
check('표만 붙여넣기 → 표 블록만 (머리글 없으면 열 1 · 열 2, 모든 줄이 행)', JSON.stringify(only) === '["열 1,열 2/2"]' && (await count()) === n1 + 1, JSON.stringify(only));

// 배치용 표(메일 · 뉴스레터)는 표 블록이 아니라 글로 — 제목 · 문단 · 굵게 그대로
await ws(() => window.__dn.view.select([]));
await paste({ 'text/html': '<table role="presentation"><tr><td><h1>주간 소식</h1><p>첫 문단 <b>굵게</b></p><p>둘째 문단</p></td></tr></table>', 'text/plain': '주간 소식\n첫 문단 굵게\n둘째 문단' });
await page.waitForTimeout(300);
const layout = await ws(() => { const v = window.__dn.view; return v.selectedBlocks.map((id) => { const c = v.engine.contentsOf(id)[0]; return c.type === 'text' ? c.doc.content.map((n) => n.type).join(',') + (JSON.stringify(c.doc).includes('strong') ? '+b' : '') : c.type; }); });
check('배치용 표(role=presentation · 칸 안 문단)는 글 블록으로 — 제목 · 문단 · 굵게 유지', JSON.stringify(layout) === '["heading,paragraph,paragraph+b"]', JSON.stringify(layout));
// 500행이 넘는 표 → 500행까지 · 알림
const big = '<table><tr><th>번호</th><th>값</th></tr>' + Array.from({ length: 520 }, (_, i) => `<tr><td>${i + 1}</td><td>${i * 2}</td></tr>`).join('') + '</table>';
await ws(() => window.__dn.view.select([]));
await paste({ 'text/html': big, 'text/plain': 'x' });
await page.waitForTimeout(500);
const bigRows = await ws(() => { const v = window.__dn.view, c = v.engine.contentsOf(v.selectedBlocks[0])[0]; return c.type === 'table' ? c.rows.length : -1; });
check('큰 표는 500행까지 붙이고 잘렸다고 알림', bigRows === 500 && (await page.locator('.toast').innerText().catch(() => '')).includes('500행'), String(bigRows));
await ws(() => { const v = window.__dn.view; v.deleteSelection(); });

// ── 편집 중 붙여넣기 ──
const host = await ws(() => window.__dn.view.engine.transact((tx) => {
  const b = tx.createBlock({ x: 900, y: 0, w: 300, h: 60 });
  tx.createContent({ blockId: b, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '앞 ' }] }] } });
  return b;
}, { origin: 'user' }).value);
await page.waitForTimeout(200);
await ws((id) => window.__dn.view.startEditing(id, 'end'), host);
await page.waitForSelector('.dn-text-editing');
const n2 = await count();
await page.evaluate(() => {
  const dt = new DataTransfer();
  dt.setData('text/html', '<p>붙인 글</p><p>둘째 줄</p><p>셋째 줄</p><p>넷째 줄</p><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>');
  dt.setData('text/plain', '붙인 글\nA\tB\n1\t2');
  document.querySelector('.dn-text-editing').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
});
await page.waitForTimeout(800);
const hostText = await ws((id) => JSON.stringify(window.__dn.view.engine.contentsOf(id)[0].doc), host);
const tableBelow = await ws(({ id, n }) => { const e = window.__dn.view.engine, h = e.getBlock(id); const t = [...e.blocks()].slice(n).find((b) => e.contentsOf(b.id)[0]?.type === 'table'); return t ? { cols: e.contentsOf(t.id)[0].columns.map((c) => c.name).join(','), below: t.y >= h.y + h.h } : null; }, { id: host, n: n2 });
check('편집 중 표 HTML → 글은 그 자리 · 표는 아래 표 블록', hostText.includes('붙인 글') && !hostText.includes('"A"') && tableBelow?.cols === 'A,B' && tableBelow.below, `${hostText} ${JSON.stringify(tableBelow)}`);

const docked = await ws((id) => { const e = window.__dn.view.engine, h = e.getBlock(id); return e.transact((tx) => { const b = tx.createBlock({ x: h.x, y: h.y + h.h + 16, w: h.w, h: 60 }); tx.createContent({ blockId: b, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '아래 블록' }] }] } }); return b; }, { origin: 'user' }).value; }, host);
await page.waitForTimeout(200);
await ws((id) => window.__dn.view.startEditing(id, 'end'), host);
await page.waitForSelector('.dn-text-editing');
const n3 = await count();
await page.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 40; c.height = 30;
  c.getContext('2d').fillRect(0, 0, 40, 30);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  const dt = new DataTransfer();
  dt.items.add(new File([blob], 'shot.png', { type: 'image/png' }));
  document.querySelector('.dn-text-editing').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
});
await page.waitForFunction((n) => [...window.__dn.view.engine.blocks()].length > n, n3, { timeout: 5000 }).catch(() => {});
const img = await ws(({ id, n }) => { const e = window.__dn.view.engine, h = e.getBlock(id); const b = [...e.blocks()].slice(n).find((x) => e.contentsOf(x.id)[0]?.type === 'image'); return b ? { below: b.y >= h.y + h.h, editing: window.__dn.view.editingId } : null; }, { id: host, n: n3 });
const overlap = await ws((d) => { const e = window.__dn.view.engine, a = e.getBlock(d); const img = [...e.blocks()].find((x) => e.contentsOf(x.id)[0]?.type === 'image'); return !!img && img.x < a.x + a.w && a.x < img.x + img.w && img.y < a.y + a.h && a.y < img.y + img.h; }, docked);
check('아래에 붙은 블록이 있으면 이미지는 겹치지 않는 자리에', !overlap);
check('편집 중 이미지 붙여넣기 → 아래 이미지 블록 (글에는 안 들어감)', !!img && img.below && !img.editing && !(await ws((id) => JSON.stringify(window.__dn.view.engine.contentsOf(id)[0].doc), host)).includes('image'), JSON.stringify(img));

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
