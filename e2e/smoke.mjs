// 캔버스 스모크 테스트 — 설치된 Edge(헤드리스)로 실제 브라우저에서 확인한다.
// 사용: dev 서버 실행 후 `node e2e/smoke.mjs [스크린샷 폴더]`
import { chromium } from 'playwright-core';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2] ?? '.';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

const browser = await chromium.launch({ channel: process.env.DN_CHANNEL ?? 'msedge', headless: true }) // CI(리눅스)는 DN_CHANNEL=chrome;
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
// .env.local 키가 있어도 실제 Claude를 부르지 않게 (가짜 응답 · 비용 방지)
await ctx.addInitScript(() => localStorage.setItem('dn:no-env-key', '1'));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const eng = () => page.evaluate(() => {
  const v = window.__dn.view; const e = v.engine;
  return { blocks: e.blockCount, arrows: [...e.arrows()].length, zoom: v.camera.zoom, sel: v.selBlocks.size };
});

await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await page.waitForTimeout(400);
let s = await eng();
check('예시 노트 열기 (제목 상자 1 · 내용 상자 4 · 화살표 3)', s.blocks === 5 && s.arrows === 3, JSON.stringify(s));
await page.screenshot({ path: `${OUT}/01-open.png` });

// 블록 생성: 내용 상자 도구로 빈 곳 누르기 → 제목 입력 → Enter → 본문 입력
await page.evaluate(() => window.__dn.view.setTool('block')); await page.mouse.click(1100, 200);
await page.keyboard.type('새 블록 제목');
await page.keyboard.press('Enter');
await page.keyboard.type('본문 첫 줄');
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
s = await eng();
const newText = await page.evaluate(() => [...document.querySelectorAll('.dn-block')].map((b) => b.innerText).find((t) => t.includes('새 블록')));
check('더블클릭으로 블록 만들고 입력', s.blocks === 6 && !!newText && newText.includes('본문 첫 줄'), newText?.replace(/\n/g, ' / '));

// ───── 리치 텍스트 (FR-007 · 026~028 · 033) ─────
const rich = page.locator('.dn-block', { hasText: '새 블록 제목' });
// 블록 전체(제목 칸 + 본문 칸) 문서 — 제목으로 블록을 찾는다
const docJson = () => page.evaluate(() => {
  const e = window.__dn.view.engine;
  const c = [...e.contents()].find((x) => JSON.stringify(x.doc).includes('새 블록 제목'));
  return JSON.stringify(e.contentsOf(c.blockId).map((x) => x.doc));
});
await page.keyboard.press('Enter'); // 선택된 블록 편집 (끝으로)
await page.keyboard.press('Enter');
await page.keyboard.type('- 첫 항목');
await page.keyboard.press('Enter');
await page.keyboard.type('둘째 항목 ');
await page.keyboard.press('Control+b');
await page.keyboard.type('굵게');
await page.keyboard.press('Control+b');
await page.keyboard.press('Enter');
await page.keyboard.press('Enter'); // 빈 항목에서 Enter → 목록 빠져나오기
await page.keyboard.type('[] 할 일 하나');
let dj = await docJson();
check('마크다운 단축: "- " 목록 · Ctrl+B 굵게 · "[] " 할 일', dj.includes('bullet_list') && dj.includes('"strong"') && dj.includes('task_list'),
  ['bullet_list', 'strong', 'task_list'].filter((k) => dj.includes(k)).join(','));
