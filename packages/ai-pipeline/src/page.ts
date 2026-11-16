// A4 용지 노트에 도식형 결과 놓기 (FR-109 "A4 용지 노트에 구조화하면 결과가 용지 안에", 사용자 요청 10/13):
// 용지 안쪽 폭을 넘으면 덩어리 줄 바꿈(arrange maxWidth) → 흐름형은 위→아래로 다시(vertical) → 그래도 넘으면 원문 차례로 한 줄 쌓기.
// 놓을 때는 원문 아래 · 용지 가운데, 다른 상자와 겹치면 내용 맨 아래로. 쪽 사이 틈에 걸치는 줄은 다음 쪽으로(워드처럼).
import type { Rect } from '@dn/engine-core';
import { TAG_H, type Arranged, type ArrangeItem } from './arrange';

export interface PagePlacement {
  /** 용지 안쪽 폭 (종이 폭 − 양옆 여백) */
  readonly width: number;
  /** 쪽 사이 틈에 걸치지 않는 y (engine-core pageY) */
  readonly place: (y: number, h: number) => number;
  /** 원문 아래가 막혀 있을 때 놓을 y (내용 맨 아래 + 여백) */
  readonly after: number;
}

const STACK_GAP = 40;

/** 배치 전체 폭 */
export function laidWidth(l: Arranged, items: readonly ArrangeItem[]): number {
  if (!items.length) return 0;
  const x0 = Math.min(...items.map((it) => l.pos.get(it.id)!.x));
  const x1 = Math.max(...items.map((it) => l.pos.get(it.id)!.x + (l.width.get(it.id) ?? it.w)));
  return x1 - x0;
}

/** 마지막 수: 원문 차례로 한 줄, 용지 가운데 — 화살표는 그대로 잇는다 */
export function stackLaid(items: readonly ArrangeItem[], width: number): Arranged {
  const pos = new Map<string, { x: number; y: number }>(), w = new Map<string, number>(), h = new Map<string, number>();
  let y = 0;
  for (const it of items) {
    const iw = Math.min(it.w, width);
    if (it.kind === 'node') y += TAG_H;
    pos.set(it.id, { x: (width - iw) / 2, y });
    w.set(it.id, iw);
    h.set(it.id, it.h);
    y += it.h + STACK_GAP;
  }
  return { pos, width: w, height: h };
}

/**
 * 쪽 사이 틈에 걸치는 줄을 다음 쪽으로 — 줄(세로로 겹치는 상자들, 위 이름표까지)마다 함께 내려 줄 맞춤을 지키고,
 * 내린 만큼 그 아래 줄도 모두 내린다. 한 쪽보다 큰 줄은 그대로(place가 그대로 돌려준다)
 */
export function paginate(rects: Map<string, Rect>, top: (id: string) => number, place: PagePlacement['place']): void {
  const ids = [...rects.keys()].sort((a, b) => rects.get(a)!.y - top(a) - (rects.get(b)!.y - top(b)));
  let shift = 0, i = 0;
  while (i < ids.length) {
    const row = [ids[i]!];
    const y0 = rects.get(ids[i]!)!.y - top(ids[i]!);
    let y1 = rects.get(ids[i]!)!.y + rects.get(ids[i]!)!.h;
    for (i++; i < ids.length && rects.get(ids[i]!)!.y - top(ids[i]!) < y1; i++) {
      row.push(ids[i]!);
      y1 = Math.max(y1, rects.get(ids[i]!)!.y + rects.get(ids[i]!)!.h);
    }
    const from = y0 + shift;
    shift += place(from, y1 - y0) - from;
    for (const id of row) { const r = rects.get(id)!; rects.set(id, { ...r, y: r.y + shift }); }
  }
}
