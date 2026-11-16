// 원문에서 상자 만들기 (11/02): 고치는 상자에서 고른 글을 캔버스로 끌어 놓으면 그 자리에 새 상자 — 원문은 그대로, 새 상자에 원문 연결(source).
// 끌기 자체는 브라우저 · 에디터의 글 끌기다. 원문 상자 밖(캔버스 · 다른 상자 위)에 놓을 때만 여기서 받고, 원문 상자 안에 놓으면 지금처럼 글 옮기기.
import { boxFromSource, DEFAULT_BLOCK_W, screenToWorld, type Id, type TextDoc, type Vec2 } from '@dn/engine-core';
import type { CanvasView } from './canvas-view';
import { placeNew } from './create';
import { local } from './geometry';

interface Slice { readonly doc: TextDoc; readonly from: number; readonly to: number }
const drags = new WeakMap<CanvasView, { blockId: Id; contentId: Id; slice: Slice }>();

export function sourceDragStart(view: CanvasView, e: DragEvent): void {
  drags.delete(view);
  const id = view.editingId, m = id ? view.mounted.get(id) : undefined;
  if (!id || view.readOnly || !m?.editor || !m.editingPart || !(e.target instanceof Node) || !m.el.contains(e.target)) return;
  const slice = m.editor.selectedSlice();
  if (slice) drags.set(view, { blockId: id, contentId: m.editingPart, slice });
}

export const sourceDragEnd = (view: CanvasView): void => { drags.delete(view); };

/** 원문 끌기를 원문 상자 밖에 놓으려는가 */
function outside(view: CanvasView, e: DragEvent): boolean {
  const d = drags.get(view);
  return !!d && !(e.target instanceof Node && view.mounted.get(d.blockId)?.el.contains(e.target));
}

/** 받으면 true — 아니면 다른 끌어 놓기(옆 노트 블록 · 파일)로 */
export function sourceDragOver(view: CanvasView, e: DragEvent): boolean {
  if (!outside(view, e)) return false;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  return true;
}

export function sourceDrop(view: CanvasView, e: DragEvent): boolean {
  if (!outside(view, e)) return false;
  const d = drags.get(view)!;
  drags.delete(view);
  e.preventDefault();
  makeSourceBox(view, d.contentId, d.slice, screenToWorld(view.cam, local(view, e)));
  return true;
}

/** 원문 조각으로 상자를 만들고 고른다 — at: 왼쪽 위(막혀 있으면 가까운 빈 자리), 폭은 원문 상자와 같게 */
export function makeSourceBox(view: CanvasView, contentId: Id, slice: Slice, at: Vec2): void {
  const c = view.engine.getContent(contentId), w = (c && view.engine.getBlock(c.blockId)?.w) || DEFAULT_BLOCK_W;
  const to = placeNew(view, { x: at.x, y: at.y, w, h: view.measureText(slice.doc, w) });
  view.endEditing();
  const r = boxFromSource(view.engine, contentId, slice, slice.doc, to, w);
  if (r.ok) { view.select([r.value.blockId]); view.root.focus({ preventScroll: true }); }
}
