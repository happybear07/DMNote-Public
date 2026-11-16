// 잉크 레이어 (FR-034 · 035): 블록 위를 덮는 캔버스에 자유 잉크를 그린다. 상태(도구 설정 · 보이기 · 선택 · 진행 중 획)도 여기.
// 펜 획은 외곽선(ink-render.ts — 필압 · 속도로 굵기, 펜 종류별 모양)을 획마다 한 번 만들어 두고 채운다.
// 쓰는 동안은 진행 중 획만 따로 낮은 지연 캔버스(wet)에 — 저장된 획들(static)은 바뀐 게 있을 때만 다시 그린다.
// 형광펜은 별도 캔버스에 불투명하게 그린 뒤 한 번에 반투명 합성 — 겹쳐도 진해지지 않고 아래 글이 비친다.
import { boundStrokesWorld, freeStrokes, strokeBounds, strokeWorldPoints, unionRects, type Engine, type HlKind, type Id, type PenKind, type Rect, type Stroke, type Vec2 } from '@dn/engine-core';
import type { CanvasView } from './canvas-view';
import { fillStroke, outlinePath, strokePath } from './ink-render';
import { shownInk, type CanvasTheme } from './theme';

/** 기본 색 3개 — 사용자가 ＋로 3개까지 더한다(앱이 기억). 숫자 키 1~6은 색 줄(ink.colors · hlColors = 기본 + 더한 색) 순서 */
export const INK_COLORS = ['#1f1f1f', '#e03131', '#1971c2'];
export const HIGHLIGHT_COLORS = ['#ffe066', '#8ce99a', '#74c0fc'];
export const EXTRA_COLORS = 3;
/** ＋를 누르면 먼저 보여 주는 추천 색 */
export const INK_SUGGEST = ['#2f9e44', '#f08c00', '#9c36b5', '#0c8599', '#c2255c', '#5f3dc4', '#e8590c', '#868e96'];
export const HL_SUGGEST = ['#faa2c1', '#ffc078', '#b197fc', '#96f2d7', '#ffa8a8', '#d0bfff', '#ffec99', '#a5d8ff'];
/** 굵기 (월드 px): 처음 값 · 설정 창 범위 · [ ] 키로 한 칸씩 오가는 단계 — 펜 · 형광펜 */
export const PEN_WIDTH = { start: 3, min: 0.5, max: 20, steps: [0.5, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 20] } as const;
export const HL_WIDTH = { start: 18, min: 4, max: 40, steps: [6, 10, 14, 18, 24, 28, 36] } as const;
export const HL_ALPHA = 0.35;
/** [ ] 키: 지금 굵기에서 다음 단계 (직접 넣은 굵기면 가장 가까운 위 · 아래 단계로) */
export function stepWidth(w: number, dir: 1 | -1, steps: readonly number[]): number {
  return dir > 0 ? steps.find((x) => x > w + 1e-6) ?? steps.at(-1)! : [...steps].reverse().find((x) => x < w - 1e-6) ?? steps[0]!;
}
/** 형광펜 끝 모양 — 둥근 촉만 둥글게, 납작 촉 · 직선은 각지게 */
const capOf = (k: HlKind | undefined): CanvasLineCap => (k === 'round' ? 'round' : 'butt');

export interface InkState {
  canvas: HTMLCanvasElement;
  color: string;
  hlColor: string;
  /** 색 줄 (기본 3 + 더한 색 ≤ 3) — 펜 · 형광펜 따로 */
  colors: string[];
  hlColors: string[];
  /** 펜 · 형광펜 굵기 (월드 px, 필압으로 변조) */
  width: number;
  hlWidth: number;
  show: boolean;
  showBlocks: boolean;
  /** 펜으로만 필기 (FR-040) — 손가락은 화면 이동 */
  penOnly: boolean;
  /** 사용자가 펜 전용을 직접 켜거나 끈 적이 있나 — 있으면 펜을 받아도 저절로 바꾸지 않는다 (TABLET-CHECK T4) */
  penOnlySet: boolean;
  selected: Set<Id>;
  /** 펜 종류 (볼펜 · 만년필 · 붓펜 · 연필 …) · 형광펜 종류 (납작 · 둥근 · 직선) */
  pen: PenKind;
  hl: HlKind;
  /** 진행 중인 획 (화면에 바로 그림, 떼면 저장). predicted: 다음 움직임 예측 점(그리기만, 저장 안 함) */
  wet: { tool: 'pen' | 'highlighter'; origin: Vec2; pts: number[]; t0: number; color: string; width: number; pen: PenKind; hl: HlKind; predicted?: number[] } | null;
  /** 진행 중 획 전용 캔버스 (낮은 지연) · 저장된 획을 마지막으로 그린 상태 */
  wetCanvas: HTMLCanvasElement;
  staticSig: string;
  /** 지우개로 닿은 획 (떼면 지움, 그동안 흐리게) */
  erasing: Set<Id>;
  lasso: Vec2[] | null;
  /** 선택 끌기 미리보기 (월드 px) — move: 옮기기, scale: 오른쪽 아래 모서리로 크기 조절(왼쪽 위 고정) */
  drag: { mode: 'move' | 'scale'; start: Vec2; delta: Vec2; base?: Rect } | null;
  /** 이 포인터만 잉크 입력 (다른 손가락 · 손바닥 무시) */
  pointerId: number | null;
}

