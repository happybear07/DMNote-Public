// QA 가벼운 항목 고침 회귀 (CANVAS-QA CQ-012 · 013 · 014 · 016 · 017 · 022 · 023, DOC-QA DQ-030 · 031 · 032 · 033).
// 사용: dev 서버 실행 후 `node e2e/qa-minor.mjs`
import { chromium } from 'playwright-core';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const browser = await chromium.launch({ channel: process.env.DN_CHANNEL ?? 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => localStorage.setItem('dn:no-env-key', '1'));
const page = await ctx.newPage();
const errors = [], warns = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); if (m.type() === 'warning' && /allowfullscreen|Allow attribute/i.test(m.text())) warns.push(m.text()); });
await page.route(/youtube-nocookie\.com/, (r) => r.fulfill({ contentType: 'text/html', body: '<html></html>' }));
const ws = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
const para = (t) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });

await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(() => window.__dn.newNote({ sheet: null }));
await wait(300);
const id = await ws(() => { const v = window.__dn.view; const r = v.engine.transact((tx) => { const b = tx.createBlock({ x: 0, y: 0, w: 300, h: 56 }); tx.createContent({ blockId: b, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '상자' }] }] } }); return b; }, { origin: 'user' }); v.fit?.(true); return r.value; });
await wait(400);

// CQ-012: 확대 단추를 누른 뒤에도 캔버스 단축키
await ws(() => window.__dn.view.root.focus());
await page.locator('.zoom button[aria-label="확대"]').click();
await page.keyboard.press('b');
check('CQ-012 확대 단추 뒤 B → 내용 상자 도구', (await ws(() => window.__dn.view._tool)) === 'block');
await page.keyboard.press('v');

// CQ-013: 편집 중 오른쪽 클릭 메뉴 → Esc → 편집은 그대로
await ws((id) => window.__dn.view.startEditing(id, 'end'), id);
await wait(200);
const tb = await page.locator('.dn-block .dn-text-editing').boundingBox();
await page.mouse.click(tb.x + 10, tb.y + 8, { button: 'right' });
await wait(250);
const menuOpen = (await page.locator('.menu').count()) > 0;
await page.keyboard.press('Escape');
await wait(250);
check('CQ-013 편집 중 메뉴 Esc → 메뉴만 닫히고 편집 그대로', menuOpen && (await ws(() => window.__dn.view.editingId)) === id);

// CQ-014: 편집 중 Ctrl+D → 그 블록 복제
const n0 = await ws(() => window.__dn.view.engine.blockCount);
await page.keyboard.press('Control+d');
await wait(250);
check('CQ-014 편집 중 Ctrl+D → 블록 복제', (await ws(() => window.__dn.view.engine.blockCount)) === n0 + 1);
await page.keyboard.press('Escape');

// CQ-016 · CQ-017: 표 빈 칸 자리표시 없음 · 새 열 이름
const tid = await ws(() => { const v = window.__dn.view; const r = v.engine.transact((tx) => { const b = tx.createBlock({ x: 0, y: 300, w: 300, h: 80 }); tx.createContent({ blockId: b, type: 'table', columns: [{ id: 'c1', name: '열1' }, { id: 'c2', name: '열2' }], rows: [{ id: 'r1', order: 'a0', cells: {} }] }); return b; }, { origin: 'user' }); return r.value; });
await wait(400);
await ws((tid) => { const v = window.__dn.view; v.focusBlock?.(tid); }, tid);
await wait(400);
await page.locator('.canvas-host td[data-row="r1"][data-col="c1"]').dblclick();
await wait(250);
const ph = await ws(() => { const el = document.querySelector('.canvas-host td.dn-cell-editing [data-placeholder], .canvas-host td.dn-cell-editing .dn-empty'); return el ? getComputedStyle(el, '::before').content : 'none'; });
check('CQ-016 표 빈 칸에 "제목" 자리표시 없음', !/제목/.test(ph), ph);
await page.locator('.canvas-host .dn-table-tools button', { hasText: '＋ 열' }).click();
await wait(300);
const cols = await ws((tid) => window.__dn.view.engine.contentsOf(tid)[0].columns.map((c) => c.name), tid);
check('CQ-017 새 열 이름은 "새 열" (끼운 자리와 어긋나는 번호 없음)', JSON.stringify(cols) === JSON.stringify(['열1', '새 열', '열2']), JSON.stringify(cols));
await page.keyboard.press('Escape');

