// 잉크 묶기 · 풀기 (FR-037): 자유 잉크를 블록의 ink 콘텐츠로 편입 — 블록과 함께 움직이고 순서(order)를 가져 문서 구조에 들어간다.
// 묶인 획의 origin은 콘텐츠 기준 상대 좌표. 콘텐츠는 묶을 때의 자리(블록 왼쪽 위 기준 `at`)와 블록 너비(`blockW`)를 기억해
// 월드 위치 = 블록 왼쪽 위 + (at + 상대 좌표) × (지금 블록 너비 / blockW) — 블록을 옮기면 따라가고, 너비를 바꾸면 비율 유지로 커진다.
// 블록이 그대로면 풀기 결과가 묶기 전 좌표와 같다(왕복 무손실).
import type { Engine, TxResult } from './engine';
import type { Rect, Vec2 } from './geom';
import { MIN_SIZE, q, unionRects } from './geom';
import { newId } from './id';
import { isStroke, strokeBounds, strokeWorldPoints, type Stroke } from './ink';
import type { Content, Id } from './model';

export interface InkData { readonly natural: { readonly w: number; readonly h: number }; readonly at: Vec2; readonly blockW: number }
export type InkContent = Content & InkData & { readonly type: 'ink' };

export function isInkContent(c: Content | undefined): c is InkContent {
  return !!c && c.type === 'ink' && typeof (c as InkContent).blockW === 'number' && typeof (c as InkContent).at === 'object';
}

/** 이 콘텐츠에 묶인 획들 */
export function strokesOfContent(engine: Engine, contentId: Id): Stroke[] {
  const out: Stroke[] = [];
  for (const s of engine.strokes()) if (isStroke(s) && s.parent.kind === 'content' && s.parent.contentId === contentId) out.push(s);
  return out;
}

/** 묶인 잉크 콘텐츠의 지금 월드 변환: 월드 = anchor + 상대 × f */
export function inkTransform(engine: Engine, c: InkContent, rectOf?: (id: Id) => Rect | undefined): { anchor: Vec2; f: number } | null {
  const b = rectOf?.(c.blockId) ?? engine.getBlock(c.blockId);
  if (!b) return null;
  const f = b.w / Math.max(1, c.blockW);
  return { anchor: { x: b.x + c.at.x * f, y: b.y + c.at.y * f }, f };
}

/** 묶인 획을 월드 좌표의 획으로 (그리기 · 내보내기용 — 저장하지 않는 사본). rectOf: 끌기 · 크기 조절 미리보기 자리 */
export function boundStrokesWorld(engine: Engine, rectOf?: (id: Id) => Rect | undefined): Stroke[] {
  const out: Stroke[] = [];
  const tf = new Map<Id, { anchor: Vec2; f: number } | null>();
  for (const s of engine.strokes()) {
    if (!isStroke(s) || s.parent.kind !== 'content') continue;
    const cid = s.parent.contentId;
    if (!tf.has(cid)) { const c = engine.getContent(cid); tf.set(cid, isInkContent(c) ? inkTransform(engine, c, rectOf) : null); }
    const t = tf.get(cid);
    if (t) out.push({ ...s, origin: { x: t.anchor.x + s.origin.x * t.f, y: t.anchor.y + s.origin.y * t.f }, scale: s.scale * t.f });
  }
  return out;
}

const overlap = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/**
 * 고른 자유 잉크를 묶는다. 잉크 경계와 가장 많이 겹치는 블록이 있으면 그 블록에(블록을 잉크까지 넓힘),
 * 없으면 잉크 크기의 새 블록을 만들어 담는다. 트랜잭션 하나 = 실행 취소 한 번. 결과: 담긴 블록 id
 */
