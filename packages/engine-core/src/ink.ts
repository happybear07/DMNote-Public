// 잉크 (FR-034 · 035 · 036, ENGINE 11장): 자유 잉크 스트로크 — 저장 형태 · 점열 인코딩 · 판정 · 커맨드.
// 점열은 원점 기준 상대 좌표를 1/64 px 정수로 양자화 → 델타 → zigzag varint → base64 (무손실 왕복, 3.3절).
// 이동 · 크기 조절은 origin · scale만 바꾼다(점열 불변) — 연산 · 실행 취소 기록이 점 수와 무관하게 작다.
import type { Engine, TxResult } from './engine';
import { newId } from './id';
import { distToSegment, pointInPolygon, q } from './geom';
import type { Rect, Vec2 } from './geom';
import type { Id, StrokeRecord } from './model';

export type InkTool = 'pen' | 'highlighter';
/**
 * 펜 종류 (그릴 때 모양만 다르다 — 의미 없음). 없으면 볼펜. 볼펜 · 만년필 · 붓펜은 외곽선이 다르고, 연필 · 색연필 · 마커 · 캘리그래피 ·
 * 크레용 · 수채는 고른 것을 획에 저장해 두고 질감은 나중에 (그때까지 가장 가까운 외곽선 — 이미 그린 획에도 나중 질감이 그대로 붙는다)
 */
export type PenKind = 'ball' | 'fountain' | 'brush' | 'pencil' | 'colored-pencil' | 'marker' | 'calligraphy' | 'crayon' | 'watercolor';
export const PEN_KINDS: readonly PenKind[] = ['ball', 'fountain', 'brush', 'pencil', 'colored-pencil', 'marker', 'calligraphy', 'crayon', 'watercolor'];
/** 형광펜 종류: 납작 촉(기본, 끝이 각짐) · 둥근 촉 · 직선(그으면 곧게 — 펴는 동작은 나중, 지금은 납작 촉처럼) */
export type HlKind = 'chisel' | 'round' | 'straight';
export const HL_KINDS: readonly HlKind[] = ['chisel', 'round', 'straight'];

export interface Stroke extends StrokeRecord {
  readonly id: Id;
  /** 자유 잉크(layer) 또는 블록의 잉크 콘텐츠에 묶임(content — origin은 콘텐츠 기준 상대 좌표, FR-037) */
  readonly parent: { readonly kind: 'layer' } | { readonly kind: 'content'; readonly contentId: Id };
  /** 점들의 기준 원점 (월드 좌표) */
  readonly origin: Vec2;
  /** 균일 배율 — 올가미 크기 조절 */
  readonly scale: number;
  /** 인코딩된 점열 [x, y, 필압 0..1, 시간 ms]* */
  readonly points: string;
  readonly count: number;
  readonly tool: InkTool;
  readonly color: string;
  /** 기준 굵기 (월드 px, 필압으로 변조) */
  readonly width: number;
  /** 펜 종류 (펜만) */
  readonly pen?: PenKind;
  /** 형광펜 종류 (형광펜만, 없으면 납작 촉) */
  readonly hl?: HlKind;
  readonly createdAt: number;
}

export function isStroke(s: StrokeRecord | undefined): s is Stroke {
  return !!s && typeof (s as Stroke).points === 'string' && typeof (s as Stroke).origin === 'object';
}

// ───────── 점열 인코딩 ─────────

const Q = 64;
const zig = (n: number) => (n << 1) ^ (n >> 31);
const unzig = (n: number) => (n >>> 1) ^ -(n & 1);

function pushVarint(out: number[], v: number): void {
  let n = v >>> 0;
  while (n >= 0x80) { out.push((n & 0x7f) | 0x80); n >>>= 7; }
  out.push(n);
}

/** 점열(상대 좌표) → 문자열. pts = [x, y, p, t, ...] (t는 시작 기준 ms) */
export function encodePoints(pts: ArrayLike<number>): string {
  const bytes: number[] = [];
  let px = 0, py = 0, pp = 0, pt = 0;
  for (let i = 0; i + 1 < pts.length; i += 4) {
    const x = Math.round(pts[i]! * Q), y = Math.round(pts[i + 1]! * Q);
    const p = Math.round(Math.min(1, Math.max(0, pts[i + 2] ?? 0.5)) * 1023), t = Math.max(0, Math.round(pts[i + 3] ?? 0));
    pushVarint(bytes, zig(x - px)); pushVarint(bytes, zig(y - py)); pushVarint(bytes, zig(p - pp)); pushVarint(bytes, Math.max(0, t - pt));
    px = x; py = y; pp = p; pt = t;
  }
  return toB64(bytes);
}

