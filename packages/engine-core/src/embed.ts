// 블록 임베드 (FR-082): 다른 노트(또는 이 노트)의 블록 하나를 그대로 보여 주는 콘텐츠 — 데이터는 가리키는 곳뿐(원본 노트 · 블록 id).
// 그릴 때마다 원본에서 읽으므로 원본을 고치면 따라 바뀌고, 원본이 지워졌으면 "원본 없음". 블록 링크(#n=<노트>&b=<블록>)를 붙여넣어 만든다.
// (콘텐츠의 blockId는 이 콘텐츠가 들어 있는 블록이라 원본은 srcNote · srcBlock으로 따로 둔다)
import type { Engine, TxResult } from './engine';
import type { Content, Id } from './model';
import type { Vec2 } from './geom';

export interface EmbedRef { readonly srcNote: Id; readonly srcBlock: Id }
export type EmbedContent = Content & EmbedRef & { readonly type: 'embed' };

export function isEmbedContent(c: Content | undefined): c is EmbedContent {
  return !!c && c.type === 'embed' && typeof (c as EmbedContent).srcNote === 'string' && typeof (c as EmbedContent).srcBlock === 'string';
}

const ID = /^[A-Za-z0-9_-]{6,40}$/;

/** 블록 링크(블록 메뉴 › 블록 링크 복사, FR-025) → 가리키는 곳. 글 전체가 링크 하나일 때만 */
export function parseBlockLink(text: string): EmbedRef | null {
  const t = text.trim();
  if (!t || /\s/.test(t) || !t.includes('#')) return null;
  const params = new Map(t.slice(t.indexOf('#') + 1).split('&').map((kv) => { const i = kv.indexOf('='); return [kv.slice(0, i), decodeURIComponent(kv.slice(i + 1))] as const; }));
  const srcNote = params.get('n'), srcBlock = params.get('b');
  return srcNote && srcBlock && ID.test(srcNote) && ID.test(srcBlock) ? { srcNote, srcBlock } : null;
}

/** 임베드 블록 만들기 — 실행 취소 한 번 */
export function createEmbedBlock(engine: Engine, at: Vec2, ref: EmbedRef, size = { w: 360, h: 120 }): TxResult<Id> {
  return engine.transact((tx) => {
    const blockId = tx.createBlock({ x: at.x, y: at.y, ...size });
    tx.createContent({ blockId, type: 'embed', srcNote: ref.srcNote, srcBlock: ref.srcBlock } as never);
    return blockId;
  }, { origin: 'user', label: '블록 임베드' });
}
