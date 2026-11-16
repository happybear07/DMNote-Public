// 표지 쪽 (11/03): 노트 맨 앞 A4 세로 한 장 — 그 안에 그린 필기 · 붙인 그림 · 글이 책 표지(홈 책장)가 된다.
// A4 노트는 1쪽 바로 위(쪽 계산의 차례 -1, sheet.ts), 끝없는 캔버스는 내용 왼쪽. 표지 안 것(왼쪽 위가 표지 안)은 본문 문서 순서에서 빠진다(flow.ts).
import type { Engine, TxResult } from './engine';
import type { Rect } from './geom';
import type { Id } from './model';
import { freeStrokes, strokeBounds } from './ink';
import { BOARD, COVER, coverRect, inCover, SHEET_COVER_AT } from './sheet';
import { deleteEntities } from './commands';

/** 표지 안의 블록 · 자유 필기 */
export function coverItems(engine: Engine): { blocks: Id[]; strokes: Id[] } {
  const cr = coverRect(engine.note);
  if (!cr) return { blocks: [], strokes: [] };
  return {
    blocks: [...engine.blocks()].filter((b) => inCover(cr, b)).map((b) => b.id),
    strokes: freeStrokes(engine).filter((s) => inCover(cr, strokeBounds(s))).map((s) => s.id),
  };
}

/** 표지 쪽 만들기 — 이미 있으면 그대로. 결과: 표지 자리 */
export function addCoverPage(engine: Engine): TxResult<Rect> {
  return engine.transact((tx) => {
    const cur = coverRect(engine.note);
    if (cur) return cur;
    let at: { x: number; y: number };
    if (engine.note.sheet) at = { ...SHEET_COVER_AT };
    else {
      // 끝없는 캔버스: 내용(블록 · 필기)의 왼쪽 위에 맞춰 그 왼쪽에 — 비었으면 원점 왼쪽
      const all: Rect[] = [...engine.blocks(), ...freeStrokes(engine).map(strokeBounds)];
      const x0 = all.length ? Math.min(...all.map((r) => r.x)) : 0, y0 = all.length ? Math.min(...all.map((r) => r.y)) : 0;
      at = { x: Math.max(BOARD.x, Math.round(x0 - COVER.w - 160)), y: Math.max(BOARD.y, Math.round(y0)) };
    }
    tx.setNote({ coverPage: at });
    return { ...at, w: COVER.w, h: COVER.h };
  }, { origin: 'user', label: '표지 쪽 만들기' });
}

/** 표지 쪽 지우기 — 안에 그린 것 · 놓은 것도 함께. 실행 취소 한 번 */
export function removeCoverPage(engine: Engine): TxResult<void> {
  return engine.transact((tx) => {
    if (!engine.note.coverPage) return;
    const { blocks, strokes } = coverItems(engine);
    deleteEntities(engine, blocks, [], strokes); // 바깥 트랜잭션에 합류
    tx.setNote({ coverPage: undefined });
  }, { origin: 'user', label: '표지 쪽 지우기' });
}
