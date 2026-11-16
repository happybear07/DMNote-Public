// 그림 · 표 캡션 (워드 참조 › 캡션 삽입): 블록 필드 caption(글). 번호는 문서 차례(flow.ts documentOrder)대로 종류마다 —
// 표는 '표 N'(표 위에), 사진 · 그래프 · 손그림 · 웹 임베드 · 동영상 같은 것은 '그림 N'(아래에). 글 상자에는 캡션이 없다.
// 상호 참조(xref)는 이 번호를 읽어 "그림 3"처럼 보인다.
import type { Engine, TxResult } from './engine';
import type { Id } from './model';
import { documentOrder } from './flow';

export type CaptionKind = '그림' | '표';
export interface CaptionNumber { readonly kind: CaptionKind; readonly n: number; readonly label: string }

/** 이 블록에 달 캡션 종류 — 글만 든 블록이면 null */
export function captionKind(engine: Pick<Engine, 'contentsOf'>, blockId: Id): CaptionKind | null {
  const types = engine.contentsOf(blockId).map((c) => c.type);
  if (types.includes('table')) return '표';
  if (types.some((t) => t === 'image' || t === 'chart' || t === 'ink' || t === 'web' || t === 'file' || t === 'database')) return '그림';
  return null;
}

/** 캡션이 달린 블록의 번호 (문서 차례, 종류마다 1부터) */
export function captionNumbers(engine: Engine): Map<Id, CaptionNumber> {
  const out = new Map<Id, CaptionNumber>();
  const count: Record<CaptionKind, number> = { 그림: 0, 표: 0 };
  for (const { block } of documentOrder(engine)) {
    if (!block.caption) continue;
    const kind = captionKind(engine, block.id);
    if (!kind) continue;
    const n = ++count[kind];
    out.set(block.id, { kind, n, label: `${kind} ${n}` });
  }
  return out;
}

/** 캡션 달기 · 고치기 · 지우기(빈 글) — 실행 취소 한 번 */
export function setBlockCaption(engine: Engine, blockId: Id, text: string): TxResult<void> {
  return engine.transact((tx) => {
    if (!engine.getBlock(blockId)) return tx.fail('블록이 없어요');
    const t = text.replace(/\s+/g, ' ').trim().slice(0, 300);
    tx.set('block', blockId, { caption: t || undefined });
  }, { origin: 'user', label: text.trim() ? '캡션' : '캡션 지우기' });
}

/** 사진 대체 텍스트 (워드 · 웹 접근성): 화면 낭독 · 내보내기의 그림 설명. 비우면 지움 */
export function setImageAlt(engine: Engine, contentId: Id, text: string): TxResult<void> {
  return engine.transact((tx) => {
    if (engine.getContent(contentId)?.type !== 'image') return tx.fail('사진이 없어요');
    const t = text.replace(/\s+/g, ' ').trim().slice(0, 500);
    tx.set('content', contentId, { alt: t || undefined });
  }, { origin: 'user', label: text.trim() ? '대체 텍스트' : '대체 텍스트 지우기' });
}