export function bindStrokes(engine: Engine, ids: readonly Id[]): TxResult<Id | null> {
  const strokes = ids.map((id) => engine.getStroke(id)).filter((s): s is Stroke => isStroke(s) && s.parent.kind === 'layer');
  return engine.transact((tx) => {
    if (!strokes.length) return null;
    const B = unionRects(strokes.map(strokeBounds))!;
    let target: Id | null = null, best = 0;
    for (const b of engine.blocks()) {
      const r = engine.blockRect(b.id);
      const o = r ? overlap(r, B) : 0;
      if (o > best) { best = o; target = b.id; }
    }
    let block: Rect;
    if (target) {
      const r = engine.blockRect(target)!;
      block = unionRects([r, B])!;
      const grewH = block.h > r.h + 0.5;
      tx.set('block', target, { x: block.x, y: block.y, w: block.w, ...(grewH || block.y < r.y ? { h: block.h, minH: q(block.h), sizing: 'fixed' } : {}) });
    } else {
      // 아주 작은 필기(점 하나 등)도 블록 최소 크기는 지킨다 — 잉크는 왼쪽 위 기준으로 그대로
      block = { x: B.x, y: B.y, w: Math.max(MIN_SIZE, B.w), h: Math.max(MIN_SIZE, B.h) };
      target = tx.createBlock({ ...block, minH: q(block.h), sizing: 'fixed' } as never);
    }
    const b = engine.getBlock(target)!;
    const contentId = tx.createContent({ blockId: target, type: 'ink', natural: { w: B.w, h: B.h }, at: { x: B.x - b.x, y: B.y - b.y }, blockW: b.w } as never);
    for (const s of strokes) tx.set('stroke', s.id, { parent: { kind: 'content', contentId }, origin: { x: s.origin.x - B.x, y: s.origin.y - B.y } });
    return target;
  }, { origin: 'user', label: '잉크 묶기' });
}

/** 묶은 잉크를 지금 보이는 자리의 자유 잉크로 되돌린다. 블록에 다른 내용이 없으면 블록도 지운다. 결과: 풀린 획 id */
export function unbindInk(engine: Engine, contentId: Id): TxResult<Id[]> {
  return engine.transact((tx) => {
    const c = engine.getContent(contentId);
    if (!isInkContent(c)) return [];
    const t = inkTransform(engine, c) ?? { anchor: { x: 0, y: 0 }, f: 1 };
    const out: Id[] = [];
    for (const s of strokesOfContent(engine, contentId)) {
      tx.set('stroke', s.id, { parent: { kind: 'layer' }, origin: { x: t.anchor.x + s.origin.x * t.f, y: t.anchor.y + s.origin.y * t.f }, scale: s.scale * t.f });
      out.push(s.id);
    }
    const others = engine.contentsOf(c.blockId).filter((x) => x.id !== contentId);
    tx.delete('content', contentId);
    if (!others.length && engine.getBlock(c.blockId)) {
      for (const a of engine.arrowsOf(c.blockId)) tx.delete('arrow', a.id);
      tx.delete('block', c.blockId);
    }
    return out;
  }, { origin: 'user', label: '잉크 풀기' });
}

/** 콘텐츠를 지우거나 복제할 때 묶인 획도 함께 (commands.ts에서 부름) */
export function cloneBoundStrokes(engine: Engine, fromContent: Id, toContent: Id): Stroke[] {
  return strokesOfContent(engine, fromContent).map((s) => ({ ...structuredClone(s), id: newId(), parent: { kind: 'content', contentId: toContent } }));
}

/** 묶인 잉크 → SVG 경로 (콘텐츠 기준 좌표, 상자 = natural). 문서 뷰 · Markdown 내보내기용 — 필압은 평균 굵기로 */
export interface InkSvg { w: number; h: number; paths: { d: string; color: string; width: number; hl: boolean }[] }
export function inkPaths(engine: Engine, contentId: Id): InkSvg | null {
  const c = engine.getContent(contentId);
  if (!isInkContent(c)) return null;
  const paths = strokesOfContent(engine, contentId).map((s) => {
    const p = strokeWorldPoints(s);
    let d = '';
    for (let i = 0; i < p.length; i += 4) d += `${i ? 'L' : 'M'}${r1(p[i]!)} ${r1(p[i + 1]!)}`;
    if (p.length === 4) d += `L${r1(p[0]! + 0.01)} ${r1(p[1]!)}`;
    return { d, color: s.color, width: r1(s.width * s.scale), hl: s.tool === 'highlighter' };
  });
  return { w: r1(c.natural.w), h: r1(c.natural.h), paths };
}
const r1 = (v: number) => Math.round(v * 10) / 10;

/** SVG 문서 문자열 (내보내기 파일용) */
export function inkSvgString(ink: InkSvg): string {
  const esc = (s: string) => s.replace(/[^#0-9a-zA-Z(),. -]/g, '');
  const body = ink.paths.map((p) => `<path d="${p.d}" fill="none" stroke="${esc(p.color)}" stroke-width="${p.width}" stroke-linecap="${p.hl ? 'butt' : 'round'}" stroke-linejoin="round"${p.hl ? ' opacity="0.35"' : ''}/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${ink.w}" height="${ink.h}" viewBox="0 0 ${ink.w} ${ink.h}">${body}</svg>`;
}
