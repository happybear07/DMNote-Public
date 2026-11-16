// 마크다운 → 텍스트 문서(pm-v1 JSON) 변환 (FR-031). DOM 없이 동작한다 — 붙여넣기와 AI 파이프라인(P2)이 같이 쓴다.
// CommonMark 전체가 아니라 AI 답변에 실제로 나오는 부분만: 제목 · 목록(중첩 · 할 일) · 인용 · 코드 블록 · 구분선 · 표(P2 전까지 줄 텍스트) ·
// 인라인 굵게 · 기울임 · 취소선 · 강조 · 코드 · 링크. 줄바꿈 하나는 hard_break — AI 답변은 줄바꿈을 줄 나눔으로 쓴다.
import type { TextDoc, TextMark, TextNode } from '@dn/engine-core';
import { normalizeLanguage } from './highlight';
import { safeHref } from './schema';

const FENCE = /^\s*(```|~~~)\s*([\w+-]*)\s*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
/** 콜아웃 종류 → 아이콘 · 색 (to-markdown CALLOUT_KIND의 반대) */
const CALLOUT_ICON: Record<string, string> = { tip: 'bulb', info: 'info', warning: 'alert', caution: 'alert', danger: 'alert', success: 'check', question: 'question', important: 'star', note: 'pin' };
const CALLOUT_COLOR: Record<string, string> = { tip: 'yellow', info: 'blue', warning: 'yellow', caution: 'yellow', danger: 'red', success: 'green', question: 'purple', important: 'red', note: 'gray' };
const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TASK = /^\[([ xX])\](?:\s+(.*))?$/; // '- [ ]'만 있어도 빈 할 일 (깃허브처럼)
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/** 마크다운으로 보이는가 — 아니면 붙여넣기는 줄 단위 문단으로 그냥 넣는다 */
export function looksLikeMarkdown(text: string): boolean {
  return /^\s{0,3}(#{1,6}\s|>\s?|[-*+]\s|\d{1,9}[.)]\s|```|~~~)|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\(https?:|^\s*\|.*\|\s*$/m.test(text);
}

export function markdownToDoc(md: string): TextDoc {
  const lines = md.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
  const content = parseBlocks(lines);
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
}

/** 줄 단위 문단 (서식 없는 붙여넣기 · Ctrl+Shift+V) */
export function plainTextToDoc(text: string, opts: { links?: boolean } = {}): TextDoc {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  while (lines.length > 1 && !lines[lines.length - 1]!.trim()) lines.pop();
  return { type: 'doc', content: lines.map((l): TextNode => (l ? { type: 'paragraph', content: opts.links ? linkify(l) : [{ type: 'text', text: l }] } : { type: 'paragraph' })) };
}

