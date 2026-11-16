// 문서 뷰 '클릭하여 입력' (워드): 글 아래 빈 곳을 두 번 누르면 그 높이에 커서 — 친 글이 누른 자리에 나타남, 가운데 · 오른쪽 띠는 맞춤, 왼쪽은 들여쓰기,
// 글을 치지 않고 떠나면 빈 줄 상자는 사라짐, 글 위 두 번 누르기는 그대로(새 상자 없음), 쪽 보기에서도.
// 사용: dev 서버 실행 후 `node e2e/doc-click-type.mjs [스크린샷 폴더]`
import { chromium } from 'playwright-core';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2];
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const browser = await chromium.launch({ channel: process.env.DN_CHANNEL ?? 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await ctx.addInitScript(() => localStorage.setItem('dn:no-env-key', '1'));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });
const ws = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);

await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
const fresh = async (pages) => {
  await ws(() => window.__dn.newNote({ sheet: null }));
  await page.waitForFunction(() => window.__dn.view.engine.blockCount === 0);
  await ws((pages) => {
    window.__dn.view.engine.transact((tx) => {
      const b = tx.createBlock({ x: 0, y: 0, w: 600, h: 40 });
      tx.createContent({ blockId: b, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '첫 문단입니다.' }] }] } });
    }, { origin: 'user' });
    window.__dn.setDocPages(pages);
    window.__dn.setViewMode('doc');
  }, pages);
  await wait(700);
};
const text = () => page.locator('.dn-doc .dn-doc-item', { hasText: '첫 문단입니다.' }).boundingBox();
const area = () => ws(() => { const p = document.querySelector('.dn-doc .dn-doc-page'), r = p.getBoundingClientRect(), cs = getComputedStyle(p); return { left: r.left + parseFloat(cs.paddingLeft), w: r.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) }; });
const blocks = () => ws(() => [...window.__dn.view.engine.blocks()].map((b) => ({ id: b.id, y: b.y, align: b.align ?? null, indent: b.indent ?? 0, draft: !!b.draft, lines: window.__dn.view.engine.contentsOf(b.id)[0]?.doc?.content?.length ?? 0 })));

