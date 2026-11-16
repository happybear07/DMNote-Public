// 홈 = 서재 · 내 페이지 확인 (11/10 — 홈을 둘로 나눔): 서재는 모든 노트를 책으로(전시대 · 즐겨찾기 · 폴더마다 서가 · 폴더 색 · 빈 책),
// 내 페이지는 예전 홈의 카드(오늘 할 일 체크 · 달력 · 저장 · 즐겨찾기 FR-075 · 이번 주) · 시작 화면 설정 · 반응형.
// 사용: dev 서버 실행 후 `node e2e/home.mjs [스크린샷 폴더]`
import { chromium } from 'playwright-core';

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

// 할 일이 있는 노트
await ws(() => window.__dn.newNote());
await wait(300);
await ws(() => window.__dn.setTitle('오늘 계획'));
const planId = await ws(() => window.__dn.state.currentId);
await ws(() => window.__dn.view.addBlockAtCenter());
await wait(100);
await page.keyboard.type('[] 운동 오늘');
await page.keyboard.press('Enter');
await page.keyboard.type('나중 일');
await page.keyboard.press('Escape');
await wait(600);

// ───── 즐겨찾기 (FR-075) ─────
await page.locator('.fav-btn').click();
await wait(300);
check('별 버튼 → 즐겨찾기 (사이드바 즐겨찾기 섹션)', (await page.locator('.fav-list .note-item', { hasText: '오늘 계획' }).count()) === 1 && (await page.locator('.fav-btn.on').count()) === 1);
const order = await page.locator('aside.sidebar .side-section > span:first-child').allInnerTexts();
// 11/09 개편: 열린 노트(탭) · 이 노트 나무가 위, 즐겨찾기 · 폴더 · 태그는 그 아래
check('사이드바 섹션 차례: 열린 노트 → 즐겨찾기 → 폴더', order.indexOf('열린 노트') === 0 && order.indexOf('즐겨찾기') > 0 && order.indexOf('즐겨찾기') < order.indexOf('폴더'), order.join(' | '));

