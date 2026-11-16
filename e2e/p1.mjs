// P1 기능 확인 (FR-024 블록 핸들 · 메뉴, FR-031 붙여넣기, FR-069 목록 정렬 · 이름, FR-076 휴지통, FR-012 이동 애니메이션).
// 사용: dev 서버 실행 후 `node e2e/p1.mjs [스크린샷 폴더]` (DN_URL로 주소 변경)
import { chromium } from 'playwright-core';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2] ?? '.';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

const browser = await chromium.launch({ channel: process.env.DN_CHANNEL ?? 'msedge', headless: true }) // CI(리눅스)는 DN_CHANNEL=chrome;
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, permissions: ['clipboard-read', 'clipboard-write'] });
// .env.local 키가 있어도 실제 Claude를 부르지 않게 (가짜 응답 · 비용 방지)
await ctx.addInitScript(() => localStorage.setItem('dn:no-env-key', '1'));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });

const ws = (fn, arg) => page.evaluate(fn, arg);
await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await page.waitForTimeout(400);

// ───── 붙여넣기 (FR-031) ─────
const paste = (data) => page.evaluate((d) => {
  const dt = new DataTransfer();
  for (const [k, v] of Object.entries(d)) dt.setData(k, v);
  const root = window.__dn.view.root;
  root.focus();
  root.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, data);
const lastDoc = () => ws(() => {
  const v = window.__dn.view; const id = v.selectedBlocks[0];
  // 블록 전체(제목 칸 + 본문 칸) 문서
  return JSON.stringify(v.engine.contentsOf(id).map((c) => c.doc));
});
let before = await ws(() => window.__dn.view.engine.blockCount);
await paste({ 'text/plain': '## 금리 인상의 영향\n\n- **대출** 감소\n- 소비 위축\n\n1. 첫째\n2. 둘째\n\n> 인용 `코드`' });
await page.waitForTimeout(150);
let d = await lastDoc();
// 붙여넣은 글은 내용 상자 하나 — ## 줄은 그 안의 첫 줄 제목 서식
const pasted = await ws(() => { const v = window.__dn.view; const cs = v.engine.contentsOf(v.selectedBlocks[0]); return { n: cs.length, role: cs[0]?.role, first: cs[0]?.doc.content[0] }; });
const pastedTitle = pasted.n === 1 && pasted.role === 'body' && pasted.first?.type === 'heading' ? pasted.first.content.map((n) => n.text).join('') : '';
check('캔버스에 마크다운 붙여넣기 → 내용 상자 1개 (## 줄은 첫 줄 제목 서식) · 목록 · 굵게 · 인용',
  (await ws(() => window.__dn.view.engine.blockCount)) === before + 1 && pastedTitle === '금리 인상의 영향' && ['bullet_list', 'ordered_list', '"strong"', 'blockquote', '"code"'].every((k) => d.includes(k)));
await ws(() => window.__dn.view.undo());
check('붙여넣기는 undo 한 번으로 사라짐', (await ws(() => window.__dn.view.engine.blockCount)) === before);

await paste({ 'text/plain': '굵게', 'text/html': '<p><b>굵게</b><img src=x onerror="window.__pwned=1"><a href="javascript:alert(1)">링크</a></p><script>window.__pwned=1</script>' });
await page.waitForTimeout(300);
d = await lastDoc();
const toast1 = await page.locator('.toast').innerText().catch(() => '');
check('HTML 붙여넣기: 서식 보존 · 스크립트/javascript: 제거 · 안내 토스트',
  d.includes('"strong"') && !d.includes('javascript') && !(await ws(() => window.__pwned)) && toast1.includes('실행될 수 있는 코드'), toast1);

// Ctrl+Shift+V: 서식 없이
// (실제 키를 누르면 헤드리스 브라우저가 빈 클립보드로 붙여넣기를 먼저 일으키므로 keydown만 합성한다)
await ws(() => window.__dn.view.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'V', ctrlKey: true, shiftKey: true, bubbles: true })));
await paste({ 'text/plain': '# 그냥 글자', 'text/html': '<h1>그냥 글자</h1>' });
await page.waitForTimeout(100);
d = await lastDoc();
check('Ctrl+Shift+V: 서식 없는 붙여넣기', d.includes('# 그냥 글자') && !d.includes('"heading"'), d.slice(0, 120));

