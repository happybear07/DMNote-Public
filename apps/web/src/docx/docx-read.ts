// 워드 문서(.docx) 읽기: document.xml을 차례대로 "조각"으로 — 글(문단들 → 글 상자 문서) · 표 · 그림.
// 스타일(제목 · 인용 · 코드 · 캡션 · 문서 제목) · 번호 매기기(글머리 · 번호 · 단계) · 글자 꾸밈 · 링크 · 각주 · 수식 · 쪽 나눔을 옮긴다.
// 문단 맞춤이 바뀌거나 쪽이 나뉘면 글 상자를 나눈다(상자 하나에 맞춤 하나). 만들기는 docx-import.ts.
import type { TextMark, TextNode } from '@dn/engine-core';
import { at, kid, kids, readTable, type DocxTable } from './docx-read-table';

export type Piece =
  | { kind: 'text'; nodes: TextNode[]; align?: 'center' | 'right' | 'justify'; pageBreak?: boolean }
  | { kind: 'table'; table: DocxTable; caption?: string; pageBreak?: boolean }
  | { kind: 'image'; path: string; alt: string; w: number; h: number; caption?: string; pageBreak?: boolean };

export interface DocxParts {
  doc: Document; styles: Document | null; numbering: Document | null; footnotes: Document | null;
  /** 관계 id → 대상 (word/ 기준 경로 · 바깥 주소) */
  rels: ReadonlyMap<string, string>;
}

const on = (el: Element | null) => !!el && !/^(0|false|off|none)$/i.test(at(el, 'val') ?? '');

interface StyleInfo { listDepth?: number; heading?: number; title?: boolean; quote?: boolean; code?: boolean; caption?: boolean; num?: { id: string; lvl?: number }; sz?: number; basedOn?: string }
/** text: 번호 글 모양 ('%1.' · '%1.%2.') — 안쪽 단계가 바깥 번호를 이으면 다단계(1.1.) */
interface ListLvl { fmt: string; start: number; text: string }

export class DocxReader {
  private readonly styles = new Map<string, StyleInfo>();
  private readonly lists = new Map<string, ListLvl[]>();
  /** 번호 단계에 묶인 스타일 (워드 '글머리 기호 목록 2' 같은 것) → 단계 */
  private readonly styleLvl = new Map<string, number>();
  private readonly notes = new Map<string, string>();
  private defaultSz = 22;
  title: string | null = null;
  /** 제목에 번호가 매겨져 있다 (워드 '제목에 연결된 다단계 목록') → 노트 제목 번호 */
  headingNumbers = false;
  readonly stats = { tables: 0, images: 0, footnotes: 0, skipped: 0 };

  constructor(private readonly p: DocxParts) {
    this.readStyles();
    this.readNumbering();
    for (const f of [...(p.footnotes?.documentElement.children ?? [])]) {
      const id = at(f, 'id');
      if (id && Number(id) > 0) this.notes.set(id, [...f.getElementsByTagNameNS('*', 't')].map((t) => t.textContent ?? '').join('').trim());
    }
  }

  private readStyles(): void {
    const root = this.p.styles?.documentElement;
    const dsz = root?.querySelector('docDefaults rPrDefault sz');
    if (dsz) this.defaultSz = Number(at(dsz, 'val')) || 22;
    for (const s of kids(root, 'style')) {
      const id = at(s, 'styleId'), name = (at(kid(s, 'name'), 'val') ?? '').toLowerCase();
      if (!id) continue;
      const ppr = kid(s, 'pPr'), rpr = kid(s, 'rPr');
      const hm = /^heading (\d)$/.exec(name), ol = at(kid(ppr, 'outlineLvl'), 'val');
      const np = kid(ppr, 'numPr');
      this.styles.set(id, {
        ...(hm ? { heading: Number(hm[1]) } : ol != null && Number(ol) < 9 ? { heading: Number(ol) + 1 } : {}),
        // 워드 기본 '목록 · 글머리 기호 목록 · 번호 매기기 목록 2~5' — 한국어판은 단계마다 번호 매기기를 따로 둬서 이름으로 단계를 안다
        ...(/^list(?: bullet| number| continue)? ([2-9])$/.exec(name) ? { listDepth: Number(/([2-9])$/.exec(name)![1]) - 1 } : {}),
        ...(name === 'title' ? { title: true } : {}),
        ...(/quote/.test(name) ? { quote: true } : {}),
        ...(/^(code|html preformatted|macro text|source code)/.test(name) || id === 'Code' ? { code: true } : {}),
        ...(name === 'caption' ? { caption: true } : {}),
        ...(np && at(kid(np, 'numId'), 'val') ? { num: { id: at(kid(np, 'numId'), 'val')!, ...(at(kid(np, 'ilvl'), 'val') != null ? { lvl: Number(at(kid(np, 'ilvl'), 'val')) } : {}) } } : {}),
        ...(at(kid(rpr, 'sz'), 'val') ? { sz: Number(at(kid(rpr, 'sz'), 'val')) } : {}),
        ...(at(kid(s, 'basedOn'), 'val') ? { basedOn: at(kid(s, 'basedOn'), 'val')! } : {}),
      });
    }
  }

