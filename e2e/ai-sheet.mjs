// 노트형 정리 AI 결과 (docs/research/NOTE-SHEET-PLAN.md NS-11 ~ 16) — Anthropic API는 가짜로 가로챈다(실제 호출 · 비용 없음).
// AI가 노트형을 고르면 레고 블록(10/29 — 블록 하나에 번호 · 제목 상자들을 빈틈없이) · 결과 알림의 '도식으로 다시'는 이번 결과를 되돌리고 requested_mode=diagram으로 다시 요청 · A4 노트는 용지 폭 안 2열.
// 사용: dev 서버 실행 후 `node e2e/ai-sheet.mjs [스크린샷 폴더]` (DN_URL로 주소 변경)
import { chromium } from 'playwright-core';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2] ?? '.';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

const SRC = '# 수면 습관 정리\n30대 직장인 기준.\n\n## 좋은 점\n- 일찍 잔다\n\n## 고칠 점\n- 휴대폰을 오래 본다\n\n## 점수\n규칙성 ★★★☆☆, 수면 시간 4/5\n\n## 할 일\n- 11시 전에 눕기\n- 카페인 줄이기\n\n결론적으로 잠들기 전 휴대폰을 줄이자.';
const SHEET = {
  version: 'structure.v2', mode: 'sheet', nodes: [], edges: [], charts: [], tables: [], keywords: ['수면', '휴대폰', '원문에없는말'],
  sheet: {
    title: '수면 습관 정리', subtitle: '30대 직장인 기준.',
    sections: [
      { title: '좋은 점 · 고칠 점', pieces: [{ type: 'compare', left: { label: '좋은 점', items: ['일찍 잔다'] }, right: { label: '고칠 점', items: ['휴대폰을 오래 본다'] } }] },
      { title: '점수', tone: 'yellow', pieces: [{ type: 'rating', rows: [{ label: '규칙성', value: 3, max: 5 }, { label: '수면 시간', value: 4, max: 5 }] }] },
      { title: '할 일', tone: 'green', pieces: [{ type: 'checklist', items: ['11시 전에 눕기', '카페인 줄이기'] }] },
      { title: '태그', pieces: [{ type: 'chips', items: ['수면', '습관'] }, { type: 'text', md: '- ==휴대폰==을 줄인다' }] },
    ],
    closing: '결론적으로 잠들기 전 휴대폰을 줄이자.',
  },
};
const DIAGRAM = {
  version: 'structure.v2', mode: 'diagram',
  nodes: [
    { key: 'n1', title: '휴대폰을 오래 본다', kind: 'problem' },
    { key: 'n2', title: '11시 전에 눕기', kind: 'action' },
    { key: 'n3', title: '잠들기 전 휴대폰을 줄이자', kind: 'conclusion' },
  ],
  edges: [{ from: 'n2', to: 'n3', relation: 'serves' }, { from: 'n1', to: 'n3', relation: 'leads-to' }],
  charts: [], tables: [], patterns: [{ key: 'p1', id: 'S-07', pattern: 'chain', primary: true, nodes: ['n1', 'n2', 'n3'] }],
};
const sse = (events) => events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');
const messagesStream = (input) => sse([
  ['message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 900, output_tokens: 1 } } }],
  ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'emit_structure', input: {} } }],
  ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } }],
  ['content_block_stop', { type: 'content_block_stop', index: 0 }],
  ['message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 321 } }],
  ['message_stop', { type: 'message_stop' }],
]);

const browser = await chromium.launch({ channel: process.env.DN_CHANNEL ?? 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await ctx.addInitScript(() => localStorage.setItem('dn:no-env-key', '1'));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|401|Failed to load resource/.test(m.text())) errors.push(m.text()); });

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const sent = [];
await page.route('https://api.anthropic.com/**', async (route) => {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  if (req.url().includes('/v1/models/')) {
    return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'model', id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5', created_at: '2026-01-01T00:00:00Z' }) });
  }
  const body = req.postDataJSON();
  sent.push(body);
  const user = JSON.stringify(body.messages);
  return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: messagesStream(user.includes('set \\"mode\\" to \\"diagram\\"') ? DIAGRAM : SHEET) });
}).catch(() => {});

const ws = (fn, arg) => page.evaluate(fn, arg);
await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(async () => { await window.__dn.acceptConsent(); await window.__dn.saveKey('sk-ant-test-sheet-0000'); });

