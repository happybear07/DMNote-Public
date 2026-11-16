// 글꼴 (워드 · 노션): 문서 서식 막대의 글꼴 칸 — 글자를 골랐으면 고른 글자만 명조 · 고정폭, 아니면 상자 전체.
// 캔버스 오른쪽 클릭 › 글자의 글꼴 줄도 같게. 화면 글꼴이 실제로 바뀌는지(computed font-family)까지.
// 사용: dev 서버 실행 후 `node e2e/font-family.mjs`
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
const runs = () => ws(() => { const out = []; for (const c of window.__dn.view.engine.contents()) { const walk = (n) => { if (n.text !== undefined) out.push([n.text, (n.marks ?? []).find((x) => x.type === 'fontFamily')?.attrs.family ?? null]); (n.content ?? []).forEach(walk); }; if (c.doc) walk(c.doc); } return out; });
const selectLeft = async (n) => { for (let i = 0; i < n; i++) await page.keyboard.press('Shift+ArrowLeft'); await wait(200); };

await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(() => window.__dn.newNote());
await wait(300);
await ws(() => window.__dn.setViewMode('doc'));
await wait(400);
await page.locator('.dn-doc-page').click({ position: { x: 300, y: 200 } });
await wait(200);
await page.keyboard.type('고딕 명조 끝');
for (let i = 0; i < 2; i++) await page.keyboard.press('ArrowLeft');
await selectLeft(2); // "명조"
const ff = page.locator('.doc-ribbon .fc-btn'); // 글꼴은 지금 글꼴 단추 — 누르면 목록 (알파 10/31)
const pickFont = async (name) => { await ff.click(); await page.locator('.doc-ribbon .fc-list [role="option"]', { hasText: name }).click(); };
await pickFont('명조');
await wait(250);
let r = await runs();
check('고른 "명조"만 명조 표시', JSON.stringify(r) === JSON.stringify([['고딕 ', null], ['명조', 'serif'], [' 끝', null]]), JSON.stringify(r));
const fam = await ws(() => getComputedStyle(document.querySelector('.dn-doc span[data-ff="serif"]')).fontFamily);
check('화면 글꼴이 명조 계열', /Serif|Myeongjo|Batang|serif/i.test(fam), fam);
await page.keyboard.press('End');
await wait(100);
check('고르지 않으면 상자 글꼴 칸 (기본)', (await ff.innerText()).includes('기본 (고딕)'), await ff.innerText());
await pickFont('고정폭');
await wait(250);
const bf = await ws(() => [...window.__dn.view.engine.blocks()][0]?.fontFamily ?? null);
const itemFam = await ws(() => getComputedStyle(document.querySelector('.dn-doc .dn-doc-item.dn-ff-mono .dn-text p') ?? document.body).fontFamily);
check('상자 전체 고정폭 (블록 필드) · 화면도 고정폭', bf === 'mono' && /Consolas|Mono|D2Coding|monospace/i.test(itemFam), `${bf} ${itemFam}`);
await ws(() => window.__dn.view.engine.undo());
await wait(250);
check('실행 취소 → 상자 글꼴 기본', (await ws(() => [...window.__dn.view.engine.blocks()][0]?.fontFamily ?? null)) === null);

// 캔버스 오른쪽 클릭 › 글자 › 글꼴
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
await ws(() => window.__dn.setViewMode('canvas'));
await wait(400);
await ws(() => { const v = window.__dn.view; v.select([]); v.addBlockAtCenter(); });
await wait(250);
await page.keyboard.type('캔버스 코드');
await selectLeft(2);
const box = await page.locator('.dn-block .dn-text-editing').last().boundingBox();
await page.mouse.click(box.x + box.width - 14, box.y + box.height / 2, { button: 'right' });
await wait(300);
await page.locator('.menu .fc-btn').click();
await page.locator('.menu .fc-list [role="option"]', { hasText: '고정폭' }).click();
await wait(250);
r = await runs();
check('캔버스 메뉴 고정폭 → 고른 "코드"만', r.some(([t, f]) => t === '코드' && f === 'mono') && r.some(([t, f]) => t.startsWith('캔버스') && f === null), JSON.stringify(r.slice(-2)));
check('콘솔 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close();
const bad = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
