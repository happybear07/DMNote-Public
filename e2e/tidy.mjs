// 배치 다듬기 (서브 구조화) — 블록 메뉴 · 명령 팔레트, 줄 맞춤 · 고른 간격 · 라벨 자리 · 제목 폭 맞춤 · 모양 묶음은 그대로 · 실행 취소 한 번.
// 사용: dev 서버 실행 후 `node e2e/tidy.mjs [스크린샷 폴더]` (DN_URL로 주소 변경)
import { chromium } from 'playwright-core';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2] ?? '.';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ channel: process.env.DN_CHANNEL ?? 'msedge', headless: true }); // CI(리눅스)는 DN_CHANNEL=chrome
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push(m.text()); });
const ws = (fn, arg) => page.evaluate(fn, arg);

await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(() => window.__dn.newNote({ sheet: null }));
await wait(300);

// 비뚤게 놓은 사슬 a → b → c → d (b → c는 라벨), 위→아래 트리 p → x · y, 시간축 모양 묶음 t1 · t2 · t3 (엇갈린 자리 그대로여야 함)
const ids = await ws(() => {
  const e = window.__dn.view.engine;
  const doc = (t) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });
  const out = {};
  const box = (tx, k, x, y, group) => { const id = tx.createBlock({ x, y, w: 260, h: 44, layout: 'flow', sizing: 'auto', ...(group ? { group } : {}) }); tx.createContent({ type: 'text', blockId: id, role: 'title', doc: doc(k) }); out[k] = id; };
  e.transact((tx) => {
    tx.setNote({ groups: { ...(e.note.groups ?? {}), TL: { shape: 'timeline', bracket: 'none', name: '연표' } } });
    box(tx, '시작', 0, 0); box(tx, '둘째 단계', 330, 41); box(tx, '셋째', 640, -27); box(tx, '끝', 1010, 18);
    box(tx, '부모', 300, 400); box(tx, '왼쪽 자식', 0, 560); box(tx, '오른쪽 자식', 620, 590);
    box(tx, '1월', 0, 900, 'TL'); box(tx, '2월', 180, 980, 'TL'); box(tx, '3월', 360, 900, 'TL');
    const arrow = (a, b, label) => tx.createArrow({ from: { blockId: out[a], side: 'auto' }, to: { blockId: out[b], side: 'auto' }, ...(label ? { label } : {}) });
    arrow('시작', '둘째 단계'); arrow('둘째 단계', '셋째', '그래서 이어지는 결과'); arrow('셋째', '끝');
    arrow('부모', '왼쪽 자식'); arrow('부모', '오른쪽 자식');
  }, { origin: 'user' });
  return out;
});
await wait(500);
await ws(() => window.__dn.view.fit(false));
await wait(300);
await page.screenshot({ path: `${OUT}/tidy-01-before.png` });
const rect = (k) => ws((id) => { const b = window.__dn.view.engine.getBlock(id); return { x: b.x, y: b.y, w: b.w, h: b.h }; }, ids[k]);
const rects = async (ks) => Object.fromEntries(await Promise.all(ks.map(async (k) => [k, await rect(k)])));
const chain = ['시작', '둘째 단계', '셋째', '끝'];
const before = await rects(Object.keys(ids));

// 1) 블록 메뉴: 사슬만 골라 다듬기
await ws((list) => { const v = window.__dn.view; v.select(list); v['onBlockMenu']({ ids: list, x: 300, y: 200 }); }, chain.map((k) => ids[k]));
await wait(200);
const item = page.getByRole('menuitem', { name: '배치 다듬기' });
check('블록 메뉴(상자 여럿)에 "배치 다듬기"', await item.isVisible());
await item.click();
await wait(400);
check('알림: "상자 n개의 배치를 다듬었어요" + 실행 취소', (await page.locator('.toast').innerText().catch(() => '')).includes('배치를 다듬었어요') && (await page.locator('.toast button', { hasText: '실행 취소' }).count()) === 1);
const c1 = await rects(chain);
const cy = (r) => r.y + r.h / 2;
check('사슬이 한 줄로 (가운데 높이가 같다)', new Set(chain.map((k) => Math.round(cy(c1[k])))).size === 1, chain.map((k) => cy(c1[k])).join(','));
check('왼→오 차례는 그대로', chain.every((k, i) => i === 0 || c1[k].x > c1[chain[i - 1]].x));
const gap = (a, b) => c1[b].x - (c1[a].x + c1[a].w);
check('라벨 없는 사이는 같은 간격, 라벨 있는 사이는 라벨이 들어갈 만큼 넓게', gap('시작', '둘째 단계') === gap('셋째', '끝') && gap('둘째 단계', '셋째') > gap('시작', '둘째 단계') + 60,
  `${gap('시작', '둘째 단계')} · ${gap('둘째 단계', '셋째')} · ${gap('셋째', '끝')}`);