// ───── 홈 = 서재 (11/10): 모든 노트를 책으로 — 최근에 펼친 책 전시대 · 즐겨찾기 · 폴더마다 서가(폴더 색) · 폴더 밖 ─────
const folderId = await ws(() => window.__dn.createFolder('학교'));
await ws((f) => window.__dn.newNote(window.__dn.newNotePlace({ folderId: f })), folderId);
await wait(400);
await ws(() => window.__dn.setTitle('강의 정리'));
await wait(300);
await page.locator('.side-nav .note-item', { hasText: '홈' }).click();
await page.waitForSelector('.home-page.library .lib-shelf');
await wait(500);
check('홈 머리: 서재 · 노트 권수', (await page.locator('.home-head h1').innerText()).includes('서재') && /노트 \d+권/.test(await page.locator('.home-head p').innerText()));
const signs = await page.locator('.lib-sign').allInnerTexts();
check('서가 차례: 최근에 펼친 책 → 즐겨찾기 → 폴더(학교) → 폴더 밖', signs[0]?.startsWith('최근에 펼친 책') && signs[1]?.startsWith('즐겨찾기') && signs.some((t) => t.startsWith('학교')) && signs.at(-1)?.startsWith('폴더 밖'), signs.join(' | '));
const allBooks = await ws(() => window.__dn.state.notes.filter((n) => !n.dbRef).length);
const shelved = await page.locator('section.lib-section:not([aria-label="최근에 펼친 책"]):not([aria-label="즐겨찾기 서가"]) .book').count();
check('전체 노트가 서가에 한 권씩 (전시대 · 즐겨찾기 빼고)', shelved === allBooks, `${shelved}/${allBooks}`);
const bk = await ws(() => {
  const sec = [...document.querySelectorAll('.lib-section')].find((s) => s.getAttribute('aria-label') === '학교 서가');
  const b = sec?.querySelector('.book'), r = b?.getBoundingClientRect();
  return { ratio: r ? r.width / r.height : 0, color: b ? getComputedStyle(b).backgroundColor : '', swatch: sec ? getComputedStyle(sec.querySelector('.lib-swatch')).backgroundColor : '', band: !!b?.querySelector('.book-band'), label: !!b?.querySelector('.book-label'), newBook: !!sec?.querySelector('.book-new') };
});
check('책 = 천 표지(밴드 · 흰 이름표 없음) · A4 비율 · 색 = 폴더 색 칸 · 서가 끝 빈 책', bk.band && !bk.label && Math.abs(bk.ratio - 108 / 153) < 0.02 && bk.color === bk.swatch && bk.newBook, JSON.stringify(bk));
// 폴더 색 바꾸기 → 그 폴더 책이 다 그 색
await page.locator('section[aria-label="학교 서가"] .lib-swatch').click();
await page.locator('.lib-palette button[aria-label="테라코타"]').click();
await wait(400);
const terra = await page.locator('section[aria-label="학교 서가"] .book').first().evaluate((e) => getComputedStyle(e).backgroundColor);
check('폴더 색 칸에서 테라코타 → 그 서가 책이 테라코타 · 폴더에 저장', terra === 'rgb(160, 87, 60)' && (await ws((f) => window.__dn.state.folders.find((x) => x.id === f)?.color, folderId)) === 'terracotta', terra);
// 빈 책 → 그 폴더에 새 노트
const n0 = await ws(() => window.__dn.state.notes.length);
await page.locator('section[aria-label="학교 서가"] .book-new').click();
await wait(600);
check('학교 서가의 빈 책 → 학교 폴더에 새 노트', (await ws(() => window.__dn.state.notes.length)) === n0 + 1 && (await ws((f) => window.__dn.state.notes.find((n) => n.id === window.__dn.state.currentId)?.folderId === f, folderId)));
await ws(() => window.__dn.showHome());
await page.waitForSelector('.home-page.library .lib-shelf');
await page.screenshot({ path: `${OUT}/home.png` });
// 책을 눌러 노트 열기 · 우클릭 메뉴
await page.locator('.lib-shelf .book', { hasText: '오늘 계획' }).first().click();
const zoomed = await page.locator('.book-zoom').count();
await page.waitForFunction(() => window.__dn.state.page === 'note', null, { timeout: 3000 });
await wait(300);
check('책을 누르면 펼치기 전환(표지 면이 커짐) 뒤 노트로 · 전환 면은 사라짐', zoomed === 1 && (await page.locator('.book-zoom').count()) === 0);
check('책을 눌러 노트 열기', (await ws(() => window.__dn.state.page)) === 'note' && (await ws(() => window.__dn.state.currentId)) === planId);
await ws(() => window.__dn.showHome());
await page.waitForSelector('.home-page.library .lib-shelf');
await page.locator('section[aria-label="폴더 밖 서가"] .book', { hasText: '오늘 계획' }).click({ button: 'right' });
check('책 우클릭 → 열기 · 옆에 열기 · 즐겨찾기 · 표지 색 · 휴지통', (await page.locator('.row-menu button').allInnerTexts()).join() === '열기,옆에 열기,즐겨찾기에서 빼기,표지 색 바꾸기,휴지통으로');
// 이 노트만 표지 색 (11/11) — 폴더 색 따르기로 되돌림
await page.locator('.row-menu button', { hasText: '표지 색 바꾸기' }).click();
await page.locator('.lib-palette button[aria-label="황토"]').click();
await wait(400);
const ownColor = () => page.locator('section[aria-label="폴더 밖 서가"] .book', { hasText: '오늘 계획' }).evaluate((e) => getComputedStyle(e).backgroundColor);
check('책 우클릭 › 표지 색 → 그 책만 황토 · 노트 정보에 저장', (await ownColor()) === 'rgb(176, 138, 62)' && (await ws((id) => window.__dn.state.notes.find((n) => n.id === id)?.bookColor, planId)) === 'ochre');
await page.locator('section[aria-label="폴더 밖 서가"] .book', { hasText: '오늘 계획' }).click({ button: 'right' });
await page.locator('.row-menu button', { hasText: '표지 색 바꾸기' }).click();
await page.locator('.lib-palette button', { hasText: '폴더 색 따르기' }).click();
await wait(400);
check('… 폴더 색 따르기 → 다시 폴더 밖 숯색', (await ownColor()) === 'rgb(59, 58, 56)');