const URL_RE = /https?:\/\/[^\s<>]*[^\s<>.,;:!?'")\]]/g;

/** 한 줄 글자에서 URL만 링크로 (FR-030) — 서식 없는 붙여넣기(Ctrl+Shift+V)는 쓰지 않는다 */
function linkify(line: string): TextNode[] {
  const out: TextNode[] = [];
  let last = 0;
  for (const m of line.matchAll(URL_RE)) {
    if (!safeHref(m[0])) continue;
    if (m.index! > last) out.push({ type: 'text', text: line.slice(last, m.index) });
    out.push({ type: 'text', text: m[0], marks: [{ type: 'link', attrs: { href: m[0] } }] });
    last = m.index! + m[0].length;
  }
  if (last < line.length) out.push({ type: 'text', text: line.slice(last) });
  return out;
}

function parseBlocks(lines: string[]): TextNode[] {
  const out: TextNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) { i++; continue; }

    const fence = FENCE.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !new RegExp(`^\\s*${fence[1]}\\s*$`).test(lines[i]!)) body.push(lines[i++]!);
      i++; // 닫는 펜스 (없으면 끝까지)
      const text = body.join('\n');
      const language = normalizeLanguage(fence[2]);
      out.push({ type: 'code_block', ...(language ? { attrs: { language } } : {}), ...(text ? { content: [{ type: 'text', text }] } : {}) });
      continue;
    }
    // 블록 수식: $$ … $$ (한 줄이나 여러 줄)
    const mb = /^\s*\$\$(.*)$/.exec(line);
    if (mb) {
      const one = /^(.*?)\$\$\s*$/.exec(mb[1]!);
      let tex: string;
      if (one) { tex = one[1]!; i++; }
      else {
        const body = [mb[1]!];
        i++;
        while (i < lines.length && !/\$\$\s*$/.test(lines[i]!)) body.push(lines[i++]!);
        if (i < lines.length) body.push(lines[i++]!.replace(/\$\$\s*$/, ''));
        tex = body.join('\n');
      }
      out.push({ type: 'math_block', attrs: { tex: tex.trim() } });
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      out.push(textblock('heading', h[2]!, { level: Math.min(h[1]!.length, 4) }));
      i++;
      continue;
    }
    if (HR.test(line)) {
      out.push({ type: 'horizontal_rule' });
      i++;
      continue;
    }
    if (QUOTE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && lines[i]!.trim() && QUOTE.test(lines[i]!)) inner.push(QUOTE.exec(lines[i++]!)![1]!);
      // > [!note] … — 깃허브 · 옵시디언 콜아웃 (내보내기 to-markdown과 같은 표기)
      const co = /^\[!(\w+)\][ 	]*(.*)$/.exec(inner[0] ?? '');
      if (co) {
        const rest = [...(co[2] ? [co[2]] : []), ...inner.slice(1)];
        const kids = parseBlocks(rest);
        out.push({ type: 'callout', attrs: { icon: CALLOUT_ICON[co[1]!.toLowerCase()] ?? 'pin', color: CALLOUT_COLOR[co[1]!.toLowerCase()] ?? 'yellow' }, content: kids.length ? kids : [{ type: 'paragraph' }] });
        continue;
      }
      const kids = parseBlocks(inner);
      out.push({ type: 'blockquote', content: kids.length ? kids : [{ type: 'paragraph' }] });
      continue;
    }
    if (ITEM.test(line)) {
      const end = listEnd(lines, i);
      out.push(parseList(lines.slice(i, end)));
      i = end;
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      // 표: P2(FR-018) 표 콘텐츠 전까지는 행을 ' · '로 이은 문단으로 보존
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]!)) {
        const row = lines[i++]!;
        if (TABLE_SEP.test(row)) continue;
        const cells = row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        out.push(textblock('paragraph', cells.join(' · ')));
      }
      continue;
    }
    // 문단: 빈 줄이나 다른 블록 시작까지
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !startsBlock(lines[i]!)) para.push(lines[i++]!.trim());
    if (!para.length) para.push(lines[i++]!.trim());
    out.push({ type: 'paragraph', content: joinLines(para) });
  }
  return out;
}

function startsBlock(l: string): boolean {
  return /^\s*\$\$/.test(l) || FENCE.test(l) || HEADING.test(l) || QUOTE.test(l) || ITEM.test(l) || HR.test(l) || /^\s*\|.*\|\s*$/.test(l);
}

/** 목록 블록의 끝: 빈 줄 다음이 들여쓰기도 목록 항목도 아니면 끝 */
function listEnd(lines: string[], start: number): number {
  const base = indentOf(lines[start]!);
  const kind = itemKind(lines[start]!);
  let i = start + 1;
  while (i < lines.length) {
    const l = lines[i]!;
    // 같은 들여쓰기에서 목록 종류(번호 · 글머리 · 할 일)가 바뀌면 새 목록
    if (ITEM.test(l) && indentOf(l) === base && itemKind(l) !== kind) break;
    if (!l.trim()) {
      const next = lines[i + 1];
      if (next === undefined || (!ITEM.test(next) && indentOf(next) <= base)) break;
      i++;
      continue;
    }
    if (indentOf(l) <= base && !ITEM.test(l)) {
      // 들여쓰기 없는 이어 쓰기 줄(lazy continuation)은 직전 항목에 붙인다. 다른 블록이 시작되면 끝.
      if (startsBlock(l) || !lines[i - 1]!.trim()) break;
    }
    if (indentOf(l) < base && ITEM.test(l)) break;
    i++;
  }
  return i;
}

