// 그래프 ↔ 표 바꾸기 (FR-110 "표현 형식(그래프 ↔ 표)을 지정해 다시"): AI에 다시 묻지 않고 같은 수치를 다른 모양으로 — 바로 · 비용 없이 · 실행 취소 한 번.
// 그래프 → 표: 첫 열 = 항목(x), 계열마다 열(단위는 열 이름 뒤 괄호). 표 → 그래프: 첫 열이 항목, 숫자로 읽히는 열(값이 있는 칸의 ⅔ 이상)마다 계열.
// 숫자 열이 없는 표는 그래프로 바꿀 수 없다. 블록 · 자리 · 화살표 · 출처(ai)는 그대로, 콘텐츠만 바꾼다.
import type { Engine, TxResult } from './engine';
import type { Content, Id } from './model';
import { cellText, makeChart, makeTable, sortedRows, type ChartData, type ChartKind, type TableData } from './rich';

/** 칸 글자 → 수 (쉼표 · 공백 · 흔한 단위 꼬리 떼고). 못 읽으면 null */
export function cellNumber(s: string): number | null {
  const t = s.replace(/[,\s]/g, '').replace(/(%|퍼센트|원|달러|만|억|조|개|회|명|건|점|배|kg|g|km|m|ms|s|초|분|시간|일|개월|년)+$/u, '');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

const UNIT = /\s*\(([^)]{1,12})\)\s*$/;

export function chartToTable(c: ChartData): TableData {
  const cats = c.categories?.length ? [...c.categories] : [...new Set(c.series.flatMap((s) => s.points.map((p) => String(p.x))))];
  const unit = c.unit ? ` (${c.unit})` : '';
  const columns = ['항목', ...c.series.map((s) => `${s.name}${unit}`)];
  const rows = cats.map((x) => [x, ...c.series.map((s) => { const p = s.points.find((q) => String(q.x) === x); return p ? String(p.y) : ''; })]);
  return makeTable(columns, rows, c.title);
}

export function tableToChart(t: TableData): ChartData | null {
  const rows = sortedRows(t), cols = t.columns;
  if (cols.length < 2 || !rows.length) return null;
  const text = (r: (typeof rows)[number], id: Id) => cellText(r.cells[id]);
  const numeric = cols.slice(1).filter((c) => {
    const vals = rows.map((r) => text(r, c.id)).filter(Boolean);
    return vals.length > 0 && vals.filter((v) => cellNumber(v) !== null).length >= Math.ceil((vals.length * 2) / 3);
  });
  if (!numeric.length) return null;
  const xs = rows.map((r) => text(r, cols[0]!.id));
  // 항목이 연도 · 월 · 분기 · 날짜처럼 차례가 있는 시간이면 선, 아니면 막대
  const kind: ChartKind = xs.every((x) => /\d{4}|\d+\s*(월|분기|주|일)|^Q\d|[01]?\d\/\d/.test(x)) ? 'line' : 'bar';
  const units = new Set(numeric.map((c) => UNIT.exec(c.name)?.[1] ?? ''));
  const unit = units.size === 1 ? [...units][0] : '';
  const series = numeric.map((c) => ({
    name: unit ? c.name.replace(UNIT, '') : c.name,
    points: rows.flatMap((r, i) => { const v = cellNumber(text(r, c.id)); return v === null ? [] : [{ x: xs[i]!, y: v }]; }),
  }));
  return { ...makeChart(kind, series, t.title, unit || undefined), categories: xs };
}

/** 고른 블록의 그래프 ↔ 표 (실행 취소 한 번). 바꿀 수 없으면 ok:false */
export function convertRich(engine: Engine, blockId: Id, to: 'table' | 'chart'): TxResult<void> {
  const b = engine.getBlock(blockId);
  const c = engine.contentsOf(blockId).find((x) => x.type === (to === 'table' ? 'chart' : 'table')) as (Content & (ChartData | TableData)) | undefined;
  if (!b || !c) return { ok: false, reason: to === 'table' ? '그래프가 있는 상자가 아니에요.' : '표가 있는 상자가 아니에요.' };
  const data = to === 'table' ? chartToTable(c as unknown as ChartData) : tableToChart(c as unknown as TableData);
  if (!data) return { ok: false, reason: '숫자로 읽히는 열이 없어 그래프로 바꿀 수 없어요.' };
  return engine.transact((tx) => {
    tx.delete('content', c.id);
    tx.createContent({ ...data, type: to, blockId, order: c.order, ...(c.ai ? { ai: c.ai } : {}) } as never);
    // 표는 열 수만큼 넓게(최대 720), 그래프는 기본 360
    const w = to === 'table' ? Math.min(720, Math.max(b.w, (data as TableData).columns.length * 140)) : 360;
    if (w !== b.w) tx.set('block', blockId, { w });
  }, { origin: 'user', label: to === 'table' ? '그래프를 표로' : '표를 그래프로' });
}