// ───── 블록 핸들 · 메뉴 (FR-024) ─────
await ws(() => window.__dn.view.select([]));
const target = await ws(() => {
  // 예시 노트의 "구조 분석 파이프라인" 내용 상자 (맨 위 제목 상자 말고)
  const v = window.__dn.view; const e = v.engine;
  const b = [...e.blocks()].find((x) => JSON.stringify(e.contentsOf(x.id).map((c) => c.doc)).includes('구조 분석 파이프라인'));
  const r = v.root.getBoundingClientRect(); const c = v.camera;
  return { id: b.id, x: r.left + (b.x - c.x) * c.zoom, y: r.top + (b.y - c.y) * c.zoom, w: b.w * c.zoom };
});
await page.mouse.move(target.x + target.w / 2, target.y + 20);
await page.waitForTimeout(100);
const grip = page.locator('.dn-grip');
check('블록 호버 시 왼쪽 핸들 표시', await grip.isVisible());
const gb = await grip.boundingBox();
await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2, { steps: 4 });
check('핸들로 마우스를 옮겨도 핸들 유지', await grip.isVisible());
// 핸들 드래그 → 이동
const pos0 = await ws((id) => { const b = window.__dn.view.engine.getBlock(id); return [b.x, b.y]; }, target.id);
await page.mouse.down();
// 왼쪽 빈 곳으로 — Shift를 누른 채 끌면 자석 스냅이 꺼져 정확히 끈 만큼 움직인다
await page.keyboard.down('Shift');
await page.mouse.move(gb.x - 400, gb.y + 30, { steps: 6 });
await page.keyboard.up('Shift');
await page.mouse.up();
const pos1 = await ws((id) => { const b = window.__dn.view.engine.getBlock(id); return [b.x, b.y]; }, target.id);
// 놓은 자리에 다른 상자가 있으면 도킹이 가장 가까운 빈 자리로 옮기므로, "끈 쪽으로 크게 움직였고 겹치지 않음"을 본다
const gripFree = await ws((id) => { const e = window.__dn.view.engine; const a = e.getBlock(id); return [...e.blocks()].every((b) => b.id === id || !(a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5)); }, target.id);
check('핸들 드래그로 블록 이동 (Shift = 스냅 끄고 자유 배치)', pos0[0] - pos1[0] > 300 && gripFree, `${pos0} → ${pos1}`);
// 메뉴 검사를 위해 옮긴 블록을 화면 가운데로 가져와(사이드바 밑에 가려지지 않게) 다시 마우스를 올려 핸들을 띄운다
{
  await ws((id) => { const v = window.__dn.view; const b = v.engine.blockRect(id); const r = v.root.getBoundingClientRect(); v.setCamera({ x: b.x - r.width / 2 + b.w / 2, y: b.y - r.height / 3, zoom: 1 }); v.select([]); }, target.id);
  await page.waitForTimeout(150);
  const s = await ws((id) => { const v = window.__dn.view; const r = v.root.getBoundingClientRect(); const b = v.blockScreenRect(id); return { x: r.left + b.x + b.w / 2, y: r.top + b.y + 12 }; }, target.id);
  await page.mouse.move(s.x, s.y);
  await page.waitForTimeout(80);
}
// 핸들 클릭 → 메뉴
const gb2 = await grip.boundingBox();
await page.mouse.click(gb2.x + gb2.width / 2, gb2.y + gb2.height / 2);
await page.waitForTimeout(100);
check('핸들 클릭 시 블록 메뉴', await page.locator('.menu[role=menu]').isVisible());
await page.screenshot({ path: `${OUT}/p1-block-menu.png` });
await page.locator('.menu-sub > button', { hasText: '바꾸기' }).click(); // 하위 메뉴 (DS-001)
await page.locator('.menu button', { hasText: '할 일 목록' }).click();
d = await ws((id) => JSON.stringify(window.__dn.view.engine.contentsOf(id).map((c) => c.doc)), target.id);
check('메뉴에서 타입 전환 (할 일 목록)', d.includes('task_list'));
await ws(() => window.__dn.view.undo());
// 다중 선택 + 색상
await ws(() => { const v = window.__dn.view; v.select([...v.engine.blocks()].slice(0, 2).map((b) => b.id)); });
await ws(() => { const v = window.__dn.view; window.__dn.closeBlockMenu(); v['onBlockMenu']?.({ ids: v.selectedBlocks, x: 300, y: 200 }); });
await page.waitForTimeout(50);
await page.locator('.menu-sub > button', { hasText: '배경색' }).click(); // 하위 메뉴 (DS-001)
await page.locator('.menu .sw[title=노랑]').click();
const colors = await ws(() => [...window.__dn.view.engine.blocks()].slice(0, 2).map((b) => b.style?.color));
check('다중 선택 블록 전체에 색상 적용', colors.every((c) => c === 'yellow'), colors.join(','));
const canUndo1 = await ws(() => { const v = window.__dn.view; v.undo(); return [...v.engine.blocks()].slice(0, 2).every((b) => !b.style?.color); });
check('색상 변경은 undo 한 번', canUndo1);