export function createInk(root: HTMLElement, before: HTMLElement): InkState {
  const canvas = document.createElement('canvas');
  canvas.className = 'dn-layer dn-ink';
  root.insertBefore(canvas, before);
  const wetCanvas = document.createElement('canvas');
  wetCanvas.className = 'dn-layer dn-ink dn-ink-wet';
  root.insertBefore(wetCanvas, before);
  return {
    canvas, color: INK_COLORS[0]!, hlColor: HIGHLIGHT_COLORS[0]!, colors: [...INK_COLORS], hlColors: [...HIGHLIGHT_COLORS], width: PEN_WIDTH.start, hlWidth: HL_WIDTH.start, show: true, showBlocks: true, penOnly: false, penOnlySet: false, pen: 'ball', hl: 'chisel',
    selected: new Set(), wet: null, erasing: new Set(), lasso: null, drag: null, pointerId: null, wetCanvas, staticSig: '',
  };
}

// 엔진이 바뀐 횟수 — 저장된 획을 다시 그릴지 (획 · 블록이 바뀌면 묶인 잉크도 움직인다)
const versions = new WeakMap<Engine, { n: number }>();
function engineVersion(e: Engine): number {
  let v = versions.get(e);
  if (!v) { const box = { n: 0 }; versions.set(e, box); e.subscribe(() => { box.n++; }); v = box; }
  return v.n;
}

/** 저장된 획을 다시 그려야 하는 조건을 한 줄로 — 같으면 건너뛴다 */
function staticSignature(view: CanvasView): string {
  const ink = view.ink, c = view.cam, g = view.gesture;
  const moving = g.k === 'drag' || g.k === 'resize' ? JSON.stringify(g) : '';
  return `${engineVersion(view.engine)}|${c.x}|${c.y}|${c.zoom}|${view.size.w}x${view.size.h}@${view.dpr}|${ink.show}|${[...ink.selected].join()}|${[...ink.erasing].join()}|${ink.drag ? JSON.stringify(ink.drag) : ''}|${moving}|${ink.canvas.width}x${ink.canvas.height}`;
}

const offscreen = typeof document !== 'undefined' ? document.createElement('canvas') : null;

/** 잉크 그리기: 저장된 획(바뀐 게 있을 때만) + 진행 중 획(매 프레임, 따로) */
export function drawInk(view: CanvasView): void {
  const ink = view.ink;
  view.world.style.visibility = ink.showBlocks ? '' : 'hidden';
  const sig = staticSignature(view);
  if (sig !== ink.staticSig) { ink.staticSig = sig; drawStatic(view); }
  drawWet(view);
}

function drawStatic(view: CanvasView): void {
  const ink = view.ink;
  const ctx = view.ctx(ink.canvas);
  if (!ink.show) return;
  const vr = view.visibleRect();
  // 블록에 묶인 잉크(FR-037)는 블록을 따라 — 끌기 · 크기 조절 미리보기 자리도 반영
  const bound = boundStrokesWorld(view.engine, (id) => view.previewRect(id));
  const all = [...freeStrokes(view.engine), ...bound].filter((s) => intersects(strokeBounds(s), vr));
  const offset = ink.drag?.delta;
  // 형광펜: 오프스크린에 불투명 → 반투명 한 번 합성
  const hl = all.filter((s) => s.tool === 'highlighter');
  if (hl.length) {
    const oc = offscreen!;
    if (oc.width !== ink.canvas.width || oc.height !== ink.canvas.height) { oc.width = ink.canvas.width; oc.height = ink.canvas.height; }
    const o = oc.getContext('2d')!;
    o.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    o.clearRect(0, 0, view.size.w, view.size.h);
    for (const s of hl) paintStroke(view, o, s, ink.selected.has(s.id) && ink.drag?.mode === 'move' ? offset : undefined, ink.erasing.has(s.id));
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = HL_ALPHA;
    ctx.drawImage(oc, 0, 0);
    ctx.restore();
  }
  for (const s of all) {
    if (s.tool === 'highlighter') continue;
    const off = ink.selected.has(s.id) && ink.drag?.mode === 'move' ? offset : undefined;
    ctx.globalAlpha = ink.erasing.has(s.id) ? 0.25 : 1;
    fillStroke(ctx, view.dpr, view.cam, s, strokePath(s), off?.x, off?.y, shownInk(view.theme, s.color));
  }
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.globalAlpha = 1;
}

