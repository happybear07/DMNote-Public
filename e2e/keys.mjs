// 편집 편의 확인: 링크 · URL 자동 인식 (FR-030), 부록 A 단축키 · 도움말 (FR-023), 목차 (FR-084), 읽기 모드 (FR-085).
// 사용: dev 서버 실행 후 `node e2e/keys.mjs [스크린샷 폴더]`
import { chromium } from 'playwright-core';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2] ?? '.';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

const browser = await chromium.launch({ channel: process.env.DN_CHANNEL ?? 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
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
const doc = () => ws(() => JSON.stringify([...window.__dn.view.engine.contents()].map((c) => c.doc)));
const pasteText = (t) => page.evaluate((text) => {
  const dt = new DataTransfer(); dt.setData('text/plain', text);
  document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, t);

await ws(() => window.__dn.newNote());
await wait(300);
await ws(() => window.__dn.view.addBlockAtCenter());
await wait(100);

// ───── 링크 (FR-030) ─────
await page.keyboard.type('참고 ');
await pasteText('https://example.com/a?b=1');
await wait(80);
let d = await doc();
check('URL만 붙여넣기 → 링크', d.includes('"href":"https://example.com/a?b=1"'), d.slice(0, 160));
await page.keyboard.type(' 그리고 문서');
await page.keyboard.press('Shift+ArrowLeft');
await page.keyboard.press('Shift+ArrowLeft');
await wait(60); // 에디터가 선택 변경(selectionchange)을 읽을 시간
await pasteText('https://docs.example.com');
await wait(80);
d = await doc();
check('글을 고르고 URL 붙여넣기 → 그 글에 링크', d.includes('{"type":"text","marks":[{"type":"link","attrs":{"href":"https://docs.example.com"}}],"text":"문서"}'), d.slice(0, 260));
page.once('dialog', (dg) => void dg.accept('https://k.example.com'));
await page.keyboard.press('Control+a');
await wait(60);
await page.keyboard.press('Control+Shift+Backslash');
await wait(80);
d = await doc();
// 서식 지우기는 링크 · 댓글 표시는 남긴다 (워드 · 구글 문서처럼, text-pm clearFormat)
check('Ctrl+Shift+\\ → 글자 서식 모두 지우기 (링크는 남김)', !/"type":"(strong|em|underline|strike|highlight|code|sup|sub)"/.test(d), d.slice(0, 200));
await page.keyboard.press('Control+k');
await wait(150);
d = await doc();
check('Ctrl+K → 고른 글에 링크', d.includes('k.example.com'));

// ───── 블록 타입 · 할 일 · 토글 단축키 ─────
await page.keyboard.press('End');
await page.keyboard.press('Enter');
await page.keyboard.type('할 일 줄');
await page.keyboard.press('Control+Alt+4');
await wait(60);
check('Ctrl+Alt+4 → 할 일 목록', (await doc()).includes('"task_item","attrs":{"checked":false}'));
await page.keyboard.press('Control+Enter');
await wait(60);
check('Ctrl+Enter → 할 일 체크', (await doc()).includes('"task_item","attrs":{"checked":true}'));
await page.keyboard.press('End');
await page.keyboard.press('Enter');
await page.keyboard.press('Enter'); // 빈 할 일 줄에서 Enter → 목록 밖 문단
await page.keyboard.type('글머리 줄');
await page.keyboard.press('Control+Alt+5');
await wait(60);
check('Ctrl+Alt+5 → 글머리 목록', (await doc()).includes('bullet_list'));
await page.keyboard.press('Escape');
await wait(300);

// 맨 URL이 든 Markdown 붙여넣기 (캔버스)
await ws(() => window.__dn.view.root.focus());
await page.evaluate((text) => {
  const dt = new DataTransfer(); dt.setData('text/plain', text);
  window.__dn.view.root.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, '## 참고 자료\n\n- 공식 문서: https://www.anthropic.com/news.\n- 끝');
await wait(300);
d = await doc();
check('Markdown 속 맨 URL → 링크 (끝 마침표는 제외)', d.includes('"href":"https://www.anthropic.com/news"'), d.slice(d.indexOf('anthropic') - 80, d.indexOf('anthropic') + 60));
await ws(() => window.__dn.view.select([]));
// 정적 렌더의 링크 누르기 → 새 탭
await page.evaluate(() => { const o = window.open; window.__opened = []; window.open = (...a) => { window.__opened.push(a[0]); return o.apply(window, a); }; });
const popup = ctx.waitForEvent('page', { timeout: 3000 }).catch(() => null);
await page.locator('.dn-block a[href="https://www.anthropic.com/news"]').first().click();
const p2 = await popup;
check('링크 누르면 새 탭', !!p2 || (await ws(() => window.__opened)).some((u) => u.includes('anthropic.com')), JSON.stringify(await ws(() => window.__opened)));
await p2?.close();

// ───── 목차 (FR-084) ─────
await ws(() => window.__dn.togglePanel(true));
await wait(300);
const toc = await page.locator('.outline-item').allInnerTexts();
check('목차: 글 안의 제목', toc.includes('참고 자료'), toc.join(' | '));
await page.locator('.outline-item', { hasText: '참고 자료' }).click();
await wait(500);
check('목차 누르면 그 블록으로 · 지금 위치 강조', (await page.locator('.outline-item.on').innerText()) === '참고 자료');
await ws(() => window.__dn.togglePanel(false));

// ───── 단축키 도움말 (Ctrl+/) ─────
await ws(() => window.__dn.view.root.focus());
await page.keyboard.press('Control+/');
await page.waitForSelector('.help-dialog');
const heads = await page.locator('.help-body h3').allInnerTexts();
check('도움말: 부록 A 섹션 그대로', ['전역 · 탐색', '캔버스', '텍스트 서식', '필기 (FR-034~042)'].every((h) => heads.some((x) => x.startsWith(h.split(' (')[0]))), heads.join(' | '));
check('미착수 기능 키는 모두 "준비 중" 표시 (구현된 키에는 없음)', (await page.locator('.help-body .later em').count()) === (await page.locator('.help-body .later').count()) && (await page.locator('.help-body dl > div:not(.later) em').count()) === 0);
await page.locator('.help-search').fill('링크');
await wait(80);
check('도움말 찾기', (await page.locator('.help-body dl > div').count()) >= 2 && (await page.locator('.help-body').innerText()).includes('링크 삽입'));
await page.screenshot({ path: `${OUT}/keys-help.png` });
await page.keyboard.press('Escape');

// ───── 전역 단축키 ─────
await page.keyboard.press('Control+Backslash');
await wait(80);
check('Ctrl+\\ → 사이드바 접기', await page.locator('aside.sidebar').isHidden());
await page.keyboard.press('Control+Backslash');
const before = await ws(() => window.__dn.state.notes.length);
await page.keyboard.press('Control+Alt+n');
await wait(400);
check('Ctrl+Alt+N → 새 노트', (await ws(() => window.__dn.state.notes.length)) === before + 1);
await page.keyboard.press('Control+Comma');
await wait(100);
check('Ctrl+, → 설정', await page.locator('.settings').isVisible());
await page.keyboard.press('Escape');
await page.locator('.settings .x').click().catch(() => {});

// ───── 읽기 모드 (FR-085) ─────
await ws((id) => window.__dn.openById(id), (await ws(() => window.__dn.state.notes.find((n) => n.title === 'Claude API 구조 정리')?.id)));
await wait(300);
await ws(() => window.__dn.view.root.focus());
await page.keyboard.press('Control+Alt+Enter');
await wait(150);
check('읽기 모드: 사이드바 · 도구 막대 숨김, 안내 표시', (await page.locator('aside.sidebar').isHidden()) && (await page.locator('.toolbar').count()) === 0 && (await page.locator('.read-pill').isVisible()));
const blocks0 = await ws(() => window.__dn.view.engine.blockCount);
await page.mouse.dblclick(1300, 820);
await wait(150);
const someBlock = page.locator('.dn-block').first();
await someBlock.dblclick();
await wait(150);
check('읽기 모드에서는 상자를 만들거나 편집할 수 없음', (await ws(() => window.__dn.view.engine.blockCount)) === blocks0 && (await page.locator('.dn-text-editing').count()) === 0);
await page.screenshot({ path: `${OUT}/keys-read.png` });
await page.keyboard.press('Escape');
await wait(100);
check('Esc → 읽기 모드 나가기', (await ws(() => window.__dn.state.readMode)) === false && (await page.locator('.toolbar').count()) === 1);

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
