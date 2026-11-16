// 법적 문서 · AI 전송 고지 (LEGAL-RISK R1 · R2 · R4, 2026-10-26 A안): /terms · /privacy · /ai 정적 페이지, 설정 › 정보와 홈 아래의 문서 창,
// AI 동의 창의 알릴 사항 · 동의 기록(판 · 시각) · 옛 판 동의는 다시 묻기, 키 칸의 Anthropic 약관 링크, 노트에 묻기의 AI 표시.
// 사용: dev 서버 실행 후 `node e2e/legal.mjs [스크린샷 폴더]`
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2] ?? '.';
const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
/** axe-core WCAG 2.1 A · AA — 심각 · 치명 위반이 없어야 (a11y.mjs와 같은 기준) */
async function scan(page, name, include) {
  await page.addScriptTag({ content: AXE }).catch(() => {});
  const r = await page.evaluate(async (include) => window.axe.run(include ? { include: [include] } : document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, rules: { region: { enabled: false } },
  }), include);
  const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  check(`접근성 ${name}: 심각 · 치명 위반 없음`, bad.length === 0, bad.map((v) => `${v.id}(${v.nodes.length})`).join(', '));
}

const browser = await chromium.launch({ channel: process.env.DN_CHANNEL ?? 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
await ctx.addInitScript(() => localStorage.setItem('dn:no-env-key', '1'));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push(m.text()); });
let apiCalls = 0;
await page.route('https://api.anthropic.com/**', (route) => { apiCalls++; return route.abort(); });
const ws = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);

// 1. 정적 페이지 (앱을 받지 않고 읽힘)
for (const [path, title, must] of [['/terms', '이용약관', '제5조 (AI 기능)'], ['/privacy', '개인정보 처리방침', 'privacy@anthropic.com'], ['/ai', 'AI 이용 안내', 'Commercial Terms']]) {
  const res = await page.goto(BASE + path);
  const html = await res.text();
  const h1 = await page.locator('main h1').innerText();
  check(`${path} 정적 페이지 — 제목 · 본문 · 현재 문서 표시`, res.status() === 200 && h1.includes(title) && html.includes(must) && (await page.locator('nav a[aria-current="page"]').innerText()) === title, `${res.status()} ${h1}`);
  check(`${path}에는 앱 스크립트가 없다`, !/<script/i.test(html));
}
await page.screenshot({ path: `${OUT}/legal-1-ai-page.png`, fullPage: false });
await scan(page, '정적 페이지 /ai');
const tableRows = await page.goto(BASE + '/privacy').then(() => page.locator('main table').nth(1).locator('tbody tr').count());
check('처리방침 국외 이전 표 — 일곱 줄(받는 자 · 나라 · 항목 · 시기와 방법 · 목적 · 기간 · 거부)', tableRows === 7, String(tableRows));

// 2. 앱: 설정 › 정보 → 문서 창
await page.goto(BASE);
await page.waitForSelector('.dn-block, .home', { timeout: 15000 });
await ws(() => window.__dn.openSettings());
await page.locator('.settings-nav button', { hasText: '정보' }).click();
await page.locator('.about-legal .link-btn', { hasText: '이용약관' }).click();
await page.waitForSelector('.legal-body h3');
check('설정 › 정보 › 이용약관 — 문서 창 (설정 위에)', (await page.locator('.legal-tabs button.on').innerText()) === '이용약관' && await page.locator('.settings').isVisible());
await page.locator('.legal-body a[href="/ai"]').first().click();
await page.waitForFunction(() => document.querySelector('.legal-tabs button.on')?.textContent === 'AI 이용 안내');
check('약관 속 [AI 이용 안내] 링크 → 같은 창에서 그 문서로', (await page.locator('.legal-body').innerText()).includes('API 키와 요금'));
await page.screenshot({ path: `${OUT}/legal-2-dialog.png` });
await scan(page, '문서 창', '.legal-dialog');
await page.keyboard.press('Escape');
await wait(200);
check('Esc는 문서 창만 닫고 설정은 그대로', !(await page.locator('.legal-dialog').count()) && await page.locator('.settings').isVisible());
check('정보 탭에 상표 · 제휴 없음 한 줄', (await page.locator('.settings-body').innerText()).includes('제휴 관계가 없어요'));

// 3. 설정 › AI: 키 칸의 요금 · Anthropic 약관 링크(R4), 동의 전 문구
await page.locator('.settings-nav button', { hasText: 'AI' }).click();
const aiTab = await page.locator('.settings-body').innerText();
check('키 칸: 요금은 Anthropic이 키 주인에게 · DamianNote는 받지 않음', aiTab.includes('DamianNote는 요금을 받지 않아요'));
await page.locator('.settings-body details.more summary').first().click();
const hrefs = await page.locator('.key-links a').evaluateAll((as) => as.map((a) => a.href));
check('키 자세히: Commercial Terms · 이용 정책 · 콘솔 링크', ['commercial-terms', 'legal/aup', 'console.anthropic.com'].every((h) => hrefs.some((x) => x.includes(h))), hrefs.join(' '));
check('동의 전: "아직 동의하지 않았어요"', aiTab.includes('아직 동의하지 않았어요'));
await page.keyboard.press('Escape');

