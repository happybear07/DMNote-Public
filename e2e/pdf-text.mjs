// 글자를 고를 수 있는 PDF (FR-131 · 워드 빈칸 2): 쪽 그림 위 보이지 않는 글자 층(ToUnicode로 되읽기) · 제목 책갈피(단계) ·
// 웹 링크 · 상호 참조 · 목차 링크(문서 안 자리) · 캡션이 PDF에 남는지 · 머리글 글자 · 파일 구조(xref 자리)가 맞는지 PDF를 직접 읽어 확인.
// 사용: dev 서버 실행 후 `node e2e/pdf-text.mjs [스크린샷 폴더]`
import { chromium } from 'playwright-core';
import { fsPath } from './lib/fs-path.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

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
page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });
const ws = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
const CORE = fsPath('packages/engine-core/src/index.ts');

await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(() => window.__dn.newNote({ sheet: null }));
await page.waitForFunction(() => window.__dn.view.engine.blockCount === 0);
await ws(async (CORE) => {
  const core = await import(CORE), e = window.__dn.view.engine;
  const P = (text, marks) => ({ type: 'paragraph', content: [{ type: 'text', text, ...(marks ? { marks } : {}) }] });
  const ids = e.transact((tx) => {
    const text = (y, role, content, h = 60) => { const b = tx.createBlock({ x: 0, y, w: 600, h }); tx.createContent({ blockId: b, type: 'text', role, doc: { type: 'doc', content } }); return b; };
    text(0, 'title', [P('1장 서론')], 40);
    const toc = tx.createBlock({ x: 0, y: 60, w: 600, h: 80 }); tx.createContent({ blockId: toc, type: 'toc', depth: 3 });
    const body = text(160, 'body', [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '배경' }] }, P('첫 번째 문단 Hello World 2026 — 글자를 고를 수 있어야 한다.'),
      { type: 'paragraph', content: [{ type: 'text', text: '웹 링크', marks: [{ type: 'link', attrs: { href: 'https://example.com/a(b)' } }] }] },
      ...Array.from({ length: 45 }, (_, i) => P(`${i + 1}번째 채움 문단입니다.`))], 1400);
    const chart = tx.createBlock({ x: 0, y: 1600, w: 400, h: 220 }); tx.createContent({ blockId: chart, type: 'chart', kind: 'bar', series: [{ id: 's', name: '값', points: [{ x: 'a', y: 1 }, { x: 'b', y: 2 }] }] });
    const tail = text(1850, 'body', [{ type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: '세부 결과' }] }, { type: 'paragraph', content: [{ type: 'text', text: '자세한 것은 ' }, { type: 'xref', attrs: { id: chart, label: '그림 1' } }, { type: 'text', text: '을 보라.' }] }]);
    return { chart, body, tail };
  }, { origin: 'user' }).value;
  core.setBlockCaption(e, ids.chart, '추이');
  core.setPageSetup(e, { header: '머리 {쪽}/{전체 쪽}' });
  window.__dn.setDocPages(true);
  window.__dn.setViewMode('doc');
}, CORE);
await wait(1200);
const pdf = await ws(async () => {
  const r = await import('/src/print-render.ts'), p = await import('/src/pdf.ts');
  const { pages, outline } = await r.rasterizePages(document.querySelector('.dn-doc'), { pageNumbers: true, colors: true, scale: 1 });
  const buf = new Uint8Array(await p.imagesToPdf(pages, '고르기 시험', outline).arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 8192) s += String.fromCharCode(...buf.subarray(i, i + 8192));
  return { s, sheets: document.querySelectorAll('.dn-doc .dn-doc-sheet').length };
});
const bin = pdf.s;
if (OUT) writeFileSync(join(OUT, 'pdf-text.pdf'), Buffer.from(bin, 'latin1'));

