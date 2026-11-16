// 포인터 입력: 누르기 · 움직이기 · 떼기 → 제스처(팬 · 끌기 · 리사이즈 · 마키 · 연결 · 핀치).
import {
  endBlock, moveSelection, findDockSpot, moveBlocks, panBy, q, rectFromPoints, rectsIntersect,
  resizeBlock, screenToWorld, snapRect, zoomAt, type Id, type Vec2,
} from '@dn/engine-core';
import { dragArrow, dropTarget, finishConnect, finishReconnect, movableArrow, startArrow } from './arrow-input';
import type { CanvasView } from './canvas-view';
import { DRAG_THRESHOLD, SNAP_PX } from './constants';
import { createBlockAt } from './create';
import { editPart } from './editing';
import { arrowHidden, dragUnion, fitBoxResize, hitArrowEnd, hitConnect, hitHandle, inGripZone, isEditableTarget, local, resizeRect, selectsBoxes } from './geometry';
import { updateBlock } from './mount';
import { bothDragStart, marqueeInk } from './select-both';
import { clampDragDelta, clampResize } from './sheet-view';
import { endGroupScale, expandToGroups, groupAround, hitGroup, moveGroupScale, selectedGroup, startGroupScale, trackGroupZone } from './groups-view';
import { cancelConnect } from './a11y';
import { extendCellSel, startCellEdit } from './table-edit';
import { inkDown, inkIgnores, inkMove, inkUp, isInkTool } from './ink-input';
import { flipStatic, openNoteLink } from './static-click';

