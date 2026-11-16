// 접근성 (FR-150): 주요 화면을 axe-core(WCAG 2.1 A · AA)로 검사 — 홈 · 캔버스 · 문서 뷰 · 넣기 메뉴 · 설정 · 명령 팔레트 · 그래프 · 어두운 테마.
// 심각(serious) · 치명(critical) 위반이 없어야 통과. 사용: dev 서버 실행 후 `node e2e/a11y.mjs [--verbose]`
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const VERBOSE = process.argv.includes('--verbose');
const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
process.on('unhandledRejection', (e) => { if (!/TargetClosedError|has been closed/.test(String(e))) throw e; });

const browser = await chromium.launch({ channel: process.env.DN_CHANNEL ?? 'msedge', headless: true });
async function scan(page, name, include) {
  await page.addScriptTag({ content: AXE }).catch(() => {});
  const r = await page.evaluate(async (include) => window.axe.run(include ? { include: [include] } : document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    rules: { 'region': { enabled: false } },
  }), include);
  const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const minor = r.violations.filter((v) => !(v.impact === 'serious' || v.impact === 'critical'));
  check(`${name}: 심각 · 치명 위반 없음`, bad.length === 0, bad.map((v) => `${v.id}(${v.nodes.length})`).join(', ') + (minor.length ? ` · 가벼운 것 ${minor.map((v) => v.id).join(',')}` : ''));
  if (VERBOSE) for (const v of [...bad, ...minor]) for (const n of v.nodes.slice(0, 4)) console.log(`   ${v.id}: ${n.target.join(' ')} — ${n.failureSummary?.split('\n')[1] ?? ''}`);
}

for (const theme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme });
  await ctx.addInitScript(() => localStorage.setItem('dn:no-env-key', '1'));
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.waitForSelector('.dn-block', { timeout: 15000 });
  await page.waitForTimeout(500);
  const ws = (fn, arg) => page.evaluate(fn, arg);
  const t = theme === 'dark' ? ' (어두운 테마)' : '';
  await scan(page, `캔버스${t}`);
  await ws(() => window.__dn.showHome());
  await page.waitForTimeout(400);
  await scan(page, `홈 (서재)${t}`);
  await ws(() => window.__dn.showMe());
  await page.waitForTimeout(400);
  await scan(page, `내 페이지${t}`);
  await ws(() => window.__dn.showGraph());
  await page.waitForTimeout(400);
  await scan(page, `노트 그래프${t}`);
  await ws((id) => window.__dn.openById(id), await ws(() => window.__dn.state.notes[0].id));
  await page.waitForTimeout(400);
  await ws(() => window.__dn.setViewMode('doc'));
  await page.waitForTimeout(400);
  await scan(page, `문서 뷰${t}`);
  await ws(() => window.__dn.setViewMode('canvas'));
  await page.waitForTimeout(300);
  await page.locator('.toolbar .insert-btn').click();
  await page.waitForSelector('.insert-menu');
  await scan(page, `넣기 메뉴${t}`, '.insert-menu');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+Shift+P');
  await page.waitForTimeout(300);
  await scan(page, `명령 팔레트${t}`);
  await page.keyboard.press('Escape');
  await ws(() => window.__dn.openSettings());
  await page.waitForTimeout(400);
  await scan(page, `설정${t}`);
  await ctx.close();
}

