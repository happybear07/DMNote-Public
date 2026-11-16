// 그래프 모양 고치기 (그래프 창 › 모양 탭): 색 묶음 · 막대마다 다른 색 · 미리보기 눌러 색 · 색 코드 · 값 글자 · 눈금선 끄기,
// 저장 → 캔버스 그래프에 같은 색 · 실행 취소 한 번, 블록 메뉴 '그래프 모양' → 모양 탭부터, 꺾은선(계열 색 · 직선 · 채우기 끄기), 원(구멍 · 범례 끄기),
// 색 판 Esc는 판만 닫음, 아무것도 안 바꾸고 저장하면 style을 적지 않음.
// 사용: dev 서버 실행 후 `node e2e/chart-style.mjs [스크린샷 폴더]`
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
await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(() => window.__dn.newNote());
await page.waitForTimeout(500);

const chart = () => ws(() => { const c = [...window.__dn.view.engine.contents()].find((x) => x.type === 'chart'); return c && JSON.parse(JSON.stringify(c)); });
const fills = (sel) => page.locator(sel).evaluateAll((els) => els.map((e) => e.getAttribute('fill')));
const tab = (name) => page.locator('.chart-tabs button', { hasText: name }).click();
const toggle = (label) => page.locator('.cs-toggles label', { hasText: label }).locator('input');

// ── 넣고 데이터 채우기: 막대 · 항목 4 · 계열 1 ──
await page.locator('.toolbar .insert-btn').click();
await page.waitForSelector('.insert-menu');
await page.keyboard.type('그래프');
await page.keyboard.press('Enter');
await page.waitForSelector('.chart-editor');
await page.evaluate(() => {
  const input = document.querySelector('.chart-grid tbody tr td input');
  const dt = new DataTransfer();
  dt.setData('text/plain', '봄\t30\n여름\t52\n가을\t41\n겨울\t18');
  input.focus();
  input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
});
await page.waitForTimeout(150);
check('데이터 | 모양 탭 · 계열 머리에 색 견본', (await page.locator('.chart-tabs [role="tab"]').count()) === 2 && (await page.locator('.chart-grid thead .cg-sw').count()) === 1);

// ── 모양 탭 ──
await tab('모양');
check('모양 탭: 색 묶음 6 · 계열 색 견본 1 · 막대 보기(값 · 눈금선 · 막대마다 다른 색, 범례는 계열 하나라 없음)',
  (await page.locator('.cs-palettes [role="radio"]').count()) === 6 && (await page.locator('.cs-sw').count()) === 1
  && (await page.locator('.cs-toggles label').allInnerTexts()).join('|') === '값 글자|눈금선|막대마다 다른 색');
await page.locator('.cs-palettes [role="radio"]', { hasText: '따뜻하게' }).click();
check('색 묶음 "따뜻하게" → 미리보기 막대가 그 첫 색', (await fills('.chart-ed-preview .dn-bar')).every((f) => f === '#f97316'));
await toggle('막대마다 다른 색').check();
let f = await fills('.chart-ed-preview .dn-bar');
check('막대마다 다른 색 → 막대 넷이 다 다른 색 · 견본이 항목 넷으로', new Set(f).size === 4 && (await page.locator('.cs-sw').count()) === 4 && (await page.locator('.chart-style h3').nth(1).innerText()) === '막대 색', f.join(' '));
// 미리보기에서 두 번째 막대(여름)를 눌러 팔레트 색
await page.locator('.chart-ed-preview .dn-bar').nth(1).click();
await page.waitForSelector('.chart-color-pop');
check('미리보기 막대 누르기 → 색 판 (머리: 막대 색 · 여름)', (await page.locator('.chart-color-pop .cp-title').first().innerText()) === '막대 색 · 여름');
await page.keyboard.press('Escape');
await page.waitForTimeout(100);
check('색 판에서 Esc → 판만 닫히고 그래프 창은 그대로', (await page.locator('.chart-color-pop').count()) === 0 && (await page.locator('.chart-editor').count()) === 1);
await page.locator('.chart-ed-preview .dn-bar').nth(1).click();
await page.waitForSelector('.chart-color-pop');
await page.screenshot({ path: `${OUT}/chart-style-pop.png` });
const picked = await page.locator('.chart-color-pop [aria-label="팔레트"] .cp-dot').nth(27).getAttribute('title');
await page.locator('.chart-color-pop [aria-label="팔레트"] .cp-dot').nth(27).click();
await page.waitForTimeout(100);
f = await fills('.chart-ed-preview .dn-bar');
check('팔레트 색 고르기 → 그 막대만 그 색 · 판 닫힘', f[1] === picked && f[0] === '#f97316' && (await page.locator('.chart-color-pop').count()) === 0, `${picked} ${f.join(' ')}`);
// 견본에서 겨울 → 색 코드
await page.locator('.cs-sw').nth(3).click();
await page.locator('.chart-color-pop .cp-code').fill('#123456');
await page.keyboard.press('Enter');
await page.waitForTimeout(100);
check('색 코드 #123456 → 겨울 막대', (await fills('.chart-ed-preview .dn-bar'))[3] === '#123456');
await toggle('값 글자').uncheck();
await toggle('눈금선').uncheck();
check('값 글자 · 눈금선 끄기 → 미리보기에서 사라짐', (await page.locator('.chart-ed-preview .dn-val').count()) === 0 && (await page.locator('.chart-ed-preview .dn-grid').count()) === 0);
await page.screenshot({ path: `${OUT}/chart-style-tab.png` });
await page.locator('.chart-editor .btn.primary').click();
await page.waitForTimeout(250);
let ch = await chart();
check('저장 → style: 따뜻하게 · 막대마다 · 값 끔 · 눈금선 끔 · 항목 색 2',
  ch.style?.palette === 'warm' && ch.style.vary === true && ch.style.values === false && ch.style.grid === false
  && ch.style.itemColors?.['여름'] === picked && ch.style.itemColors?.['겨울'] === '#123456' && Object.keys(ch.style.itemColors).length === 2, JSON.stringify(ch.style));
