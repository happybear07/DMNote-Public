// 텍스트 문서 도우미 (ProseMirror JSON, 스키마 'pm-v1' — 타입은 model.ts): 제목 · 본문 문서 만들기, 상자의 글 칸 · 종류,
// 글자 뽑기(검색 · 미리보기 · 내보내기 · AI 원문). 엔진은 구조를 해석하지 않는다 — 적용 · 검증은 TextCodec.
import { isTextContent, type BoxKind, type Content, type TextContent, type TextDoc, type TextNode } from './model';

/** 제목 칸 문서: 문단 하나. 인라인 노드(서식 포함)를 그대로 받을 수도 있다. */
export function titleDoc(text: string | readonly TextNode[]): TextDoc {
  const inline = typeof text === 'string' ? (text ? [{ type: 'text', text }] : []) : text;
  return { type: 'doc', content: [inline.length ? { type: 'paragraph', content: inline } : { type: 'paragraph' }] };
}

/** 본문 칸 문서: 줄마다 문단. 빈 문자열이면 빈 문단 하나. */
export function bodyDoc(text: string): TextDoc {
  const lines = text ? text.split('\n') : [''];
  return { type: 'doc', content: lines.map((l): TextNode => (l ? { type: 'paragraph', content: [{ type: 'text', text: l }] } : { type: 'paragraph' })) };
}

/** 블록의 텍스트 칸: 제목 칸(있으면 첫 번째) · 본문 칸들(순서대로) */
export function blockTextParts(contents: readonly Content[]): { title?: TextContent; bodies: TextContent[] } {
  let title: TextContent | undefined;
  const bodies: TextContent[] = [];
  for (const c of contents) {
    if (!isTextContent(c)) continue;
    if (c.role === 'title' && !title) title = c; else bodies.push(c);
  }
  return { title, bodies };
}

/** 블록의 상자 종류: 텍스트가 제목 칸뿐이면 제목 상자, 아니면 내용 상자 (텍스트가 없으면 null) */
export function boxKind(contents: readonly Content[]): BoxKind | null {
  const { title, bodies } = blockTextParts(contents);
  if (!title && !bodies.length) return null;
  return title && !bodies.length ? 'title' : 'text';
}

/** 빈 문서: 글자 · 구분선 · 목록 없이 빈 문단 하나 */
export function isBlankDoc(doc: TextDoc): boolean {
  return doc.content.length === 0 || (doc.content.length === 1 && doc.content[0]!.type === 'paragraph' && !doc.content[0]!.content?.length);
}

/** 제목 + 내용 → 내용 상자 한 문서 (제목은 맨 앞 제목3 줄로) — 서로 다른 칸을 합칠 때 글자를 잃지 않는다 */
export function mergeTitleBody(title: TextDoc, body: TextDoc): TextDoc {
  const inline = title.content[0]?.content ?? [];
  const head: TextNode = inline.length ? { type: 'heading', attrs: { level: 3 }, content: inline } : { type: 'heading', attrs: { level: 3 } };
  return { type: 'doc', content: [head, ...(isBlankDoc(body) ? [] : body.content)] };
}

/** 아무 문서 → 제목 상자 문서 (한 줄). 문단 사이는 공백, 줄바꿈 · 블록 구조는 버리고 글자 서식은 남긴다 */
export function toTitleDoc(doc: TextDoc): TextDoc {
  const out: TextNode[] = [];
  const walk = (n: TextNode) => {
    if (n.text !== undefined) { out.push(n); return; }
    if (n.type === 'hard_break') { out.push({ type: 'text', text: ' ' }); return; }
    if (n.type === 'note_link' || n.type === 'math_inline' || n.type === 'date_mention' || n.type === 'xref' || n.type === 'link_mention') { out.push(n); return; }
    const kids = n.content ?? [];
    const textblock = kids.length > 0 && kids.every(isInlineLeaf);
    if (textblock && out.length) out.push({ type: 'text', text: ' ' });
    for (const k of kids) walk(k);
  };
  walk(doc);
  // 서식이 같은 이웃 글자 조각은 하나로 (ProseMirror가 만드는 정규형과 같게 — 비교 · 검색이 조각 경계에 걸리지 않도록)
  const merged: TextNode[] = [];
  for (const n of out) {
    const prev = merged[merged.length - 1];
    if (prev?.text !== undefined && n.text !== undefined && JSON.stringify(prev.marks ?? []) === JSON.stringify(n.marks ?? [])) merged[merged.length - 1] = { ...prev, text: prev.text! + n.text! };
    else merged.push(n);
  }
  return titleDoc(merged);
}

