// 넣기 (툴바 ＋ · 빈 곳 오른쪽 클릭 · / · 슬래시 메뉴): 사진 · 파일 · 표(열 이름부터) · 그래프(데이터 창) · 데이터베이스 · 수식 · 코드 · 목록 · 콜아웃 · 인용 · 토글 · 구분선.
// 표 머리글 두 번 누르기 → 열 이름 고치기, 그래프 두 번 누르기 · 블록 메뉴 → 데이터 창(종류 · 제목 · 단위 · 값 표 · 스프레드시트 붙여넣기 · 잘못된 칸).
// 사용: dev 서버 실행 후 `node e2e/insert.mjs [스크린샷 폴더]`
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
await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(() => window.__dn.newNote());
await page.waitForTimeout(500);
// 페이지에서 그린 진짜 PNG (사진 넣기용)
const PNG = Buffer.from(await page.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 160; c.height = 90;
  const g = c.getContext('2d'); g.fillStyle = 'teal'; g.fillRect(0, 0, 160, 90);
  return [...new Uint8Array(await (await new Promise((r) => c.toBlob(r, 'image/png'))).arrayBuffer())];
}));

const contents = () => ws(() => [...window.__dn.view.engine.contents()].map((c) => ({ ...c })));
const byType = async (t) => (await contents()).filter((c) => c.type === t);
const cellText = (doc) => (doc?.content ?? []).flatMap((p) => (p.content ?? []).map((x) => x.text ?? '')).join('');
const insert = async (q) => {
  await page.locator('.toolbar .insert-btn').click();
  await page.waitForSelector('.insert-menu');
  await page.keyboard.type(q);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
};

// ── 메뉴 ──
await page.locator('.toolbar .insert-btn').click();
await page.waitForSelector('.insert-menu');
check('툴바 ＋ → 넣기 메뉴 (항목 25 · 묶음 4)', (await page.locator('.insert-item').count()) === 25 && (await page.locator('.insert-menu .menu-head').count()) === 4);
const box = await page.locator('.insert-menu').boundingBox();
const bar = await page.locator('.toolbar').boundingBox();
check('툴바에서 열면 툴바 위로 펼침', box.y + box.height <= bar.y + 2, JSON.stringify({ menuBottom: box.y + box.height, bar: bar.y }));
await page.screenshot({ path: `${OUT}/insert-menu.png` });
await page.keyboard.type('ㅅㅈ');
check('초성 검색 ㅅㅈ → 사진 맨 위', (await page.locator('.insert-item').first().innerText()).includes('사진'));
await page.keyboard.press('Escape');
check('Esc → 닫힘', (await page.locator('.insert-menu').count()) === 0);

// ── 표: 열 이름부터 → Tab으로 다음 열 → 마지막 열 뒤 Tab은 첫 칸 ──
await insert('표');
await page.waitForSelector('.dn-table-picker');
await page.locator('.dn-tp-cell[data-c="3"][data-r="3"]').hover();
check('표 크기 고르기 창 — 올린 칸까지 3 × 3 표시', (await page.locator('.dn-tp-cell.on').count()) === 9 && (await page.locator('.dn-tp-label').innerText()).startsWith('3 × 3'));
await page.locator('.dn-tp-cell[data-c="3"][data-r="3"]').click();
await page.waitForSelector('.dn-th-input');
check('표 넣기 → 첫 열 이름 입력 칸에 커서', await ws(() => document.activeElement?.classList.contains('dn-th-input')));
for (const [i, name] of ['이름', '점수', '메모'].entries()) {
  if (i) await page.waitForSelector('.dn-th-input');
  await page.keyboard.type(name);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(120);
}
await page.waitForSelector('td.dn-cell-editing');
await page.keyboard.type('철수');
await page.keyboard.press('Tab');
await page.keyboard.type('90');
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
let [tbl] = await byType('table');
const row0 = [...tbl.rows].sort((a, b) => (a.order < b.order ? -1 : 1))[0];
check('열 이름 3개 · 첫 행 칸', JSON.stringify(tbl.columns.map((c) => c.name)) === '["이름","점수","메모"]' && cellText(row0.cells[tbl.columns[0].id]) === '철수' && cellText(row0.cells[tbl.columns[1].id]) === '90',
  JSON.stringify(tbl.columns.map((c) => c.name)));
