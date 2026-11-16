// 노트에 묻기 범위 좁히기 (2026-10-26 요청): 질문이 오면 모든 노트의 블록을 훑지 않고, 먼저 후보 노트를 고른 뒤 그 안에서만 근거를 찾는다.
//   1) 역할 · 태그 — 질문 낱말이 노트 역할(회의록 · 강의 필기 …)의 낱말이나 노트 태그(#결제)에 걸리면 그 노트만
//   2) 요약 카드 — 1)이 비면 노트마다 제목 · 역할 · 태그 · 소제목 · 키워드만 모은 최소 요약(noteDigest)에서 걸린 노트만
//   3) 둘 다 비면 범위 없음 — 앱은 Claude를 부르지 않고 알린다
// 모두 기기 안 계산(토큰 없음). 근거 블록 고르기는 retrieve.ts 그대로.
import type { Id } from '@dn/engine-core';
import { hashtags, keywordTokens, wordMatch } from './keywords';
import { questionTerms } from './retrieve';

/** 노트 역할: 이름 · 질문에서 이 역할을 가리키는 낱말. builtin = 앱 기본 역할(이름 · 낱말을 바꾸지 않는다) */
export interface NoteRole { readonly id: string; readonly name: string; readonly keywords: readonly string[]; readonly builtin?: true }

/** 기본 역할 — 템플릿(회의록 · 강의 필기 · 리서치 · 주간 계획)과 같은 이름 */
export const BUILTIN_ROLES: readonly NoteRole[] = [
  { id: 'meeting', name: '회의록', keywords: ['회의', '회의록', '미팅', '안건', '논의', '결정', '참석', '액션'], builtin: true },
  { id: 'lecture', name: '강의 필기', keywords: ['강의', '강의록', '수업', '필기', '시험', '과제', '교수', '개념'], builtin: true },
  { id: 'research', name: '리서치', keywords: ['리서치', '조사', '자료', '논문', '출처', '분석', '비교'], builtin: true },
  { id: 'weekly', name: '주간 계획', keywords: ['주간', '계획', '이번주', '다음주', '요일', '회고', '목표'], builtin: true },
];

/** 역할을 가리키는 낱말 (이름의 낱말 + 지정 낱말, 소문자 줄기) */
const roleWords = (r: NoteRole): string[] => [...new Set([...keywordTokens(r.name), ...r.keywords.flatMap((k) => keywordTokens(k))])];

/**
 * 역할 추정 (직접 정한 역할이 없을 때): 제목에 역할 낱말이 걸리면 3점, 소제목에 걸린 서로 다른 낱말마다 1점 — 3점 이상인 역할 중 가장 높은 것.
 * 예) 소제목 "안건 · 논의 · 결정 사항" → 회의록
 */
export function guessRole(title: string, headings: readonly string[], roles: readonly NoteRole[]): string | undefined {
  const tt = keywordTokens(title), ht = [...new Set(headings.flatMap((h) => keywordTokens(h)))];
  let best: { id: string; score: number } | null = null;
  for (const r of roles) {
    const ws = roleWords(r);
    const inTitle = ws.some((w) => tt.some((t) => wordMatch(t, w)));
    const inHeads = ws.filter((w) => ht.some((t) => wordMatch(t, w))).length;
    const score = (inTitle ? 3 : 0) + inHeads;
    if (score >= 3 && (!best || score > best.score)) best = { id: r.id, score };
  }
  return best?.id;
}

/** 범위 산정에 쓰는 노트 정보 (블록 글 없이 — 요약 카드 수준) */
export interface ScopeNote {
  readonly id: Id;
  readonly title: string;
  readonly updatedAt: number;
  /** 직접 정한 역할 또는 추정 역할 */
  readonly role?: string;
  readonly tags: readonly string[];
  readonly headings: readonly string[];
  readonly keywords: readonly string[];
}

export interface ScopeResult {
  /** 후보 노트 (점수 · 최근 순) */
  readonly ids: Id[];
  readonly via: 'role-tag' | 'digest' | 'none';
  /** 질문에 걸린 역할 이름 · 태그 이름 */
  readonly roles: string[];
  readonly tags: string[];
  /** 답 위 · Claude에 알려 줄 범위 설명 */
  readonly label: string;
}

/**
 * 질문 → 범위 단계들 (비지 않은 것만, 좁은 것부터): [역할 · 태그], [요약 카드]. 앱은 앞 단계에서 근거가 안 나오면 다음 단계로 넘어가고,
 * 모두 비면 Claude를 부르지 않는다. `cap`: 요약 카드 단계에서 고를 노트 수 상한
 */
