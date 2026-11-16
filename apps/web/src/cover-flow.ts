// 표지 쪽 (11/03, engine-core cover.ts): 썸네일 그리기 · 표지에 그림 놓기. 썸네일은 노트 목록 정보(coverThumb)에 — 홈 책장의 책 표지.
// 표지 안이 바뀌면(ws-todos가 1.2초 모아) 다시 그린다. 글을 고치는 중에는 그리지 않는다(exportPng가 편집을 끝낸다).
import { coverItems, coverRect, SHEET_PAD, type Engine, type Id } from '@dn/engine-core';
import { blobToDataUrl, type CanvasView } from '@dn/engine-dom';

/** 썸네일 폭 (px) — 높이는 표지 비율대로 */
export const COVER_THUMB_W = 240;

/** 표지 안 모양을 한 줄로 — 같으면 다시 그리지 않는다 */
export function coverSig(e: Engine): string {
  const cr = coverRect(e.note);
  if (!cr) return '';
  const { blocks, strokes } = coverItems(e);
  return JSON.stringify([cr, blocks.map((id) => [e.getBlock(id), e.contentsOf(id)]), strokes.map((id) => e.getStroke(id)), e.note.paper]);
}

/** 표지 썸네일 (data URL) — 표지가 없거나 비었으면 null */
export async function renderCoverThumb(view: CanvasView): Promise<string | null> {
  const cr = coverRect(view.engine.note);
  if (!cr) return null;
  const { blocks, strokes } = coverItems(view.engine);
  if (!blocks.length && !strokes.length) return null;
  const blob = await view.exportPng({ ids: blocks, region: cr, scale: COVER_THUMB_W / cr.w, bg: view.theme.card, type: 'image/webp', quality: 0.82 });
  if (!blob) return null;
  return blobToDataUrl(blob);
}

/** 표지에 그림 놓기: 표지 안쪽(여백 안)에 비율대로 가장 크게, 가운데. 결과: 새 블록 */
export function placeCoverImage(e: Engine, hash: string, w: number, h: number, alt: string): Id | null {
  const cr = coverRect(e.note);
  if (!cr || w < 1 || h < 1) return null;
  const iw = cr.w - 2 * SHEET_PAD, ih = cr.h - 2 * SHEET_PAD, k = Math.min(iw / w, ih / h);
  const bw = Math.round(w * k), bh = Math.round(h * k);
  const r = e.transact((tx) => {
    const b = tx.createBlock({ x: Math.round(cr.x + SHEET_PAD + (iw - bw) / 2), y: Math.round(cr.y + SHEET_PAD + (ih - bh) / 2), w: bw, h: bh });
    tx.createContent({ blockId: b, type: 'image', attachment: hash, alt, natural: { w, h } } as never);
    return b;
  }, { origin: 'user', label: '표지에 그림' });
  return r.ok ? r.value : null;
}