let wetCtx: WeakMap<HTMLCanvasElement, CanvasRenderingContext2D> = new WeakMap();
/** 진행 중 획 — 낮은 지연(desynchronized) 캔버스에 그것만 */
function drawWet(view: CanvasView): void {
  const ink = view.ink, wc = ink.wetCanvas;
  if (wc.width !== ink.canvas.width || wc.height !== ink.canvas.height) { wc.width = ink.canvas.width; wc.height = ink.canvas.height; wetCtx = new WeakMap(); }
  let ctx = wetCtx.get(wc);
  if (!ctx) { ctx = (wc.getContext('2d', { desynchronized: true }) ?? wc.getContext('2d'))!; wetCtx.set(wc, ctx); }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, wc.width, wc.height);
  const w = ink.wet;
  if (!w || !ink.show) return;
  if (w.tool === 'highlighter') {
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.globalAlpha = HL_ALPHA;
    paintWet(view, ctx);
    ctx.globalAlpha = 1;
    return;
  }
  const pts = w.predicted?.length ? [...w.pts, ...w.predicted] : w.pts;
  const s = { origin: w.origin, scale: 1, color: shownInk(view.theme, w.color) } as Stroke;
  fillStroke(ctx, view.dpr, view.cam, s, outlinePath(pts, w.width, w.pen, false));
}

const intersects = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

function paintStroke(view: CanvasView, ctx: CanvasRenderingContext2D, s: Stroke, offset: Vec2 | undefined, faded: boolean): void {
  const p = strokeWorldPoints(s);
  const dx = offset?.x ?? 0, dy = offset?.y ?? 0;
  const pts: number[] = [];
  for (let i = 0; i < p.length; i += 4) pts.push(p[i]! + dx, p[i + 1]! + dy, p[i + 2]!);
  ctx.globalAlpha = faded ? 0.25 : 1;
  paintPath(ctx, view.cam, pts, s.color, s.width * s.scale, capOf(s.hl));
  ctx.globalAlpha = 1;
}

function paintWet(view: CanvasView, ctx: CanvasRenderingContext2D): void {
  const w = view.ink.wet!;
  const pts: number[] = [];
  for (let i = 0; i < w.pts.length; i += 4) pts.push(w.origin.x + w.pts[i]!, w.origin.y + w.pts[i + 1]!, w.pts[i + 2]!);
  paintPath(ctx, view.cam, pts, w.color, w.width, capOf(w.hl));
}

/**
 * 형광펜 전용: 월드 점 [x, y, 필압]* → 화면, 굵기 일정 · 끝은 종류대로(납작 · 둥근) (펜 획은 ink-render.ts 외곽선으로 채운다).
 * 점 사이는 중점을 지나는 2차 곡선으로 부드럽게. 설정 창 미리보기도 같은 함수로 그린다
 */
export function paintPath(ctx: CanvasRenderingContext2D, cam: { x: number; y: number; zoom: number }, pts: number[], color: string, width: number, cap: CanvasLineCap = 'butt'): void {
  const z = cam.zoom;
  const sx = (i: number) => (pts[i]! - cam.x) * z, sy = (i: number) => (pts[i + 1]! - cam.y) * z;
  const lw = Math.max(0.4, width * z);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = cap;
  ctx.lineJoin = 'round';
  const n = pts.length / 3;
  if (n === 1) { ctx.beginPath(); ctx.arc(sx(0), sy(0), lw / 2, 0, Math.PI * 2); ctx.fill(); return; }
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.moveTo(sx(0), sy(0));
  for (let k = 1; k < n - 1; k++) ctx.quadraticCurveTo(sx(k * 3), sy(k * 3), (sx(k * 3) + sx(k * 3 + 3)) / 2, (sy(k * 3) + sy(k * 3 + 3)) / 2);
  ctx.lineTo(sx((n - 1) * 3), sy((n - 1) * 3));
  ctx.stroke();
}