// base64 — engine-core는 DOM · Node 전용 API(btoa · Buffer)를 쓰지 않는다
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function toB64(bytes: readonly number[]): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + (i + 1 < bytes.length ? B64[(n >> 6) & 63]! : '=') + (i + 2 < bytes.length ? B64[n & 63]! : '=');
  }
  return out;
}
function fromB64(s: string): Uint8Array {
  const clean = s.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n = (B64.indexOf(clean[i]!) << 18) | (B64.indexOf(clean[i + 1] ?? 'A') << 12) | (B64.indexOf(clean[i + 2] ?? 'A') << 6) | B64.indexOf(clean[i + 3] ?? 'A');
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

const decoded = new Map<string, Float64Array>();

/** 문자열 → 점열 (같은 문자열은 한 번만 푼다) */
export function decodePoints(enc: string): Float64Array {
  const hit = decoded.get(enc);
  if (hit) return hit;
  const bin = fromB64(enc);
  const out: number[] = [];
  let i = 0;
  const read = () => { let v = 0, s = 0, b = 0; do { b = bin[i++]!; v |= (b & 0x7f) << s; s += 7; } while (b & 0x80); return v >>> 0; };
  let x = 0, y = 0, p = 0, t = 0;
  while (i < bin.length) {
    x += unzig(read()); y += unzig(read()); p += unzig(read()); t += read();
    out.push(x / Q, y / Q, p / 1023, t);
  }
  const arr = Float64Array.from(out);
  if (decoded.size > 20000) decoded.clear();
  decoded.set(enc, arr);
  return arr;
}

/** 스트로크의 월드 좌표 점 (origin · scale 반영) */
export function strokeWorldPoints(s: Stroke): Float64Array {
  const rel = decodePoints(s.points);
  const out = new Float64Array(rel.length);
  for (let i = 0; i < rel.length; i += 4) {
    out[i] = s.origin.x + rel[i]! * s.scale; out[i + 1] = s.origin.y + rel[i + 1]! * s.scale;
    out[i + 2] = rel[i + 2]!; out[i + 3] = rel[i + 3]!;
  }
  return out;
}

/** 월드 경계 (굵기 포함) */
export function strokeBounds(s: Stroke): Rect {
  const p = strokeWorldPoints(s);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < p.length; i += 4) { x0 = Math.min(x0, p[i]!); y0 = Math.min(y0, p[i + 1]!); x1 = Math.max(x1, p[i]!); y1 = Math.max(y1, p[i + 1]!); }
  const pad = (s.width * s.scale) / 2 + 1;
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
}

export function freeStrokes(engine: Engine): Stroke[] {
  return [...engine.strokes()].filter(isStroke).filter((s) => s.parent.kind === 'layer');
}

// ───────── 판정 ─────────

/** 점과 스트로크 선분 사이 거리가 r(+굵기 절반) 안인가 — 지우개 */
export function strokeHit(s: Stroke, q: Vec2, r: number): boolean {
  const b = strokeBounds(s);
  if (q.x < b.x - r || q.y < b.y - r || q.x > b.x + b.w + r || q.y > b.y + b.h + r) return false;
  const p = strokeWorldPoints(s);
  const reach = r + (s.width * s.scale) / 2;
  if (p.length === 4) return Math.hypot(p[0]! - q.x, p[1]! - q.y) <= reach;
  for (let i = 4; i < p.length; i += 4) {
    if (distToSegment(q, { x: p[i - 4]!, y: p[i - 3]! }, { x: p[i]!, y: p[i + 1]! }) <= reach) return true;
  }
  return false;
}

/**
 * 올가미 선택 (FR-036). 포함 규칙: 스트로크 점의 절반 이상이 올가미 안이면 선택 —
 * 조금 걸친 긴 선은 빠지고, 대부분 감싼 글씨는 끝이 살짝 나가도 들어온다.
 */
export function lassoStrokes(engine: Engine, poly: readonly Vec2[]): Id[] {
  if (poly.length < 3) return [];
  const out: Id[] = [];
  for (const s of freeStrokes(engine)) {
    const p = strokeWorldPoints(s);
    let inside = 0;
    const n = p.length / 4;
    for (let i = 0; i < p.length; i += 4) if (pointInPolygon({ x: p[i]!, y: p[i + 1]! }, poly)) inside++;
    if (inside * 2 >= n) out.push(s.id);
  }
  return out;
}

// ───────── 커맨드 (모두 트랜잭션 하나 = 실행 취소 한 번) ─────────

export interface StrokeInit { tool: InkTool; color: string; width: number; origin: Vec2; points: ArrayLike<number>; pen?: PenKind; hl?: HlKind }

export function addStroke(engine: Engine, init: StrokeInit): TxResult<Id> {
  const id = newId();
  const value: Stroke = {
    id, parent: { kind: 'layer' }, origin: { x: q(init.origin.x), y: q(init.origin.y) }, scale: 1,
    points: encodePoints(init.points), count: Math.floor(init.points.length / 4),
    tool: init.tool, color: init.color, width: init.width, createdAt: Date.now(),
    ...(init.tool === 'pen' && init.pen && init.pen !== 'ball' ? { pen: init.pen } : {}),
    ...(init.tool === 'highlighter' && init.hl && init.hl !== 'chisel' ? { hl: init.hl } : {}),
  };
  return engine.transact((tx) => { tx.apply({ k: 'create', e: 'stroke', id, value } as never); return id; },
    { origin: 'user', label: init.tool === 'highlighter' ? '형광펜' : '펜' });
}

