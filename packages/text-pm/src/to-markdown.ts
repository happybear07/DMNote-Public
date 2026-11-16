// pm-v1 문서(JSON) → Markdown (FR-130). DOM · ProseMirror 없이 JSON만 걷는다 — Node 테스트 · 워커에서도 동작.
// 표기: 할 일 `- [ ]` · 토글 `<details>` · 콜아웃 `> [!tip]`(Obsidian · GitHub 경고 문법) · 노트 링크 `[[제목]]` · 강조 `==`.
import { mediaClock, ratingStars } from './schema';
import type { TextNode } from '@dn/engine-core';
import { mentionLabel } from './schema';

export interface MarkdownOptions {
  /** 노트 링크에 쓸 지금 제목 (없으면 링크 당시 제목) */
  noteTitle?(id: string): string | null;
  /** 상호 참조에 쓸 지금 번호 ('그림 3', 없으면 넣을 때 번호) */
  xref?(id: string): string | null;
}

/** 콜아웃 아이콘 → 경고 종류 */
const CALLOUT_KIND: Record<string, string> = {
  bulb: 'tip', info: 'info', alert: 'warning', check: 'success', question: 'question', star: 'important', pin: 'note',
  pencil: 'note', flag: 'important', bookmark: 'note', heart: 'note', target: 'important',
};

