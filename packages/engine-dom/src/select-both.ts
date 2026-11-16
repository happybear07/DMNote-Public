// 선택 도구 '둘 다'(both): 상자와 필기를 함께 — 고른 필기 테두리 안에서 끌기, 마키로 필기도, 지우기 · Esc · 화살표 · 1~6 색 · 모두 선택.
// 상자 쪽 동작(손잡이 · 크기 조절 · 연결점 · 묶음)은 '필기 뺀 콘텐츠(select)'와 같다.
import { deleteEntities, freeStrokes, lassoStrokes, moveSelection, type Id, type Rect, type Vec2 } from '@dn/engine-core';
import type { CanvasView } from './canvas-view';
import { dragUnion } from './geometry';
import { recolorSelectedInk } from './ink-input';
import { selectionBounds } from './ink-layer';
import { clampDragDelta } from './sheet-view';

/** 고른 필기 테두리 안(상자 밖)을 누르면 고른 상자 · 필기를 함께 끌기 시작. 시작했으면 true */
export function bothDragStart(view: CanvasView, w: Vec2): boolean {
  if (view._tool !== 'both' || !view.ink.selected.size) return false;
  const r = selectionBounds(view);
  if (!r || w.x < r.x || w.y < r.y || w.x > r.x + r.w || w.y > r.y + r.h) return false;
  view.gesture = { k: 'drag', ids: [...view.selBlocks], start: w, delta: { x: 0, y: 0 }, moved: false, ink: true };
  view.schedule();
  return true;
}

/** 마키 사각형 안의 필기(점의 절반 이상)를 base에 더해 고른다 — 숨긴 필기는 고르지 않는다 */
export function marqueeInk(view: CanvasView, r: Rect, base: ReadonlySet<Id>): void {
  const sel = view.ink.selected;
  sel.clear();
  for (const id of base) sel.add(id);
  if (!view.ink.show) return;
  for (const id of lassoStrokes(view.engine, [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }])) sel.add(id);
}

/** Ctrl+A: '둘 다'면 보이는 필기도 */
export function selectAllInk(view: CanvasView): void {
  if (view._tool !== 'both' || !view.ink.show) return;
  for (const s of freeStrokes(view.engine)) view.ink.selected.add(s.id);
  view.schedule();
  view.notifyUi();
}

/** '둘 다'의 키 — 고른 상자 · 화살표 · 필기를 한꺼번에 (실행 취소 한 번). 처리했으면 true */
export function bothKey(view: CanvasView, e: KeyboardEvent): boolean {
  if (view._tool !== 'both') return false;
  const ink = view.ink.selected, sel = [...view.selBlocks];
  const any = sel.length > 0 || view.selArrows.size > 0 || ink.size > 0;
  switch (e.key) {
    case 'Delete': case 'Backspace': {
      if (!any) return false;
      e.preventDefault();
      const strokes = [...ink];
      deleteEntities(view.engine, sel, [...view.selArrows], strokes);
      view.select([]); // 필기 선택도 함께 풀린다
      return true;
    }
    case 'Escape':
      if (!any) return false; // 고른 게 없으면 평소처럼 (선택 도구로)
      view.select([]);
      return true;
    case 'ArrowUp': case 'ArrowDown': case 'ArrowLeft': case 'ArrowRight': {
      if (!ink.size || e.altKey) return false; // 필기가 없으면 상자만 옮기는 평소 동작
      e.preventDefault();
      const d = e.shiftKey ? 10 : 1;
      let k = { x: e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0, y: e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0 };
      const u = dragUnion(view, sel); // 용지(A4)면 종이 안에서만
      if (u) k = clampDragDelta(view, u, k);
      if (k.x || k.y) moveSelection(view.engine, sel, [...ink], k.x, k.y, `nudge:${sel.join(',')}:${[...ink].join(',')}`);
      view.schedule();
      return true;
    }
  }
  if (ink.size && !e.altKey && /^[1-6]$/.test(e.key)) { const c = view.ink.colors[Number(e.key) - 1]; if (c) recolorSelectedInk(view, c); return true; }
  return false;
}
