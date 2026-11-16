// 표 칸 합치기 · 나누기 (워드 "셀 병합"): 합친 칸은 왼쪽 위 칸(r0 · c0) ~ 오른쪽 아래 칸(r1 · c1)의 행 · 열 id로 적는다.
// id로 적으므로 안쪽에 행 · 열을 끼우면 합친 칸이 따라 늘고, 끝 행 · 열이 지워지면 그 합침은 버린다(mergeSpans가 읽을 때 걸러 냄).
// 합치면 덮이는 칸의 글은 왼쪽 위 칸으로 모으고(띄어쓰기로 이음) 덮인 칸은 비운다. 머리글(열 이름)은 합치지 않는다.
import type { Engine, TxResult } from './engine';
import type { Id, TextDoc, TextNode } from './model';
import { cellDoc, isTableContent, sortedRows, type TableData, type TableMerge } from './rich';

export interface CellRef { readonly row: Id; readonly col: Id }
/** 지금 순서의 칸 범위 (끝 포함) */
interface Rect { r0: number; c0: number; r1: number; c1: number }

/** 합친 칸 읽기: 왼쪽 위 칸 → 행 · 열 수, 덮인 칸들 ("행id:열id"). 깨진 것 · 겹치는 것 · 한 칸짜리는 뺀다 */
export function mergeSpans(t: TableData): { spans: Map<string, { rows: number; cols: number }>; covered: Set<string> } {
  const rows = sortedRows(t).map((r) => r.id), cols = t.columns.map((c) => c.id);
  const spans = new Map<string, { rows: number; cols: number }>(), covered = new Set<string>();
  for (const m of t.merges ?? []) {
    const r = toRect(m, rows, cols);
    if (!r || (r.r0 === r.r1 && r.c0 === r.c1)) continue;
    const keys: string[] = [];
    for (let i = r.r0; i <= r.r1; i++) for (let j = r.c0; j <= r.c1; j++) keys.push(`${rows[i]}:${cols[j]}`);
    if (keys.some((k) => covered.has(k) || spans.has(k))) continue; // 앞 합침과 겹침
    spans.set(keys[0]!, { rows: r.r1 - r.r0 + 1, cols: r.c1 - r.c0 + 1 });
    for (const k of keys.slice(1)) covered.add(k);
  }
  return { spans, covered };
}

function toRect(m: TableMerge, rows: readonly Id[], cols: readonly Id[]): Rect | null {
  const r0 = rows.indexOf(m.r0), r1 = rows.indexOf(m.r1), c0 = cols.indexOf(m.c0), c1 = cols.indexOf(m.c1);
  return r0 < 0 || r1 < 0 || c0 < 0 || c1 < 0 || r1 < r0 || c1 < c0 ? null : { r0, c0, r1, c1 };
}

/** 이 칸을 덮는 합침 (왼쪽 위 칸이면 그 합침) */
export function mergeAt(t: TableData, cell: CellRef): TableMerge | null {
  const rows = sortedRows(t).map((r) => r.id), cols = t.columns.map((c) => c.id);
  const i = rows.indexOf(cell.row), j = cols.indexOf(cell.col);
  for (const m of t.merges ?? []) {
    const r = toRect(m, rows, cols);
    if (r && i >= r.r0 && i <= r.r1 && j >= r.c0 && j <= r.c1 && (r.r1 > r.r0 || r.c1 > r.c0)) return m;
  }
  return null;
}

