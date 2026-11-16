// 문서 뷰 · 인쇄 확인 (FR-088 · FR-131): 읽기 순서 · 화살표 관계 줄, 문서에서 고치면 캔버스에 반영 · 실행 취소 공유,
// 보기 유지, 인쇄 화면(편집 UI 빠짐) · PDF 만들기.
// 사용: dev 서버 실행 후 `node e2e/docview.mjs [출력 폴더]`
import { chromium } from 'playwright-core';
import { join } from 'node:path';

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
const wait = (ms) => page.waitForTimeout(ms);
await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await wait(400);

// ───── 문서 뷰로 ─────
await page.locator('.view-toggle button', { hasText: '문서' }).click();
await page.waitForSelector('.dn-doc-item');
const items = await page.locator('.dn-doc-item').allInnerTexts();
check('블록 수만큼 문서 항목', items.length === (await ws(() => window.__dn.view.engine.blockCount)), String(items.length));
check('읽기 순서: 위 → 아래, 같은 줄은 왼쪽 → 오른쪽', items[0].includes('AI 구조화 흐름') && items[1].includes('구조 분석') && items[2].includes('프롬프트 구성') && items[3].includes('응답 스키마') && items[4].includes('캔버스 반영'), items.map((t) => t.split('\n')[0]).join(' | '));
// 화살표로 이어진 흐름은 단계 번호 + 다음 단계로 가는 화살표 라벨은 '↓ 라벨' (flow.ts)
check('화살표 흐름 → 단계 번호 · ↓ 라벨', items[1].includes('↓ 1단계') && items[2].includes('↓ 검증') && (await page.locator('.dn-doc-item[data-step="1"]').count()) === 1, items.slice(1, 3).join(' | '));
check('캔버스 도구 막대 · 확대 숨김', (await page.locator('.toolbar').count()) === 0 && (await page.locator('.zoom').count()) === 0);
await page.screenshot({ path: `${OUT}/docview.png` });

// ───── 문서에서 고치기 → 캔버스 ─────
const target = page.locator('.dn-doc-item').nth(2).locator('.dn-doc-text');
const box = await target.boundingBox();
await page.mouse.click(box.x + box.width - 4, box.y + box.height - 6);
await wait(150);
check('글 상자를 누르면 그 자리에서 편집', (await page.locator('.dn-doc-editing .dn-text-editing').count()) === 1);
await page.keyboard.press('End');
await page.keyboard.type(' (문서에서 추가)');
await page.keyboard.press('Escape');
await wait(200);
check('편집을 끝내면 문서에 반영', (await page.locator('.dn-doc-item').nth(2).innerText()).includes('(문서에서 추가)'));
await page.locator('.view-toggle button', { hasText: '캔버스' }).click();
await wait(300);
const canvasText = await page.locator('.dn-block', { hasText: '프롬프트 구성' }).innerText();
check('캔버스에도 같은 내용 (같은 데이터)', canvasText.includes('(문서에서 추가)'), canvasText);
await ws(() => window.__dn.view.root.focus());
await page.keyboard.press('Control+z');
await wait(200);
check('캔버스의 실행 취소로 문서 편집이 되돌아감 (하나의 기록)', !(await page.locator('.dn-block', { hasText: '프롬프트 구성' }).innerText()).includes('(문서에서 추가)'));

// ───── 보기 유지 · 검색 이동 ─────
await page.locator('.view-toggle button', { hasText: '문서' }).click();
await wait(700);
await page.reload();
await page.waitForSelector('.dn-doc-item', { timeout: 15000 });
check('새로 고침 후에도 문서 뷰', (await ws(() => window.__dn.state.viewMode)) === 'doc');
const hit = await ws(() => window.__dn.search('재요청')[0]);
await ws((h) => window.__dn.openHit(h.noteId, h.blocks[0].id), hit);
await wait(150);
check('검색 결과 → 문서에서 그 블록 강조', (await page.locator('.dn-doc-item.dn-doc-flash').innerText()).includes('응답 스키마'));

// ───── 인쇄 ─────
await page.emulateMedia({ media: 'print' });
const printed = await ws(() => ({
  sidebar: getComputedStyle(document.querySelector('.sidebar')).display,
  topbar: getComputedStyle(document.querySelector('.topbar')).display,
  doc: getComputedStyle(document.querySelector('.doc-host')).display,
  breakInside: getComputedStyle(document.querySelector('.dn-doc-item')).breakInside,
}));
check('인쇄 화면: 사이드바 · 상단 바 빠짐, 문서만, 블록이 페이지에서 안 잘림', printed.sidebar === 'none' && printed.topbar === 'none' && printed.doc === 'block' && printed.breakInside === 'avoid', JSON.stringify(printed));
const pdf = await page.pdf({ path: join(OUT, 'docview.pdf'), format: 'A4', printBackground: true });
check('PDF 만들기', pdf.length > 5000 && pdf.subarray(0, 4).toString() === '%PDF', `${pdf.length} bytes`);
await page.emulateMedia({ media: 'screen' });

// 캔버스로 돌려 두기 (다른 테스트에 영향 없게 — 기기 설정)
await page.locator('.view-toggle button', { hasText: '캔버스' }).click();
check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
