// 엔진 변경 반영: 다시 그릴 블록 표시 · 사라진 선택 정리 · 편집 중인 에디터 동기화.
import { isTextContent, isTocContent, type ChangeEvent, type Id } from '@dn/engine-core';
import type { CanvasView } from './canvas-view';
import { applyPaperColor } from './paper';

export function handleChange(view: CanvasView, e: ChangeEvent): void {
  for (const id of e.changed) {
    view.dirtyIds.add(id);
    if (!view.engine.getBlock(id)) view.selBlocks.delete(id);
    if (!view.engine.getArrow(id) && view.selArrows.has(id)) view.selArrows.delete(id);
  }
  // 콘텐츠 변경은 소속 블록을 다시 그리게 한다
  for (const op of e.ops) {
    if (op.e === 'content') {
      const c = view.engine.getContent(op.id) ?? (op.k === 'delete' ? (op.prev as { blockId: Id }) : null);
      if (c) view.dirtyIds.add(c.blockId);
    }
  }
  // 묶음 정보가 바뀌면(카드로 바꾸기 등) 상자 모양이 바뀌므로 다 다시
  if (e.ops.some((op) => op.e === 'note' && op.k === 'set' && op.field === 'groups')) view.dirtyAll = true;
  // 캔버스 바탕색 (캔버스 설정) — 칸의 색 토큰이 바뀌면 2D 색(격자 · 화살표 · 손잡이)도 다시 읽는다
  if (e.ops.some((op) => op.e === 'note' && op.k === 'set' && op.field === 'paper') && applyPaperColor(view.root, view.engine.note.paper?.color)) view.refreshTheme();
  // 목차 블록(FR-053): 제목 글 · 블록 자리가 바뀌면 목차도 다시 (실제로 바뀐 게 없으면 mount가 그리지 않는다)
  for (const id of tocBlocks(view, e)) view.dirtyIds.add(id);
  if (view.editingId && !view.engine.getBlock(view.editingId)) view.editingId = null;
  // 사용자가 높이를 바꿨는데 글 때문에 화면 높이가 그대로면 크기 알림(ResizeObserver)이 오지 않아 데이터만 어긋난다 — 그린 뒤 한 번 재어 맞춘다 (AT-022)
  const resized = e.origin === 'user' ? e.ops.filter((op) => op.e === 'block' && op.k === 'set' && op.field === 'h').map((op) => op.id) : [];
  // 편집 중인 칸이 에디터 밖에서 바뀌면(undo · redo · 원격) 다음 프레임을 기다리지 않고 바로 에디터에 넣는다 —
  // 그 사이 친 글자가 옛 문서 기준 스텝으로 만들어져 엔진 문서와 어긋나는 것을 막는다. 에디터 자신의 입력(origin text)은 이미 같다.
  if (view.editingId && e.origin !== 'text') {
    const m = view.mounted.get(view.editingId);
    const c = m?.editingPart ? view.engine.getContent(m.editingPart) : undefined;
    if (m?.editor && c && isTextContent(c) && e.changed.has(c.id)) m.editor.setDoc(c.doc);
  }
  view.schedule();
  if (resized.length) requestAnimationFrame(() => remeasure(view, resized)); // 그리기 다음 차례 — 바뀐 DOM으로 잰다
  view.notifyUi();
}

function remeasure(view: CanvasView, ids: readonly Id[]): void {
  for (const id of ids) {
    const el = view.mounted.get(id)?.el, b = view.engine.getBlock(id);
    if (el && b && Math.abs(el.offsetHeight - b.h) >= 0.5) view.pendingHeights.set(id, el.offsetHeight);
  }
  if (view.pendingHeights.size) view.schedule();
}

/** 노트의 목차 블록 — 콘텐츠가 생기거나 지워질 때만 다시 찾는다 */
const tocCache = new WeakMap<CanvasView, Id[]>();
function tocBlocks(view: CanvasView, e: ChangeEvent): Id[] {
  let ids = tocCache.get(view);
  if (!ids || e.ops.some((op) => op.e === 'content' && (op.k === 'create' || op.k === 'delete'))) {
    ids = [...view.engine.contents()].filter(isTocContent).map((c) => c.blockId);
    tocCache.set(view, ids);
  }
  return ids;
}
