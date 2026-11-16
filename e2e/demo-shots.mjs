// 데모 페이지용 화면 캡처: 실제 앱을 조작해 기능별 단계 화면을 JPEG로 남긴다 (AI는 가짜 응답 — 실제 호출 · 비용 없음).
// 사용: dev 서버 실행 후 `node e2e/demo-shots.mjs <출력 폴더>` → <출력 폴더>/*.jpg + shots.json(화면 구성 표시 좌표)
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { fsPath } from './lib/fs-path.mjs';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2] ?? 'demo-shots';
mkdirSync(OUT, { recursive: true });
const CORE = fsPath('packages/engine-core/src/index.ts');
const meta = { layout: {}, shots: [] };

const browser = await chromium.launch({ channel: process.env.DN_CHANNEL ?? 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await ctx.addInitScript(() => localStorage.setItem('dn:no-env-key', '1'));
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('pageerror', String(e)));
const ws = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
const shot = async (name, { keepMouse = false } = {}) => { if (!keepMouse) await page.mouse.move(1430, 470); await wait(250); await page.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 84 }); meta.shots.push(name); console.log('shot', name); };
const scene = async (name, fn) => { try { await fn(); } catch (e) { console.log('SCENE FAIL', name, String(e).slice(0, 300)); } };
const p = (t) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });
const paste = (text) => page.evaluate((t) => {
  const dt = new DataTransfer(); dt.setData('text/plain', t);
  const r = window.__dn.view.root; r.focus();
  r.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, text);

// ───────── 가짜 Anthropic API (AI 장면용) ─────────
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const sse = (events) => events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');
const stream = (input) => sse([
  ['message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 900, output_tokens: 1 } } }],
  ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'emit_structure', input: {} } }],
  ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } }],
  ['content_block_stop', { type: 'content_block_stop', index: 0 }],
  ['message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 321 } }],
  ['message_stop', { type: 'message_stop' }],
]);
const DIAGRAM = {
  version: 'structure.v2', mode: 'diagram', title: '금리 인상의 영향',
  nodes: [
    { key: 'n1', title: '기준금리 인상', kind: 'event', source: { quote: '기준금리 인상' } },
    { key: 'n2', title: '대출 이자 부담 증가', kind: 'concept' },
    { key: 'n3', title: '가계 소비 감소', kind: 'concept' },
    { key: 'n4', title: '기업 투자 위축', kind: 'concept' },
    { key: 'n5', title: '물가 상승세 둔화', kind: 'conclusion', emphasis: 'strong' },
  ],
  edges: [
    { from: 'n1', to: 'n2', relation: 'causes' }, { from: 'n2', to: 'n3', relation: 'leads-to' },
    { from: 'n2', to: 'n4', relation: 'leads-to' }, { from: 'n3', to: 'n5', relation: 'causes' }, { from: 'n4', to: 'n5', relation: 'causes' },
  ],
  charts: [], tables: [], patterns: [{ key: 'p1', id: 'S-01', pattern: 'chain', primary: true, nodes: ['n1', 'n2', 'n3', 'n4', 'n5'] }],
};
const SHEET = {
  version: 'structure.v2', mode: 'sheet', nodes: [], edges: [], charts: [], tables: [],
  sheet: {
    title: '고객 프로파일: 바쁜 30대 직장인 지민', subtitle: '신규 밀키트 서비스 타깃 고객',
    sections: [
      { title: '기본 정보', pieces: [{ type: 'chips', items: ['34세', 'IT 기업 기획자', '서울 마포구'] }] },
      { title: '핵심 욕구', tone: 'blue', pieces: [{ type: 'text', md: '- 퇴근 후 30분 안에 저녁 해결\n- 건강하게 먹고 싶지만 ==요리할 시간이 없음==' }] },
      { title: '불편한 점 · 기대', pieces: [{ type: 'compare', left: { label: '불편한 점', items: ['배달 음식은 비싸고 기름지다', '재료가 남아서 버린다'] }, right: { label: '기대', items: ['10분 완성', '남는 재료 없음'] } }] },
      { title: '디지털 친숙도', tone: 'yellow', pieces: [{ type: 'rating', rows: [{ label: '앱 사용', value: 4, max: 5 }, { label: '온라인 결제', value: 5, max: 5 }] }] },
      { title: '구매 흐름', pieces: [{ type: 'flow', steps: ['SNS 광고', '앱 설치', '첫 주문', '정기 구독'] }] },
      { title: '마케팅 할 일', tone: 'green', pieces: [{ type: 'checklist', items: ['"10분 완성" 문구 시험', '첫 주문 할인 쿠폰'], done: [true, false] }] },
    ],
    closing: '정리하면, 지민에게는 시간을 아껴 주는 건강한 한 끼가 가장 중요하다.',
  },
};
let slow = false;
await page.route('https://api.anthropic.com/**', async (route) => {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  if (req.url().includes('/v1/models/')) return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'model', id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5', created_at: '2026-01-01T00:00:00Z' }) });
  const user = JSON.stringify(req.postDataJSON()?.messages ?? '');
  if (slow) await new Promise((r) => setTimeout(r, 2500));
  const sheet = user.includes('고객 프로파일') && !user.includes('set \\"mode\\" to \\"diagram\\"');
  return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: stream(sheet ? SHEET : DIAGRAM) });
}).catch(() => {});