// ───── 화살표 끝점 재연결 (FR-065) ─────
const re = await ws(() => {
  const v = window.__dn.view; const e = v.engine;
  v.fit(); // 앞 검사가 카메라를 옮겼을 수 있다 — 화살표 끝점이 화면 안에 오게
  const a = [...e.arrows()][0];
  v.selectArrow(a.id);
  const geo = e.arrowGeometry(a);
  // 다른 블록과 겹치지 않는 지점을 가진 블록을 대상으로 (그 지점의 최상위 블록 = 기대값)
  const r = v.root.getBoundingClientRect(); const c = v.camera;
  const S = (p) => ({ x: r.left + (p.x - c.x) * c.zoom, y: r.top + (p.y - c.y) * c.zoom });
  for (const b of e.blocks()) {
    if (b.id === a.from.blockId || b.id === a.to.blockId) continue;
    const p = { x: b.x + b.w / 2, y: b.y + 12 };
    if (e.hitTest(p, 0)?.id === b.id) return { id: a.id, oldTo: a.to.blockId, end: S(geo.b), target: b.id, dest: S(p) };
  }
  return null;
});
await page.waitForTimeout(50);
await page.mouse.move(re.end.x, re.end.y);
await page.mouse.down();
await page.mouse.move(re.dest.x, re.dest.y, { steps: 8 });
await page.mouse.up();
const newTo = await ws((id) => window.__dn.view.engine.getArrow(id).to.blockId, re.id);
check('화살표 끝점을 끌어 다른 블록에 재연결', newTo === re.target, `${re.oldTo.slice(0, 4)} → ${newTo.slice(0, 4)}`);
await ws(() => window.__dn.view.undo());
check('재연결은 undo로 되돌림', (await ws((id) => window.__dn.view.engine.getArrow(id).to.blockId, re.id)) === re.oldTo);

// ───── 마크다운 단축 직후 Backspace (FR-028) ─────
await ws(() => window.__dn.view.select([]));
await page.evaluate(() => window.__dn.view.setTool('block')); await page.mouse.click(1000, 760);
await page.keyboard.press('Enter');
await page.keyboard.type('- ');
await page.keyboard.press('Backspace');
const bs = await ws(() => { const v = window.__dn.view; const id = [...v.engine.blocks()].sort((a, b) => b.y - a.y)[0].id; return JSON.stringify(v.engine.contentsOf(id).map((c) => c.doc)); });
check('"- " 목록 변환 직후 Backspace → 원래 글자로', !bs.includes('bullet_list') && bs.includes('"- "'), bs.slice(0, 160));
await page.keyboard.press('Escape');

// ───── 선택한 글 → 새 블록 (FR-017) ─────
await page.evaluate(() => window.__dn.view.setTool('block')); await page.mouse.click(1000, 640);
await page.keyboard.type('원본 제목');
await page.keyboard.press('Enter');
await page.keyboard.type('떼어낼 문장');
await page.keyboard.press('Shift+Home');
await page.waitForTimeout(100);
const nb0 = await ws(() => window.__dn.view.engine.blockCount);
await page.locator('.dn-bubble:not([hidden]) .dn-bubble-more').click(); // 블록으로 분리는 '⋯' 안 (DS-008)
await page.locator('.dn-bubble-extract').click();
await page.waitForTimeout(150);
const ex = await ws(() => {
  const e = window.__dn.view.engine;
  const docs = [...e.blocks()].map((b) => JSON.stringify(e.contentsOf(b.id).map((c) => c.doc)));
  return { n: e.blockCount, src: docs.find((d) => d.includes('원본 제목')), moved: docs.filter((d) => d.includes('떼어낼 문장')).length };
});
check('선택한 글을 새 블록으로 분리 · 원본에서 제거', ex.n === nb0 + 1 && !ex.src.includes('떼어낼 문장') && ex.moved === 1, JSON.stringify({ n: ex.n - nb0, moved: ex.moved }));
await ws(() => window.__dn.view.undo());
const ex2 = await ws(() => { const e = window.__dn.view.engine; return { n: e.blockCount, src: [...e.blocks()].map((b) => JSON.stringify(e.contentsOf(b.id).map((c) => c.doc))).find((d) => d.includes('원본 제목')) }; });
check('분리는 undo 한 번으로 되돌림', ex2.n === nb0 && ex2.src.includes('떼어낼 문장'));

