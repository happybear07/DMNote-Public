// 표 정렬 (워드 레이아웃 › 정렬 · 엑셀 열 머리 정렬): 한 열의 글자로 행 차례를 바꾼다 — 실행 취소 한 번.
// 숫자(1,200 · -3.5 · 40% · 1200원 · ₩500)는 크기로, 나머지는 한글 사전 순(글 속 숫자는 크기로). 숫자가 글보다 앞, 빈 칸은 늘 뒤.
// 같은 값은 원래 차례 그대로. 세로로 합친 칸(여러 행에 걸친 칸)이 있으면 정렬하지 않는다 — 합친 칸이 깨진다 (워드와 같게).
import type { Engine, TxResult } from './engine';
import type { Id } from './model';
import { keyBetween, type OrderKey } from './order';
import { cellText, isTableContent, sortedRows, type TableData } from './rich';

export type SortDir = 'asc' | 'desc';

const collator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });
const NUM = /^([-+]?)\s*[₩$€£¥]?\s*(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s*[%\p{L}]{0,4}$/u;

/** 칸 글자가 숫자면 그 값 (단위 · 쉼표 · 통화 기호는 빼고), 아니면 null */
function numberOf(s: string): number | null {
  const m = NUM.exec(s.trim());
  if (!m) return null;
  const v = parseFloat(m[2]!.replace(/,/g, '') + (m[3] ?? ''));
  return m[1] === '-' ? -v : v;
}

/** 두 칸 글자 비교 (오름차순 기준) — 빈 칸은 부르는 쪽이 뒤로 */
export function compareCells(a: string, b: string): number {
  const na = numberOf(a), nb = numberOf(b);
  if (na !== null && nb !== null) return na - nb;
  if (na !== null) return -1;
  if (nb !== null) return 1;
  return collator.compare(a, b);
}

/** 세로로 합친 칸이 있나 (있으면 정렬하지 않는다) */
export function hasRowMerges(t: TableData): boolean {
  return (t.merges ?? []).some((m) => m.r0 !== m.r1);
}

/**
 * 열 머리의 ↑ · ↓ 표시: 이 열로 정렬했고(sorted) 지금 차례도 아직 그대로면 그 방향.
 * 정렬한 뒤 칸을 고쳐 차례가 어긋나면 표시가 저절로 사라진다
 */
export function tableSortState(t: TableData, colId: Id): SortDir | null {
  const s = t.sorted;
  if (!s || s.col !== colId) return null;
  const vals = sortedRows(t).map((r) => cellText(r.cells[colId]));
  const firstEmpty = vals.indexOf('');
  if (firstEmpty >= 0 && vals.slice(firstEmpty).some(Boolean)) return null;
  const filled = firstEmpty >= 0 ? vals.slice(0, firstEmpty) : vals;
  for (let i = 1; i < filled.length; i++) {
    const c = compareCells(filled[i - 1]!, filled[i]!);
    if (s.dir === 'asc' ? c > 0 : c < 0) return null;
  }
  return s.dir;
}

/** 표를 colId 열로 정렬 — 행 순서 키만 바꾼다 (칸 · 행 id는 그대로라 동기화 · 합친 가로 칸도 따라간다) */
export function sortTable(engine: Engine, contentId: Id, colId: Id, dir: SortDir): TxResult<void> {
  return engine.transact((tx) => {
    const t = engine.getContent(contentId);
    if (!isTableContent(t) || !t.columns.some((c) => c.id === colId)) return tx.fail('표 · 열이 없음');
    if (hasRowMerges(t)) return tx.fail('세로로 합친 칸이 있어 정렬할 수 없음');
    const rows = sortedRows(t).map((r, i) => ({ r, i, v: cellText(r.cells[colId]) }));
    rows.sort((a, b) => {
      if (!a.v || !b.v) return (a.v ? 0 : 1) - (b.v ? 0 : 1) || a.i - b.i; // 빈 칸은 늘 뒤
      return (dir === 'asc' ? compareCells(a.v, b.v) : compareCells(b.v, a.v)) || a.i - b.i;
    });
    let order: OrderKey | null = null;
    const orders = new Map<Id, OrderKey>();
    for (const x of rows) { order = keyBetween(order, null); orders.set(x.r.id, order); }
    tx.set('content', contentId, { rows: t.rows.map((r) => ({ ...r, order: orders.get(r.id)! })), sorted: { col: colId, dir } });
  }, { origin: 'user', label: '표 정렬' });
}
