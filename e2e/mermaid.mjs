// 머메이드 ↔ 캔버스 도식 (GAP #18 — 노션 /mermaid): /머메이드 → 순서도 틀 코드 블록(언어 Mermaid) → 블록 메뉴 › 'Mermaid → 캔버스 도식'으로
// 바로 아래에 상자 · 화살표(라벨 · 조건 상자는 결정 종류), 거꾸로 상자들 › 'Mermaid 글로 복사' → flowchart 글이 클립보드에.
// 사용: dev 서버 실행 후 `node e2e/mermaid.mjs [스크린샷 폴더]`
import { chromium } from 'playwright-core';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2] ?? '.';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const browser = await chromium.launch({ channel: process.env.DN_CHANNEL ?? 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
await ctx.addInitScript(() => localStorage.setItem('dn:no-env-key', '1'));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });
const ws = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
const state = () => ws(() => {
  const e = window.__dn.view.engine;
  const t = (id) => JSON.stringify(e.contentsOf(id)[0]?.doc ?? '').match(/"text":"([^"]*)"/)?.[1] ?? '';
  const bs = [...e.blocks()].sort((a, b) => a.y - b.y || a.x - b.x);
  return { boxes: bs.map((b) => [t(b.id), b.nodeKind ?? '']), arrows: [...e.arrows()].map((a) => `${t(a.from.blockId)}→${t(a.to.blockId)}${a.label ? `:${a.label}` : ''}`).sort(), ids: bs.map((b) => b.id) };
});

await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(() => window.__dn.newNote({ sheet: null }));
await page.waitForFunction(() => window.__dn.view.engine.blockCount === 0);
await page.evaluate(() => window.__dn.view.setTool('block'));
await page.mouse.click(500, 160);
await wait(250);
await page.keyboard.type('/머메이드');
await wait(250);
check('슬래시 메뉴에 머메이드', (await page.locator('.dn-slash-item b').first().innerText()) === '머메이드');
await page.keyboard.press('Enter');
await wait(300);
const code = await ws(() => { const e = window.__dn.view.engine; const c = [...e.blocks()].flatMap((b) => e.contentsOf(b.id))[0]; return c?.doc?.content?.find((n) => n.type === 'code_block'); });
check('/머메이드 → 언어 Mermaid 코드 블록 · 순서도 틀', code?.attrs?.language === 'mermaid' && code.content[0].text.startsWith('flowchart TD'), JSON.stringify(code).slice(0, 160));
await page.keyboard.press('Escape');
await wait(200);

// 블록 메뉴 › Mermaid → 캔버스 도식
const src = (await state()).ids[0];
const r0 = await ws((id) => { const r = window.__dn.view.mounted.get(id).el.getBoundingClientRect(); return { x: r.left + 40, y: r.top + 14 }; }, src);
await page.mouse.click(r0.x, r0.y, { button: 'right' });
await wait(200);
await page.locator('.menu[aria-label="블록 메뉴"] button', { hasText: 'Mermaid → 캔버스 도식' }).click();
await wait(500);
const s = await state();
check('바로 아래에 상자 넷 (조건은 결정 종류)', JSON.stringify(s.boxes.slice(1)) === '[["시작",""],["조건","decision"],["처리",""],["끝",""]]', JSON.stringify(s.boxes));
check('화살표 셋 · 라벨 예 / 아니요', JSON.stringify(s.arrows) === '["시작→조건","조건→끝:아니요","조건→처리:예"]', JSON.stringify(s.arrows));
const overlap = await ws(() => { const bs = [...window.__dn.view.engine.blocks()]; let n = 0; for (const a of bs) for (const b of bs) if (a.id < b.id && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) n++; return n; });
check('겹치지 않음', overlap === 0, String(overlap));
check('새 상자를 고름', (await ws(() => window.__dn.view.selectedBlocks.length)) === 4);
await page.screenshot({ path: `${OUT}/mermaid-diagram.png` });

// 고른 상자들 › Mermaid 글로 복사
await ws(() => { const v = window.__dn.view; v.host.onBlockMenu({ ids: v.selectedBlocks, x: 700, y: 300 }); });
await wait(200);
await page.locator('.menu[aria-label="블록 메뉴"] button', { hasText: 'Mermaid 글로 복사' }).click();
await wait(300);
const clip = await page.evaluate(() => navigator.clipboard.readText());
check('클립보드에 flowchart 글 (조건은 {}, 라벨 |예|)', clip.startsWith('flowchart ') && /\{"조건"\}/.test(clip) && clip.includes('|"예"|') && clip.split('\n').filter((l) => l.includes('-->')).length === 3, clip);
check('알림', (await page.locator('.toast').innerText().catch(() => '')).includes('Mermaid'));

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
