// 직렬화 · 스키마 버전 · 마이그레이션 (ENGINE 12장, FR-006 · FR-090).
// 엔티티 레코드는 그대로 저장한다. 모르는 필드는 레코드에 남아 있으므로 왕복 시 보존된다 (12.4).
import { Engine, type DocData } from './engine';
import { isId, newId } from './id';
import { isBlockEnd, validEnd, type Arrow, type Block, type Content, type Note, type StrokeRecord, type TextDoc } from './model';
import { bodyDoc, isBlankDoc, mergeTitleBody, titleDoc } from './text-doc';
import { compareByOrder, keyBetween } from './order';
import { upgradeV0Content } from './rich';

/**
 * v2 (2026-10-02): 텍스트 블록을 제목 칸 + 본문 칸으로 나눔 (`TextContent.role`)
 * v3 (2026-10-02): 블록 = 제목 상자 또는 내용 상자 — 텍스트 블록 하나에 텍스트 콘텐츠 하나
 * v4 (2026-10-03): 표 · 그래프 정식 형식 · v5 (2026-10-04): 데이터베이스 블록
 * v6 (2026-10-07): 의미와 모양을 따로 — 화살표 relation · 블록 nodeKind · 묶음 kind, 출처 ai.origin · editedAt, 묶음 끝 화살표(Anchor.groupId),
 *   화살표 모양 style.line/head/tail/width/route (docs/review/V6-SCHEMA-REVIEW.md). 전부 선택 필드라 변환은 항등
 */
export const SCHEMA_VERSION = 6;
export const TEXT_SCHEMA = 'pm-v1';

export interface NoteSnapshot {
  schemaVersion: number;
  engine: { textSchema: string };
  note: Note;
  blocks: Record<string, Block>;
  contents: Record<string, Content>;
  arrows: Record<string, Arrow>;
  strokes: Record<string, StrokeRecord>;
  [extra: string]: unknown;
}

export type DeserializeResult =
  | { ok: true; data: DocData; migratedFrom?: number; extra: Record<string, unknown>; newer?: number }
  | { ok: false; reason: 'newer-version'; version: number }
  | { ok: false; reason: 'invalid'; errors: string[] };

/** v(N) 스냅샷 → v(N+1) 스냅샷 */
const migrations = new Map<number, (s: Record<string, unknown>) => Record<string, unknown>>();

type TextRec = Content & { role?: string; doc?: TextDoc };

/** 콘텐츠 사본과, 블록별 텍스트 콘텐츠 목록(order 순) — v1 · v2 마이그레이션 공통 */
function textsByBlock(s: Record<string, unknown>): { contents: Record<string, TextRec>; lists: TextRec[][] } {
  const contents = { ...(s.contents as Record<string, TextRec>) };
  const byBlock = new Map<string, TextRec[]>();
  for (const c of Object.values(contents)) {
    if (c.type !== 'text') continue;
    const list = byBlock.get(c.blockId) ?? [];
    list.push(c);
    byBlock.set(c.blockId, list);
  }
  return { contents, lists: [...byBlock.values()].map((l) => l.sort(compareByOrder)) };
}

// ───────── v1 → v2: 제목 칸 분리 ─────────
// 블록마다 첫 텍스트 콘텐츠(order 순)가 "heading + 본문" 한 문서였다. 첫 heading을 새 제목 칸으로 떼어 내고
// 원래 콘텐츠(같은 id)는 본문 칸이 된다 — id를 유지해야 AI 출처(contentId) 같은 참조가 끊기지 않는다.
// 같은 블록의 나머지 텍스트 콘텐츠는 본문 칸. 텍스트가 없는 블록은 그대로 둔다.
migrations.set(1, (s) => {
  const { contents, lists } = textsByBlock(s);
  for (const list of lists) {
    list.forEach((c, i) => {
      if (i > 0) { contents[c.id] = { ...c, role: 'body' }; return; }
      const parts = splitTitle(c.doc as TextDoc);
      const titleId = newId();
      contents[titleId] = { id: titleId, blockId: c.blockId, type: 'text', role: 'title', order: keyBetween(null, c.order), doc: parts.title } as Content;
      contents[c.id] = { ...c, role: 'body', doc: parts.body };
    });
  }
  return { ...s, contents };
});

