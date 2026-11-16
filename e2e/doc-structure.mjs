// 캔버스 논리 구조 → 문서 (FR-088): 화살표 흐름은 자리와 상관없이 화살표 차례 + 단계 번호 · 라벨은 '↓ 라벨',
// 흐름이 아닌 나란한 상자는 컬럼 그대로, 갈래 흐름은 들여쓰기, 캔버스에 펜으로 그린 그림도 자리 순서대로 문서에.
// 사용: dev 서버 실행 후 `node e2e/doc-structure.mjs [스크린샷 폴더]`
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
await ws(() => window.__dn.newNote());
await wait(300);
// 흐름: 시작(아래) → 중간(위) → 끝(가운데, 라벨) — 자리는 뒤죽박죽. 흐름 밖: 같은 줄에 나란한 메모 두 개. 마인드맵: 중심 → 가지 둘
await ws(() => {
  const e = window.__dn.view.engine;
  const mk = (x, y, t) => e.transact((tx) => { const b = tx.createBlock({ x, y, w: 240, h: 60 }); tx.createContent({ blockId: b, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] } }); return b; }, { origin: 'user' }).value;
  const arrow = (a, b, label) => e.transact((tx) => tx.createArrow({ from: { blockId: a, side: 'auto' }, to: { blockId: b, side: 'auto' }, ...(label ? { label } : {}) }), { origin: 'user' });
  const 중간 = mk(0, 0, '중간 단계'), 끝 = mk(300, 120, '끝 단계'), 시작 = mk(0, 240, '시작 단계');
  arrow(시작, 중간); arrow(중간, 끝, '검토 후');
  mk(0, 500, '메모 왼쪽'); mk(300, 500, '메모 오른쪽');
  const 중심 = mk(0, 800, '중심'), 가지1 = mk(0, 950, '가지 하나'), 가지2 = mk(300, 950, '가지 둘');
  arrow(중심, 가지1); arrow(중심, 가지2);
});
// 펜으로 그림 (흐름 아래, 메모 위 자리)
await ws(() => { const v = window.__dn.view; v.setCamera({ x: -100, y: 300, zoom: 1 }); });
await wait(200);
const root = await page.locator('.dn-canvas').boundingBox();
await ws(() => window.__dn.view.setTool('pen'));
await page.mouse.move(root.x + 150, root.y + 100);
await page.mouse.down();
await page.mouse.move(root.x + 350, root.y + 140, { steps: 8 });
await page.mouse.up();
await ws(() => window.__dn.view.setTool('select'));
await wait(200);
await ws(() => window.__dn.setViewMode('doc'));
await wait(600);
const seq = await ws(() => [...document.querySelectorAll('.dn-doc-page > :not(.dn-doc-sheets)')].map((el) => el.classList.contains('dn-doc-ink') ? '[그림]'
  : el.classList.contains('dn-doc-row') ? `[${[...el.querySelectorAll('.dn-doc-item')].map((x) => x.textContent.trim()).join(' | ')}]`
  : `${el.dataset.step ? `${el.dataset.step}.` : ''}${el.style.marginLeft ? '  ' : ''}${el.querySelector('.dn-doc-text')?.textContent.trim()}`));
check('흐름은 화살표 차례 + 단계 번호 (자리와 상관없이)', JSON.stringify(seq.slice(0, 3)) === JSON.stringify(['1.시작 단계', '2.중간 단계', '3.끝 단계']), JSON.stringify(seq));
check('다음 단계 화살표 라벨은 "↓ 라벨"', (await page.locator('.dn-doc-flow').allInnerTexts()).includes('↓ 검토 후'));
check('펜으로 그린 그림도 문서에 (흐름 뒤 · 메모 앞 자리)', seq[3] === '[그림]' && (await page.locator('.dn-doc-ink svg path').count()) === 1, JSON.stringify(seq));
check('흐름이 아닌 나란한 상자는 컬럼 그대로', seq[4] === '[메모 왼쪽 | 메모 오른쪽]', seq[4]);
check('갈래 흐름(마인드맵)은 들여쓰기', JSON.stringify(seq.slice(5)) === JSON.stringify(['중심', '  가지 하나', '  가지 둘']), JSON.stringify(seq.slice(5)));
await page.screenshot({ path: `${OUT}/doc-structure.png` });

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