/** 획 지우기. 블록에 묶인 획을 다 지워 빈 잉크 콘텐츠가 남으면 그 콘텐츠도 같은 트랜잭션에서 지운다 (I4 · SYNC 13.4 N6 — 다른 기기는 빈 잉크를 숨긴다) */
export function deleteStrokes(engine: Engine, ids: readonly Id[], label = '잉크 지우기'): TxResult<void> {
  return engine.transact((tx) => {
    const gone = new Set<Id>(), parents = new Set<Id>();
    for (const id of ids) {
      const s = engine.getStroke(id);
      if (!s) continue;
      tx.delete('stroke', id);
      gone.add(id);
      if (isStroke(s) && s.parent.kind === 'content') parents.add(s.parent.contentId);
    }
    for (const cid of parents) {
      const left = [...engine.strokes()].some((s) => !gone.has(s.id) && isStroke(s) && s.parent.kind === 'content' && s.parent.contentId === cid);
      if (!left && engine.getContent(cid)?.type === 'ink') tx.delete('content', cid);
    }
  }, { origin: 'user', label });
}

/** 지우개 막대 '지우기'가 지울 것 — ink: 모든 필기(블록에 묶인 손글씨째, 손글씨만 든 상자는 상자도) · all: 상자 · 화살표 · 필기 전부 */
export function clearTargets(engine: Engine, kind: 'ink' | 'all'): { blocks: Id[]; strokes: Id[] } {
  const blocks = [...engine.blocks()].filter((b) => {
    if (kind === 'all') return true;
    const cs = engine.contentsOf(b.id);
    return cs.length > 0 && cs.every((c) => c.type === 'ink');
  }).map((b) => b.id);
  return { blocks, strokes: [...engine.strokes()].map((s) => s.id) };
}

/** 한 번에 지우기 (실행 취소 한 번). 다 지운 잉크 콘텐츠도 지운다 — 남은 글 칸이 있는 상자는 남긴다 */
export function clearCanvas(engine: Engine, kind: 'ink' | 'all'): TxResult<void> {
  const { blocks, strokes } = clearTargets(engine, kind);
  const dropBlocks = new Set(blocks);
  return engine.transact((tx) => {
    const arrows = new Set<Id>();
    for (const id of blocks) for (const a of engine.arrowsOf(id)) arrows.add(a.id);
    if (kind === 'all') for (const a of engine.arrows()) arrows.add(a.id);
    for (const id of arrows) tx.delete('arrow', id);
    for (const id of strokes) tx.delete('stroke', id);
    for (const b of engine.blocks()) {
      const drop = dropBlocks.has(b.id);
      for (const c of engine.contentsOf(b.id)) if (drop || c.type === 'ink') tx.delete('content', c.id);
      if (drop) tx.delete('block', b.id);
    }
  }, { origin: 'user', label: kind === 'all' ? '모두 지우기' : '필기 모두 지우기' });
}

export function moveStrokes(engine: Engine, ids: readonly Id[], dx: number, dy: number): TxResult<void> {
  return engine.transact((tx) => {
    for (const id of ids) {
      const s = engine.getStroke(id);
      if (isStroke(s)) tx.set('stroke', id, { origin: { x: s.origin.x + dx, y: s.origin.y + dy } });
    }
  }, { origin: 'user', label: '잉크 이동' });
}

/** 상자 · 필기를 함께 옮기기 (선택 도구 '둘 다') — 한 번에 실행 취소. 블록에 묶인 획은 블록을 따라가므로 자유 잉크만 */
export function moveSelection(engine: Engine, blockIds: readonly Id[], strokeIds: readonly Id[], dx: number, dy: number, mergeKey?: string): TxResult<void> {
  return engine.transact((tx) => {
    for (const id of blockIds) { const b = engine.getBlock(id); if (b) tx.set('block', id, { x: b.x + dx, y: b.y + dy }); }
    for (const id of strokeIds) { const s = engine.getStroke(id); if (isStroke(s) && s.parent.kind === 'layer') tx.set('stroke', id, { origin: { x: s.origin.x + dx, y: s.origin.y + dy } }); }
  }, { origin: 'user', label: '이동', ...(mergeKey ? { mergeKey } : {}) });
}

/** 기준점(anchor)을 고정한 균일 크기 조절 */
export function scaleStrokes(engine: Engine, ids: readonly Id[], factor: number, anchor: Vec2): TxResult<void> {
  return engine.transact((tx) => {
    for (const id of ids) {
      const s = engine.getStroke(id);
      if (!isStroke(s)) continue;
      tx.set('stroke', id, { scale: s.scale * factor, origin: { x: anchor.x + (s.origin.x - anchor.x) * factor, y: anchor.y + (s.origin.y - anchor.y) * factor } });
    }
  }, { origin: 'user', label: '잉크 크기 조절' });
}

export function recolorStrokes(engine: Engine, ids: readonly Id[], color: string): TxResult<void> {
  return engine.transact((tx) => { for (const id of ids) if (engine.getStroke(id)) tx.set('stroke', id, { color }); }, { origin: 'user', label: '잉크 색 바꾸기' });
}
