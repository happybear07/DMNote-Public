// 코드 블록 '복사' 단추 (노션): 코드 위에 올리면 오른쪽 위에 뜨고 누르면 코드 글이 클립보드로 — 캔버스 · 문서 뷰 · 편집 중.
// 누를 때 편집을 시작하지 않고(정적), 고치던 편집기 초점도 그대로. 단추는 문서 DOM 밖(body) — 내보내기에 섞이지 않는다.
// 사용: dev 서버 실행 후 `node e2e/code-copy.mjs [스크린샷 폴더]`
import { chromium } from 'playwright-core';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2];
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const browser = await chromium.launch({ channel: process.env.DN_CHANNEL ?? 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
await ctx.addInitScript(() => localStorage.setItem('dn:no-env-key', '1'));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });
const ws = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
const CODE = 'const a = 1;\nconsole.log(a);';

await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(() => window.__dn.newNote({ sheet: null }));
await page.waitForFunction(() => window.__dn.view.engine.blockCount === 0);
const id = await ws((code) => {
  const v = window.__dn.view;
  const r = v.engine.transact((tx) => {
    const b = tx.createBlock({ x: 0, y: 0, w: 420, h: 120 });
    tx.createContent({ blockId: b, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '코드 위 글' }] }, { type: 'code_block', attrs: { language: 'javascript' }, content: [{ type: 'text', text: code }] }] } });
    return b;
  }, { origin: 'user' });
  v.setCamera({ x: -100, y: -100, zoom: 1 });
  return r.value;
}, CODE);
await wait(500);
const btn = page.locator('.dn-code-copy');
const clip = () => ws(() => navigator.clipboard.readText().then((t) => t.replace(/\r\n/g, '\n'))); // 윈도 클립보드는 줄바꿈을 CRLF로
const setClip = (t) => ws((t) => navigator.clipboard.writeText(t), t);

// 캔버스 (정적)
check('처음엔 단추 안 보임', !(await btn.isVisible().catch(() => false)));
const pre = page.locator(`.dn-block[data-id="${id}"] pre`);
const pr = await pre.boundingBox();
await page.mouse.move(pr.x + 40, pr.y + pr.height / 2);
await wait(150);
const br = await btn.boundingBox();
check('코드 위에 올리면 오른쪽 위에 단추', !!br && br.x + br.width <= pr.x + pr.width + 1 && br.x > pr.x + pr.width / 2 && Math.abs(br.y - pr.y) < 12, JSON.stringify({ pr, br }));
check('단추는 문서 · 블록 DOM 밖', (await ws(() => !!document.querySelector('.dn-block .dn-code-copy, .dn-doc .dn-code-copy'))) === false);
await setClip('');
await btn.click();
await wait(200);
check("누르면 코드가 클립보드로 · '복사됨'", (await clip()) === CODE && (await btn.innerText()) === '복사됨', JSON.stringify([await clip(), await btn.innerText()]));
check('누른 뒤에도 편집이 시작되지 않음 · 블록 그대로', (await ws(() => window.__dn.view.editingId ?? null)) === null && JSON.stringify(await ws((id) => { const b = window.__dn.view.engine.getBlock(id); return [b.x, b.y]; }, id)) === '[0,0]');
if (OUT) await page.screenshot({ path: `${OUT}/code-copy-canvas.png` });
await page.mouse.move(pr.x + pr.width + 200, pr.y + pr.height + 200);
await wait(150);
check('코드 밖으로 나가면 단추 숨음', !(await btn.isVisible()));

// 문서 뷰 — 편집 중: 언어 칸 왼쪽, 누른 뒤 편집기 초점 그대로
await ws(() => window.__dn.setViewMode('doc'));
await wait(600);
const docPre = () => ws(() => document.querySelector('.dn-doc pre')?.getBoundingClientRect().toJSON() ?? null);
let dr = await docPre();
await page.mouse.click(dr.x + 30, dr.y + dr.height - 8);
await wait(300);
dr = await docPre();
await page.mouse.move(dr.x + 60, dr.y + dr.height / 2);
await wait(150);
const lang = await ws(() => document.querySelector('.dn-doc pre .dn-code-lang')?.getBoundingClientRect().toJSON() ?? null);
const br2 = await btn.boundingBox();
check('편집 중에는 언어 칸 왼쪽에', !!lang && !!br2 && br2.x + br2.width <= lang.x + 0.5, JSON.stringify({ lang, br2 }));
await setClip('');
await btn.click();
await wait(200);
check('편집 중에 눌러도 복사 · 편집기 초점 그대로', (await clip()) === CODE && (await ws(() => !!document.activeElement?.closest('.dn-text-editing'))), JSON.stringify([await clip(), await ws(() => document.activeElement?.className)]));
await page.keyboard.type('X');
await wait(200);
check('이어 치면 코드에 들어감', (await ws(() => JSON.stringify([...window.__dn.view.engine.contents()].map((c) => c.doc)))).includes('X'));

check('콘솔 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close();
const bad = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