export function scopeStages(question: string, notes: readonly ScopeNote[], roles: readonly NoteRole[], cap = 12): ScopeResult[] {
  const ts = [...new Set([...questionTerms(question), ...hashtags(question).map((h) => h.toLowerCase())])];
  if (!ts.length) return [];
  const hit = (words: readonly string[]) => words.some((w) => ts.some((t) => wordMatch(t, w)));
  const out: ScopeResult[] = [];

  // 1) 역할 · 태그
  const hitRoles = roles.filter((r) => hit(roleWords(r)));
  const roleIds = new Set(hitRoles.map((r) => r.id));
  // 같은 태그 이름이 여러 노트에 되풀이된다 — 이름마다 낱말을 한 번만 쪼갠다
  const tagWordsOf = new Map<string, string[]>();
  const tagWords = (g: string) => {
    let w = tagWordsOf.get(g);
    if (!w) { const k = keywordTokens(g); tagWordsOf.set(g, (w = k.length ? k : [g.toLowerCase()])); }
    return w;
  };
  // 노트마다 질문에 걸린 태그 — 거르기 · 정렬 점수 · 범위 설명이 같이 쓰므로 한 번만 센다
  const tagHits = new Map(notes.map((n) => [n, n.tags.filter((g) => hit(tagWords(g)))]));
  const byRole = notes.filter((n) => n.role && roleIds.has(n.role));
  const byTag = notes.filter((n) => tagHits.get(n)!.length);
  let picked: ScopeNote[];
  if (byRole.length && byTag.length) {
    const tagSet = new Set(byTag.map((n) => n.id));
    const both = byRole.filter((n) => tagSet.has(n.id));
    picked = both.length ? both : [...new Map([...byRole, ...byTag].map((n) => [n.id, n])).values()];
  } else picked = byRole.length ? byRole : byTag;
  if (picked.length) {
    const score = (n: ScopeNote) => (n.role && roleIds.has(n.role) ? 3 : 0) + tagHits.get(n)!.length * 2 + n.updatedAt / 1e15;
    const ids = [...picked].sort((a, b) => score(b) - score(a)).map((n) => n.id);
    const usedRoles = hitRoles.filter((r) => picked.some((n) => n.role === r.id)).map((r) => r.name);
    const usedTags = [...new Set(picked.flatMap((n) => tagHits.get(n)!))];
    const parts = [...usedRoles.map((r) => `${r} 노트`), ...usedTags.map((t) => `#${t}`)];
    out.push({ ids, via: 'role-tag', roles: usedRoles, tags: usedTags, label: `${parts.join(' · ')} ${ids.length}개` });
  }

  // 2) 요약 카드: 제목 · 소제목 · 키워드 · 태그 낱말에 걸린 질문 낱말 수
  const cardWords = (n: ScopeNote) => [...keywordTokens(n.title), ...n.headings.flatMap((h) => keywordTokens(h)), ...n.keywords, ...n.tags.flatMap(tagWords)];
  const scored = notes
    .map((n) => { const ws = cardWords(n); return { n, hits: ts.filter((t) => ws.some((w) => wordMatch(t, w))).length }; })
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits || b.n.updatedAt - a.n.updatedAt)
    .slice(0, cap);
  if (scored.length) out.push({ ids: scored.map((x) => x.n.id), via: 'digest', roles: [], tags: [], label: `요약 카드로 고른 노트 ${scored.length}개` });
  return out;
}

/** 질문 → 가장 좁은 범위 (없으면 via 'none') */
export function narrowScope(question: string, notes: readonly ScopeNote[], roles: readonly NoteRole[], cap = 12): ScopeResult {
  return scopeStages(question, notes, roles, cap)[0] ?? { ids: [], via: 'none', roles: [], tags: [], label: '관련 노트를 찾지 못함' };
}

/** 노트 요약 카드 (최소 요약 md) — 범위 산정 · 노트 정보 패널에 보여 준다. 글 본문은 넣지 않는다 */
export function noteDigest(n: { title: string; role?: { name: string; guessed?: boolean }; tags: readonly string[]; headings: readonly string[]; keywords: readonly string[] }): string {
  const lines = [`# ${n.title || '제목 없음'}`];
  if (n.role) lines.push(`- 역할: ${n.role.name}${n.role.guessed ? ' (추정)' : ''}`);
  if (n.tags.length) lines.push(`- 태그: ${n.tags.map((t) => `#${t}`).join(' ')}`);
  if (n.headings.length) lines.push(`- 소제목: ${n.headings.slice(0, 12).join(' · ')}`);
  if (n.keywords.length) lines.push(`- 키워드: ${n.keywords.join(', ')}`);
  return lines.join('\n');
}
