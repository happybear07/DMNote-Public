// 슬래시(/) 명령 — 원본 docs/SLASH-COMMANDS.md (노션 명령 전부 + 내가 만든 명령): 캔버스 · 문서 뷰 모두,
// 묶음 머리 · 글자 색 · 배경 색 · 복제 · 날짜 언급 · 보드 데이터베이스 · 페이지(새 노트 링크) · 내 글 조각 · 제목 상자에서도.
// 사용: dev 서버 실행 후 `node e2e/slash-commands.mjs`
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
const slash = async (q) => { await page.keyboard.type('/'); await wait(120); await page.keyboard.type(q); await wait(220); await page.keyboard.press('Enter'); await wait(450); };
const blocks = () => ws(() => { const e = window.__dn.view.engine; return [...e.blocks()].sort((a, b) => a.y - b.y || a.x - b.x).map((b) => ({ id: b.id, tc: b.textColor ?? null, bg: b.style?.color ?? null, types: e.contentsOf(b.id).map((c) => c.type), doc: JSON.stringify(e.contentsOf(b.id)[0]?.doc ?? '') })); });

await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });

// ── 캔버스 ──
await ws(() => window.__dn.newNote());
await wait(300);
await ws(() => window.__dn.view.addBlockAtCenter());
await wait(200);
await page.keyboard.type('/');
await wait(200);
const heads = await page.locator('.dn-slash .dn-slash-head').allInnerTexts();
check('캔버스 / → 묶음 머리(노션처럼)', ['기본 블록', '글 속', '미디어', '데이터베이스', '블록 동작', '내가 만든 명령'].every((h) => heads.includes(h)), heads.join('|'));
await page.keyboard.type('빨강');
await wait(200);
const reds = await page.locator('.dn-slash .dn-slash-item').allInnerTexts();
check('찾는 중엔 머리 없이 맞는 것만', (await page.locator('.dn-slash .dn-slash-head').count()) === 0 && reds.length === 2, reds.join('|'));
await page.keyboard.press('Enter');
await wait(300);
let b = await blocks();
check('캔버스 /빨강 글자 → 이 블록 글자 색', b[0].tc === 'red', JSON.stringify(b[0]));
await slash('회의록');
b = await blocks();
check('캔버스 내 명령(/회의록) → 빈 줄이 회의록 틀로 (제목 · 할 일)', /"level":3},"content":\[\{"type":"text","text":"\d+년 \d+월 \d+일 회의"/.test(b[0].doc) && b[0].doc.includes('task_item'), b[0].doc.slice(0, 200));
await slash('복제');
b = await blocks();
check('캔버스 /복제 → 블록이 둘', b.length === 2, String(b.length));

// 제목 상자에서도 / (줄 모양 서식은 빠짐)
const tid = await ws(() => { const v = window.__dn.view; const r = v.engine.transact((tx) => { const id = tx.createBlock({ x: 0, y: -400, w: 300, h: 48 }); tx.createContent({ blockId: id, type: 'text', role: 'title', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '제목 ' }] }] } }); return id; }, { origin: 'user' }); v.endEditing(); v.startEditing(r.value, 'end'); return r.value; });
await wait(300);
await page.keyboard.type('/');
await wait(200);
const titleItems = await page.locator('.dn-slash .dn-slash-item').allInnerTexts();
check('제목 상자에서도 / 메뉴 (제목 1 · 목록 같은 줄 모양은 없음)', titleItems.length > 10 && !titleItems.some((t) => t.startsWith('제목 1') || t.startsWith('글머리')), `${titleItems.length}개`);
await page.keyboard.type('노랑 배경');
await wait(200);
await page.keyboard.press('Enter');
await wait(300);
check('제목 상자 /노랑 배경 → 배경 색', (await ws((id) => window.__dn.view.engine.getBlock(id).style?.color, tid)) === 'yellow');
await ws(() => window.__dn.view.endEditing());

// ── 문서 뷰 ──
await ws(() => window.__dn.newNote());
await wait(300);
await ws(() => window.__dn.setViewMode('doc'));
await wait(400);
await page.locator('.dn-doc-page').click({ position: { x: 300, y: 200 } });
await wait(200);
await page.keyboard.type('마감 ');
await slash('내일');
const dm = await ws(() => JSON.stringify([...window.__dn.view.engine.contents()][0]?.doc ?? ''));
const tomorrow = await ws(() => { const d = new Date(); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
check('문서 /내일 → 날짜 언급', dm.includes('date_mention') && dm.includes(tomorrow), dm.slice(0, 160));
await page.keyboard.press('Enter');
await page.keyboard.press('Enter');
await wait(250);
await slash('보드');
b = await blocks();
const board = await ws(() => { const c = [...window.__dn.view.engine.contents()].find((x) => x.type === 'database'); return c ? (c.views ?? []).find((v) => v.id === c.activeView)?.kind : null; });
check('문서 /보드 → 보드로 보이는 데이터베이스, 빈 줄은 안 남음', board === 'board' && b.length === 2, `${board} ${b.length}`);
await page.locator('.dn-doc-text').first().click();
await wait(200);
await page.keyboard.press('End');
await page.keyboard.press('Enter');
await page.keyboard.press('Enter');
await wait(250);
await page.keyboard.type('하위 ');
await slash('페이지');
await wait(500);
const link = await ws(() => [...window.__dn.view.engine.contents()].map((c) => JSON.stringify(c.doc ?? '')).find((s) => s.includes('note_link')) ?? '');
check('문서 /페이지 → 새 노트를 만들고 링크', link.includes('제목 없는 페이지'), link.slice(0, 160));

check('콘솔 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close();
const bad = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
