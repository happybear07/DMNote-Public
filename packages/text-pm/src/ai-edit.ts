// 고른 글 AI 편집 (FR-112): 편집기 없이(헤드리스) 고른 범위의 Markdown과, AI 결과를 넣는 스텝.
// 바꾸기는 붙여넣기처럼 고른 범위를 결과로(양 끝 문단에 이어 붙임), 아래에 넣기는 고른 범위가 끝나는 문단(목록이면 목록) 다음에.
// 이어서 넣기(FR-113 이어 쓰기)는 맨 위 문단이 문장 가운데서 끝났으면 그 문단에 이어 붙이고, 아니면 다음 문단으로.
// Markdown으로 오갈 수 없는 글 속 물건(노트 링크 · 날짜 · 상호 참조 · 링크 카드 · 별점 · 각주)은 ⟦n⟧ 표지로 보내고 돌려받아 원래 것으로 —
// 바꿔도 링크 · 알림이 사라지지 않게. 표지로도 못 지키는 서식(댓글 표시 · 글자 색 · 토글 …)은 미리 알려 준다(aiSource.lost).
import type { TextDoc, TextNode } from '@dn/engine-core';
import { Fragment, Slice } from 'prosemirror-model';
import { Selection } from 'prosemirror-state';
import { canJoin, Transform } from 'prosemirror-transform';
import { toJSON, toNode } from './codec';
import { markdownToDoc } from './markdown';
import { docToMarkdown, type MarkdownOptions } from './to-markdown';

export interface TextRange { readonly from: number; readonly to: number }

/** 고른 범위 → Markdown (AI에 보낼 글). 범위가 비었으면 문서 전체 */
export function rangeMarkdown(doc: TextDoc, r: TextRange, opts?: MarkdownOptions): string {
  const node = toNode(doc);
  return docToMarkdown(toJSON(r.from < r.to ? node.cut(r.from, r.to) : node) as TextNode, opts);
}

/** 표지로 지키는 글 속 물건 */
const KEEP = new Set(['note_link', 'xref', 'link_mention', 'date_mention', 'rating', 'footnote', 'media_time']);
const TOKEN = /⟦(\d+)⟧/g;
/** Markdown으로 오가면 사라지는 것 → 알릴 이름 (표 · 목록 · 굵게 · 링크처럼 오갈 수 있는 것은 없음) */
const LOST_NAME: Record<string, string> = {
  comment: '댓글 표시', textColor: '글자 색', fontSize: '글자 크기', fontFamily: '글꼴', 'highlight:color': '형광 색', chip: '칩',
  sup: '위 첨자', sub: '아래 첨자', toggle: '토글', callout: '콜아웃 모양', math_block: '수식 블록',
};

/** AI에 보낼 글: markdown(물건은 ⟦n⟧), keep(⟦n⟧ = keep[n-1]), lost(바꾸면 사라지는 서식 이름) */
export interface AiSource { readonly markdown: string; readonly keep: readonly TextNode[]; readonly lost: readonly string[] }

export function aiSource(doc: TextDoc, r: TextRange, opts?: MarkdownOptions): AiSource {
  const node = toNode(doc);
  const cut = toJSON(r.from < r.to ? node.cut(r.from, r.to) : node) as TextNode;
  const keep: TextNode[] = [];
  const swap = (n: TextNode): TextNode => {
    if (KEEP.has(n.type)) { keep.push(n); return { type: 'text', text: `⟦${keep.length}⟧`, ...(n.marks?.length ? { marks: n.marks } : {}) }; }
    return n.content ? { ...n, content: n.content.map(swap) } : n;
  };
  const sent = swap(cut);
  const markdown = docToMarkdown(sent, opts);
  // 한 번 오가 보고 없어진 것 — 노드 종류 · 표시(색처럼 값이 있으면 '종류:값')
  const feats = (n: TextNode, out: Set<string>) => {
    out.add(n.type);
    for (const m of n.marks ?? []) { out.add(m.type); if (m.attrs?.color) out.add(`${m.type}:color`); }
    for (const k of n.content ?? []) feats(k, out);
    return out;
  };
  const back = feats(markdownToDoc(markdown) as TextNode, new Set());
  const lost = [...feats(sent, new Set())].filter((f) => !back.has(f) && LOST_NAME[f]).map((f) => LOST_NAME[f]!);
  return { markdown, keep, lost: [...new Set(lost)] };
}

/** 결과에서 빠진 표지 수 (AI가 링크 · 날짜를 빠뜨렸나) */
export function missingKept(markdown: string, keep: readonly unknown[]): number {
  const seen = new Set([...markdown.matchAll(TOKEN)].map((m) => Number(m[1])));
  return keep.filter((_, i) => !seen.has(i + 1)).length;
}