export function handlePointerDown(view: CanvasView, e: PointerEvent): void {
  if (view.labelInput && e.target === view.labelInput) return;
  if (view.pointerKind !== e.pointerType) { view.pointerKind = e.pointerType || 'mouse'; view.root.classList.toggle('dn-touch', view.pointerKind !== 'mouse'); }
  if (inkIgnores(view, e)) return; // 펜이 긋는 동안 손바닥 · 다른 손가락 (FR-040)
  if (view.editingId && isEditableTarget(e.target)) return; // 텍스트 편집은 브라우저에 맡긴다
  // 데이터베이스 칸 · 버튼 (FR-057)은 그 요소가 처리 — 잉크 도구 · 손 도구일 때만 캔버스가 가져간다.
  // 데이터베이스 제목은 끌면 블록 옮기기, 그냥 누르면(떼면) 제목 고치기 — 몸통이 칸뿐이라 끌 자리가 모자랐다 (CQ-021)
  const dbTitle = (e.target as Element | null)?.closest?.<HTMLInputElement>('input.dn-db-title');
  const titleGrab = !!dbTitle && document.activeElement !== dbTitle && e.button === 0 && selectsBoxes(view._tool);
  if (titleGrab) e.preventDefault();
  else if (!isInkTool(view._tool) && view._tool !== 'hand' && !view.space && e.button === 0 && (e.target as Element | null)?.closest?.('.dn-db-ui, .dn-ui')) return;
  cancelAnimationFrame(view.anim);
  cancelConnect(view, true); // 마우스 · 터치를 쓰면 키보드 연결 모드는 끝
  const s = local(view, e);
  view.pointers.set(e.pointerId, s);
  try { view.root.setPointerCapture(e.pointerId); } catch { /* 이미 끝난 포인터 · 합성 이벤트 */ }
  if (e.target === view.root || !isEditableTarget(e.target)) view.root.focus({ preventScroll: true });

  if (view.pointers.size === 2) { startPinch(view); return; }
  if (view.pointers.size > 2) return;

  const w = screenToWorld(view.cam, s);
  if (e.button === 1 || view._tool === 'hand' || view.space) {
    view.gesture = { k: 'pan', last: s };
    view.root.classList.add('dn-panning');
    e.preventDefault();
    return;
  }
  if (inkDown(view, e, w)) return;
  // 잉크 도구에서 손가락(펜 전용) → 화면 이동
  if (isInkTool(view._tool) && e.pointerType === 'touch') { view.gesture = { k: 'pan', last: s }; return; }
  if (e.button !== 0) return;

  // 표 셀 편집 중 같은 표의 다른 칸을 누르면 그 칸으로
  if (view.cellEdit) {
    const td = e.target instanceof Element ? e.target.closest<HTMLElement>('.dn-table td[data-row]') : null;
    const part = td?.closest<HTMLElement>('[data-part]');
    if (td && part?.dataset.part === view.cellEdit.contentId) {
      release(view, e.pointerId);
      // 브라우저 기본 동작(누른 곳으로 포커스)을 막는다 — 막지 않으면 고치던 칸이 포커스를 잃어 편집이 끝나 버린다
      e.preventDefault();
      const { blockId, contentId } = view.cellEdit;
      // Shift+클릭: 지금 칸과 그 칸 사이를 고른다 (칸 합치기)
      if (e.shiftKey) { extendCellSel(view, td.dataset.row!, td.dataset.col!); return; }
      startCellEdit(view, blockId, contentId, td.dataset.row!, td.dataset.col!);
      return;
    }
  }

  if (view.editingId) {
    // 편집 중인 블록의 다른 칸(제목 ↔ 본문)을 누르면 그 칸으로 편집을 옮긴다
    const partEl = (e.target as HTMLElement | null)?.closest?.('[data-part]') as HTMLElement | null;
    const m = view.mounted.get(view.editingId);
    const p = partEl && m?.el.contains(partEl) ? m.parts.find((x) => x.el === partEl && x.role !== 'other') : undefined;
    if (m && p) {
      release(view, e.pointerId);
      editPart(view, view.editingId, m, p, { clientX: e.clientX, clientY: e.clientY });
      return;
    }
    view.endEditing();
  }

  // 노트 링크 (FR-080): 편집 중이 아닌 블록에서도 누르면 그 노트로 (읽기 전용에서도)
  if (openNoteLink(view, e)) { release(view, e.pointerId); return; }

  if (view.readOnly) {
    const hit = view.engine.hitTest(w, 8 / view.cam.zoom);
    if (hit?.kind === 'block') view.select([hit.id]);
    else if (hit?.kind === 'arrow') view.selectArrow(hit.id);
    else { view.select([]); view.gesture = { k: 'pan', last: s }; }
    return;
  }

  // 편집 중이 아닌 블록의 토글 화살표 · 할 일 상자: 누르면 바로 접기/펼치기 · 체크 (FR-047 · FR-033)
  if (flipStatic(view.engine, e, view.cam.zoom)) { release(view, e.pointerId); return; }

  // 블록 핸들: 누르면 그 블록을 (이미 다중 선택에 있으면 선택 전체를) 끌 준비. 안 움직이고 떼면 메뉴.
  if (e.target === view.grip && view.gripId) {
    if (!view.selBlocks.has(view.gripId)) view.select([view.gripId]);
    view.gesture = { k: 'drag', ids: [...view.selBlocks], start: w, delta: { x: 0, y: 0 }, moved: false, grip: true };
    view.schedule();
    return;
  }

  const end = hitArrowEnd(view, s);
  if (end) {
    view.gesture = { k: 'reconnect', arrow: end.arrow, end: end.end, cur: w, target: null, start: w };
    return;
  }

  // 고른 블록(묶음)의 모서리 → 묶음 전체를 같은 배율로
  if (startGroupScale(view, s)) { view.schedule(); return; }
  const handle = hitHandle(view, s);
  if (handle) {
    const r = view.engine.blockRect([...view.selBlocks][0]!)!;
    view.gesture = { k: 'resize', id: [...view.selBlocks][0]!, handle, start: r, startW: w, rect: r };
    return;
  }
  const conn = hitConnect(view, s);
  if (conn) {
    view.gesture = { k: 'connect', from: conn, cur: w, target: null, start: w };
    return;
  }

  const hit = view.engine.hitTest(w, 8 / view.cam.zoom);
  if (view._tool === 'block' || view._tool === 'title') {
    // 뒤따르는 mousedown의 기본 동작(클릭한 캔버스로 포커스 이동)이 방금 연 에디터의 포커스를 빼앗아 편집이 바로 끝나지 않게
    e.preventDefault();
    createBlockAt(view, { x: w.x - 20, y: w.y - 20 }, view._tool === 'title' ? 'title' : 'text');
    view.setTool(view.homeTool);
    return;
  }
  if (view._tool === 'arrow') { startArrow(view, hit?.kind === 'block' ? hit.id : null, w); return; } // 빈 곳에서도 (11/09)
  const withInk = view._tool === 'both' && view.ink.selected.size ? { ink: true } : {};
  // 블록(묶음)을 통째로: 이름표 · 테두리 선을 누르면 묶음 전체를 고르고 끈다 — 안쪽 빈 곳은 아래 마키로 콘텐츠 고르기 (10/29)
  const group = selectsBoxes(view._tool) ? hitGroup(view, s, true) : null;
  if (group) {
    if (e.shiftKey) for (const id of group) view.selBlocks.add(id);
    else if (!group.every((id) => view.selBlocks.has(id))) view.select(group);
    view.selArrows.clear();
    view.gesture = { k: 'drag', ids: [...view.selBlocks], start: w, delta: { x: 0, y: 0 }, moved: false, ...withInk };
    view.notifyUi();
    view.schedule();
    return;
  }
  // 선택 도구 '둘 다': 고른 필기 테두리 안(상자 밖)을 누르면 고른 상자 · 필기를 함께 끈다
  if (hit?.kind !== 'block' && bothDragStart(view, w)) return;
  if (hit?.kind === 'block') {
    // 묶음 안 상자를 누르면 그 상자 하나만 (끌어도 그 상자만). 여럿을 고른 채 그중 하나를 누르면 고른 것 전체를 끈다 — 묶음 하나만 고른 때는 빼고
    if (e.shiftKey) {
      if (view.selBlocks.has(hit.id)) view.selBlocks.delete(hit.id); else view.selBlocks.add(hit.id);
    } else if (!view.selBlocks.has(hit.id) || selectedGroup(view)) {
      view.select([hit.id]);
    }
    view.selArrows.clear();
    if (view.selBlocks.has(hit.id)) view.gesture = { k: 'drag', ids: [...view.selBlocks], start: w, delta: { x: 0, y: 0 }, moved: false, ...withInk, ...(titleGrab ? { click: dbTitle! } : {}) };
  } else if (hit?.kind === 'arrow') {
    view.selBlocks.clear();
    if (!e.shiftKey) view.selArrows.clear();
    view.selArrows.add(hit.id);
    if (!e.shiftKey && movableArrow(view, hit.id)) view.gesture = { k: 'amove', arrow: hit.id, last: w }; // 빈 곳 화살표는 몸통을 끌어 옮긴다
  } else if (e.pointerType === 'touch') {
    view.gesture = { k: 'pan', last: s };
  } else {
    const additive = e.shiftKey;
    if (!additive) { view.selBlocks.clear(); view.selArrows.clear(); if (view._tool === 'both') view.ink.selected.clear(); }
    // 묶음 테두리 안 빈 곳에서 끌면 그 묶음의 콘텐츠만 하나씩 (밖에서 끌면 묶음은 통째로)
    const around = groupAround(view, s);
    view.gesture = { k: 'marquee', start: w, cur: w, additive, base: new Set(view.selBlocks), ...(view._tool === 'both' ? { inkBase: new Set(view.ink.selected) } : {}), ...(around ? { within: new Set(around) } : {}) };
  }
  view.notifyUi();
  view.schedule();
}

