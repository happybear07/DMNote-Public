// 필기가 보이는지 (알파 AT-019 · AT-021): 새로 고침 · 노트를 바꿨다 돌아와도 화면을 움직이지 않고 바로 그려짐,
// 어두운 테마 · 어두운 캔버스 바탕에서 기본 검정 펜은 밝게 보임(저장 색은 그대로 #1f1f1f) — 문서 뷰 그림도 같게, 흰 바탕에선 검정 그대로.
// 사용: dev 서버 실행 후 `node e2e/ink-visible.mjs [스크린샷 폴더]`
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
async function draw(points) {
  await page.mouse.move(points[0][0], points[0][1]);
  await page.mouse.down();
  for (const [x, y] of points.slice(1)) await page.mouse.move(x, y, { steps: 3 });
  await page.mouse.up();
  await wait(80);
}
const zig = (x, y, w) => [[x, y], [x + w * 0.25, y + 30], [x + w * 0.5, y], [x + w * 0.75, y + 30], [x + w, y]];
/** 잉크 캔버스: 칠한 칸 수 · 칠한 칸의 평균 밝기(0~255) — 두 프레임 기다린 뒤 */
const inkPixels = () => ws(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => {
  const c = window.__dn.view.ink.canvas; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0, sum = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200) { n++; sum += (d[i] + d[i + 1] + d[i + 2]) / 3; }
  res({ n, lum: n ? Math.round(sum / n) : -1 });
}))));
/** 위 막대 ⋯ › 캔버스 설정 › 바탕색 */
const paper = async (name) => {
  await page.locator('.topbar .more-btn').click();
  await page.locator('.top-more-menu .canvas-settings-btn').click();
  await page.locator('.canvas-settings').getByRole('radio', { name }).click();
  await page.keyboard.press('Escape');
  await wait(300);
};
const reopen = async () => { await page.reload(); await page.waitForSelector('.dn-canvas', { timeout: 15000 }); await wait(600); };

// 새 노트(끝없는 캔버스)에 기본 펜으로 두 획
await ws(() => window.__dn.newNote({ sheet: null }));
await wait(500);
const noteId = await ws(() => window.__dn.state.currentId);
await ws(() => window.__dn.view.root.focus());
await page.keyboard.press('p');
await draw(zig(500, 400, 220));
await draw(zig(500, 480, 220));
const drawn = await inkPixels();
check('그린 직후 잉크가 보임 · 기본 색 검정', drawn.n > 300 && drawn.lum < 60 && (await ws(() => [...window.__dn.view.engine.strokes()].every((s) => s.color === '#1f1f1f'))), JSON.stringify(drawn));
await wait(800); // 저장

await reopen();
const afterReload = await inkPixels();
check('AT-019: 새로 고침 뒤 화면을 움직이지 않아도 잉크가 그려짐', (await ws(() => [...window.__dn.view.engine.strokes()].length)) === 2 && afterReload.n > drawn.n * 0.7, JSON.stringify(afterReload));
await page.mouse.move(700, 300);
await wait(1200);
check('조금 기다려도 그대로 보임', (await inkPixels()).n > drawn.n * 0.7);

// 다른 노트로 갔다가 돌아오기
const other = await ws(() => window.__dn.state.notes.find((n) => n.id !== window.__dn.state.currentId)?.id);
await ws((id) => window.__dn.openById(id), other);
await wait(500);
await ws((id) => window.__dn.openById(id), noteId);
await wait(600);
check('AT-019: 노트를 바꿨다 돌아와도 바로 그려짐', (await inkPixels()).n > drawn.n * 0.7);

// 어두운 테마: 기본 검정 펜이 밝게 보임 (저장 색은 그대로)
await ws(() => window.__dn.setTheme('dark'));
await wait(300);
const dark = await inkPixels();
check('AT-021: 어두운 테마에서 검정 펜이 밝게 그려짐', dark.n > drawn.n * 0.7 && dark.lum > 180, JSON.stringify(dark));
check('저장 색은 그대로 #1f1f1f', await ws(() => [...window.__dn.view.engine.strokes()].every((s) => s.color === '#1f1f1f')));
await page.screenshot({ path: `${OUT}/ink-dark-theme.png` });
// 빨강은 그대로 빨강
await ws(() => window.__dn.view.root.focus());
await page.keyboard.press('p');
await page.keyboard.press('2');
await draw(zig(500, 560, 220));
const red = await ws(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => {
  const c = window.__dn.view.ink.canvas, d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200 && d[i] > 180 && d[i + 1] < 90) n++; res(n);
}))));
check('빨간 펜은 어두운 테마에서도 빨강', red > 100, String(red));

// 흰 바탕(캔버스 설정)이면 어두운 테마여도 검정 그대로
await paper('흰색');
const white = await inkPixels();
check('어두운 테마 + 흰 바탕: 검정 펜은 검정', white.n > 300 && white.lum < 110, JSON.stringify(white));
await ws(() => window.__dn.setTheme('light'));
await wait(200);
// 밝은 테마 + 어두운 바탕(캔버스 설정)
await paper('어둡게');
const darkPaper = await inkPixels();
check('AT-021: 밝은 테마 + 어두운 바탕에서도 검정 펜이 밝게', darkPaper.lum > 180, JSON.stringify(darkPaper));
await page.screenshot({ path: `${OUT}/ink-dark-paper.png` });

// 묶인 필기 → 문서 뷰 그림(SVG): 어두운 테마에서 검정 획은 밝게, 빨강은 그대로, 밝은 테마에선 검정
await paper('테마 따라');
await ws(() => { const v = window.__dn.view; v.setTool('lasso'); for (const s of v.engine.strokes()) v.ink.selected.add(s.id); v.notifyUi(); });
await page.locator('.ink-bar').getByRole('button', { name: '블록으로 묶기' }).click();
await wait(200);
check('필기를 블록으로 묶음', await ws(() => [...window.__dn.view.engine.strokes()].every((s) => s.parent.kind === 'content')));
await ws(() => window.__dn.setTheme('dark'));
await ws(() => window.__dn.setViewMode('doc'));
await wait(500);
const docInk = () => page.locator('.dn-doc-item .dn-ink-svg svg path').evaluateAll((ps) => ps.map((p) => getComputedStyle(p).stroke));
let strokesCss = await docInk();
check('AT-021: 문서 뷰(어두운 테마) 검정 획은 밝게 · 빨강은 그대로', strokesCss.filter((c) => c === 'rgb(230, 230, 227)').length === 2 && strokesCss.includes('rgb(224, 49, 49)'), strokesCss.join(' '));
await page.screenshot({ path: `${OUT}/ink-dark-doc.png` });
await ws(() => window.__dn.setTheme('light'));
await wait(200);
strokesCss = await docInk();
check('문서 뷰(밝은 테마) 검정 획은 검정', strokesCss.filter((c) => c === 'rgb(31, 31, 31)').length === 2, strokesCss.join(' '));
await ws(() => window.__dn.setViewMode('canvas'));
await wait(300);

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} 통과${errors.length ? ` · 오류 ${errors.length}: ${errors.slice(0, 3).join(' | ')}` : ''}`);
await browser.close();
process.exit(results.every((r) => r.ok) && !errors.length ? 0 : 1);