await page.keyboard.press('Control+z');
dj = await docJson();
check('편집 중 Ctrl+Z = 엔진 undo (이번 편집 묶음만 취소, 이전 제목은 유지)', !dj.includes('할 일 하나') && dj.includes('새 블록 제목'), dj.includes('할 일 하나') ? '남아 있음' : '취소됨');
await page.keyboard.press('Control+Shift+z');
dj = await docJson();
check('편집 중 Ctrl+Shift+Z = 다시 실행', dj.includes('할 일 하나'));
// undo · redo 뒤 커서가 되살아난 글자 끝에 있어야 한다 (문서 통째 교체로 커서가 튀던 문제의 회귀 방지)
const caret = await page.evaluate(() => { const s = getSelection(); return (s.anchorNode?.textContent ?? '').slice(0, s.anchorOffset); });
check('undo · redo 뒤 커서 위치 유지', caret.endsWith('할 일 하나'), JSON.stringify(caret));
// 텍스트 선택 → 서식 툴바 → H2
await page.keyboard.press('Shift+Home');
// 선택 변경은 selectionchange로 비동기 반영된다 — 툴바가 뜰 때까지 최대 1초 기다린다
const bubbleVisible = await page.waitForSelector('.dn-bubble:not([hidden])', { timeout: 1000 }).then(() => true, () => false);
await page.screenshot({ path: `${OUT}/02a-bubble.png` });
check('텍스트 선택 시 서식 툴바 표시', bubbleVisible);
await page.locator('.dn-bubble button[data-cmd="highlight"]').click();
dj = await docJson();
check('툴바로 형광펜 적용', dj.includes('highlight'));
await page.keyboard.press('Escape');
await page.waitForTimeout(150);
const staticHtml = await rich.evaluate((el) => el.querySelector('.dn-part-body').innerHTML);
check('편집 종료 후 정적 렌더 (목록 · 굵게 · 할 일 · 형광펜)', /<ul>/.test(staticHtml) && /<strong>/.test(staticHtml) && /data-type="task"/.test(staticHtml) && /<mark>/.test(staticHtml) && !(await page.locator('.dn-text-editing').count()));
await page.screenshot({ path: `${OUT}/02b-rich.png` });
// 붙여넣기 (FR-031): HTML 서식 유지 + 스크립트 제거
await page.keyboard.press('Enter');
await page.evaluate(() => {
  const dt = new DataTransfer();
  dt.setData('text/html', '<h2>붙여넣은 제목</h2><p>문단 <b>굵게</b> <a href="javascript:alert(1)">나쁜 링크</a> <a href="https://example.com">좋은 링크</a></p><img src=x onerror="window.__xss=1"><script>window.__xss=1</script>');
  dt.setData('text/plain', '붙여넣은 제목');
  document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
});
await page.waitForTimeout(150);
dj = await docJson();
const xss = await page.evaluate(() => window.__xss);
check('HTML 붙여넣기: 서식 유지 · 위험한 링크/스크립트 제거', dj.includes('붙여넣은 제목') && dj.includes('https://example.com') && !dj.includes('javascript:') && !xss,
  `heading=${dj.includes('"heading","attrs":{"level":2}')}, xss=${!!xss}`);
await page.keyboard.press('Escape');

// 한글 IME 조합 (FR-007, G1): 키 이벤트로는 조합이 안 생기므로 CDP로 Windows IME와 같은 compositionstart/update/end 열을 만든다.
// ㅎ → 하 → 한 → 한ㄱ → 한그 → 한글 조합 후 확정. 확정 뒤 엔진 문서에 정확히 한 번 들어가고, undo 한 번으로 사라져야 한다.
await page.keyboard.press('Enter'); // 선택된 블록 편집 (끝으로) — 편집 시작이 undo 묶음 경계
await page.keyboard.press('Enter');
const cdp = await page.context().newCDPSession(page);
for (const t of ['ㅎ', '하', '한', '한ㄱ', '한그', '한글']) {
  await cdp.send('Input.imeSetComposition', { text: t, selectionStart: t.length, selectionEnd: t.length });
  await page.waitForTimeout(20);
}
await cdp.send('Input.insertText', { text: '한글' });
await page.waitForTimeout(150);
dj = await docJson();
const imeCount = dj.split('한글').length - 1;
const imeJunk = /ㅎ|ㄱ|한그/.test(dj);
await page.keyboard.press('Control+z');
await page.waitForTimeout(100);
const djUndo = await docJson();
check('한글 IME 조합 → 확정 시 엔진 문서에 1회 · undo 1회로 제거', imeCount === 1 && !imeJunk && !djUndo.includes('한글') && djUndo.includes('붙여넣은 제목'),
  `확정 후 "한글" ${imeCount}회${imeJunk ? ' · 조합 중간 글자 남음' : ''}, undo 후 ${djUndo.includes('한글') ? '남아 있음' : '제거됨'}`);
