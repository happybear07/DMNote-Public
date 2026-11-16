// 인쇄 · 내보내기 그리기 (FR-131): 문서 뷰 DOM을 그대로 — (1) 혼자 열리는 HTML 문서(스타일 · 그림 · 수식 글꼴을 파일 안에)
// (2) 쪽마다 JPEG(PDF용, SVG foreignObject로 그려 캔버스에). 어두운 테마여도 내보낸 것은 늘 밝은 종이.
import { pageGeom } from '@dn/engine-core';
import { paginate, sheetDeco, type SheetDeco } from '@dn/engine-dom';
import type { PdfOutline, PdfPage } from './pdf';
import { measurePdfLayer } from './pdf-text';

const dataCache = new Map<string, string>();

async function toDataUrl(url: string): Promise<string> {
  if (url.startsWith('data:')) return url;
  const hit = dataCache.get(url);
  if (hit) return hit;
  const blob = await (await fetch(url)).blob();
  const out = await new Promise<string>((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = bad; r.readAsDataURL(blob); });
  dataCache.set(url, out);
  return out;
}

/**
 * 이 문서의 스타일 전부 (같은 출처 시트만). withFonts면 @font-face의 첫 글꼴 파일을 data URL로 넣는다(수식 KaTeX) —
 * 그림으로 그릴 때 · 혼자 열리는 파일에서는 바깥 파일을 읽지 못한다.
 */
export async function collectCss(withFonts: boolean): Promise<string> {
  const out: string[] = [];
  for (const sheet of [...document.styleSheets]) {
    let rules: CSSRuleList;
    try { rules = sheet.cssRules; } catch { continue; } // 다른 출처(웹 글꼴 등)는 읽을 수 없다
    const base = sheet.href ?? document.baseURI;
    for (const r of [...rules]) {
      if (r instanceof CSSFontFaceRule) {
        if (!withFonts) continue;
        const m = /url\(\s*["']?([^"')]+)["']?\s*\)\s*(format\([^)]*\))?/.exec(r.cssText);
        if (!m) continue;
        try {
          const data = await toDataUrl(new URL(m[1]!, base).href);
          out.push(r.cssText.replace(/src:[^;]+;/, `src: url("${data}")${m[2] ? ` ${m[2]}` : ''};`));
        } catch { /* 못 읽은 글꼴은 기본 글꼴로 */ }
      } else out.push(r.cssText);
    }
  }
  return out.join('\n');
}

/** 그림(blob: · 같은 출처)을 data URL로 — 파일 · 그림 안에서도 보이게 */
export async function inlineImages(root: HTMLElement): Promise<void> {
  await Promise.all([...root.querySelectorAll('img')].map(async (img) => {
    const src = img.getAttribute('src');
    if (!src || src.startsWith('data:')) return;
    try { img.setAttribute('src', await toDataUrl(src)); } catch { img.removeAttribute('src'); }
  }));
  // 편집 UI(단추 · 막대)는 빼고
  // 캡션 · 목차 링크는 dn-ui지만 내용이다 — 남긴다
  for (const el of root.querySelectorAll('.dn-ui:not(.dn-caption):not(.dn-toc-link), .dn-doc-gap, .dn-editor-pop')) el.remove();
}

/** 인쇄 · PDF에 공통으로 덧붙이는 규칙: 종이 테두리 · 그림자 없이, 바깥 바탕 없이 */
const PAPER_CSS = `.dn-doc-paged{background:none!important}.dn-doc-paged .dn-doc-page{margin:0!important}
.dn-doc-sheet{border:0!important;box-shadow:none!important}.dn-doc-item:hover{border-color:transparent!important}
.no-page-num .dn-sheet-num{visibility:hidden}.no-colors .dn-doc-item[data-color]{background:none!important}`;

function bodyFont(): string {
  const cs = getComputedStyle(document.body);
  return `font-family:${cs.fontFamily};font-size:${cs.fontSize};line-height:${cs.lineHeight};color:#37352f;`;
}

