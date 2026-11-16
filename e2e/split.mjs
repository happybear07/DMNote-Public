// 옆에 노트 (FR-153): 사이드바 "옆에 열기" · 빠른 전환 Shift+Enter → 오른쪽에 읽기로, 가운데 막대로 비율(끌기 · ←→, 기억),
// 오른쪽 블록을 끌어 왼쪽 캔버스에 놓으면 복사, 자리 바꾸기, 닫기, 좁은 화면에서는 열지 않음. 사용: dev 서버 실행 후 `node e2e/split.mjs [폴더]`
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

const mk = (title) => ws(async (t) => { await window.__dn.newNote(); await new Promise((r) => setTimeout(r, 200)); window.__dn.setTitle(t); return window.__dn.state.currentId; }, title);
const B = await mk('참고 자료');
await ws(() => {
  const e = window.__dn.view.engine;
  e.transact((tx) => {
    const b1 = tx.createBlock({ x: 0, y: 0, w: 300, h: 80 });
    tx.createContent({ blockId: b1, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '참고 문장: 금리는 단계적으로' }] }] } });
    const b2 = tx.createBlock({ x: 0, y: 200, w: 300, h: 80 });
    tx.createContent({ blockId: b2, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '두 번째 블록' }] }] } });
  }, { origin: 'user' });
});
await page.waitForTimeout(800);
const A = await mk('내 정리');
await page.waitForTimeout(800);
const sideState = () => ws(() => window.__dn.state.side);

// 사이드바 행 메뉴 "옆에 열기"
await page.locator('.note-item', { hasText: '참고 자료' }).first().click({ button: 'right' });
await page.locator('[role=menuitem]', { hasText: '옆에 열기' }).click();
await page.waitForSelector('.side-pane .dn-doc-item', { timeout: 5000 }).catch(() => {});
const sw = await page.locator('.side-pane').boundingBox(), cw = await page.locator('.canvas-wrap').boundingBox();
check('사이드바 "옆에 열기" → 오른쪽에 읽기로 · 왼쪽은 지금 노트', (await sideState())?.noteId === B && (await ws(() => window.__dn.state.currentId)) === A
  && (await page.locator('.side-pane').innerText()).includes('참고 문장') && cw.width > sw.width, JSON.stringify({ cw: cw.width, sw: sw.width }));
await page.screenshot({ path: `${OUT}/split.png` });

// 가운데 막대: 끌기 · 키보드 · 기억
const d = await page.locator('.split-divider').boundingBox();
await page.mouse.move(d.x + 3, d.y + 200);
await page.mouse.down();
await page.mouse.move(d.x - 200, d.y + 200, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(150);
const r1 = (await sideState()).ratio;
check('막대를 왼쪽으로 끌면 왼쪽 몫이 줄어든다', r1 < 0.5, String(r1));
await page.locator('.split-divider').focus();
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(100);
const r2 = (await sideState()).ratio;
check('←→로도 비율 조절 (5%씩)', Math.abs(r2 - (r1 + 0.05)) < 0.002, `${r1} → ${r2}`);

// 오른쪽 블록을 끌어 왼쪽 캔버스에 → 복사
const before = await ws(() => window.__dn.view.engine.blockCount);
await page.locator('.side-pane .dn-doc-item', { hasText: '참고 문장' }).dragTo(page.locator('.canvas-host'), { targetPosition: { x: 200, y: 200 } });
await page.waitForTimeout(400);
const copied = await ws(() => [...window.__dn.view.engine.blocks()].some((b) => JSON.stringify(window.__dn.view.engine.contentsOf(b.id)).includes('참고 문장')));
check('오른쪽 블록을 끌어 왼쪽 캔버스에 놓으면 복사 (원본 노트는 그대로)', copied && (await ws(() => window.__dn.view.engine.blockCount)) === before + 1);
await ws(() => window.__dn.view.root.focus());
await page.keyboard.press('Control+z');
await page.waitForTimeout(150);
check('복사도 실행 취소 한 번', (await ws(() => window.__dn.view.engine.blockCount)) === before);

// 자리 바꾸기
await page.locator('.side-head button[aria-label="자리 바꾸기"]').click();
await page.waitForTimeout(700);
check('자리 바꾸기 → 왼쪽 참고 자료 · 오른쪽 내 정리', (await ws(() => window.__dn.state.currentId)) === B && (await sideState())?.noteId === A);

// 빠른 전환 Shift+Enter
await page.keyboard.press('Control+p');
await page.waitForSelector('.search-row');
await page.keyboard.type('Claude API');
await page.waitForTimeout(200);
await page.keyboard.press('Shift+Enter');
await page.waitForTimeout(500);
const sample = await ws(() => window.__dn.state.notes.find((n) => n.title.includes('Claude API'))?.id);
check('빠른 전환에서 Shift+Enter → 옆에 열기', (await sideState())?.noteId === sample && (await ws(() => window.__dn.state.currentId)) === B);

// 다시 열어도 비율 기억
await page.locator('.side-head button[aria-label="옆 노트 닫기"]').click();
await page.waitForTimeout(150);
check('닫기', (await sideState()) === null && (await page.locator('.side-pane').count()) === 0);
await ws((id) => window.__dn.openSide(id), A);
await page.waitForTimeout(300);
check('다시 열면 비율 기억', Math.abs((await sideState()).ratio - r2) < 0.002, String((await sideState()).ratio));
await ws(() => window.__dn.closeSide());

// 좁은 화면에서는 열지 않음
await page.setViewportSize({ width: 700, height: 900 });
await page.waitForTimeout(200);
await ws((id) => window.__dn.openSide(id), A);
await page.waitForTimeout(200);
check('좁은 화면: 열지 않고 안내', (await sideState()) === null && (await page.locator('.toast').innerText().catch(() => '')).includes('화면이 좁아'));

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
