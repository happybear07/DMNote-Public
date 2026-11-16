// 키 · 휠 · 더블클릭(블록 편집 · 화살표 이름) · 포커스 입력.
import { bringToFront, isFree, isTableContent, panBy, screenToWorld, sortedRows, zoomAt, setBlockTextStyle, type Id, type Rect } from '@dn/engine-core';
import type { CanvasView } from './canvas-view';
import { editArrowLabel } from './editing';
import { clampDragDelta, clampResize } from './sheet-view';
import { groupSelection, hitGroup, selectedGroup, ungroupSelection } from './groups-view';
import { startCellEdit, startHeaderEdit } from './table-edit';
import { startTabEdit } from './tabs-render';
import { bindSelectedInk, hasBoundInk, inkKey, isInkTool, setInkStyle, setInkVisibility, unbindBlockInk } from './ink-input';
import { HL_WIDTH, PEN_WIDTH, stepWidth } from './ink-layer';
import type { Tool } from './types';
import { dragUnion, fitBoxResize, isEditableTarget, local, textHeight } from './geometry';
import { announce, cancelConnect, connectSource, finishConnect, startConnect, tabBlock } from './a11y';
import { bothKey, selectAllInk } from './select-both';
import { liveWeb } from './web-render';

export function handleWheel(view: CanvasView, e: WheelEvent): void {
  cancelAnimationFrame(view.anim);
  if (isEditableTarget(e.target) && !e.ctrlKey && !e.metaKey) return;
  e.preventDefault();
  const s = local(view, e);
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? view.size.h : 1;
  if (e.ctrlKey || e.metaKey || (view.wheelMode === 'zoom' && !e.shiftKey)) {
    // Ctrl/⌘+휠 · 트랙패드 핀치 = 줌 (D7 추천안)
    view.setCamera(zoomAt(view.cam, s, view.cam.zoom * Math.exp((-e.deltaY * unit) / 400)));
  } else {
    const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
    const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY;
    view.setCamera(panBy(view.cam, -dx * unit, -dy * unit));
  }
}

/** 캔버스 글자 단축키 — 고른 상자에 쳐도 글이 아니라 단축키 (나머지 글자는 그 상자에 쓴다) */
const TOOL_KEYS = ['v', 'b', 't', 'a', 'h', 'p', 'm', 'e', 'l', 'c', ']', '!', ')', '/', ' '];