// CQ-022 · CQ-023: 임베드 경고 없음 · 넣기 메뉴 핀은 선 아이콘
await ws(() => { const v = window.__dn.view; v.engine.transact((tx) => { const b = tx.createBlock({ x: 400, y: 0, w: 480, h: 298 }); tx.createContent({ blockId: b, type: 'web', url: 'https://youtu.be/dQw4w9WgXcQ', view: 'embed' }); }, { origin: 'user' }); });
await wait(600);
check('CQ-022 임베드 iframe 경고 없음', warns.length === 0, warns.join(' | '));
await ws(() => window.__dn.view.select([]));
await page.locator('.toolbar .insert-btn').click();
await page.waitForSelector('.insert-menu');
const pinEmoji = await page.locator('.insert-menu').innerText();
check('CQ-023 넣기 메뉴에 색 이모지 핀 없음', !pinEmoji.includes('📌'));
await page.keyboard.press('Escape');

// ── 문서 뷰 ──
await ws(() => window.__dn.newNote({ sheet: null }));
await wait(300);
await ws(() => window.__dn.setViewMode('doc'));
await wait(400);
await page.locator('.dn-doc-page').click({ position: { x: 300, y: 200 } });
await wait(200);
await page.keyboard.type('형광 칠할 글');
for (let i = 0; i < 2; i++) await page.keyboard.press('Shift+ArrowLeft');
await wait(250);
// DQ-030: 고르기 막대의 인라인 코드 안내에 Ctrl+E 없음
const codeTitle = await page.locator('.dn-bubble:not([hidden]) button[title^="인라인 코드"]').getAttribute('title').catch(() => null);
check('DQ-030 문서 뷰 고르기 막대: 인라인 코드 안내에 Ctrl+E 없음', codeTitle === '인라인 코드', String(codeTitle));
// DQ-033: 배경 색 → 형광펜 꺼진 것으로 · 형광펜을 누르면 기본 형광으로 바뀜(배경 색은 지워지지 않고 바뀜)
await page.locator('.dn-bubble:not([hidden]) .dn-bubble-color').click();
await wait(150);
await page.locator('.dn-bubble:not([hidden]) .dn-color-sw[aria-label="배경 색: 파랑"]').click();
await wait(250);
const hlBtn = page.locator('.doc-ribbon button[aria-label^="형광펜"]');
const pressed = await hlBtn.getAttribute('aria-pressed').catch(() => null);
check('DQ-033 배경 색을 칠한 글 → 형광펜은 꺼진 것으로', pressed !== 'true', String(pressed));
await hlBtn.click();
await wait(250);
const hl = await ws(() => { const out = []; const walk = (n) => { if (n.text) out.push(...(n.marks ?? []).filter((m) => m.type === 'highlight').map((m) => m.attrs.color || 'default')); (n.content ?? []).forEach(walk); }; walk([...window.__dn.view.engine.contents()][0].doc); return out; });
check('DQ-033 형광펜을 누르면 기본 형광으로 바뀜', JSON.stringify(hl) === '["default"]', JSON.stringify(hl));
// DQ-032: 할 일에서 Ctrl+Enter → 체크 (쪽 나눔 아님)
await page.keyboard.press('End');
await page.keyboard.press('Enter');
await page.keyboard.type('[] 할 일 하나');
await wait(200);
await page.keyboard.press('Control+Enter');
await wait(250);
const task = await ws(() => { let checked = null; for (const c of window.__dn.view.engine.contents()) { const walk = (n) => { if (n.type === 'task_item') checked = n.attrs.checked; (n.content ?? []).forEach(walk); }; if (c.doc) walk(c.doc); } return { checked, breaks: [...window.__dn.view.engine.blocks()].filter((b) => b.pageBreak).length }; });
check('DQ-032 할 일에서 Ctrl+Enter → 체크 (쪽 나눔 없음)', task.checked === true && task.breaks === 0, JSON.stringify(task));
check('콘솔 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close();
const bad = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