export function handlePointerMove(view: CanvasView, e: PointerEvent): void {
  const s = local(view, e);
  view.lastPointer = s;
  if (view.pointers.has(e.pointerId)) view.pointers.set(e.pointerId, s);
  if (inkMove(view, e)) return;
  const g = view.gesture;
  const w = screenToWorld(view.cam, s);
  switch (g.k) {
    case 'none': {
      if (e.target === view.grip) { view.root.style.cursor = 'grab'; return; } // 핸들 위에서는 호버 블록을 유지
      if (e.pointerType === 'mouse' && selectsBoxes(view._tool) && !view.editingId) {
        const hit = view.engine.hitTest(w, 8 / view.cam.zoom);
        const h = hit?.kind === 'block' ? hit.id : (hitConnect(view, s)?.blockId ?? inGripZone(view, s));
        updateCursor(view, s, hitGroup(view, s, true) ? 'block' : hit?.kind ?? null);
        if (h !== view.hover) { view.hover = h; view.schedule(); }
        if (trackGroupZone(view, s)) view.schedule();
      }
      return;
    }
    case 'pan': {
      view.setCamera(panBy(view.cam, s.x - g.last.x, s.y - g.last.y));
      g.last = s;
      return;
    }
    case 'pinch': updatePinch(view); return;
    case 'drag': {
      const dx = w.x - g.start.x, dy = w.y - g.start.y;
      if (!g.moved && Math.hypot(dx, dy) * view.cam.zoom < DRAG_THRESHOLD) return;
      g.moved = true;
      g.delta = { x: q(dx), y: q(dy) };
      g.guides = [];
      // 가까이 가면 착 붙기 (자석 스냅). Shift를 누르고 끌면 끈다 — 완전 자유 배치
      const u = !e.shiftKey && dragUnion(view, g.ids);
      if (u) {
        const s = snapRect(view.engine, { ...u, x: u.x + g.delta.x, y: u.y + g.delta.y }, new Set(g.ids), SNAP_PX / view.cam.zoom);
        g.delta = { x: s.x - u.x, y: s.y - u.y };
        g.guides = s.guides;
      }
      const su = dragUnion(view, g.ids); // 용지(A4)면 종이 폭 안으로
      if (su) g.delta = clampDragDelta(view, su, g.delta);
      if (g.ink) view.ink.drag = { mode: 'move', start: g.start, delta: g.delta };
      break;
    }
    case 'resize': { // 옆 상자에 닿으면 이음매 앞에서 멈춘다 — 다른 상자는 덮지도 옮기지도 않는다 (10/29)
      const r = clampResize(view, resizeRect(g.start, g.handle, w.x - g.startW.x, w.y - g.startW.y, e.shiftKey));
      g.rect = fitBoxResize(view, g.id, g.start, r, g.handle.includes('n') || g.handle.includes('s')) ?? g.rect;
      break;
    }
    case 'gscale': moveGroupScale(view, w); break;
    case 'marquee': {
      g.cur = w;
      const r = rectFromPoints(g.start, g.cur);
      view.selBlocks.clear();
      for (const id of g.base) view.selBlocks.add(id);
      for (const id of view.engine.queryBlocks(r)) {
        const b = view.engine.getBlock(id);
        if (!b || !rectsIntersect(b, r)) continue;
        if (g.within) { if (g.within.has(id)) view.selBlocks.add(id); } // 묶음 안에서 끈 마키는 그 콘텐츠만 하나씩
        else for (const x of expandToGroups(view, [id])) view.selBlocks.add(x); // 블록(묶음)은 통째로
      }
      if (g.inkBase) marqueeInk(view, r, g.inkBase);
      view.notifyUi();
      break;
    }
    case 'connect': g.cur = w; g.target = dropTarget(view, w, endBlock(g.from)); break;
    case 'reconnect': {
      g.cur = w;
      const a = view.engine.getArrow(g.arrow);
      g.target = dropTarget(view, w, a ? endBlock(a[g.end === 'from' ? 'to' : 'from']) : undefined);
      break;
    }
    case 'amove': dragArrow(view, g, w); break;
  }
  view.schedule();
}