await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await wait(600);
await ws(async () => { await window.__dn.acceptConsent(); await window.__dn.saveKey('sk-ant-demo-key-0000'); });

// ───────── 1. 홈 ─────────
await scene('home', async () => {
  await ws(() => window.__dn.showHome());
  await page.waitForSelector('.home-page', { timeout: 5000 });
  await wait(500);
  await shot('01-home');
});

// ───────── 2. 화면 구성 (예시 노트) ─────────
let mainNote = '';
await scene('layout', async () => {
  await ws(() => window.__dn.newNote({ sheet: null }));
  await wait(400);
  await ws(() => window.__dn.setTitle('신제품 출시 준비'));
  await ws(async (CORE) => {
    const core = await import(CORE);
    const e = window.__dn.view.engine;
    const doc = (...lines) => ({ type: 'doc', content: lines.map((t) => (typeof t === 'string' ? { type: 'paragraph', content: [{ type: 'text', text: t }] } : t)) });
    const list = (...items) => ({ type: 'bullet_list', content: items.map((t) => ({ type: 'list_item', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })) });
    const tasks = (...items) => ({ type: 'task_list', content: items.map(([t, done]) => ({ type: 'task_item', attrs: { checked: done }, content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })) });
    const ids = {};
    e.transact((tx) => {
      const box = (k, x, y, w, role, d) => { ids[k] = tx.createBlock({ x, y, w, h: 60 }); tx.createContent({ blockId: ids[k], type: 'text', role, doc: d }); };
      box('goal', 0, 0, 340, 'title', doc('출시 목표'));
      box('goalBody', 0, 70, 340, 'body', doc('11월 첫 주 베타 출시', list('사용자 500명 모집', '핵심 기능 3가지 안정화')));
      box('plan', 0, 300, 340, 'title', doc('이번 주 할 일'));
      box('planBody', 0, 370, 340, 'body', doc(tasks(['디자인 시안 확정', true], ['결제 연동 시험', false], ['베타 신청 페이지', false])));
      box('risk', 480, 0, 320, 'title', doc('위험 요소'));
      box('riskBody', 480, 70, 320, 'body', doc('서버 비용이 예상보다 클 수 있음'));
      box('memo', 480, 300, 320, 'body', doc('대응: 사용량 상한 · 캐시 먼저 적용'));
      tx.createArrow({ from: { blockId: ids.goalBody, side: 'auto' }, to: { blockId: ids.plan, side: 'auto' }, relation: 'leads-to' });
      tx.createArrow({ from: { blockId: ids.memo, side: 'auto' }, to: { blockId: ids.riskBody, side: 'auto' }, relation: 'solves' });
    }, { origin: 'user' });
    core.groupBlocks(e, [ids.goal, ids.goalBody]);
    core.groupBlocks(e, [ids.plan, ids.planBody]);
    core.groupBlocks(e, [ids.risk, ids.riskBody]);
    window.__dn.view.fit();
  }, CORE);
  await wait(600);
  mainNote = await ws(() => window.__dn.state.currentId);
  await shot('02-layout');
  const rect = async (sel) => { const b = await page.locator(sel).first().boundingBox().catch(() => null); return b ? { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } : null; };
  meta.layout = {
    sidebar: await rect('.sidebar'), topbar: await rect('.topbar'), toolbar: await rect('.toolbar'), zoom: await rect('.zoom'),
    canvas: await rect('.canvas-host'), modes: await rect('.topbar [role="tablist"], .topbar .view-switch, .topbar .seg'),
  };
});

