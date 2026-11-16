// 노트 키워드 (노트에 묻기 범위 좁히기, 2026-10-26): 글 속 #해시태그 · 소제목 · 자주 나온 낱말.
// 모두 기기 안에서 계산한다 — 토큰을 쓰지 않는다. 노트 요약 카드(scope.ts noteDigest)와 범위 산정(narrowScope)이 쓴다.
import { isStopWord, stem } from './retrieve';

/** 키워드로 치지 않는 흔한 말 (질문용 STOP에 더해) */
const COMMON = new Set([
  '그리고', '하지만', '그래서', '그러나', '또는', '그런데', '때문', '위해', '대한', '대해', '통해', '경우', '정도', '모든', '이번', '각각', '가장', '아주', '매우',
  '조금', '먼저', '바로', '다시', '이미', '아직', '함께', '정말', '이런', '저런', '그런', '여기', '거기', '우리', '저희', '너무', '많이', '있음', '없음', '해야',
  '사항', '내용', '부분', '관련', '기타', '항목', '정리',
  'and', 'the', 'for', 'with', 'that', 'this', 'from', 'are', 'was', 'not', 'but', 'you', 'your', 'can', 'will', 'into', 'have', 'has',
]);
/** 서술어 끝 (했다 · 합니다 …) — 키워드가 아니다 */
const VERB_END = /(습니다|니다|했다|한다|된다|이다|있다|없다|었다|았다|겠다|하기|해요|했음|하자|어요|아요|네요|세요)$/;
const SPLIT = /[^\p{L}\p{N}]+/u;

/** 낱말 → 키워드 줄기 (키워드가 아니면 null) */
export function keywordStem(raw: string): string | null {
  const w = stem(raw.normalize('NFC').toLowerCase());
  // 숫자로 시작하는 말(10월 · 3주 · 2026년)은 날짜 · 수량이라 키워드로 치지 않는다 — #태그로는 쓸 수 있다
  if (w.length < 2 || /^\d/.test(w) || isStopWord(w) || COMMON.has(w) || VERB_END.test(w)) return null;
  return w;
}

/** 글 → 키워드 줄기들 (순서대로, 중복 포함) */
export function keywordTokens(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(SPLIT)) { const k = raw ? keywordStem(raw) : null; if (k) out.push(k); }
  return out;
}

const HEX = /^(?=.*\d)(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const HASH = /(^|[^\p{L}\p{N}_&/#])#([\p{L}\p{N}_][\p{L}\p{N}_-]{0,29})/gu;

/** 글 속 #해시태그 (이름만, 처음 나온 모양 그대로, 대소문자 무시 중복 제거). 숫자뿐 · 색 코드(#3b5bdb)는 뺀다 */
export function hashtags(text: string): string[] {
  const seen = new Set<string>(), out: string[] = [];
  for (const m of text.normalize('NFC').matchAll(HASH)) {
    const name = m[2]!.replace(/[-_]+$/, '');
    const key = name.toLowerCase();
    if (!name || /^\d+$/.test(name) || HEX.test(name) || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/**
 * 자주 나온 낱말 (노트 키워드 · 태그 추천): 본문에 한 번 나올 때마다 1점, 제목 3점, 소제목 2점.
 * 같은 점수면 먼저 나온 것. `skip`(이미 태그인 것 등)은 뺀다
 */
export function topKeywords(input: { title: string; headings: readonly string[]; texts: readonly string[] }, k = 10, skip: readonly string[] = []): string[] {
  const score = new Map<string, number>(), first = new Map<string, number>();
  let n = 0;
  const add = (t: string, w: number) => { score.set(t, (score.get(t) ?? 0) + w); if (!first.has(t)) first.set(t, n++); };
  for (const t of keywordTokens(input.title)) add(t, 3);
  for (const h of input.headings) for (const t of keywordTokens(h)) add(t, 2);
  for (const tx of input.texts) for (const t of keywordTokens(tx)) add(t, 1);
  const no = new Set(skip.map((s) => s.normalize('NFC').toLowerCase()));
  return [...score.entries()]
    .filter(([t]) => !no.has(t))
    .sort((a, b) => b[1] - a[1] || first.get(a[0])! - first.get(b[0])!)
    .slice(0, k)
    .map(([t]) => t);
}

/** 낱말 맞추기: 같거나, 두 글자 이상인 쪽이 다른 쪽의 앞부분 ("결제" ↔ "결제연동", "회의" ↔ "회의록") */
export function wordMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 2 || b.length < 2) return false;
  return a.startsWith(b) || b.startsWith(a);
}
