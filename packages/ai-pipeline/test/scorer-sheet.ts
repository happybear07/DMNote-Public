// 노트형 채점 (docs/research/NOTE-SHEET-PLAN.md NS-17, eval/README 3.10):
// 갈래 일치(모든 케이스) · 카드 재현율 · 카드 순서 · 조각 일치 · 원문 구절 보존 · 원문 근거율(지어낸 문장) · 지어낸 별점.
// 기대 결과의 `mode` · `sheet`(카드 제목 · 허용 조각 종류 · 지킬 구절 · 별점)로 계산한다. 노트형 모범 답안은 fixtures.ts sheetAnswer.
import { extractNumbers, starCounts, type StructurePlan, type StructureSheet } from '../src';
import type { EvalCase } from './fixtures';
import { matchTitles, norm, type Ratio } from './scorer';

export interface SheetScore {
  modeMatch: Ratio; cardRecall: Ratio; cardOrder: Ratio; pieceMatch: Ratio; keepRecall: Ratio; sheetSourced: Ratio;
  inventedRatings: number[];
  /** 진단: 원문 근거가 약한 줄 (앞 5개) */
  unsourced: string[];
}

const r = (n: number, d: number): Ratio => ({ n, d });
const asList = <T>(v: T | T[] | undefined, dflt: T): T[] => (v === undefined ? [dflt] : Array.isArray(v) ? v : [v]);
/** 노트형 글 비교: norm + 형광펜 · 할 일 · 인용 · 목록 표지 제거 */
const flat = (s: string) => norm(s).replace(/==|^\s*(?:[-*]\s+(?:\[[ x]\]\s+)?|>\s*)/gm, '').trim();
const bigrams = (s: string) => { const t = flat(s).replace(/\s+/g, ''); const out: string[] = []; for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2)); return out; };

/** 원문 근거율 대상 줄: 머리 · 카드 제목 · 조각 글(줄마다) · 항목 · 단계 · 비교 · 별점 이름 · 맺음말 (메타 이름 · 'VS'는 뺀다) */
export function sheetLines(s: StructureSheet | undefined): string[] {
  if (!s) return [];
  const out: string[] = [s.title ?? '', s.subtitle ?? '', ...(s.meta ?? []).map((m) => m.value), s.closing ?? ''];
  for (const sec of s.sections) {
    out.push(sec.title);
    for (const p of sec.pieces) {
      out.push(...(p.md ?? '').split('\n'), ...(p.items ?? []), ...(p.steps ?? []), p.label ?? '');
      for (const side of [p.left, p.right]) if (side) out.push(side.label ?? '', ...side.items);
      for (const row of p.rows ?? []) out.push(row.label, row.note ?? '');
    }
  }
  return out.map((x) => x.trim()).filter((x) => flat(x).length >= 2);
}

export function scoreSheet(c: EvalCase, raw: unknown, plan: StructurePlan | null, src: string): SheetScore {
  const e = c.expected, al = e.aliases ?? {};
  const want = asList(e.mode, 'diagram' as const);
  const modeMatch = r(plan && want.includes(plan.mode ?? 'diagram') ? 1 : 0, 1);

  // 카드 · 조각 · 구절 (최종 계획)
  const exp = e.sheet;
  const out = plan?.sheet?.sections ?? [];
  let cardRecall = r(0, 0), cardOrder = r(0, 0), pieceMatch = r(0, 0), keepRecall = r(0, 0);
  // 두 갈래를 다 허용한 케이스(SWOT 등)에서 도식으로 답했으면 카드 지표는 세지 않는다 — 갈래 일치로 이미 맞음
  if (exp && (plan?.mode === 'sheet' || !want.includes('diagram'))) {
    const m = matchTitles(out.map((s) => s.title), exp.cards.map((x) => x.title), al);
    cardRecall = r(m.size, exp.cards.length);
    const order = [...m].sort((a, b) => a[0] - b[0]).map(([, j]) => j);
    if (!exp.anyOrder && order.length > 1) cardOrder = r(order.slice(1).filter((j, i) => j > order[i]!).length, order.length - 1);
    let pn = 0, pd = 0;
    exp.cards.forEach((card, i) => {
      if (!card.pieces.length) return;
      pd++;
      const j = m.get(i);
      if (j !== undefined && out[j]!.pieces.some((p) => card.pieces.includes(p.type))) pn++;
    });
    pieceMatch = r(pn, pd);
    const tableText = (plan?.tables ?? []).flatMap((t) => [t.title ?? '', ...t.columns, ...t.rows.flat()]);
    const text = flat([...sheetLines(plan?.sheet), ...tableText].join('\n'));
    const keeps = exp.cards.flatMap((x) => x.keep);
    keepRecall = r(keeps.filter((k) => text.includes(flat(k))).length, keeps.length);
  }

  // 원문 근거율 · 지어낸 별점 (모델 원출력 — 앱의 별점 검사 전)
  const rawSheet = (raw && typeof raw === 'object' ? (raw as { sheet?: StructureSheet }).sheet : undefined);
  const srcBi = new Set(bigrams(src));
  const lines = sheetLines(rawSheet);
  const weak = lines.filter((l) => { const b = bigrams(l); return b.length > 0 && b.filter((x) => srcBi.has(x)).length / b.length < 0.75; });
  const ok = new Set([...extractNumbers(src), ...starCounts(src)]);
  const inventedRatings = (rawSheet?.sections ?? []).flatMap((s) => s.pieces ?? []).flatMap((p) => p.rows ?? []).map((x) => x.value).filter((v) => !ok.has(v));
  return { modeMatch, cardRecall, cardOrder, pieceMatch, keepRecall, sheetSourced: r(lines.length - weak.length, lines.length), inventedRatings, unsourced: weak.slice(0, 5) };
}