function parseList(lines: string[]): TextNode {
  const base = indentOf(lines[0]!);
  const first = ITEM.exec(lines[0]!)!;
  const ordered = /\d/.test(first[2]!);
  // 항목 경계: 같은 들여쓰기의 항목 줄
  const items: string[][] = [];
  for (const l of lines) {
    const m = ITEM.exec(l);
    if (m && indentOf(l) === base) items.push([l]);
    else items[items.length - 1]!.push(l);
  }
  const parsed = items.map((item) => {
    const m = ITEM.exec(item[0]!)!;
    const task = TASK.exec(m[3]!);
    const head = task ? task[2] ?? '' : m[3]!;
    const contentIndent = m[1]!.length + m[2]!.length + 1;
    const rest = item.slice(1).map((l) => (indentOf(l) >= contentIndent ? l.slice(contentIndent) : l.replace(/^\s+/, '')));
    // 첫 문단은 이어지는 일반 줄까지
    const para = [head.trim()];
    let k = 0;
    while (k < rest.length && rest[k]!.trim() && !startsBlock(rest[k]!)) para.push(rest[k++]!.trim());
    const kids: TextNode[] = [{ type: 'paragraph', content: joinLines(para) }, ...parseBlocks(rest.slice(k))];
    return { task: task ? task[1] !== ' ' : null, kids };
  });
  // listEnd가 종류가 바뀌는 곳에서 목록을 끊으므로 항목은 모두 같은 종류다
  if (itemKind(lines[0]!) === 'task') {
    return { type: 'task_list', content: parsed.map((p) => ({ type: 'task_item', attrs: { checked: p.task }, content: p.kids })) };
  }
  const list: TextNode = {
    type: ordered ? 'ordered_list' : 'bullet_list',
    content: parsed.map((p) => ({ type: 'list_item', content: p.kids })),
  };
  if (ordered) {
    const start = parseInt(first[2]!, 10);
    if (start !== 1) return { ...list, attrs: { order: start } };
  }
  return list;
}

function itemKind(l: string): 'ordered' | 'task' | 'bullet' {
  const m = ITEM.exec(l)!;
  return /\d/.test(m[2]!) ? 'ordered' : TASK.test(m[3]!) ? 'task' : 'bullet';
}

function indentOf(l: string): number { return /^\s*/.exec(l)![0].length; }

function textblock(type: string, text: string, attrs?: Record<string, unknown>): TextNode {
  const content = inline(text, []);
  const n: TextNode = attrs ? { type, attrs } : { type };
  return content.length ? { ...n, content } : n;
}

function joinLines(lines: string[]): TextNode[] {
  const out: TextNode[] = [];
  lines.forEach((l, i) => {
    if (i) out.push({ type: 'hard_break' });
    // 줄 끝 공백 두 개 / 백슬래시 줄바꿈 표기는 지운다
    out.push(...inline(l.replace(/(\s{2,}|\\)$/, ''), []));
  });
  return out;
}

// ───────── 인라인 ─────────
type Rule = { re: RegExp; make: (m: RegExpExecArray, marks: TextMark[]) => TextNode[] };