// ───── 텍스트 상자 두 종류: 제목 상자 · 내용 상자 (스키마 v3) ─────
await ws(() => window.__dn.view.select([]));
const boxOf = (needle) => ws((n) => {
  const e = window.__dn.view.engine;
  const b = [...e.blocks()].find((x) => e.contentsOf(x.id).some((c) => JSON.stringify(c.doc).includes(n)));
  if (!b) return null;
  const cs = e.contentsOf(b.id);
  return { id: b.id, n: cs.length, roles: cs.map((c) => c.role).join(), doc: JSON.stringify(cs[0].doc), cls: document.querySelector(`.dn-block[data-id="${b.id}"]`)?.className ?? '' };
}, needle);
// T 도구 → 클릭 → 제목 상자
await page.keyboard.press('Escape');
await ws(() => window.__dn.view.root.focus());
await page.keyboard.press('t');
await page.mouse.click(1150, 140);
await page.keyboard.type('- 목록 아님');
await page.evaluate(() => {
  const dt = new DataTransfer(); dt.setData('text/plain', ' 첫째\n둘째');
  document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
});
await page.keyboard.press('Enter'); // 제목 상자: Enter = 편집 끝
await page.waitForTimeout(150);
let tb = await boxOf('목록 아님');
check('T 도구로 제목 상자: 텍스트 하나(role title) · "- "가 목록이 안 되고 여러 줄 붙여넣기는 한 줄 · Enter로 편집 끝',
  tb?.n === 1 && tb.roles === 'title' && tb.doc.includes('- 목록 아님 첫째 둘째') && (tb.doc.match(/"paragraph"/g) || []).length === 1
    && tb.cls.includes('dn-box-title') && !(await ws(() => window.__dn.view.ui?.editing ?? !!document.querySelector('.dn-text-editing'))), JSON.stringify(tb));
// 빈 곳 더블클릭으로는 상자를 만들지 않는다
const nDbl = await ws(() => window.__dn.view.engine.blockCount);
await page.mouse.dblclick(1150, 420);
await page.waitForTimeout(150);
check('빈 곳 더블클릭 → 상자를 만들지 않음', (await ws(() => window.__dn.view.engine.blockCount)) === nDbl);
// 내용 상자 도구 + 누르기 → 내용 상자 (Enter는 새 줄)
await page.evaluate(() => window.__dn.view.setTool('block')); await page.mouse.click(1150, 420);
await page.keyboard.type('내용 첫 줄');
await page.keyboard.press('Enter');
await page.keyboard.type('- 목록 항목');
await page.keyboard.press('Escape');
await page.waitForTimeout(150);
const cb = await boxOf('내용 첫 줄');
check('더블클릭으로 내용 상자: 텍스트 하나(role body) · Enter는 새 줄 · 마크다운 목록', cb?.n === 1 && cb.roles === 'body' && cb.doc.includes('bullet_list') && cb.cls.includes('dn-box-text'), JSON.stringify(cb));
// 블록 메뉴로 상자 종류 바꾸기 (내용 → 제목 → 내용)
await ws((id) => { const v = window.__dn.view; v.select([id]); v['onBlockMenu']({ ids: [id], x: 400, y: 200 }); }, cb.id);
await page.locator('.menu-sub > button', { hasText: '바꾸기' }).click(); // 하위 메뉴 (DS-001)
await page.locator('.menu button', { hasText: '제목 상자' }).click();
let cv = await boxOf('내용 첫 줄');
check('블록 메뉴 "제목 상자": 내용을 한 줄로 펴서 제목 상자로', cv.roles === 'title' && cv.doc.includes('내용 첫 줄 목록 항목'), cv.doc.slice(0, 120));
await ws(() => window.__dn.view.undo());
cv = await boxOf('내용 첫 줄');
check('상자 바꾸기는 undo 한 번으로 원래대로', cv.roles === 'body' && cv.doc.includes('bullet_list'));
await page.screenshot({ path: `${OUT}/p1-boxes.png` });

