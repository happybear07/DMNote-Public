// 글 상자 문서(ProseMirror JSON) → 워드 문단(w:p): 제목 · 목록 · 할 일 · 인용 · 코드 · 콜아웃 · 구분선 · 수식 · 각주 · 링크 · 글자 꾸밈.
// 워드는 pPr · rPr 안 요소 차례를 따지므로(어긋나면 '읽을 수 없는 내용') 구조로 모아 정한 차례로 쓴다.
import type { TextNode } from '@dn/engine-core';
import { mediaClock, ratingStars, BG_COLOR_HEX, TEXT_COLOR_HEX } from '@dn/text-pm';
import { BODY_SZ, esc, rFonts } from './ooxml';

export interface PPr {
  style?: string; pageBreakBefore?: boolean; num?: { id: number; lvl: number };
  bdr?: 'bottom'; shd?: string;
  spacing?: { before?: number; after?: number; line?: number };
  ind?: { left?: number; firstLineChars?: number; hangingChars?: number };
  jc?: 'center' | 'right' | 'both';
}
export interface RPr {
  style?: string; font?: 'serif' | 'mono'; b?: boolean; i?: boolean; strike?: boolean; color?: string;
  sz?: number; highlight?: boolean; u?: boolean; shd?: string; vert?: 'superscript' | 'subscript';
}

export function pPrXml(p: PPr): string {
  const s = p.spacing, ind = p.ind;
  const x = [
    p.style && `<w:pStyle w:val="${p.style}"/>`,
    p.pageBreakBefore && '<w:pageBreakBefore/>',
    p.num && `<w:numPr><w:ilvl w:val="${p.num.lvl}"/><w:numId w:val="${p.num.id}"/></w:numPr>`,
    p.bdr && '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="D0D0CC"/></w:pBdr>',
    p.shd && `<w:shd w:val="clear" w:color="auto" w:fill="${p.shd}"/>`,
    s && (s.before != null || s.after != null || s.line != null) && `<w:spacing${s.before != null ? ` w:before="${s.before}"` : ''}${s.after != null ? ` w:after="${s.after}"` : ''}${s.line != null ? ` w:line="${s.line}" w:lineRule="auto"` : ''}/>`,
    ind && (ind.left || ind.firstLineChars || ind.hangingChars) && `<w:ind${ind.left ? ` w:left="${ind.left}"` : ''}${ind.firstLineChars ? ` w:firstLineChars="${ind.firstLineChars}"` : ''}${ind.hangingChars ? ` w:hangingChars="${ind.hangingChars}"` : ''}/>`,
    p.jc && `<w:jc w:val="${p.jc}"/>`,
  ].filter(Boolean).join('');
  return x ? `<w:pPr>${x}</w:pPr>` : '';
}

function rPrXml(r: RPr): string {
  const x = [
    r.style && `<w:rStyle w:val="${r.style}"/>`, r.font && rFonts(r.font), r.b && '<w:b/><w:bCs/>', r.i && '<w:i/><w:iCs/>', r.strike && '<w:strike/>',
    r.color && `<w:color w:val="${r.color}"/>`, r.sz && `<w:sz w:val="${r.sz}"/><w:szCs w:val="${r.sz}"/>`, r.highlight && '<w:highlight w:val="yellow"/>',
    r.u && '<w:u w:val="single"/>', r.shd && `<w:shd w:val="clear" w:color="auto" w:fill="${r.shd}"/>`, r.vert && `<w:vertAlign w:val="${r.vert}"/>`,
  ].filter(Boolean).join('');
  return x ? `<w:rPr>${x}</w:rPr>` : '';
}