await cdp.detach();
await page.keyboard.press('Escape');

// 드래그 이동
const firstBox = await page.locator('.dn-block').first().boundingBox();
const before = await page.evaluate(() => { const b = [...window.__dn.view.engine.blocks()].find((x) => x.x === 120 && x.y === 90); return b && { id: b.id, x: b.x, y: b.y }; });
const titleEl = page.locator('.dn-block', { hasText: '구조 분석 파이프라인' });
const tb = await titleEl.boundingBox();
await page.mouse.move(tb.x + 150, tb.y + 60);
await page.mouse.down();
await page.mouse.move(tb.x + 200, tb.y + 90, { steps: 8 });
await page.mouse.move(tb.x + 250, tb.y + 120, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(150);
const after = await page.evaluate((id) => { const b = window.__dn.view.engine.getBlock(id); return { x: b.x, y: b.y }; }, before.id);
check('블록 드래그 이동', Math.round(after.x - before.x) === 100 && Math.round(after.y - before.y) === 60, `${before.x},${before.y} → ${after.x},${after.y}`);

// 연결 핸들 드래그로 화살표 만들기: 선택된 블록의 오른쪽 연결점 → 새 블록
const sel = await titleEl.boundingBox();
const zoom = (await eng()).zoom;
await page.mouse.move(sel.x + sel.width / 2, sel.y + sel.height / 2);
await page.waitForTimeout(50);
const target = await page.locator('.dn-block', { hasText: '새 블록 제목' }).boundingBox();
await page.mouse.move(sel.x + sel.width + 12, sel.y + sel.height / 2);
await page.mouse.down();
await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 12 });
await page.screenshot({ path: `${OUT}/02-connecting.png` });
await page.mouse.up();
await page.waitForTimeout(150);
s = await eng();
check('연결점 드래그로 화살표 연결', s.arrows === 4, `arrows=${s.arrows}, zoom=${zoom}`);

// undo
await page.keyboard.press('Control+z');
await page.waitForTimeout(100);
s = await eng();
check('Ctrl+Z로 화살표 연결 취소', s.arrows === 3, `arrows=${s.arrows}`);
await page.keyboard.press('Control+Shift+z');
await page.waitForTimeout(100);
s = await eng();
check('Ctrl+Shift+Z로 다시 실행', s.arrows === 4, `arrows=${s.arrows}`);

// 블록 삭제 → 연결 화살표 함께 삭제
await page.mouse.click(target.x + target.width / 2, target.y + 6);
await page.keyboard.press('Delete');
await page.waitForTimeout(100);
s = await eng();
check('Delete로 블록 삭제 (연결 화살표 연쇄 삭제)', s.blocks === 5 && s.arrows === 3, JSON.stringify(s));

// 줌: Ctrl+휠 (커서 고정점)
const z0 = (await eng()).zoom;
await page.mouse.move(700, 450);
await page.keyboard.down('Control');
await page.mouse.wheel(0, -300);
await page.keyboard.up('Control');
await page.waitForTimeout(150);
const z1 = (await eng()).zoom;
const pct = await page.locator('.zoom .pct').innerText();
check('Ctrl+휠 줌 · 줌 표시 갱신', z1 > z0 && pct === `${Math.round(z1 * 100)}%`, `${z0.toFixed(2)} → ${z1.toFixed(2)} (${pct})`);
// 휠 = 팬 (D7)
const cam0 = await page.evaluate(() => window.__dn.view.camera);
await page.mouse.wheel(0, 200);
await page.waitForTimeout(100);
const cam1 = await page.evaluate(() => window.__dn.view.camera);
check('휠 = 팬', cam1.y > cam0.y && cam1.zoom === cam0.zoom, `y ${cam0.y.toFixed(1)} → ${cam1.y.toFixed(1)}`);
await page.click('.zoom button[aria-label="전체 맞춤"]');
await page.waitForTimeout(150);
await page.screenshot({ path: `${OUT}/03-after-edit.png` });

