// 노트 → 워드 문서(.docx, 워드 빈칸 1): 문서 뷰와 같은 차례로 상자마다 — 글(제목 · 목록 · 인용 · 코드 · 콜아웃 · 수식 · 각주 · 링크)
// · 표(합친 칸 · 머리) · 사진 · 그래프와 손글씨(그림으로) · 데이터베이스(표로) · 목차 · 캡션, 상자 꾸밈(맞춤 · 줄 간격 · 들여쓰기 ·
// 배경 · 새 쪽), 쪽 설정(종이 · 여백 · 머리글 · 바닥글 · 쪽 번호), 끝에 화살표 관계. 다시 가져오기는 docx-import.ts.
import {
  arrowChip, captionNumbers, chartCategories, dbCellTextIn, dbRows, documentOrder, embedTarget, figurePaths, figureSlot, inkFigures, inkPaths, inkSvgString,
  isChartContent, isDatabaseContent, isEmbedContent, isFileContent, isImageContent, isInkContent, isTableContent, isTextContent, isTocContent, isTabsContent, isWebContent,
  groupName, isBound, pageGeom, PAGE_MARGINS, tocEntries, type Block, type Content, type Engine, groupHeadings, isDividerContent,
} from '@dn/engine-core';
import { diagramGroups, renderChart } from '@dn/engine-dom';
import { BG_COLOR_HEX, TEXT_COLOR_HEX } from '@dn/text-pm';
import { blockFirstLine } from '../ws-model';
import { CT, contentTypesXml, coreXml, esc, footnotesXml, HEAD, NS, numberingXml, px2tw, REL, relsXml, settingsXml, stylesXml } from './ooxml';
import { hexOf, pPrXml, textToOoxml, type DocxCtx, type Look } from './docx-text';
import { gridXml, tableXml } from './docx-table';
import { drawingXml, imageMedia, svgMedia, type Media } from './docx-media';
import { zip } from './zip';
import type { ZipEntry } from '../zip';

export interface DocxOptions { title: boolean; colors: boolean; pageNumbers: boolean }
export interface DocxHost {
  noteTitle(id: string): string | null;
  /** 첨부 파일 내용 (해시) */
  file(hash: string): Promise<Blob | null>;
  /** '문서에서 그림으로' 묶음의 도식 그림 (캔버스 모양 그대로, 2배로 그린 PNG) */
  diagram?(ids: readonly string[]): Promise<Blob | null>;
}

const A4_TW = { w: 11906, h: 16838 };

/** 상자 꾸밈 → 문단 · 글자 기본값 */
function lookOf(b: Block, colors: boolean): Look {
  const fl = b.firstLine ?? 0;
  return {
    p: {
      ...(b.align ? { jc: b.align === 'justify' ? 'both' as const : b.align } : {}),
      ...(b.spaceBefore || b.spaceAfter || b.lineHeight ? { spacing: { ...(b.spaceBefore ? { before: px2tw(b.spaceBefore) } : {}), ...(b.spaceAfter ? { after: px2tw(b.spaceAfter) } : {}), ...(b.lineHeight ? { line: Math.round(240 * b.lineHeight) } : {}) } } : {}),
      ...(b.indent || fl ? { ind: { ...(b.indent ? { left: b.indent * 360 } : {}), ...(fl > 0 ? { firstLineChars: Math.round(fl * 100) } : fl < 0 ? { hangingChars: Math.round(-fl * 100) } : {}) } } : {}),
      ...(colors && hexOf(b.style?.color, BG_COLOR_HEX) ? { shd: hexOf(b.style?.color, BG_COLOR_HEX)! } : {}),
    },
    r: { ...(b.fontFamily ? { font: b.fontFamily } : {}), ...(hexOf(b.textColor, TEXT_COLOR_HEX) ? { color: hexOf(b.textColor, TEXT_COLOR_HEX)! } : {}) },
    scale: b.fontScale ?? 1,
  };
}

