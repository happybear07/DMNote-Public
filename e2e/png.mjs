// PNG로 내보내기 확인 (FR-129): 캔버스 전체 · 고른 블록, 배율과 무관한 해상도, 실제로 그려졌는지(픽셀).
// 사용: dev 서버 실행 후 `node e2e/png.mjs [출력 폴더]` — 내보낸 PNG도 그 폴더에 남는다.
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2] ?? '.';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
process.on('unhandledRejection', (e) => { if (!/Target page, context or browser has been closed/.test(String(e))) throw e; });

const browser = await chromium.launch({ channel: process.env.DN_CHANNEL ?? 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
await ctx.addInitScript(() => localStorage.setItem('dn:no-env-key', '1'));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });
const ws = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await wait(500);

const pngSize = (buf) => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) });
async function exportPng(all, name) {
  const dl = page.waitForEvent('download');
  await ws((a) => window.__dn.exportPng(!a), all);
  const d = await dl;
  const p = join(OUT, name);
  await d.saveAs(p);
  return { file: d.suggestedFilename(), buf: readFileSync(p), path: p };
}

// 예시 노트: 제목 상자 · 내용 상자 4개 · 라벨 있는 화살표 3개
await ws(() => window.__dn.view.select([]));
await ws(() => window.__dn.view.zoomTo(0.5));
await wait(300);
const a = await exportPng(true, 'png-all-50.png');
await ws(() => window.__dn.view.zoomTo(1.5));
await wait(300);
const b = await exportPng(true, 'png-all-150.png');
const sa = pngSize(a.buf), sb = pngSize(b.buf);
check('PNG 파일 · 이름 = 노트 제목.png', a.buf.subarray(1, 4).toString() === 'PNG' && a.file === 'Claude API 구조 정리.png', a.file);
check('화면 배율(50% · 150%)과 무관하게 같은 크기', sa.w === sb.w && sa.h === sb.h && sa.w > 1000, `${sa.w}×${sa.h} / ${sb.w}×${sb.h}`);
const world = await ws(() => { const e = window.__dn.view.engine; const bs = [...e.blocks()]; return { w: Math.max(...bs.map((x) => x.x + x.w)) - Math.min(...bs.map((x) => x.x)) }; });
check('2배 해상도 (블록 폭 + 여백)', Math.abs(sa.w - (world.w + 64) * 2) < 6, `${sa.w} vs ${(world.w + 64) * 2}`);

// 실제로 그려졌는지: 흰색이 아닌 픽셀 비율 · 화살표 선 색 · 글자(어두운 픽셀)
const stats = await page.evaluate(async (bytes) => {
  const img = new Image();
  img.src = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
  await img.decode();
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let nonWhite = 0, dark = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] < 250 || d[i + 1] < 250 || d[i + 2] < 250) nonWhite++;
    if (d[i] < 90 && d[i + 1] < 90 && d[i + 2] < 90) dark++;
  }
  return { nonWhite: nonWhite / (d.length / 4), dark };
}, [...a.buf]);
check('그림이 들어 있음 (상자 · 선 · 글자)', stats.nonWhite > 0.01 && stats.dark > 2000, JSON.stringify(stats));

// 고른 블록만
await ws(() => { const v = window.__dn.view; /* 맨 위 두 상자 (제목 · 첫 상자) */ const ids = [...v.engine.blocks()].sort((x, y) => x.y - y.y).slice(0, 2).map((x) => x.id); v.select(ids); });
const c = await exportPng(false, 'png-sel.png');
const sc = pngSize(c.buf);
check('고른 상자 2개만 → 더 작은 그림 · 이름에 표시', sc.w * sc.h < sa.w * sa.h && c.file.includes('상자 2개'), `${sc.w}×${sc.h} ${c.file}`);

// 서식이 많은 노트 (제목 · 목록 · 번호 · 할 일 · 인용 · 코드 · 굵게) — 붙여넣기로 상자 하나, 눈으로 확인할 그림도 남긴다
await ws(() => window.__dn.newNote());
await wait(300);
await page.evaluate((t) => {
  const dt = new DataTransfer(); dt.setData('text/plain', t);
  const root = window.__dn.view.root; root.focus();
  root.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, '## 서식 확인\n\n**굵게**와 *기울임*, `코드`\n\n- 글머리 하나\n- 글머리 둘\n\n1. 번호 하나\n2. 번호 둘\n\n- [x] 끝난 일\n- [ ] 남은 일\n\n> 인용한 문장\n\n```\nconst a = 1;\n```');
await wait(400);
await ws(() => window.__dn.view.select([]));
const rich = await exportPng(true, 'png-rich.png');
check('서식 노트도 내보내짐', pngSize(rich.buf).w > 300, JSON.stringify(pngSize(rich.buf)));

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await ctx.close();
await browser.close().catch(() => {});
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
