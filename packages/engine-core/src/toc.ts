// 목차 블록 (FR-053): 노트 안의 제목을 읽는 순서대로 모은 목록. 데이터는 따로 없다 — 그릴 때마다 지금 제목에서 만든다(제목을 고치면 바로 바뀜).
// 제목 = 제목 상자(1단계) · 글 속 제목 1~3(그 단계). 순서는 문서 뷰(FR-088)와 같다: 화살표 흐름 차례, 나머지는 위 → 아래 · 왼쪽 → 오른쪽 (flow.ts).
import type { Engine, TxResult } from './engine';
import { isTextContent, type Block, type Content, type Id } from './model';
import { textLines } from './text-doc';
import { documentOrder } from './flow';

export interface TocData {
  /** 몇 단계 제목까지 (기본 3) */
  readonly depth?: 1 | 2 | 3;
}
export type TocContent = Content & TocData & { readonly type: 'toc' };

export function isTocContent(c: Content | undefined): c is TocContent {
  return !!c && c.type === 'toc';
}

/** num: 제목 번호를 켰을 때 그 제목의 번호 ('1.' · '1.2' · '1.0.1') */
export interface TocEntry { readonly blockId: Id; readonly contentId: Id; readonly level: number; readonly text: string; readonly num?: string }

/** 블록 읽는 순서 (문서 뷰 · 목차 · 인쇄): 40px 줄 단위로 위 → 아래, 같은 줄은 왼쪽 → 오른쪽 */
export function readingOrder(blocks: Iterable<Block>): Block[] {
  const all = [...blocks];
  const byPos = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.round(a.y / 40) - Math.round(b.y / 40) || a.x - b.x;
  // 블록(묶음)은 한 덩어리로 — 묶음의 왼쪽 위 자리에서, 그 안은 다시 읽는 순서로
  const groups = new Map<string, Block[]>();
  for (const b of all) if (b.group) { const g = groups.get(b.group); if (g) g.push(b); else groups.set(b.group, [b]); }
  const units: { x: number; y: number; items: Block[] }[] = [];
  for (const b of all) if (!b.group || groups.get(b.group)!.length < 2) units.push({ x: b.x, y: b.y, items: [b] });
  for (const items of groups.values()) if (items.length >= 2) units.push({ x: Math.min(...items.map((b) => b.x)), y: Math.min(...items.map((b) => b.y)), items: items.sort(byPos) });
  return units.sort(byPos).flatMap((u) => u.items);
}

/** 이 노트의 목차 항목. 빈 제목은 뺀다. 제목 번호를 켰으면 번호도 (4단계까지 세고 depth로 거른다) */
export function tocEntries(engine: Engine, depth = 3): TocEntry[] {
  const all = headings(engine);
  if (engine.note.headingNumbers) {
    const c = [0, 0, 0, 0, 0];
    for (const [i, e] of all.entries()) {
      const L = Math.min(4, e.level);
      c[L]!++;
      for (let k = L + 1; k <= 4; k++) c[k] = 0;
      all[i] = { ...e, num: L === 1 ? `${c[1]}.` : c.slice(1, L + 1).join('.') }; // 건너뛴 단계는 0 — 워드와 같게 (문서 뷰 CSS 카운터도)
    }
  }
  return all.filter((e) => e.level <= depth);
}

/** 제목 번호 켜고 끄기 (워드 '제목에 연결된 다단계 목록') — 실행 취소 한 번 */
export function setHeadingNumbers(engine: Engine, on: boolean): TxResult<void> {
  return engine.transact((tx) => tx.setNote({ headingNumbers: on ? true : undefined }), { origin: 'user', label: on ? '제목 번호 켜기' : '제목 번호 끄기' });
}

function headings(engine: Engine): TocEntry[] {
  const depth = 4;
  const out: TocEntry[] = [];
  for (const { block: b } of documentOrder(engine)) {
    for (const c of engine.contentsOf(b.id)) {
      if (!isTextContent(c)) continue;
      if (c.role === 'title') {
        const text = textLines(c.doc).join(' ').trim();
        if (text) out.push({ blockId: b.id, contentId: c.id, level: 1, text });
        continue;
      }
      for (const n of c.doc.content) {
        const level = n.type === 'heading' ? Number((n.attrs as { level?: number } | undefined)?.level ?? 1) : 0;
        if (!level || level > depth) continue;
        const text = textLines({ type: 'doc', content: [n] }).join(' ').trim();
        if (text) out.push({ blockId: b.id, contentId: c.id, level, text });
      }
    }
  }
  return out;
}

/** 다시 그릴지 볼 때 쓰는 짧은 표식 */
export function tocSignature(entries: readonly TocEntry[]): string {
  return entries.map((e) => `${e.level}:${e.blockId}:${e.num ?? ''}${e.text}`).join('\n');
}