  /** 스타일 (바탕 스타일까지 거슬러) */
  private style(id: string | null): StyleInfo {
    const out: StyleInfo = {};
    for (let s = id ? this.styles.get(id) : undefined, n = 0; s && n < 8; s = s.basedOn ? this.styles.get(s.basedOn) : undefined, n++) {
      for (const [k, v] of Object.entries(s)) if (k !== 'basedOn' && !(k in out)) (out as Record<string, unknown>)[k] = v;
    }
    return out;
  }

  private readNumbering(): void {
    const root = this.p.numbering?.documentElement;
    const abs = new Map<string, ListLvl[]>();
    for (const a of kids(root, 'abstractNum')) {
      abs.set(at(a, 'abstractNumId') ?? '', kids(a, 'lvl').map((l) => ({ fmt: at(kid(l, 'numFmt'), 'val') ?? 'decimal', start: Number(at(kid(l, 'start'), 'val') ?? 1), text: at(kid(l, 'lvlText'), 'val') ?? '' })));
      for (const l of kids(a, 'lvl')) { const ps = at(kid(l, 'pStyle'), 'val'); if (ps) this.styleLvl.set(ps, Number(at(l, 'ilvl') ?? 0)); }
    }
    for (const n of kids(root, 'num')) {
      const lv = [...(abs.get(at(kid(n, 'abstractNumId'), 'val') ?? '') ?? [])];
      for (const o of kids(n, 'lvlOverride')) { const i = Number(at(o, 'ilvl') ?? 0), so = at(kid(o, 'startOverride'), 'val'); if (so && lv[i]) lv[i] = { ...lv[i]!, start: Number(so) }; }
      this.lists.set(at(n, 'numId') ?? '', lv);
    }
  }

  /** 본문 → 조각들 */
  read(): Piece[] {
    const body = kid(this.p.doc.documentElement, 'body');
    const out: Piece[] = [];
    let flat: Flat[] = [], align: 'center' | 'right' | 'justify' | undefined, brk = false, caption: string | null = null;
    const flush = () => {
      // 앞뒤 빈 문단은 뺀다 (표 뒤에 워드가 두는 빈 문단 · 빈 줄로 띄운 것)
      const blank = (f: Flat) => f.node.type === 'paragraph' && !f.list && !f.node.content?.length;
      while (flat.length && blank(flat[0]!)) flat.shift();
      while (flat.length && blank(flat.at(-1)!)) flat.pop();
      const nodes = assemble(flat);
      if (nodes.length) out.push({ kind: 'text', nodes, ...(align ? { align } : {}), ...(brk ? { pageBreak: true } : {}) });
      if (nodes.length) brk = false;
      flat = [];
    };
    const visit = (els: Element[]) => {
      for (const el of els) {
        if (el.localName === 'sdt') { visit([...(kid(el, 'sdtContent')?.children ?? [])]); continue; } // 목차 · 콘텐츠 칸
        if (el.localName === 'tbl') {
          flush();
          const table = readTable(el, (p) => this.cellParagraph(p));
          this.stats.tables++;
          out.push({ kind: 'table', table, ...(caption ? { caption } : {}), ...(brk ? { pageBreak: true } : {}) });
          brk = false; caption = null;
          continue;
        }
        if (el.localName !== 'p') continue;
        const p = this.paragraph(el);
        if (p.title && !this.title && p.text) { this.title = p.text; continue; }
        if (p.caption && p.text) {
          // 캡션: '그림 N. …'은 바로 앞 그림에(아래 캡션), '표 N. …'은 다음 표에(위 캡션) — 아니면 글로
          const m = /^(그림|표|figure|table)\s*\d*\s*[.:]?\s*(.*)$/i.exec(p.text);
          const last = out.at(-1), fig = !m || /^(그림|figure)/i.test(m[1]!);
          if (fig && !flat.length && last?.kind === 'image' && !last.caption) { last.caption = (m?.[2] ?? p.text).trim(); continue; }
          if (m && !fig) { flush(); caption = m[2]!.trim(); continue; }
        }
        caption = null;
        if (p.pageBreak || p.align !== align) { flush(); align = p.align; if (p.pageBreak) brk = true; }
        if (p.flat) flat.push(p.flat);
        for (const img of p.images) { flush(); out.push({ ...img, ...(brk ? { pageBreak: true } : {}) }); brk = false; }
      }
    };
    visit([...(body?.children ?? [])]);
    flush();
    return out;
  }

