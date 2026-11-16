// 캔버스 루트에 입력 리스너 달기 · 떼기. 실제 처리는 pointer · keyboard · paste 모듈이 한다.
import { BLOCK_CLIP_MIME, blockClip, docText, isTextContent } from '@dn/engine-core';
import type { CanvasView } from './canvas-view';
import { setupA11y } from './a11y';
import { handleContextMenu, handleDblClick, handleFocusOut, handleKeyDown, handleKeyUp, handleWheel } from './keyboard';
import { handleDragOver, handleDrop, handlePaste } from './paste';
import { handlePointerDown, handlePointerLeave, handlePointerMove, handlePointerUp } from './pointer';
import { sourceDragEnd, sourceDragOver, sourceDragStart, sourceDrop } from './source-drag';
import { bindTableSort } from './table-sort-ui';

/** 캔버스에 초점이 있고 글을 고치는 중이 아니면, 고른 블록을 블록 클립 + 글로 담는다 */
function clip(view: CanvasView, e: ClipboardEvent, cut: boolean): void {
  const ids = [...view.selBlocks];
  if (!ids.length || view.editingId || !e.clipboardData || !view.root.contains(document.activeElement) || view.root.offsetParent === null) return;
  const en = view.engine;
  e.preventDefault();
  e.clipboardData.setData(BLOCK_CLIP_MIME, JSON.stringify(blockClip(en, ids)));
  e.clipboardData.setData('text/plain', ids.flatMap((id) => en.contentsOf(id).filter(isTextContent).map((c) => docText(c.doc))).join('\n\n'));
  if (cut && !view.readOnly) view.deleteSelection();
}

/** 리스너를 달고, 같은 리스너를 떼는 함수를 돌려준다 */
export function bindInput(view: CanvasView): () => void {
  const root = view.root;
  setupA11y(view);
  const ac = new AbortController();
  const signal = ac.signal;
  root.addEventListener('pointerdown', (e) => handlePointerDown(view, e), { signal });
  root.addEventListener('pointermove', (e) => handlePointerMove(view, e), { signal });
  root.addEventListener('pointerup', (e) => handlePointerUp(view, e), { signal });
  root.addEventListener('pointercancel', (e) => handlePointerUp(view, e), { signal });
  root.addEventListener('pointerleave', () => handlePointerLeave(view), { signal });
  root.addEventListener('dblclick', (e) => handleDblClick(view, e), { signal });
  root.addEventListener('contextmenu', (e) => handleContextMenu(view, e), { signal });
  bindTableSort(root, view.engine, { readOnly: () => view.readOnly, onRefused: () => view.host.onNotice?.('table-sort-merged'), signal }); // 표 열 머리 정렬
  root.addEventListener('wheel', (e) => handleWheel(view, e), { passive: false, signal });
  root.addEventListener('keydown', (e) => handleKeyDown(view, e), { signal });
  root.addEventListener('keyup', (e) => handleKeyUp(view, e), { signal });
  root.addEventListener('focusout', (e) => handleFocusOut(view, e), { signal });
  root.addEventListener('paste', (e) => handlePaste(view, e), { signal });
  // 고른 블록 복사 · 잘라내기 (CQ-008) — 붙여넣기는 paste.ts가 같은 블록 클립(문서 뷰와 같음)을 읽는다
  document.addEventListener('copy', (e) => clip(view, e, false), { signal });
  document.addEventListener('cut', (e) => clip(view, e, true), { signal });
  // 고치는 상자의 글을 캔버스로 끌어 놓으면 원문과 이어진 새 상자 (source-drag) — 아니면 옆 노트 블록 · 파일
  root.addEventListener('dragstart', (e) => sourceDragStart(view, e), { signal });
  root.addEventListener('dragend', () => sourceDragEnd(view), { signal });
  root.addEventListener('dragover', (e) => { if (!sourceDragOver(view, e)) handleDragOver(view, e); }, { signal });
  root.addEventListener('drop', (e) => { if (!sourceDrop(view, e)) handleDrop(view, e); }, { signal });
  // 캔버스 둘레 초점 테두리는 Tab으로 들어왔을 때만 (DS-003) — 노트를 열거나 단축키 뒤 앱이 준 초점에는 그리지 않는다
  let tabbed = false;
  document.addEventListener('keydown', (e) => { tabbed = e.key === 'Tab'; }, { capture: true, signal });
  document.addEventListener('pointerdown', () => { tabbed = false; }, { capture: true, signal });
  root.addEventListener('focus', () => root.classList.toggle('dn-kbd-focus', tabbed), { signal });
  root.addEventListener('blur', () => root.classList.remove('dn-kbd-focus'), { signal });
  return () => { ac.abort(); root.classList.remove('dn-kbd-focus'); };
}