/** 머리글 · 바닥글 글 → @page 칸의 content ({쪽} · {전체 쪽}은 브라우저 쪽 번호로) */
function cssContent(tpl: string, title: string, date: string): string {
  // < > 는 \3C \3E 로 — 제목 · 머리글이 </style>로 인쇄 틀을 닫고 HTML을 끼우지 못하게 (보안 1-8)
  const str = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ').replace(/</g, '\\3C ').replace(/>/g, '\\3E ')}"`;
  return tpl.split(/(\{(?:쪽|전체 쪽|제목|날짜|page|pages|title|date)\})/).filter(Boolean).map((p) => {
    if (p === '{쪽}' || p === '{page}') return 'counter(page)';
    if (p === '{전체 쪽}' || p === '{pages}') return 'counter(pages)';
    if (p === '{제목}' || p === '{title}') return str(title);
    if (p === '{날짜}' || p === '{date}') return str(date);
    return str(p);
  }).join(' ');
}

/** 인쇄 쪽 (@page): 쪽 설정의 방향 · 여백 · 머리글 · 바닥글 · 쪽 번호 */
function pageRule(d: SheetDeco | null, numbers: boolean, title: string): string {
  const g = d?.geom ?? pageGeom(), mm = (px: number) => `${Math.round((px * 2540) / 96) / 100}mm`;
  const box = (at: string, content: string) => `@${at}{content:${content};font-size:9pt;color:#9b9a97}`;
  const boxes: string[] = [];
  const date = d?.date ?? '';
  if (d?.header) boxes.push(box('top-left', cssContent(d.header, d.title ?? title, date)));
  if (d?.footer) boxes.push(box('bottom-left', cssContent(d.footer, d.title ?? title, date)));
  const pos = d?.numbers ?? 'bottom-center';
  if (numbers && pos !== 'none') boxes.push(box(pos, 'counter(page)'));
  const first = d?.skipFirst ? `@page:first{${['top-left', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'].map((x) => `@${x}{content:none}`).join('')}}` : '';
  return `@page{size:A4 ${g.w > g.h ? 'landscape' : 'portrait'};margin:${mm(g.t)} ${mm(g.r)} ${mm(g.b)} ${mm(g.l)};${boxes.join('')}}${first}`;
}