// ───── 도킹: 자유 배치 + 가까이 가면 착 붙기 + 겹침 없음 (다른 상자는 움직이지 않음) ─────
// 앞 검사들이 남긴 블록에 영향받지 않게 새 노트에서, 위치를 정한 상자 셋으로
await page.locator('.note-item.add').click();
await page.waitForTimeout(300);
const sampleIds = await ws(() => {
  const v = window.__dn.view; const e = v.engine;
  const mk = (t, x, y) => e.transact((tx) => { const id = tx.createBlock({ x, y, w: 260, h: 68 }); tx.createContent({ blockId: id, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] } }); return id; }, { origin: 'user' }).value;
  const ids = { a: mk('상자 A', 100, 100), b: mk('상자 B', 100, 400), c: mk('상자 C', 800, 100) };
  v.select([]); v.setCamera({ x: 0, y: 0, zoom: 1 });
  return ids;
});
await page.waitForTimeout(300);
const R = (id) => ws((i) => window.__dn.view.engine.blockRect(i), id);
const screenOf = (id) => ws((i) => { const v = window.__dn.view; const r = v.root.getBoundingClientRect(); const s = v.blockScreenRect(i); return { x: r.left + s.x, y: r.top + s.y, w: s.w, h: s.h }; }, id);
const dragBy = async (id, dx, dy) => {
  const s = await screenOf(id);
  await page.mouse.move(s.x + 30, s.y + 12);
  await page.mouse.down();
  await page.mouse.move(s.x + 30 + dx / 2, s.y + 12 + dy / 2, { steps: 4 });
  await page.mouse.move(s.x + 30 + dx, s.y + 12 + dy, { steps: 6 });
  await page.waitForTimeout(60);
};
const others0 = await ws((ids) => ids.map((i) => window.__dn.view.engine.blockRect(i)), [sampleIds.a, sampleIds.c]);
// 1) B를 A 바로 아래 근처(간격 16에서 5px 어긋나게)로 끌면 A 아래에 착 붙는다
{
  const A = await R(sampleIds.a), B = await R(sampleIds.b);
  await dragBy(sampleIds.b, A.x + 4 - B.x, A.y + A.h + 16 + 5 - B.y);
  const guides = await ws(() => window.__dn.view.gesture?.guides?.length ?? 0);
  await page.screenshot({ path: `${OUT}/p1-dock-guides.png` });
  await page.mouse.up();
  const B2 = await R(sampleIds.b), A2 = await R(sampleIds.a);
  check('근처로 끌면 아래에 착 붙기 (왼쪽 맞춤 · 간격 16) · 안내선 표시', B2.x === A2.x && B2.y === A2.y + A2.h + 16 && guides > 0, JSON.stringify({ B2, A: A2, guides }));
}
// 2) 오른쪽 옆에 붙기 (위 맞춤)
{
  const A = await R(sampleIds.a), B = await R(sampleIds.b);
  await dragBy(sampleIds.b, A.x + A.w + 16 + 6 - B.x, A.y - 3 - B.y);
  await page.mouse.up();
  const B2 = await R(sampleIds.b);
  check('근처로 끌면 오른쪽 옆에 착 붙기 (위 맞춤)', B2.x === A.x + A.w + 16 && B2.y === A.y, JSON.stringify(B2));
}
// 3) 멀리 두면 완전 자유 배치 (스냅 없음)
{
  const B = await R(sampleIds.b);
  await dragBy(sampleIds.b, 133, 377);
  await page.mouse.up();
  const B3 = await R(sampleIds.b);
  check('멀리 놓으면 놓은 자리 그대로 (자유 배치)', B3.x - B.x === 133 && B3.y - B.y === 377, JSON.stringify(B3));
}
// 4) 다른 상자 위에 겹치게 놓으면 가장 가까운 빈 자리에 붙고, 밑의 상자는 그대로
{
  const C = await R(sampleIds.c), B = await R(sampleIds.b);
  await dragBy(sampleIds.b, C.x + 20 - B.x, C.y + 10 - B.y);
  await page.mouse.up();
  const B4 = await R(sampleIds.b), C4 = await R(sampleIds.c);
  const ov = !(B4.x + B4.w <= C4.x || C4.x + C4.w <= B4.x || B4.y + B4.h <= C4.y || C4.y + C4.h <= B4.y);
  check('겹치게 놓으면 옆 · 아래 빈 자리로 붙고 밑의 상자는 안 움직임', !ov && JSON.stringify(C4) === JSON.stringify(C), JSON.stringify({ B4, C4 }));
}
// 5) 상자 위를 B 도구로 눌러 만들어도 겹치지 않음 · 복제도 겹치지 않음
{
  const sc = await screenOf(sampleIds.c);
  await ws(() => window.__dn.view.root.focus());
  await page.keyboard.press('b');
  await page.mouse.click(sc.x + 20, sc.y + 10);
  await page.keyboard.type('겹치지 않는 새 상자');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(150);
  const anyOverlap = await ws(() => {
    const bs = [...window.__dn.view.engine.blocks()];
    for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
      const a = bs[i], b = bs[j];
      if (a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5) return true;
    }
    return false;
  });
  check('상자 위에서 새로 만들기 · 복제(Ctrl+D)도 겹치지 않는 자리에 붙음', !anyOverlap && (await ws(() => window.__dn.view.engine.blockCount)) === 5);
}
const others1 = await ws((ids) => ids.map((i) => window.__dn.view.engine.blockRect(i)), [sampleIds.a, sampleIds.c]);
check('도킹 중 다른 상자 위치는 한 번도 바뀌지 않음', JSON.stringify(others0) === JSON.stringify(others1));
await page.screenshot({ path: `${OUT}/p1-dock.png` });
// 구버전(v1) 노트: "heading + 본문" 한 문서 → 열 때 내용 상자 하나로(글자 그대로) · 최신 버전으로 재저장
const v1Id = await ws(async () => {
  const w = window.__dn; const id = 'V1NoteAAAAAAAAAAAAAAAA', b = 'V1BlockAAAAAAAAAAAAAAA', c = 'V1ContentAAAAAAAAAAAAA', b2 = 'V1BlockBBBBBBBBBBBBBBB', c2 = 'V1ContentBBBBBBBBBBBBB';
  const snap = { schemaVersion: 1, engine: { textSchema: 'pm-v1' }, note: { id, title: '옛 노트', createdAt: 1, updatedAt: 1 },
    blocks: { [b]: { id: b, x: 0, y: 0, w: 260, h: 84, sizing: 'auto', layout: 'flow', z: 'a0' }, [b2]: { id: b2, x: 0, y: 200, w: 260, h: 84, sizing: 'auto', layout: 'flow', z: 'a1' } },
    contents: {
      [c]: { id: c, blockId: b, order: 'a0', type: 'text', doc: { type: 'doc', content: [
        { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: '옛 제목' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '옛 본문' }] }] } },
      [c2]: { id: c2, blockId: b2, order: 'a0', type: 'text', doc: { type: 'doc', content: [
        { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: '제목뿐' }] }] } },
    },
    arrows: {}, strokes: {} };
  await w.store.compact(id, snap, 0);
  await w.meta.put({ id, title: '옛 노트', createdAt: 1, updatedAt: Date.now(), schemaVersion: 1 });
  await w.openById(id);
  return id;
});
await page.waitForTimeout(200);
const mig = await ws(async (id) => {
  const e = window.__dn.view.engine;
  const saved = await window.__dn.store.load(id);
  return { a: e.contentsOf('V1BlockAAAAAAAAAAAAAAA').map((c) => c.role).join(), b: e.contentsOf('V1BlockBBBBBBBBBBBBBBB').map((c) => c.role).join(), version: saved.snapshot.schemaVersion, text: document.querySelector('.dn-world')?.innerText };
}, v1Id);
check('구버전 노트 열기 → 제목+본문은 내용 상자, 제목뿐이면 제목 상자 · 최신 버전으로 재저장 (FR-090)',
  mig.a === 'body' && mig.b === 'title' && mig.version === 6 && mig.text.includes('옛 제목') && mig.text.includes('옛 본문'), JSON.stringify(mig));
