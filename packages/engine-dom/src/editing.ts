// 텍스트 편집: 칸 하나에 ProseMirror 에디터 붙이기 · 떼기 · 화살표 라벨 입력.
import { blockTextParts, deleteEntities, duplicateBlocks, editText, editTexts, extractToBlock, groupOf, isTextContent, newId, setArrowLabel, DOCK_GAP, type Id } from '@dn/engine-core';
import { formatSteps, TextEditor, type FormatCommand } from '@dn/text-pm';
import type { CanvasView } from './canvas-view';
import { xrefHost } from './caption-view';
import { placeNew } from './create';
import { makeSourceBox } from './source-drag';
import { pasteTableBlocks } from './paste';
import { cancelConnect } from './a11y';
import { insertFromSlash, isInsertKind, insertWeb } from './insert';
import { copyBlockLink, slashBlockStyle } from './slash-block';
import { closeEditor, mount, updateBlock } from './mount';
import type { EditAt, Mounted, Part } from './types';
import { endCellEdit, endHeaderEdit } from './table-edit';
import { endTabEdit } from './tabs-render';

/**
 * 블록 텍스트 편집 시작 — 편집 중인 칸 하나에만 ProseMirror 에디터를 띄운다 (ENGINE 5.6).
 * `at`: 화면 좌표면 그 자리의 칸, 'start'면 첫 칸 맨 앞, 'end'면 마지막 칸 끝. `part`로 칸을 직접 지정할 수 있다.
 */
export function startEditing(view: CanvasView, id: Id, at: EditAt = 'end', part?: 'title' | 'body'): void {
  if (view.readOnly) return;
  cancelConnect(view, true);
  if (view.editingId && view.editingId !== id) view.endEditing();
  const b = view.engine.getBlock(id);
  if (!b) return;
  if (view.editingId !== id) view.engine.breakUndoMerge();
  view.editingId = id;
  view.selBlocks.clear();
  view.selBlocks.add(id);
  view.selArrows.clear();
  // 아주 작게 본 채로 편집을 시작하면 글을 읽을 수 있게 그 블록으로 다가간다 (CQ-019)
  if (view.cam.zoom < 0.6) view.setCamera({ zoom: 1, x: b.x + b.w / 2 - view.size.w / 2, y: b.y + Math.min(b.h, view.size.h) / 2 - view.size.h / 2 });
  let m = view.mounted.get(id);
  if (!m) { m = mount(view, b); view.mounted.set(id, m); }
  updateBlock(view, b, m); // dn-editing → 빈 칸도 보인다 (칸 고르기 전에 레이아웃이 잡혀야 한다)
  const texts = m.parts.filter((p) => p.role !== 'other');
  // 글 칸이 없는 블록(표 · 그래프 · 데이터베이스 · 사진 …)은 편집 중으로 남기지 않는다 — 남으면 모든 상자의 핸들이 사라진다 (CQ-002)
  if (!texts.length) { view.editingId = null; updateBlock(view, b, m); view.schedule(); view.notifyUi(); return; }
  let target: Part;
  if (part) target = texts.find((p) => p.role === part) ?? texts[0]!;
  else if (at === 'start') target = texts[0]!;
  else if (at === 'end') target = texts[texts.length - 1]!;
  else target = texts.find((p) => p.el.getBoundingClientRect().bottom >= at.clientY) ?? texts[texts.length - 1]!;
  editPart(view, id, m, target, at);
  view.schedule();
  view.notifyUi();
}