export function handleKeyDown(view: CanvasView, e: KeyboardEvent): void {
  if (e.isComposing) return;
  const mod = e.ctrlKey || e.metaKey;
  const editing = isEditableTarget(e.target);
  // 글 편집 중 Ctrl+D: 고치는 블록 복제 (브라우저 즐겨찾기 창 대신, CQ-014) — 편집은 그대로
  if (editing && mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'd' && view.editingId) { e.preventDefault(); const id = view.editingId; view.endEditing(); view.select([id]); view.duplicateSelection(); return; }
  // 텍스트 편집 중 키는 에디터 키맵이 처리한다 (Ctrl+Z → 엔진 undo, Esc → 편집 종료)
  if (editing || e.defaultPrevented || (e.target as Element | null)?.closest?.('.dn-db-ui, .dn-ui')) return;
  view.plainPaste = mod && e.shiftKey && (e.key === 'v' || e.key === 'V');
  if (e.key === ' ' && !view.space) { view.space = true; view.root.classList.add('dn-space'); e.preventDefault(); return; }
  const sel = [...view.selBlocks];
  if (view.readOnly) {
    // 보기 전용: 줌 · 맞춤 · 선택 해제만
    if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); view.zoomStep(1); }
    else if (mod && e.key === '-') { e.preventDefault(); view.zoomStep(-1); }
    else if (e.key === '!') view.fit();
    else if (e.key === ')') view.zoomTo(1);
    else if (e.key === 'Escape') view.select([]);
    return;
  }
  if (mod && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); if (e.shiftKey) view.redo(); else view.undo(); return; }
  if (mod && e.key === 'y') { e.preventDefault(); view.redo(); return; }
  if (mod && e.key === 'd') { e.preventDefault(); view.duplicateSelection(); return; }
  if (mod && e.key === 'a') { e.preventDefault(); view.select([...view.engine.blocks()].map((b) => b.id)); selectAllInk(view); return; }
  if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); view.zoomStep(1); return; }
  if (mod && e.key === '-') { e.preventDefault(); view.zoomStep(-1); return; }
  // 잉크 묶기 · 풀기 (FR-037)
  if (mod && e.code === 'KeyG') {
    e.preventDefault();
    if (e.shiftKey) { if (!ungroupSelection(view) && hasBoundInk(view, sel)) unbindBlockInk(view, sel); }
    else if (view.ink.selected.size) bindSelectedInk(view);
    else if (groupSelection(view)) announce(view, '블록으로 묶었어요');
    return;
  }
  if (mod && e.altKey && e.code === 'KeyH') { e.preventDefault(); setInkVisibility(view, { ink: !view.ink.show }); return; }
  // 글자 크게 · 작게 (Ctrl+Shift+> / <) — 고른 블록 전체
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && sel.length && (e.key === '>' || e.key === '<' || e.code === 'Period' || e.code === 'Comma')) {
    e.preventDefault();
    const dir = e.key === '>' || e.code === 'Period' ? 1 : -1;
    const ids = sel.filter((id) => view.engine.contentsOf(id).some((c) => c.type === 'text'));
    if (ids.length) {
      setBlockTextStyle(view.engine, ids, { fontStep: dir });
      announce(view, `글자 ${Math.round((view.engine.getBlock(ids[0]!)?.fontScale ?? 1) * 100)}%`);
    }
    return;
  }
  // Ctrl+화살표로 크기 (10/28, /선택 다음에): ↓ 늘리기 · ↑ 줄이기 — 위 변은 그대로, ← 왼쪽으로 · → 오른쪽으로 늘리기 — 반대쪽 변은
  // 그대로, Shift를 같이 누르면 그쪽 변을 안으로(줄이기). 고른 상자 모두 10px씩, 용지 · 보드 밖으로는 안 나감.
  // 옆 상자(고른 상자끼리도)에 닿으면 이음매 앞에서 멈춘다 — 다른 상자는 덮지도 옮기지도 않는다(10/29). 한 줄로 붙은 상자를 고르면 바깥 변만 커진다
  if (mod && !e.altKey && sel.length && e.key.startsWith('Arrow')) {
    e.preventDefault();
    const d = 10, side = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
    const next = new Map<Id, Rect>();
    const reader = { queryBlocks: (r: Rect) => view.engine.queryBlocks(r), blockRect: (id: Id) => next.get(id) ?? view.engine.blockRect(id) };
    for (const id of sel) {
      const s = view.engine.blockRect(id);
      if (!s) continue;
      const w = Math.max(60, s.w + (e.shiftKey ? -d : d));
      const r = side ? clampResize(view, { x: side < 0 ? s.x + s.w - w : s.x, y: s.y, w, h: s.h }) : { ...s, h: Math.max(32, s.h + (e.key === 'ArrowDown' ? d : -d)) };
      const f = fitBoxResize(view, id, s, r, !side, reader);
      if (f && (Math.abs(f.x - s.x) > 0.5 || Math.abs(f.w - s.w) > 0.5 || Math.abs(f.h - s.h) > 0.5)) next.set(id, f);
    }
    if (!next.size) { announce(view, '옆 상자나 끝에 닿아 더 바꿀 수 없어요'); return; }
    view.engine.transact((tx) => {
      for (const [id, r] of next) {
        const b = view.engine.getBlock(id)!;
        tx.set('block', id, side ? { x: r.x, w: r.w } : { sizing: 'fixed', minH: Math.max(32, (b.minH ?? b.h) + r.h - b.h), h: r.h });
      }
    }, { origin: 'user', label: '블록 크기', mergeKey: `ksize:${sel.join(',')}` });
    const b = view.engine.getBlock(sel[0]!);
    if (b) announce(view, `크기 ${Math.round(b.w)} × ${Math.round(b.h)}`);
    return;
  }
  if (mod) return;
  if (bothKey(view, e) || inkKey(view, e)) return;
  // 고른 글 상자에 바로 치면 그 상자에 쓴다 (노션 · Miro처럼, CQ-003) — 편집기를 열기만 하고 기본 동작은 막지 않아 이 글자가
  // 열린 편집기로 들어간다. 한글 입력기(Process) · 숫자 · 문장부호 등. 도구 글자(V B T A H P M E L C)와 ] ! / 스페이스는 단축키 그대로
  if (!e.altKey && sel.length === 1 && !connectSource(view) && !isInkTool(view._tool) && (e.key === 'Process' || (e.key.length === 1 && !TOOL_KEYS.includes(e.key.toLowerCase())))) {
    const cs = view.engine.contentsOf(sel[0]!);
    if (cs.length && cs.every((c) => c.type === 'text')) { view.startEditing(sel[0]!, 'end'); return; }
  }
  // 필기 (부록 A): P 펜 · M 형광펜 · E 지우개 · L 올가미, 1~6 색, [ ] 굵기, Ctrl+Alt+H 잉크 보이기
  if (!mod && !e.altKey) {
    const tool = ({ p: 'pen', m: 'highlighter', e: 'eraser', l: 'lasso' } as Record<string, Tool>)[e.key.toLowerCase()];
    if (tool) { view.setTool(tool); return; }
    if (isInkTool(view._tool) && /^[1-6]$/.test(e.key)) {
      const i = Number(e.key) - 1, hl = view._tool === 'highlighter', c = (hl ? view.ink.hlColors : view.ink.colors)[i];
      if (c) setInkStyle(view, hl ? { hlColor: c } : { color: c });
      return;
    }
    if (isInkTool(view._tool) && (e.key === '[' || e.key === ']')) {
      const dir = e.key === ']' ? 1 : -1;
      setInkStyle(view, view._tool === 'highlighter' ? { hlWidth: stepWidth(view.ink.hlWidth, dir, HL_WIDTH.steps) } : { width: stepWidth(view.ink.width, dir, PEN_WIDTH.steps) });
      return;
    }
  }
  // 키보드 접근 (FR-150): Tab으로 블록 이동 · Shift+F10(메뉴 키)으로 블록 메뉴 · Alt+화살표로 크기
  if (e.key === 'Tab' && !e.altKey) { if (e.target === view.root && tabBlock(view, e.shiftKey ? -1 : 1)) e.preventDefault(); return; }
  if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') {
    if (sel.length && view.onBlockMenu) {
      e.preventDefault();
      const r = view.blockScreenRect(sel[0]!), o = view.root.getBoundingClientRect();
      view.onBlockMenu({ ids: sel, x: o.left + (r ? r.x : 20), y: o.top + (r ? r.y + r.h + 4 : 20) });
    }
    return;
  }
  if (e.altKey && sel.length === 1 && e.key.startsWith('Arrow')) {
    e.preventDefault();
    const b = view.engine.getBlock(sel[0]!);
    if (!b) return;
    const d = e.shiftKey ? 1 : 10;
    const dw = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0, dh = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0;
    view.engine.transact((tx) => {
      if (dw) tx.set('block', b.id, { w: clampResize(view, { x: b.x, y: b.y, w: Math.max(60, b.w + dw), h: b.h }).w });
      if (dh) { const h = Math.max(32, textHeight(view, b.id, b.w), b.h + dh); tx.set('block', b.id, { sizing: 'fixed', minH: Math.max(32, Math.min(h, (b.minH ?? b.h) + dh)), h }); } // 글보다 낮게는 안 됨 (AT-022)
    }, { origin: 'user', label: '블록 크기', mergeKey: `size:${b.id}` });
    announce(view, `크기 ${Math.round(view.engine.getBlock(b.id)!.w)} × ${Math.round(view.engine.getBlock(b.id)!.h)}`);
    return;
  }
  switch (e.key) {
    case 'Delete': case 'Backspace':
      if (sel.length || view.selArrows.size) { e.preventDefault(); view.deleteSelection(); }
      return;
    case 'Escape':
      if (connectSource(view)) { cancelConnect(view); return; }
      view.select([]); view.gesture = { k: 'none' }; view.setTool(view.homeTool); view.schedule(); return;
    case 'Enter':
      if (connectSource(view) && finishConnect(view)) { e.preventDefault(); return; }
      if (sel.length === 1) {
        e.preventDefault();
        // 표는 첫 칸, 그래프는 데이터 창 (두 번 누르기와 같게, CQ-002) — 그 밖은 글 편집
        const cs = view.engine.contentsOf(sel[0]!), tbl = cs.find(isTableContent), chart = cs.find((c) => c.type === 'chart');
        const row = tbl && sortedRows(tbl)[0];
        if (tbl && row && tbl.columns[0]) startCellEdit(view, sel[0]!, tbl.id, row.id, tbl.columns[0].id);
        else if (chart && view.host.onEditContent) view.host.onEditContent(sel[0]!, chart.id);
        else view.startEditing(sel[0]!, 'end');
      }
      return;
    // 키보드로 연결 (FR-150): 고른 블록에서 시작
    case 'c': case 'C': if (sel.length === 1) startConnect(view, sel[0]!); return;
    case 'v': case 'V': view.setTool('select'); return;
    case 'b': case 'B': view.setTool('block'); return;
    case 't': case 'T': view.setTool('title'); return;
    case 'a': case 'A': view.setTool('arrow'); return;
    case 'h': case 'H': view.setTool('hand'); return;
    case ']': if (sel.length) bringToFront(view.engine, sel); return;
    case '!': view.fit(true); return;
    // 넣기 메뉴 (화면 가운데에 넣는다). 블록을 고른 채면 Enter로 편집해 슬래시 메뉴를 쓴다
    case '/': {
      if (!view.host.onInsertMenu) return;
      e.preventDefault();
      const r = view.root.getBoundingClientRect();
      view.host.onInsertMenu({ x: r.left + r.width / 2 - 140, y: r.top + Math.max(16, r.height / 2 - 200) });
      return;
    }
    case ')': view.zoomTo(1); return;
    case 'ArrowUp': case 'ArrowDown': case 'ArrowLeft': case 'ArrowRight': {
      if (!sel.length) return;
      e.preventDefault();
      const d = e.shiftKey ? 10 : 1;
      const u = dragUnion(view, sel); // 용지(A4)면 종이 안에서만
      const k = u ? clampDragDelta(view, u, { x: e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0, y: e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0 }) : { x: 0, y: 0 };
      // 다른 상자에 겹쳐 들어가지 않게 — 닿기 직전까지만 (끌어 놓기의 도킹과 같은 원칙, CQ-005)
      const moving = new Set(sel), free = (f: number) => sel.every((id) => { const r = view.engine.blockRect(id); return !r || isFree(view.engine, { ...r, x: r.x + k.x * f, y: r.y + k.y * f }, moving); });
      const steps = Math.max(Math.abs(k.x), Math.abs(k.y));
      let n = steps;
      if (free(0)) while (n > 0 && !free(n / steps)) n--; // 이미 겹쳐 있던 상자는 빠져나오게 그대로 둔다
      if (n < steps) announce(view, '다른 상자에 닿았어요');
      const dx = steps ? (k.x * n) / steps : 0, dy = steps ? (k.y * n) / steps : 0;
      if (!dx && !dy) return;
      view.engine.transact((tx) => { for (const id of sel) { const b = view.engine.getBlock(id); if (b) tx.set('block', id, { x: b.x + dx, y: b.y + dy }); } },
        { origin: 'user', label: '블록 이동', mergeKey: `nudge:${sel.join(',')}` });
      return;
    }
  }
}

