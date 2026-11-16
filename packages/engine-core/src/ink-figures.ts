// 블록에 묶지 않은 손그림(자유 잉크)도 문서 뷰 · 인쇄 · 내보내기에: 가까이 모인 획끼리 한 그림으로 묶고(간격 48px 안이면 같은 그림),
// 자리 순서대로 문서에 끼운다 — 캔버스에 그린 도안이 문서에서 빠지지 않게. 그림은 읽기 전용 그림으로만 나온다(고치기는 캔버스에서).
// 표지 쪽(cover.ts) 안의 필기는 빠진다 — 문서 보기에서는 첫 쪽 표지 그림으로 나온다(doc-cover.ts).
import type { Engine } from './engine';
import type { Block, Id } from './model';
import { freeStrokes, strokeBounds, strokeWorldPoints, type Stroke } from './ink';
import { coverRect, inCover } from './sheet';
import type { InkSvg } from './ink-bind';

export interface InkFigure { readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly ids: readonly Id[] }

const ROW = 40;
const r1 = (v: number) => Math.round(v * 10) / 10;

/** 자유 잉크 → 그림들 (자리 순서: 위 → 아래, 같은 줄은 왼쪽 → 오른쪽) */
export function inkFigures(engine: Engine, gap = 48): InkFigure[] {
  const cover = coverRect(engine.note);
  const strokes = freeStrokes(engine).filter((s) => !inCover(cover, strokeBounds(s)));
  const boxes = strokes.map(strokeBounds);
  const parent = strokes.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i]!, b = boxes[j]!;
    if (a.x - gap <= b.x + b.w && b.x - gap <= a.x + a.w && a.y - gap <= b.y + b.h && b.y - gap <= a.y + a.h) parent[find(i)] = find(j);
  }
  const groups = new Map<number, number[]>();
  strokes.forEach((_, i) => { const r = find(i); const g = groups.get(r); if (g) g.push(i); else groups.set(r, [i]); });
  return [...groups.values()].map((g) => {
    const x0 = Math.min(...g.map((i) => boxes[i]!.x)), y0 = Math.min(...g.map((i) => boxes[i]!.y));
    const x1 = Math.max(...g.map((i) => boxes[i]!.x + boxes[i]!.w)), y1 = Math.max(...g.map((i) => boxes[i]!.y + boxes[i]!.h));
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, ids: g.map((i) => strokes[i]!.id) };
  }).sort((a, b) => Math.round(a.y / ROW) - Math.round(b.y / ROW) || a.x - b.x);
}

/** 그림 → SVG 경로 (그림 왼쪽 위 기준) */
export function figurePaths(engine: Engine, f: InkFigure): InkSvg {
  const paths = f.ids.map((id) => engine.getStroke(id) as Stroke | undefined).filter((s): s is Stroke => !!s).map((s) => {
    const p = strokeWorldPoints(s);
    let d = '';
    for (let i = 0; i < p.length; i += 4) d += `${i ? 'L' : 'M'}${r1(p[i]! - f.x)} ${r1(p[i + 1]! - f.y)}`;
    if (p.length === 4) d += `L${r1(p[0]! - f.x + 0.01)} ${r1(p[1]! - f.y)}`;
    return { d, color: s.color, width: r1(s.width * s.scale), hl: s.tool === 'highlighter' };
  });
  return { w: r1(f.w), h: r1(f.h), paths };
}

/** 문서 순서에서 이 그림이 들어갈 자리: 그림보다 자리가 뒤인 첫 블록 앞 (없으면 맨 끝) */
export function figureSlot(order: readonly Block[], f: InkFigure): number {
  const fr = Math.round(f.y / ROW);
  const i = order.findIndex((b) => Math.round(b.y / ROW) > fr || (Math.round(b.y / ROW) === fr && b.x > f.x));
  return i < 0 ? order.length : i;
}
