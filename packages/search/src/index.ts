// 노트 · 블록 내용 검색 (FR-121, ARCHITECTURE 5.5 · ADR-0010). DOM 없이 동작한다 — 나중에 워커로 옮길 수 있게.
// 한 달 범위: 노트 수천 개 · 블록 글자 수 MB 단위까지는 메모리 안 부분 문자열 검색으로 충분하다.
// BM25 + 한국어 2-gram 색인(검색 워커)은 노트 수가 늘거나 Q&A(P7)가 붙을 때 이 인터페이스 뒤에서 바꾼다.
import { retrievePassages, type Passage } from './retrieve';
import { hashtags, topKeywords } from './keywords';
import { blockTextParts, cellText, footnoteNotes, dbCellTextIn, dbRows, isChartContent, isDatabaseContent, isFileContent, isImageContent, isTableContent, isTextContent, isWebContent, sortedRows, textLines, type Content, type Engine, type Id, type TextNode, isButtonContent, isTabsContent, isDividerContent } from '@dn/engine-core';

/** links: 이 블록이 가리키는 노트 (FR-080 노트 링크) — 백링크(FR-081)를 여기서 찾는다 */
/** kinds: 블록 종류 (검색 필터 FR-122) · ai: AI가 만든 블록 */
export interface SearchBlock { id: Id; text: string; links?: Id[]; kinds?: BlockKind[]; ai?: true }
/**
 * v: 검색 문서 형식 — 다르면 앱이 노트를 다시 읽어 색인한다 (파생 데이터).
 * v4(10/26): 노트 요약 카드용 headings(제목 상자 · 제목 문단 · 이름 붙인 묶음) · keywords(자주 나온 낱말) · hashtags(글 속 #태그) · digest(앱이 붙이는 최소 요약 md)
 */
export interface SearchDoc { noteId: Id; blocks: SearchBlock[]; updatedAt: number; v?: number; headings?: string[]; keywords?: string[]; hashtags?: string[]; digest?: string; ink?: InkText[] }

/**
 * 필기에서 읽은 글 (FR-120): 손글씨를 글로(FR-038 · FR-039) 읽은 결과를 그 획들에 붙여 둔다. 노트 원본이 아니라 색인에만 —
 * 이 기기에만 있다. 검색 · 노트에 묻기에서 '필기' 블록(id = ink:첫 획)으로 걸린다. 획이 모두 지워지면 블록은 빠지고
 * 기록은 gone(지워진 때)을 달고 INK_GONE_KEEP_MS 동안 남는다 — 실행 취소 · 버전 되돌리기로 획이 돌아오면 다시 걸리게 (교차 검토 B3)
 */
export interface InkText { id: string; strokes: Id[]; text: string; at: number; gone?: number }
/** 획이 모두 지워진 필기 기록을 남겨 두는 기간 — 휴지통과 같은 30일 */
export const INK_GONE_KEEP_MS = 30 * 24 * 60 * 60 * 1000;
export const inkRef = (strokeId: Id): string => `ink:${strokeId}`;
export const isInkRef = (id: string): boolean => id.startsWith('ink:');

export const SEARCH_DOC_VERSION = 4;

/** 검색 필터의 블록 종류 */
export type BlockKind = 'title' | 'text' | 'todo' | 'code' | 'table' | 'database' | 'chart' | 'image' | 'file' | 'ink' | 'other';
export const BLOCK_KINDS: { kind: BlockKind; label: string }[] = [
  { kind: 'title', label: '제목 상자' }, { kind: 'text', label: '내용 상자' }, { kind: 'todo', label: '할 일' },
  { kind: 'code', label: '코드' }, { kind: 'table', label: '표' }, { kind: 'database', label: '데이터베이스' }, { kind: 'chart', label: '그래프' }, { kind: 'image', label: '이미지' }, { kind: 'file', label: '첨부 파일' },
  { kind: 'ink', label: '필기 (읽은 글)' },
];