/** 혼자 열리는 HTML 문서 — 내보내기(.html) · 인쇄(숨은 틀에서) */
export async function standaloneHtml(docRoot: HTMLElement, title: string, opts: { pageNumbers: boolean; colors: boolean }): Promise<string> {
  const clone = docRoot.cloneNode(true) as HTMLElement;
  clone.classList.remove('dn-doc-paged');
  for (const s of clone.querySelectorAll('.dn-doc-sheets')) s.remove();
  for (const el of clone.querySelectorAll<HTMLElement>('.dn-doc-page > *')) el.style.marginTop = '';
  const page = clone.querySelector<HTMLElement>('.dn-doc-page');
  const deco = page?.dataset.sheet ? sheetDeco(page) : null; // 쪽 보기였으면 그 쪽 설정
  if (page) { page.style.minHeight = ''; page.style.width = ''; page.style.padding = ''; }
  await inlineImages(clone);
  const css = await collectCss(!!clone.querySelector('.katex'));
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${css}
${PAPER_CSS}
body{margin:0;background:#fff;${bodyFont()}}.dn-doc-page{max-width:760px;margin:0 auto;padding:40px 24px}
@media print{${pageRule(deco, opts.pageNumbers, title)}.dn-doc-page{padding:0}.dn-doc-break{break-before:page}.dn-doc-item{break-inside:avoid}}
</style></head><body class="${opts.colors ? '' : 'no-colors'}">${clone.outerHTML}</body></html>`;
}

/** 숨은 틀에 HTML을 띄워 인쇄 창 — 앱 화면은 그대로 둔다 */
export function printHtml(html: string): Promise<void> {
  return new Promise((done) => {
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    f.srcdoc = html;
    f.onload = async () => {
      const w = f.contentWindow!;
      await Promise.all([...f.contentDocument!.images].map((i) => i.decode().catch(() => {})));
      w.addEventListener('afterprint', () => { f.remove(); done(); }, { once: true });
      w.focus();
      w.print();
      // afterprint가 오지 않는 브라우저 대비
      setTimeout(() => { if (f.isConnected) { f.remove(); done(); } }, 60_000);
    };
    document.body.appendChild(f);
  });
}

/**
 * 쪽 보기로 그려진 문서(.dn-doc.dn-doc-paged) → 쪽마다 JPEG. scale 2면 1588 × 2246 (약 190dpi).
 * 쪽마다 같은 SVG를 viewBox만 바꿔 그린다 — 긴 문서를 한 장의 큰 그림으로 그리면 메모리가 모자란다.
 */
export async function rasterizePages(docRoot: HTMLElement, opts: { pageNumbers: boolean; colors: boolean; scale?: number; onPage?: (i: number, n: number) => void }): Promise<{ pages: PdfPage[]; outline: PdfOutline[] }> {
  const scale = opts.scale ?? 2;
  const clone = docRoot.cloneNode(true) as HTMLElement;
  await inlineImages(clone);
  // 쪽 사이 틈 없이 다시 나눈다 — 한 쪽보다 긴 글의 줄이 틈(화면의 24px)에 빠지지 않게. 크기를 재야 하니 화면 밖에 잠깐 붙인다
  const stage = document.createElement('div');
  const g = sheetDeco(clone.querySelector<HTMLElement>('.dn-doc-page') ?? clone).geom; // 쪽 설정의 종이 (가로면 뒤집힌 A4)
  stage.style.cssText = `position:fixed;left:-20000px;top:0;width:${g.w}px;visibility:hidden`;
  stage.append(clone);
  document.body.append(stage);
  const page = clone.querySelector<HTMLElement>('.dn-doc-page'), sheets = clone.querySelector<HTMLElement>('.dn-doc-sheets');
  const pages = page && sheets ? paginate(page, sheets, (el) => el.classList.contains('dn-doc-break') || !!el.querySelector(':scope > .dn-doc-break'), 0) : 1;
  // 글자 층 · 링크 · 책갈피 (pdf-text.ts) — 화면 밖에 붙어 있을 때 잰다
  const layer = page ? measurePdfLayer(page, g.h, pages) : { layers: [], outline: [] };
  stage.remove();
  const STEP = g.h;
  const css = await collectCss(!!clone.querySelector('.katex'));
  const wrap = document.createElement('div');
  wrap.className = `${opts.pageNumbers ? '' : 'no-page-num'} ${opts.colors ? '' : 'no-colors'}`;
  wrap.setAttribute('style', `${bodyFont()}width:${g.w}px;background:#fff`);
  wrap.append(clone);
  const xhtml = new XMLSerializer().serializeToString(wrap);
  const total = pages * STEP;
  const out: PdfPage[] = [];
  for (let k = 0; k < pages; k++) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${g.w * scale}" height="${g.h * scale}" viewBox="0 ${k * STEP} ${g.w} ${g.h}">`
      + `<style><![CDATA[${css.replaceAll(']]>', ']] >')}\n${PAPER_CSS}]]></style>`
      + `<foreignObject x="0" y="0" width="${g.w}" height="${total}">${xhtml}</foreignObject></svg>`;
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = g.w * scale; c.height = g.h * scale;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0);
    const blob = await new Promise<Blob>((ok, bad) => c.toBlob((b) => (b ? ok(b) : bad(new Error('쪽을 그리지 못했어요'))), 'image/jpeg', 0.9));
    const l = layer.layers[k];
    out.push({ jpeg: new Uint8Array(await blob.arrayBuffer()), w: c.width, h: c.height, pw: g.w, ...(l ? { text: l.runs, links: l.links } : {}) });
    opts.onPage?.(k + 1, pages);
  }
  return { pages: out, outline: layer.outline };
}