/** PNG 내보내기: 월드 좌표 그대로(호출 측 ctx가 이미 배율 · 이동을 걸어 둠) 자유 잉크를 그린다. 형광펜은 획마다 반투명.
 *  theme: 내보내는 바탕 — 화면처럼 어두운 바탕 위 검정 펜은 밝게 */
export function paintStrokesWorld(ctx: CanvasRenderingContext2D, strokes: readonly Stroke[], theme?: Pick<CanvasTheme, 'dark' | 'text'>): void {
  const cam = { x: 0, y: 0, zoom: 1 };
  for (const hl of [true, false]) {
    for (const s of strokes) {
      if ((s.tool === 'highlighter') !== hl) continue;
      if (!hl) {
        ctx.save();
        ctx.translate(s.origin.x, s.origin.y);
        ctx.scale(s.scale, s.scale);
        ctx.fillStyle = theme ? shownInk(theme, s.color) : s.color;
        ctx.fill(strokePath(s));
        ctx.restore();
        continue;
      }
      const p = strokeWorldPoints(s);
      const pts: number[] = [];
      for (let i = 0; i < p.length; i += 4) pts.push(p[i]!, p[i + 1]!, p[i + 2]!);
      ctx.globalAlpha = HL_ALPHA;
      paintPath(ctx, cam, pts, s.color, s.width * s.scale, capOf(s.hl));
    }
  }
  ctx.globalAlpha = 1;
}

/** 선택한 획들의 월드 경계 (끌기 미리보기 반영) */
export function selectionBounds(view: CanvasView): Rect | null {
  const u = unionRects([...view.ink.selected].map((id) => view.engine.getStroke(id) as Stroke | undefined).filter((s): s is Stroke => !!s).map((s) => strokeBounds(s)));
  if (!u) return null;
  const drag = view.ink.drag;
  const d = drag?.delta ?? { x: 0, y: 0 };
  if (drag?.mode === 'scale') { const f = scaleFactor(view); return { x: u.x - 4, y: u.y - 4, w: u.w * f + 8, h: u.h * f + 8 }; }
  return { x: u.x + d.x - 4, y: u.y + d.y - 4, w: u.w + 8, h: u.h + 8 };
}

/** 올가미 · 선택 상자 (over 캔버스) */
export function drawInkOverlay(view: CanvasView, ctx: CanvasRenderingContext2D): void {
  const ink = view.ink;
  ctx.save();
  if (ink.lasso && ink.lasso.length > 1) {
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = view.theme.accent;
    ctx.lineWidth = 1.2;
    ctx.fillStyle = 'rgba(76, 110, 245, 0.06)';
    ctx.beginPath();
    ink.lasso.forEach((p, i) => { const s = view.toScreen(p); if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); });
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  const r = selectionBounds(view);
  if (r) {
    const a = view.toScreen({ x: r.x, y: r.y });
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = view.theme.accent;
    ctx.lineWidth = 1;
    ctx.strokeRect(a.x, a.y, r.w * view.cam.zoom, r.h * view.cam.zoom);
    // 크기 조절 손잡이 (오른쪽 아래, 올가미만 — '둘 다'는 함께 옮기기만)
    ctx.setLineDash([]);
    if (view._tool !== 'both') {
    ctx.fillStyle = view.theme.card;
    ctx.fillRect(a.x + r.w * view.cam.zoom - 4, a.y + r.h * view.cam.zoom - 4, 8, 8);
    ctx.strokeRect(a.x + r.w * view.cam.zoom - 4, a.y + r.h * view.cam.zoom - 4, 8, 8);
    }
  }
  ctx.restore();
}

/** 크기 조절 중 배율 — 오른쪽 아래 모서리가 끌려간 만큼 (가로 · 세로 중 큰 쪽, 비율 유지) */
export function scaleFactor(view: CanvasView): number {
  const d = view.ink.drag;
  if (!d || d.mode !== 'scale' || !d.base) return 1;
  const b = d.base;
  return Math.max(0.1, Math.max((b.w + d.delta.x) / Math.max(1, b.w), (b.h + d.delta.y) / Math.max(1, b.h)));
}