/** 노트 하나의 검색 문서: 블록마다 글자를 모은다 (제목 상자 · 내용 상자 · 접힌 토글 · 표 · 그래프 글자 포함) + 필기에서 읽은 글 */
export function extractSearchDoc(engine: Engine, updatedAt = Date.now(), ink: readonly InkText[] = [], now = Date.now()): SearchDoc {
  const blocks: SearchBlock[] = [];
  const headings: string[] = [];
  for (const g of Object.values(engine.note.groups ?? {})) if (g.name?.trim()) headings.push(g.name.trim());
  for (const b of engine.blocks()) {
    const contents = engine.contentsOf(b.id);
    const { title, bodies } = blockTextParts(contents);
    const head = title ? textLines(title.doc).find((l) => l.trim())?.trim() : '';
    if (head) headings.push(head);
    for (const c of bodies) collectHeadings(c.doc, headings);
    const parts: string[] = [];
    for (const c of title ? [title, ...bodies] : bodies) parts.push(...textLines(c.doc).filter((l) => l.trim()), ...footnoteNotes(c.doc)); // 각주 글도 찾기에
    for (const c of contents) if (!isTextContent(c)) parts.push(...dataStrings(c, engine));
    if (b.caption) parts.push(b.caption); // 그림 · 표 캡션도 찾기에
    const text = parts.join('\n');
    const links = new Set<Id>();
    for (const c of contents) if (isTextContent(c)) collectLinks(c.doc, links);
    // 블록 임베드 (FR-082)도 그 노트를 가리키는 링크
    for (const c of contents) if (c.type === 'embed' && typeof (c as { srcNote?: unknown }).srcNote === 'string') links.add((c as unknown as { srcNote: Id }).srcNote);
    const kinds = blockKinds(contents);
    const ai = !!b.ai || contents.some((c) => c.ai);
    if (text.trim() || kinds.some((k) => k !== 'text' && k !== 'title')) {
      blocks.push({ id: b.id, text, ...(links.size ? { links: [...links] } : {}), ...(kinds.length ? { kinds } : {}), ...(ai ? { ai: true as const } : {}) });
    }
  }
  // 필기에서 읽은 글: 획이 하나라도 남아 있으면 블록. 모두 지워졌으면 기록만 (지워진 때부터 INK_GONE_KEEP_MS까지).
  // 같은 글이 이미 글 상자에 있으면(글 상자로 바꾸기 · 아래에 넣기) 겹치니 블록은 빼고 기록만 둔다
  const kept = ink.flatMap((x): InkText[] => {
    const { gone, ...rest } = x;
    if (x.strokes.some((id) => engine.getStroke(id))) return [rest];
    const at = gone ?? now;
    return now - at < INK_GONE_KEEP_MS ? [{ ...rest, gone: at }] : [];
  });
  const alive = kept.filter((x) => x.gone === undefined);
  const flat = (t: string) => normalize(t).replace(/\s+/g, '');
  const all = flat(blocks.map((b) => b.text).join(''));
  for (const x of alive) if (x.text.trim() && !all.includes(flat(x.text))) blocks.push({ id: x.id, text: x.text, kinds: ['ink'] });
  const heads = [...new Set(headings.map((h) => h.slice(0, 60)))].slice(0, 30);
  // 글 속 #태그는 노트 태그가 된다 — 필기에서 읽은 글(AI가 읽은 손글씨, 노트 원본에 없음)은 빼고 (교차 검토 B8)
  const tags = hashtags(blocks.filter((b) => !b.kinds?.includes('ink')).map((b) => b.text).join('\n'));
  const keywords = topKeywords({ title: engine.note.title, headings: heads, texts: blocks.map((b) => b.text) }, 10, tags);
  return { noteId: engine.note.id, blocks, updatedAt, v: SEARCH_DOC_VERSION, headings: heads, keywords, hashtags: tags, ...(kept.length ? { ink: kept } : {}) };
}

/** 본문 속 제목 문단(제목 1~4) 글 */
function collectHeadings(n: TextNode, out: string[]): void {
  if (n.type === 'heading') { const t = textLines({ type: 'doc', content: [n] } as never).join(' ').trim(); if (t) out.push(t); return; }
  for (const k of n.content ?? []) collectHeadings(k, out);
}