/** 두 칸이 만드는 사각형을 겹치는 합침까지 다 덮도록 넓힌 범위 — 고르기 표시 · 합치기에 같이 쓴다 */
export function mergeRect(t: TableData, a: CellRef, b: CellRef): { r0: Id; c0: Id; r1: Id; c1: Id } | null {
  const rows = sortedRows(t).map((r) => r.id), cols = t.columns.map((c) => c.id);
  const ia = rows.indexOf(a.row), ib = rows.indexOf(b.row), ja = cols.indexOf(a.col), jb = cols.indexOf(b.col);
  if (ia < 0 || ib < 0 || ja < 0 || jb < 0) return null;
  const r: Rect = { r0: Math.min(ia, ib), r1: Math.max(ia, ib), c0: Math.min(ja, jb), c1: Math.max(ja, jb) };
  const merged = (t.merges ?? []).map((m) => toRect(m, rows, cols)).filter((x): x is Rect => !!x);
  for (let grew = true; grew;) {
    grew = false;
    for (const m of merged) {
      const hit = m.r0 <= r.r1 && m.r1 >= r.r0 && m.c0 <= r.c1 && m.c1 >= r.c0;
      if (hit && (m.r0 < r.r0 || m.r1 > r.r1 || m.c0 < r.c0 || m.c1 > r.c1)) {
        r.r0 = Math.min(r.r0, m.r0); r.r1 = Math.max(r.r1, m.r1); r.c0 = Math.min(r.c0, m.c0); r.c1 = Math.max(r.c1, m.c1);
        grew = true;
      }
    }
  }
  return { r0: rows[r.r0]!, c0: cols[r.c0]!, r1: rows[r.r1]!, c1: cols[r.c1]! };
}

/** 칸 글들을 한 줄로 이음 (글자 서식은 그대로, 사이는 띄어쓰기) */
function joinCells(docs: readonly (TextDoc | undefined)[]): TextDoc {
  const inline: TextNode[] = [];
  for (const d of docs) {
    for (const p of d?.content ?? []) {
      const kids = p.content ?? [];
      if (!kids.length) continue;
      if (inline.length) inline.push({ type: 'text', text: ' ' });
      inline.push(...kids);
    }
  }
  return inline.length ? { type: 'doc', content: [{ type: 'paragraph', content: inline }] } : cellDoc('');
}

/** 두 칸 사이 사각형을 한 칸으로 (실행 취소 한 번). 합친 왼쪽 위 칸 */
export function mergeCells(engine: Engine, contentId: Id, a: CellRef, b: CellRef): TxResult<CellRef> {
  return engine.transact((tx) => {
    const t = engine.getContent(contentId);
    if (!isTableContent(t)) return tx.fail('표가 아님');
    const m = mergeRect(t, a, b);
    if (!m || (m.r0 === m.r1 && m.c0 === m.c1)) return tx.fail('합칠 칸이 하나뿐');
    const rows = sortedRows(t), cols = t.columns.map((c) => c.id);
    const ri = rows.findIndex((r) => r.id === m.r0), rj = rows.findIndex((r) => r.id === m.r1);
    const ci = cols.indexOf(m.c0), cj = cols.indexOf(m.c1);
    const inside = new Set(rows.slice(ri, rj + 1).map((r) => r.id)), insideCols = cols.slice(ci, cj + 1);
    const docs = rows.slice(ri, rj + 1).flatMap((r) => insideCols.map((c) => r.cells[c]));
    const anchor = joinCells(docs);
    const next = t.rows.map((r) => {
      if (!inside.has(r.id)) return r;
      const cells = { ...r.cells };
      for (const c of insideCols) cells[c] = r.id === m.r0 && c === m.c0 ? anchor : cellDoc('');
      return { ...r, cells };
    });
    // 새 사각형 안에 들던 옛 합침은 없앤다
    const rowIds = rows.map((r) => r.id);
    const keep = (t.merges ?? []).filter((x) => {
      const r = toRect(x, rowIds, cols);
      return r && !(r.r0 >= ri && r.r1 <= rj && r.c0 >= ci && r.c1 <= cj);
    });
    tx.set('content', contentId, { rows: next, merges: [...keep, m] });
    return { row: m.r0, col: m.c0 };
  }, { origin: 'user', label: '표 칸 합치기' });
}

