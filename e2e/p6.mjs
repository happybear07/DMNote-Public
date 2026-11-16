// P6 기능 확인 (FR-080 노트 간 링크 · FR-081 백링크) + 노트 정보 (FR-071) · 명령 팔레트 (FR-087) · 복제 (FR-077) · 첫 사용 안내 (FR-148).
// 사용: dev 서버 실행 후 `node e2e/p6.mjs [스크린샷 폴더]` (DN_URL로 주소 변경)
import { chromium } from 'playwright-core';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2] ?? '.';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

const browser = await chromium.launch({ channel: process.env.DN_CHANNEL ?? 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await ctx.addInitScript(() => localStorage.setItem('dn:no-env-key', '1'));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });

const ws = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await wait(400);

const editingDoc = () => ws(() => {
  const v = window.__dn.view; const id = v.selectedBlocks[0];
  return JSON.stringify(v.engine.contentsOf(id).map((c) => c.doc));
});
const current = () => ws(() => ({ id: window.__dn.state.currentId, title: window.__dn.state.title }));

// 대상 노트 하나 만들기
await ws(() => window.__dn.newNote());
await wait(300);
await ws(() => window.__dn.setTitle('펭귄 연구'));
const targetId = (await current()).id;
await wait(600);

// 링크를 걸 노트
await ws(() => window.__dn.newNote());
await wait(300);
await ws(() => window.__dn.setTitle('링크 출발'));
const sourceId = (await current()).id;
await ws(() => window.__dn.view.addBlockAtCenter());
await wait(150);

// ───── '[[' 자동완성 ─────
await page.keyboard.type('참고: [[');
await wait(100);
const menu = page.locator('.dn-link-menu');
check("'[[' 입력 → 노트 링크 메뉴", await menu.isVisible());
await page.keyboard.type('펭귄');
await wait(100);
const items = await menu.locator('.dn-slash-item').allInnerTexts();
check('제목으로 노트 찾기 (지금 노트는 빠짐)', items[0]?.includes('펭귄 연구') && !items.some((t) => t.includes('링크 출발')), items.join(' | '));
await page.keyboard.press('Enter');
await wait(150);
let d = await editingDoc();
check('Enter → 링크 노드 삽입 · 트리거 글자 지움', d.includes('"note_link"') && d.includes(targetId) && !d.includes('[[') && d.includes('참고: '), d.slice(0, 240));

// ───── '@'로도 찾기 ─────
await page.keyboard.type('@펭');
await wait(100);
check("'@'로도 노트 찾기", (await menu.isVisible()) && (await menu.locator('.dn-slash-item').first().innerText()).includes('펭귄 연구'));
await page.keyboard.press('Escape');
await page.keyboard.press('Backspace');
await page.keyboard.press('Backspace');

// ───── 없는 이름(띄어쓰기 포함) → 새 노트 만들고 연결 ─────
await page.keyboard.type('그리고 [[새로운 주제');
await wait(100);
const last = await menu.locator('.dn-slash-item').last().innerText();
check("없는 이름 → '새 노트 만들기' 항목", (await menu.isVisible()) && last.includes('새로운 주제') && last.includes('새 노트'), last);
await menu.locator('.dn-slash-item').last().dispatchEvent('mousedown');
await wait(500);
d = await editingDoc();
const created = await ws(() => window.__dn.state.notes.find((n) => n.title === '새로운 주제'));
check('새 노트가 생기고 링크로 연결', !!created && d.includes(created.id), created?.id);
check('만든 뒤에도 지금 노트에 머묾', (await current()).id === sourceId);

// 메일 주소처럼 단어 중간의 '@' · 맞는 노트 없이 띄어 쓴 '@'는 메뉴를 거둔다
await page.keyboard.type(' a@b');
await wait(80);
check("단어 중간 '@'에서는 메뉴가 뜨지 않음", await menu.isHidden());
await page.keyboard.type(' @집에서 ');
await wait(80);
check("'@' 뒤 맞는 노트 없이 띄어 쓰면 메뉴 닫힘", await menu.isHidden());

// ───── 정적 렌더 · 제목 변경 반영 ─────
await page.keyboard.press('Escape');
await wait(200);
const linkText = () => page.locator(`.dn-block a.dn-note-link[data-note="${targetId}"]`).first().innerText();
check('편집을 끝내도 링크가 보임', (await linkText()) === '펭귄 연구');
await ws((id) => window.__dn.openById(id), targetId);
await wait(300);
await ws(() => window.__dn.setTitle('황제펭귄 연구'));
await wait(700);
await ws((id) => window.__dn.openById(id), sourceId);
await wait(400);
check('대상 제목을 바꾸면 링크 글자도 바뀜', (await linkText()) === '황제펭귄 연구', await linkText());

// ───── 누르면 이동 ─────
await page.locator(`.dn-block a.dn-note-link[data-note="${targetId}"]`).first().click();
await wait(400);
check('링크 누르기 → 그 노트로 이동', (await current()).id === targetId);
await ws((id) => window.__dn.openById(id), sourceId);
await wait(400);

// ───── 검색에도 링크 글자가 들어감 ─────
const hits = await ws(() => window.__dn.search('펭귄').map((h) => h.noteId));
check('링크가 든 문단도 검색됨', hits.includes(sourceId), JSON.stringify(hits));

