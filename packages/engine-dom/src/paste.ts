// 캔버스 붙여넣기 → 새 텍스트 블록 하나.
import { createTextBlock, screenToWorld, type TextDoc, createEmbedBlock, parseBlockLink, BLOCK_CLIP_MIME, isBlockClip, pasteBlockClip, docText, makeTable, DOCK_GAP, webUrl, type Id, type Vec2 } from '@dn/engine-core';
import { htmlToDoc, looksLikeMarkdown, markdownToDoc, plainTextToDoc, type PastedTable } from '@dn/text-pm';
import type { CanvasView } from './canvas-view';
import { PASTE_LONG } from './constants';
import { placeNew } from './create';
import { offerPasteUrl } from './paste-url-offer';
import { isEditableTarget, local } from './geometry';

/** 붙여 넣을 자리: 캔버스 위 마지막 포인터, 없으면 화면 위쪽 가운데 (월드 좌표) */
function pasteSpot(view: CanvasView, w: number) {
  return view.lastPointer && view.lastPointer.x >= 0 && view.lastPointer.y >= 0 && view.lastPointer.x <= view.size.w && view.lastPointer.y <= view.size.h
    ? screenToWorld(view.cam, view.lastPointer)
    : screenToWorld(view.cam, { x: view.size.w / 2 - (w * view.cam.zoom) / 2, y: view.size.h / 3 });
}

/** 파일 끌어 놓기 (탐색기 · 다른 앱) — 이미지는 이미지 블록, 그 밖은 첨부 파일 블록 (FR-018 · FR-052) */
export function handleDragOver(view: CanvasView, e: DragEvent): void {
  if (view.readOnly) return;
  const dt = e.dataTransfer;
  // 옆 노트에서 끌어온 블록 (FR-153) · 파일
  const clip = !!dt?.types.includes(BLOCK_CLIP_MIME);
  if (!clip && (!view.host.onImages || ![...(dt?.items ?? [])].some((i) => i.kind === 'file'))) return;
  e.preventDefault();
  if (dt) dt.dropEffect = 'copy';
}

export function handleDrop(view: CanvasView, e: DragEvent): void {
  // 옆 노트에서 끌어온 블록 (FR-153): 놓은 자리에 복사 (겹치면 가까운 빈자리)
  const raw = e.dataTransfer?.getData(BLOCK_CLIP_MIME);
  if (raw && !view.readOnly) {
    e.preventDefault();
    let clip: unknown = null;
    try { clip = JSON.parse(raw); } catch { /* 형식이 아니면 무시 */ }
    if (!isBlockClip(clip) || !clip.blocks.length) return;
    const p = screenToWorld(view.cam, local(view, e));
    const w = Math.max(...clip.blocks.map((b) => b.dx + b.w)), h = Math.max(...clip.blocks.map((b) => b.dy + b.h));
    const res = pasteBlockClip(view.engine, clip, placeNew(view, { x: p.x - 20, y: p.y - 20, w, h }), '옆 노트에서 복사');
    if (res.ok) { view.select(res.value); view.root.focus({ preventScroll: true }); }
    return;
  }
  const images = [...(e.dataTransfer?.files ?? [])];
  if (view.readOnly || !view.host.onImages || !images.length) return;
  e.preventDefault();
  view.host.onImages(images, screenToWorld(view.cam, local(view, e)));
}

/** 표 블록 높이 어림 (머리 줄 + 행, 칸 안 글이 한 줄일 때) — 모자라면 그린 뒤 늘어나 아래 블록과 겹치므로 넉넉히 */
const tableHeight = (rows: number) => 56 + (rows + 1) * 36;

/** 붙여넣은 표 → 표 블록 (at부터 아래로, 겹치면 가까운 빈자리) */
export function pasteTableBlocks(view: CanvasView, tables: readonly PastedTable[], at: Vec2): Id[] {
  const ids: Id[] = [];
  let y = at.y;
  for (const t of tables) {
    const w = Math.min(760, Math.max(280, t.columns.length * 140)), h = tableHeight(t.rows.length);
    const p = placeNew(view, { x: at.x, y, w, h });
    const r = view.engine.transact((tx) => { const b = tx.createBlock({ x: p.x, y: p.y, w, h }); tx.createContent({ blockId: b, type: 'table', ...makeTable(t.columns, t.rows) }); return b; }, { origin: 'user', label: '표 붙여넣기' });
    if (r.ok) { ids.push(r.value); y = p.y + h + DOCK_GAP; }
  }
  if (tables.some((t) => t.cut)) view.host.onNotice?.('paste-table-cut');
  return ids;
}

