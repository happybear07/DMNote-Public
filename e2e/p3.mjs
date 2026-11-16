// P3 기능 확인 (FR-029 슬래시 메뉴, FR-047 토글, FR-048 콜아웃, FR-073 폴더 · 하위 노트, FR-074 태그, FR-121 검색, FR-087 빠른 전환).
// 사용: dev 서버 실행 후 `node e2e/p3.mjs [스크린샷 폴더]` (DN_URL로 주소 변경)
import { chromium } from 'playwright-core';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2] ?? '.';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

const browser = await chromium.launch({ channel: process.env.DN_CHANNEL ?? 'msedge', headless: true }); // CI(리눅스)는 DN_CHANNEL=chrome
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
// .env.local 키가 있어도 실제 Claude를 부르지 않게 (가짜 응답 · 비용 방지)
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

/** 편집 중인 블록의 문서 JSON */
const editingDoc = () => ws(() => {
  const v = window.__dn.view; const id = v.selectedBlocks[0];
  return JSON.stringify(v.engine.contentsOf(id).map((c) => c.doc));
});

// ───── 슬래시 메뉴 (FR-029) ─────
await ws(() => window.__dn.newNote());
await wait(300);
await ws(() => window.__dn.view.addBlockAtCenter());
await wait(150);
await page.keyboard.type('/');
await wait(100);
const allItems = await page.locator('.dn-slash .dn-slash-item').count();
const hasAi = await page.locator('.dn-slash .dn-slash-item.ai').count();
check("'/' 입력 → 커맨드 메뉴 (AI 구조화 항목 포함)", allItems >= 12 && hasAi === 1, `${allItems}개`);
await page.keyboard.type('토글');
await wait(80);
const filtered = await page.locator('.dn-slash .dn-slash-item').allInnerTexts();
check('한글 검색어로 필터링 (토글이 맨 위, 토글 제목이 뒤)', filtered[0].split('\n').includes('토글') /* 슬래시 줄은 이름만 (DS-010) */ && !filtered[0].includes('토글 제목') && filtered.every((f) => f.includes('토글')), filtered.join('|'));
await page.keyboard.press('Backspace');
await page.keyboard.press('Backspace');
await page.keyboard.type('ㅋㅇㅇ');
await wait(80);
const cho = await page.locator('.dn-slash .dn-slash-item').allInnerTexts();
check('초성 검색 (ㅋㅇㅇ → 콜아웃)', cho.length === 1 && cho[0].includes('콜아웃'), cho.join('|'));
await page.keyboard.press('Escape');
await wait(50);
check('Esc로 메뉴 닫기 (입력한 글자는 그대로)', (await page.locator('.dn-slash').isHidden()) && (await editingDoc()).includes('/ㅋㅇㅇ'));
// 지우고 다시: 방향키 + Enter로 토글 고르기
await page.keyboard.press('Control+A');
await page.keyboard.press('Backspace');
await page.keyboard.type('/tog');
await wait(50);
await page.keyboard.press('ArrowDown');
await page.keyboard.press('ArrowUp');
await page.keyboard.press('Enter');
await page.keyboard.type('요약 줄');
await page.keyboard.press('Enter');
await page.keyboard.type('숨은 내용 펭귄');
await wait(80);
let d = await editingDoc();
check('방향키 · Enter로 토글 삽입 → 요약 줄 + 내용', d.includes('"toggle"') && !d.includes('/tog') && d.includes('숨은 내용 펭귄'), d.slice(0, 160));

// ───── 토글 (FR-047) ─────
await page.locator('.dn-text-editing .dn-toggle-btn').first().click();
await wait(80);
const hidden = await ws(() => [...document.querySelectorAll('.dn-text-editing [data-type=toggle] > .dn-toggle-body > *')].map((e) => getComputedStyle(e).display));
check('토글 화살표로 접기 (편집 중)', hidden[0] !== 'none' && hidden.slice(1).every((x) => x === 'none'), hidden.join(','));
await page.keyboard.press('Escape');
await wait(100);
await page.locator('.dn-block [data-type=toggle] > .dn-toggle-btn').first().click();
await wait(100);
d = await editingDoc();
check('편집하지 않은 블록에서도 토글 클릭으로 펼치기', d.includes('"open":true'));
await ws(() => window.__dn.view.undo());
await wait(50);
check('접기 · 펼치기는 undo 대상', (await editingDoc()).includes('"open":false'));