// ───────── v2 → v3: 블록 = 제목 상자 또는 내용 상자 ─────────
// 한 블록에 제목 칸 + 본문 칸이 같이 있던 것을 상자 하나로: 본문이 비면 제목 상자, 제목이 비면 내용 상자,
// 둘 다 있으면 내용 상자(제목은 맨 앞 제목3 줄로 합침 — 글자를 잃지 않는다). 본문 칸 id를 남겨 AI 출처 참조를 지킨다.
migrations.set(2, (s) => {
  const { contents, lists } = textsByBlock(s);
  for (const list of lists) {
    const title = list.find((c) => c.role === 'title');
    const bodies = list.filter((c) => c !== title);
    if (!title || !bodies.length) continue;
    const first = bodies[0]!;
    const titleBlank = isBlankDoc(title.doc as TextDoc);
    const bodyBlank = bodies.every((b) => isBlankDoc(b.doc as TextDoc));
    if (bodyBlank && !titleBlank) {
      for (const b of bodies) delete contents[b.id];
    } else {
      delete contents[title.id];
      if (!titleBlank) contents[first.id] = { ...first, role: 'body', doc: mergeTitleBody(title.doc as TextDoc, first.doc as TextDoc) };
    }
  }
  return { ...s, contents };
});

// ───────── v3 → v4: 표 · 그래프 정식 형식 (FR-018) ─────────
// AI가 만든 임시 형식(table-v0: 열 이름 · 행 글자 배열, chart-v0: chartKind)을 v4 형식으로 — 표 셀은 텍스트 문서, 행 · 열 · 계열에 id.
// 필드 추가 · 이름 정리뿐이라 다른 콘텐츠는 그대로다 (DATABASE 9.2 "v4~v8은 필드 추가만").
migrations.set(3, (s) => {
  const contents: Record<string, unknown> = {};
  for (const [id, c] of Object.entries((s.contents ?? {}) as Record<string, Record<string, unknown>>)) contents[id] = upgradeV0Content(c);
  return { ...s, contents };
});

// ───────── v4 → v5: 데이터베이스 블록 (FR-055) ─────────
// 새 콘텐츠 타입 'database'(속성 · 항목)만 더해진다 — 기존 데이터는 그대로. v4 앱은 데이터베이스를 모르는 콘텐츠로 보존한다.
migrations.set(4, (s) => s);

// ───────── v5 → v6: 의미 · 출처 · 모양 필드 (선택 필드만) ─────────
// 값을 추정해 써 넣지 않는다 — v5 화살표의 relation · 블록의 nodeKind는 "미정", ai.origin 없음 = claude로 읽는다.
// style.dash도 그대로 두고 읽을 때 line이 없으면 점선으로 본다(relations.ts effectiveStyle). 버전을 올리는 이유:
// v5 앱이 v6 노트를 읽기 전용으로 열게 해서, 모르는 묶음 끝 화살표 · 의미 필드를 망가뜨리지 않게.
migrations.set(5, (s) => s);

const KNOWN_TOP = new Set(['schemaVersion', 'engine', 'note', 'blocks', 'contents', 'arrows', 'strokes']);

/** `asVersion`: 구버전 형태 그대로인 엔진을 그 버전으로 표시해 내보낸다 (마이그레이션 전 단계 전용). */
export function serialize(engine: Engine, extra: Record<string, unknown> = {}, asVersion = SCHEMA_VERSION): NoteSnapshot {
  // id 순으로 정렬해 같은 문서는 항상 같은 스냅샷이 되게 한다 (비교 · diff · 테스트).
  const rec = <T extends { id: string }>(it: Iterable<T>) => {
    const o: Record<string, T> = {};
    for (const v of [...it].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) o[v.id] = v;
    return o;
  };
  return {
    ...extra,
    schemaVersion: asVersion,
    engine: { textSchema: TEXT_SCHEMA },
    note: { ...engine.note, updatedAt: Math.max(engine.note.updatedAt, engine.updatedAt) },
    blocks: rec(engine.blocks()),
    contents: rec(engine.contents()),
    arrows: rec(engine.arrows()),
    strokes: rec(engine.strokes()),
  };
}