/** 이 포인터를 추적 · 캡처에서 놓는다 */
function release(view: CanvasView, id: number): void {
  view.pointers.delete(id);
  if (view.root.hasPointerCapture(id)) view.root.releasePointerCapture(id);
}

export function handlePointerUp(view: CanvasView, e: PointerEvent): void {
  release(view, e.pointerId);
  if (inkUp(view, e)) return;
  const g = view.gesture;
  if (g.k === 'pinch') {
    if (view.pointers.size < 2) view.gesture = { k: 'none' };
    return;
  }
  view.gesture = { k: 'none' };
  view.root.classList.remove('dn-panning');
  switch (g.k) {
    case 'drag':
      if (g.ink) view.ink.drag = null;
      if (g.moved && (g.delta.x || g.delta.y)) {
        // 놓을 자리가 다른 블록과 겹치면 가장 가까운 빈 자리에 붙인다 (다른 블록은 움직이지 않는다)
        const u = dragUnion(view, g.ids);
        if (u) {
          const to = findDockSpot(view.engine, { ...u, x: u.x + g.delta.x, y: u.y + g.delta.y }, new Set(g.ids));
          g.delta = clampDragDelta(view, u, { x: q(to.x - u.x), y: q(to.y - u.y) });
        }
        if (g.delta.x || g.delta.y) {
          if (g.ink) moveSelection(view.engine, g.ids, [...view.ink.selected], g.delta.x, g.delta.y);
          else moveBlocks(view.engine, g.ids, g.delta.x, g.delta.y);
        }
      }
      else if (g.grip && !g.moved && view.onBlockMenu) {
        const r = view.grip.getBoundingClientRect();
        view.onBlockMenu({ ids: [...view.selBlocks], x: r.left, y: r.bottom + 4 });
      }
      else if (g.click && !g.moved && g.click.isConnected) { const n = g.click.value.length; g.click.focus({ preventScroll: true }); g.click.setSelectionRange(n, n); }
      break;
    case 'gscale': endGroupScale(view, g); break;
    case 'resize': {
      const heightChanged = g.handle.includes('n') || g.handle.includes('s');
      resizeBlock(view.engine, g.id, g.rect, heightChanged);
      const m = view.mounted.get(g.id);
      const b = view.engine.getBlock(g.id);
      if (m && b) updateBlock(view, b, m);
      break;
    }
    case 'connect': {
      // 상자 위면 그 상자에(이미 이은 두 상자면 그 화살표를 고름 — CQ-007), 빈 곳이면 그 점에 (11/09 — 빈 상자를 만들지 않는다)
      finishConnect(view, g, (id) => pickArrow(view, id));
      // 화살표 도구는 한 번 이으면 고르기로 — 제목 · 내용 상자 도구처럼 (AT-013)
      if (view._tool === 'arrow') view.setTool(view.homeTool);
      break;
    }
    case 'reconnect': finishReconnect(view, g); break; // 다른 상자로 · 빈 곳이면 상자에서 떼기
    case 'amove': view.engine.breakUndoMerge(); break; // 다음 끌기는 따로 실행 취소
  }
  view.schedule();
  view.notifyUi();
}