const blockId = await ws(() => [...window.__dn.view.engine.blocks()].find((b) => window.__dn.view.engine.contentsOf(b.id).some((c) => c.type === 'chart')).id);
f = await fills(`.dn-block[data-id="${blockId}"] .dn-chart .dn-bar`);
check('캔버스 그래프도 같은 색 · 값 글자 · 눈금선 없음', f[1] === picked && f[3] === '#123456' && f[0] === '#f97316'
  && (await page.locator(`.dn-block[data-id="${blockId}"] .dn-chart .dn-val, .dn-block[data-id="${blockId}"] .dn-chart .dn-grid`).count()) === 0, f.join(' '));
await ws(() => window.__dn.view.root.focus());
await page.keyboard.press('Control+z');
await page.waitForTimeout(150);
ch = await chart();
check('실행 취소 한 번 → 모양 · 데이터 모두 넣을 때로', !ch.style && ch.series.length === 1 && ch.title === '새 그래프');
await page.keyboard.press('Control+Shift+z');
await page.waitForTimeout(150);

// ── 블록 메뉴 › 그래프 모양 → 모양 탭부터 ──
await page.locator(`.dn-block[data-id="${blockId}"]`).click({ button: 'right' });
await page.waitForSelector('.menu[aria-label="블록 메뉴"]');
await page.locator('.menu[aria-label="블록 메뉴"] button', { hasText: '그래프 모양' }).click();
await page.waitForSelector('.chart-editor');
check('블록 메뉴 "그래프 모양 (색 · 보기)" → 모양 탭이 열림 · 저장한 모양 그대로',
  (await page.locator('.chart-tabs button.on').innerText()) === '모양' && (await page.locator('.cs-palettes [aria-checked="true"]').innerText()).includes('따뜻하게')
  && !(await toggle('값 글자').isChecked()) && await toggle('막대마다 다른 색').isChecked());

// ── 꺾은선: 계열 둘 · 계열 색 · 직선 · 채우기 ──
await page.locator('.chart-editor .seg button', { hasText: '꺾은선' }).click();
await tab('데이터');
await page.locator('.chart-grid .cg-add .btn', { hasText: '계열' }).click();
for (let r = 0; r < 4; r++) await page.locator('.chart-grid tbody tr').nth(r).locator('td input').nth(2).fill(String(10 + r * 7));
check('꺾은선 · 계열 둘 → 값 표 머리마다 색 견본 (항목 견본 없음)', (await page.locator('.chart-grid thead .cg-sw').count()) === 2 && (await page.locator('.chart-grid tbody .cg-sw').count()) === 0);
await page.locator('.chart-grid thead .cg-sw').nth(1).click();
await page.locator('.chart-color-pop .cp-code').fill('#0f766e');
await page.locator('.chart-color-pop .cp-apply').click();
await page.waitForTimeout(100);
const strokes = await page.locator('.chart-ed-preview .dn-line').evaluateAll((els) => els.map((e) => e.getAttribute('stroke')));
check('계열 2 견본 → 그 선 색 (계열 1은 색 묶음 첫 색)', strokes[1] === '#0f766e' && strokes[0] === '#f97316', strokes.join(' '));
await tab('모양');
check('꺾은선 보기: 값 · 범례 · 눈금선 · 매끈한 곡선 · 선 아래 채우기', (await page.locator('.cs-toggles label').allInnerTexts()).join('|') === '값 글자|범례|눈금선|매끈한 곡선|선 아래 채우기');
const curved = async () => (await page.locator('.chart-ed-preview .dn-line').first().getAttribute('d')).includes('C');
const filled = () => page.locator('.chart-ed-preview path[fill^="url(#dn-cg"]').count();
const before = [await curved(), await filled()];
await toggle('매끈한 곡선').uncheck();
await toggle('선 아래 채우기').uncheck();
await toggle('범례').uncheck();
check('매끈한 곡선 · 채우기 · 범례 끄기 → 꺾은 직선 · 채우기 없음 · 범례 없음', before[0] && before[1] === 1 && !(await curved()) && (await filled()) === 0
  && (await page.locator('.chart-ed-preview .dn-legend-text').count()) === 0);