export function docToMarkdown(doc: TextNode, opts: MarkdownOptions = {}): string {
  return blocks(doc.content ?? [], opts).join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

function blocks(nodes: readonly TextNode[], o: MarkdownOptions): string[] {
  return nodes.map((n) => block(n, o)).filter((s) => s !== null) as string[];
}

function block(n: TextNode, o: MarkdownOptions): string | null {
  const kids = n.content ?? [];
  switch (n.type) {
    case 'paragraph': return inline(kids, o);
    case 'heading': {
      const level = Math.min(Math.max(Number(n.attrs?.level) || 1, 1), 6);
      return `${'#'.repeat(level)} ${inline(kids, o)}`;
    }
    case 'blockquote': return quote(blocks(kids, o).join('\n\n'));
    case 'code_block': {
      const text = kids.map((k) => k.text ?? '').join('');
      const fence = text.includes('```') ? '~~~' : '```';
      return `${fence}${String(n.attrs?.language ?? '')}\n${text}\n${fence}`;
    }
    case 'horizontal_rule': return '---';
    case 'math_block': return `$$\n${String(n.attrs?.tex ?? '')}\n$$`;
    case 'bullet_list': return kids.map((li) => item('- ', li, o)).join('\n');
    case 'ordered_list': {
      const start = Number(n.attrs?.order) || 1;
      return kids.map((li, i) => item(`${start + i}. `, li, o)).join('\n');
    }
    case 'task_list': return kids.map((li) => item(li.attrs?.checked ? '- [x] ' : '- [ ] ', li, o)).join('\n');
    case 'toggle': {
      const [summary, ...rest] = kids;
      const body = blocks(rest, o).join('\n\n');
      return `<details${n.attrs?.open === false ? '' : ' open'}>\n<summary>${summary ? inline(summary.content ?? [], o) : ''}</summary>\n\n${body}\n\n</details>`;
    }
    case 'callout': {
      const kind = CALLOUT_KIND[String(n.attrs?.icon)] ?? 'note';
      return quote(`[!${kind}]\n${blocks(kids, o).join('\n\n')}`);
    }
    default:
      // 모르는 블록 노드: 글자만이라도
      return kids.length ? blocks(kids, o).join('\n\n') : null;
  }
}

/** 목록 항목: 첫 문단은 표시 뒤에, 나머지(하위 목록 등)는 표시 폭만큼 들여 쓴다 */
function item(marker: string, li: TextNode, o: MarkdownOptions): string {
  const [first, ...rest] = li.content ?? [];
  const head = first ? (first.type === 'paragraph' ? inline(first.content ?? [], o) : block(first, o) ?? '') : '';
  const pad = ' '.repeat(marker.startsWith('- [') ? 2 : marker.length);
  const tail = blocks(rest, o).map((b) => indent(b, pad)).join('\n');
  return marker + head + (tail ? `\n${tail}` : '');
}

const indent = (s: string, pad: string) => s.split('\n').map((l) => (l ? pad + l : l)).join('\n');
const quote = (s: string) => s.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n');

// ───────── 인라인 ─────────

/** 마크 바깥쪽부터 감싸기 위한 순서 (링크는 가장 바깥) */
const MARK_ORDER = ['link', 'strong', 'em', 'strike', 'underline', 'highlight', 'sup', 'sub', 'code'];

function inline(nodes: readonly TextNode[], o: MarkdownOptions): string {
  let out = '';
  for (const n of nodes) {
    if (n.type === 'hard_break') { out += '  \n'; continue; }
    if (n.type === 'math_inline') { out += `$${String(n.attrs?.tex ?? '')}$`; continue; }
    if (n.type === 'footnote') { out += `^[${String(n.attrs?.note ?? '').replace(/[[\]]/g, '')}]`; continue; }
    if (n.type === 'xref') { out += escape(o.xref?.(String(n.attrs?.id ?? '')) ?? String(n.attrs?.label ?? '')); continue; }
    if (n.type === 'rating') { out += ratingStars(n.attrs?.value, n.attrs?.max); continue; }
    if (n.type === 'media_time') { out += `[${mediaClock(n.attrs?.t)}]`; continue; }
    if (n.type === 'date_mention') { out += String(n.attrs?.date ?? '') + (n.attrs?.time ? ` ${String(n.attrs.time)}` : ''); continue; }
    if (n.type === 'link_mention') {
      const href = String(n.attrs?.href ?? '');
      out += `[${escape(mentionLabel({ href, title: String(n.attrs?.title ?? '') }))}](${href.replace(/\)/g, '%29')})`;
      continue;
    }
    if (n.type === 'note_link') {
      const id = String(n.attrs?.id ?? '');
      const title = o.noteTitle?.(id) ?? String(n.attrs?.title ?? '');
      out += `[[${title.replace(/[[\]|]/g, ' ').trim() || '없는 노트'}]]`;
      continue;
    }
    if (n.text === undefined) continue;
    const marks = [...(n.marks ?? [])].sort((a, b) => MARK_ORDER.indexOf(a.type) - MARK_ORDER.indexOf(b.type));
    const isCode = marks.some((m) => m.type === 'code');
    let s = isCode ? codeSpan(n.text) : escape(n.text);
    for (const m of [...marks].reverse()) {
      switch (m.type) {
        case 'strong': s = `**${s}**`; break;
        case 'em': s = `*${s}*`; break;
        case 'strike': s = `~~${s}~~`; break;
        case 'underline': s = `<u>${s}</u>`; break;
        case 'highlight': s = `==${s}==`; break;
        case 'chip': s = isCode ? s : codeSpan(n.text); break; // 칩 → `칩` (태그처럼)
        case 'sup': s = `<sup>${s}</sup>`; break;
        case 'sub': s = `<sub>${s}</sub>`; break;
        case 'link': s = `[${s}](${String(m.attrs?.href ?? '').replace(/\)/g, '%29')})`; break;
        default: break;
      }
    }
    out += s;
  }
  return out;
}

function codeSpan(t: string): string {
  return t.includes('`') ? `\`\` ${t} \`\`` : `\`${t}\``;
}

/** 서식 기호로 읽힐 글자만 이스케이프 (줄 맨 앞의 #, >, 목록 표시 포함) */
function escape(t: string): string {
  return t
    .replace(/([\\`*_[\]<>~=|])/g, '\\$1')
    .replace(/^(\s*)([#+-]|\d+\.)(?=\s)/gm, '$1\\$2');
}