/**
 * @param opts.allowNewer 상위 버전 스냅샷도 열린 파싱으로 읽는다 — 호출자는 반드시 읽기 전용으로 열어야 한다 (FR-090).
 *   모르는 필드는 레코드에 남지만 저장은 막혀 있으므로 데이터가 바뀌지 않는다.
 */
export function deserialize(input: unknown, opts: { allowNewer?: boolean; noMigrate?: boolean } = {}): DeserializeResult {
  if (typeof input !== 'object' || input === null) return { ok: false, reason: 'invalid', errors: ['스냅샷이 객체가 아님'] };
  let s = input as Record<string, unknown>;
  const v = s.schemaVersion;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) return { ok: false, reason: 'invalid', errors: ['schemaVersion 없음'] };
  if (v > SCHEMA_VERSION && !opts.allowNewer) return { ok: false, reason: 'newer-version', version: v };
  const newer = v > SCHEMA_VERSION ? v : undefined;
  let migratedFrom: number | undefined;
  // noMigrate: 구버전 그대로 읽는다 — 저장소가 구버전 연산 로그를 먼저 재생한 뒤 마이그레이션할 때 (storage-idb openNote)
  for (let cur = v; !opts.noMigrate && cur < SCHEMA_VERSION; cur++) {
    const m = migrations.get(cur);
    if (!m) return { ok: false, reason: 'invalid', errors: [`v${cur} → v${cur + 1} 마이그레이션 없음`] };
    s = m(structuredClone(s));
    migratedFrom ??= v;
  }

  const errors: string[] = [];
  const note = s.note as Note | undefined;
  if (!note || !isId(note.id)) errors.push('note.id 형식 오류');
  const pick = <T>(key: string): T[] => {
    const o = s[key];
    if (o === undefined) return [];
    if (typeof o !== 'object' || o === null || Array.isArray(o)) { errors.push(`${key} 형식 오류`); return []; }
    // for-in: Object.entries는 1만 건마다 [키, 값] 배열을 만들어 열기 시간의 절반을 쓴다 (FR-008 벤치)
    const out: T[] = [];
    const rec = o as Record<string, unknown>;
    for (const id in rec) {
      const r = rec[id];
      if (!r || typeof r !== 'object' || (r as { id?: unknown }).id !== id) { errors.push(`${key}.${id} id 불일치`); continue; }
      out.push(r as T);
    }
    return out;
  };
  const blocks = pick<Block>('blocks');
  const contents = pick<Content>('contents');
  const arrows = pick<Arrow>('arrows');
  const strokes = pick<StrokeRecord>('strokes');

  // O(n) 구조 검증: 참조 무결성 (I1 · I2)
  const blockIds = new Set(blocks.map((b) => b.id));
  for (const c of contents) if (!blockIds.has(c.blockId)) errors.push(`content ${c.id}: 블록 ${c.blockId} 없음`);
  for (const a of arrows) {
    // 끝은 있는 상자 또는 빈 곳의 점 (11/09)
    if (![a.from, a.to].every((an) => validEnd(an) && (!isBlockEnd(an) || blockIds.has(an.blockId)))) errors.push(`arrow ${a.id}: 블록 없음`);
  }
  if (errors.length) return { ok: false, reason: 'invalid', errors };

  const extra: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(s)) if (!KNOWN_TOP.has(k)) extra[k] = val;
  return { ok: true, data: { note: note!, blocks, contents, arrows, strokes }, migratedFrom, extra, newer };
}

/**
 * (스키마 v1 → v2 변환 전용) 제목 + 본문이 한 문서에 있는 형태를 두 칸으로 나눈다.
 * 첫 노드가 제목(heading)이면 그 글자가 제목, 나머지가 본문. 아니면 제목은 비고 문서 전체가 본문.
 */
function splitTitle(doc: TextDoc): { title: TextDoc; body: TextDoc } {
  const [first, ...rest] = doc.content;
  if (first?.type !== 'heading') return { title: titleDoc(''), body: doc.content.length ? doc : bodyDoc('') };
  return {
    title: titleDoc((first.content ?? []).filter((n) => n.type !== 'hard_break')),
    body: rest.length ? { type: 'doc', content: rest } : bodyDoc(''),
  };
}