export function handleKeyUp(view: CanvasView, e: KeyboardEvent): void {
  if (e.key === ' ') { view.space = false; view.root.classList.remove('dn-space'); }
}

export function handleDblClick(view: CanvasView, e: MouseEvent): void {
  if (view.readOnly || isEditableTarget(e.target) || (e.target as Element | null)?.closest?.('.dn-db')) return;
  // 표 셀: 그 칸만 편집 (FR-018)
  // 두 번 누르는 사이에 표가 다시 그려지면 e.target이 떨어져 나간 옛 칸일 수 있다 — 지금 그 자리의 칸을 찾는다
  const under = document.elementFromPoint(e.clientX, e.clientY);
  // 웹 임베드: 덮개를 걷어 iframe 안을 쓴다 (FR-051)
  const web = under?.closest<HTMLElement>('.dn-web-embed');
  if (web) { liveWeb(web); return; }
  if (under?.closest('.dn-web')) return; // 카드 · 주소 칸은 두 번 눌러도 편집이 아니다
  const td = under?.closest<HTMLElement>('.dn-table td[data-row]') ?? null;
  const part = td?.closest<HTMLElement>('[data-part]');
  const blockEl = td?.closest<HTMLElement>('.dn-block');
  if (td && part && blockEl?.dataset.id) { startCellEdit(view, blockEl.dataset.id, part.dataset.part!, td.dataset.row!, td.dataset.col!); return; }
  // 표 머리글: 열 이름 고치기
  const th = under?.closest('.dn-table-sort') ? null : under?.closest<HTMLElement>('.dn-table th[data-col]') ?? null; // 정렬 단추를 두 번 눌러도 이름 고치기가 아니다
  const thBlock = th?.closest<HTMLElement>('.dn-block'), thPart = th?.closest<HTMLElement>('[data-part]');
  if (th && thPart && thBlock?.dataset.id) { startHeaderEdit(view, thBlock.dataset.id, thPart.dataset.part!, th.dataset.col!); return; }
  // 탭 블록: 지금 탭 글을 그 자리에서 (GAP #17)
  const tab = under?.closest<HTMLElement>('.dn-tabs-body'), tabPart = tab?.closest<HTMLElement>('[data-part]'), tabBlock = tab?.closest<HTMLElement>('.dn-block');
  if (tab && tabPart && tabBlock?.dataset.id) { startTabEdit(view, tabBlock.dataset.id, tabPart.dataset.part!); return; }
  const s = local(view, e);
  const w = screenToWorld(view.cam, s);
  const hit = view.engine.hitTest(w, 8 / view.cam.zoom);
  if (hit?.kind === 'block') {
    // 그래프: 그 자리에서 못 고친다 — 앱이 데이터 창을 연다
    const chart = view.engine.contentsOf(hit.id).find((c) => c.type === 'chart');
    if (chart && view.host.onEditContent) { view.select([hit.id]); view.host.onEditContent(hit.id, chart.id); return; }
    view.startEditing(hit.id, { clientX: e.clientX, clientY: e.clientY });
  } else if (hit?.kind === 'arrow') {
    editArrowLabel(view, hit.id);
  }
  // 빈 곳 더블클릭으로는 상자를 만들지 않는다 — 도구 막대 · B · T · 넣기 메뉴(+) · 오른쪽 클릭으로
}

