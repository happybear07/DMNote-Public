// 좌표 계산 · 핸들 위치 · 히트 판정. 그리기와 입력이 같이 쓴다.
import { fitResize, isTextContent, q, unionRects, type BlockAnchor, type Engine, type Id, type Rect, type Vec2 } from '@dn/engine-core';
import type { CanvasView } from './canvas-view';
import { CONNECT_R, HANDLE_HIT, HANDLE_HIT_TOUCH } from './constants';
import type { Handle, Tool } from './types';

/** 상자를 고르는 선택 도구인가 (필기 뺀 콘텐츠 · 둘 다) */
export const selectsBoxes = (t: Tool): boolean => t === 'select' || t === 'both';

export function anchorOnRect(r: Rect, anchor: BlockAnchor, toward: Vec2): Vec2 {
  const t = anchor.t ?? 0.5;
  switch (anchor.side) {
    case 'top': return { x: r.x + r.w * t, y: r.y };
    case 'bottom': return { x: r.x + r.w * t, y: r.y + r.h };
    case 'left': return { x: r.x, y: r.y + r.h * t };
    case 'right': return { x: r.x + r.w, y: r.y + r.h * t };
    default: {
      const c = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
      const dx = toward.x - c.x, dy = toward.y - c.y;
      if (!dx && !dy) return c;
      const s = Math.min(dx ? r.w / 2 / Math.abs(dx) : Infinity, dy ? r.h / 2 / Math.abs(dy) : Infinity);
      return { x: c.x + dx * s, y: c.y + dy * s };
    }
  }
}

export function resizeRect(r: Rect, h: Handle, dx: number, dy: number, keepRatio: boolean): Rect {
  let { x, y, w, h: hh } = r;
  const MIN = 60;
  if (h.includes('e')) w = Math.max(MIN, r.w + dx);
  if (h.includes('w')) { w = Math.max(MIN, r.w - dx); x = r.x + r.w - w; }
  if (h.includes('s')) hh = Math.max(40, r.h + dy);
  if (h.includes('n')) { hh = Math.max(40, r.h - dy); y = r.y + r.h - hh; }
  if (keepRatio && h.length === 2) {
    const ratio = r.w / r.h;
    hh = w / ratio;
    if (h.includes('n')) y = r.y + r.h - hh;
  }
  return { x: q(x), y: q(y), w: q(w), h: q(hh) };
}

export function handlePoints(view: CanvasView, r: Rect): [Handle, Vec2][] {
  const a = view.toScreen(r);
  const w = r.w * view.cam.zoom, h = r.h * view.cam.zoom;
  return [
    ['nw', { x: a.x, y: a.y }], ['ne', { x: a.x + w, y: a.y }],
    ['sw', { x: a.x, y: a.y + h }], ['se', { x: a.x + w, y: a.y + h }],
  ];
}

export function connectPoints(view: CanvasView, r: Rect): [BlockAnchor['side'], Vec2][] {
  const a = view.toScreen(r);
  const w = r.w * view.cam.zoom, h = r.h * view.cam.zoom;
  const o = 12;
  return [
    ['top', { x: a.x + w / 2, y: a.y - o }], ['bottom', { x: a.x + w / 2, y: a.y + h + o }],
    ['left', { x: a.x - o, y: a.y + h / 2 }], ['right', { x: a.x + w + o, y: a.y + h / 2 }],
  ];
}

/** 블록 왼쪽 바깥 핸들 띠 — 블록에서 핸들로 마우스를 옮기는 동안 호버가 끊기지 않게 */
export function inGripZone(view: CanvasView, s: Vec2): Id | null {
  const r = view.gripId ? view.engine.blockRect(view.gripId) : undefined;
  if (!r) return null;
  const a = view.toScreen(r);
  return s.x >= a.x - 30 && s.x <= a.x && s.y >= a.y && s.y <= a.y + r.h * view.cam.zoom ? view.gripId : null;
}

