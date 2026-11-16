// 빈 곳 화살표 (11/09 갈아엎음): 화살표 도구로 빈 곳에서 빈 곳으로 · 상자에서 빈 곳으로 그어도 빈 상자를 만들지 않고 끝이 그 점에 —
// 상자 위에 놓으면 상자에 잇고, 고른 화살표의 끝을 빈 곳으로 끌면 상자에서 떼어지고, 점 끝 화살표는 몸통을 끌어 옮긴다(실행 취소 한 번).
// 그냥 누르기만 하면 긋지 않는다 · 상자를 지우면 붙은 화살표만 같이 지워진다 · 문서 보기는 그대로 열린다. (복사 · 붙여넣기의 점 끝은 단위 테스트 free-arrow.test.ts)
// 사용: dev 서버 실행 후 `node e2e/free-arrow.mjs [스크린샷 폴더]`
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

// 화면의 '새 노트'(A4 · 표지) → 1쪽에 상자 둘
await page.locator('.note-item.add').first().click();
await wait(800);
const [A, B] = await ws(() => window.__dn.view.engine.transact((tx) => {
  const mk = (x, y, t) => { const b = tx.createBlock({ x, y, w: 220, h: 60 }); tx.createContent({ blockId: b, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] } }); return b; };
  return [mk(60, 80, '첫 상자'), mk(60, 420, '둘째 상자')];
}, { origin: 'user' }).value);
await ws(() => window.__dn.view.setCamera({ x: -40, y: -40, zoom: 1 }));
await wait(300);
const scr = (p) => ws((p) => { const v = window.__dn.view, s = v.toScreen(p), r = v.root.getBoundingClientRect(); return { x: r.left + s.x, y: r.top + s.y }; }, p);
const state = () => ws(() => { const e = window.__dn.view.engine; return { blocks: e.blockCount, arrows: [...e.arrows()].map((a) => ({ id: a.id, from: a.from, to: a.to })) }; });
const drag = async (p, q, steps = 10) => { await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(q.x, q.y, { steps }); await page.mouse.up(); await wait(200); };
const arrowTool = async () => { await page.keyboard.press('Escape'); await page.keyboard.press('a'); await wait(80); };
const near = (a, b, tol = 2) => Math.abs(a - b) <= tol;
const s0 = await state();

// 1) 빈 곳 → 빈 곳: 상자 없이 두 끝이 점
await page.locator('.canvas-host').focus();
await arrowTool();
await drag(await scr({ x: 400, y: 120 }), await scr({ x: 650, y: 120 }));
let s = await state();
const free = s.arrows.find((a) => a.from.point && a.to.point);
check('빈 곳에서 빈 곳으로 그으면 두 끝이 점인 화살표 · 상자는 그대로', !!free && s.blocks === s0.blocks && near(free.from.point.x, 400) && near(free.to.point.x, 650), JSON.stringify(s));
check('… 한 번 그으면 고르기 도구로 · 그 화살표를 고름', (await ws(() => window.__dn.view.tool)) === 'select' && (await ws(() => [...window.__dn.view.selArrows]))[0] === free?.id);
await page.screenshot({ path: `${OUT}/free-arrow-empty.png` });

// 2) 그냥 누르기만 하면 긋지 않는다
await arrowTool();
const p0 = await scr({ x: 500, y: 300 });
await page.mouse.click(p0.x, p0.y);
await wait(200);
check('화살표 도구로 빈 곳을 그냥 누르면 아무것도 안 생김', (await state()).arrows.length === s.arrows.length);

// 3) 상자 → 빈 곳: 반쪽 화살표, 새 상자 없음
await arrowTool();
await drag(await scr({ x: 170, y: 110 }), await scr({ x: 560, y: 260 }));
s = await state();
const half = s.arrows.find((a) => a.from.blockId === A && a.to.point);
check('상자에서 빈 곳으로 그으면 끝이 그 점 — 빈 상자를 만들지 않음', !!half && s.blocks === s0.blocks, JSON.stringify(s));

// 4) 상자 → 상자: 상자끼리 잇기
await arrowTool();
await drag(await scr({ x: 170, y: 110 }), await scr({ x: 170, y: 450 }));
s = await state();
const bound = s.arrows.find((a) => a.from.blockId === A && a.to.blockId === B);
check('상자 위에 놓으면 그 상자에 이음', !!bound, JSON.stringify(s.arrows));

