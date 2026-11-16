// 웹 북마크 · 임베드 (FR-050 · FR-051, 노션 /bookmark · /embed): /웹 북마크 → 주소 칸 → 카드(제목 · 설명은 /api/unfurl로 채움),
// /웹 임베드 → 유튜브 iframe(덮개 — 두 번 누르면 안을 씀, 밖을 누르면 다시 덮음) · 카드로 보기 ↔ 실행 취소, 허용 목록 밖 주소는 카드로,
// 문서 뷰에서도 같은 카드 · iframe, 개발 서버 /api/unfurl은 내부 주소를 거절.
// 사용: dev 서버 실행 후 `node e2e/web-blocks.mjs [스크린샷 폴더]`
import { chromium } from 'playwright-core';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2];
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const browser = await chromium.launch({ channel: process.env.DN_CHANNEL ?? 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => localStorage.setItem('dn:no-env-key', '1'));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text()) && m.location()?.url?.startsWith(BASE)) errors.push(m.text()); });
// 바깥 서비스는 가짜로 (네트워크 없이도 같은 결과)
let unfurlCalls = 0;
await page.route('**/api/unfurl?**', (r) => { unfurlCalls++; return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ title: '예시 도메인', description: '문서 예시용 주소예요', site: 'Example' }) }); });
await page.route(/youtube-nocookie\.com|i\.ytimg\.com/, (r) => r.fulfill({ contentType: 'text/html', body: '<html><body style="background:#111;color:#fff">player</body></html>' }));
const ws = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
const slash = async (q) => { await page.keyboard.type('/'); await wait(150); await page.keyboard.type(q); await wait(250); await page.keyboard.press('Enter'); await wait(500); };
const webs = () => ws(() => [...window.__dn.view.engine.contents()].filter((c) => c.type === 'web').map((c) => ({ id: c.id, blockId: c.blockId, url: c.url, view: c.view, title: c.title ?? null })));

await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(() => window.__dn.newNote());
await wait(300);

// ── 캔버스: /웹 북마크 ──
await ws(() => window.__dn.view.addBlockAtCenter());
await wait(250);
await slash('웹 북마크');
let w = await webs();
const focused = await ws(() => document.activeElement?.matches?.('.dn-web-input input') ?? false);
check('/웹 북마크 → 주소 칸이 있는 블록 · 칸에 바로 커서', w.length === 1 && w[0].url === '' && w[0].view === 'bookmark' && focused, JSON.stringify(w));
await page.keyboard.type('example.com');
await page.keyboard.press('Enter');
await wait(200);
check('http 없는 주소는 안내', (await page.locator('.dn-web-err').count()) === 1);
await page.keyboard.press('Control+a');
await page.keyboard.type('https://example.com/');
await page.keyboard.press('Enter');
await wait(700);
w = await webs();
check('주소 넣기 → 카드 · 제목 · 설명 자동 채움', w[0]?.url === 'https://example.com/' && w[0]?.title === '예시 도메인' && unfurlCalls === 1 && (await page.locator('.dn-web-card .dn-web-title').innerText()) === '예시 도메인', JSON.stringify(w[0]));
check('카드 제목은 새 탭 링크 (noopener)', (await page.locator('.dn-web-card a.dn-web-title').getAttribute('target')) === '_blank' && /noopener/.test(await page.locator('.dn-web-card a.dn-web-title').getAttribute('rel')));
await ws(() => window.__dn.view.engine.undo());
await wait(300);
w = await webs();
check('실행 취소 한 번 → 주소 넣기 전으로 (정보 채우기는 따로 없음)', w[0]?.url === '', JSON.stringify(w[0]));
await ws(() => window.__dn.view.engine.redo());
await wait(300);