// ───────── 입력 ─────────
export function local(view: CanvasView, e: { clientX: number; clientY: number }): Vec2 {
  const r = view.root.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

export function isEditableTarget(t: EventTarget | null): boolean {
  // 편집 중인 에디터 안의 contenteditable=false 조각(토글 화살표 · 할 일 상자 · 콜아웃 아이콘)도 에디터 몫이다
  // 아이콘처럼 SVG 요소일 수도 있다 (HTMLElement가 아님)
  if (!(t instanceof Element)) return false;
  return (t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) || !!t.closest('.dn-text-editing, .dn-table-tools');
}

export function hitHandle(view: CanvasView, s: Vec2): Handle | null {
  if (view.selBlocks.size !== 1 || view.editingId) return null;
  const r = view.engine.blockRect([...view.selBlocks][0]!);
  if (!r) return null;
  const hit = view.pointerKind === 'mouse' ? HANDLE_HIT : HANDLE_HIT_TOUCH;
  for (const [h, p] of handlePoints(view, r)) if (Math.abs(p.x - s.x) <= hit && Math.abs(p.y - s.y) <= hit) return h;
  // 변 (보이지 않는 핸들)
  const a = view.toScreen(r);
  const w = r.w * view.cam.zoom, h = r.h * view.cam.zoom;
  const inX = s.x > a.x && s.x < a.x + w, inY = s.y > a.y && s.y < a.y + h;
  if (inY && Math.abs(s.x - a.x) <= 4) return 'w';
  if (inY && Math.abs(s.x - (a.x + w)) <= 4) return 'e';
  if (inX && Math.abs(s.y - a.y) <= 4) return 'n';
  if (inX && Math.abs(s.y - (a.y + h)) <= 4) return 's';
  return null;
}

/** 선택된 화살표 하나의 끝점 (끌어서 다른 블록에 다시 연결, FR-065) */
export function hitArrowEnd(view: CanvasView, s: Vec2): { arrow: Id; end: 'from' | 'to' } | null {
  if (view.selArrows.size !== 1 || !selectsBoxes(view._tool)) return null;
  const id = [...view.selArrows][0]!;
  const a = view.engine.getArrow(id);
  const geo = a && view.engine.arrowGeometry(a);
  if (!geo) return null;
  const pa = view.toScreen(geo.a), pb = view.toScreen(geo.b);
  if (Math.hypot(pb.x - s.x, pb.y - s.y) <= 8) return { arrow: id, end: 'to' };
  if (Math.hypot(pa.x - s.x, pa.y - s.y) <= 8) return { arrow: id, end: 'from' };
  return null;
}

export function hitConnect(view: CanvasView, s: Vec2): BlockAnchor | null {
  if (!selectsBoxes(view._tool) || view.editingId) return null;
  const cands = new Set<Id>(view.selBlocks.size === 1 ? [...view.selBlocks] : []);
  if (view.hover) cands.add(view.hover);
  for (const id of cands) {
    const r = view.engine.blockRect(id);
    if (!r) continue;
    for (const [side, p] of connectPoints(view, r)) {
      if (Math.hypot(p.x - s.x, p.y - s.y) <= CONNECT_R + 4) return { blockId: id, side: side === 'auto' ? 'auto' : side };
    }
  }
  return null;
}

/** 끌고 있는 블록들의 합친 사각형 (스냅 · 도킹은 묶음 단위 — 여러 개를 끌어도 상대 배치가 유지된다) */
export function dragUnion(view: CanvasView, ids: readonly Id[]): Rect | null {
  return unionRects(ids.map((id) => view.engine.blockRect(id)).filter((r): r is Rect => !!r));
}

/** 이 화살표가 화면에서 숨었나 — 두 상자가 붙어 있으면 그리지 않는다(arrow-geom endsTouch, 10/29) */
export function arrowHidden(view: CanvasView, id: Id): boolean {
  const a = view.engine.getArrow(id);
  return !!a && !view.engine.arrowGeometry(a);
}

/** 글 상자의 글 높이 — 최소 높이 없이 폭 w로 잰다. 글만 든 상자가 아니면 0 (그림 · PDF 보기 등은 따로 맞춘 높이를 쓴다) */
export function textHeight(view: CanvasView, id: Id, w: number): number {
  const m = view.mounted.get(id), cs = view.engine.contentsOf(id);
  if (!m || !cs.length || !cs.every(isTextContent)) return 0;
  const st = m.el.style, ow = st.width, oh = st.minHeight;
  st.width = `${w}px`; st.minHeight = '0px';
  const h = m.el.offsetHeight;
  st.width = ow; st.minHeight = oh;
  return h;
}

/** 크기 조절 자리 (10/29): 이웃 상자를 덮지 않게 바꾼 변을 이음매 앞에서 멈춘다(engine-core fitResize). 자동 높이 상자는 바뀐 폭에서
 *  글이 접혀 늘어난 키까지 따져, 아래 상자를 덮게 되면 null(그 크기는 안 됨). reader: 함께 바꾸는 상자들의 새 자리를 덧씌울 때 */
export function fitBoxResize(view: CanvasView, id: Id, s: Rect, r: Rect, heightChanged: boolean, reader: Pick<Engine, 'queryBlocks' | 'blockRect'> = view.engine): Rect | null {
  // 글 상자는 글보다 낮게 줄이지 않는다 — 움직인 변 쪽에서 멈춤 (AT-022: 글이 테두리 밖으로 넘쳐 아래 상자와 겹쳤다)
  const t = heightChanged ? textHeight(view, id, r.w) : 0;
  if (t > r.h + 0.5) r = r.y !== s.y ? { ...r, y: r.y + r.h - t, h: t } : { ...r, h: t };
  const ex = new Set([id]), c = fitResize(reader, s, r, ex);
  const b = view.engine.getBlock(id), m = view.mounted.get(id);
  if (heightChanged || !b || b.sizing === 'fixed' || !m || Math.abs(c.w - s.w) < 0.5) return c;
  const st = m.el.style, old = st.width;
  st.width = `${c.w}px`;
  const h = m.el.offsetHeight;
  st.width = old;
  return h > c.h + 0.5 && fitResize(reader, s, { ...c, h }, ex).h < h - 0.5 ? null : c;
}