// 미리보기의 선(점)을 눌러도 그 계열 색
await page.locator('.chart-ed-preview .dn-dot[data-si="0"]').first().click();
await page.waitForSelector('.chart-color-pop');
check('미리보기 점 누르기 → 계열 색 판 (계열 색 · 그 계열 이름)', (await page.locator('.chart-color-pop .cp-title').first().innerText()).startsWith('계열 색 · '));
await page.locator('.chart-color-pop .cp-dot').first().click();
await page.screenshot({ path: `${OUT}/chart-style-line.png` });

// ── 원: 조각 색은 항목 색 그대로 · 구멍 · 범례 ──
await page.locator('.chart-editor .seg button', { hasText: '원' }).click();
await page.waitForTimeout(100);
f = await fills('.chart-ed-preview .dn-slice');
check('원 → 조각 색 = 막대 때 고른 항목 색 · 견본은 조각 넷', f[1] === picked && f[3] === '#123456' && (await page.locator('.cs-sw').count()) === 4 && (await page.locator('.chart-style h3').nth(1).innerText()) === '조각 색', f.join(' '));
check('원 보기: 값 · 몫 글자 · 범례 · 가운데 구멍', (await page.locator('.cs-toggles label').allInnerTexts()).join('|') === '값 · 몫 글자|범례|가운데 구멍 (도넛)');
await toggle('범례').check();
await toggle('값 · 몫 글자').check();
const withHole = [await page.locator('.chart-ed-preview .dn-center').count(), await page.locator('.chart-ed-preview .dn-legend-text').count()];
await toggle('가운데 구멍 (도넛)').uncheck();
check('가운데 구멍 끄기 → 가운데 합계 없음 · 꽉 찬 조각', withHole[0] === 1 && withHole[1] > 0 && (await page.locator('.chart-ed-preview .dn-center').count()) === 0
  && (await page.locator('.chart-ed-preview .dn-slice').first().getAttribute('d')).startsWith('M104,110L'));
await toggle('범례').uncheck();
check('원 범례 끄기 → 범례 없음', (await page.locator('.chart-ed-preview .dn-legend-text').count()) === 0);
await page.locator('.cs-palettes [role="radio"]', { hasText: '흑백' }).click();
f = await fills('.chart-ed-preview .dn-slice');
check('색 묶음 바꾸기 → 하나씩 고른 색은 지워지고 흑백 묶음 색으로', f[0] === '#374151' && f[1] === '#9ca3af' && f[3] === '#d1d5db', f.join(' '));
await page.screenshot({ path: `${OUT}/chart-style-pie.png` });
await page.locator('.chart-editor .btn.primary').click();
await page.waitForTimeout(250);
ch = await chart();
check('원 저장 → 흑백 · 구멍 끔 · 범례 끔 · 항목 색 · 계열 색 없음', ch.kind === 'pie' && ch.style.palette === 'gray' && ch.style.hole === false && ch.style.legend === false
  && !ch.style.itemColors && !ch.series.some((s) => s.color), JSON.stringify(ch.style));

// ── 아무것도 안 바꾼 그래프는 style을 적지 않는다 ──
await ws(() => window.__dn.view.select([]));
await page.locator('.toolbar .insert-btn').click();
await page.waitForSelector('.insert-menu');
await page.keyboard.type('그래프');
await page.keyboard.press('Enter');
await page.waitForSelector('.chart-editor');
await tab('모양');
await toggle('값 글자').uncheck();
await toggle('값 글자').check();
await page.locator('.chart-editor .btn.primary').click();
await page.waitForTimeout(250);
const plain = await ws(() => [...window.__dn.view.engine.contents()].filter((x) => x.type === 'chart').map((c) => JSON.parse(JSON.stringify(c))));
check('기본값 그대로 저장 → style 없음 (옛 그래프와 같은 데이터)', plain.length === 2 && plain.some((c) => !('style' in c) && c.kind === 'bar'));

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