// 머리글 두 번 누르기 → 이름 고치기 → Enter → 실행 취소 한 번에 원래 이름
await page.locator('.dn-table th', { hasText: '점수' }).dblclick();
await page.waitForSelector('.dn-th-input');
await page.screenshot({ path: `${OUT}/insert-table-header.png` });
await page.keyboard.type('점수(100점)');
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
[tbl] = await byType('table');
check('머리글 두 번 누르기 → 열 이름 고치기 · Enter는 그 열 첫 칸으로', tbl.columns[1].name === '점수(100점)' && (await page.locator('td.dn-cell-editing').count()) === 1);
await page.keyboard.press('Escape');
await ws(() => window.__dn.view.root.focus());
await page.keyboard.press('Control+z');
await page.waitForTimeout(200);
[tbl] = await byType('table');
check('열 이름 바꾸기는 실행 취소 한 번', tbl.columns[1].name === '점수');
await page.locator('.dn-table th', { hasText: '메모' }).dblclick();
await page.waitForSelector('.dn-th-input');
await page.keyboard.type('비고');
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
[tbl] = await byType('table');
check('Esc는 이름을 그대로 둔다', tbl.columns[2].name === '메모' && (await page.locator('.dn-th-input').count()) === 0);

// ── 그래프: 데이터 창 ──
await ws(() => window.__dn.view.select([]));
await insert('그래프');
await page.waitForSelector('.chart-editor');
check('그래프 넣기 → 데이터 창 · 미리보기', (await page.locator('.chart-ed-preview svg').count()) === 1 && (await byType('chart')).length === 1);
await page.locator('.chart-editor .seg button', { hasText: '꺾은선' }).click();
await page.locator('.chart-ed-meta input').first().fill('월별 방문자');
await page.locator('.chart-ed-meta input').nth(1).fill('명');
// 스프레드시트에서 복사한 칸 붙여넣기 (항목 이름 칸부터)
await page.evaluate(() => {
  const input = document.querySelector('.chart-grid tbody tr td input');
  const dt = new DataTransfer();
  dt.setData('text/plain', '1월\t120\t80\n2월\t150\t95\n3월\t90\t130\n4월\t160\t140');
  input.focus();
  input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
});
await page.waitForTimeout(150);
check('붙여넣기 → 항목 4 · 계열 2로 늘어남', (await page.locator('.chart-grid tbody tr').count()) === 4 && (await page.locator('.chart-grid thead input').count()) === 2);
await page.locator('.chart-grid thead input').first().fill('방문');
await page.locator('.chart-grid thead input').nth(1).fill('가입');
const cell = page.locator('.chart-grid tbody tr').nth(1).locator('td input').nth(1);
await cell.fill('abc');
check('숫자가 아닌 칸 → 빨간 칸 · 저장 막힘', (await page.locator('.chart-grid input.bad').count()) === 1 && await page.locator('.chart-editor .btn.primary').isDisabled());
await cell.fill('1,500');
await page.screenshot({ path: `${OUT}/insert-chart-editor.png` });
await page.locator('.chart-editor .btn.primary').click();
await page.waitForTimeout(250);
let [ch] = await byType('chart');
check('저장 → 꺾은선 · 제목 · 단위 · 계열 2 × 점 4 (쉼표 수)', ch.kind === 'line' && ch.title === '월별 방문자' && ch.unit === '명' && ch.series.length === 2
  && ch.series[0].name === '방문' && ch.series[0].points.length === 4 && ch.series[0].points[1].y === 1500 && ch.series[1].points[3].y === 140,
  JSON.stringify(ch.series.map((s) => [s.name, s.points.map((p) => `${p.x}:${p.y}`).join(' ')])));
await ws(() => window.__dn.view.root.focus());
await page.keyboard.press('Control+z');
await page.waitForTimeout(150);
[ch] = await byType('chart');
check('실행 취소 한 번 → 넣을 때 데이터로', ch.kind === 'bar' && ch.series.length === 1 && ch.title === '새 그래프');
await page.keyboard.press('Control+Shift+z');
await page.waitForTimeout(150);
const chartBlock = await ws(() => [...window.__dn.view.engine.blocks()].find((b) => window.__dn.view.engine.contentsOf(b.id).some((c) => c.type === 'chart')).id);
await page.locator(`.dn-block[data-id="${chartBlock}"]`).dblclick();
await page.waitForSelector('.chart-editor');
check('그래프 두 번 누르기 → 지금 데이터로 데이터 창', (await page.locator('.chart-grid tbody tr').count()) === 4 && (await page.locator('.chart-editor .seg button.on').innerText()) === '꺾은선');
await page.keyboard.press('Escape');
await page.waitForTimeout(100);
await page.locator(`.dn-block[data-id="${chartBlock}"]`).click({ button: 'right' });
await page.waitForSelector('.menu[aria-label="블록 메뉴"]');
check('그래프 블록 오른쪽 클릭 → 블록 메뉴에 "그래프 데이터 고치기"', (await page.locator('.menu[aria-label="블록 메뉴"]').innerText()).includes('그래프 데이터 고치기'));
await page.keyboard.press('Escape');

