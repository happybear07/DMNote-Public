// under 캔버스: 도트 그리드 · 화살표 · LOD 블록 (블록 DOM 아래 레이어).
import { arrowChip, blockColor, blockTextParts, effectiveStyle, isBlankDoc, textLines, visibleWorldRect, type Id } from '@dn/engine-core';
import type { CanvasView } from './canvas-view';
import { drawArrowLabel, roundRect } from './draw-helpers';
import { drawArrow } from './arrow-draw';
import { arrowColor } from './theme';
import { drawPaper } from './paper';
import { drawCover, drawSheets } from './sheet-view';
import { drawGroupShapes, quietArrow } from './group-shapes';
import { drawCards } from './card-view';
import { LOD_BATCH_ZOOM } from './constants';

/** LOD 카드에 쓸 한 줄: 제목 상자 글자, 아니면 내용 첫 줄 */
export function titleOf(view: CanvasView, blockId: Id): string {
  const { title, bodies } = blockTextParts(view.engine.contentsOf(blockId));
  const c = title && !isBlankDoc(title.doc) ? title : bodies[0];
  if (!c) return '';
  const hit = view.titleCache.get(c.id);
  if (hit && hit.doc === c.doc) return hit.title;
  const line = textLines(c.doc).find((l) => l.trim()) ?? '';
  view.titleCache.set(c.id, { doc: c.doc, title: line });
  return line;
}

/** LOD 블록: 테두리(고른 바탕색만 칠함 — 상자 DOM처럼 바탕은 비운다) + 제목 한 줄(읽을 수 있을 때만). */
export function drawLodBlocks(view: CanvasView, ctx: CanvasRenderingContext2D): void {
  const z = view.cam.zoom;
  const ids = view.engine.queryBlocks(visibleWorldRect(view.cam, view.size));
  if (z < LOD_BATCH_ZOOM) {
    // 아주 작게 보일 때는 카드와 제목 막대를 각각 경로 하나로 묶어 그린다 (그리기 호출 수 = 상수)
    const cards = new Path2D(), bars = new Path2D();
    for (const id of ids) {
      if (id === view.editingId) continue;
      const r = view.previewRect(id) ?? view.engine.getBlock(id)!;
      const p = view.toScreen(r);
      const w = r.w * z, h = r.h * z;
      cards.rect(Math.round(p.x) + 0.5, Math.round(p.y) + 0.5, Math.round(w), Math.round(h));
      bars.rect(p.x + 10 * z, p.y + 12 * z, Math.min(w * 0.6, 140 * z), Math.max(1, 10 * z));
    }
    ctx.strokeStyle = view.theme.line;
    ctx.lineWidth = 1;
    ctx.stroke(cards);
    ctx.fillStyle = view.theme.line;
    ctx.fill(bars);
    return;
  }
  const blocks = ids
    .map((id) => view.engine.getBlock(id)!)
    .filter((b) => b && b.id !== view.editingId)
    .sort((a, b) => (a.z < b.z ? -1 : a.z > b.z ? 1 : 0));
  const fontPx = 13.5 * z;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = `600 ${Math.max(fontPx, 1)}px "Pretendard Variable", Pretendard, system-ui, "Malgun Gothic", sans-serif`;
  for (const b of blocks) {
    const r = view.previewRect(b.id) ?? b;
    const p = view.toScreen(r);
    const w = r.w * z, h = r.h * z;
    const bg = blockColor(b);
    ctx.strokeStyle = view.theme.line;
    ctx.lineWidth = 1;
    roundRect(ctx, p.x, p.y, w, h, 8 * z);
    const fill = bg && view.theme.blocks[bg];
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    ctx.stroke();
    if (fontPx >= 4) {
      ctx.fillStyle = view.theme.text;
      ctx.save();
      ctx.beginPath();
      ctx.rect(p.x, p.y, w - 4 * z, h);
      ctx.clip();
      ctx.fillText(titleOf(view, b.id) || '제목 없음', p.x + 13 * z, p.y + 11 * z);
      ctx.restore();
    } else {
      ctx.fillStyle = view.theme.line;
      ctx.fillRect(p.x + 10 * z, p.y + 12 * z, Math.min(w * 0.6, 140 * z), Math.max(1, 10 * z));
    }
  }
}