// ───── 콜아웃 (FR-048) ─────
const blockId = await ws(() => window.__dn.view.selectedBlocks[0]);
await ws((id) => window.__dn.view.startEditing(id, 'end'), blockId);
await wait(100);
await page.keyboard.press('Enter'); // 접힌 토글 요약 줄 끝 → 토글 다음 줄
await page.keyboard.type('/');
await page.keyboard.type('callout');
await page.keyboard.press('Enter');
await page.keyboard.type('주의할 점');
await wait(80);
d = await editingDoc();
check('접힌 토글에서 Enter → 토글 밖 새 줄 · 콜아웃 삽입', d.includes('"callout"') && /"toggle".*"open":false/.test(d) && d.indexOf('"callout"') > d.indexOf('숨은 내용'), d.slice(0, 200));
await page.locator('.dn-text-editing .dn-callout-icon').click();
await wait(80);
await page.locator('.dn-callout-picker .dn-callout-icons button[aria-label=alert]').click();
await page.locator('.dn-text-editing .dn-callout-icon').click();
await wait(80);
await page.locator('.dn-callout-picker .dn-swatch[data-color=blue]').click();
await wait(80);
d = await editingDoc();
check('콜아웃 아이콘 · 배경색 지정', d.includes('"icon":"alert"') && d.includes('"color":"blue"'));
await page.keyboard.press('Escape');
await page.screenshot({ path: `${OUT}/p3-blocks.png` });

// ───── 폴더 · 노트 아래 블록 (FR-073) ─────
await page.getByRole('button', { name: '새 폴더' }).click();
await page.locator('.folder-tree .note-rename').fill('연구');
await page.keyboard.press('Enter');
await wait(200);
const folderRow = page.locator('.folder-tree .note-item.folder', { hasText: '연구' });
check('폴더 만들기 · 이름 정하기', (await folderRow.count()) === 1);
// 열린 노트 탭을 폴더로 끌어 넣는다 (11/09 개편 — 전체 노트 목록 대신 열린 노트)
const sample = page.locator('.open-tabs .tab-item', { hasText: 'Claude API' });
await sample.dragTo(folderRow);
await wait(300);
const moved = await ws(() => { const w = window.__dn; const f = w.state.folders.find((x) => x.name === '연구'); return w.state.notes.find((n) => n.title.includes('Claude API'))?.folderId === f?.id; });
check('드래그 앤 드롭으로 노트를 폴더에 넣기', moved);
const sampleId = await ws(() => window.__dn.state.notes.find((n) => n.title.includes('Claude API')).id);
// 하위 문서는 없다: 예전 하위 노트(parentNoteId)도 상위 노트와 같은 줄(폴더 안)에, 노트 줄에는 +(블록 추가)가 없다
await ws((id) => window.__dn.newNote({ parentNoteId: id }), sampleId);
await wait(200);
await ws(() => window.__dn.setTitle('예전 하위 노트'));
await wait(600);
const pad = (t) => ws((t) => { const row = [...document.querySelectorAll('.folder-tree .note-item')].find((e) => e.querySelector('.note-title')?.textContent?.includes(t)); return row ? parseInt(row.style.paddingLeft, 10) : -1; }, t);
check('하위 문서 없음: 예전 하위 노트도 상위 노트와 같은 줄 (폴더 안)', (await pad('예전 하위 노트')) === (await pad('Claude API')) && (await pad('Claude API')) > 6, String(await pad('예전 하위 노트')));
const notesBefore = await ws(() => window.__dn.state.notes.length);
const sampleRow = page.locator('.folder-tree .note-item:not(.folder)', { hasText: 'Claude API' });
await sampleRow.hover();
check('노트 줄에는 블록 추가(+)가 없음 · 폴더에는 새 노트(+)', (await sampleRow.locator('.row-actions button[aria-label*="새 노트"]').count()) === 0 && (await folderRow.locator('.row-actions button[aria-label*="새 노트"]').count()) === 1 && (await ws(() => window.__dn.state.notes.length)) === notesBefore);
// 블록은 상자들을 묶어서 (Ctrl+G) — 사이드바 노트 아래에 이름으로
await ws((id) => window.__dn.openById(id), sampleId);
await wait(400);
await ws(() => { const e = window.__dn.view.engine; const ids = [...e.blocks()].slice(0, 2).map((b) => b.id); window.__dn.view.select(ids); });
await page.locator('.dn-canvas').focus();
await page.keyboard.press('Control+g');
await wait(200);
await ws(() => { const g = [...window.__dn.view.engine.blocks()].find((b) => b.group)?.group; if (g) window.__dn.renameNoteBlock(g, '새 블록 이름'); });
await wait(700);
check('사이드바 노트 아래에 새 블록', (await page.locator('.note-blocks .block-item', { hasText: '새 블록 이름' }).count()) === 1);
await ws(() => window.__dn.openById(window.__dn.state.notes.find((x) => x.title === '예전 하위 노트').id));
await wait(300);
await folderRow.locator('.caret').click();
await wait(100);
check('폴더 접기 → 안의 노트 숨김', (await page.locator('.folder-tree .note-item', { hasText: 'Claude API' }).count()) === 0);
await folderRow.locator('.caret').click();
await wait(100);