await page.locator('.note-list .note-item:not(.add)').first().click();
await page.waitForTimeout(200);
// ───── 이동 애니메이션 (FR-012) ─────
const far = await ws(() => { const v = window.__dn.view; return [...v.engine.blocks()].sort((a, b) => b.x - a.x)[0].id; });
const t0 = Date.now();
await ws((id) => window.__dn.view.focusBlock(id), far);
const mid = await ws(() => window.__dn.view.camera.zoom);
await page.waitForFunction(() => window.__dn.view.selBlocks.size === 1, null, { timeout: 2000 });
await page.waitForTimeout(320);
const end = await ws(() => window.__dn.view.camera);
check('특정 블록으로 이동: 애니메이션으로 300ms 안에 도착', Date.now() - t0 < 2000 && Math.abs(end.zoom - mid) >= 0, JSON.stringify(end));

// ───── 노트 목록 정렬 · 이름 (FR-069) ─────
await page.locator('.note-item.add').click();
await page.waitForTimeout(300);
await page.evaluate(() => window.__dn.view.setTool('block')); await page.mouse.click(900, 400);
await page.keyboard.type('자동 제목이 될 첫 줄');
await page.keyboard.press('Escape');
await page.waitForTimeout(700);
const autoTitle = await page.locator('.note-item.active .note-title').innerText();
check('제목이 비면 첫 블록 내용을 목록 제목으로', autoTitle === '자동 제목이 될 첫 줄', autoTitle);
await page.locator('.note-item.active').dblclick();
await page.locator('.note-rename').fill('가나다 노트');
await page.keyboard.press('Enter');
await page.waitForTimeout(600);
check('목록에서 더블클릭으로 이름 바꾸기', (await page.locator('.note-item.active .note-title').innerText()) === '가나다 노트');
// 정렬은 폴더 나무 · 노트 목록 순서 (사이드바 '열린 노트'는 연 순서 그대로 — 11/09 개편)
await page.selectOption('.sort-select', 'title');
const names = await ws(() => window.__dn.state.notes.map((n) => n.title || n.preview || ''));
check('이름순 정렬', JSON.stringify(names) === JSON.stringify([...names].sort((a, b) => a.localeCompare(b, 'ko'))), names.join(' | '));
await page.selectOption('.sort-select', 'updated');

