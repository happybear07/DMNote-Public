// 정리 도구 확인: 검색 필터 (FR-122) · 여러 노트 한 번에 (FR-079) · 템플릿 (FR-078).
// 사용: dev 서버 실행 후 `node e2e/tools.mjs [스크린샷 폴더]` (DN_URL로 주소 변경)
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
const current = () => ws(() => window.__dn.state.currentId);

// ───── 준비: 폴더 · 태그 · 할 일이 있는 노트 ─────
const folderId = await ws(() => window.__dn.createFolder('업무'));
await ws((f) => window.__dn.newNote({ folderId: f }), folderId);
await wait(300);
await ws(() => window.__dn.setTitle('주간 보고'));
await ws(() => window.__dn.view.addBlockAtCenter());
await wait(100);
await page.keyboard.type('[] 보고서 쓰기');
await page.keyboard.press('Escape');
const todoNote = await current();
await ws((id) => window.__dn.addTag(id, '중요'), todoNote);
await ws(() => window.__dn.newNote());
await wait(300);
await ws(() => window.__dn.setTitle('보고서 아이디어'));
await ws(() => window.__dn.view.addBlockAtCenter());
await wait(100);
await page.keyboard.type('보고서 형식을 바꾸자');
await page.keyboard.press('Escape');
await wait(800);

// ───── 검색 필터 (FR-122) ─────
await page.keyboard.press('Control+Shift+F');
await page.locator('.search-head input').fill('보고서');
await wait(150);
const names = async () => (await page.locator('.search-row .search-name').allInnerTexts()).map((t) => t.trim());
check('필터 없이: 두 노트 모두', (await names()).length === 2, (await names()).join('|'));
await page.locator('.search-filters select[aria-label="블록 종류"]').selectOption('todo');
await wait(100);
check('블록 종류 = 할 일 → 할 일이 든 노트만', (await names()).join() === '주간 보고', (await names()).join('|'));
await page.locator('.search-filters select[aria-label="블록 종류"]').selectOption('');
await page.locator('.search-filters select[aria-label="폴더"]').selectOption(folderId);
await wait(100);
check('폴더 = 업무 → 그 폴더의 노트만', (await names()).join() === '주간 보고', (await names()).join('|'));
await page.locator('.search-head input').fill('');
await wait(100);
check('검색어 없이 필터만으로도 목록', (await names()).join() === '주간 보고', (await names()).join('|'));
const tagId = await ws(() => window.__dn.state.tags.find((t) => t.name === '중요').id);
await page.locator('.search-filters select[aria-label="폴더"]').selectOption('');
await page.locator('.search-filters select[aria-label="태그"]').selectOption(tagId);
await page.locator('.search-filters select[aria-label="기간"]').selectOption('1');
await wait(100);
check('태그 + 기간 동시 적용', (await names()).join() === '주간 보고', (await names()).join('|'));
await page.locator('.filter-ai input').check();
await wait(100);
check('AI가 만든 블록만 → 없으면 빈 결과 안내', (await page.locator('.search-row').count()) === 0 && (await page.locator('.search-empty').innerText()).includes('조건에 맞는'));
await page.screenshot({ path: `${OUT}/tools-filter.png` });
await page.locator('.search-filters .link-btn').click();
await wait(80);
check('필터 지우기', (await page.locator('.search-filters select.on, .filter-ai.on').count()) === 0);
await page.keyboard.press('Escape');