// 4. AI 동의 창: 구조화하려 하면 먼저 묻는다 — 알릴 사항 여섯 줄 · 문서 링크
await ws(() => window.__dn.newNote({ sheet: null }));
await wait(300);
const blockId = await ws(() => {
  let id;
  window.__dn.view.engine.transact((tx) => {
    id = tx.createBlock({ x: 0, y: 0, w: 420, h: 120 });
    tx.createContent({ blockId: id, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '회의 결과: 결제 연동은 금요일까지 끝내고, 다음 주에는 정산 화면을 만든다. 담당은 민수, 검토는 지영이 맡는다. 예산은 이번 분기 안에서 처리한다.' }] }] } });
  }, { origin: 'user' });
  return id;
});
await wait(300);
await ws((id) => window.__dn.structure(id), blockId);
await page.waitForSelector('.consent-dialog', { timeout: 5000 }).catch(async () => console.log('토스트:', await page.locator('.toast').allInnerTexts()));
const consent = await page.locator('.consent-dialog').innerText();
const rows = await page.locator('.consent-items dt').allInnerTexts();
check('동의 창: 생성형 AI 사전 고지 + 일곱 기능', /생성형 AI\(Anthropic Claude\)/.test(consent) && ['구조화', '손글씨', 'AI로 고치기', '초안', '노트 요약', '노트 번역', '노트에 묻기'].every((w) => consent.includes(w)));
check('동의 창: 알릴 사항 여섯 줄', rows.join() === '보내는 것,받는 곳,언제 · 어떻게,목적,보관,거부하면', rows.join());
check('동의 창: 받는 곳 · 나라 · 연락처 · 보관 · 거부 효과', ['Anthropic, PBC', '미국', 'privacy@anthropic.com', '30일', '나머지는 그대로'].every((w) => consent.includes(w)));
check('동의 창: 옛 판 안내 문구는 처음엔 없음', !(await page.locator('.consent-old').count()));
// 처음 초점은 창 — Enter 한 번에 동의되지 않게 (교차 검토 C10)
await wait(100);
check('동의 창: 처음 초점은 창 (동의 단추 아님) · Enter로 동의되지 않음', await ws(() => document.activeElement?.classList.contains('consent-dialog')) && await (async () => { await page.keyboard.press('Enter'); await wait(150); return (await page.locator('.consent-dialog').count()) === 1 && !(await ws(() => window.__dn.state.ai.consent)); })());
await page.screenshot({ path: `${OUT}/legal-3-consent.png` });
await scan(page, '동의 창', '.consent-dialog');
await page.locator('.consent-links .link-btn', { hasText: '개인정보 처리방침' }).click();
await page.waitForSelector('.legal-body h3');
check('동의 창의 [개인정보 처리방침] → 문서 창이 위에, 동의 창은 남음', (await page.locator('.legal-tabs button.on').innerText()) === '개인정보 처리방침' && await page.locator('.consent-dialog').isVisible());
await page.locator('.legal-dialog .x').click();
await wait(150);
check('문서 창을 닫아도 동의 창은 그대로', await page.locator('.consent-dialog').isVisible() && !(await page.locator('.legal-dialog').count()));
await page.locator('.consent-dialog button.primary').click();
await wait(400);
const rec = await ws(() => window.__dn.meta.getSetting('aiConsentRecord'));
check('동의 기록: 판 5 · 시각', rec?.version === 5 && Math.abs(Date.now() - rec.at) < 60_000, JSON.stringify(rec));
check('동의 뒤에는 키 칸으로 (키가 없어서) — API는 안 불림', (await page.locator('.settings').count()) === 1 && apiCalls === 0, `api ${apiCalls}`);
check('설정 › AI: 동의한 날짜 · 철회 단추', /\d{4}\. \d{1,2}\. \d{1,2}\.에 동의했어요/.test(await page.locator('.settings-body').innerText()) && await page.locator('.settings-body button', { hasText: '전송 동의 철회' }).isVisible());
await page.keyboard.press('Escape');

// 5. 옛 판(10/26 이전 짧은 문구)에만 동의한 기기 → 다시 묻는다
await ws(async () => { await window.__dn.meta.setSetting('aiConsent', true); await window.__dn.meta.setSetting('aiConsentRecord', null); });
await page.reload();
await page.waitForSelector('.dn-block', { timeout: 15000 });
const st = await ws(() => ({ consent: window.__dn.state.ai.consent, old: window.__dn.state.ai.consentOld }));
check('옛 판 동의 → 동의 없음 · 옛 판 표시', st.consent === false && st.old === true, JSON.stringify(st));
await ws((id) => window.__dn.structure(id), blockId);
await page.waitForSelector('.consent-dialog');
check('옛 판 동의 → 구조화 전에 "안내 내용이 바뀌어 다시 여쭤봐요"', (await page.locator('.consent-old').innerText()).includes('다시 여쭤봐요'));
await page.locator('.consent-dialog button', { hasText: '취소' }).click();

// 6. 노트에 묻기: AI 표시 · 확인 안내, 홈 아래 문서 링크
await ws(() => window.__dn.acceptConsent());
await page.locator('.sidebar button', { hasText: '노트에 묻기' }).click();
await page.waitForSelector('.qa-panel');
check('노트에 묻기: "AI(Claude)가 노트를 근거로 답해요 · 출처 확인"', (await page.locator('.qa-ai-note').innerText()).includes('AI(Claude)가 노트를 근거로'));
await ws(() => window.__dn.qa.close());
await ws(() => window.__dn.showHome());
await page.waitForSelector('.home-legal');
check('홈 아래 약관 · 처리방침 · AI 안내 링크', (await page.locator('.home-legal .link-btn').allInnerTexts()).join() === '이용약관,개인정보 처리방침,AI 이용 안내');
await page.locator('.home-legal .link-btn', { hasText: 'AI 이용 안내' }).click();
await page.waitForSelector('.legal-body h3');
await page.locator('.legal-backdrop').click({ position: { x: 5, y: 5 } });
await wait(150);
check('바깥을 누르면 문서 창 닫힘', !(await page.locator('.legal-dialog').count()));

check('페이지 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fails = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fails}/${results.length} 통과`);
process.exit(fails ? 1 : 0);