// ───────── 3. 글 상자 만들기 · 슬래시 명령 ─────────
await scene('text', async () => {
  await ws(() => window.__dn.newNote({ sheet: null }));
  await wait(400);
  await ws(() => window.__dn.setTitle('주간 회의 메모'));
  await ws(() => window.__dn.view.setTool('block'));
  await page.mouse.click(620, 300);
  await wait(300);
  await page.keyboard.type('주간 회의 메모');
  await page.keyboard.press('Enter');
  await page.keyboard.type('다음 주까지 시안 3개 준비, 금요일 오후 검토');
  await shot('03a-typing');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/');
  await wait(300);
  await shot('03b-slash');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Escape');
});

// ───────── 4. 넣기 메뉴 · 콘텐츠 종류 ─────────
await scene('insert', async () => {
  await ws(() => window.__dn.view.select([]));
  await page.locator('.toolbar .insert-btn').click();
  await page.waitForSelector('.insert-menu');
  await wait(300);
  await shot('04a-insert-menu');
  await page.keyboard.press('Escape');
  // 여러 콘텐츠를 한 화면에: 표 · 수식 · 콜아웃 · 그래프
  await ws(async (CORE) => {
    const core = await import(CORE);
    const e = window.__dn.view.engine;
    const memo = [...e.blocks()][0];
    const X = memo.x + 560, Y = memo.y - 40;
    // 사진: 노을 그라데이션을 그려 넣는다
    const c = document.createElement('canvas'); c.width = 640; c.height = 400;
    const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 0, 400);
    gr.addColorStop(0, '#f6b26b'); gr.addColorStop(0.55, '#e06666'); gr.addColorStop(0.56, '#3d5a80'); gr.addColorStop(1, '#1c2d4a');
    g.fillStyle = gr; g.fillRect(0, 0, 640, 400); g.fillStyle = '#ffe599'; g.beginPath(); g.arc(320, 220, 46, Math.PI, 0); g.fill();
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    await window.__dn.addImages([new File([blob], '노을.png', { type: 'image/png' })], { x: memo.x, y: memo.y + memo.h + 40 });
    e.transact((tx) => {
      const t = tx.createBlock({ x: X, y: Y, w: 360, h: 120 });
      tx.createContent({ blockId: t, type: 'table', ...core.makeTable(['단계', '담당', '마감'], [['시안', '김 디자이너', '10/25'], ['개발', '박 개발자', '11/01'], ['베타', '이 PM', '11/05']], '일정') });
      const m = tx.createBlock({ x: X, y: Y + 200, w: 360, h: 60 });
      tx.createContent({ blockId: m, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'math_block', attrs: { tex: 'ROI = \\frac{이익 - 비용}{비용} \\times 100' } }] } });
      const cb = tx.createBlock({ x: X, y: Y + 300, w: 360, h: 60 });
      tx.createContent({ blockId: cb, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'callout', attrs: { icon: 'bulb', color: 'yellow' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '검토 전에 시안을 공유 폴더에 올려 주세요.' }] }] }] } });
    }, { origin: 'user' });
    window.__dn.view.fit();
    window.__dn.view.select([]);
  }, CORE);
  await wait(700);
  await shot('04b-contents');
});