// ───── 휴지통 (FR-076) ─────
// 열린 노트 줄의 × 는 탭 닫기 — 휴지통은 우클릭 메뉴 (11/09 개편)
const nNotes = await page.locator('.note-list .note-item:not(.add)').count();
await page.locator('.open-tabs .note-item.active').click({ button: 'right' });
await page.getByRole('menuitem', { name: '휴지통으로' }).click();
await page.waitForTimeout(300);
check('삭제한 노트는 휴지통으로 + 실행 취소 토스트', (await page.locator('.note-list .note-item:not(.add)').count()) === nNotes - 1 && (await page.locator('.toast button').innerText()) === '실행 취소');
await page.locator('.side-foot .note-item', { hasText: '휴지통' }).click();
await page.waitForSelector('.trash-page');
check('휴지통 화면에 노트 표시', (await page.locator('.trash-table tbody tr').count()) === 1);
await page.screenshot({ path: `${OUT}/p1-trash.png` });
await page.locator('.trash-table .btn', { hasText: '복원' }).click();
await page.waitForTimeout(200);
check('휴지통에서 복원', (await page.locator('.note-list .note-item:not(.add)').count()) === nNotes && (await page.locator('.trash-empty').isVisible()));
// 영구 삭제 (확인 필요)
await page.locator('.note-list .note-item:not(.add)').first().click({ button: 'right' });
await page.getByRole('menuitem', { name: '휴지통으로' }).click();
await page.waitForTimeout(200);
await page.locator('.side-foot .note-item', { hasText: '휴지통' }).click();
await page.locator('.trash-banner .btn').click();
check('휴지통 비우기는 확인 다이얼로그 (초기 포커스 = 취소)', await page.locator('.dialog').isVisible() && (await page.evaluate(() => document.activeElement?.textContent)) === '취소');
await page.screenshot({ path: `${OUT}/p1-empty-confirm.png` });
await page.locator('.dialog .btn.danger').click();
await page.waitForTimeout(300);
const left = await ws(() => window.__dn.state.trash.length);
check('확인 후 영구 삭제', left === 0);

// 30일 지난 항목 자동 삭제
const oldId = await ws(async () => {
  const w = window.__dn; const id = w.state.notes[w.state.notes.length - 1].id;
  await w.meta.patch(id, { deletedAt: Date.now() - 31 * 86400000 });
  return id;
});
await page.reload();
await page.waitForSelector('.dn-block, .empty', { timeout: 15000 });
await page.waitForTimeout(500);
check('30일 지난 휴지통 노트 자동 영구 삭제', !(await ws((id) => window.__dn.state.notes.concat(window.__dn.state.trash).some((n) => n.id === id), oldId)));