// ───── 내 페이지 (11/10 — 예전 홈의 작은 것들) ─────
await page.locator('.side-nav .note-item', { hasText: '내 페이지' }).click();
await page.waitForSelector('.home-page.me-page .bento');
await wait(500);
const cards = await page.locator('.me-page .card h2').allInnerTexts();
check('내 페이지 카드: 이어서 쓰기 · 오늘 · 오늘 할 일 · 저장 · 즐겨찾기 · 이번 주 (책장은 없음)', ['이어서 쓰기', '오늘', '오늘 할 일', '저장', '즐겨찾기', '이번 주'].every((c) => cards.some((t) => t.split('\n')[0].trim() === c || t.startsWith(c))) && !(await page.locator('.me-page .book').count()), cards.map((c) => c.split('\n')[0]).join(' | '));
// 이어서 쓰기 = 지금 노트: 쪽 그림(상자 면) · 제목 · 고친 때
const cont = await ws(() => { const c = document.querySelector('[aria-label="이어서 쓰기"]'); return c ? { title: c.querySelector('.cont-title')?.textContent, boxes: c.querySelectorAll('.thumb-box, .thumb-bar').length, meta: c.querySelector('.cont-meta')?.textContent } : null; });
const curTitle = await ws(() => { const s = window.__dn.state; const n = s.notes.find((x) => x.id === s.currentId); return n ? (n.title || n.preview) : ''; });
check('이어서 쓰기: 지금 노트 제목 · 쪽 그림에 상자 · 고친 때', !!cont && cont.title === curTitle && cont.boxes >= 1 && /고침/.test(cont.meta), JSON.stringify({ cont, curTitle }));
check('머리: 내 페이지 · 날짜 · 로그인 상태', (await page.locator('.home-head h1').innerText()).includes('내 페이지') && (await page.locator('.home-head p').innerText()).includes('로그인'));
check('오늘 할 일 카드에 오늘 일', (await page.locator('.home-todos li').allInnerTexts()).join().includes('운동 오늘'));
const cal = page.locator('[aria-label="오늘"]');
const nowD = new Date();
const calToday = await cal.locator('.cal-list li').allInnerTexts();
check('달력: 이달 · 오늘 하나 · 오늘 항목(기한 오늘인 할 일 · 오늘 만든 노트)', (await cal.locator('.cal-month').innerText()) === `${nowD.getFullYear()}년 ${nowD.getMonth() + 1}월` && (await cal.locator('.cal-day.today').count()) === 1
  && calToday.some((t) => t.includes('운동')) && calToday.some((t) => t.includes('오늘 계획') && t.includes('만든 노트')), calToday.join(' | '));
check('오늘 카드는 평소 이번 주 7일 띠', (await cal.locator('.cal-day').count()) === 7 && (await cal.locator('.cal-month').getAttribute('aria-expanded')) === 'false');
await cal.locator('.cal-month').click(); // 'YYYY년 M월' → 한 달 칸으로 펼침 (넓은 카드)
check('달 이름을 누르면 한 달 달력(42칸) · 넓은 카드', (await cal.locator('.cal-day').count()) === 42 && (await cal.evaluate((el) => el.classList.contains('wide'))));
await cal.getByRole('button', { name: '다음 달' }).click();
const nextM = await cal.locator('.cal-month').innerText();
await cal.locator('.cal-day:not(.out)').first().click();
const emptyNext = await cal.locator('.cal-list .card-empty').count();
await cal.getByRole('button', { name: '오늘', exact: true }).click();
check('달력: 다음 달 · 빈 날 안내 · 오늘로 돌아오기', nextM !== `${nowD.getFullYear()}년 ${nowD.getMonth() + 1}월` && emptyNext === 1 && (await cal.locator('.cal-day.today.on').count()) === 1, nextM);
check('즐겨찾기 카드', (await page.locator('[aria-label="즐겨찾기"] li').count()) === 1);
check('저장 공간 표시 · 백업 안 했으면 경고', /사용/.test(await page.locator('[aria-label="저장 공간 · 백업"]').innerText()) && (await page.locator('[aria-label="저장 공간 · 백업"] .card-line.warn').count()) >= 1);
await page.screenshot({ path: `${OUT}/me.png` });
// 빠른 메모 → 받은 메모 노트(열지 않음), 두 번째도 같은 노트에 쌓임
const memo = page.locator('.quick-memo textarea');
await memo.fill('우유 사기');
await memo.press('Enter');
await page.waitForSelector('.qm-done');
const inbox1 = await ws(() => window.__dn.state.notes.find((n) => n.title === '받은 메모'));
await memo.fill('발표 자료 다듬기');
await memo.press('Enter');
await wait(600);
const inboxes = await ws(() => window.__dn.state.notes.filter((n) => n.title === '받은 메모').map((n) => ({ id: n.id, blocks: n.stats?.blocks })));
check('빠른 메모 Enter → 받은 메모 노트에 쌓이고 내 페이지에 그대로 · 칸 비움', !!inbox1 && inboxes.length === 1 && inboxes[0].blocks === 2 && (await ws(() => window.__dn.state.page)) === 'me' && (await memo.inputValue()) === '', JSON.stringify(inboxes));
// 내 페이지에서 체크 → 노트에 반영
await page.locator('.home-todos li', { hasText: '운동 오늘' }).locator('input').click();
await wait(400);
const doc = await ws(() => JSON.stringify([...window.__dn.view.engine.contents()].map((c) => c.doc)));
check('내 페이지에서 체크 → 노트에 반영', doc.includes('"checked":true'));
// 즐겨찾기 카드에서 노트 열기
await page.locator('[aria-label="즐겨찾기"] li button').click();
await wait(300);
check('카드에서 노트 열기', (await ws(() => window.__dn.state.page)) === 'note' && (await ws(() => window.__dn.state.currentId)) === planId);
await ws(() => window.__dn.showMe());
await page.waitForSelector('.me-page .bento');
const memo2 = page.locator('.quick-memo textarea');
// 긴 글(붙여넣기) → '새 노트로 AI 정리' 칩 → 새 노트를 열고 구조화 — 키 · 동의가 없으니 AI 동의 창부터 (API는 부르지 않음)
await memo2.fill('회의 정리\n1. 알파 테스트 일정 확정\n2. 사이드바 피드백 반영\n3. 서재 표지 색 점검');
const chip = page.locator('.qm-ai');
const chipShown = await chip.isVisible();
const before = await ws(() => window.__dn.state.notes.length);
await chip.click();
await wait(800);
const afterAi = await ws(() => ({ page: window.__dn.state.page, n: window.__dn.state.notes.length, dialog: window.__dn.state.dialog?.kind ?? null }));
check('긴 메모 → AI 정리 칩 → 새 노트가 열리고 동의 창부터', chipShown && afterAi.page === 'note' && afterAi.n === before + 1 && afterAi.dialog === 'consent', JSON.stringify(afterAi));
await page.keyboard.press('Escape');
await ws((id) => window.__dn.openById(id), planId);
await wait(300);