// ───────── 5. 블록으로 묶기 ─────────
await scene('group', async () => {
  await ws(() => window.__dn.newNote({ sheet: null }));
  await wait(400);
  await ws(() => window.__dn.setTitle('여행 사진 정리'));
  const ids = await ws(() => window.__dn.view.engine.transact((tx) => {
    const mk = (x, y, w, role, text) => { const b = tx.createBlock({ x, y, w, h: 50 }); tx.createContent({ blockId: b, type: 'text', role, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } }); return b; };
    return [mk(0, 0, 320, 'title', '제주 바다'), mk(0, 70, 320, 'body', '협재 해변, 오후 4시 — 물빛이 가장 예뻤던 시간'), mk(360, 0, 260, 'body', '다음에 갈 곳: 우도, 비자림'), mk(0, 260, 320, 'body', '경비 정리는 따로')];
  }, { origin: 'user' }).value);
  await ws(() => window.__dn.view.fit());
  await wait(400);
  await ws((ids) => { window.__dn.view.select(ids); window.__dn.view.root.focus(); }, ids.slice(0, 3));
  await wait(200);
  await shot('05a-select');
  await page.keyboard.press('Control+g');
  await wait(500);
  await ws(async ([CORE, id]) => { const core = await import(CORE); const e = window.__dn.view.engine; core.renameGroup(e, e.getBlock(id).group, '제주 여행'); window.__dn.view.select([]); }, [CORE, ids[0]]);
  await wait(300);
  await shot('05b-grouped');
});

// ───────── 6. 화살표 · 관계 ─────────
await scene('arrow', async () => {
  await ws(() => window.__dn.newNote({ sheet: null }));
  await wait(400);
  await ws(() => window.__dn.setTitle('원인과 결과'));
  const arrowId = await ws(() => {
    const e = window.__dn.view.engine;
    let a = '';
    e.transact((tx) => {
      const mk = (x, y, t) => { const b = tx.createBlock({ x, y, w: 220, h: 50 }); tx.createContent({ blockId: b, type: 'text', role: 'title', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] } }); return b; };
      const x = mk(0, 0, '수면 부족'), y = mk(460, 0, '집중력 저하'), z = mk(460, 200, '실수 증가');
      a = tx.createArrow({ from: { blockId: x, side: 'auto' }, to: { blockId: y, side: 'auto' } });
      tx.createArrow({ from: { blockId: y, side: 'auto' }, to: { blockId: z, side: 'auto' }, relation: 'leads-to' });
    }, { origin: 'user' });
    window.__dn.view.fit();
    return a;
  });
  await wait(500);
  const pt = await ws((id) => {
    const v = window.__dn.view, a = v.engine.getArrow(id), g = v.engine.arrowGeometry(a);
    const w = { x: g.a.x + (g.b.x - g.a.x) * 0.3, y: g.a.y + (g.b.y - g.a.y) * 0.3 };
    const s = v.toScreen(w), r = v.root.getBoundingClientRect();
    return { x: r.left + s.x, y: r.top + s.y };
  }, arrowId);
  await page.mouse.click(pt.x, pt.y, { button: 'right' });
  await wait(250);
  const menu = page.locator('[aria-label="화살표 메뉴"]');
  await menu.locator('.menu-sub > button', { hasText: '관계' }).click();
  await wait(250);
  await shot('06a-arrow-menu');
  await menu.locator('select').selectOption('causes');
  await page.keyboard.press('Escape');
  await ws(() => window.__dn.view.select([]));
  await wait(300);
  await shot('06b-arrow-labeled');
});

// ───────── 7. 문서 뷰 ─────────
await scene('doc', async () => {
  await ws((id) => window.__dn.openById(id), mainNote);
  await wait(500);
  await ws(() => window.__dn.setViewMode('doc'));
  await page.waitForSelector('.doc-ribbon', { timeout: 5000 });
  await wait(700);
  await shot('07-doc');
  await ws(() => window.__dn.setViewMode('canvas'));
  await wait(300);
});