/** 색 이름 · #rrggbb → 워드 색 (모르면 없음) */
export const hexOf = (c: unknown, table: Readonly<Record<string, string>>): string | undefined => {
  const s = typeof c === 'string' ? c : '';
  const h = table[s] ?? (/^#[0-9a-f]{6}$/i.test(s) ? s : '');
  return h ? h.slice(1).toUpperCase() : undefined;
};

/** 내보내기 동안 모으는 것 — 링크 관계 · 각주 · 번호 목록 · 상호 참조 */
export interface DocxCtx {
  link(href: string): string;
  footnote(text: string): number;
  orderedList(start: number, outline?: boolean): number;
  noteTitle(id: string): string | null;
  xref(id: string): string | null;
}
/** 상자(블록) 하나의 꾸밈 — 그 상자 문단마다 */
export interface Look { p: PPr; r: RPr; scale: number }
const PLAIN: Look = { p: {}, r: {}, scale: 1 };

const STYLE_SZ: Record<string, number> = { Title: 48, Heading1: 36, Heading2: 30, Heading3: 26, Heading4: 23, Code: 19 };
const BULLETS_ID = 1;
/** olNum: 다단계 번호 목록 안 — 안쪽 번호 목록도 이 num을 단계만 내려 쓴다 */
type State = { quote?: boolean; shd?: string; depth: number; indent?: number; title?: boolean; olNum?: number };

function runs(nodes: readonly TextNode[] | undefined, ctx: DocxCtx, look: Look, style: string | undefined): string {
  const base = STYLE_SZ[style ?? ''] ?? BODY_SZ;
  const out: string[] = [];
  let link: { href: string; buf: string[] } | null = null;
  const flush = () => { if (link) { out.push(`<w:hyperlink r:id="${ctx.link(link.href)}" w:history="1">${link.buf.join('')}</w:hyperlink>`); link = null; } };
  for (const n of nodes ?? []) {
    const r: RPr = { ...look.r };
    let scale = look.scale, href: string | null = null;
    for (const m of n.marks ?? []) {
      const a = (m.attrs ?? {}) as Record<string, unknown>;
      switch (m.type) {
        case 'strong': r.b = true; break;
        case 'em': r.i = true; break;
        case 'underline': r.u = true; break;
        case 'strike': r.strike = true; break;
        case 'sup': r.vert = 'superscript'; break;
        case 'sub': r.vert = 'subscript'; break;
        case 'code': r.font = 'mono'; r.shd = 'F2F1EE'; break;
        case 'highlight': { const h = hexOf(a.color, BG_COLOR_HEX); if (h) r.shd = h; else r.highlight = true; break; }
        case 'chip': r.shd = hexOf(a.color, BG_COLOR_HEX) ?? 'EFEFED'; break; // 칩 → 옅은 바탕 글자
        case 'textColor': r.color = hexOf(a.color, TEXT_COLOR_HEX) ?? r.color; break;
        case 'fontSize': scale *= Number(a.scale) || 1; break;
        case 'fontFamily': if (a.family === 'serif' || a.family === 'mono') r.font = a.family; break;
        case 'link': href = typeof a.href === 'string' ? a.href : null; break;
      }
    }
    if (scale !== 1) r.sz = Math.max(2, Math.round(base * scale));
    if (href) r.style = 'Hyperlink';
    const a = (n.attrs ?? {}) as Record<string, unknown>;
    let x: string;
    const t = (s: string) => `<w:r>${rPrXml(r)}<w:t xml:space="preserve">${esc(s)}</w:t></w:r>`;
    if (n.type === 'text') x = t(n.text ?? '');
    else if (n.type === 'hard_break') x = '<w:r><w:br/></w:r>';
    else if (n.type === 'note_link') x = t(ctx.noteTitle(String(a.id)) ?? String(a.title || '노트'));
    else if (n.type === 'link_mention') { href = String(a.href ?? '') || href; r.style = 'Hyperlink'; x = t(String(a.title || a.href || '')); }
    else if (n.type === 'xref') x = t(ctx.xref(String(a.id)) ?? String(a.label || '참조'));
    else if (n.type === 'date_mention') x = t([a.date, a.time].filter(Boolean).join(' '));
    else if (n.type === 'rating') x = t(ratingStars(a.value, a.max)); // 별점 → ★
    else if (n.type === 'media_time') x = t(`[${mediaClock(a.t)}]`); // 녹음 재생 시각 → [분:초]
    else if (n.type === 'math_inline') x = `<m:oMath><m:r><m:t>${esc(String(a.tex ?? ''))}</m:t></m:r></m:oMath>`;
    else if (n.type === 'footnote') x = `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="${ctx.footnote(String(a.note ?? ''))}"/></w:r>`;
    else continue;
    if (href && n.type !== 'math_inline') {
      if (link && (link as { href: string }).href !== href) flush();
      link ??= { href, buf: [] };
      link.buf.push(x);
    } else { flush(); out.push(x); }
  }
  flush();
  return out.join('');
}

function para(p: PPr, body: string): string { return `<w:p>${pPrXml(p)}${body}</w:p>`; }

/** 블록 노드들 → 문단들. first: 상자의 첫 문단(쪽 나눔은 거기에만) */
function blocks(nodes: readonly TextNode[] | undefined, ctx: DocxCtx, look: Look, st: State, out: string[]): void {
  for (const n of nodes ?? []) {
    const a = (n.attrs ?? {}) as Record<string, unknown>;
    const p = (style: string | undefined, extra: PPr = {}): PPr => {
      const q: PPr = { ...look.p, ...extra, ...(style ? { style } : {}) };
      if (extra.num) delete q.ind; // 번호 목록 들여쓰기는 번호 매기기가
      if (st.shd) q.shd = st.shd;
      if (st.indent && !q.num) q.ind = { ...q.ind, left: (q.ind?.left ?? 0) + st.indent };
      if (out.length && q.pageBreakBefore) delete q.pageBreakBefore; // 상자의 첫 문단만 새 쪽에서
      return q;
    };
    switch (n.type) {
      case 'paragraph': case 'heading': {
        const style = st.title ? 'Heading1' : n.type === 'heading' ? `Heading${Math.min(4, Math.max(1, Number(a.level) || 1))}` : st.quote ? 'Quote' : undefined;
        out.push(para(p(style), runs(n.content, ctx, look, style)));
        break;
      }
      case 'code_block': {
        const text = (n.content ?? []).map((x) => x.text ?? '').join('');
        for (const line of text.split('\n')) out.push(para(p('Code'), line ? `<w:r><w:t xml:space="preserve">${esc(line)}</w:t></w:r>` : ''));
        break;
      }
      case 'horizontal_rule': out.push(para(p(undefined, { bdr: 'bottom' }), '')); break;
      case 'math_block': out.push(para(p(undefined, { jc: 'center' }), `<m:oMathPara><m:oMath><m:r><m:t>${esc(String(a.tex ?? ''))}</m:t></m:r></m:oMath></m:oMathPara>`)); break;
      case 'blockquote': blocks(n.content, ctx, look, { ...st, quote: true }, out); break;
      case 'callout': blocks(n.content, ctx, look, { ...st, shd: hexOf(a.color, BG_COLOR_HEX) ?? 'FBF3DB' }, out); break;
      case 'toggle': blocks(n.content, ctx, look, st, out); break;
      case 'bullet_list': case 'ordered_list': {
        const outline = n.type === 'ordered_list' && (!!st.olNum || a.nums === 'outline');
        const id = n.type !== 'ordered_list' ? BULLETS_ID : st.olNum ?? ctx.orderedList(Number(a.order) || 1, outline);
        for (const item of n.content ?? []) listItem(item, id, ctx, look, outline ? { ...st, olNum: id } : st, out, p);
        break;
      }
      case 'task_list':
        for (const item of n.content ?? []) {
          const [first, ...rest] = item.content ?? [];
          const box = `<w:r><w:t xml:space="preserve">${item.attrs?.checked ? '☑' : '☐'} </w:t></w:r>`;
          const ind = { left: 360 * (st.depth + 1) };
          if (first) out.push(para(p('ListParagraph', { ind }), box + runs(first.content, ctx, look, 'ListParagraph')));
          blocks(rest, ctx, look, { ...st, depth: st.depth + 1, indent: (st.indent ?? 0) + 360 }, out);
        }
        break;
      default:
        if (n.content) blocks(n.content, ctx, look, st, out);
    }
  }
}

function listItem(item: TextNode, numId: number, ctx: DocxCtx, look: Look, st: State, out: string[], p: (s: string | undefined, e?: PPr) => PPr): void {
  const [first, ...rest] = item.content ?? [];
  if (first?.type === 'paragraph' || first?.type === 'heading') out.push(para(p('ListParagraph', { num: { id: numId, lvl: Math.min(8, st.depth) } }), runs(first.content, ctx, look, 'ListParagraph')));
  else if (first) blocks([first], ctx, look, st, out);
  // 항목 안 다음 문단 · 하위 목록: 한 단계 안쪽
  const inner: State = { ...st, depth: st.depth + 1 };
  for (const x of rest) {
    if (x.type === 'bullet_list' || x.type === 'ordered_list' || x.type === 'task_list') blocks([x], ctx, look, inner, out);
    else blocks([x], ctx, look, { ...inner, indent: (st.indent ?? 0) + 360 * (st.depth + 1) + 60 }, out);
  }
}

/** 글 문서 하나 → 문단들. title: 제목 상자(제목 1로) */
export function textToOoxml(doc: TextNode, ctx: DocxCtx, look: Look = PLAIN, title = false): string[] {
  const out: string[] = [];
  blocks(doc.content, ctx, look, { depth: 0, title }, out);
  return out;
}
