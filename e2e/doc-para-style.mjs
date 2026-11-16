// 서식 막대 문단 스타일 칸 (워드 스타일 갤러리): 본문 · 제목 1~4 · 인용 · 코드 · 콜아웃 — 하나만, 고르면 감싼 인용 · 콜아웃을 풀고 새 모양.
// 사용: dev 서버 실행 후 `node e2e/doc-para-style.mjs`
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
/** 글 상자 문서의 겉모양: 맨 위 노드 종류 (감싼 것이면 '종류>안쪽') */
const shape = () => ws(() => {
  for (const c of window.__dn.view.engine.contents()) {
    const n = c.doc?.content?.[0];
    if (n) return n.content?.[0]?.type && ['blockquote', 'callout'].includes(n.type) ? `${n.type}>${n.content[0].type}` : n.type === 'heading' ? `h${n.attrs.level}` : n.type;
  }
  return '';
});
const text = () => ws(() => [...window.__dn.view.engine.contents()].map((c) => JSON.stringify(c.doc).match(/"text":"([^"]*)"/g)?.join('')).join('|'));
const sel = page.locator('.doc-ribbon select[aria-label="문단 스타일"]');

await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(() => window.__dn.newNote());
await wait(300);
await ws(() => window.__dn.setViewMode('doc'));
await wait(400);
await page.locator('.dn-doc-page').click({ position: { x: 300, y: 200 } });
await wait(200);
await page.keyboard.type('스타일 글');
await wait(200);

const opts = await sel.locator('option').allInnerTexts();
check('스타일 칸: 본문 · 제목 1~4 · 인용 · 코드 · 콜아웃', JSON.stringify(opts) === JSON.stringify(['본문', '제목 1', '제목 2', '제목 3', '제목 4', '인용', '코드', '콜아웃']), JSON.stringify(opts));
for (const [v, want, label] of [['quote', 'blockquote>paragraph', '인용'], ['callout', 'callout>paragraph', '인용 → 콜아웃 (감싼 것은 하나만)'], ['h2', 'h2', '콜아웃 → 제목 2 (콜아웃을 벗김)'], ['code_block', 'code_block', '제목 2 → 코드'], ['quote', 'blockquote>paragraph', '코드 → 인용 (안은 본문)'], ['paragraph', 'paragraph', '인용 → 본문 (인용을 벗김)']]) {
  await sel.selectOption(v);
  await wait(250);
  const sh = await shape(), shown = await sel.inputValue();
  check(`${label}: 문서 ${want} · 칸은 '${v}'`, sh === want && shown === v, JSON.stringify({ sh, shown }));
}
// 고른 뒤에도 편집기에 초점 — 이어 치면 그 글에
await page.keyboard.press('End');
await page.keyboard.type('!');
await wait(250);
check('스타일을 고른 뒤 이어 치면 같은 글에', (await text()).includes('스타일 글!'), await text());
// 실행 취소 한 번에 한 단계
await page.keyboard.press('Control+z');
await wait(250);
await page.keyboard.press('Control+z');
await wait(250);
check('실행 취소 → 인용으로 돌아감 (스타일 바꾸기 한 번 = 한 단계)', (await shape()) === 'blockquote>paragraph', await shape());

check('콘솔 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close();
const bad = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