/** 같은 블록 안에서 편집 칸을 옮긴다 (제목 ↔ 본문). 블록 편집은 이어진다. */
export function editPart(view: CanvasView, id: Id, m: Mounted, p: Part, at: EditAt): void {
  if (m.editingPart === p.contentId && m.editor) return;
  closeEditor(m);
  const c = view.engine.getContent(p.contentId);
  if (!c || !isTextContent(c)) return;
  view.engine.breakUndoMerge();
  const contentId = c.id;
  const texts = m.parts.filter((x) => x.role !== 'other');
  const idx = texts.indexOf(p);
  const go = (to: Part | undefined, where: 'start' | 'end') => {
    if (!to) return;
    const mm = view.mounted.get(id);
    if (mm) editPart(view, id, mm, to, where);
  };
  m.editingPart = contentId;
  m.editor = new TextEditor({
    mount: p.el,
    mode: p.role === 'title' ? 'title' : 'body',
    doc: c.doc,
    overlay: view.root,
    at,
    onSteps: (steps) => { editText(view.engine, contentId, steps); },
    // 실행 취소로 고치던 상자가 없어지면(만들기까지 되돌림) 초점을 캔버스로 — BODY로 빠지면 단축키가 모두 죽는다 (CQ-004)
    onUndo: () => { view.engine.undo(); if (!view.engine.getBlock(id)) view.root.focus({ preventScroll: true }); },
    onRedo: () => { view.engine.redo(); if (!view.engine.getBlock(id)) view.root.focus({ preventScroll: true }); },
    onEscape: () => { view.endEditing(); view.root.focus({ preventScroll: true }); },
    // 제목 상자는 한 줄 — 다음 칸이 없으면 Enter · Tab이 편집을 끝낸다
    onExitNext: idx < texts.length - 1 ? () => go(texts[idx + 1], 'start')
      : p.role === 'title' ? () => { view.endEditing(); view.root.focus({ preventScroll: true }); } : undefined,
    onExitPrev: idx > 0 ? () => go(texts[idx - 1], 'end') : undefined,
    onPasteScrubbed: () => view.host.onNotice?.('paste-scrubbed'),
    // 이미지 · 표 붙여넣기 (FR-031): 이 블록 바로 아래 새 블록으로
    onPasteImages: view.host.onImages ? (files) => { const b = view.engine.getBlock(id); if (!b) return; view.endEditing(); view.host.onImages?.(files, { x: b.x, y: b.y + b.h + DOCK_GAP }); } : undefined,
    onPasteTables: (tables) => requestAnimationFrame(() => {
      const b = view.engine.getBlock(id);
      if (!b) return;
      const h = Math.max(b.h, view.mounted.get(id)?.el.offsetHeight ?? 0);
      pasteTableBlocks(view, tables, { x: b.x, y: b.y + h + DOCK_GAP });
    }),
    onSlashAi: view.host.onSlashAi ? () => { view.endEditing(); view.root.focus({ preventScroll: true }); view.host.onSlashAi?.(id); } : undefined,
    noteLinks: view.host.noteLinks,
    xrefs: xrefHost(view.engine, (x) => { view.endEditing(); view.focusBlock(x); }), // 상호 참조 (/상호 참조)
    // 상자 밖에 새 블록 (표 · 그래프 · 데이터베이스 · 사진 · 파일): 이 블록 바로 아래
    onPasteUrl: ({ url, view: v }) => { insertWeb(view, url, v, id); },
    unfurl: view.host.web?.unfurl ? (u) => view.host.web!.unfurl!(u) : undefined, // 붙여넣기 › 언급의 사이트 제목
    onSlashInsert: (kind) => {
      if (isInsertKind(kind)) { insertFromSlash(view, kind, id); return; } // 빈 상자에서면 그 자리를 대신 (노션처럼)
      if (slashBlockStyle(view.engine, id, kind)) return;
      // 노션 /duplicate · /delete — 편집을 끝내고 블록에
      if (kind === 'action:duplicate') { view.endEditing(); const r = duplicateBlocks(view.engine, [id], 24, { dock: true }); if (r.ok) view.select(r.value); }
      else if (kind === 'action:delete') { view.endEditing(); deleteEntities(view.engine, [id]); view.select([]); }
      else if (kind === 'action:copy-link') void copyBlockLink(view.engine, id).then((ok) => view.host.onNotice?.(ok ? 'link-copied' : 'link-copy-failed'));
      else if (kind === 'action:move') { view.endEditing(); view.host.onMoveBlocks?.([id]); }
      // /선택 · /블록 선택 — 편집을 끝내고 고른다(화살표로 옮기기 · Ctrl+화살표로 크기). 블록 선택은 묶음 전체
      else if (kind === 'action:select' || kind === 'action:select-block') {
        view.endEditing();
        const g = kind === 'action:select-block' ? groupOf(view.engine, id) : undefined;
        view.select(g ? [...g.ids] : [id]);
        view.root.focus({ preventScroll: true });
      }
      else if (kind === 'action:comment') {
        const r = view.blockScreenRect(id), o = view.root.getBoundingClientRect();
        view.host.onComments?.({ blockId: id, x: o.left + (r ? r.x + r.w + 12 : 40), y: o.top + (r ? r.y : 40) });
      }
    },
    // 고른 글에 댓글 (FR-132): 표시 id를 만들어 돌려주고, 앱이 그 글에 대한 새 댓글 창을 연다
    onComment: view.host.onComments ? ({ quote, at }) => { const anchor = newId(); view.host.onComments?.({ blockId: id, x: at.clientX, y: at.clientY + 6, draft: { anchor, quote } }); return anchor; } : undefined,
    // 고른 글 AI 편집 (FR-112): 편집은 그대로 두고 앱이 창을 띄운다 — 결과는 엔진으로 넣고 에디터는 setDoc으로 받는다
    onAiEdit: view.host.onAiEdit ? ({ from, to, doc, at }) => view.host.onAiEdit?.({ contentId, from, to, doc, x: at.clientX, y: at.clientY + 6 }) : undefined,
    // 고른 글로 원문과 이어진 새 상자 — 원문 오른쪽에 (원문에서 상자 만들기)
    onCopyOut: (s) => { const src = view.engine.getBlock(id); if (src) makeSourceBox(view, contentId, s, { x: src.x + src.w + DOCK_GAP, y: src.y }); },
    onExtract: ({ doc, steps }) => {
      // 새 블록은 원본 오른쪽에 (겹치면 아래로 밀어 빈자리)
      const src = view.engine.getBlock(id);
      if (!src) return;
      // 원본 오른쪽에 붙여서 (막혀 있으면 가장 가까운 빈 자리)
      const to = placeNew(view, { x: src.x + src.w + DOCK_GAP, y: src.y, w: src.w, h: view.measureText(doc, src.w) });
      view.endEditing();
      const r = extractToBlock(view.engine, contentId, steps, doc, to, src.w);
      if (r.ok) view.select([r.value.blockId]);
    },
  });
  m.el.classList.add('dn-editing');
}