/** 줄 안에 들어가는 잎 노드: 글자 · 줄바꿈 · 노트 링크(FR-080 — 글자로는 링크 당시 제목) · 인라인 수식(FR-018 — 글자로는 LaTeX) */
function isInlineLeaf(k: TextNode): boolean {
  return k.text !== undefined || k.type === 'hard_break' || k.type === 'note_link' || k.type === 'math_inline' || k.type === 'date_mention' || k.type === 'footnote' || k.type === 'xref' || k.type === 'link_mention';
}

/** 문서의 글자를 줄바꿈으로 이은 것 (검색 · 미리보기 · AI 원문) */
export function docText(doc: TextNode): string { return textLines(doc).join('\n'); }

/** (레거시 · 테스트) 제목(heading) + 문단들로 된 한 문서 — 스키마 v1 블록 형태 */
export function textDoc(title: string, body: string): TextDoc {
  const lines = body.length ? body.split('\n') : [];
  return {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 3 }, content: title ? [{ type: 'text', text: title }] : [] },
      ...lines.map((l): TextNode => ({ type: 'paragraph', content: l ? [{ type: 'text', text: l }] : [] })),
    ],
  };
}

export function nodeText(n: TextNode): string {
  if (n.text !== undefined) return n.text;
  if (n.type === 'note_link') return typeof n.attrs?.title === 'string' ? n.attrs.title : '';
  // 링크 언급: 모은 제목, 없으면 주소
  if (n.type === 'link_mention') return String(n.attrs?.title || n.attrs?.href || '');
  // 상호 참조: 넣을 때 번호 ('그림 3')
  if (n.type === 'xref') return typeof n.attrs?.label === 'string' ? n.attrs.label : '';
  // 수식 (FR-018): 검색 · 미리보기에는 LaTeX 원문
  if (n.type === 'math_inline' || n.type === 'math_block') return typeof n.attrs?.tex === 'string' ? n.attrs.tex : '';
  // 날짜 멘션 (FR-133): 'YYYY-MM-DD'
  if (n.type === 'date_mention') return (typeof n.attrs?.date === 'string' ? n.attrs.date : '') + (typeof n.attrs?.time === 'string' && n.attrs.time ? ` ${n.attrs.time}` : '');
  return (n.content ?? []).map(nodeText).join('');
}

/** 문서의 각주 글 (문서 순서) — 글 줄(textLines)에는 넣지 않으므로 검색 · 내보내기가 따로 읽는다 */
export function footnoteNotes(doc: TextNode, keepEmpty = false): string[] {
  const out: string[] = [];
  const walk = (n: TextNode) => { if (n.type === 'footnote') { const t = typeof n.attrs?.note === 'string' ? n.attrs.note : ''; if (t || keepEmpty) out.push(t); } for (const k of n.content ?? []) walk(k); };
  walk(doc);
  return out;
}

/** 텍스트 블록(문단 · 제목 · 코드 등)을 문서 순서대로 평탄화한 줄 목록. 검색 · LOD · 내보내기용. */
export function textLines(doc: TextNode): string[] {
  const out: string[] = [];
  const walk = (n: TextNode) => {
    const kids = n.content ?? [];
    if (kids.length && kids.every(isInlineLeaf)) out.push(nodeText(n));
    else if (n.type === 'math_block') out.push(nodeText(n));
    else if (!kids.length && n.type !== 'doc' && n.type !== 'horizontal_rule' && n.text === undefined) out.push('');
    else for (const k of kids) walk(k);
  };
  walk(doc);
  return out;
}