// ── 서식 상자 ──
const firstNode = async () => ws(() => {
  const v = window.__dn.view, id = v.selectedBlocks[0];
  const c = window.__dn.view.engine.contentsOf(id).find((x) => x.type === 'text');
  return c?.doc.content.map((n) => n.type).join(',');
});
for (const [q, want] of [['수식', 'math_block'], ['코드', 'code_block'], ['할 일', 'task_list'], ['글머리', 'bullet_list'], ['번호', 'ordered_list'], ['콜아웃', 'callout'], ['인용', 'blockquote'], ['토글', 'toggle'], ['가로줄', 'horizontal_rule']]) {
  await ws(() => { window.__dn.view.endEditing(); window.__dn.view.select([]); });
  await insert(q);
  if (q === '수식') {
    await page.waitForSelector('.dn-math-input', { timeout: 3000 });
    await page.keyboard.type('E = mc^2');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);
  }
  const types = await firstNode();
  check(`${q} → 그 서식으로 시작하는 내용 상자에서 바로 편집`, (types ?? '').split(',')[0] === want && (await page.locator('.dn-text-editing').count()) === 1, types);
  await page.keyboard.press('Escape');
}
check('수식 입력 → KaTeX', (await page.locator('.dn-block .dn-math-block .katex').count()) >= 1);

// ── 구분선 (노트형 NS-01): 캔버스 선 블록 — 가로 · 세로 ──
for (const [q, orient] of [['구분선', 'h'], ['세로 구분선', 'v']]) {
  await ws(() => { window.__dn.view.endEditing(); window.__dn.view.select([]); });
  await insert(q);
  const d = await ws(() => { const v = window.__dn.view, id = v.selectedBlocks[0]; const b = id && v.engine.getBlock(id); const c = id && v.engine.contentsOf(id)[0]; return c ? { type: c.type, orient: c.orient, w: b.w, h: b.h } : null; });
  check(`${q} → 캔버스 구분선 블록 (${orient === 'h' ? '높이' : '너비'} 24)`, d?.type === 'divider' && d.orient === orient && (orient === 'h' ? d.h === 24 : d.w === 24), JSON.stringify(d));
}
check('구분선은 선으로 그린다 (테두리 없는 칸)', (await page.locator('.dn-block.dn-box-divider .dn-divider').count()) === 2);

// ── 데이터베이스 · 사진 · 파일 ──
await insert('데이터베이스');
check('데이터베이스 넣기', (await byType('database')).length === 1);
let chooser = page.waitForEvent('filechooser');
await insert('사진');
await (await chooser).setFiles({ name: 'dot.png', mimeType: 'image/png', buffer: PNG });
await page.waitForFunction(() => [...window.__dn.view.engine.contents()].some((c) => c.type === 'image'), null, { timeout: 5000 }).catch(() => {});
check('사진 → 파일 고르기 → 이미지 블록', (await byType('image')).length === 1);
chooser = page.waitForEvent('filechooser');
await insert('파일');
await (await chooser).setFiles({ name: '회의록.txt', mimeType: 'text/plain', buffer: Buffer.from('안건 1. 넣기 메뉴') });
await page.waitForFunction(() => [...window.__dn.view.engine.contents()].some((c) => c.type === 'file'), null, { timeout: 5000 }).catch(() => {});
check('파일 → 첨부 카드', (await byType('file')).some((f) => f.name === '회의록.txt'));