// 저장 후 새로고침 → 그대로
await page.waitForTimeout(1200);
const snapBefore = await page.evaluate(() => [...window.__dn.view.engine.blocks()].map((b) => `${b.id}:${b.x},${b.y}`).sort().join('|'));
await page.reload();
await page.waitForSelector('.dn-block');
await page.waitForTimeout(300);
const snapAfter = await page.evaluate(() => [...window.__dn.view.engine.blocks()].map((b) => `${b.id}:${b.x},${b.y}`).sort().join('|'));
check('새로고침 후 상태 복원 (로컬 자동 저장)', snapBefore === snapAfter);

// 대량: 블록 10,000개 (FR-008 시나리오 S-10k 참고치 — 헤드리스 Edge)
await page.goto(`${BASE}/?synth=10000`);
await page.waitForFunction(() => window.__dn?.view?.engine.blockCount === 10000, null, { timeout: 60000 });
await page.waitForTimeout(300);
let mounted = await page.evaluate(() => document.querySelectorAll('.dn-block').length);
let zoomNow = (await eng()).zoom;
check('1만 블록 전체 보기: LOD로 DOM 블록 0개', mounted === 0 && zoomNow < 0.35, `zoom ${zoomNow.toFixed(2)}, 마운트 ${mounted}`);
await page.screenshot({ path: `${OUT}/04-synth-lod.png` });
const panFrames = () => page.evaluate(async () => {
  const v = window.__dn.view;
  const times = [];
  let last = performance.now();
  for (let i = 0; i < 90; i++) {
    const c = v.camera;
    v.setCamera({ x: c.x + 24 / c.zoom, y: c.y + 12 / c.zoom, zoom: c.zoom });
    await new Promise((r) => requestAnimationFrame(r));
    const now = performance.now();
    times.push(now - last);
    last = now;
  }
  times.sort((a, b) => a - b);
  return { p50: times[45], p95: times[85] };
});
// 기준선: 같은 브라우저에서 아무 일도 안 할 때의 프레임 간격 (헤드리스 · 절전 모드면 30fps로 묶인다)
const base = await page.evaluate(async () => { const t = []; let l = performance.now(); for (let i = 0; i < 60; i++) { await new Promise((r) => requestAnimationFrame(r)); const n = performance.now(); t.push(n - l); l = n; } t.sort((a, b) => a - b); return t[57]; });
const budget = base + 8;
let f = await panFrames();
check('LOD 팬 프레임 (블록 수천 개 화면)', f.p95 <= budget, `p50 ${f.p50.toFixed(1)}ms · p95 ${f.p95.toFixed(1)}ms (기준선 ${base.toFixed(1)}ms)`);
await page.click('.zoom button[aria-label="전체 맞춤"]');
await page.click('.zoom .pct');
await page.waitForTimeout(300);
mounted = await page.evaluate(() => document.querySelectorAll('.dn-block').length);
check('100% 줌: 뷰포트 근처 블록만 마운트', mounted > 0 && mounted < 400, `마운트 ${mounted}개`);
f = await panFrames();
check('DOM 모드 팬 프레임', f.p95 <= budget, `p50 ${f.p50.toFixed(1)}ms · p95 ${f.p95.toFixed(1)}ms (기준선 ${base.toFixed(1)}ms)`);
await page.screenshot({ path: `${OUT}/05-synth-100.png` });