// ───── 여러 노트 한 번에 (FR-079) — 사이드바 '열린 노트'에서 ─────
const ideaId = await current();
await page.locator('.open-tabs .note-item', { hasText: 'Claude API 구조 정리' }).first().click({ modifiers: ['Control'] });
await wait(100);
check('Ctrl+클릭 → 지금 노트와 함께 2개 선택 · 일괄 작업 줄', (await page.locator('.open-tabs .note-item.picked').count()) === 2 && (await page.locator('.bulk-bar').isVisible()));
await page.locator('.bulk-bar button', { hasText: '# 태그' }).click();
await page.locator('.bulk-tag').fill('묶음');
await page.keyboard.press('Enter');
await wait(400);
const tagged = await ws(() => { const w = window.__dn; const t = w.state.tags.find((x) => x.name === '묶음'); return w.state.notes.filter((n) => n.tagIds?.includes(t?.id)).length; });
check('선택한 노트에 태그 한 번에', tagged === 2, String(tagged));
check('작업 뒤 선택 해제', (await page.locator('.open-tabs .note-item.picked').count()) === 0);
// Shift 범위 선택 → 폴더로 옮기기
await page.locator('.open-tabs .note-item', { hasText: '보고서 아이디어' }).first().click();
await wait(200);
await page.locator('.open-tabs .note-item', { hasText: 'Claude API 구조 정리' }).first().click({ modifiers: ['Shift'] });
await wait(100);
// 범위는 사이드바 '열린 노트' 차례 (11/09 개편): Claude API · 주간 보고 · 보고서 아이디어
check('Shift+클릭 → 범위 선택', (await page.locator('.open-tabs .note-item.picked').count()) === 3);
await page.locator('.bulk-bar select').selectOption(folderId);
await wait(400);
const inFolder = await ws((f) => window.__dn.state.notes.filter((n) => n.folderId === f).length, folderId);
check('선택한 노트를 폴더로 한 번에 옮김', inFolder === 3, String(inFolder));
// 휴지통 + 실행 취소
await page.locator('.open-tabs .note-item', { hasText: '보고서 아이디어' }).first().click();
await wait(200);
await page.locator('.open-tabs .note-item', { hasText: '주간 보고' }).first().click({ modifiers: ['Control'] });
await wait(100);
const before = await ws(() => window.__dn.state.notes.length);
await page.locator('.bulk-bar button', { hasText: '휴지통' }).click();
await wait(400);
check('선택한 노트를 휴지통으로', (await ws(() => window.__dn.state.notes.length)) === before - 2);
await page.locator('.toast button', { hasText: '실행 취소' }).click();
await wait(400);
check('실행 취소로 모두 되돌림', (await ws(() => window.__dn.state.notes.length)) === before);
await page.locator('.open-tabs .note-item', { hasText: '주간 보고' }).first().click();
await wait(200);
await page.locator('.open-tabs .note-item', { hasText: 'Claude API' }).first().click({ modifiers: ['Control'] });
await wait(80);
check('선택 2개', (await page.locator('.open-tabs .note-item.picked').count()) === 2);
await page.keyboard.press('Escape');
await wait(80);
check('Esc로 선택 해제', (await page.locator('.note-item.picked').count()) === 0);

// ───── 템플릿 (FR-078) ─────
await page.locator('.note-item.add').hover();
await page.locator('.note-item.add .tpl-btn').click();
await wait(200);
const dlg = page.locator('.tpl-dialog');
const builtins = await dlg.locator('.tpl-item b').allInnerTexts();
check('기본 템플릿 4종', ['회의록', '강의 필기', '리서치', '주간 계획'].every((n) => builtins.includes(n)), builtins.join('|'));
await dlg.locator('.tpl-item', { hasText: '강의 필기' }).click();
await wait(100);
check('미리보기 (상자 · 글자)', (await dlg.locator('.tpl-preview svg rect').count()) >= 4 && (await dlg.locator('.tpl-preview text').evaluateAll((els) => els.map((e) => e.textContent))).some((t) => t.includes('핵심 개념')));
await page.screenshot({ path: `${OUT}/tools-template.png` });
await dlg.locator('.tpl-item', { hasText: '회의록' }).click();
await dlg.locator('button', { hasText: '이 템플릿으로 만들기' }).click();
await wait(600);
const made = await ws(() => { const w = window.__dn; return { blocks: w.view.engine.blockCount, arrows: [...w.view.engine.arrows()].length, title: w.state.notes.find((n) => n.id === w.state.currentId)?.preview }; });
check('회의록 템플릿으로 새 노트 (블록 · 화살표)', made.blocks === 6 && made.arrows === 3, JSON.stringify(made));
check('템플릿 노트는 첫 블록이 자동 제목', made.title === '회의록', made.title);
// 지금 노트를 템플릿으로 저장 → 갤러리에 나오고, 그걸로 만들 수 있다
await ws(() => window.__dn.openTemplates());
await wait(150);
await dlg.locator('button', { hasText: '지금 노트를 템플릿으로 저장' }).click();
await dlg.locator('.tpl-name').fill('우리 팀 회의');
await page.keyboard.press('Enter');
await wait(300);
check('내 템플릿 저장', (await dlg.locator('.tpl-group', { hasText: '내 템플릿' }).count()) === 1 && (await dlg.locator('.tpl-item', { hasText: '우리 팀 회의' }).count()) === 1);
await dlg.locator('.tpl-item', { hasText: '우리 팀 회의' }).dblclick();
await wait(600);
check('내 템플릿으로 새 노트', (await ws(() => window.__dn.view.engine.blockCount)) === 6);
await page.reload();
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(() => window.__dn.openTemplates());
await wait(200);
check('새로 고침 후 내 템플릿 유지', (await page.locator('.tpl-item', { hasText: '우리 팀 회의' }).count()) === 1);
await page.locator('.tpl-item', { hasText: '우리 팀 회의' }).locator('button[title="지우기"]').click();
await wait(200);
check('내 템플릿 지우기', (await page.locator('.tpl-item', { hasText: '우리 팀 회의' }).count()) === 0);
await page.keyboard.press('Escape');

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
