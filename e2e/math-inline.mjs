// 인라인 수식 (노션처럼): Ctrl+Shift+E로 빈 수식 → 입력 창(미리보기 · 완료), 고른 글 + Ctrl+Shift+E → 그 LaTeX가 수식으로,
// 서식 막대 √x 단추, 글 속 $식$, 캔버스 글 상자에서도, 편집을 끝내면 글 줄 안에 KaTeX로 그려진다.
// 사용: dev 서버 실행 후 `node e2e/math-inline.mjs`
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
const ws = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
const inlineTex = () => ws(() => { const out = []; for (const c of window.__dn.view.engine.contents()) { const walk = (n) => { if (n.type === 'math_inline') out.push(n.attrs.tex); (n.content ?? []).forEach(walk); }; if (c.doc) walk(c.doc); } return out; });

await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(() => window.__dn.newNote());
await wait(300);
await ws(() => window.__dn.setViewMode('doc'));
await wait(400);
await page.locator('.dn-doc-page').click({ position: { x: 300, y: 200 } });
await wait(200);

// 1. 빈 자리에서 Ctrl+Shift+E → 입력 창
await page.keyboard.type('피타고라스: ');
await page.keyboard.press('Control+Shift+e');
await wait(300);
const head = await page.locator('.dn-math-editor .dn-math-head').innerText().catch(() => '');
check('Ctrl+Shift+E → 인라인 수식 입력 창 (미리보기 · 완료)', head === '인라인 수식' && (await page.locator('.dn-math-editor .dn-math-card').count()) === 1, head);
await page.keyboard.type('a^2+b^2=c^2');
await page.keyboard.press('Enter');
await wait(300);
check('Enter → 글 속 수식', JSON.stringify(await inlineTex()) === '["a^2+b^2=c^2"]', JSON.stringify(await inlineTex()));
await page.keyboard.type(' 이다.');
await wait(200);

// 2. 고른 글 → 수식
await page.keyboard.press('Enter');
await page.keyboard.type('식은 x^2 입니다');
await wait(150);
for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft');
await wait(80);
for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowLeft');
await wait(150);
await page.keyboard.press('Control+Shift+e');
await wait(300);
check('고른 글 + Ctrl+Shift+E → 그 LaTeX가 수식으로', (await inlineTex()).includes('x^2'), JSON.stringify(await inlineTex()));

// 3. 서식 막대 √x 단추
await page.keyboard.press('End');
await page.keyboard.type(' 그리고 ');
await page.locator('.doc-ribbon button[aria-label^="인라인 수식"]').click();
await wait(300);
check('서식 막대 √x → 입력 창', (await page.locator('.dn-math-editor .dn-math-head').innerText().catch(() => '')) === '인라인 수식');
await page.keyboard.type('\\sqrt{2}');
await page.locator('.dn-math-done').click();
await wait(300);
check('완료 → 수식이 들어감', (await inlineTex()).includes('\\sqrt{2}'), JSON.stringify(await inlineTex()));

// 4. 글 속 $식$
await page.keyboard.press('End');
await page.keyboard.type(' $E=mc^2$ ');
await wait(300);
check('$E=mc^2$ 입력 → 수식', (await inlineTex()).includes('E=mc^2'), JSON.stringify(await inlineTex()));

// 5. 편집을 끝내면 글 줄 안에 KaTeX
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
await wait(400);
const rendered = await ws(() => [...document.querySelectorAll('.dn-doc .dn-doc-text .katex')].length);
check('정적 화면에서 글 속 수식이 KaTeX로 (4개)', rendered >= 4, String(rendered));

// 6. 캔버스 글 상자에서도
await ws(() => window.__dn.setViewMode('canvas'));
await wait(400);
await ws(() => window.__dn.view.addBlockAtCenter());
await wait(250);
await page.keyboard.type('넓이 ');
await page.keyboard.press('Control+Shift+e');
await wait(300);
await page.keyboard.type('\\pi r^2');
await page.keyboard.press('Enter');
await wait(300);
check('캔버스에서도 Ctrl+Shift+E', (await inlineTex()).includes('\\pi r^2'), JSON.stringify(await inlineTex()));

check('콘솔 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close();
const bad = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
