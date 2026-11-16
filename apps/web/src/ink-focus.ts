// 필기에서 읽은 글(FR-120)의 검색 결과 · 노트에 묻기 인용으로 가기: 그 획들을 올가미로 고르고 화면을 그 자리로.
// 블록으로 묶은 필기(FR-037)는 획 자리가 그 콘텐츠 기준이고 올가미로 고를 수도 없다 — 그 블록을 고르고 블록으로 (교차 검토 B7)
import { fitRect, isStroke, strokeBounds, unionRects, type Id, type Rect } from '@dn/engine-core';
import type { CanvasView } from '@dn/engine-dom';

export function focusInk(view: CanvasView, strokes: readonly Id[]): boolean {
  const e = view.engine;
  const ss = strokes.map((id) => e.getStroke(id)).filter(isStroke);
  const free = ss.filter((s) => s.parent.kind === 'layer');
  const blocks = [...new Set(ss.flatMap((s) => (s.parent.kind === 'content' ? [e.getContent(s.parent.contentId)?.blockId ?? ''] : [])).filter((b) => e.getBlock(b)))];
  const r = unionRects([...free.map(strokeBounds), ...blocks.map((b) => e.blockRect(b)).filter((x): x is Rect => !!x)]);
  if (!r) return false;
  if (free.length) {
    view.setTool('lasso');
    view.ink.selected.clear();
    for (const s of free) view.ink.selected.add(s.id);
  } else {
    view.ink.selected.clear();
    view.setTool(view.homeTool === 'lasso' ? 'select' : view.homeTool);
    view.select(blocks);
  }
  view.animateTo(fitRect(r, view.size, Math.max(64, Math.min(view.size.w, view.size.h) / 4)));
  return true;
}