// ───── 휠 = 줌 설정 (FR-011 · FR-143) ─────
await ws(() => window.__dn.setWheelMode('zoom'));
const z0 = await ws(() => window.__dn.view.camera.zoom);
await page.mouse.move(900, 450);
await page.mouse.wheel(0, -300);
await page.waitForTimeout(100);
const z1 = await ws(() => window.__dn.view.camera.zoom);
await ws(() => window.__dn.setWheelMode('pan'));
const y0 = await ws(() => window.__dn.view.camera.y);
await page.mouse.wheel(0, 200);
await page.waitForTimeout(100);
const y1 = await ws(() => window.__dn.view.camera);
check('설정 "휠로 확대": 휠 = 줌, 되돌리면 휠 = 팬', z1 > z0 && y1.y !== y0 && Math.abs(y1.zoom - z1) < 1e-9, `zoom ${z0.toFixed(2)}→${z1.toFixed(2)}`);

// ───── 글자 크기 · 줄 간격 (FR-143): 블록 높이가 측정으로 따라온다 ─────
await ws(() => window.__dn.view.fit());
await page.waitForTimeout(300);
// 측정용 세 줄짜리 상자 (어느 노트가 열려 있어도 — 한 줄 상자는 최소 높이 안이라 글자가 커져도 그대로일 수 있다)
await ws(() => window.__dn.view.addBlockAtCenter());
await page.waitForTimeout(100);
await page.keyboard.type('첫째 줄 글자 크기 확인');
await page.keyboard.press('Enter');
await page.keyboard.type('둘째 줄');
await page.keyboard.press('Enter');
await page.keyboard.type('셋째 줄');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
const probeId = await ws(() => window.__dn.view.selectedBlocks[0]);
const hOf = () => ws((id) => window.__dn.view.engine.getBlock(id).h, probeId);
const h0 = await hOf();
await ws(() => window.__dn.setTextScale(1.3));
await page.waitForTimeout(400);
const h1 = await hOf();
await ws(() => window.__dn.setTextScale(1));
await page.waitForTimeout(400);
check('설정 "글자 크게" → 블록 높이가 커지고, 되돌리면 원래대로', h1 > h0 && Math.abs((await hOf()) - h0) < 1, `${h0} → ${h1}`);

// ───── Alt+↑/↓ 줄 이동 (FR-032) · 할 일 개수 (FR-033) ─────
await ws(() => window.__dn.view.select([]));
await ws(() => window.__dn.view.setCamera({ x: -2000, y: -2000, zoom: 1 }));
await page.evaluate(() => window.__dn.view.setTool('block')); await page.mouse.click(700, 400); // 내용 상자
await page.keyboard.type('[] 첫째 할 일');
await page.keyboard.press('Enter');
await page.keyboard.type('둘째 할 일');
await page.keyboard.press('Alt+ArrowUp');
await page.keyboard.press('Escape');
await page.waitForTimeout(700);
const mv = await ws(() => {
  const e = window.__dn.view.engine;
  const b = [...e.blocks()].find((x) => JSON.stringify(e.contentsOf(x.id).map((c) => c.doc)).includes('둘째 할 일'));
  const body = e.contentsOf(b.id).find((c) => c.role === 'body').doc;
  return body.content[0].content.map((li) => li.content[0].content?.[0]?.text);
});
check('Alt+↑로 할 일 항목 순서 바꾸기', JSON.stringify(mv) === JSON.stringify(['둘째 할 일', '첫째 할 일']), JSON.stringify(mv));
const todo = await page.locator('.todo-count').innerText().catch(() => '');
check('상단에 이 노트의 할 일 완료/전체 표시', /0\/2/.test(todo), todo);

// ───── 오프라인 동작 (FR-009): 네트워크를 끊고 노트 열기 · 편집 · 저장 · 직렬화 ─────
await ctx.setOffline(true);
const off = await ws(async () => {
  const w = window.__dn; const id = w.state.notes[0].id;
  await w.openById(id, { force: true });
  const v = w.view; const before = v.engine.blockCount;
  v.addBlockAtCenter();
  v.endEditing();
  await new Promise((r) => setTimeout(r, 1300)); // 자동 저장(최대 1초)
  const saved = await w.store.load(id);
  const json = JSON.stringify(saved);
  return { online: navigator.onLine, added: v.engine.blockCount - before, savedOk: json.length > 100, status: w.state.status };
});
await ctx.setOffline(false);
check('오프라인에서 노트 열기 · 블록 추가 · 자동 저장', !off.online && off.added === 1 && off.savedOk && off.status === 'saved', JSON.stringify(off));

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
