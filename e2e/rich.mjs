// 표 · 그래프 (스키마 v4, FR-018 · FR-107 · FR-108): AI 구조화(가짜 Claude)가 만든 표 · 그래프가 실제로 그려지고,
// 표 셀을 편집 · 행/열 추가 · 실행 취소, 새로 고침 뒤에도 유지, 검색 · Markdown에 들어가는지.
// 사용: dev 서버 실행 후 `node e2e/rich.mjs [스크린샷 폴더]`
import { chromium } from 'playwright-core';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2] ?? '.';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

const STRUCTURE = {
  nodes: [{ key: 'n1', title: '배포 속도', kind: 'concept' }],
  edges: [],
  charts: [
    { key: 'c1', kind: 'bar', title: '월별 배포', unit: '회', series: [{ name: '배포', points: [{ x: '1월', y: 24 }, { x: '2월', y: 17 }, { x: '3월', y: 9 }] }], attachTo: 'n1' },
    { key: 'c2', kind: 'pie', title: '점유율', unit: '%', series: [{ name: '점유율', points: [{ x: 'A', y: 60 }, { x: 'B', y: 40 }] }] },
  ],
  tables: [{ key: 't1', title: '요금 비교', columns: ['플랜', '가격'], rows: [['기본', '9,900원'], ['프로', '19,900원']] }],
};
const sse = (events) => events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');
const stream = (input) => sse([
  ['message_start', { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 9, output_tokens: 1 } } }],
  ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 't', name: 'emit_structure', input: {} } }],
  ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } }],
  ['content_block_stop', { type: 'content_block_stop', index: 0 }],
  ['message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 9 } }],
  ['message_stop', { type: 'message_stop' }],
]);

const browser = await chromium.launch({ channel: process.env.DN_CHANNEL ?? 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => localStorage.setItem('dn:no-env-key', '1'));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push(m.text()); });
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
await page.route('https://api.anthropic.com/**', async (route) => {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  if (req.url().includes('/v1/models/')) return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'model', id: 'claude-sonnet-5-5', display_name: 'S', created_at: '2026-01-01T00:00:00Z' }) });
  return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: stream(STRUCTURE) });
});
const ws = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await wait(300);

// 새 노트에 붙여넣고 구조화 (동의 · 키 등록)
await ws(() => window.__dn.newNote());
await wait(300);
const noteId = await ws(() => window.__dn.state.currentId);
await page.evaluate((t) => {
  const dt = new DataTransfer(); dt.setData('text/plain', t);
  const root = window.__dn.view.root; root.focus();
  root.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, '배포 횟수는 1월 24회, 2월 17회, 3월 9회. 기본 요금은 9,900원, 프로는 19,900원. 점유율 A 60%, B 40%.');
await wait(150);
await page.locator('.ai-chip .btn.ai').click();
await page.locator('.dialog .btn.primary').click();
await page.waitForSelector('.settings');
await page.locator('.key-input input').fill('sk-ant-test-key-abcd');
await page.locator('.key-row .btn').click();
await page.waitForFunction(() => !document.querySelector('.settings'), null, { timeout: 5000 });
await page.waitForFunction(() => !window.__dn.state.aiRun, null, { timeout: 10000 });
await wait(500);
await ws(() => window.__dn.view.fit());
await wait(400);

// ───── 그려짐 ─────
const bars = await page.locator('.dn-chart svg .dn-bar').count();
check('막대 그래프: 막대 3개 · 눈금 · 제목/단위', bars === 3 && (await page.locator('.dn-chart-title', { hasText: '월별 배포' }).innerText()).includes('회'), `막대 ${bars}`);
check('원 그래프: 조각 2개 · 범례 (그림 안 — 내보내기에도)', (await page.locator('.dn-chart svg .dn-slice').count()) === 2 && (await page.locator('.dn-chart svg .dn-legend-text').count()) >= 2);
check('표: 제목 · 머리글 · 행', (await page.locator('.dn-table-title').innerText()) === '요금 비교' && (await page.locator('.dn-table th').count()) === 2 && (await page.locator('.dn-table tbody tr').count()) === 2);
check('자리표시자 문구 없음', (await page.locator('.dn-unknown').count()) === 0);
const stored = await ws(() => [...window.__dn.view.engine.contents()].filter((c) => c.type === 'table' || c.type === 'chart').map((c) => ({ t: c.type, schema: c.schema, kind: c.kind, col: typeof c.columns?.[0] })));
check('저장 형식 v4 (schema-v0 아님, 열에 id)', stored.length === 3 && stored.every((c) => !c.schema) && stored.some((c) => c.col === 'object'), JSON.stringify(stored));
await page.screenshot({ path: `${OUT}/rich-render.png` });

// ───── 표 셀 편집 ─────
const cell = page.locator('.dn-table tbody tr').nth(1).locator('td').nth(1);
await cell.dblclick();
await wait(150);
check('셀 더블클릭 → 그 칸만 편집 · 도구 줄', (await page.locator('.dn-table td.dn-cell-editing .dn-text-editing').count()) === 1 && (await page.locator('.dn-table-tools button').count()) === 6); // 행 · 열 추가 · 삭제 + 칸 합치기 · 나누기
await page.keyboard.press('Control+A');
await page.keyboard.type('29,900원');
await page.keyboard.press('Enter'); // 마지막 칸 → 행 추가 · 새 행 첫 칸
await wait(150);
await page.keyboard.type('엔터프라이즈');
await page.keyboard.press('Tab');
await page.keyboard.type('문의');
await page.keyboard.press('Escape');
await wait(300);
const tableText = () => page.locator('.dn-table tbody').innerText();
check('편집 · 마지막 칸에서 Enter → 행 추가 · Tab 다음 칸', (await tableText()).includes('29,900원') && (await tableText()).includes('엔터프라이즈') && (await page.locator('.dn-table tbody tr').count()) === 3, (await tableText()).replace(/\s+/g, ' '));
await page.screenshot({ path: `${OUT}/rich-table-edit.png` });

// 열 추가 · 실행 취소
await page.locator('.dn-table tbody tr').first().locator('td').first().dblclick();
await wait(100);
await page.locator('.dn-table-tools button', { hasText: '＋ 열' }).click();
await wait(200);
check('열 추가', (await page.locator('.dn-table th').count()) === 3);
await page.keyboard.press('Escape');
await page.keyboard.press('Control+z');
await wait(200);
check('실행 취소 → 열 추가가 되돌아감', (await page.locator('.dn-table th').count()) === 2);
await page.keyboard.press('Control+z');
await wait(200);
check('한 번 더 → 마지막 칸 편집이 되돌아감 (칸 단위)', !(await tableText()).includes('문의'));
await page.keyboard.press('Control+Shift+z');
await wait(200);

// ───── 유지 · 검색 · 내보내기 ─────
await wait(800);
await page.reload();
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws((id) => window.__dn.openById(id), noteId);
await wait(500);
check('새로 고침 후 표 · 그래프 유지', (await page.locator('.dn-chart').count()) === 2 && (await tableText()).includes('엔터프라이즈'));
const hits = await ws(() => window.__dn.search('엔터프라이즈').map((h) => h.noteId));
check('표 셀 글자 검색', hits.includes(noteId));
const md = await ws((id) => window.__dn.noteMarkdown(id), noteId);
check('Markdown: 표 → 표 · 그래프 → 캡션 + 값', md.includes('| 플랜 | 가격 |') && md.includes('| 엔터프라이즈 | 문의 |') && md.includes('*그래프(막대): 월별 배포 · 단위 회*'), md.slice(md.indexOf('| 플랜'), md.indexOf('| 플랜') + 120));

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