// ───── 태그 (FR-074) ─────
await page.locator('.tag-add-btn').click();
await page.keyboard.type('중요');
await page.keyboard.press('Enter');
await page.keyboard.press('Escape');
await wait(200);
await ws((id) => window.__dn.openById(id), sampleId);
await wait(300);
await page.locator('.tag-add-btn').click();
await page.keyboard.type('중');
await wait(80);
const sug = await page.locator('.tag-suggest div').allInnerTexts();
await page.keyboard.press('Enter');
await page.keyboard.press('Escape');
await wait(200);
check('태그 자동완성으로 기존 태그 붙이기', sug[0] === '#중요' && (await ws(() => window.__dn.state.tags.length)) === 1, sug.join('|'));
const tagRow = page.locator('.tag-list .tag-item', { hasText: '중요' });
check('사이드바 태그 목록 · 노트 개수', (await tagRow.locator('.count').innerText()) === '2');
await tagRow.click();
await wait(100);
const filteredNotes = await page.locator('.tag-notes .note-item').allInnerTexts();
check('태그 클릭 → 그 태그의 노트만', filteredNotes.length === 2 && (await page.locator('.filter-bar').innerText()).includes('#중요'), filteredNotes.join('|'));
await tagRow.dblclick();
await page.locator('.tag-list .note-rename').fill('핵심');
await page.keyboard.press('Enter');
await wait(200);
check('태그 이름 바꾸기 → 노트의 태그 칩에도 반영', (await page.locator('.tag-bar .tag-chip').first().innerText()).includes('#핵심'));
await page.getByRole('button', { name: '태그 필터 해제' }).click();

// ───── 검색 (FR-121) · 빠른 전환 (FR-087) ─────
await page.keyboard.press('Control+Shift+F');
await page.locator('.search-head input').fill('펭귄');
await wait(150);
const hits = await page.locator('.search-row').allInnerTexts();
check('전체 검색: 접힌 토글 안 글자도 찾고 문맥 표시', hits.length === 1 && hits[0].includes('숨은 내용 펭귄'), hits.join('|'));
const markText = await page.locator('.search-row mark').first().innerText();
await page.keyboard.press('Enter');
await wait(500);
const after = await ws(() => ({ cur: window.__dn.state.currentId, sel: window.__dn.view.selectedBlocks[0], zoom: window.__dn.view.camera?.zoom }));
check('결과 클릭 → 노트 전환 + 블록 선택', after.sel === blockId && markText === '펭귄', JSON.stringify(after));
// 표 데이터도 검색 대상
await ws(() => window.__dn.view.engine.transact((tx) => {
  const b = tx.createBlock({ x: 3000, y: 3000, w: 300, h: 120 });
  tx.createContent({ blockId: b, type: 'table', schema: 'table-v0', title: '요금표', columns: ['플랜', '가격'], rows: [['프로', '두루미요금']] });
}, { origin: 'user' }));
await wait(700);
await page.keyboard.press('Control+Shift+F');
await page.locator('.search-head input').fill('두루미');
await wait(150);
check('표 블록의 글자도 검색', (await page.locator('.search-row').count()) === 1);
await page.keyboard.press('Escape');
// 휴지통 노트는 빠진다
const curId = await ws(() => window.__dn.state.currentId);
await ws((id) => window.__dn.trash(id), curId);
await wait(300);
await page.keyboard.press('Control+Shift+F');
await page.locator('.search-head input').fill('펭귄');
await wait(150);
check('휴지통의 노트는 검색에서 빠짐', (await page.locator('.search-row').count()) === 0 && (await page.locator('.search-empty strong').innerText()).includes('검색 결과가 없어요'));
await page.keyboard.press('Escape');
await ws((id) => window.__dn.restore([id]), curId);
await wait(200);
await page.keyboard.press('Control+P');
await wait(100);
const recent = await page.locator('.search-row').allInnerTexts();
await page.locator('.search-head input').fill('claude');
await wait(80);
await page.keyboard.press('Enter');
await wait(300);
check('Ctrl+P 빠른 전환: 최근 노트 목록 · 이름으로 이동', recent.length >= 3 && (await ws((id) => window.__dn.state.currentId === id, sampleId)));

// ───── 다시 열어도 유지 ─────
await page.reload();
await page.waitForSelector('.dn-block', { timeout: 15000 });
await wait(500);
const persisted = await ws(() => {
  const w = window.__dn;
  return { folders: w.state.folders.map((f) => f.name), tags: w.state.tags.map((t) => t.name), inFolder: !!w.state.notes.find((n) => n.title.includes('Claude API'))?.folderId, child: !!w.state.notes.find((n) => n.title === '예전 하위 노트') };
});
check('새로 고침 후 폴더 · 태그 · 계층 유지', persisted.folders.join() === '연구' && persisted.tags.join() === '핵심' && persisted.inFolder && persisted.child, JSON.stringify(persisted));
await page.keyboard.press('Control+Shift+F');
await page.locator('.search-head input').fill('펭귄');
await wait(150);
check('새로 고침 후 검색 색인 유지', (await page.locator('.search-row').count()) === 1);
await page.keyboard.press('Escape');
await page.screenshot({ path: `${OUT}/p3-sidebar.png` });

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
