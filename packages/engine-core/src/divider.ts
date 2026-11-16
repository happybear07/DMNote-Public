// 구분선 (노트형 정리 NS-01 · 5절): 캔버스에 놓는 선 콘텐츠 — 가로(구역 나누기) · 세로(VS 비교 · 열 나누기), 가운데 라벨 선택.
// 블록 하나(고정 크기 — 가로선은 높이, 세로선은 너비가 DIVIDER_THICK). 길이는 끌어서. 문서 뷰 · 내보내기에서는 가로줄(세로선은 문서에서 건너뜀).
// 글 안의 가로줄(text-pm horizontal_rule)과 같은 뜻이고, 카드 머리 밑줄은 카드 모양(cards.ts)이 그린다.
import type { Engine, TxResult } from './engine';
import type { Vec2 } from './geom';
import type { Content, Id } from './model';

export type DividerLine = 'solid' | 'dashed' | 'dotted' | 'double';
export interface DividerData {
  readonly orient: 'h' | 'v';
  /** 선 모양 (없으면 실선) */
  readonly line?: DividerLine;
  /** 가운데 글 (예: 'VS') */
  readonly label?: string;
}
export type DividerContent = Content & DividerData & { readonly type: 'divider' };

export const DIVIDER_THICK = 24;
const LEN = { h: 360, v: 200 } as const;

export function isDividerContent(c: Content | undefined): c is DividerContent {
  return !!c && c.type === 'divider';
}

/** 이 블록의 구분선 (없으면 undefined) */
export function dividerOf(engine: Engine, blockId: Id): DividerContent | undefined {
  return engine.contentsOf(blockId).find(isDividerContent);
}

/** 구분선 넣기 — at은 블록 왼쪽 위. len: 선 길이(가로선이면 폭, 세로선이면 높이) */
export function createDivider(engine: Engine, at: Vec2, orient: 'h' | 'v' = 'h', opts: { len?: number; label?: string; line?: DividerLine; group?: Id } = {}): TxResult<{ blockId: Id; contentId: Id }> {
  const len = Math.max(DIVIDER_THICK * 2, Math.round(opts.len ?? LEN[orient]));
  const w = orient === 'h' ? len : DIVIDER_THICK, h = orient === 'h' ? DIVIDER_THICK : len;
  return engine.transact((tx) => {
    const blockId = tx.createBlock({ x: at.x, y: at.y, w, h, sizing: 'fixed', minH: h, ...(opts.group ? { group: opts.group } : {}) });
    const label = opts.label?.trim().slice(0, 40);
    const contentId = tx.createContent({ blockId, type: 'divider', orient, ...(opts.line && opts.line !== 'solid' ? { line: opts.line } : {}), ...(label ? { label } : {}) } as never);
    return { blockId, contentId };
  }, { origin: 'user', label: orient === 'h' ? '구분선 넣기' : '세로 구분선 넣기' });
}

/** 구분선 고치기 — 방향을 바꾸면 블록의 폭 · 높이도 맞바꾼다 (길이는 그대로). 실행 취소 한 번 */
export function setDivider(engine: Engine, contentId: Id, patch: Partial<DividerData>): TxResult<void> {
  const c = engine.getContent(contentId);
  if (!isDividerContent(c)) return { ok: false, reason: '구분선이 아니에요' };
  const b = engine.getBlock(c.blockId);
  return engine.transact((tx) => {
    const next: Record<string, unknown> = {};
    if (patch.line !== undefined) next.line = patch.line === 'solid' ? undefined : patch.line;
    if (patch.label !== undefined) next.label = patch.label.trim().slice(0, 40) || undefined;
    if (patch.orient && patch.orient !== c.orient) {
      next.orient = patch.orient;
      if (b) {
        const len = c.orient === 'h' ? b.w : b.h;
        const w = patch.orient === 'h' ? len : DIVIDER_THICK, h = patch.orient === 'h' ? DIVIDER_THICK : len;
        tx.set('block', b.id, { w, h, minH: h, sizing: 'fixed' });
      }
    }
    if (Object.keys(next).length) tx.set('content', contentId, next);
  }, { origin: 'user', label: '구분선 모양' });
}