function blockKinds(contents: readonly Content[]): BlockKind[] {
  const out = new Set<BlockKind>();
  for (const c of contents) {
    if (!isTextContent(c)) {
      out.add(c.type === 'table' || c.type === 'database' || c.type === 'chart' || c.type === 'image' || c.type === 'file' ? c.type : 'other');
      continue;
    }
    out.add(c.role === 'title' ? 'title' : 'text');
    const walk = (n: TextNode) => {
      if (n.type === 'task_item') out.add('todo');
      else if (n.type === 'code_block') out.add('code');
      for (const k of n.content ?? []) walk(k);
    };
    walk(c.doc);
  }
  return [...out];
}

function collectLinks(n: TextNode, out: Set<Id>): void {
  if (n.type === 'note_link' && typeof n.attrs?.id === 'string') out.add(n.attrs.id);
  for (const k of n.content ?? []) collectLinks(k, out);
}

const META_KEYS = new Set(['id', 'blockId', 'order', 'frame', 'ai', 'type', 'schema', 'chartKind', 'role']);

/** 표 · 그래프처럼 이 빌드가 렌더하지 않는 콘텐츠의 글자 값 (제목 · 열 이름 · 칸 · 계열 이름 · 값) */
function dataStrings(c: Content, engine: Engine): string[] {
  // v4 표: 제목 · 열 이름 한 줄 · 행마다 한 줄 (셀은 텍스트 문서)
  if (isTableContent(c)) {
    return [c.title ?? '', c.columns.map((x) => x.name).join(' · '),
      ...sortedRows(c).map((r) => c.columns.map((x) => cellText(r.cells[x.id])).join(' · '))].filter((s) => s.trim());
  }
  // v4 그래프: 제목 · 단위 · 계열 이름 · 값
  if (isChartContent(c)) {
    return [c.title ?? '', c.unit ?? '', ...c.series.map((s) => `${s.name}: ${s.points.map((p) => `${p.x} ${p.y}`).join(', ')}`)].filter((s) => s.trim());
  }
  // 데이터베이스: 이름 · 속성 이름 한 줄 · 항목마다 한 줄 (보이는 글자 — 선택은 옵션 이름)
  if (isDatabaseContent(c)) {
    return [c.title ?? '', c.properties.map((p) => p.name).join(' · '),
      ...dbRows(c).map((r) => c.properties.map((p) => dbCellTextIn(engine, c, r, p)).filter(Boolean).join(' · '))].filter((s) => s.trim());
  }
  // 웹 북마크 · 임베드: 제목 · 설명 · 주소
  if (isWebContent(c)) return [c.title ?? '', c.description ?? '', c.url].filter((s) => s.trim());
  // 첨부 파일: 이름만
  if (isFileContent(c)) return [c.name];
  // 탭: 탭 이름 · 글 (모든 탭), 버튼: 이름만 (넣을 상자는 누르면 생기는 것)
  if (isTabsContent(c)) return c.tabs.flatMap((t) => [t.label, ...textLines(t.doc).filter((l) => l.trim())]);
  if (isButtonContent(c)) return [c.label];
  if (isDividerContent(c)) return c.label ? [c.label] : []; // 구분선은 가운데 글만
  // 이미지: 대체 글만 (첨부 해시 · 크기는 검색 대상이 아니다)
  if (isImageContent(c)) return c.alt ? [c.alt] : [];
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === 'string') { if (v.trim()) out.push(v); }
    else if (typeof v === 'number') out.push(String(v));
    else if (Array.isArray(v)) {
      // 표의 한 행 · 열 이름 목록은 한 줄로
      if (v.length && v.every((x) => typeof x === 'string' || typeof x === 'number')) out.push(v.join(' · '));
      else for (const x of v) walk(x);
    } else if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x);
  };
  for (const [k, v] of Object.entries(c)) if (!META_KEYS.has(k)) walk(v);
  return out;
}

function normalize(s: string): string {
  return s.normalize('NFC').toLowerCase();
}

export interface NoteInfo { id: Id; title: string; updatedAt: number }

/** 블록 조건 (검색 필터): 이 종류가 들어 있는 블록 · AI가 만든 블록만 */
export interface BlockFilter { kind?: BlockKind; ai?: boolean }