// ───────── 8. AI 구조화 — 도식 ─────────
await scene('ai-diagram', async () => {
  await ws(() => window.__dn.newNote({ sheet: null }));
  await wait(400);
  await ws(() => window.__dn.setTitle('경제 공부'));
  await paste('## 금리 인상의 영향\n\n기준금리 인상은 대출 이자 부담 증가로 이어집니다. 이자 부담이 커지면 가계 소비가 줄고, 기업은 투자를 미룹니다.\n소비와 투자가 함께 줄어들면서 결국 물가 상승세가 둔화됩니다.');
  await wait(500);
  await shot('08a-chip');
  slow = true;
  await page.locator('.ai-chip .btn.ai').click();
  await page.waitForSelector('.ai-progress', { timeout: 4000 });
  await wait(300);
  await shot('08b-progress');
  await page.waitForFunction(() => !window.__dn.state.aiRun, null, { timeout: 15000 });
  slow = false;
  await wait(600);
  await ws(() => { window.__dn.view.select([]); window.__dn.view.fit(); });
  await wait(500);
  await shot('08c-diagram');
});

// ───────── 9. AI 구조화 — 노트형 (A4) ─────────
await scene('ai-sheet', async () => {
  await ws(() => window.__dn.newNote({ sheet: { size: 'a4' } }));
  await wait(500);
  await ws(() => window.__dn.setTitle('타깃 고객 정리'));
  await paste('# 고객 프로파일: 바쁜 30대 직장인 지민\n신규 밀키트 서비스 타깃 고객\n\n## 기본 정보\n- 34세, IT 기업 기획자, 서울 마포구\n\n## 핵심 욕구\n- 퇴근 후 30분 안에 저녁 해결\n- 건강하게 먹고 싶지만 요리할 시간이 없음\n\n## 불편한 점\n- 배달 음식은 비싸고 기름지다\n- 재료가 남아서 버린다\n\n## 디지털 친숙도\n앱 사용 ★★★★☆, 온라인 결제 ★★★★★');
  await wait(500);
  const src = await ws(() => window.__dn.view.selectedBlocks[0] ?? [...window.__dn.view.engine.blocks()][0].id);
  await ws((id) => window.__dn.structure(id), src);
  await page.waitForFunction(() => !window.__dn.state.aiRun, null, { timeout: 15000 });
  await wait(700);
  await ws(() => { const v = window.__dn.view; v.select([]); });
  await wait(300);
  await shot('09a-sheet');
  await ws(() => { window.__dn.dismissToast(); const v = window.__dn.view; const ids = [...v.engine.blocks()].filter((b) => b.ai).map((b) => b.id); const e = v.engine; let x0 = Infinity, y0 = Infinity, x1 = -Infinity; for (const id of ids) { const b = e.getBlock(id); x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); } const z = 0.95; v.setCamera({ zoom: z, x: x0 - 20, y: y0 - 10 }); });
  await wait(600);
  await shot('09b-sheet-cards');
});

// ───────── 10. 필기 ─────────
await scene('ink', async () => {
  await ws(() => window.__dn.newNote({ sheet: null }));
  await wait(400);
  await ws(() => window.__dn.setTitle('아이디어 스케치'));
  await ws(() => { window.__dn.view.engine.transact((tx) => { const b = tx.createBlock({ x: 0, y: 0, w: 360, h: 60 }); tx.createContent({ blockId: b, type: 'text', role: 'title', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '앱 첫 화면 아이디어' }] }] } }); }, { origin: 'user' }); window.__dn.view.fit(); });
  await wait(300);
  await ws(() => window.__dn.view.root.focus());
  await page.keyboard.press('p');
  await wait(200);
  // 제목 상자(월드 0,0)를 화면 (560, 380)에 — 그림은 그 아래, 필기 막대 위
  await ws(() => window.__dn.view.setCamera({ zoom: 1, x: -320, y: -328 }));
  await wait(200);
  const draw = async (pts) => { await page.mouse.move(pts[0][0], pts[0][1]); await page.mouse.down(); for (const [x, y] of pts.slice(1)) await page.mouse.move(x, y, { steps: 4 }); await page.mouse.up(); await wait(60); };
  // 휴대폰 모양 · 글줄 · 버튼 · 화살표 · 동그라미
  await draw([[560, 450], [740, 450], [740, 760], [560, 760], [560, 450]]);
  await draw([[590, 500], [710, 500]]);
  await draw([[590, 545], [690, 545]]);
  await draw([[600, 700], [700, 700], [700, 735], [600, 735], [600, 700]]);
  await draw([[780, 640], [860, 600], [940, 585]]);
  await draw([[940, 585], [922, 574]]); await draw([[940, 585], [925, 600]]);
  const circle = []; for (let i = 0; i <= 24; i++) { const t = (i / 24) * Math.PI * 2; circle.push([1020 + Math.cos(t) * 70, 580 + Math.sin(t) * 45]); }
  await draw(circle);
  await page.keyboard.press('2');
  await wait(100);
  await draw([[975, 660], [1020, 642], [1065, 660]]);
  await page.keyboard.press('m');
  await wait(100);
  await draw([[582, 500], [718, 500]]);
  await wait(300);
  await page.mouse.move(1300, 300);
  await shot('10-ink', { keepMouse: true });
  await page.keyboard.press('Escape');
  await ws(() => window.__dn.view.setTool('select'));
});

