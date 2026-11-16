// 블록 묶음 옮기기 (FR-153 옆 노트에서 끌어 복사): 다른 노트 엔진의 블록을 크기 · 색 · 콘텐츠째 떠서, 이 노트에 새 id로 붙인다.
// 블록 사이 화살표도 함께. 댓글 · 충돌 표시 · 블록에 묶인 잉크는 옮기지 않는다(원본 노트의 일). 첨부는 같은 기기 저장소라 해시 그대로 쓴다.
// v2 (노트 v6): 블록 · 화살표의 의미 · 출처 · 모양 필드(ai · nodeKind · relation · style …)를 함께 싣는다 — 복사한 AI 블록이
// 사람 블록으로 둔갑하지 않게(학습 데이터 출처). v1 클립도 그대로 읽는다.
import type { Engine, Tx, TxResult } from './engine';
import { keyBetween } from './order';
import { isBlockEnd, type Anchor, type Arrow, type Block, type Id } from './model';
import type { Vec2 } from './geom';

/** 블록에서 클립에 싣지 않는 필드: 자리 · 쌓임 · 묶음 · 댓글 · 충돌 표시 (붙이는 노트에서 새로 정한다) */
type ClipBlockFields = Omit<Partial<Block>, 'id' | 'x' | 'y' | 'z' | 'group' | 'comments' | 'conflict' | 'attachTo'>;
export interface ClipBlock extends ClipBlockFields {
  readonly dx: number; readonly dy: number; readonly w: number; readonly h: number;
  readonly sizing: 'auto' | 'fixed'; readonly layout: 'flow' | 'free';
  /** 붙은 노드 블록 (클립 안 순번) */
  readonly attachTo?: number;
  /** 콘텐츠 (id · blockId 없이) */
  readonly contents: readonly Record<string, unknown>[];
}
/** 화살표 끝: 클립 안 블록 순번, 또는 빈 곳의 점(묶음 왼쪽 위 기준 자리, 11/09) */
export type ClipEnd = number | { readonly x: number; readonly y: number };
/** 화살표: 양 끝은 클립 안 순번(또는 점), 나머지는 의미 · 모양 · 출처 필드 그대로 */
export type ClipArrow = { readonly from: ClipEnd; readonly to: ClipEnd } & Omit<Partial<Arrow>, 'id' | 'from' | 'to'>;
export interface BlockClip { readonly kind: 'dn-blocks'; readonly v: 1 | 2; readonly blocks: readonly ClipBlock[]; readonly arrows: readonly ClipArrow[] }

export const BLOCK_CLIP_MIME = 'application/x-dn-blocks';

export function isBlockClip(x: unknown): x is BlockClip {
  const c = x as BlockClip;
  return !!c && c.kind === 'dn-blocks' && (c.v === 1 || c.v === 2) && Array.isArray(c.blocks) && c.blocks.every((b) => typeof b.w === 'number' && Array.isArray(b.contents));
}

/** 블록들 → 묶음 (왼쪽 위 기준 상대 자리) */
export function blockClip(engine: Engine, ids: readonly Id[]): BlockClip {
  const bs = ids.map((id) => engine.getBlock(id)).filter((b) => !!b);
  const x0 = Math.min(...bs.map((b) => b!.x)), y0 = Math.min(...bs.map((b) => b!.y));
  const index = new Map(bs.map((b, i) => [b!.id, i]));
  return {
    kind: 'dn-blocks', v: 2,
    blocks: bs.map((b) => {
      const { id: _id, x, y, z: _z, group: _g, comments: _c, conflict: _k, attachTo, ...fields } = structuredClone(b!);
      return {
        ...fields, dx: x - x0, dy: y - y0,
        ...(attachTo !== undefined && index.has(attachTo) ? { attachTo: index.get(attachTo)! } : {}),
        contents: engine.contentsOf(b!.id).map((c) => {
          const { id: _cid, blockId: _b, ...rest } = structuredClone(c) as unknown as Record<string, unknown>;
          return rest;
        }),
      };
    }),
    // 고른 블록끼리의 화살표 + 고른 블록에서 빈 곳을 가리키는 화살표(점 끝은 왼쪽 위 기준 자리로)
    arrows: [...new Set(bs.flatMap((b) => engine.arrowsOf(b!.id)))]
      .filter((a) => [a.from, a.to].every((an) => !isBlockEnd(an) || index.has(an.blockId)))
      .map((a) => {
        const { id: _id, from, to, ...rest } = structuredClone(a);
        const end = (an: Anchor): ClipEnd => (isBlockEnd(an) ? index.get(an.blockId)! : { x: an.point.x - x0, y: an.point.y - y0 });
        return { ...rest, from: end(from), to: end(to) };
      }),
  };
}

/** 묶음 → 이 노트의 `at`(왼쪽 위)에 새 블록들. 실행 취소 한 번 */
export function pasteBlockClip(engine: Engine, clip: BlockClip, at: Vec2, label = '블록 붙여넣기'): TxResult<Id[]> {
  return engine.transact((tx) => createFromClip(engine, tx, clip, at), { origin: 'user', label });
}

/** 묶음의 세로 길이 (월드 px) */
export function clipHeight(clip: BlockClip): number {
  return clip.blocks.reduce((m, b) => Math.max(m, b.dy + b.h), 0);
}

/** (트랜잭션 안) 묶음 → 새 블록들 */
export function createFromClip(engine: Engine, tx: Tx, clip: BlockClip, at: Vec2): Id[] {
  const ids: Id[] = [];
  let z = engine.topZ();
  for (const b of clip.blocks) {
    z = keyBetween(z, null);
    // 클립 밖에서 온 값일 수 있다 — id · 묶음 · 댓글처럼 이 노트가 정할 필드는 버린다
    const { dx, dy, contents, attachTo: _a, id: _i, group: _g, comments: _c, conflict: _k, z: _z, ...fields } = structuredClone(b) as ClipBlock & Partial<Block>;
    const id = tx.createBlock({ ...fields, x: Math.round(at.x + dx), y: Math.round(at.y + dy), z });
    for (const c of contents) { const { id: _cid, ...rest } = c; tx.createContent({ ...rest, blockId: id } as never); }
    ids.push(id);
  }
  clip.blocks.forEach((b, i) => { const t = b.attachTo !== undefined ? ids[b.attachTo] : undefined; if (t) tx.set('block', ids[i]!, { attachTo: t }); });
  for (const a of clip.arrows) {
    const { from: f, to: t, id: _id, ...rest } = structuredClone(a) as ClipArrow & { id?: unknown };
    const end = (e: ClipEnd): Anchor | undefined => (typeof e === 'number' ? (ids[e] ? { blockId: ids[e]!, side: 'auto' } : undefined) : { point: { x: Math.round(at.x + e.x), y: Math.round(at.y + e.y) } });
    const from = end(f), to = end(t);
    if (from && to) tx.createArrow({ ...rest, from, to });
  }
  return ids;
}
