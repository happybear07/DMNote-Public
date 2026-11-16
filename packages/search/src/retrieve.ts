// 질문 → 근거 조각 (FR-116 · 118, AI-PROMPTS 11절 · ADR-0010): 검색(FR-121)은 낱말이 모두 든 블록(AND)을 찾지만,
// 질문은 문장이라 조사 · 어미가 붙고 낱말이 다 들어 있지 않다 — 조사를 떼고, 걸린 낱말이 많은 블록부터(OR) 고른다.
// 조각 = 블록 글 하나(최대 maxChars), 같은 노트에서 너무 많이 가져오지 않게 노트당 4개까지.
import type { Id } from '@dn/engine-core';

/** 끝에 붙는 조사 · 흔한 어미 (긴 것부터) */
const TAIL = /(으로서|으로써|에서는|에서도|으로는|이라는|에게서|까지는|부터는|이었나요|였나요|인가요|했나요|했어요|입니까|인지|에서|에게|까지|부터|으로|이나|이랑|하고|처럼|보다|에는|에도|라는|은|는|이|가|을|를|의|에|로|와|과|도|만|요)$/;
const STOP = new Set(['무엇', '뭐', '뭘', '어떻게', '언제', '어디', '누가', '누구', '왜', '어떤', '알려줘', '알려', '정리', '대해', '관련', '있나', '있어', '있는', '했던', '그리고', '그', '이', '저', 'what', 'how', 'when', 'where', 'who', 'why', 'the', 'is', 'are', 'did', 'does', 'about']);

/** 낱말 하나의 줄기 — 끝에 붙은 조사 · 흔한 어미를 두 번까지 뗀다 (줄기가 두 글자 미만이 되면 떼지 않는다) */
export function stem(word: string): string {
  let w = word;
  for (let i = 0; i < 2; i++) { const s = w.replace(TAIL, ''); if (s.length >= 2 && s !== w) w = s; else break; }
  return w;
}
export const isStopWord = (w: string): boolean => STOP.has(w);

/** 질문 → 찾을 낱말 (조사를 뗀 줄기, 두 글자 이상) */
export function questionTerms(q: string): string[] {
  const out = new Set<string>();
  for (const raw of q.normalize('NFC').toLowerCase().split(/[\s,.!?;:()"'“”‘’·…~#]+/)) {
    if (!raw) continue;
    const w = stem(raw);
    if (w.length >= 2 && !STOP.has(w)) out.add(w);
  }
  return [...out];
}

export interface Passage {
  readonly noteId: Id;
  readonly noteTitle: string;
  readonly blockId: Id;
  readonly text: string;
  readonly updatedAt: number;
  /** 답변 인용이 가리키는 곳 "노트id#블록id" */
  readonly ref: string;
}

/** 노트별 블록 (색인에서) */
export interface RetrieveSource { readonly note: { id: Id; title: string; updatedAt: number }; readonly blocks: readonly { id: Id; text: string; low: string }[] }

export function retrievePassages(question: string, sources: Iterable<RetrieveSource>, k = 8, maxChars = 1500): Passage[] {
  const ts = questionTerms(question);
  if (!ts.length) return [];
  const scored: { p: Passage; score: number }[] = [];
  for (const { note, blocks } of sources) {
    const title = note.title.normalize('NFC').toLowerCase();
    const titleHits = ts.filter((t) => title.includes(t)).length;
    for (const b of blocks) {
      if (!b.text.trim()) continue;
      const hits = ts.filter((t) => b.low.includes(t));
      if (!hits.length && !titleHits) continue;
      // 걸린 낱말 수가 먼저, 긴 낱말(더 구체적)이 조금 더, 제목에 걸리면 덤
      const score = hits.length * 10 + hits.reduce((s, t) => s + Math.min(t.length, 6), 0) + titleHits * 4;
      if (!hits.length && titleHits < ts.length) continue;
      scored.push({ p: { noteId: note.id, noteTitle: note.title, blockId: b.id, text: b.text.length > maxChars ? `${b.text.slice(0, maxChars)}…` : b.text, updatedAt: note.updatedAt, ref: `${note.id}#${b.id}` }, score: score + note.updatedAt / 1e15 });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  const perNote = new Map<Id, number>();
  const out: Passage[] = [];
  for (const { p } of scored) {
    const n = perNote.get(p.noteId) ?? 0;
    if (n >= 4) continue;
    perNote.set(p.noteId, n + 1);
    out.push(p);
    if (out.length >= k) break;
  }
  return out;
}