// ── 캔버스: /웹 임베드 (유튜브) ──
await ws(() => { const v = window.__dn.view; v.select([]); v.addBlockAtCenter(); });
await wait(250);
await slash('웹 임베드');
await page.keyboard.type('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
await page.keyboard.press('Enter');
await wait(600);
w = await webs();
const emb = w.find((x) => x.view === 'embed');
const src = await page.locator('.dn-web-embed iframe').getAttribute('src').catch(() => null);
check('/웹 임베드 + 유튜브 주소 → iframe (youtube-nocookie)', !!emb && src === 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', String(src));
const sandbox = await page.locator('.dn-web-embed iframe').getAttribute('sandbox');
check('iframe은 sandbox (최상위 이동 없음)', !!sandbox && !sandbox.includes('allow-top-navigation'), sandbox);
const bh = await ws((id) => window.__dn.view.engine.getBlock(id).h, emb.blockId);
check('블록 높이가 16:9 + 머리 줄 높이로', bh > 250 && bh < 330, String(bh));
if (OUT) await page.screenshot({ path: `${OUT}/web-blocks-canvas.png` });
// 덮개: 두 번 누르면 걷힘, 밖을 누르면 다시
const sh = page.locator('.dn-web-embed .dn-web-shield');
await sh.dblclick();
await wait(200);
const live = await ws(() => !!document.querySelector('.dn-web-embed.dn-web-live'));
await page.mouse.click(60, 450);
await wait(200);
const back = await ws(() => !document.querySelector('.dn-web-embed.dn-web-live'));
check('덮개: 두 번 누르면 안을 씀 → 밖을 누르면 다시 덮음', live && back, `${live} ${back}`);
// 카드로 보기 ↔ 실행 취소
await page.locator('.dn-web-embed .dn-web-view').click();
await wait(400);
w = await webs();
check('카드로 보기 → 북마크 카드', w.find((x) => x.id === emb.id)?.view === 'bookmark' && (await page.locator('.dn-web-embed').count()) === 0);
await ws(() => window.__dn.view.engine.undo());
await wait(400);
check('실행 취소 → 다시 끼워 넣기', (await webs()).find((x) => x.id === emb.id)?.view === 'embed' && (await page.locator('.dn-web-embed iframe').count()) === 1);

// 허용 목록 밖 → 카드로 대신
await ws(() => { const v = window.__dn.view; v.select([]); v.addBlockAtCenter(); });
await wait(250);
await slash('웹 임베드');
await page.keyboard.type('https://example.org/some/page');
await page.keyboard.press('Enter');
await wait(600);
check('끼워 넣을 수 없는 주소 → 카드 + 안내', (await page.locator('.dn-web-card .dn-web-note').count()) === 1 && (await page.locator('.dn-web-embed iframe').count()) === 1);

// ── 문서 뷰 ──
await ws(() => window.__dn.setViewMode('doc'));
await wait(700);
check('문서 뷰에도 카드 · iframe', (await page.locator('.dn-doc .dn-web-card').count()) === 2 && (await page.locator('.dn-doc .dn-web-embed iframe').count()) === 1 && (await page.locator('.dn-doc .dn-web-shield').count()) === 0);
if (OUT) await page.screenshot({ path: `${OUT}/web-blocks-doc.png` });
// 문서 뷰에서 /웹 북마크 → 문서 쪽 칸에 커서
// 문서 끝 아래 빈 곳을 누르면 새 문단 (캔버스의 빈 상자는 넣기로 대신돼 남아 있지 않다)
const lb = await page.locator('.dn-doc .dn-doc-item').last().boundingBox();
await page.mouse.click(lb.x + 40, lb.y + lb.height + 30);
await wait(300);
await slash('웹 북마크');
await wait(200);
const docFocus = await ws(() => !!document.activeElement?.closest?.('.dn-doc .dn-web-input'));
check('문서 뷰 /웹 북마크 → 문서의 주소 칸에 커서', docFocus && (await webs()).filter((x) => !x.url).length === 1);
await page.keyboard.type('https://example.net/');
await page.keyboard.press('Enter');
await wait(700);
check('문서 뷰에서 주소 넣기 → 카드', (await webs()).every((x) => x.url) && (await page.locator('.dn-doc .dn-web-card').count()) === 3);

// ── 개발 서버 /api/unfurl (가로채지 않은 요청) ──
await page.unroute('**/api/unfurl?**');
const blocked = await ws(async () => JSON.stringify(await (await fetch('/api/unfurl?url=' + encodeURIComponent('http://127.0.0.1:5173/'))).json()));
check('/api/unfurl: 이 컴퓨터 · 내부 주소는 거절 (빈 정보)', blocked === '{}', blocked);
const real = await ws(async () => { try { const r = await fetch('/api/unfurl?url=' + encodeURIComponent('https://example.com/')); return r.ok ? (await r.json()).title ?? null : `status ${r.status}`; } catch (e) { return String(e); } });
console.log(`INFO  /api/unfurl https://example.com/ → ${real} (인터넷 연결이 있어야 함)`);
check('콘솔 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close();
const bad = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