export function handlePointerLeave(view: CanvasView): void {
  view.lastPointer = null;
  if (view.hover && view.gesture.k === 'none') { view.hover = null; view.schedule(); }
  if (trackGroupZone(view, null)) view.schedule();
}

/** 두 손가락 사이 거리 · 가운데 */
const pinchOf = (view: CanvasView) => { const [a, b] = [...view.pointers.values()] as [Vec2, Vec2]; return { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }; };

function startPinch(view: CanvasView): void {
  if (view.gesture.k === 'drag' && view.gesture.ink) view.ink.drag = null;
  view.gesture = { k: 'pinch', ...pinchOf(view) };
}

function updatePinch(view: CanvasView): void {
  const g = view.gesture;
  if (g.k !== 'pinch' || view.pointers.size < 2) return;
  const { dist, mid } = pinchOf(view);
  let c = panBy(view.cam, mid.x - g.mid.x, mid.y - g.mid.y);
  if (g.dist > 0) c = zoomAt(c, mid, c.zoom * (dist / g.dist));
  g.dist = dist;
  g.mid = mid;
  view.setCamera(c);
}

function updateCursor(view: CanvasView, s: Vec2, hit: 'block' | 'arrow' | null): void {
  const h = hitHandle(view, s);
  const cursor = h ? ({ n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' } as const)[h]
    : hitArrowEnd(view, s) ? 'grab' : hitConnect(view, s) ? 'crosshair' : hit === 'block' ? 'move' : hit === 'arrow' ? 'pointer' : '';
  view.root.style.cursor = cursor;
}

/** 이은 화살표를 고른다 — 붙어 있는 상자라 숨은 화살표면 알리기만 */
function pickArrow(view: CanvasView, id: Id): void {
  if (arrowHidden(view, id)) view.host.onNotice?.('arrow-hidden');
  else view.selectArrow(id);
}
