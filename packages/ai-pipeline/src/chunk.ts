// 긴 입력 분할 (FR-101, AI-PROMPTS 6절).
// 목표 6,000자 · 7,000자 이하면 나누지 않음 · 하드 상한 24,000자(API 3.2 `text` 제약).
// 10/27 12,000 → 6,000 (사용자 요청 10/13 "긴 붙여넣기 정확도"): 응답 상자는 요청마다 60개까지라, 한 번에 긴 글을 보내면
// 내용을 크게 줄여 담는다 — 청크를 작게 해 글 길이당 담을 수 있는 상자를 늘린다. 대신 요청 수가 늘어난다(동시 2개).
// 경계 우선순위: H1/H2 → H3~H6 → 빈 줄 · 구분선 → 목록 항목 → 문장 끝 → 공백. 코드 펜스 · 표 · 인용은 원자 단위.

export interface Chunk {
  readonly index: number;
  readonly count: number;
  /** 모델에 보낼 청크 본문. 거대한 표를 행 단위로 나눈 경우에만 앞에 머리 행 + 구분 행이 붙는다(6.2-3의 유일한 예외) */
  readonly text: string;
  /** 정규화된 전체 원문에서의 범위 [start, end) */
  readonly start: number;
  readonly end: number;
  /** 이전 청크의 마지막 문단(≤600자) + 제목 경로 한 줄. 첫 청크는 없음 */
  readonly precedingContext?: string;
}

export const CHUNK_TARGET = 6_000;
export const CHUNK_SINGLE = 7_000;
export const CHUNK_HARD = 24_000;
const CONTEXT_MAX = 600;