// ───── 휴지통으로 간 대상 → 흐린 링크, 눌러도 이동 안 함 ─────
await ws((id) => window.__dn.trash(id), targetId);
await wait(300);
await ws((id) => window.__dn.openById(id), sourceId);
await wait(400);
const missing = await page.locator(`.dn-block a.dn-note-link[data-note="${targetId}"]`).first().evaluate((a) => a.classList.contains('missing'));
check('대상이 휴지통이면 링크가 흐려짐', missing);
await page.locator(`.dn-block a.dn-note-link[data-note="${targetId}"]`).first().click();
await wait(300);
check('흐린 링크는 이동하지 않음', (await current()).id === sourceId);
await ws((ids) => window.__dn.restore(ids), [targetId]);
await wait(300);
check('복원하면 다시 살아남', !(await page.locator(`.dn-block a.dn-note-link[data-note="${targetId}"]`).first().evaluate((a) => a.classList.contains('missing'))));

// ───── 새로 고침 후 유지 ─────
await page.reload();
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws((id) => window.__dn.openById(id), sourceId);
await wait(500);
check('새로 고침 후 링크 유지', (await page.locator('.dn-block a.dn-note-link').count()) >= 2);
await page.screenshot({ path: `${OUT}/p6-links.png` });

// ───── 백링크 · 노트 정보 패널 (FR-081 · FR-071) ─────
await ws((id) => window.__dn.openById(id), targetId);
await wait(400);
const badge = await page.locator('.panel-btn .count').innerText().catch(() => '');
check('상단 바 패널 버튼에 백링크 수', badge === '1', badge);
await page.locator('.panel-btn').click();
await wait(200);
const panel = page.locator('.note-panel');
const bl = await panel.locator('.backlink-note').allInnerTexts();
check('패널에 이 노트를 링크한 노트', bl.length === 1 && bl[0].includes('링크 출발'), bl.join('|'));
const ctxText = await panel.locator('.backlink-ctx').first().innerText();
check('링크한 문장의 문맥', ctxText.includes('참고:'), ctxText);
const info = await panel.locator('.info-list').innerText();
check('노트 정보: 만든 날 · 고친 날 · 블록 · 글자', /만든 날/.test(info) && /고친 날/.test(info) && /블록/.test(info) && /글자/.test(info), info.replaceAll('\n', ' '));
await page.screenshot({ path: `${OUT}/p6-panel.png` });
await panel.locator('.backlink-ctx').first().click();
await wait(400);
check('문맥을 누르면 링크한 노트로 이동', (await current()).id === sourceId);
check('패널 열림 상태 유지', await panel.isVisible());

// ───── 명령 팔레트 · 복제 (FR-087 · FR-077) ─────
await ws(async (id) => { await window.__dn.addTag(id, '복제확인'); }, sourceId);
await wait(200);
await page.locator('.canvas-host').click({ position: { x: 30, y: 30 } });
await page.keyboard.press('Control+Shift+P');
await wait(150);
const pal = page.locator('[aria-label="명령 팔레트"]');
check('Ctrl+Shift+P → 명령 팔레트', await pal.isVisible());
await page.keyboard.type('ㅂㅈ');
await wait(80);
const cmds = await pal.locator('.cmd-row').allInnerTexts();
check('초성으로 명령 찾기 (ㅂㅈ → 복제)', cmds[0]?.includes('복제'), cmds.join('|'));
await page.keyboard.press('Enter');
await wait(800);
const dup = await ws(() => { const w = window.__dn; const n = w.state.notes.find((x) => x.id === w.state.currentId); return { title: n?.title, tags: n?.tagIds?.length ?? 0, blocks: w.view.engine.blockCount, id: n?.id }; });
const srcBlocks = await ws((id) => window.__dn.state.notes.find((n) => n.id === id)?.stats?.blocks, sourceId);
check("복제: '(사본)' 제목 · 블록 · 태그까지", dup.title === '링크 출발 (사본)' && dup.blocks === srcBlocks && dup.tags === 1 && dup.id !== sourceId, JSON.stringify({ ...dup, srcBlocks }));
const dupLinks = await page.locator('.dn-block a.dn-note-link').count();
check('복제한 노트의 링크도 살아 있음', dupLinks >= 2, String(dupLinks));

// 사이드바 우클릭 메뉴
await page.locator('.note-item', { hasText: '황제펭귄 연구' }).first().click({ button: 'right' });
await wait(100);
const menuItems = await page.locator('.row-menu button').allInnerTexts();
check('노트 우클릭 메뉴 (복제 포함)', menuItems.some((t) => t.includes('복제')) && menuItems.some((t) => t.includes('휴지통')), menuItems.join('|'));
await page.keyboard.press('Escape');
await wait(80);
check('Esc로 메뉴 닫기', (await page.locator('.row-menu').count()) === 0);

// ───── 새 노트에는 안내 없음 (10/29 사용자 요청 — 노트를 만들 때마다 뜨던 빈 캔버스 안내를 뺌) · 샘플 체험은 명령 팔레트로 (FR-148) ─────
await ws(() => window.__dn.newNote());
await wait(400);
check('새 빈 노트 → 빈 캔버스 안내 없음', (await page.locator('.canvas-guide').count()) === 0);
check('데스크톱에서는 설치 안내 없음', (await page.locator('.install-hint').count()) === 0);
await page.screenshot({ path: `${OUT}/p6-guide.png` });
await ws(() => window.__dn.trySample());
await wait(600);
check('샘플 체험 → 상자 생김', (await page.locator('.dn-block').count()) === 1);
check('샘플 상자에 "구조화하기" 칩', (await page.locator('.ai-chip').count()) === 1);
await page.screenshot({ path: `${OUT}/p6-sample.png` });

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