for (const pages of [false, true]) {
  const tag = pages ? '쪽 보기' : '이어 보기';
  await fresh(pages);
  const t = await text(), a = await area();
  // 1. 왼쪽 아래 멀리 두 번 → 그 높이에 글
  const y1 = t.y + t.height + 220;
  await page.mouse.dblclick(a.left + 4, y1);
  await wait(400);
  await page.keyboard.type('여기에 씁니다');
  await wait(400);
  const line = await page.locator('.dn-doc p', { hasText: '여기에 씁니다' }).boundingBox();
  check(`${tag}: 빈 곳 두 번 → 친 글이 누른 높이에`, !!line && Math.abs(line.y + line.height / 2 - y1) < line.height * 1.2, JSON.stringify({ y1, line }));
  let bs = await blocks();
  const nb = bs[bs.length - 1];
  check(`${tag}: 새 문단 하나 (빈 줄 + 글) · 캔버스에 나타남(초안 아님) · 왼쪽 끝은 들여쓰기 없음`, bs.length === 2 && nb.lines > 3 && !nb.draft && nb.indent === 0 && nb.align === null, JSON.stringify(nb));
  if (OUT) await page.screenshot({ path: `${OUT}/click-type-${pages ? 'paged' : 'flow'}.png` });
  // 2. 가운데 띠 → 가운데 맞춤
  const yb = (await page.locator('.dn-doc .dn-doc-item').last().boundingBox());
  await page.mouse.dblclick(a.left + a.w / 2, yb.y + yb.height + 120);
  await wait(400);
  await page.keyboard.type('가운데');
  await wait(300);
  bs = await blocks();
  check(`${tag}: 가운데 띠 → 가운데 맞춤`, bs[bs.length - 1].align === 'center', JSON.stringify(bs[bs.length - 1]));
  // 3. 오른쪽 끝 띠 → 오른쪽 맞춤
  const yc = (await page.locator('.dn-doc .dn-doc-item').last().boundingBox());
  await page.mouse.dblclick(a.left + a.w - 10, yc.y + yc.height + 80);
  await wait(400);
  await page.keyboard.type('오른쪽');
  await wait(300);
  bs = await blocks();
  check(`${tag}: 오른쪽 끝 → 오른쪽 맞춤`, bs[bs.length - 1].align === 'right', JSON.stringify(bs[bs.length - 1]));
  // 4. 왼쪽에서 100px → 들여쓰기 4단계
  const yd = (await page.locator('.dn-doc .dn-doc-item').last().boundingBox());
  await page.mouse.dblclick(a.left + 100, yd.y + yd.height + 60);
  await wait(400);
  await page.keyboard.type('들여씀');
  await wait(300);
  bs = await blocks();
  check(`${tag}: 왼쪽에서 들어가 누르면 그만큼 들여쓰기`, bs[bs.length - 1].indent === 4, JSON.stringify(bs[bs.length - 1]));
  // 5. 치지 않고 떠나면 사라짐
  const before = bs.length;
  const ye = (await page.locator('.dn-doc .dn-doc-item').last().boundingBox());
  await page.mouse.dblclick(a.left + 10, ye.y + ye.height + 150);
  await wait(400);
  await page.locator('.dn-doc .dn-doc-item', { hasText: '첫 문단입니다.' }).locator('.dn-doc-text').click();
  await wait(500);
  check(`${tag}: 글을 치지 않고 떠나면 빈 줄 상자는 사라짐`, (await blocks()).length === before, String((await blocks()).length));
  // 6. 글 위 두 번 누르기는 그대로
  await page.locator('.dn-doc p', { hasText: '첫 문단입니다.' }).dblclick();
  await wait(400);
  check(`${tag}: 글 위 두 번 누르기는 새 상자를 만들지 않음`, (await blocks()).length === before);
}
// 항목 사이 틈 · 짧은 제목 옆: 제목 / 둘째 / 묶음(셋째 · 넷째) / 다섯째
const gapNote = async (pages) => {
  await ws(() => window.__dn.newNote({ sheet: null }));
  await page.waitForFunction(() => window.__dn.view.engine.blockCount === 0);
  const ids = await ws((pages) => {
    const P = (t) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });
    const r = window.__dn.view.engine.transact((tx) => {
      const mk = (y, role, t, extra = {}) => { const b = tx.createBlock({ x: 0, y, w: 600, h: 40, ...extra }); tx.createContent({ blockId: b, type: 'text', role, doc: P(t) }); return b; };
      return { a: mk(0, 'title', '짧은 제목'), b: mk(56, 'body', '둘째 상자'), c: mk(112, 'body', '묶음 첫째', { group: 'g1' }), d: mk(168, 'body', '묶음 둘째', { group: 'g1' }), f: mk(224, 'body', '다섯째 상자') };
    }, { origin: 'user' }).value;
    window.__dn.setDocPages(pages);
    window.__dn.setViewMode('doc');
    return r;
  }, pages);
  await wait(700);
  return ids;
};
const box = (t) => page.locator('.dn-doc .dn-doc-item', { hasText: t }).first().boundingBox();
const docTexts = () => ws(() => [...document.querySelectorAll('.dn-doc .dn-doc-item')].map((el) => el.textContent.trim()));
const ys = (ids) => ws((ids) => ids.map((id) => window.__dn.view.engine.getBlock(id)?.y), ids);
const inDoc = () => ws(() => { const h = document.querySelector('.doc-host'); return !!h && getComputedStyle(h).display !== 'none'; });
for (const pages of [false, true]) {
  const tag = pages ? '쪽 보기' : '이어 보기';
  let ids = await gapNote(pages);
  // 짧은 제목 옆 빈 곳: 캔버스로 넘어가지 않고 그 제목 끝에 커서
  const ha = await box('짧은 제목');
  await page.mouse.dblclick(ha.x + ha.width - 20, ha.y + ha.height / 2);
  await wait(400);
  check(`${tag}: 짧은 제목 옆 빈 곳 두 번 → 문서에 그대로 · 새 상자 없음`, (await inDoc()) && (await blocks()).length === 5, String((await blocks()).length));
  await page.keyboard.type('!');
  await wait(300);
  check(`${tag}: … 그 제목 끝에 커서`, (await docTexts()).some((t) => t.includes('짧은 제목!')), JSON.stringify(await docTexts()));
  // 둘째와 셋째 사이 틈 → 그 자리에 새 상자, 아래 상자는 내림(캔버스에서 겹치지 않게)
  let hb = await box('둘째 상자'), hc = await box('묶음 첫째');
  await page.mouse.dblclick(hb.x + 40, (hb.y + hb.height + hc.y) / 2);
  await wait(400);
  if (OUT) await page.screenshot({ path: `${OUT}/click-type-gap-${pages ? 'paged' : 'flow'}.png` });
  check(`${tag}: 상자 사이 틈 두 번 → 새 초안 상자 (캔버스에는 아직 없음)`, (await blocks()).length === 6 && (await blocks()).some((b) => b.draft), JSON.stringify(await blocks()));
  await page.keyboard.type('사이에 씀');
  await wait(400);
  let order = await docTexts();
  check(`${tag}: 친 글이 둘째와 셋째 사이에`, order.findIndex((t) => t.includes('사이에 씀')) === order.findIndex((t) => t.includes('둘째 상자')) + 1, JSON.stringify(order));
  const nb = await ws(() => { const e = window.__dn.view.engine; const b = [...e.blocks()].find((x) => JSON.stringify(e.contentsOf(x.id)[0]?.doc ?? '').includes('사이에 씀')); return b && { y: b.y, h: b.h, draft: !!b.draft, group: b.group ?? null, indent: b.indent ?? 0, align: b.align ?? null }; });
  const [cy] = await ys([ids.c]);
  check(`${tag}: 글이 들어오면 캔버스에 나타남 · 아래 상자와 겹치지 않음 · 묶음 밖 · 들여쓰기 · 맞춤 없음`, !!nb && !nb.draft && nb.y + nb.h <= cy && nb.group === null && nb.indent === 0 && nb.align === null, JSON.stringify({ nb, cy }));
  // 묶음 안 틈 → 새 상자도 그 묶음에
  hc = await box('묶음 첫째');
  const hd = await box('묶음 둘째');
  await page.mouse.dblclick(hc.x + 40, (hc.y + hc.height + hd.y) / 2);
  await wait(400);
  await page.keyboard.type('묶음 안');
  await wait(400);
  order = await docTexts();
  const g = await ws(() => { const e = window.__dn.view.engine; return [...e.blocks()].find((x) => JSON.stringify(e.contentsOf(x.id)[0]?.doc ?? '').includes('묶음 안'))?.group ?? null; });
  check(`${tag}: 묶음 안 틈 → 새 상자도 그 묶음 · 그 자리`, g === 'g1' && order.findIndex((t) => t.includes('묶음 안')) === order.findIndex((t) => t.includes('묶음 첫째')) + 1, JSON.stringify({ g, order }));
  // 치지 않고 떠나면 사라지고, 내렸던 아래 상자는 제자리로
  ids = await gapNote(pages);
  const y0 = await ys([ids.b, ids.c, ids.d, ids.f]);
  const ha2 = await box('짧은 제목'), hb2 = await box('둘째 상자');
  await page.mouse.dblclick(hb2.x + 40, (ha2.y + ha2.height + hb2.y) / 2);
  await wait(400);
  check(`${tag}: 제목 아래 틈 → 새 초안 (아래 상자는 내려감)`, (await blocks()).length === 6 && (await ys([ids.b]))[0] > y0[0], JSON.stringify(await ys([ids.b])));
  await page.locator('.dn-doc p', { hasText: '다섯째 상자' }).click();
  await wait(500);
  const y1 = await ys([ids.b, ids.c, ids.d, ids.f]);
  check(`${tag}: 글 없이 떠나면 새 상자는 사라지고 아래 상자는 제자리`, (await blocks()).length === 5 && y1.every((y, k) => y === y0[k]), JSON.stringify({ y0, y1 }));
}
check('콘솔 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close();
const bad = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