/** 상자의 첫 문단부터 새 쪽 — pPr 안 차례(pStyle 다음)에 맞춰 넣는다. 표로 시작하면 앞에 빈 문단 */
function withPageBreak(x: string): string {
  if (x === '<w:p/>') return '<w:p><w:pPr><w:pageBreakBefore/></w:pPr></w:p>';
  if (!x.startsWith('<w:p>')) return `<w:p><w:pPr><w:pageBreakBefore/></w:pPr></w:p>${x}`;
  const m = /^<w:p><w:pPr>(<w:pStyle [^>]*\/>)?/.exec(x);
  return m ? `${m[0]}<w:pageBreakBefore/>${x.slice(m[0].length)}` : `<w:p><w:pPr><w:pageBreakBefore/></w:pPr>${x.slice(5)}`;
}

const plain = (s: string, style?: string) => `<w:p>${pPrXml(style ? { style } : {})}${s ? `<w:r><w:t xml:space="preserve">${esc(s)}</w:t></w:r>` : ''}</w:p>`;

export async function noteToDocx(engine: Engine, title: string, opts: DocxOptions, host: DocxHost): Promise<Uint8Array> {
  const rels: { id: string; type: string; target: string; external?: boolean }[] = [];
  const rel = (type: string, target: string, external?: boolean) => { const id = `rId${rels.length + 1}`; rels.push({ id, type, target, ...(external ? { external } : {}) }); return id; };
  rel(REL.styles, 'styles.xml'); rel(REL.settings, 'settings.xml'); rel(REL.numbering, 'numbering.xml'); rel(REL.footnotes, 'footnotes.xml');
  const media: { name: string; m: Media }[] = [];
  const notes: string[] = [];
  const ordered: { numId: number; start: number; outline?: boolean }[] = [];
  const links = new Map<string, string>();
  const caps = captionNumbers(engine);
  const ctx: DocxCtx = {
    link: (href) => { let id = links.get(href); if (!id) { id = rel(REL.link, href, true); links.set(href, id); } return id; },
    footnote: (text) => { const id = notes.length + 1; notes.push(`<w:footnote w:id="${id}"><w:p>${pPrXml({ style: 'FootnoteText' })}<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> ${esc(text)}</w:t></w:r></w:p></w:footnote>`); return id; },
    orderedList: (start, outline) => { const numId = ordered.length + 2; ordered.push({ numId, start, ...(outline ? { outline } : {}) }); return numId; },
    noteTitle: host.noteTitle,
    xref: (id) => caps.get(id)?.label ?? null,
  };
  const ps = engine.note.pageSetup, g = pageGeom(ps);
  const maxPx = g.w - g.l - g.r, maxTw = px2tw(maxPx);
  const picture = async (m: Media | null, wPx: number, alt: string): Promise<string> => {
    if (!m) return plain(alt ? `[그림: ${alt}]` : '[그림]');
    const name = `image${media.length + 1}.${m.ext}`;
    media.push({ name, m });
    const id = rel(REL.image, `media/${name}`);
    const w = Math.min(wPx, maxPx), h = w * (m.h / Math.max(1, m.w));
    return `<w:p>${pPrXml({ spacing: { after: 80 } })}${drawingXml(id, media.length, w, h, alt)}</w:p>`;
  };

  const body: string[] = [];
  if (opts.title && title) body.push(plain(title, 'Title'));
  const blocks = documentOrder(engine).map((x) => x.block);
  const figGroups = diagramGroups(engine, blocks); // 도식 그림으로 보일 묶음 (문서 뷰와 같은 규칙)
  const drawn = new Set<string>();
  const figs = inkFigures(engine).map((f) => ({ f, slot: figureSlot(blocks, f) }));
  const figAt = async (i: number) => {
    for (const x of figs) if (x.slot === i && x.f.ids.length) { const p = figurePaths(engine, x.f); body.push(await picture(await svgMedia(inkSvgString(p), p.w, p.h), p.w, '손그림')); }
  };
  const named = new Set<string>(); // 이름 있는 묶음은 첫 상자 앞에 소제목 (문서 뷰와 같게, STRUCTURE-GUIDE 4.11)
  const heads = groupHeadings(engine);
  for (const [i, b] of blocks.entries()) {
    await figAt(i);
    const fg = b.group ? figGroups.get(b.group) : undefined;
    const gname = b.group && !fg && !named.has(b.group) ? heads.get(b.group) : undefined; // 번호 켠 카드는 '번호. 이름'
    if (gname) { named.add(b.group!); body.push(plain(gname, 'SectionHead')); }
    if (fg) {
      if (drawn.has(b.group!)) continue;
      drawn.add(b.group!);
      const blob = await host.diagram?.(fg) ?? null, m = blob ? await imageMedia(blob) : null, name = groupName(engine, b.group!, fg);
      body.push(await picture(m, m ? m.w / 2 : maxPx, `도식: ${name}`), plain(name, 'Caption'));
      continue;
    }
    const look = lookOf(b, opts.colors);
    const start = body.length;
    const cap = caps.get(b.id), capLine = cap && b.caption ? plain(`${cap.label}. ${b.caption}`, 'Caption') : '';
    if (capLine && cap!.kind === '표') body.push(capLine);
    for (const c of engine.contentsOf(b.id)) body.push(...await contentXml(c, b, look));
    if (capLine && cap!.kind === '그림') body.push(capLine);
    if (b.pageBreak && body.length > start) body[start] = withPageBreak(body[start]!);
  }
  await figAt(blocks.length);
  // 도식 그림 안에 그린 화살표(같은 '그림으로' 묶음 안)는 관계 목록에서 뺀다
  const inFig = (id: string) => { const g = engine.getBlock(id)?.group; return g && figGroups.has(g) ? g : null; };
  const arrows = [...engine.arrows()].filter(isBound).filter((a) => !inFig(a.from.blockId) || inFig(a.from.blockId) !== inFig(a.to.blockId)); // 빈 곳 화살표는 관계가 아니다
  if (arrows.length) {
    const name = (id: string) => (blockFirstLine(engine.contentsOf(id)) || '상자').slice(0, 60);
    body.push(plain('관계', 'SectionHead'), ...arrows.map((a) => `<w:p>${pPrXml({ style: 'ListParagraph', num: { id: 1, lvl: 0 } })}<w:r><w:t xml:space="preserve">${esc(`${name(a.from.blockId)} → ${name(a.to.blockId)}${arrowChip(a) ? ` (${arrowChip(a)})` : ''}`)}</w:t></w:r></w:p>`));
  }

  async function contentXml(c: Content, b: Block, look: Look): Promise<string[]> {
    if (isTextContent(c)) return textToOoxml(c.doc, ctx, look, c.role === 'title');
    if (isTableContent(c)) return [...(c.title ? [plain(c.title)] : []), tableXml(c, b.w, maxTw, ctx, look)];
    if (isImageContent(c)) { const blob = await host.file(c.attachment); return [await picture(blob ? await imageMedia(blob) : null, b.w, c.alt ?? '')]; }
    if (isChartContent(c)) {
      const el = document.createElement('div');
      el.style.cssText = 'position:fixed;left:-10000px;top:0;width:640px';
      document.body.append(el);
      renderChart(c, el);
      const svg = el.querySelector('svg');
      const w = 640, h = svg ? Number(svg.getAttribute('height')) || 360 : 360;
      const s = svg ? new XMLSerializer().serializeToString(svg).replace(/^<svg([^>]*)>/, `<svg$1 width="${w}" height="${h}"><style>text{font-family:'Malgun Gothic',sans-serif}</style>`) : '';
      el.remove();
      const pic = s ? await picture(await svgMedia(s, w, h), Math.min(b.w, w), c.title ?? '그래프') : '';
      const xs = chartCategories(c);
      return [...(c.title ? [plain(c.title)] : []), pic || gridXml(['', ...c.series.map((x) => x.name)], xs.map((x) => [x, ...c.series.map((s2) => { const p = s2.points.find((q) => String(q.x) === x); return p ? String(p.y) : '—'; })]), b.w, maxTw)];
    }
    if (isInkContent(c)) { const p = inkPaths(engine, c.id); return p?.paths.length ? [await picture(await svgMedia(inkSvgString(p), p.w, p.h), Math.min(b.w, p.w), '손글씨')] : []; }
    if (isDatabaseContent(c)) {
      const props = c.properties.filter((p) => !p.hidden);
      return [plain(c.title || '데이터베이스'), gridXml(props.map((p) => p.name), dbRows(c).map((r) => props.map((p) => dbCellTextIn(engine, c, r, p))), b.w, maxTw)];
    }
    if (isDividerContent(c)) return c.orient === 'v' ? [] : [`<w:p>${pPrXml({ bdr: 'bottom', jc: 'center' })}${c.label ? `<w:r><w:t xml:space="preserve">${esc(c.label)}</w:t></w:r>` : ''}</w:p>`]; // 구분선 → 아래 테두리 문단
    if (isTabsContent(c)) return c.tabs.flatMap((t) => [plain(t.label, 'SectionHead'), ...textToOoxml(t.doc, ctx, look)]); // 탭: 모든 탭을 차례로
    if (isTocContent(c)) {
      const es = tocEntries(engine, c.depth);
      const top = es.length ? Math.min(...es.map((e) => e.level)) : 1;
      return es.length ? [plain('목차', 'SectionHead'), ...es.map((e) => `<w:p>${pPrXml({ ind: { left: (e.level - top) * 360 }, spacing: { after: 40 } })}<w:r><w:t xml:space="preserve">${esc(e.text)}</w:t></w:r></w:p>`)] : [];
    }
    if (isWebContent(c)) {
      if (!c.url) return [];
      const t = c.view === 'embed' ? embedTarget(c.url) : null;
      const label = `${t ? `${t.provider}: ` : ''}${c.title || c.url}`;
      return [`<w:p><w:hyperlink r:id="${ctx.link(c.url)}" w:history="1"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr><w:t xml:space="preserve">${esc(label)}</w:t></w:r></w:hyperlink></w:p>`, ...(c.description ? [plain(c.description, 'Quote')] : [])];
    }
    if (isFileContent(c)) return [plain(`첨부 파일: ${c.name}`)];
    if (isEmbedContent(c)) { const t = host.noteTitle(c.srcNote); return [plain(`임베드한 블록 — 원본: ${t ?? '없는 노트'}`, 'Quote')]; }
    return [];
  }

  // 표가 이어지면 워드가 하나로 붙인다 — 사이 · 끝에 빈 문단
  const doc: string[] = [];
  for (const x of body) { if (x.startsWith('<w:tbl>') && doc.at(-1)?.startsWith('<w:tbl>')) doc.push('<w:p/>'); doc.push(x); }
  if (!doc.length || doc.at(-1)!.startsWith('<w:tbl>')) doc.push('<w:p/>');

  // 쪽 설정: 종이 · 여백 · 머리글 · 바닥글 · 쪽 번호
  const parts: ZipEntry[] = [];
  const overrides = [{ path: 'word/document.xml', type: CT.doc }, { path: 'word/styles.xml', type: CT.styles }, { path: 'word/settings.xml', type: CT.settings }, { path: 'word/numbering.xml', type: CT.numbering }, { path: 'word/footnotes.xml', type: CT.footnotes }, { path: 'docProps/core.xml', type: CT.core }];
  const land = !!ps?.landscape, m = PAGE_MARGINS[ps?.margin ?? 'normal'] ?? PAGE_MARGINS.normal;
  const textW = (land ? A4_TW.h : A4_TW.w) - px2tw(m.l) - px2tw(m.r);
  const pos = opts.pageNumbers ? ps?.numbers ?? 'bottom-center' : 'none';
  const date = new Date().toLocaleDateString('ko-KR');
  const line = (tpl: string | undefined, num: 'center' | 'right' | null) => {
    const field = (instr: string) => `<w:fldSimple w:instr=" ${instr} "><w:r><w:t>1</w:t></w:r></w:fldSimple>`;
    const text = (tpl ?? '').split(/(\{쪽\}|\{전체 쪽\}|\{page\}|\{pages\})/).map((s) => (/^\{(쪽|page)\}$/.test(s) ? field('PAGE') : /^\{(전체 쪽|pages)\}$/.test(s) ? field('NUMPAGES') : s ? `<w:r><w:t xml:space="preserve">${esc(s.replace(/\{(제목|title)\}/g, title).replace(/\{(날짜|date)\}/g, date))}</w:t></w:r>` : '')).join('');
    const tab = '<w:r><w:tab/></w:r>';
    return `<w:p><w:pPr><w:pStyle w:val="Header"/><w:tabs><w:tab w:val="center" w:pos="${Math.round(textW / 2)}"/><w:tab w:val="right" w:pos="${textW}"/></w:tabs></w:pPr>${text}${num ? tab + (num === 'right' ? tab : '') + field('PAGE') : ''}</w:p>`;
  };
  const hf: string[] = [];
  const addHF = (kind: 'header' | 'footer', inner: string) => {
    const path = `word/${kind}1.xml`, tag = kind === 'header' ? 'hdr' : 'ftr';
    parts.push({ path, data: `${HEAD}<w:${tag} ${NS}>${inner}</w:${tag}>` });
    overrides.push({ path, type: CT[kind] });
    hf.push(`<w:${kind}Reference w:type="default" r:id="${rel(REL[kind], `${kind}1.xml`)}"/>`);
  };
  if (ps?.header || pos === 'top-right') addHF('header', line(ps?.header, pos === 'top-right' ? 'right' : null));
  if (ps?.footer || pos === 'bottom-center' || pos === 'bottom-right') addHF('footer', line(ps?.footer, pos === 'bottom-center' ? 'center' : pos === 'bottom-right' ? 'right' : null));
  const sect = `<w:sectPr>${hf.join('')}<w:pgSz w:w="${land ? A4_TW.h : A4_TW.w}" w:h="${land ? A4_TW.w : A4_TW.h}"${land ? ' w:orient="landscape"' : ''}/>`
    + `<w:pgMar w:top="${px2tw(g.t)}" w:right="${px2tw(g.r)}" w:bottom="${px2tw(g.b)}" w:left="${px2tw(g.l)}" w:header="567" w:footer="567" w:gutter="0"/>${ps?.skipFirst && hf.length ? '<w:titlePg/>' : ''}</w:sectPr>`;

  const now = new Date();
  parts.push(
    { path: 'word/document.xml', data: `${HEAD}<w:document ${NS}><w:body>${doc.join('')}${sect}</w:body></w:document>` },
    { path: 'word/styles.xml', data: stylesXml(!!engine.note.headingNumbers) },
    { path: 'word/settings.xml', data: settingsXml() },
    { path: 'word/numbering.xml', data: numberingXml(ordered, !!engine.note.headingNumbers) },
    { path: 'word/footnotes.xml', data: footnotesXml(notes) },
    { path: 'word/_rels/document.xml.rels', data: relsXml(rels) },
    { path: 'docProps/core.xml', data: coreXml(title, now, now) },
    ...media.map((x) => ({ path: `word/media/${x.name}`, data: x.m.data })),
  );
  return zip([
    { path: '[Content_Types].xml', data: contentTypesXml(overrides, media.map((x) => x.m.ext)) },
    { path: '_rels/.rels', data: relsXml([{ id: 'rId1', type: REL.doc, target: 'word/document.xml' }, { id: 'rId2', type: REL.core, target: 'docProps/core.xml' }]) },
    ...parts,
  ]);
}