// 5) 고른 반쪽 화살표의 점 끝을 둘째 상자 위로 → 상자에 붙음, 다시 빈 곳으로 → 떼어짐
await page.keyboard.press('Escape');
await ws((id) => { const v = window.__dn.view; v.selBlocks.clear(); v.selArrows.clear(); v.selArrows.add(id); v.requestRender?.(); }, half.id);
await wait(150);
await drag(await scr({ x: 560, y: 260 }), await scr({ x: 200, y: 450 }));
let ha = (await state()).arrows.find((a) => a.id === half.id);
check('고른 화살표의 점 끝을 상자 위로 끌면 그 상자에 붙음', ha?.to.blockId === B, JSON.stringify(ha));
const bEnd = await ws((id) => { const v = window.__dn.view; return v.engine.arrowGeometry(v.engine.getArrow(id)).b; }, half.id);
await drag(await scr(bEnd), await scr({ x: 600, y: 600 }));
ha = (await state()).arrows.find((a) => a.id === half.id);
check('… 그 끝을 빈 곳으로 끌면 상자에서 떼어져 점이 됨', !!ha?.to.point && near(ha.to.point.x, 600, 1) && near(ha.to.point.y, 600, 1), JSON.stringify(ha));

// 6) 두 끝이 점인 화살표 몸통 끌기 → 통째로 옮김, 실행 취소 한 번에 제자리
const empty = await scr({ x: 720, y: 400 });
await page.mouse.click(empty.x, empty.y);
await wait(100);
const mid = await scr({ x: 525, y: 120 });
await drag(mid, { x: mid.x + 60, y: mid.y + 200 }, 12);
const moved = (await state()).arrows.find((a) => a.id === free.id);
check('빈 곳 화살표 몸통을 끌면 두 점이 같이 움직임', near(moved.from.point.x, 460) && near(moved.from.point.y, 320) && near(moved.to.point.x, 710), JSON.stringify(moved));
await page.keyboard.press('Control+z');
await wait(200);
const back = (await state()).arrows.find((a) => a.id === free.id);
check('… 실행 취소 한 번에 제자리', near(back.from.point.x, 400, 1) && near(back.from.point.y, 120, 1), JSON.stringify(back));
await page.screenshot({ path: `${OUT}/free-arrow-moved.png` });

// 7) 상자끼리 화살표는 몸통을 끌어도 끝이 그대로
const bg = await ws((id) => { const v = window.__dn.view; return v.engine.arrowGeometry(v.engine.getArrow(id)).mid; }, bound.id);
await drag(await scr(bg), await scr({ x: bg.x + 100, y: bg.y }));
const bnd = (await state()).arrows.find((a) => a.id === bound.id);
check('상자끼리 화살표는 몸통을 끌어도 끝이 그대로', bnd?.from.blockId === A && bnd?.to.blockId === B);

// 8) 첫 상자를 지우면 그 상자에 붙은 화살표(상자끼리 · 반쪽)도 지워지고, 빈 곳 화살표는 남는다 · 실행 취소로 다 돌아옴
const pa = await scr({ x: 120, y: 100 });
await page.mouse.click(pa.x, pa.y);
await wait(100);
await page.keyboard.press('Delete');
await wait(250);
s = await state();
check('상자를 지우면 붙은 화살표는 같이 지워지고 빈 곳 화살표는 남음', s.blocks === s0.blocks - 1 && s.arrows.length === 1 && s.arrows[0].id === free.id, JSON.stringify(s));
await page.keyboard.press('Control+z');
await wait(250);
s = await state();
check('… 실행 취소하면 상자와 화살표 셋이 다 돌아옴', s.blocks === s0.blocks && s.arrows.length === 3 && !!s.arrows.find((a) => a.id === half.id)?.to.point, JSON.stringify(s));

// 9) 문서 보기 — 빈 곳 화살표는 관계가 아니다 (오류 없이 열림)
await ws(() => window.__dn.setViewMode('doc'));
await wait(900);
check('문서 보기가 오류 없이 열림', await ws(() => !!document.querySelector('.dn-doc-page')));
await ws(() => window.__dn.setViewMode('canvas'));
await wait(300);

check('콘솔 · 페이지 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} 통과`);
process.exit(failed ? 1 : 0);