// 우클릭으로 즐겨찾기 빼기
await page.locator('nav.note-list .note-item', { hasText: '오늘 계획' }).first().click({ button: 'right' });
await page.locator('.row-menu button', { hasText: '즐겨찾기에서 빼기' }).click();
await wait(300);
check('우클릭 메뉴로 즐겨찾기 빼기 → 섹션 사라짐', (await page.locator('.fav-list').count()) === 0);

// ───── 시작 화면 = 홈 ─────
await ws(() => window.__dn.setStartPage('home'));
await page.reload();
await page.waitForSelector('.home-page.library', { timeout: 15000 });
check('시작 화면을 홈으로 하면 열 때 서재', (await ws(() => window.__dn.state.page)) === 'home');

// ───── 반응형: 서재 줄 수 · 내 페이지 3 · 2 · 1열 ─────
const perRow = () => page.locator('section[aria-label="폴더 밖 서가"] .lib-shelf').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
const r3 = await perRow();
await page.setViewportSize({ width: 390, height: 844 });
await wait(200);
const r1 = await perRow();
check('서재: 넓으면 한 줄에 많이 · 폰은 서너 권', r3 >= 7 && r1 >= 3 && r1 <= 4, `${r3}/${r1}`);
check('폰 폭 서재 가로 넘침 없음', !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)));
await page.screenshot({ path: `${OUT}/home-phone.png`, fullPage: true });
await page.setViewportSize({ width: 1440, height: 900 });
await ws(() => window.__dn.showMe());
await page.waitForSelector('.me-page .bento');
const cols = () => page.locator('.bento').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
const c3 = await cols();
await page.setViewportSize({ width: 1000, height: 900 });
await wait(200);
const c2 = await cols();
await page.setViewportSize({ width: 390, height: 844 });
await wait(200);
const c1 = await cols();
check('내 페이지: 데스크톱 3열 · 태블릿 2열 · 폰 1열', c3 === 3 && c2 === 2 && c1 === 1, `${c3}/${c2}/${c1}`);
check('폰 폭 내 페이지 가로 넘침 없음', !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)));
// 문서 보기(폰 기본)로 둔 채 홈에 와도 문서 칸이 홈을 덮지 않음
await page.locator('.home-page .menu-btn').click();
await page.locator('nav.note-list .note-item', { hasText: '오늘 계획' }).first().click();
await wait(300);
await ws(() => window.__dn.setViewMode('doc'));
await wait(300);
await ws(() => window.__dn.showHome());
await wait(300);
const top = await ws(() => { const r = document.querySelector('.lib-shelf').getBoundingClientRect(); const el = document.elementFromPoint(r.left + 30, r.top + 30); return !!el?.closest('.home-page'); });
check('문서 보기에서 홈으로 와도 홈이 위 (문서 칸이 덮지 않음)', top && !(await page.locator('.doc-host').isVisible()));

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