  /** 문단 하나 → 평평한 항목(목록 · 인용 · 코드 표시) + 안에 든 그림 */
  private paragraph(el: Element): { flat: Flat | null; images: Extract<Piece, { kind: 'image' }>[]; text: string; title: boolean; caption: boolean; pageBreak: boolean; align: 'center' | 'right' | 'justify' | undefined } {
    const ppr = kid(el, 'pPr'), np = kid(ppr, 'numPr'), sid = at(kid(ppr, 'pStyle'), 'val'), nid = at(kid(np, 'numId'), 'val');
    const st = this.style(sid);
    const own = nid && nid !== '0' ? { id: nid, lvl: at(kid(np, 'ilvl'), 'val') } : null;
    // 단계: 문단에 적힌 것 → 스타일에 적힌 것 → 번호 단계에 묶인 스타일
    const ilvl = own?.lvl != null ? Number(own.lvl) : st.num?.lvl ?? (sid ? this.styleLvl.get(sid) : undefined) ?? 0;
    // ilvl: 번호 매기기 정의의 단계(번호 모양) · lvl: 보이는 단계(목록 안 목록)
    const num = own || st.num ? { id: own?.id ?? st.num!.id, ilvl, lvl: Math.max(st.listDepth ?? 0, ilvl) } : undefined;
    const jc = at(kid(ppr, 'jc'), 'val');
    const align = jc === 'center' ? 'center' : jc === 'right' || jc === 'end' ? 'right' : jc === 'both' || jc === 'distribute' ? 'justify' : undefined;
    const ctx = { sz: st.sz ?? this.defaultSz, heading: !!st.heading || !!st.title, pageBreak: on(kid(ppr, 'pageBreakBefore')), images: [] as Extract<Piece, { kind: 'image' }>[] };
    const inline = this.inlines([...el.children].filter((c) => c.localName !== 'pPr'), ctx, []);
    const text = inline.map((n) => n.text ?? '').join('').trim();
    const ol = at(kid(ppr, 'outlineLvl'), 'val');
    const heading = st.heading ?? (ol != null && Number(ol) < 9 ? Number(ol) + 1 : undefined);
    const hr = !text && !!kid(kid(ppr, 'pBdr'), 'bottom') && !ctx.images.length;
    let node: TextNode | null = hr ? { type: 'horizontal_rule' } as TextNode
      : (heading || st.title) && text ? { type: 'heading', attrs: { level: Math.min(4, heading ?? 1) }, content: inline } as TextNode
      : { type: 'paragraph', ...(inline.length ? { content: inline } : {}) } as TextNode;
    if (!text && !hr && !inline.length && ctx.images.length) node = null; // 그림만 든 문단
    if (node?.type === 'heading' && num && this.lists.get(num.id)?.[num.ilvl]?.fmt !== 'none') this.headingNumbers = true;
    let list: Flat['list'];
    if (num && node?.type === 'paragraph') {
      const lv = this.lists.get(num.id)?.[num.ilvl] ?? { fmt: 'decimal', start: 1 };
      const box = /^\s*([☐☑☒])\s?/.exec(text);
      if (box) {
        const strip = (ns: TextNode[]): TextNode[] => { const [f, ...r] = ns; return f?.type === 'text' ? [...(f.text!.replace(/^\s*[☐☑☒]\s?/, '') ? [{ ...f, text: f.text!.replace(/^\s*[☐☑☒]\s?/, '') }] : []), ...r] : ns; };
        node = { type: 'paragraph', content: strip(inline) } as TextNode;
        if (!node.content?.length) delete (node as { content?: unknown }).content;
      }
      const outline = (this.lists.get(num.id) ?? []).some((l, i) => i > 0 && /%\d\.%\d/.test(l.text));
      list = { kind: box ? 'task' : lv.fmt === 'bullet' || lv.fmt === 'none' ? 'bullet' : 'ordered', lvl: Math.min(8, num.lvl), start: lv.start, key: num.id, ...(box ? { checked: box[1] !== '☐' } : {}), ...(outline ? { outline } : {}) };
    } else if (!num && node?.type === 'paragraph' && /^\s*[☐☑☒]\s/.test(text)) {
      const f = inline[0];
      if (f?.type === 'text') inline[0] = { ...f, text: f.text!.replace(/^\s*[☐☑☒]\s/, '') };
      list = { kind: 'task', lvl: 0, start: 1, key: 'task', checked: !/^\s*☐/.test(text) };
    }
    const shd = at(kid(ppr, 'shd'), 'fill');
    const flat: Flat | null = node ? { node, ...(list ? { list } : {}), ...(st.quote ? { quote: true } : {}), ...(st.code ? { code: true } : {}), ...(shd && !/^(auto|ffffff)$/i.test(shd) && !st.code ? { shd: `#${shd.toLowerCase()}` } : {}) } : null;
    return { flat, images: ctx.images, text, title: !!st.title, caption: !!st.caption, pageBreak: ctx.pageBreak, align };
  }