// ───────── 11. 데이터베이스 ─────────
await scene('db', async () => {
  await ws(() => window.__dn.newNote({ sheet: null }));
  await wait(400);
  await ws(() => window.__dn.setTitle('출시 할 일'));
  await ws(async (CORE) => {
    const core = await import(CORE);
    const e = window.__dn.view.engine;
    const blk = core.createDatabaseBlock(e, { x: 0, y: 0 }, '출시 준비 할 일').value;
    const c = [...e.contentsOf(blk)].find((x) => x.type === 'database');
    const [name, status, date] = c.properties;
    const opt = (n) => status.options.find((o) => o.name === n).id;
    const rows = [['디자인 시안 확정', '완료', '2026-10-24'], ['결제 연동 시험', '진행 중', '2026-10-28'], ['베타 신청 페이지', '할 일', '2026-10-30']];
    c.rows.forEach((r, i) => { core.setDbValue(e, c.id, r.id, name.id, rows[i][0]); core.setDbValue(e, c.id, r.id, status.id, opt(rows[i][1])); core.setDbValue(e, c.id, r.id, date.id, rows[i][2]); });
    core.addDbRow(e, c.id, c.rows[2].id, { [name.id]: '출시 공지 작성', [status.id]: opt('할 일'), [date.id]: '2026-11-03' });
    window.__dn.view.fit();
  }, CORE);
  await wait(700);
  await ws(() => window.__dn.view.select([]));
  await shot('11-db');
});

// ───────── 12. 내보내기 ─────────
await scene('export', async () => {
  await ws((id) => window.__dn.openById(id), mainNote);
  await wait(500);
  await page.locator('.topbar .more-btn').click();
  await wait(200);
  await page.locator('.topbar .export-btn').click();
  await page.waitForSelector('.export-dialog', { timeout: 5000 });
  await wait(900);
  await shot('12-export');
  await page.keyboard.press('Escape');
  await wait(200);
});

// ───────── 13. 찾기 · 명령 ─────────
await scene('command', async () => {
  await ws(() => window.__dn.openOverlay('command'));
  await wait(400);
  await page.keyboard.type('내보');
  await wait(300);
  await shot('13-command');
  await page.keyboard.press('Escape');
});

// ───────── 14. 설정 (AI · 동기화) ─────────
await scene('settings', async () => {
  await ws(() => window.__dn.openSettings());
  await page.waitForSelector('.settings', { timeout: 5000 });
  await wait(400);
  await shot('14-settings');
  await page.keyboard.press('Escape');
  await ws(() => window.__dn.closeDialog());
});

// ───────── 15. 어두운 화면 ─────────
await scene('dark', async () => {
  await ws((id) => window.__dn.openById(id), mainNote);
  await wait(400);
  await ws(() => window.__dn.setTheme('dark'));
  await wait(600);
  await shot('15-dark');
  await ws(() => window.__dn.setTheme('light'));
});

writeFileSync(`${OUT}/shots.json`, JSON.stringify(meta, null, 2));
await browser.close();
console.log('done', meta.shots.length);