export function endEditing(view: CanvasView): void {
  endHeaderEdit(view);
  if (!view.editingId) return;
  endCellEdit(view);
  endTabEdit(view);
  const id = view.editingId;
  view.editingId = null;
  view.engine.breakUndoMerge();
  const m = view.mounted.get(id);
  if (m) {
    closeEditor(m);
    const b = view.engine.getBlock(id);
    if (b) updateBlock(view, b, m);
  }
  view.schedule();
  view.notifyUi();
}

export function editArrowLabel(view: CanvasView, id: Id): void {
  const a = view.engine.getArrow(id);
  const geo = a && view.engine.arrowGeometry(a);
  if (!a || !geo) return;
  view.selectArrow(id);
  view.labelInput?.remove();
  const input = document.createElement('input');
  input.className = 'dn-label-input';
  input.value = a.label ?? '';
  input.placeholder = '관계';
  const p = view.toScreen(geo.mid);
  input.style.left = `${p.x}px`;
  input.style.top = `${p.y}px`;
  view.root.appendChild(input);
  view.labelInput = input;
  input.focus();
  input.select();
  let done = false;
  const commit = (save: boolean) => {
    if (done) return;
    done = true;
    if (save) setArrowLabel(view.engine, id, input.value);
    input.remove();
    view.labelInput = null;
    view.root.focus();
  };
  input.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.isComposing) return;
    if (ev.key === 'Enter') commit(true);
    if (ev.key === 'Escape') commit(false);
  });
  input.addEventListener('blur', () => commit(true));
}

/** 선택 블록의 텍스트 전체를 한 형식으로 (블록 메뉴 — 텍스트 · 제목 · 목록 · 인용). undo 한 번. 제목 상자는 한 줄 고정이라 내용 상자에만 */
export function formatSelection(view: CanvasView, cmd: FormatCommand): void {
  view.endEditing();
  const edits: { contentId: Id; steps: unknown[] }[] = [];
  for (const id of view.selBlocks) {
    for (const c of blockTextParts(view.engine.contentsOf(id)).bodies) {
      const steps = formatSteps(c.doc, cmd);
      if (steps?.length) edits.push({ contentId: c.id, steps });
    }
  }
  if (edits.length) editTexts(view.engine, edits);
}