/** 미리보기 글: ⟦n⟧를 그 물건의 글자로 (노트 링크 → [[제목]], 날짜 → 날짜 …) */
export function keptLabel(markdown: string, keep: readonly TextNode[]): string {
  return markdown.replace(TOKEN, (all, k: string) => { const n = keep[Number(k) - 1]; return n ? docToMarkdown({ type: 'doc', content: [{ type: 'paragraph', content: [n] }] } as TextNode).trim() : all; });
}

/** ⟦n⟧ 표지를 원래 물건으로 되돌린다 (없는 번호 · 두 번째부터는 글자째 지움) */
function restoreKept(n: TextNode, keep: readonly TextNode[], used: Set<number>): TextNode {
  if (!n.content) return n;
  const content: TextNode[] = [];
  for (const k of n.content) {
    if (k.type !== 'text' || !k.text?.includes('⟦')) { content.push(restoreKept(k, keep, used)); continue; }
    let at = 0;
    for (const m of k.text.matchAll(TOKEN)) {
      if (m.index! > at) content.push({ ...k, text: k.text.slice(at, m.index) });
      const i = Number(m[1]) - 1, orig = keep[i];
      if (orig && !used.has(i)) { used.add(i); content.push(orig); }
      at = m.index! + m[0].length;
    }
    if (at < k.text.length) content.push({ ...k, text: k.text.slice(at) });
  }
  return { ...n, content };
}

/** 두 문서가 같은가 (고른 뒤 글이 바뀌었으면 위치가 어긋나 넣지 않는다) */
export function sameDoc(a: TextDoc, b: TextDoc): boolean { return toNode(a).eq(toNode(b)); }

/** 문장이 끝난 글인가 (마침표 · 물음표 · 닫는 괄호 · 따옴표 · 콜론) */
const SENTENCE_END = /[.!?。！？…:;)\]}"'”’」』]\s*$/;

/**
 * AI 결과(Markdown)를 넣는 스텝 — 엔진 트랜잭션 하나로 보내면 실행 취소 한 번. keep: aiSource가 표지로 바꾼 물건(되돌린다).
 * after(이어 쓰기, FR-113): 고른 범위가 끝나는 곳이 맨 위 문단(제목 · 코드 · 목록 항목이 아님)이고 문장 가운데서 끝났으며 결과가
 * 문단으로 시작하면 그 문단에 이어 붙이고(띄어 씀), 아니면 아래에 넣기와 같이 다음 블록으로 — 같은 종류 목록끼리 붙으면 한 목록으로.
 */
export function aiEditSteps(doc: TextDoc, r: TextRange, markdown: string, how: 'replace' | 'below' | 'after', keep: readonly TextNode[] = []): unknown[] {
  const node = toNode(doc), result = toNode(keep.length ? restoreKept(markdownToDoc(markdown) as TextNode, keep, new Set()) as TextDoc : markdownToDoc(markdown));
  const t = new Transform(node);
  if (how === 'replace') { t.replaceRange(r.from, r.to, Slice.maxOpen(result.content)); return t.steps.map((s) => s.toJSON()); }
  if (how === 'after') {
    const end = Selection.findFrom(node.resolve(r.to), -1, true)?.$head;
    const tb = end?.parent;
    const before = end && tb?.type.name === 'paragraph' && end.depth === 1 ? tb.textBetween(0, end.parentOffset, '\n', ' ') : '';
    if (end && before.trim() && !SENTENCE_END.test(before) && result.firstChild?.type.name === 'paragraph') {
      const first = result.firstChild;
      const spaced = /\s$/.test(before) || /^[\s,.!?)\]]/.test(first.textContent) ? first : first.copy(Fragment.from(node.type.schema.text(' ')).append(first.content));
      t.replaceRange(end.pos, end.pos, Slice.maxOpen(result.content.replaceChild(0, spaced)));
      return t.steps.map((s) => s.toJSON());
    }
  }
  const $to = node.resolve(r.to);
  const at = $to.depth ? $to.after(1) : node.content.size;
  t.insert(at, result.content);
  // 이어 쓴 목록이 앞 목록과 같은 종류면 한 목록으로 (번호가 1부터 다시 시작하지 않게)
  const prev = t.doc.resolve(at).nodeBefore, next = t.doc.resolve(at).nodeAfter;
  if (how === 'after' && prev && next && prev.type === next.type && /_list$/.test(prev.type.name) && canJoin(t.doc, at)) t.join(at);
  return t.steps.map((s) => s.toJSON());
}