  /** 표 칸 문단 → 노드 (목록 · 그림은 글만) */
  private cellParagraph(el: Element): TextNode | null {
    const p = this.paragraph(el);
    return p.flat?.node ?? (p.images.length ? { type: 'paragraph', content: [{ type: 'text', text: '[그림]' }] } as TextNode : null);
  }

  /** 줄 안 요소들 → 글 노드 (글자 꾸밈 · 링크 · 각주 · 수식 · 줄바꿈) */
  private inlines(els: Element[], ctx: { sz: number; heading: boolean; pageBreak: boolean; images: Extract<Piece, { kind: 'image' }>[] }, linkMarks: TextNode['marks']): TextNode[] {
    const out: TextNode[] = [];
    const push = (n: TextNode) => {
      const last = out.at(-1);
      if (n.type === 'text' && last?.type === 'text' && JSON.stringify(last.marks ?? []) === JSON.stringify(n.marks ?? [])) out[out.length - 1] = { ...last, text: last.text! + n.text! };
      else if (n.type !== 'text' || n.text) out.push(n);
    };
    for (const el of els) {
      switch (el.localName) {
        case 'r': this.run(el, ctx, linkMarks ?? []).forEach(push); break;
        case 'hyperlink': {
          const href = this.p.rels.get(at(el, 'id') ?? '');
          const marks = href && /^(https?:|mailto:)/i.test(href) ? [...(linkMarks ?? []), { type: 'link', attrs: { href } }] : linkMarks;
          this.inlines([...el.children], ctx, marks).forEach(push);
          break;
        }
        case 'ins': case 'smartTag': case 'fldSimple': case 'customXml': this.inlines([...el.children], ctx, linkMarks).forEach(push); break;
        case 'sdt': this.inlines([...(kid(el, 'sdtContent')?.children ?? [])], ctx, linkMarks).forEach(push); break;
        case 'oMath': case 'oMathPara': {
          const tex = [...el.getElementsByTagNameNS('*', 't')].map((t) => t.textContent ?? '').join('').trim();
          if (tex) push({ type: 'math_inline', attrs: { tex } } as TextNode);
          break;
        }
      }
    }
    return out;
  }