/**
 * 캔버스에 붙여넣기 (편집 중이 아닐 때, FR-031): 내용을 새 텍스트 블록 하나로.
 * HTML은 스키마 규칙으로(위험한 것 제거), 텍스트는 마크다운이면 변환, Ctrl+Shift+V면 서식 없이.
 * 블록 여러 개로 나누는 것은 AI 자동 구조화(P2 · FR-105)의 몫이다.
 */
export function handlePaste(view: CanvasView, e: ClipboardEvent): void {
  if (isEditableTarget(e.target) || view.readOnly) return;
  const cb = e.clipboardData;
  if (!cb) return;
  const plain = view.plainPaste;
  view.plainPaste = false;
  e.preventDefault();
  const html = cb.getData('text/html');
  const text = cb.getData('text/plain');
  // 이미지 (스크린샷 등) — 글자 없이 이미지만 있으면 이미지 블록으로 (FR-018)
  const images = [...cb.files];
  if (images.length && !text.trim() && view.host.onImages) { view.host.onImages(images, pasteSpot(view, 320)); return; }
  if (!text.trim() && !html.trim()) {
    view.host.onNotice?.([...cb.items].some((i) => i.type.startsWith('image/')) ? 'paste-image' : 'paste-unsupported');
    return;
  }
  // 블록 링크(블록 메뉴 › 블록 링크 복사)만 붙여넣으면 그 블록 임베드 (FR-082). Ctrl+Shift+V면 그냥 글자로
  const ref = !plain && view.host.embeds ? parseBlockLink(text) : null;
  if (ref) {
    const r = createEmbedBlock(view.engine, placeNew(view, { ...pasteSpot(view, 360), w: 360, h: 120 }), ref);
    if (r.ok) view.select([r.value]);
    return;
  }
  let doc: TextDoc;
  let tables: PastedTable[] = [];
  if (html.trim() && !plain) {
    const r = htmlToDoc(html, { tables: true });
    doc = r.doc;
    tables = r.tables;
    if (r.report.removedActive) view.host.onNotice?.('paste-scrubbed');
  } else {
    doc = !plain && looksLikeMarkdown(text) ? markdownToDoc(text) : plainTextToDoc(text, { links: !plain });
  }
  const w = text.length > PASTE_LONG ? 420 : 260;
  const at = pasteSpot(view, w);
  // 표만 붙여넣었으면 표 블록만 (FR-031)
  if (tables.length && !docText(doc).trim()) { const ids = pasteTableBlocks(view, tables, at); if (ids.length) view.select(ids); return; }
  const mh = view.measureText(doc, w);
  const spot = placeNew(view, { x: at.x, y: at.y, w, h: mh });
  // 붙여넣은 글은 서식(제목 줄 포함) 그대로 내용 상자 하나로, 표는 그 아래 표 블록으로
  const r = createTextBlock(view.engine, spot, { doc, w, label: '붙여넣기' });
  if (r.ok) {
    const ids = tables.length ? pasteTableBlocks(view, tables, { x: spot.x, y: spot.y + mh + DOCK_GAP }) : [];
    view.select([r.value.blockId, ...ids]);
    // 주소 하나만 붙여넣었으면 링크 · 언급 · 북마크 · 임베드 고르기 (AT-012 — 글 상자 안 빈 줄과 같게). 주소 하나는 구조화할 글이 아니라 AI 칩은 띄우지 않는다
    const url = !plain && !tables.length && /^\S+$/.test(text.trim()) ? webUrl(text.trim()) : null;
    if (url) offerPasteUrl(view, r.value.blockId, url);
    else view.host.onPasted?.(r.value.blockId, { chars: text.replace(/\s/g, '').length, markdown: !plain && looksLikeMarkdown(text) });
  }
}
