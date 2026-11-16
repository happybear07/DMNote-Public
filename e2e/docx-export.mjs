// 워드(.docx) 내보내기 (워드 빈칸 1): 인쇄 · 다른 파일로 저장 › Word → 파일. ZIP 안 부분이 다 있고 XML이 바른지,
// 문서에 제목 · 목록 · 표(합친 칸) · 그림 · 각주 · 링크 · 수식 · 쪽 설정(가로 · 머리글 · 쪽 번호)이 들어갔는지.
// 사용: dev 서버 실행 후 `node e2e/docx-export.mjs [저장 폴더]` — 폴더를 주면 docx-export.docx를 남긴다(워드로 열어 보기)
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
import { fsPath } from './lib/fs-path.mjs';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2];
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const browser = await chromium.launch({ channel: process.env.DN_CHANNEL ?? 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
await ctx.addInitScript(() => { localStorage.setItem('dn:no-env-key', '1'); localStorage.removeItem('dn:export-format'); });
const page = await ctx.newPage();
// Edge는 .docx를 받으면 미리보기 탭을 하나 더 연다(주소 없음) — 그 탭이 닫힐 때 나는 오류는 시험과 무관
process.on('unhandledRejection', (e) => { if (e?.name !== 'TargetClosedError') throw e; });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });
const ws = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);

await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(() => window.__dn.newNote({ sheet: null }));
await page.waitForFunction(() => window.__dn.view.engine.blockCount === 0);
await ws(() => {
  const e = window.__dn.view.engine;
  const t = (text, marks) => ({ type: 'text', text, ...(marks ? { marks } : {}) });
  const p = (...content) => ({ type: 'paragraph', content });
  const cell = (s) => ({ type: 'doc', content: [p(t(s))] });
  e.transact((tx) => {
    const mk = (y, doc, extra = {}, role = 'body') => { const b = tx.createBlock({ x: 0, y, w: 600, h: 60, ...extra }); tx.createContent({ blockId: b, type: 'text', role, doc }); return b; };
    mk(0, { type: 'doc', content: [p(t('워드로 보내는 문서'))] }, {}, 'title');
    mk(100, { type: 'doc', content: [
      { type: 'heading', attrs: { level: 2 }, content: [t('둘째 제목')] },
      p(t('굵게', [{ type: 'strong' }]), t(' · '), t('기울임', [{ type: 'em' }]), t(' · '), t('링크', [{ type: 'link', attrs: { href: 'https://example.com/' } }]), t(' · 빨강', [{ type: 'textColor', attrs: { color: 'red' } }]), { type: 'footnote', attrs: { note: '각주 내용입니다' } }, t(' 수식 '), { type: 'math_inline', attrs: { tex: 'E=mc^2' } }),
      { type: 'bullet_list', content: [{ type: 'list_item', content: [p(t('글머리 하나')), { type: 'bullet_list', content: [{ type: 'list_item', content: [p(t('안쪽 항목'))] }] }] }, { type: 'list_item', content: [p(t('글머리 둘'))] }] },
      { type: 'ordered_list', attrs: { order: 3 }, content: [{ type: 'list_item', content: [p(t('셋째부터'))] }, { type: 'list_item', content: [p(t('넷째'))] }] },
      { type: 'task_list', content: [{ type: 'task_item', attrs: { checked: true }, content: [p(t('한 일'))] }, { type: 'task_item', attrs: { checked: false }, content: [p(t('할 일'))] }] },
      { type: 'blockquote', content: [p(t('인용한 글'))] },
      { type: 'code_block', attrs: { language: 'javascript' }, content: [t('const a = 1;\nconsole.log(a);')] },
      { type: 'callout', attrs: { icon: 'bulb', color: 'blue' }, content: [p(t('콜아웃 안내'))] },
      { type: 'horizontal_rule' },
    ] }, { align: 'justify', lineHeight: 1.5 });
    const tb = tx.createBlock({ x: 0, y: 400, w: 500, h: 120, caption: '조사 결과' });
    tx.createContent({ blockId: tb, type: 'table', headerCol: true, columns: [{ id: 'c1', name: '항목' }, { id: 'c2', name: '값' }, { id: 'c3', name: '비고' }], rows: [{ id: 'r1', order: 'a0', cells: { c1: cell('사과'), c2: cell('3'), c3: cell('합친 칸') } }, { id: 'r2', order: 'a1', cells: { c1: cell('배'), c2: cell('5'), c3: cell('') } }], merges: [{ r0: 'r1', c0: 'c3', r1: 'r2', c1: 'c3' }] });
    mk(600, { type: 'doc', content: [p(t('새 쪽에서 시작하는 문단'))] }, { pageBreak: true });
  }, { origin: 'user' });
  e.transact((tx) => tx.setNote({ pageSetup: { landscape: true, header: '{제목} 머리글', numbers: 'bottom-right' } }), { origin: 'user' });
});
// 사진 하나 (캔버스로 그린 PNG)
await ws(async () => {
  const c = document.createElement('canvas'); c.width = 120; c.height = 80;
  const g = c.getContext('2d'); g.fillStyle = '#4c6ef5'; g.fillRect(0, 0, 120, 80); g.fillStyle = '#fff'; g.fillRect(20, 20, 40, 40);
  const blob = await new Promise((ok) => c.toBlob(ok, 'image/png'));
  await window.__dn.addImages([new File([blob], 'pic.png', { type: 'image/png' })], { x: 0, y: 700 });
});
await wait(800);