// FR-147: 1만 블록 노트에서 화살표가 붙은 블록 드래그 프레임 · 타이핑 지연
const frameProbe = () => page.evaluate(() => {
  window.__frames = []; window.__probe = true;
  let last = performance.now();
  const tick = () => { const n = performance.now(); window.__frames.push(n - last); last = n; if (window.__probe) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
});
const frameStop = () => page.evaluate(() => { window.__probe = false; const t = window.__frames.slice(2).sort((a, b) => a - b); return { p50: t[Math.floor(t.length * 0.5)], p95: t[Math.floor(t.length * 0.95)], n: t.length }; });
await page.evaluate(() => {
  // 화살표가 붙은 블록을 화면 가운데로 (100% 줌)
  const v = window.__dn.view; const e = v.engine;
  const a = [...e.arrows()][Math.floor(e.blockCount / 40)];
  const b = e.getBlock(a.from.blockId); const r = v.root.getBoundingClientRect();
  v.setCamera({ x: b.x + b.w / 2 - r.width / 2, y: b.y + b.h / 2 - r.height / 2, zoom: 1 });
});
await page.waitForTimeout(300);
const dragFrom = await page.evaluate(() => {
  const v = window.__dn.view; const e = v.engine;
  const r = v.root.getBoundingClientRect();
  for (const el of document.querySelectorAll('.dn-block')) {
    const id = el.dataset.id; const b = e.getBlock(id);
    if (!b || !e.arrowsOf(id).length) continue;
    const s = v.blockScreenRect(id);
    if (s.x > 50 && s.y > 50 && s.x + s.w < r.width - 50 && s.y + s.h < r.height - 50) return { x: r.left + s.x + s.w / 2, y: r.top + s.y + 10, arrows: e.arrowsOf(id).length };
  }
  return null;
});
if (dragFrom) {
  await page.mouse.move(dragFrom.x, dragFrom.y);
  await page.mouse.down();
  await frameProbe();
  for (let i = 1; i <= 60; i++) { await page.mouse.move(dragFrom.x + i * 3, dragFrom.y + i * 2); await page.waitForTimeout(16); }
  f = await frameStop();
  await page.mouse.up();
  check('FR-147 화살표가 붙은 블록 드래그 프레임 (1만 블록 노트)', f.p95 <= budget, `p50 ${f.p50.toFixed(1)}ms · p95 ${f.p95.toFixed(1)}ms (기준선 ${base.toFixed(1)}ms, 화살표 ${dragFrom.arrows}개)`);
  await page.keyboard.press('Control+z');
  // 타이핑 지연: keydown 시각 → 그 입력이 반영된 다음 프레임
  await page.mouse.dblclick(dragFrom.x, dragFrom.y + 30);
  await page.evaluate(() => {
    window.__lat = [];
    document.addEventListener('keydown', (e) => { const t0 = e.timeStamp; requestAnimationFrame(() => setTimeout(() => window.__lat.push(performance.now() - t0), 0)); }, { capture: true });
  });
  await page.keyboard.type('타이핑지연측정abcdefghijklmnop', { delay: 40 });
  const lat = await page.evaluate(() => { const t = [...window.__lat].sort((a, b) => a - b); return { p50: t[Math.floor(t.length / 2)], p95: t[Math.floor(t.length * 0.95)], n: t.length }; });
  await page.keyboard.press('Escape');
  check('FR-147 타이핑 입력 지연 p95 50ms 이하 (1만 블록 노트)', lat.p95 <= 50, `p50 ${lat.p50.toFixed(1)}ms · p95 ${lat.p95.toFixed(1)}ms (${lat.n}타)`);
} else {
  check('FR-147 드래그 측정용 블록 찾기', false, '화살표가 붙은 블록이 화면에 없음');
}

// 열기 시간: 저장된 1만 블록 노트를 다시 연다
await page.waitForTimeout(1500);
const openMs = await page.evaluate(async () => {
  const ws = window.__dn;
  const id = ws.state.currentId;
  const t0 = performance.now();
  await ws.openById(id, { force: true });
  if (ws.state.currentId !== id || ws.view.engine.blockCount < 10000) throw new Error('다시 열기 실패');
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return performance.now() - t0;
});
// 목표 200ms(FR-008). 헤드리스 · 기기 흔들림을 감안해 실패 기준은 400ms, 값은 그대로 보고한다
check('1만 블록 노트 다시 열기 (닫기 · IDB 읽기 · 역직렬화 · 첫 렌더 포함, 목표 200ms)', openMs < 400, `${openMs.toFixed(0)}ms`);
check('콘솔 · 페이지 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
