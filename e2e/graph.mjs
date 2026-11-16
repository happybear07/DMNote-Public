// 노트 관계 그래프 (FR-083): 노트 링크가 있는 노트만 상자로(연결 없는 노트는 켜서 보기), 링크 수만큼 크게, 지금 노트는 파랑,
// 상자를 누르면 그 노트로, 끌어서 옮기면 열리지 않음. 사용: dev 서버 실행 후 `node e2e/graph.mjs [폴더]`
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

// 노트 다섯: 허브(셋에 링크) · 갈래1 → 갈래2 · 외톨이 둘
const ids = {};
for (const name of ['허브', '갈래1', '갈래2', '외톨이', '외톨이2']) {
  ids[name] = await ws(async (t) => { await window.__dn.newNote(); await new Promise((r) => setTimeout(r, 200)); window.__dn.setTitle(t); return window.__dn.state.currentId; }, name);
}
async function link(from, targets) {
  await ws((id) => window.__dn.openById(id), ids[from]);
  await page.waitForTimeout(300);
  await ws((ts) => {
    const e = window.__dn.view.engine;
    e.transact((tx) => {
      const b = tx.createBlock({ x: 0, y: 0, w: 300, h: 80 });
      tx.createContent({ blockId: b, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'paragraph', content: ts.flatMap((t) => [{ type: 'note_link', attrs: { id: t.id, title: t.title } }, { type: 'text', text: ' ' }]) }] } });
    }, { origin: 'user' });
  }, targets.map((t) => ({ id: ids[t], title: t })));
  await page.waitForTimeout(900);
}
await link('허브', ['갈래1', '갈래2', '외톨이2']);
await link('갈래1', ['갈래2']);
// 외톨이2는 허브에게서 링크만 받는다 — 연결 있음. 외톨이는 진짜 외톨이
await ws((id) => window.__dn.openById(id), ids['허브']);
await page.waitForTimeout(400);

await page.locator('.side-nav .note-item', { hasText: '노트 그래프' }).click();
await page.waitForSelector('.graph-host .dn-block', { timeout: 5000 });
await page.waitForTimeout(400);
const titles = await page.locator('.graph-host .dn-block').allInnerTexts();
const has = (t) => titles.some((x) => x.trim() === t);
check('링크가 있는 노트만 상자로 (외톨이는 숨김)', ['허브', '갈래1', '갈래2', '외톨이2'].every(has) && !has('외톨이'), JSON.stringify(titles));
check('노트 · 링크 수 표시', (await page.locator('.graph-count').innerText()).includes('링크 4개'), await page.locator('.graph-count').innerText());
const widthOf = (t) => page.locator('.graph-host .dn-block', { hasText: new RegExp(`^${t}$`) }).first().evaluate((el) => el.getBoundingClientRect().width);
const [hubW, leafW] = [await widthOf('허브'), await widthOf('외톨이2')];
check('링크가 많은 노트가 더 크다 (허브 3 > 외톨이2 1)', hubW > leafW, JSON.stringify({ hubW, leafW }));
check('지금 노트(허브)는 파란색', await page.locator('.graph-host .dn-block', { hasText: /^허브$/ }).first().evaluate((el) => el.style.background.includes('blue')));
await page.screenshot({ path: `${OUT}/graph.png` });

await page.locator('.graph-orphans input').check();
await page.waitForTimeout(400);
// 노트가 많으면 멀리서 보는 모드(글자는 캔버스에 그림)라 DOM 글자 대신 수로 본다
const allCount = await page.locator('.graph-count').innerText();
check('연결 없는 노트도 보기 → 외톨이도', !allCount.includes('숨김') && Number(allCount.match(/노트 (\d+)개/)?.[1] ?? 0) >= 5, allCount);
await page.locator('.graph-orphans input').uncheck();
await page.waitForTimeout(400);

// 끌기는 열기가 아님 · 누르면 그 노트로
const box = await page.locator('.graph-host .dn-block', { hasText: /^갈래2$/ }).first().boundingBox();
await page.mouse.move(box.x + 10, box.y + 10);
await page.mouse.down();
await page.mouse.move(box.x + 120, box.y + 80, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(300);
check('끌어서 옮기면 열지 않는다', (await ws(() => window.__dn.state.page)) === 'graph');
const b2 = await page.locator('.graph-host .dn-block', { hasText: /^갈래2$/ }).first().boundingBox();
await page.mouse.click(b2.x + b2.width / 2, b2.y + b2.height / 2);
await page.waitForTimeout(500);
check('상자를 누르면 그 노트로', (await ws(() => window.__dn.state.page)) === 'note' && (await ws(() => window.__dn.state.currentId)) === ids['갈래2']);

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