// ── 키보드만으로 캔버스 (FR-150) ──
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => localStorage.setItem('dn:no-env-key', '1'));
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.waitForSelector('.dn-block', { timeout: 15000 });
  const ws = (fn, arg) => page.evaluate(fn, arg);
  await ws(() => window.__dn.newNote());
  await page.waitForTimeout(300);
  const ids = await ws(() => {
    const e = window.__dn.view.engine;
    const mk = (x, y, t) => e.transact((tx) => { const b = tx.createBlock({ x, y, w: 240, h: 60 }); tx.createContent({ blockId: b, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] } }); return b; }, { origin: 'user' }).value;
    const a = mk(0, 0, '첫째 블록'), b = mk(400, 0, '둘째 블록'), c = mk(0, 200, '셋째 블록');
    e.transact((tx) => tx.createArrow({ from: { blockId: a, side: 'auto' }, to: { blockId: b, side: 'auto' } }), { origin: 'user' });
    return [a, b, c];
  });
  await page.waitForTimeout(300);
  const label = await page.locator(`.dn-block[data-id="${ids[0]}"]`).getAttribute('aria-label');
  check('블록에 역할 · 이름 (첫 줄 · 연결 수)', label === '첫째 블록 · 연결 나감 1' && (await page.locator(`.dn-block[data-id="${ids[0]}"]`).getAttribute('role')) === 'group', String(label));
  check('캔버스에 이름 · 쓰는 법', ((await page.locator('.dn-canvas').getAttribute('aria-label')) ?? '').includes('Tab'));
  await ws(() => { window.__dn.view.select([]); window.__dn.view.root.focus(); });
  await page.keyboard.press('Tab');
  await page.waitForTimeout(150);
  const live = () => page.locator('.dn-sr-live').innerText();
  check('Tab → 읽는 순서 첫 블록 고르고 알림', (await ws(() => window.__dn.view.selectedBlocks[0])) === ids[0] && (await live()).startsWith('블록 1/3 · 첫째 블록'), await live());
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(150);
  check('Tab 두 번 더 → 셋째 (위 → 아래, 같은 줄은 왼쪽 → 오른쪽)', (await ws(() => window.__dn.view.selectedBlocks[0])) === ids[2]);
  await page.keyboard.press('Shift+Tab');
  await page.waitForTimeout(100);
  check('Shift+Tab → 앞 블록', (await ws(() => window.__dn.view.selectedBlocks[0])) === ids[1]);
  await page.keyboard.press('Alt+ArrowRight');
  await page.keyboard.press('Alt+ArrowDown');
  await page.waitForTimeout(100);
  const sz = await ws((id) => { const b = window.__dn.view.engine.getBlock(id); return { w: b.w, h: b.h }; }, ids[1]);
  check('Alt+화살표 → 크기 (10px씩) · 알림', sz.w === 250 && (await live()).startsWith('크기'), JSON.stringify(sz));
  await page.keyboard.press('Shift+F10');
  await page.waitForSelector('.menu[aria-label="블록 메뉴"]', { timeout: 2000 }).catch(() => {});
  check('Shift+F10 → 블록 메뉴', (await page.locator('.menu[aria-label="블록 메뉴"]').count()) === 1);
  await page.keyboard.press('Escape');
  // C로 연결: 셋째 → (Shift+Tab) 둘째 → Enter, 같은 것을 다시 하면 지우기, Esc로 그만두기
  const arrowsTo = (from, to) => ws(({ from, to }) => window.__dn.view.engine.arrowsOf(from).filter((a) => a.from.blockId === from && a.to.blockId === to).length, { from, to });
  await ws((id) => { window.__dn.view.select([id]); window.__dn.view.root.focus(); }, ids[2]);
  await page.keyboard.press('c');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(100);
  check('C → Tab으로 대상 → Enter: 화살표 연결 · 알림', (await arrowsTo(ids[2], ids[1])) === 1 && (await live()).startsWith('연결했어요'), await live());
  await ws((id) => window.__dn.view.select([id]), ids[2]);
  await page.keyboard.press('c');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(100);
  check('같은 연결을 다시 하면 지우기', (await arrowsTo(ids[2], ids[1])) === 0 && (await live()).startsWith('연결을 지웠어요'));
  await ws((id) => window.__dn.view.select([id]), ids[2]);
  await page.keyboard.press('c');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(100);
  check('Esc로 연결 그만두기 (그다음 Enter는 편집)', (await arrowsTo(ids[2], ids[1])) === 0 && (await ws(() => window.__dn.view.editingId)) === ids[2]);
  await page.keyboard.press('Escape');
  await ws((id) => { window.__dn.view.select([id]); window.__dn.view.root.focus(); }, ids[2]);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(100);
  check('마지막 블록에서 Tab → 캔버스 밖으로 (갇히지 않음)', (await ws(() => document.activeElement !== window.__dn.view.root)) && (await ws(() => window.__dn.view.selectedBlocks.length)) === 0);
  // 블록 안 링크에 초점이 있을 때 Tab은 원래대로 다음 곳으로 (블록을 다시 돌지 않음)
  await ws((id) => { const e = window.__dn.view.engine, c = e.contentsOf(id)[0]; e.transact((tx) => tx.set('content', c.id, { doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '링크', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] }] }] } }), { origin: 'user' }); }, ids[1]);
  await page.waitForTimeout(200);
  await page.locator(`.dn-block[data-id="${ids[1]}"] a[href]`).focus();
  await page.keyboard.press('Tab');
  await page.waitForTimeout(100);
  check('블록 안 링크에서 Tab → 블록을 다시 고르지 않고 다음으로', (await ws(() => window.__dn.view.selectedBlocks.length)) === 0
    && (await ws(() => !document.activeElement?.closest?.('.dn-block a[href]'))));
  // 연결 모드는 마우스를 쓰면 끝 — 다음 Enter는 편집
  await ws((id) => { window.__dn.view.select([id]); window.__dn.view.root.focus(); }, ids[2]);
  await page.keyboard.press('c');
  check('연결 시작 표시', (await page.locator(`.dn-block[data-id="${ids[2]}"].dn-connect-src`).count()) === 1);
  await page.locator(`.dn-block[data-id="${ids[0]}"]`).click();
  await page.waitForTimeout(100);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  check('마우스로 고르면 연결 모드 끝 (Enter = 편집, 연결 안 만듦)', (await arrowsTo(ids[2], ids[0])) === 0 && (await ws(() => window.__dn.view.editingId)) === ids[0]
    && (await page.locator('.dn-connect-src').count()) === 0);
  await page.keyboard.press('Escape');
  await ctx.close();
}

await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
