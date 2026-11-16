// PDF 보기 (GAP #22 — 노션 PDF 블록): 첨부한 PDF를 노트 안에서 펼쳐 본다(브라우저 PDF 보기 — 라이브러리 없이).
// 펼치면 블록을 보기 높이로 키우고 아래 상자는 겹치지 않을 만큼 내린다(웹 임베드와 같은 규칙, DQ-024). 펼친 동안은 크기 고정 —
// 손잡이로 높이를 바꿔 더 볼 수 있다. 접으면 카드 높이(글처럼 저절로)로.
import type { Engine, TxResult } from './engine';
import type { Id } from './model';
import { isFileContent, type FileContent } from './rich';
import { DOC_GAP } from './doc-edit';

export const PDF_VIEW_H = 640;
export const FILE_CARD_H = 64;

export function isPdfFile(c: FileContent): boolean {
  return c.mime === 'application/pdf' || /\.pdf$/i.test(c.name);
}

export function setFilePreview(engine: Engine, contentId: Id, on: boolean): TxResult<void> {
  return engine.transact((tx) => {
    const c = engine.getContent(contentId);
    if (!isFileContent(c) || !isPdfFile(c)) return tx.fail('PDF 파일이 아니에요');
    tx.set('content', contentId, { preview: on || undefined });
    const b = engine.getBlock(c.blockId);
    if (!b) return;
    if (!on) { tx.set('block', b.id, { h: FILE_CARD_H, sizing: 'auto', minH: undefined }); return; }
    const want = Math.max(b.h, PDF_VIEW_H);
    const below = [...engine.blocks()].filter((x) => x.id !== b.id && x.y >= b.y + b.h - 1);
    const first = below.reduce((m, x) => Math.min(m, x.y), Infinity);
    const dy = Number.isFinite(first) ? Math.max(0, b.y + want + DOC_GAP - first) : 0;
    tx.set('block', b.id, { h: want, minH: want, w: Math.max(b.w, 480), sizing: 'fixed' });
    if (dy) for (const x of below) tx.set('block', x.id, { y: x.y + dy });
  }, { origin: 'user', label: on ? 'PDF 펼쳐 보기' : 'PDF 접기' });
}