// 되읽기: ToUnicode 표 → 쪽마다 Tj 글자
const map = new Map();
for (const m of bin.matchAll(/<([0-9a-f]{4})> <([0-9a-f]+)>/g)) {
  const hex = m[2], units = [];
  for (let i = 0; i < hex.length; i += 4) units.push(parseInt(hex.slice(i, i + 4), 16));
  map.set(m[1], String.fromCharCode(...units));
}
const decode = (hex) => hex.match(/.{4}/g).map((c) => map.get(c) ?? '?').join('');
const pageTexts = [...bin.matchAll(/stream\n(q [\d.]+ 0 0 [\d.]+ 0 0 cm \/Im0 Do Q[\s\S]*?)\nendstream/g)].map((m) => [...m[1].matchAll(/<([0-9a-f]+)> Tj/g)].map((x) => decode(x[1])).join(' '));
const all = pageTexts.join('\n');
check('쪽 수 = 종이 수, 쪽마다 글자 층', pageTexts.length === pdf.sheets && pageTexts.every((t) => t.length > 0), `${pageTexts.length}/${pdf.sheets}`);
check('본문 글자 되읽기 (한글 · 영어 · 숫자 · 기호)', all.includes('첫 번째 문단 Hello World 2026 — 글자를 고를 수 있어야 한다.'), all.slice(0, 160));
check('긴 글이 다음 쪽 글자 층에', pageTexts.slice(1).join(' ').includes('45번째 채움 문단입니다.'));
check('캡션 · 상호 참조 · 목차 · 머리글 글자도', all.includes('그림 1. 추이') && all.includes('자세한 것은') && all.includes('그림 1') && pageTexts[0].includes('목차') && pageTexts[1]?.includes(`머리 2/${pdf.sheets}`), pageTexts[1]?.slice(0, 80));
check('보이지 않는 글자 (3 Tr) · 빈 TrueType 글꼴 · ToUnicode', /BT 3 Tr/.test(bin) && bin.includes('/FontFile2') && bin.includes('/ToUnicode') && bin.includes('/Encoding /Identity-H'));
// 책갈피
const titles = [...bin.matchAll(/\/Title <FEFF([0-9A-F]+)> \/Parent (\d+)/g)].map((m) => decode16(m[1]));
function decode16(h) { const u = []; for (let i = 0; i < h.length; i += 4) u.push(parseInt(h.slice(i, i + 4), 16)); return String.fromCharCode(...u); }
check('제목 책갈피: 제목 상자 · 제목 2 · 제목 3 (문서 차례)', JSON.stringify(titles) === JSON.stringify(['1장 서론', '배경', '세부 결과']) && bin.includes('/PageMode /UseOutlines'), JSON.stringify(titles));
const nest = [...bin.matchAll(/\/Title <FEFF[0-9A-F]+> \/Parent (\d+) 0 R/g)].map((m) => m[1]);
// 책갈피 번호: 뿌리 r, 항목 r+1 · r+2 · r+3 — 1장 서론(1단계) > 배경(제목 2) > 세부 결과(제목 3)
check('책갈피 단계: 1장 서론 > 배경 > 세부 결과', nest[1] === String(+nest[0] + 1) && nest[2] === String(+nest[0] + 2), JSON.stringify(nest));
// 링크
check('웹 링크 (괄호 이스케이프)', bin.includes('/URI (https://example.com/a\\(b\\))'));
const dests = (bin.match(/\/Subtype \/Link [^>]*\/Dest \[\d+ 0 R \/XYZ/g) ?? []).length;
check('문서 안 링크: 상호 참조 + 목차 제목들', dests >= 3, String(dests));
// 파일 구조: xref 자리마다 그 번호 객체
const xrefAt = Number(/startxref\n(\d+)/.exec(bin)[1]);
const table = bin.slice(xrefAt).split('\n');
const count = Number(table[1].split(' ')[1]);
let okOffsets = 0;
for (let id = 1; id < count; id++) { const off = Number(table[2 + id].slice(0, 10)); if (bin.startsWith(`${id} 0 obj`, off)) okOffsets++; }
check('xref 자리가 모두 맞음', okOffsets === count - 1, `${okOffsets}/${count - 1}`);
check('콘솔 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close();
const bad = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