// ── 빈 곳 오른쪽 클릭 → 그 자리에 ──
await ws(() => { window.__dn.view.endEditing(); window.__dn.view.select([]); window.__dn.view.setCamera({ x: 5000, y: 5000, zoom: 1 }); });
await page.waitForTimeout(200);
const host = await page.locator('.canvas-host').boundingBox();
const px = host.x + 300, py = host.y + 220;
await page.mouse.click(px, py, { button: 'right' });
await page.waitForSelector('.note-menu'); // 빈 곳 오른쪽 클릭 = 노트 설정 (11/03) — 넣기는 그 안의 '여기에 넣기'
await page.locator('.note-menu .nm-row', { hasText: '여기에 넣기' }).click();
await page.waitForSelector('.insert-menu');
const mpos = await page.locator('.insert-menu').boundingBox();
check('빈 곳 오른쪽 클릭 → 노트 설정 › 여기에 넣기 → 그 자리에 넣기 메뉴', Math.abs(mpos.x - px) < 4 && Math.abs(mpos.y - py) < 4 && !(await page.locator('.note-menu').count()));
await page.keyboard.type('내용');
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
const placed = await ws(() => { const v = window.__dn.view; const b = v.engine.getBlock(v.selectedBlocks[0]); return b && { x: b.x, y: b.y }; });
const world = await ws(({ px, py }) => { const v = window.__dn.view; const r = v.root.getBoundingClientRect(); const c = v.camera; return { x: (px - r.left) / c.zoom + c.x, y: (py - r.top) / c.zoom + c.y }; }, { px, py });
check('고른 상자가 오른쪽 클릭한 자리에', placed && Math.abs(placed.x - world.x) < 24 && Math.abs(placed.y - world.y) < 24, JSON.stringify({ placed, world }));
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');

// ── 캔버스에서 / ──
await ws(() => { window.__dn.view.select([]); window.__dn.view.root.focus(); });
await page.keyboard.press('/');
await page.waitForSelector('.insert-menu', { timeout: 2000 }).catch(() => {});
check('캔버스에서 / → 넣기 메뉴', (await page.locator('.insert-menu').count()) === 1);
await page.keyboard.press('Escape');

// ── 슬래시 메뉴 /표 → 이 블록 아래에 ──
const before = (await byType('table')).length;
const src = await ws(() => window.__dn.view.selectedBlocks[0] ?? [...window.__dn.view.engine.blocks()].pop().id);
await ws((id) => window.__dn.view.startEditing(id, 'end'), src);
await page.keyboard.press('Enter');
await page.keyboard.type('/표');
await page.waitForTimeout(200);
await page.keyboard.press('Enter');
await page.waitForSelector('.dn-table-picker');
// 키보드로 크기: → → ↓ = 5 × 4 (열 × 행, 머리글 포함)
for (const k of ['ArrowRight', 'ArrowRight', 'ArrowDown']) await page.keyboard.press(k);
await page.keyboard.press('Enter');
await page.waitForSelector('.dn-th-input', { timeout: 3000 }).catch(() => {});
const below = await ws((id) => {
  const e = window.__dn.view.engine, s = e.getBlock(id);
  const t = [...e.blocks()].find((b) => window.__dn.view.selectedBlocks.includes(b.id));
  return { ok: !!t && t.y >= s.y + s.h - 1, src: s && { y: s.y, h: s.h }, t: t && { y: t.y } };
}, src);
const sized = await ws(() => { const t = [...window.__dn.view.engine.contents()].filter((c) => c.type === 'table').pop(); return [t.columns.length, t.rows.length]; });
check('고른 크기대로 — 5열 · 머리글 + 3행', sized[0] === 5 && sized[1] === 3, JSON.stringify(sized));
check('슬래시 "표" → 편집하던 블록 아래에 새 표 · 열 이름 입력', (await byType('table')).length === before + 1 && below.ok && (await page.locator('.dn-th-input').count()) === 1, JSON.stringify(below));
await page.keyboard.press('Escape');

// ── 리뷰에서 찾은 문제들 ──
// (가) 빈 칸이 있어도 항목 순서 그대로 · 항목 이름이 겹치면 저장 막기
await ws((b) => { const v = window.__dn.view; v.endEditing(); v.focusBlock(b); }, chartBlock);
await page.waitForTimeout(500);
await ws((b) => { const v = window.__dn.view; const c = v.engine.contentsOf(b).find((x) => x.type === 'chart'); v.host.onEditContent(b, c.id); }, chartBlock);
await page.waitForSelector('.chart-editor');
await page.locator('.chart-grid tbody tr').nth(1).locator('td input').nth(1).fill('');
await page.locator('.chart-editor .btn.primary').click();
await page.waitForTimeout(400);
[ch] = await byType('chart');
const ticks = await page.evaluate((b) => [...document.querySelectorAll(`.dn-block[data-id="${b}"] .dn-chart text.dn-tick`)].map((t) => t.textContent).filter((t) => /월$/.test(t)), chartBlock);
check('빈 칸이 있어도 항목 순서 그대로 (그래프 · 저장값)', JSON.stringify(ch.categories) === '["1월","2월","3월","4월"]' && JSON.stringify(ticks) === '["1월","2월","3월","4월"]' && ch.series[0].points.length === 3,
  JSON.stringify({ cats: ch.categories, ticks }));