const INLINE: Rule[] = [
  // 스키마에서 code는 다른 마크를 모두 배제한다 (excludes: '_')
  { re: /`([^`\n]+)`/, make: (m) => [txt(m[1]!, [{ type: 'code' }])] },
  // 각주 ^[글] (pandoc 글 속 각주, to-markdown이 쓰는 표기)
  { re: /\^\[([^\]\n]+)\]/, make: (m) => [{ type: 'footnote', attrs: { note: m[1]!.trim() } }] },
  // 줄 가운데의 $$식$$ 도 인라인 수식으로
  { re: /\$\$([^$\n]+?)\$\$/, make: (m) => [{ type: 'math_inline', attrs: { tex: m[1]!.trim() } }] },
  // 인라인 수식 $식$ — 앞뒤가 글자 · 숫자에 붙은 $(돈 표기)와 숫자뿐인 것은 빼고
  { re: /(?<![\w$\\])\$(?=[^\s$])([^$\n]*?[^\s$\\])\$(?![\w$])/, make: (m) => (/^\d+([.,]\d+)?$/.test(m[1]!) ? [txt(m[0], [])] : [{ type: 'math_inline', attrs: { tex: m[1]! } }]) },
  { re: /\[([^\]\n]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/, make: (m, marks) => safeHref(m[2]!) ? inline(m[1]!, [...marks, { type: 'link', attrs: { href: m[2]! } }]) : inline(m[1]!, marks) },
  { re: /<(https?:\/\/[^>\s]+)>/, make: (m, marks) => [txt(m[1]!, [...marks, { type: 'link', attrs: { href: m[1]! } }])] },
  // 맨 URL (FR-030) — AI 답변의 참고 링크. 끝의 마침표 · 괄호 · 따옴표는 링크에서 뺀다
  { re: /(?<![\w/(<\]="'])https?:\/\/[^\s<>]*[^\s<>.,;:!?'")\]]/, make: (m, marks) => (safeHref(m[0]) ? [txt(m[0], [...marks, { type: 'link', attrs: { href: m[0] } }])] : [txt(m[0], marks)]) },
  // ***굵게+기울임*** · <u>밑줄</u> — 내보내기(to-markdown)가 쓰는 표기를 그대로 다시 읽는다 (FR-027)
  { re: /(\*\*\*|___)(?=\S)([\s\S]*?\S)\1/, make: (m, marks) => inline(m[2]!, [...marks, { type: 'strong' }, { type: 'em' }]) },
  { re: /<u>(?=\S)([\s\S]*?\S)<\/u>/, make: (m, marks) => inline(m[1]!, [...marks, { type: 'underline' }]) },
  { re: /(\*\*|__)(?=\S)([\s\S]*?\S)\1/, make: (m, marks) => inline(m[2]!, [...marks, { type: 'strong' }]) },
  { re: /~~(?=\S)([\s\S]*?\S)~~/, make: (m, marks) => inline(m[1]!, [...marks, { type: 'strike' }]) },
  { re: /==(?=\S)([\s\S]*?\S)==/, make: (m, marks) => inline(m[1]!, [...marks, { type: 'highlight' }]) },
  { re: /(?<![\w*])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![\w*])|(?<!\w)_(?=[^\s_])([^_\n]*?[^\s_])_(?!\w)/, make: (m, marks) => inline(m[1] ?? m[2]!, [...marks, { type: 'em' }]) },
];

function inline(s: string, marks: TextMark[]): TextNode[] {
  if (!s) return [];
  // 가장 먼저 시작하는 규칙부터 (같은 위치면 목록 순서 = 우선순위)
  let best: { rule: Rule; m: RegExpExecArray } | null = null;
  for (const rule of INLINE) {
    const m = rule.re.exec(s);
    if (m && (!best || m.index < best.m.index)) best = { rule, m };
  }
  if (!best) return [txt(unescape(s), marks)];
  const { rule, m } = best;
  return [
    ...(m.index ? [txt(unescape(s.slice(0, m.index)), marks)] : []),
    ...rule.make(m, marks),
    ...inline(s.slice(m.index + m[0].length), marks),
  ].filter((n) => n.text !== '');
}

function unescape(s: string): string { return s.replace(/\\([\\`*_{}[\]()#+\-.!~|<>=])/g, '$1'); }

function txt(text: string, marks: TextMark[]): TextNode {
  return marks.length ? { type: 'text', text, marks: sortMarks(marks) } : { type: 'text', text };
}

// ProseMirror는 마크를 스키마 순서로 정렬해 저장한다 — 같은 순서로 맞춰야 check()를 통과한다
const MARK_ORDER = ['strong', 'em', 'underline', 'strike', 'highlight', 'code', 'link'];
function sortMarks(marks: TextMark[]): TextMark[] {
  const seen = new Set<string>();
  return marks.filter((m) => !seen.has(m.type) && seen.add(m.type)).sort((a, b) => MARK_ORDER.indexOf(a.type) - MARK_ORDER.indexOf(b.type));
}