/** 합친 칸 나누기 — 글은 왼쪽 위 칸에 남는다 */
export function splitCell(engine: Engine, contentId: Id, cell: CellRef): TxResult<void> {
  return engine.transact((tx) => {
    const t = engine.getContent(contentId);
    if (!isTableContent(t)) return tx.fail('표가 아님');
    const m = mergeAt(t, cell);
    if (!m) return tx.fail('합친 칸이 아님');
    const rest = (t.merges ?? []).filter((x) => x !== m);
    tx.set('content', contentId, { merges: rest.length ? rest : undefined });
  }, { origin: 'user', label: '표 칸 나누기' });
}

/** 이 칸 다음에 행 · 열을 넣을 기준 — 합친 칸 안이면 그 끝(아래 행 · 오른쪽 열) 다음에 (워드처럼, DQ-021) */
export function insertAnchor(t: TableData, cell: CellRef): CellRef {
  const m = mergeAt(t, cell);
  return m ? { row: m.r1, col: m.c1 } : cell;
}

/**
 * 행 · 열 지우기 — 합친 칸을 맞춘다 (DQ-022): 끝 행 · 열이면 합친 칸이 한 칸 줄고, 왼쪽 위 행 · 열이면 모아 둔 글을 다음 행 · 열로 옮겨
 * 합친 칸이 남는다. 한 칸만 남거나 통째로 지워지면 합침을 없앤다. 마지막 행 · 열은 지우지 않는다
 */
export function deleteTableLine(engine: Engine, contentId: Id, kind: 'row' | 'col', id: Id): TxResult<void> {
  return engine.transact((tx) => {
    const t = engine.getContent(contentId);
    if (!isTableContent(t)) return tx.fail('표가 아님');
    const order = kind === 'row' ? sortedRows(t).map((r) => r.id) : t.columns.map((c) => c.id);
    const i = order.indexOf(id);
    if (i < 0 || order.length <= 1) return tx.fail('지울 수 없음');
    let rows = t.rows.map((r) => ({ ...r, cells: { ...r.cells } }));
    const merges: TableMerge[] = [];
    for (const m of t.merges ?? []) {
      const a = kind === 'row' ? m.r0 : m.c0, z = kind === 'row' ? m.r1 : m.c1;
      const ai = order.indexOf(a), zi = order.indexOf(z);
      if (ai < 0 || zi < 0) continue; // 이미 깨진 합침 — 버린다
      if (i < ai || i > zi) { merges.push(m); continue; }
      if (ai === zi) continue; // 이 줄 하나뿐인 합침 — 줄과 함께 없어진다
      if (i === ai) {
        // 왼쪽 위 줄: 모아 둔 글을 다음 줄의 같은 자리로 옮긴다
        const na = order[ai + 1]!;
        if (kind === 'row') rows = rows.map((r) => (r.id === na ? { ...r, cells: { ...r.cells, [m.c0]: rows.find((x) => x.id === m.r0)?.cells[m.c0] ?? cellDoc('') } } : r));
        else rows = rows.map((r) => (r.id === m.r0 ? { ...r, cells: { ...r.cells, [na]: r.cells[m.c0] ?? cellDoc('') } } : r));
        merges.push(kind === 'row' ? { ...m, r0: na } : { ...m, c0: na });
      } else if (i === zi) merges.push(kind === 'row' ? { ...m, r1: order[zi - 1]! } : { ...m, c1: order[zi - 1]! });
      else merges.push(m);
    }
    const keep = merges.filter((m) => m.r0 !== m.r1 || m.c0 !== m.c1);
    if (kind === 'row') rows = rows.filter((r) => r.id !== id);
    else rows = rows.map((r) => { const { [id]: _gone, ...cells } = r.cells; return { ...r, cells }; });
    tx.set('content', contentId, {
      rows, merges: keep.length ? keep : undefined,
      ...(kind === 'col' ? { columns: t.columns.filter((c) => c.id !== id) } : {}),
    });
  }, { origin: 'user', label: kind === 'row' ? '표 행 삭제' : '표 열 삭제' });
}