await ws((b) => { const v = window.__dn.view; const c = v.engine.contentsOf(b).find((x) => x.type === 'chart'); v.host.onEditContent(b, c.id); }, chartBlock);
await page.waitForSelector('.chart-editor');
const rowsAgain = await page.locator('.chart-grid tbody tr td:first-child input').evaluateAll((els) => els.map((e) => e.value));
check('다시 열어도 같은 순서', JSON.stringify(rowsAgain) === '["1월","2월","3월","4월"]', JSON.stringify(rowsAgain));
await page.locator('.chart-grid tbody tr').nth(2).locator('td input').first().fill('1월');
check('항목 이름이 겹치면 빨간 칸 · 저장 막힘', (await page.locator('.chart-grid tbody tr').nth(2).locator('td input.bad').count()) === 1 && await page.locator('.chart-editor .btn.primary').isDisabled());
// (나) 노트를 옮기면 그래프 데이터 창이 닫힌다
const noteNow = await ws(() => window.__dn.state.currentId);
await ws(() => window.__dn.newNote());
await page.waitForTimeout(500);
check('노트를 옮기면 그래프 데이터 창이 닫힌다', (await page.locator('.chart-editor').count()) === 0 && (await ws(() => window.__dn.state.dialog)) === null);
await ws((id) => window.__dn.openById(id), noteNow);
await page.waitForTimeout(600);
check('돌아와도 다시 뜨지 않는다', (await page.locator('.chart-editor').count()) === 0);
// (다) 넣기 메뉴 '파일'은 사진도 원본 파일 첨부로
await ws(() => window.__dn.view.select([]));
chooser = page.waitForEvent('filechooser');
await insert('파일');
await (await chooser).setFiles({ name: '원본.png', mimeType: 'image/png', buffer: PNG });
await page.waitForTimeout(600);
check('넣기 메뉴 "파일" + 사진 → 이미지가 아니라 첨부 파일', (await byType('file')).some((x) => x.name === '원본.png') && !(await byType('image')).some((x) => x.alt === '원본'));
// (라) 고치던 열 이름은 표가 다른 곳(다른 탭)에서 바뀌어도 이어진다
const tblBlock = await ws(() => [...window.__dn.view.engine.contents()].find((c) => c.type === 'table').blockId);
await ws((b) => window.__dn.view.focusBlock(b), tblBlock);
await page.waitForTimeout(500);
await page.locator(`.dn-block[data-id="${tblBlock}"] .dn-table th`).first().dblclick();
await page.waitForSelector('.dn-th-input');
await page.keyboard.press('End');
await page.keyboard.type('·성');
await ws((b) => {
  const e = window.__dn.view.engine; const t = e.contentsOf(b).find((c) => c.type === 'table');
  const last = [...t.rows].sort((x, y) => (x.order < y.order ? -1 : 1)).pop();
  e.transact((tx) => tx.set('content', t.id, { rows: [...t.rows, { id: 'remoteRow' + Date.now(), order: last.order + 'V', cells: {} }] }), { origin: 'remote' });
}, tblBlock);
await page.waitForTimeout(300);
const still = await page.evaluate(() => document.activeElement?.classList.contains('dn-th-input'));
await page.keyboard.type('명');
await page.keyboard.press('Escape');
await page.locator(`.dn-block[data-id="${tblBlock}"] .dn-table th`).first().dblclick();
await page.waitForSelector('.dn-th-input');
await page.keyboard.press('End');
await page.keyboard.type('!');
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
await page.keyboard.press('Escape');
const name0 = (await byType('table')).find((t) => t.blockId === tblBlock).columns[0].name;
check('다른 곳에서 표가 바뀌어도 열 이름 입력이 이어진다 · Esc는 그대로 · Enter는 저장', still && name0 === '이름!', JSON.stringify({ still, name0 }));
// (마) 문서 뷰에서는 / 가 숨은 캔버스에 넣지 않는다
await ws(() => window.__dn.setViewMode('doc'));
await page.waitForTimeout(300);
const blocksBefore = await ws(() => window.__dn.view.engine.blockCount);
await page.keyboard.press('/');
await page.waitForTimeout(200);
await ws(() => window.__dn.view.host.onInsertMenu({ x: 100, y: 100 }));
await page.waitForTimeout(200);
check('문서 뷰: 넣기 메뉴가 뜨지 않고 숨은 캔버스에 블록이 생기지 않는다', (await page.locator('.insert-menu').count()) === 0 && (await ws(() => window.__dn.view.engine.blockCount)) === blocksBefore);
await ws(() => window.__dn.setViewMode('canvas'));

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