  private run(r: Element, ctx: { sz: number; heading: boolean; pageBreak: boolean; images: Extract<Piece, { kind: 'image' }>[] }, base: NonNullable<TextNode['marks']>): TextNode[] {
    const rpr = kid(r, 'rPr');
    const marks: TextMark[] = [...base];
    if (!ctx.heading && on(kid(rpr, 'b'))) marks.push({ type: 'strong' });
    if (on(kid(rpr, 'i'))) marks.push({ type: 'em' });
    if (kid(rpr, 'u') && on(kid(rpr, 'u')) && !base.some((m) => m.type === 'link')) marks.push({ type: 'underline' });
    if (on(kid(rpr, 'strike')) || on(kid(rpr, 'dstrike'))) marks.push({ type: 'strike' });
    const va = at(kid(rpr, 'vertAlign'), 'val');
    if (va === 'superscript') marks.push({ type: 'sup' }); else if (va === 'subscript') marks.push({ type: 'sub' });
    const color = at(kid(rpr, 'color'), 'val');
    if (color && /^[0-9a-f]{6}$/i.test(color) && !/^0{6}$/.test(color) && !base.some((m) => m.type === 'link')) marks.push({ type: 'textColor', attrs: { color: `#${color.toLowerCase()}` } });
    const hl = at(kid(rpr, 'highlight'), 'val'), fill = at(kid(rpr, 'shd'), 'fill');
    if (hl && hl !== 'none') marks.push({ type: 'highlight', attrs: { color: HIGHLIGHT[hl] ?? '' } });
    else if (fill && /^[0-9a-f]{6}$/i.test(fill) && !/^ffffff$/i.test(fill)) marks.push({ type: 'highlight', attrs: { color: `#${fill.toLowerCase()}` } });
    const font = (at(kid(rpr, 'rFonts'), 'ascii') ?? at(kid(rpr, 'rFonts'), 'eastAsia') ?? '').toLowerCase();
    if (/consolas|courier|mono|d2coding|굴림체|바탕체|menlo|source code/.test(font)) marks.push({ type: 'fontFamily', attrs: { family: 'mono' } });
    else if (/batang|바탕|times|georgia|myeongjo|명조|serif|cambria$/.test(font)) marks.push({ type: 'fontFamily', attrs: { family: 'serif' } });
    const sz = Number(at(kid(rpr, 'sz'), 'val'));
    if (sz && !ctx.heading && Math.abs(sz / ctx.sz - 1) > 0.1) marks.push({ type: 'fontSize', attrs: { scale: Math.min(4, Math.max(0.5, Math.round((sz / ctx.sz) * 100) / 100)) } });
    const m = marks.length ? { marks } : {};
    const out: TextNode[] = [];
    for (const c of r.children) {
      switch (c.localName) {
        case 't': out.push({ type: 'text', text: c.textContent ?? '', ...m } as TextNode); break;
        case 'tab': out.push({ type: 'text', text: '\t', ...m } as TextNode); break;
        case 'noBreakHyphen': out.push({ type: 'text', text: '-', ...m } as TextNode); break;
        case 'sym': { const ch = parseInt(at(c, 'char') ?? '', 16); if (ch) out.push({ type: 'text', text: String.fromCodePoint(ch >= 0xf000 ? ch - 0xf000 : ch), ...m } as TextNode); break; }
        case 'br': case 'cr': if (at(c, 'type') === 'page') ctx.pageBreak = true; else out.push({ type: 'hard_break' } as TextNode); break;
        case 'footnoteReference': { const note = this.notes.get(at(c, 'id') ?? ''); if (note != null) { out.push({ type: 'footnote', attrs: { note } } as TextNode); this.stats.footnotes++; } break; }
        case 'drawing': case 'pict': {
          const blip = c.getElementsByTagNameNS('*', 'blip')[0] ?? c.getElementsByTagNameNS('*', 'imagedata')[0];
          const target = this.p.rels.get(at(blip, 'embed') ?? at(blip, 'id') ?? '');
          const ext = c.getElementsByTagNameNS('*', 'extent')[0];
          const doc = c.getElementsByTagNameNS('*', 'docPr')[0];
          if (target && !/^https?:/i.test(target)) {
            ctx.images.push({ kind: 'image', path: target, alt: at(doc, 'descr') ?? at(doc, 'title') ?? '', w: ext ? Math.round(Number(at(ext, 'cx')) / 9525) : 0, h: ext ? Math.round(Number(at(ext, 'cy')) / 9525) : 0 });
            this.stats.images++;
          } else this.stats.skipped++;
          break;
        }
      }
    }
    return out;
  }
}

