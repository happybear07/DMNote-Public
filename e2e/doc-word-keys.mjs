// 워드 단축키 별칭 · 맞춤법 검사: Ctrl+M 들여쓰기 · Ctrl+Shift+M 내어쓰기 · Ctrl+Space 서식 지우기 · Alt+= 인라인 수식,
// 맞춤법 검사는 기본 켬 → 설정 › 편집에서 끄면 편집 중인 글에도 바로 · 다시 열어도 꺼져 있음.
// 사용: dev 서버 실행 후 `node e2e/doc-word-keys.mjs`
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
await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(() => window.__dn.newNote());
await wait(300);
await ws(() => {
  const e = window.__dn.view.engine;
  e.transact((tx) => {
    const b = tx.createBlock({ x: 0, y: 0, w: 400, h: 50 });
    tx.createContent({ blockId: b, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '식 x+1 끝' }] }] } });
  }, { origin: 'user' });
});
await ws(() => window.__dn.setViewMode('doc'));
await wait(600);
const part = (i) => page.locator('.dn-doc .dn-doc-text').nth(i);
const blockOf = (i) => ws((i) => { const id = document.querySelectorAll('.dn-doc .dn-doc-item')[i].dataset.id; return window.__dn.view.engine.getBlock(id); }, i);
const docJson = () => ws(() => JSON.stringify([...window.__dn.view.engine.contents()].map((c) => c.doc)));
const marksOf = (t) => ws((t) => { const out = []; for (const c of window.__dn.view.engine.contents()) { const walk = (n) => { if (n.text?.includes(t)) out.push(...(n.marks ?? []).map((m) => m.type)); (n.content ?? []).forEach(walk); }; if (c.doc) walk(c.doc); } return out; }, t);
const spell = () => ws(() => document.querySelector('.dn-text-editing')?.getAttribute('spellcheck') ?? null);
const openAt = async () => { const b = await part(0).boundingBox(); await page.mouse.click(b.x + 4, b.y + 8); await wait(200); };

await openAt();
check('맞춤법 검사 기본 켬', (await spell()) === 'true', String(await spell()));
// 들여쓰기 · 내어쓰기
await page.keyboard.press('Control+m');
await wait(200);
check('Ctrl+M → 상자 들여쓰기 1단계', (await blockOf(0)).indent === 1, JSON.stringify((await blockOf(0)).indent));
await page.keyboard.press('Control+Shift+M');
await wait(200);
check('Ctrl+Shift+M → 내어쓰기', (await blockOf(0)).indent === undefined, JSON.stringify((await blockOf(0)).indent));
// 서식 지우기: "x+1"을 골라 굵게 → Ctrl+Space
await page.keyboard.press('Home');
for (let i = 0; i < 2; i++) await page.keyboard.press('ArrowRight');
for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight');
await wait(150);
await page.keyboard.press('Control+b');
await wait(150);
const bold = await marksOf('x+1');
await page.keyboard.press('Control+Space');
await wait(200);
check('Ctrl+Space → 고른 글 서식 지우기', bold.includes('strong') && (await marksOf('x+1')).length === 0, `${JSON.stringify(bold)} → ${JSON.stringify(await marksOf('x+1'))}`);
// Alt+= → 고른 글이 인라인 수식으로
await page.keyboard.press('Alt+Equal');
await wait(300);
const j = await docJson();
check('Alt+= → 고른 "x+1"이 인라인 수식', /"type":"math_inline"[^}]*"x\+1"|"x\+1"[^}]*"type":"math_inline"/.test(j) || (j.includes('math_inline') && j.includes('x+1') && !(await marksOf('x+1')).length), j.slice(0, 300));
await page.keyboard.press('Escape');
await wait(150);

// 설정 › 편집 → 맞춤법 검사 끄기
await openAt();
await ws(() => window.__dn.openSettings());
await page.waitForSelector('.settings');
const box = page.locator('.settings input[aria-label="맞춤법 검사"]');
check('설정 › 편집에 맞춤법 검사 (켜짐)', (await box.count()) === 1 && (await box.isChecked()));
await box.uncheck();
await wait(200);
check('끄면 편집 중인 글에도 바로 spellcheck=false', (await ws(() => [...document.querySelectorAll('.dn-text-editing')].every((el) => el.getAttribute('spellcheck') === 'false'))), String(await spell()));
await page.keyboard.press('Escape');
await wait(300);
await page.reload();
await page.waitForSelector('.dn-doc .dn-doc-text, .dn-block', { timeout: 15000 });
await wait(500);
if ((await ws(() => window.__dn.state.viewMode)) !== 'doc') { await ws(() => window.__dn.setViewMode('doc')); await wait(500); }
await openAt();
check('다시 열어도 꺼져 있음', (await spell()) === 'false' && (await ws(() => window.__dn.state.spellcheck)) === false, String(await spell()));

// 빠르게 Home → 오른쪽 9번 → Enter: 화면의 커서 자리에서 나뉜다 (AT-016 — 커서 이동이 편집기에 늦게 들어와 엉뚱한 자리에서 나뉘던 것)
let splitBad = 0;
for (let run = 0; run < 3; run++) {
  await ws(() => window.__dn.newNote());
  await wait(300);
  await ws(() => window.__dn.setViewMode('doc'));
  await wait(400);
  await page.locator('.dn-doc-page').click({ position: { x: 300, y: 200 } });
  await wait(200);
  await page.keyboard.type('다른 문단에 먼저 씀');
  await page.keyboard.press('Enter');
  await page.keyboard.type('첫 문단 앞부분과 뒷부분입니다.');
  await page.keyboard.press('Home');
  for (let i = 0; i < 9; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await wait(300);
  if (!(await docJson()).includes('"첫 문단 앞부분과"}]},{"type":"paragraph","content":[{"type":"text","text":" 뒷부분입니다."')) splitBad++;
}
check('빠른 Home → 오른쪽 9번 → Enter가 그 자리에서 나뉨 (3번 모두)', splitBad === 0, `${splitBad}번 틀림 — ${(await docJson()).slice(0, 200)}`);
// 아래에 상자가 있을 때: 치고 바로 Home → 오른쪽 3번 → X. 편집기가 아직 줄 끝이라고 알아 오른쪽이 다음 상자로 넘어가던 것
let moveBad = 0;
for (let run = 0; run < 3; run++) {
  await ws(() => window.__dn.newNote());
  await wait(300);
  await ws(() => {
    const e = window.__dn.view.engine;
    e.transact((tx) => {
      const mk = (y, text) => { const b = tx.createBlock({ x: 0, y, w: 400, h: 50 }); tx.createContent({ blockId: b, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } }); };
      mk(0, '하나 둘'); mk(80, '아래 상자');
    }, { origin: 'user' });
  });
  await ws(() => window.__dn.setViewMode('doc'));
  await wait(500);
  const t0 = await part(0).boundingBox();
  await page.mouse.click(t0.x + 4, t0.y + 8);
  await wait(200);
  await page.keyboard.press('End');
  await page.keyboard.type(' 셋');
  await page.keyboard.press('Home');
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.type('X');
  await wait(300);
  if (!(await docJson()).includes('"하나 X둘 셋"')) moveBad++;
}
check('치고 바로 Home → 오른쪽 3번이 다음 상자로 넘어가지 않음 (3번 모두)', moveBad === 0, `${moveBad}번 틀림 — ${(await docJson()).slice(0, 200)}`);
check('콘솔 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close();
const bad = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
