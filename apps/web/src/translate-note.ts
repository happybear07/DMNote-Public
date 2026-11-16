// 노트 번역 (FR-114): 노트의 글 조각(제목 · 글 상자 · 화살표 이름 · 묶음 이름)을 문서 순서로 모아 한 번에 보내고,
// 받은 조각으로 노트 사본을 만든다 — 상자 위치 · 화살표 · 필기 · 그림은 그대로 두고 글만 번역. 표 · 그래프 · 데이터베이스 글은 그대로.
// 글 상자는 Markdown으로 오가므로 글자 색 · 형광 같은 서식은 사본에서 빠질 수 있다(원본 노트는 손대지 않는다).
import { deserialize, documentOrder, Engine, isTextContent, serialize, toTitleDoc, type AiProvenance, type Content, type Id, type TextNode } from '@dn/engine-core';
import { docToMarkdown, markdownToDoc } from '@dn/text-pm';

export type NoteSeg = { kind: 'title' } | { kind: 'text'; id: Id } | { kind: 'arrow'; id: Id } | { kind: 'group'; id: Id };
/** 보낼 조각 — segs[i]의 글이 parts[i] · noteId: 조각을 뽑은 노트 (그 사이 다른 노트로 옮겼으면 만들지 않는다) */
export interface NoteSegments { noteId: Id; segs: NoteSeg[]; parts: string[] }

/** 노트 → 번역할 조각 (빈 것은 뺀다). 글 상자는 문서 순서대로 */
export function noteSegments(e: Engine): NoteSegments {
  const segs: NoteSeg[] = [], parts: string[] = [];
  const add = (s: NoteSeg, text: string | undefined) => { const t = text?.trim(); if (t) { segs.push(s); parts.push(t); } };
  add({ kind: 'title' }, e.note.title);
  const seen = new Set<Id>();
  const texts = [...documentOrder(e).flatMap((x) => e.contentsOf(x.block.id)), ...e.contents()];
  for (const c of texts) {
    if (seen.has(c.id) || !isTextContent(c)) continue;
    seen.add(c.id);
    add({ kind: 'text', id: c.id }, docToMarkdown(c.doc as TextNode));
  }
  for (const a of e.arrows()) add({ kind: 'arrow', id: a.id }, a.label);
  for (const [id, g] of Object.entries(e.note.groups ?? {})) add({ kind: 'group', id }, g.name);
  return { noteId: e.note.id, segs, parts };
}

/**
 * 받은 조각으로 노트 사본 — 새 id · 번역한 제목(없으면 원래 제목 + 언어). 받지 못한 조각은 원문 그대로 두고 그 수를 돌려준다.
 * 번역한 글 상자에는 AI 출처 표시를 단다.
 */
export function translatedCopy(e: Engine, segs: readonly NoteSeg[], out: readonly (string | null)[], o: { id: Id; now: number; ai: AiProvenance; langLabel: string }): { engine: Engine; missing: number } {
  const r = deserialize(serialize(e));
  if (!r.ok) throw new Error('노트를 읽지 못했어요');
  const texts = new Map<Id, string>(), labels = new Map<Id, string>(), names = new Map<Id, string>();
  let title: string | null = null, missing = 0;
  segs.forEach((s, i) => {
    const t = out[i];
    if (!t) { missing++; return; }
    if (s.kind === 'title') title = t.split('\n')[0]!.replace(/^#+\s*/, '').trim() || null;
    else if (s.kind === 'text') texts.set(s.id, t);
    else if (s.kind === 'arrow') labels.set(s.id, t.split('\n')[0]!.trim());
    else names.set(s.id, t.split('\n')[0]!.trim());
  });
  const contents = [...r.data.contents].map((c): Content => {
    const t = texts.get(c.id);
    if (t === undefined || !isTextContent(c)) return c;
    const doc = markdownToDoc(t);
    return { ...c, doc: c.role === 'title' ? toTitleDoc(doc) : doc, ai: o.ai };
  });
  // 번역한 글이 든 블록 · 이름을 번역한 화살표 · 묶음에도 출처 — 콘텐츠에만 달면 AI 테두리가 안 보였다 (10/29 교차 검토 N2)
  const aiBlocks = new Set(contents.filter((c) => texts.has(c.id) && isTextContent(c)).map((c) => c.blockId));
  const blocks = [...r.data.blocks].map((b) => (aiBlocks.has(b.id) && !b.ai ? { ...b, ai: o.ai } : b));
  const arrows = [...r.data.arrows].map((a) => (labels.has(a.id) ? { ...a, label: labels.get(a.id)!, ai: a.ai ?? o.ai } : a));
  const groups = r.data.note.groups && Object.fromEntries(Object.entries(r.data.note.groups).map(([id, g]) => [id, names.has(id) ? { ...g, name: names.get(id)!, ai: g.ai ?? o.ai } : g]));
  const note = { ...r.data.note, id: o.id, title: title ?? `${e.note.title.trim() || '제목 없음'} (${o.langLabel})`, createdAt: o.now, updatedAt: o.now, ...(groups ? { groups } : {}) };
  return { engine: new Engine({ ...r.data, note, blocks, contents, arrows }), missing };
}