/** 워드 형광펜 이름 → 앱 배경 색 이름 (노랑은 기본 형광) */
const HIGHLIGHT: Record<string, string> = { yellow: '', green: 'green', cyan: 'blue', blue: 'blue', magenta: 'pink', red: 'red', darkYellow: 'orange', lightGray: 'gray', darkGray: 'gray', darkMagenta: 'purple' };

// ───────── 평평한 문단 → 목록 · 인용 · 코드 · 콜아웃으로 묶기 ─────────

interface Flat {
  node: TextNode;
  list?: { kind: 'bullet' | 'ordered' | 'task'; lvl: number; start: number; key: string; checked?: boolean; outline?: boolean };
  quote?: boolean; code?: boolean; shd?: string;
}

const LIST_TYPE = { bullet: ['bullet_list', 'list_item'], ordered: ['ordered_list', 'list_item'], task: ['task_list', 'task_item'] } as const;

function listOf(flat: Flat[], i: number, lvl: number): [TextNode, number] {
  const kind = flat[i]!.list!.kind, start = flat[i]!.list!.start, outline = !!flat[i]!.list!.outline, [lt, it] = LIST_TYPE[kind];
  const items: TextNode[] = [];
  while (i < flat.length) {
    const f = flat[i]!;
    if (!f.list || f.list.lvl < lvl || f.quote || f.code) break;
    if (f.list.lvl > lvl && items.length) { const [sub, j] = listOf(flat, i, f.list.lvl); (items.at(-1)!.content as TextNode[]).push(sub); i = j; continue; }
    if (f.list.kind !== kind) break;
    items.push({ type: it, ...(kind === 'task' ? { attrs: { checked: !!f.list.checked } } : {}), content: [f.node] } as TextNode);
    i++;
  }
  return [{ type: lt, ...(kind === 'ordered' && (start !== 1 || outline) ? { attrs: { order: start, ...(outline ? { nums: 'outline' } : {}) } } : {}), content: items } as TextNode, i];
}

/** 평평한 항목들 → 글 상자 문서의 블록 노드들 */
function assemble(flat: Flat[]): TextNode[] {
  const out: TextNode[] = [];
  for (let i = 0; i < flat.length;) {
    const f = flat[i]!;
    if (f.code) {
      const lines: string[] = [];
      while (i < flat.length && flat[i]!.code) { lines.push((flat[i]!.node.content ?? []).map((n) => n.text ?? '').join('')); i++; }
      out.push({ type: 'code_block', attrs: { language: '' }, ...(lines.join('\n') ? { content: [{ type: 'text', text: lines.join('\n') }] } : {}) } as TextNode);
    } else if (f.quote) {
      const inner: Flat[] = [];
      while (i < flat.length && flat[i]!.quote) inner.push({ ...flat[i]!, quote: false }), i++;
      out.push({ type: 'blockquote', content: assemble(inner) } as TextNode);
    } else if (f.shd && !f.list) {
      const inner: Flat[] = [];
      while (i < flat.length && flat[i]!.shd === f.shd && !flat[i]!.list) inner.push({ ...flat[i]!, shd: undefined }), i++;
      out.push({ type: 'callout', attrs: { icon: 'bulb', color: nearestBg(f.shd) }, content: assemble(inner) } as TextNode);
    } else if (f.list) {
      const [list, j] = listOf(flat, i, f.list.lvl);
      out.push(list);
      i = j === i ? i + 1 : j;
    } else { out.push(f.node); i++; }
  }
  return out;
}

/** 칠한 색 → 가까운 콜아웃 색 이름 */
const BG: Record<string, [number, number, number]> = { gray: [241, 241, 239], brown: [244, 238, 238], orange: [251, 236, 221], yellow: [251, 243, 219], green: [237, 243, 236], blue: [231, 243, 248], purple: [244, 240, 247], pink: [249, 238, 243], red: [253, 235, 236] };
function nearestBg(hex: string): string {
  const v = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));
  let best = 'yellow', d = Infinity;
  for (const [name, c] of Object.entries(BG)) { const x = c.reduce((s, n, k) => s + (n - v[k]!) ** 2, 0); if (x < d) { d = x; best = name; } }
  return best;
}

export type { DocxTable };