export function drawUnder(view: CanvasView): void {
  const ctx = view.ctx(view.under);
  // 배경: 점 그리드(FR-010, 기본) · 괘선 · 모눈 · 무지 (FR-041, 노트마다)
  // 용지(A4)면 책상 위 종이들, 아니면 끝없는 배경
  const vis = visibleWorldRect(view.cam, view.size);
  if (!drawSheets(ctx, view, vis)) { drawPaper(ctx, view.cam, vis, view.engine.note.paper, view.theme.grid); drawCover(ctx, view, vis); } // 표지 쪽 (11/03)
  drawCards(view, ctx); // 카드 바탕 · 머리 (노트형) — 상자 아래
  drawGroupShapes(view, ctx); // 묶음 도식 모양(시간축 · 사분면 · 척도) — 화살표 · 상자 아래
  // 화살표 — 블록 아래 (D4)
  const rectOf = (id: Id) => view.previewRect(id);
  const ids = new Set(view.engine.queryArrows(view.visibleRect()));
  const g = view.gesture;
  if (g.k === 'drag' || g.k === 'resize') {
    for (const bid of g.k === 'drag' ? g.ids : [g.id]) for (const a of view.engine.arrowsOf(bid)) ids.add(a.id);
  }
  if (g.k === 'reconnect') ids.delete(g.arrow); // 끌고 있는 화살표는 오버레이 미리보기로만
  ctx.font = '10.5px "Pretendard Variable", Pretendard, system-ui, "Malgun Gothic", sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  if (view.cam.zoom < LOD_BATCH_ZOOM) {
    // LOD: 선만 경로 하나로, 화살촉 · 라벨 생략
    const lines = new Path2D();
    for (const id of ids) {
      const a = view.engine.getArrow(id);
      const geo = a && view.engine.arrowGeometry(a, rectOf);
      if (!geo) continue;
      const p1 = view.toScreen(geo.a), p2 = view.toScreen(geo.b);
      lines.moveTo(p1.x, p1.y);
      lines.lineTo(p2.x, p2.y);
    }
    ctx.strokeStyle = view.theme.arrow;
    ctx.lineWidth = 1;
    ctx.stroke(lines);
    drawLodBlocks(view, ctx);
    return;
  }
  const heads = new Map<string, Id | undefined>();
  for (const id of ids) {
    const a = view.engine.getArrow(id);
    const geo = a && view.engine.arrowGeometry(a, rectOf);
    if (!a || !geo) continue;
    const selected = view.selArrows.has(id);
    const look = effectiveStyle(a); // 사용자 모양 > 관계 기본 (v6)
    const color = selected ? view.theme.accent : arrowColor(view.theme, a, look);
    // 시간축의 차례 · 벤의 소속 화살표는 모양이 이미 보인다 — 옅게, 라벨 없이 (고르면 그대로)
    const quiet = !selected && quietArrow(view, a, heads);
    if (quiet) ctx.globalAlpha = 0.25;
    drawArrow(ctx, geo.pts.map((p) => view.toScreen(p)), color, ((selected ? 2 : 1.25) * look.width) / 1.5, look);
    ctx.globalAlpha = 1;
    const chip = arrowChip(a); // [번호] ⇏ 기호 라벨 ± (v6)
    if (chip && !quiet && view.cam.zoom >= 0.5) drawArrowLabel(ctx, chip, view.toScreen(geo.mid), view.theme.card, selected ? view.theme.accent : view.theme.line, view.theme.muted);
  }
  if (view.lod) drawLodBlocks(view, ctx);
}