const paste = (text) => page.evaluate((t) => {
  const dt = new DataTransfer(); dt.setData('text/plain', t);
  const r = window.__dn.view.root; r.focus();
  r.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, text);
// 이번 AI 결과: 묶음(블록)별 상자 자리 · 상자마다 첫 줄 · 빈 구멍(이음매 십자 자리보다 먼 점)
const lego = () => ws(() => {
  const e = window.__dn.view.engine, groups = e.note.groups ?? {};
  const ai = [...e.blocks()].filter((b) => b.ai);
  const by = new Map();
  for (const b of ai) if (b.group) { const a = by.get(b.group) ?? []; a.push({ x: b.x, y: b.y, w: b.w, h: b.h }); by.set(b.group, a); }
  const first = (id) => { const c = e.contentsOf(id).find((x) => x.type === 'text'); return (c?.doc.content[0]?.content ?? []).map((k) => k.text ?? '').join(''); };
  const holes = (rs) => {
    const u = { x: Math.min(...rs.map((r) => r.x)), y: Math.min(...rs.map((r) => r.y)), r: Math.max(...rs.map((r) => r.x + r.w)), b: Math.max(...rs.map((r) => r.y + r.h)) };
    let n = 0;
    for (let x = u.x; x <= u.r; x += 4) for (let y = u.y; y <= u.b; y += 4) if (Math.min(...rs.map((r) => Math.hypot(Math.max(r.x - x, 0, x - r.x - r.w), Math.max(r.y - y, 0, y - r.y - r.h)))) > 8 * Math.SQRT2 + 0.5) n++;
    return n;
  };
  const overlap = ai.some((a, i) => ai.some((b, j) => j > i && a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5));
  const heads = ai.map((b) => ({ x: b.x, y: b.y, t: first(b.id) }));
  return { n: ai.length, loose: ai.filter((b) => !b.group).length, cards: Object.values(groups).filter((g) => g.bracket === 'card').length, overlap,
    groups: [...by].map(([, rs]) => ({ n: rs.length, holes: holes(rs), x: Math.min(...rs.map((r) => r.x)), right: Math.max(...rs.map((r) => r.x + r.w)), y: Math.min(...rs.map((r) => r.y)) })),
    heads, numCols: new Set(heads.filter((h) => /^\d+\. /.test(h.t)).map((h) => h.x)).size };
});
const run = async () => {
  const src = await ws(() => [...window.__dn.view.engine.blocks()].find((b) => JSON.stringify(window.__dn.view.engine.contentsOf(b.id)).includes('수면 습관 정리') && !b.ai)?.id);
  await ws((id) => window.__dn.structure(id), src);
  await page.waitForFunction(() => !window.__dn.state.aiRun, null, { timeout: 15000 });
  await page.waitForTimeout(500);
};

// 1) 끝없는 캔버스 — AI가 노트형을 고름
await ws(() => window.__dn.newNote({ sheet: null }));
await page.waitForTimeout(300);
await paste(SRC);
await page.waitForTimeout(300);
const blocks0 = await ws(() => window.__dn.view.engine.blockCount);
await run();
const l1 = await lego();
const titles = ['1. 좋은 점 · 고칠 점', '2. 점수', '3. 할 일', '4. 태그'];
check('노트형 결과: 블록 하나 · 카드 묶음 없음 · 문단 4개가 번호 제목으로', l1.groups.length === 1 && l1.loose === 0 && l1.cards === 0 && titles.every((t) => l1.heads.some((h) => h.t === t)), JSON.stringify({ g: l1.groups.length, loose: l1.loose, cards: l1.cards, heads: l1.heads.map((h) => h.t) }));
check('빈틈없이 레고처럼: 상자끼리 안 겹침 · 블록 안에 이음매보다 큰 빈 곳 없음', !l1.overlap && l1.groups[0]?.holes === 0, JSON.stringify({ overlap: l1.overlap, holes: l1.groups[0]?.holes }));
check('끝없는 캔버스는 3단 (문단 상자가 세 단에)', l1.numCols === 3, JSON.stringify(l1.heads));
const sideNames = (await page.locator('.note-blocks .block-item').allInnerTexts()).map((t) => t.replace('▣', '').trim());
check('사이드바 블록 이름 = 머리 제목(노트 제목)', sideNames.includes('수면 습관 정리'), JSON.stringify(sideNames));
const kinds = await ws(() => {
  const e = window.__dn.view.engine, all = JSON.stringify([...e.contents()].filter((c) => c.type === 'text').map((c) => c.doc));
  return { divider: [...e.contents()].filter((c) => c.type === 'divider').length, rating: all.includes('"rating"'), task: all.includes('task_item'), chip: all.includes('"chip"'), callout: all.includes('"callout"'), hl: all.includes('highlight') };
});
check('구분선 없이(이음매가 대신) · 별점 · 할 일 · 칩 · 형광펜 · 맺음 콜아웃', kinds.divider === 0 && kinds.rating && kinds.task && kinds.chip && kinds.callout && kinds.hl, JSON.stringify(kinds));
const toast1 = await page.locator('.toast').innerText().catch(() => '');
check('알림: "노트로 정리했어요 — 문단 4개" + 도식으로 다시', toast1.includes('문단 4개') && (await page.locator('.toast .toast-alt', { hasText: '도식으로 다시' }).count()) === 1, toast1);
const tags1 = await ws(() => { const n = window.__dn.state.notes.find((x) => x.id === window.__dn.state.currentId); return (n?.tagIds ?? []).map((t) => window.__dn.state.tags.find((x) => x.id === t)?.name).sort(); });
check('AI 자동 태그: 원문에 있는 키워드만 노트 태그로 (원문에 없는 말은 버림) · 알림에 "태그 2개"', JSON.stringify(tags1) === JSON.stringify(['수면', '휴대폰']) && toast1.includes('태그 2개를 붙였어요'), `${JSON.stringify(tags1)} ${toast1}`);
check('첫 요청에는 requested_mode가 없다 (AI가 고름)', !JSON.stringify(sent[0]?.messages ?? '').includes('requested_mode'));
await page.screenshot({ path: `${OUT}/ai-sheet-1-cards.png` });

// 2) 도식으로 다시 → 이번 결과는 되돌리고 diagram 강제로 다시 요청
await page.locator('.toast .toast-alt').click();
await page.waitForFunction(() => !window.__dn.state.aiRun, null, { timeout: 15000 });
await page.waitForTimeout(500);
const l2 = await lego();
const after2 = await ws(() => ({ b: window.__dn.view.engine.blockCount, a: [...window.__dn.view.engine.arrows()].length }));
check('도식으로 다시: 노트형 블록은 사라지고 상자 3 · 화살표 2', !l2.heads.some((h) => titles.includes(h.t)) && after2.b - blocks0 === 3 && after2.a === 2, JSON.stringify({ heads: l2.heads.map((h) => h.t), ...after2, blocks0 }));
const tagsAfter2 = await ws(() => { const n = window.__dn.state.notes.find((x) => x.id === window.__dn.state.currentId); return (n?.tagIds ?? []).map((t) => window.__dn.state.tags.find((x) => x.id === t)?.name); });
check('도식으로 다시: 처음 결과로 붙인 AI 태그도 뗌 (도식 응답엔 키워드 없음)', tagsAfter2.length === 0, JSON.stringify(tagsAfter2));
check('두 번째 요청에 requested_mode = diagram', JSON.stringify(sent[1]?.messages ?? '').includes('set \\"mode\\" to \\"diagram\\"'));
const toast2 = await page.locator('.toast').innerText().catch(() => '');
check('알림에 노트로 다시', (await page.locator('.toast .toast-alt', { hasText: '노트로 다시' }).count()) === 1, toast2);
await page.screenshot({ path: `${OUT}/ai-sheet-2-diagram.png` });

// 3) A4 노트 — 원문 아래, 용지 폭 안 2단
await ws(() => window.__dn.newNote({ sheet: { size: 'a4' } }));
await page.waitForTimeout(300);
await paste(SRC);
await page.waitForTimeout(300);
await run();
const l3 = await lego();
const geo = await ws(() => {
  const e = window.__dn.view.engine, src = [...e.blocks()].find((b) => !b.ai && JSON.stringify(e.contentsOf(b.id)).includes('수면 습관 정리'));
  return { srcBottom: src ? src.y + src.h : 0, width: e.note.sheet ? 794 : 0 };
});
check('A4: 블록이 용지 폭 안 · 2단 · 빈틈없이', l3.groups.length >= 1 && l3.numCols === 2 && l3.groups.every((g) => g.x >= 24 && g.right <= geo.width - 24 + 2 && g.holes === 0) && !l3.overlap, JSON.stringify({ cols: l3.numCols, gs: l3.groups, w: geo.width }));
check('A4: 원문 아래에 놓임', l3.groups.every((g) => g.y > geo.srcBottom), JSON.stringify({ ys: l3.groups.map((g) => g.y), srcBottom: geo.srcBottom }));
await page.screenshot({ path: `${OUT}/ai-sheet-3-a4.png` });

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} 통과`);
process.exit(failed ? 1 : 0);
