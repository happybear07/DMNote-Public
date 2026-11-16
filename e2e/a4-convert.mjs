// A4로 고정 (11/03): 예전 끝없는 캔버스 노트를 줌 막대 'A4로'로 바꾸면 상자가 겹치지 않게 쪽에 맞춰 다시 놓는다(넓으면 같은 배율로 줄임) ·
// 줌 막대 단추로 노트 전체 90도 돌리기(세로 ↔ 가로) · 실행 취소 한 번. 화면에 그려진 상자 자리(DOM)로 겹침을 잰다.
// 사용: dev 서버 실행 후 `node e2e/a4-convert.mjs [스크린샷 폴더]`
import { chromium } from 'playwright-core';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2] ?? '.';
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

/** 엔진 자리(측정 높이 포함)로 겹치는 상자 쌍 · 종이 밖 상자 */
const audit = () => ws(() => {
  const e = window.__dn.view.engine, bs = [...e.blocks()].map((b) => e.blockRect(b.id) ?? b);
  let over = 0;
  for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
    const a = bs[i], b = bs[j];
    if (a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1) over++;
  }
  const s = e.note.sheet, wMax = s?.landscape ? 1123 : 794;
  const outside = s ? bs.filter((b) => b.x < 23 || b.x + b.w > Math.max(wMax, 1123) - 23).length : -1;
  return { n: bs.length, over, outside, sheet: s ?? null };
});
const btn = page.locator('.zoom .sheet-btn');

// 1) 처음부터 있는 예시 노트 (끝없는 캔버스 · 도식) → A4로
const sample = await ws(() => window.__dn.state.notes.find((n) => /Claude API/.test(n.title))?.id);
if (sample) {
  await ws((id) => window.__dn.openById(id), sample);
  await wait(800);
  const before = await audit();
  check('예시 노트는 예전 끝없는 캔버스 · 줌 막대에 눈에 띄는 A4로 단추', before.sheet === null && (await btn.innerText()).includes('A4로'), JSON.stringify(before));
  await btn.click();
  await wait(900);
  const after = await audit();
  check('A4로 → 상자 겹침 없음', after.sheet?.size === 'a4' && after.over === 0, JSON.stringify(after));
  await page.screenshot({ path: `${OUT}/a4-convert-sample.png` });
}

// 2) 넓게 흩어진 글 상자 (화면 3000px 너비) → A4로
await ws(() => window.__dn.newNote({ sheet: null }));
await wait(400);
await ws(() => window.__dn.view.engine.transact((tx) => {
  const words = ['첫째 생각을 길게 적은 상자입니다. 줄이 여러 개가 되도록 글을 조금 더 씁니다.', '둘째', '셋째 — 오른쪽 멀리', '넷째 아래', '다섯째 아래 오른쪽'];
  const at = [[0, 0, 420], [1400, 0, 300], [2700, 40, 300], [100, 500, 600], [2200, 520, 500]];
  at.forEach(([x, y, w], i) => { const b = tx.createBlock({ x, y, w, h: 60 }); tx.createContent({ blockId: b, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: words[i] }] }] } }); });
}, { origin: 'user' }));
await wait(500);
await btn.click();
await wait(900);
const wide = await audit();
check('넓게 흩어진 상자 → A4로: 겹침 없음 · 종이 폭 안', wide.over === 0 && wide.outside === 0, JSON.stringify(wide));
await page.screenshot({ path: `${OUT}/a4-convert-wide.png` });

// 3) 줌 막대 단추로 90도 돌리기 → 가로 · 다시 → 세로, 실행 취소 한 번
await btn.click();
await wait(700);
const land = await audit();
check('줌 막대 → 노트 전체 가로(90도) · 겹침 없음', land.sheet?.landscape === true && land.over === 0 && (await btn.innerText()).includes('A4 가로'), JSON.stringify(land));
await page.screenshot({ path: `${OUT}/a4-convert-landscape.png` });
await ws(() => window.__dn.view.root.focus());
await page.keyboard.press('Control+z');
await wait(400);
check('실행 취소 한 번 → 세로로 돌아옴', !(await audit()).sheet?.landscape);

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} 통과`);
await browser.close();
process.exit(results.every((r) => r.ok) ? 0 : 1);