export function handleFocusOut(view: CanvasView, e: FocusEvent): void {
  if (!view.editingId) return;
  const m = view.mounted.get(view.editingId);
  const next = e.relatedTarget as Node | null;
  // 에디터가 띄운 입력 창(수식 입력 등, .dn-editor-pop)으로 가는 것도 편집 중
  const inPop = (n: Node | null) => n instanceof Element && !!n.closest('.dn-editor-pop');
  if (m && next && (m.el.contains(next) || inPop(next))) return;
  // 포커스가 블록 밖으로 나가면 편집 종료 (링크 입력 창 등 에디터가 잠시 비운 경우 제외)
  queueMicrotask(() => {
    if (!m || m.editor?.busy || m.el.contains(document.activeElement) || inPop(document.activeElement)) return;
    if (view.editingId === m.el.dataset.id) view.endEditing();
  });
}

/**
 * 오른쪽 클릭: 블록 위면 블록 메뉴(그 블록을 고른 채로), 빈 곳이면 그 자리에 넣기 메뉴.
 * 글 편집 중이면 그 블록의 메뉴(글자 크기 · 색 · 잘라내기/복사/붙여넣기) — Shift+오른쪽 클릭 · 보기 전용이면 브라우저 메뉴 그대로
 */
export function handleContextMenu(view: CanvasView, e: MouseEvent): void {
  // 캡션 · 목차 링크는 dn-ui지만 그 블록의 메뉴로 (캡션 고치기가 거기 있다 · 목차 링크도 목차 블록 메뉴 — AT-014)
  const capId = (e.target as Element | null)?.closest?.('.dn-caption, .dn-toc-link')?.closest<HTMLElement>('.dn-block[data-id]')?.dataset.id;
  if (view.readOnly || e.shiftKey || (!capId && (e.target as Element | null)?.closest?.('.dn-db-ui, .dn-ui, input, textarea'))) return; // 데이터베이스는 칸 · 단추만 제 메뉴 (CQ-021)
  if (isEditableTarget(e.target)) {
    const id = view.editingId;
    if (!id || !view.onBlockMenu || !view.mounted.get(id)?.el.contains(e.target as Node)) return;
    e.preventDefault();
    view.onBlockMenu({ ids: [id], x: e.clientX, y: e.clientY, editing: true });
    return;
  }
  const s = local(view, e), w = screenToWorld(view.cam, s);
  const hit = view.engine.hitTest(w, 8 / view.cam.zoom);
  // 블록(묶음)의 이름표 · 테두리 · 상자 사이 빈 곳 → 그 묶음 메뉴 (이름 · 종류 · 테두리 · 풀기 · 묶음 전체 서식)
  const group = capId ? null : hitGroup(view, s, !!hit);
  const id = capId ?? (hit?.kind === 'block' ? hit.id : null);
  if (group || id) {
    if (!view.onBlockMenu) return;
    e.preventDefault();
    if (group) view.select(group);
    // 콘텐츠: 고른 것 밖이거나 묶음 하나만 고른 채면 그 콘텐츠 하나 (누르기와 같게), 여럿 고른 것 안이면 그 전부
    else if (!view.selBlocks.has(id!) || selectedGroup(view)) view.select([id!]);
    view.onBlockMenu({ ids: [...view.selBlocks], x: e.clientX, y: e.clientY });
    return;
  }
  if (hit?.kind === 'arrow') {
    if (!view.host.onArrowMenu) return;
    e.preventDefault();
    if (!view.selArrows.has(hit.id)) view.selectArrow(hit.id);
    view.host.onArrowMenu({ ids: [...view.selArrows], x: e.clientX, y: e.clientY });
    return;
  }
  // 빈 곳 · 종이: 노트 설정 (넣기는 그 안의 '여기에 넣기'), 앱이 노트 설정을 안 받으면 넣기 메뉴
  const open = view.host.onNoteMenu ?? view.host.onInsertMenu;
  if (hit || !open) return;
  e.preventDefault();
  view.select([]);
  open({ x: e.clientX, y: e.clientY, at: w });
}
