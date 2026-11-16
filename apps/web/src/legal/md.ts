// 법적 문서(legal/*.md)용 작은 Markdown 해석기 — 앱 안 창(LegalDialog)과 빌드 때 정적 페이지(legal-pages.ts)가 같이 쓴다.
// 문서에 쓰는 것만 읽는다: 제목(# ~ ###) · 문단 · 목록(- · 1. , 번호 항목 아래 들여 쓴 -) · 표 · **굵게** · [링크](https:// 또는 /경로) · <!-- 주석 -->.
// HTML을 그대로 넣지 않으므로(글자는 모두 이스케이프) 문서에 무엇을 써도 스크립트가 끼어들 수 없다.

export type Inline = { t: 'text'; v: string } | { t: 'b'; v: string } | { t: 'a'; v: string; href: string };
export interface MdItem { text: Inline[]; sub: Inline[][] }
export type MdBlock =
  | { t: 'h'; level: 1 | 2 | 3; text: Inline[] }
  | { t: 'p'; text: Inline[] }
  | { t: 'ul' | 'ol'; items: MdItem[] }
  | { t: 'table'; head: Inline[][]; rows: Inline[][][] };

// 링크 주소는 https:// · http:// · /경로만 — "[운영자 이름](이하 …)" 같은 자리표시자를 링크로 읽지 않는다
const INLINE = /\*\*(.+?)\*\*|\[([^\]]+)\]\(((?:https?:\/\/|\/)[^)\s]*)\)/g;

export function inline(s: string): Inline[] {
  const out: Inline[] = [];
  let at = 0;
  for (const m of s.matchAll(INLINE)) {
    const i = m.index ?? 0;
    if (i > at) out.push({ t: 'text', v: s.slice(at, i) });
    out.push(m[1] !== undefined ? { t: 'b', v: m[1] } : { t: 'a', v: m[2]!, href: m[3]! });
    at = i + m[0].length;
  }
  if (at < s.length) out.push({ t: 'text', v: s.slice(at) });
  return out;
}

const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => inline(c.trim()));

export function parseMd(src: string): MdBlock[] {
  const lines = src.replace(/<!--[\s\S]*?-->/g, '').replace(/\r\n?/g, '\n').split('\n');
  const out: MdBlock[] = [];
  let para: string[] = [];
  const flush = () => { if (para.length) out.push({ t: 'p', text: inline(para.join(' ')) }); para = []; };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const h = /^(#{1,3}) (.+)$/.exec(line);
    const ul = /^- (.+)$/.exec(line);
    const ol = /^\d+\. (.+)$/.exec(line);
    const sub = /^\s+- (.+)$/.exec(line);
    if (!line.trim()) { flush(); continue; }
    if (h) { flush(); out.push({ t: 'h', level: h[1]!.length as 1 | 2 | 3, text: inline(h[2]!) }); continue; }
    if (line.startsWith('|')) {
      flush();
      const head = cells(line);
      const rows: Inline[][][] = [];
      if (/^\|[\s|:-]+\|?$/.test(lines[i + 1] ?? '')) i++;
      while (lines[i + 1]?.startsWith('|')) rows.push(cells(lines[++i]!));
      out.push({ t: 'table', head, rows });
      continue;
    }
    const last = out[out.length - 1];
    if (sub && !para.length && (last?.t === 'ul' || last?.t === 'ol') && last.items.length) { last.items[last.items.length - 1]!.sub.push(inline(sub[1]!)); continue; }
    const item = ul ?? ol;
    if (item) {
      flush();
      const t = ul ? 'ul' : 'ol';
      if (last?.t === t) last.items.push({ text: inline(item[1]!), sub: [] });
      else out.push({ t, items: [{ text: inline(item[1]!), sub: [] }] });
      continue;
    }
    para.push(line.trim());
  }
  flush();
  return out;
}

/** 글자만 (제목 · 검사용) */
export const plain = (xs: readonly Inline[]): string => xs.map((x) => x.v).join('');

export const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inlineHtml(xs: readonly Inline[]): string {
  return xs.map((x) => x.t === 'b' ? `<strong>${esc(x.v)}</strong>`
    : x.t === 'a' ? `<a href="${esc(x.href)}"${x.href.startsWith('/') ? '' : ' target="_blank" rel="noopener noreferrer"'}>${esc(x.v)}</a>`
      : esc(x.v)).join('');
}

/** 정적 페이지용 HTML (본문만) */
export function mdHtml(blocks: readonly MdBlock[]): string {
  return blocks.map((b) => {
    if (b.t === 'h') return `<h${b.level}>${inlineHtml(b.text)}</h${b.level}>`;
    if (b.t === 'p') return `<p>${inlineHtml(b.text)}</p>`;
    if (b.t === 'table') {
      const row = (r: Inline[][], tag: string) => `<tr>${r.map((c) => `<${tag}>${inlineHtml(c)}</${tag}>`).join('')}</tr>`;
      return `<table><thead>${row(b.head, 'th')}</thead><tbody>${b.rows.map((r) => row(r, 'td')).join('')}</tbody></table>`;
    }
    const items = b.items.map((it) => `<li>${inlineHtml(it.text)}${it.sub.length ? `<ul>${it.sub.map((s) => `<li>${inlineHtml(s)}</li>`).join('')}</ul>` : ''}</li>`);
    return `<${b.t}>${items.join('')}</${b.t}>`;
  }).join('\n');
}