check('제목 상자는 글 폭에 맞게 줄어든다 (260 → 더 좁게) · 비슷한 것끼리 같은 폭', chain.every((k) => c1[k].w < 260) && new Set(chain.map((k) => c1[k].w)).size <= 2, chain.map((k) => c1[k].w).join(','));
const lines = await ws((list) => list.map((id) => window.__dn.view.mounted.get(id)?.el.querySelector('.dn-part-title p')?.getClientRects().length ?? 0), chain.map((k) => ids[k]));
check('줄인 제목 상자도 글이 한 줄 그대로', lines.every((n) => n <= 1), lines.join(','));
const others = await rects(['부모', '왼쪽 자식', '1월']);
check('고르지 않은 상자는 그대로', ['부모', '왼쪽 자식', '1월'].every((k) => JSON.stringify(others[k]) === JSON.stringify(before[k])));
await page.screenshot({ path: `${OUT}/tidy-02-chain.png` });

// 2) 실행 취소 한 번이면 처음대로
await page.locator('.toast button', { hasText: '실행 취소' }).click();
await wait(300);
const undone = await rects(chain);
check('실행 취소 한 번 → 처음 자리 · 폭', chain.every((k) => JSON.stringify(undone[k]) === JSON.stringify(before[k])), JSON.stringify(undone['시작']));

// 3) 명령 팔레트 (고른 것 없음 → 캔버스 전체)
await ws(() => window.__dn.view.select([]));
await page.locator('.canvas-host').click({ position: { x: 30, y: 30 } });
await page.keyboard.press('Control+Shift+P');
await wait(150);
await page.keyboard.type('배치 다듬기');
await wait(100);
check('명령 팔레트에 "배치 다듬기"', (await page.locator('[aria-label="명령 팔레트"] .cmd-row').first().innerText()).includes('배치 다듬기'));
await page.keyboard.press('Enter');
await wait(500);
const all = await rects(Object.keys(ids));
const cx = (r) => r.x + r.w / 2;
check('트리: 위→아래 그대로 — 부모는 두 자식 가운데 위, 자식은 한 줄', Math.abs(cx(all['부모']) - (cx(all['왼쪽 자식']) + cx(all['오른쪽 자식'])) / 2) <= 1
  && all['왼쪽 자식'].y === all['오른쪽 자식'].y && all['부모'].y + all['부모'].h < all['왼쪽 자식'].y && all['왼쪽 자식'].x < all['오른쪽 자식'].x);
const tl = ['1월', '2월', '3월'];
check('모양 묶음(시간축)은 안쪽 자리가 그대로 — 통째로만', tl.every((k) => all[k].x - all['1월'].x === before[k].x - before['1월'].x && all[k].y - all['1월'].y === before[k].y - before['1월'].y && all[k].w === 260));
const list = Object.values(all);
const hit = list.some((a, i) => list.some((b, j) => i < j && a.x < b.x + b.w && b.x < a.x + a.w && a.y - 4 < b.y + b.h && b.y - 4 < a.y + a.h));
check('다듬은 뒤 겹치는 상자 없음', !hit);
await ws(() => window.__dn.view.fit(false));
await wait(300);
await page.screenshot({ path: `${OUT}/tidy-03-all.png` });

// 4) 다시 다듬어도 (거의) 그대로
await page.keyboard.press('Control+Shift+P');
await wait(150);
await page.keyboard.type('배치 다듬기');
await page.keyboard.press('Enter');
await wait(500);
const again = await rects(Object.keys(ids));
const drift = Math.max(...Object.keys(ids).map((k) => Math.abs(again[k].x - all[k].x) + Math.abs(again[k].y - all[k].y)));
check('다시 다듬어도 그대로 (4px 안)', drift <= 4, `최대 ${drift}px`);

check('콘솔 · 페이지 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close();
const fails = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fails}/${results.length} 통과`);
process.exit(fails ? 1 : 0);