await ws(() => window.__dn.printNote());
await wait(500);
await page.locator('.export-formats button', { hasText: 'Word' }).click();
await wait(600);
check('형식에 Word · 미리보기는 쪽 보기', (await page.locator('.export-paper.paged').count()) === 1);
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.locator('.export-go').click()]);
check('파일 이름 .docx', dl.suggestedFilename().endsWith('.docx'), dl.suggestedFilename());
const path = await dl.path();
const { readFileSync } = await import('node:fs');
const bytes = readFileSync(path);
if (OUT) writeFileSync(`${OUT}/docx-export.docx`, bytes);

// 브라우저에서 앱의 unzip으로 열어 XML을 읽어 본다
const info = await ws(async ({ b64, UNZIP }) => {
  const { unzip } = await import(UNZIP);
  const buf = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const entries = await unzip(buf);
  const dec = new TextDecoder();
  const files = Object.fromEntries(entries.map((e) => [e.path, e.data]));
  const bad = entries.filter((e) => /\.(xml|rels)$/.test(e.path)).filter((e) => new DOMParser().parseFromString(dec.decode(e.data), 'application/xml').querySelector('parsererror')).map((e) => e.path);
  const doc = dec.decode(files['word/document.xml'] ?? new Uint8Array());
  const count = (re) => (doc.match(re) ?? []).length;
  return {
    paths: entries.map((e) => e.path).sort(), bad,
    title: doc.includes('워드로 보내는 문서'), h1: count(/<w:pStyle w:val="Heading1"\/>/g), h2: count(/<w:pStyle w:val="Heading2"\/>/g),
    lists: count(/<w:numPr>/g), tasks: doc.includes('☑') && doc.includes('☐'), quote: count(/w:val="Quote"/g), code: count(/w:val="Code"/g),
    tbl: count(/<w:tbl>/g), vmerge: count(/<w:vMerge/g), tblHeader: count(/<w:tblHeader\/>/g), caption: doc.includes('표 1. 조사 결과'),
    drawing: count(/<w:drawing>/g), footnoteRef: count(/<w:footnoteReference /g), math: doc.includes('E=mc^2'), link: count(/<w:hyperlink /g),
    pageBreak: count(/<w:pageBreakBefore\/>/g), landscape: doc.includes('w:orient="landscape"'), jc: doc.includes('<w:jc w:val="both"/>'), line: doc.includes('w:line="360"'),
    footnotes: dec.decode(files['word/footnotes.xml'] ?? new Uint8Array()).includes('각주 내용입니다'),
    header: dec.decode(files['word/header1.xml'] ?? new Uint8Array()).includes('머리글'),
    footerPage: dec.decode(files['word/footer1.xml'] ?? new Uint8Array()).includes('PAGE'),
    media: entries.filter((e) => e.path.startsWith('word/media/')).length,
  };
}, { b64: bytes.toString('base64'), UNZIP: fsPath('apps/web/src/unzip.ts') });
check('필요한 부분이 다 있음', ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/numbering.xml', 'word/footnotes.xml', 'word/_rels/document.xml.rels'].every((p) => info.paths.includes(p)), JSON.stringify(info.paths));
check('XML이 모두 바름', info.bad.length === 0, JSON.stringify(info.bad));
check('제목 상자 → 제목 1 · 글 속 제목 2', info.title && info.h1 >= 1 && info.h2 >= 1, JSON.stringify({ h1: info.h1, h2: info.h2 }));
check('목록(번호 매기기) · 할 일 상자 · 인용 · 코드', info.lists >= 5 && info.tasks && info.quote >= 1 && info.code >= 2, JSON.stringify({ lists: info.lists, tasks: info.tasks, quote: info.quote, code: info.code }));
check('표: 머리 행(쪽마다) · 세로로 합친 칸 · 캡션', info.tbl === 1 && info.vmerge === 2 && info.tblHeader === 1 && info.caption, JSON.stringify({ tbl: info.tbl, vmerge: info.vmerge, tblHeader: info.tblHeader, caption: info.caption }));
check('그림 · 각주 · 수식 · 링크', info.drawing === 1 && info.media === 1 && info.footnoteRef === 1 && info.footnotes && info.math && info.link >= 1, JSON.stringify({ drawing: info.drawing, media: info.media, fn: info.footnoteRef, notes: info.footnotes, math: info.math, link: info.link }));
check('상자 꾸밈: 양쪽 맞춤 · 줄 간격 1.5 · 새 쪽', info.jc && info.line && info.pageBreak === 1, JSON.stringify({ jc: info.jc, line: info.line, pb: info.pageBreak }));
check('쪽 설정: 가로 · 머리글 · 쪽 번호', info.landscape && info.header && info.footerPage, JSON.stringify({ land: info.landscape, header: info.header, footer: info.footerPage }));

check('콘솔 오류 없음', errors.length === 0, errors.join(' | '));
await page.close();
await ctx.close();
await browser.close().catch(() => {});
const bad = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