export interface SearchHit {
  noteId: Id;
  /** 노트 제목에 걸렸는가 */
  inTitle: boolean;
  /** 걸린 블록 (최대 3개) — 앞뒤 문맥이 붙은 한 줄 */
  blocks: { id: Id; snippet: string; ranges: [number, number][] }[];
  /** 걸린 블록 수 (잘리기 전) */
  blockCount: number;
  score: number;
}

const CONTEXT = 28;

/** 검색어를 공백으로 나눈 낱말 (중복 · 빈 것 제외) */
export function terms(q: string): string[] {
  return [...new Set(normalize(q).split(/\s+/).filter(Boolean))];
}

/** 블록 글에서 낱말이 처음 걸린 줄을 앞뒤 문맥과 함께 자른다. ranges는 snippet 안의 걸린 구간들. */
export function snippet(text: string, ts: readonly string[]): { snippet: string; ranges: [number, number][] } {
  const low = normalize(text);
  let at = -1, len = 0;
  for (const t of ts) {
    const i = low.indexOf(t);
    if (i >= 0 && (at < 0 || i < at)) { at = i; len = t.length; }
  }
  if (at < 0) return { snippet: text.slice(0, CONTEXT * 2).replace(/\n/g, ' '), ranges: [] };
  const lineStart = text.lastIndexOf('\n', at) + 1;
  const nl = text.indexOf('\n', at + len);
  const lineEnd = nl < 0 ? text.length : nl;
  const from = Math.max(lineStart, at - CONTEXT);
  const to = Math.min(lineEnd, at + len + CONTEXT);
  const pre = from > lineStart ? '…' : '';
  const post = to < lineEnd ? '…' : '';
  const body = text.slice(from, to);
  const ranges: [number, number][] = [];
  const lowBody = normalize(body);
  for (const t of ts) {
    let i = lowBody.indexOf(t);
    while (i >= 0) { ranges.push([pre.length + i, pre.length + i + t.length]); i = lowBody.indexOf(t, i + t.length); }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  return { snippet: pre + body + post, ranges };
}

/** 백링크 한 건: 링크를 건 노트와 그 블록들 (블록 글자가 앞뒤 문맥) */
export interface Backlink { noteId: Id; blocks: { id: Id; text: string }[] }

/** 메모리 색인: 노트별 검색 문서. 낱말이 모두 들어 있는 블록(제목에 있는 낱말은 면제)을 찾는다 (AND). */
export class SearchIndex {
  private readonly docs = new Map<Id, (SearchBlock & { low: string })[]>();
  /** 노트 요약 카드 정보 (범위 산정 · 노트 정보 패널) */
  private readonly cards = new Map<Id, { headings: string[]; keywords: string[]; hashtags: string[]; digest?: string }>();

  /** 필기에서 읽은 글 — 검색 문서를 다시 만들어도(편집 · 형식 판 · 색인 다시 만들기) 이어지게 따로 든다 */
  private readonly inks = new Map<Id, InkText[]>();

  has(noteId: Id): boolean { return this.docs.has(noteId); }

  put(doc: SearchDoc): void {
    this.docs.set(doc.noteId, doc.blocks.map((b) => ({ ...b, low: normalize(b.text) })));
    this.cards.set(doc.noteId, { headings: doc.headings ?? [], keywords: doc.keywords ?? [], hashtags: doc.hashtags ?? [], ...(doc.digest ? { digest: doc.digest } : {}) });
    this.keepInk(doc.noteId, doc.ink ?? []);
  }

  remove(noteId: Id): void { this.docs.delete(noteId); this.cards.delete(noteId); this.inks.delete(noteId); }

  /** 이 노트의 필기에서 읽은 글 (다음 검색 문서에 넘긴다) */
  inkOf(noteId: Id): readonly InkText[] { return this.inks.get(noteId) ?? []; }
  keepInk(noteId: Id, ink: readonly InkText[]): void { if (ink.length) this.inks.set(noteId, [...ink]); else this.inks.delete(noteId); }
  /** 새로 읽은 필기 — 같은 획을 읽은 예전 기록은 바꾼다 */
  addInk(noteId: Id, x: InkText): void {
    const ids = new Set(x.strokes);
    this.keepInk(noteId, [...this.inkOf(noteId).filter((o) => !o.strokes.some((id) => ids.has(id))), x]);
  }

  /** 노트 요약 카드 정보 (색인에 없으면 undefined) */
  card(noteId: Id): { headings: string[]; keywords: string[]; hashtags: string[]; digest?: string } | undefined { return this.cards.get(noteId); }

  /** 질문의 근거 조각 (FR-116, retrieve.ts) — `notes`: 범위 안의 노트(휴지통 · 잠긴 노트는 호출 측이 뺀다) */
  passages(question: string, notes: readonly NoteInfo[], k = 8): Passage[] {
    return retrievePassages(question, notes.map((note) => ({ note, blocks: this.docs.get(note.id) ?? [] })), k);
  }

  /** 이 노트가 링크한 노트들 (FR-083 그래프) — 블록마다의 링크를 합친 것 */
  linksFrom(noteId: Id): Id[] {
    const out = new Set<Id>();
    for (const b of this.docs.get(noteId) ?? []) for (const l of b.links ?? []) out.add(l);
    return [...out];
  }

  /** `noteId`를 링크한 노트들 (`notes`에 든 노트만 — 휴지통은 호출 측이 뺀다). 최근 수정 순 */
  backlinks(noteId: Id, notes: readonly NoteInfo[]): Backlink[] {
    const out: (Backlink & { at: number })[] = [];
    for (const n of notes) {
      if (n.id === noteId) continue;
      const blocks = (this.docs.get(n.id) ?? []).filter((b) => b.links?.includes(noteId)).map((b) => ({ id: b.id, text: b.text }));
      if (blocks.length) out.push({ noteId: n.id, blocks, at: n.updatedAt });
    }
    return out.sort((a, b) => b.at - a.at).map(({ at: _at, ...r }) => r);
  }

  /**
   * `notes`: 검색 대상 노트(휴지통 · 잠긴 노트는 호출 측이 뺀다)와 표시 제목.
   * 점수: 제목 일치 +10, 걸린 블록마다 +1(최대 10), 최근 수정이 동점을 가른다.
   * `filter`: 블록 조건(종류 · AI 생성)이 있으면 그 조건에 맞는 블록이 걸린 노트만. `all`: 검색어 없이도
   * 목록을 낸다 (태그 · 기간 · 폴더 필터만 건 경우 — 노트 범위는 호출 측이 `notes`로 좁힌다).
   */
  query(q: string, notes: readonly NoteInfo[], limit = 50, filter: BlockFilter & { all?: boolean } = {}): SearchHit[] {
    const ts = terms(q);
    const blockCond = !!(filter.kind || filter.ai);
    if (!ts.length && !blockCond && !filter.all) return [];
    const pass = (b: SearchBlock) => (!filter.kind || !!b.kinds?.includes(filter.kind)) && (!filter.ai || !!b.ai);
    const hits: SearchHit[] = [];
    for (const n of notes) {
      const title = normalize(n.title);
      const inTitle = ts.length > 0 && ts.every((t) => title.includes(t));
      const blocks = (this.docs.get(n.id) ?? []).filter(pass);
      const matched = !ts.length ? (blockCond ? blocks : [])
        : blocks.filter((b) => ts.some((t) => b.low.includes(t)) && ts.every((t) => b.low.includes(t) || title.includes(t)));
      if (blockCond ? !matched.length : ts.length > 0 && !inTitle && !matched.length) continue;
      hits.push({
        noteId: n.id, inTitle, blockCount: matched.length,
        blocks: matched.slice(0, 3).map((b) => ({ id: b.id, ...snippet(b.text, ts) })),
        score: (inTitle ? 10 : 0) + Math.min(matched.length, 10) + n.updatedAt / 1e15,
      });
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}

export { questionTerms, retrievePassages, type Passage } from './retrieve';
export { hashtags, keywordTokens, topKeywords, wordMatch } from './keywords';
export { BUILTIN_ROLES, guessRole, narrowScope, noteDigest, scopeStages, type NoteRole, type ScopeNote, type ScopeResult } from './scope';