const H12 = /^\s{0,3}#{1,2}\s/;
const H36 = /^\s{0,3}#{3,6}\s/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const ITEM = /^\s*([-*+]|\d{1,9}[.)])\s+/;
const FENCE = /^\s*(```|~~~)/;
const TABLE_LINE = /^\s*\|.*\|\s*$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const QUOTE = /^\s{0,3}>/;
const SENTENCE_END = /(?:[.?!]|다\.|요\.)[\s]+/g;

interface Line { start: number; text: string; atom: 'code' | 'table' | 'quote' | null; table?: { header: string } }
interface Cand { pos: number; prio: number; table?: { header: string } }

function scanLines(src: string): Line[] {
  const out: Line[] = [];
  let pos = 0;
  const raw = src.split('\n');
  let fence: string | null = null;
  for (let i = 0; i < raw.length; i++) {
    const text = raw[i]!;
    let atom: Line['atom'] = null;
    let table: Line['table'];
    if (fence) {
      atom = 'code';
      if (new RegExp(`^\\s*${fence}\\s*$`).test(text)) fence = null;
    } else if (FENCE.test(text)) {
      fence = FENCE.exec(text)![1]!;
      atom = 'code';
    } else if (TABLE_LINE.test(text)) {
      atom = 'table';
      // 표 머리 = 표 첫 줄 + 구분 행. 이어지는 표 줄은 같은 머리를 공유한다.
      const prev = out[out.length - 1];
      if (prev?.atom === 'table' && prev.table) table = prev.table;
      else table = { header: TABLE_SEP.test(raw[i + 1] ?? '') ? `${text}\n${raw[i + 1]}` : text };
    } else if (QUOTE.test(text)) atom = 'quote';
    out.push({ start: pos, text, atom, table });
    pos += text.length + 1;
  }
  return out;
}

function candidates(src: string, lines: Line[]): Cand[] {
  const out: Cand[] = [];
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i]!, prev = lines[i - 1]!;
    const sameAtom = l.atom !== null && l.atom === prev.atom;
    if (sameAtom) {
      // 원자 단위 안: 표 행 경계만 최후 수단으로(머리 행 반복), 코드 · 인용은 자르지 않는다
      if (l.atom === 'table' && !TABLE_SEP.test(l.text)) out.push({ pos: l.start, prio: 0.5, table: l.table });
      continue;
    }
    let prio = 0;
    if (H12.test(l.text)) prio = 6;
    else if (H36.test(l.text)) prio = 5;
    else if (!prev.text.trim() || HR.test(l.text) || l.atom !== null || prev.atom !== null) prio = 4;
    else if (ITEM.test(l.text)) prio = 3;
    if (prio) out.push({ pos: l.start, prio });
  }
  for (const l of lines) {
    if (l.atom) continue;
    for (const m of l.text.matchAll(SENTENCE_END)) out.push({ pos: l.start + m.index! + m[0].length, prio: 2 });
    for (const m of l.text.matchAll(/ +/g)) out.push({ pos: l.start + m.index! + m[0].length, prio: 1 });
  }
  return out.filter((c) => c.pos > 0 && c.pos < src.length).sort((a, b) => a.pos - b.pos);
}

/** 제목 경로 (`## 2. 점유율 추이` 같은 원문 줄을 > 로 이음) */
function headingPath(lines: Line[], before: number): string {
  const stack: { level: number; text: string }[] = [];
  for (const l of lines) {
    if (l.start >= before) break;
    if (l.atom) continue;
    const m = HEADING.exec(l.text);
    if (!m) continue;
    const level = m[1]!.length;
    while (stack.length && stack[stack.length - 1]!.level >= level) stack.pop();
    stack.push({ level, text: l.text.trim() });
  }
  return stack.map((h) => h.text).join(' > ');
}

/** 이전 청크의 마지막 문단을 문장 경계에서 잘라 최대 600자 (6.3) */
function tailContext(prevText: string, max: number): string {
  const paras = prevText.replace(/\n+$/, '').split(/\n\s*\n/);
  let p = (paras[paras.length - 1] ?? '').trim();
  if (p.length > max) {
    const cut = p.slice(p.length - max);
    const m = /(?:[.?!]|다\.|요\.)\s+/.exec(cut);
    p = (m ? cut.slice(m.index + m[0].length) : cut.replace(/^\S*\s+/, '')).trim();
  }
  return p;
}

export function chunkText(src: string): Chunk[] {
  const T = CHUNK_TARGET, single = CHUNK_SINGLE, hard = CHUNK_HARD;
  if (src.length <= single) return [{ index: 0, count: 1, text: src, start: 0, end: src.length }];
  const lines = scanLines(src);
  const cands = candidates(src, lines);
  const parts: { start: number; end: number; prefix: string }[] = [];
  let s = 0, prefix = '';
  while (src.length - s + prefix.length > T) {
    const lo = s + T * 0.5, hi = s + T - prefix.length;
    const inWin = cands.filter((c) => c.pos > lo && c.pos <= hi);
    // 1) 창 안에서 원자 단위 밖 후보 중 우선순위가 가장 높은(같으면 가장 늦은) 자리
    let pick = best(inWin.filter((c) => c.prio >= 1));
    // 2) 창이 원자 단위에 걸렸으면 하드 상한까지 앞으로 보며 원자 단위가 끝나는 첫 자리
    if (!pick) pick = cands.find((c) => c.pos > hi && c.pos <= s + hard - prefix.length && c.prio >= 3);
    // 3) 그래도 없으면(하드 상한을 넘는 표) 표 행 경계에서 자르고 다음 조각에 머리 행을 반복
    if (!pick) pick = best(inWin.filter((c) => c.table)) ?? best(cands.filter((c) => c.table && c.pos > s && c.pos <= s + hard - prefix.length));
    // 4) 최후: 아무 데서나 (거대한 코드 블록)
    let end = pick?.pos ?? Math.min(src.length, s + T);
    // 제목은 뒤 내용에 붙인다 — 청크가 제목 줄로 끝나면 그 제목을 다음 청크로 넘긴다 (6.2-4)
    const tailLines = lines.filter((l) => l.start >= s && l.start < end && l.text.trim());
    const last = tailLines[tailLines.length - 1];
    if (last && !last.atom && HEADING.test(last.text) && last.start > s) { end = last.start; pick = undefined; }
    parts.push({ start: s, end, prefix });
    prefix = pick?.table ? pick.table.header + '\n' : '';
    s = end;
  }
  parts.push({ start: s, end: src.length, prefix });

  return parts.map((p, index): Chunk => {
    let text = p.prefix + src.slice(p.start, p.end);
    text = text.replace(/\n+$/, '');
    const base = { index, count: parts.length, text, start: p.start, end: p.end };
    if (index === 0) return base;
    const prev = parts[index - 1]!;
    const tail = tailContext(src.slice(prev.start, prev.end), CONTEXT_MAX);
    const path = headingPath(lines, p.start);
    const ctx = [path ? `(section: ${path})` : '', tail].filter(Boolean).join('\n');
    return ctx ? { ...base, precedingContext: ctx } : base;
  });
}

function best(cs: Cand[]): Cand | undefined {
  let b: Cand | undefined;
  for (const c of cs) if (!b || c.prio > b.prio || (c.prio === b.prio && c.pos > b.pos)) b = c;
  return b;
}
