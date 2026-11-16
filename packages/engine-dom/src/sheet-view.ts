// 용지(A4) 화면 (engine-core sheet.ts): 종이 그리기 · 화면이 종이 둘레를 벗어나지 않게 · 블록을 종이 폭 안으로 · '+ 페이지' 버튼.
// 용지가 없는 노트(끝없는 캔버스)는 보드 범위(BOARD ∪ 지금 블록) 안에서만 — 화면 · 끌기 · 크기 조절 · 새 블록, 범위 밖은 책상 색.
import { coverRect, pageAt, pageY, boardBounds, clampToSheet, contentBottom, MIN_ZOOM, setSheetPages, sheetGeom, SHEET_PAD, sheetTop, type Camera, type Rect, type SheetGeom, type Vec2 } from '@dn/engine-core';
import { iconElement } from '@dn/text-pm';
import type { CanvasView } from './canvas-view';
import { drawPaper } from './paper';

/** 종이 둘레로 남기는 화면 여백 (화면 px) */
const MARGIN = 48;

/** 지금 종이 모양 (내용이 넘치면 페이지가 늘어난 값) */
function sheetOf(view: CanvasView): SheetGeom | null {
  const note = view.engine.note;
  return note.sheet ? sheetGeom(note, contentBottom(view.engine)) : null;
}

/** 용지 없는 노트의 범위 (보드 ∪ 지금 블록) — 용지 노트면 null */
function boardOf(view: CanvasView): Rect | null { return boardBounds(view.engine); }

/** 화면이 종이 · 보드 둘레(여백 포함)를 벗어나지 않게 — 범위가 화면보다 작으면 가운데 */
export function clampSheetCam(view: CanvasView, c: Camera): Camera {
  if (view.size.w < 1 || view.size.h < 1) return c;
  const g = sheetOf(view);
  const top = g?.cover?.y ?? 0; // 표지 쪽이 있으면 그 위부터
  const r = g ? { x: 0, y: top, w: g.w, h: g.total - top } : boardOf(view);
  if (!r) return c;
  const m = MARGIN / c.zoom, vw = view.size.w / c.zoom, vh = view.size.h / c.zoom;
  const axis = (start: number, len: number, v: number, pos: number) => (len + 2 * m <= v ? start + (len - v) / 2 : Math.max(start - m, Math.min(pos, start + len + m - v)));
  return { zoom: c.zoom, x: axis(r.x, r.w, vw, c.x), y: axis(r.y, r.h, vh, c.y) };
}

/** 맞춤: 종이 한 장이 화면에 다 들어오게 (100%보다 키우지는 않는다), 첫 페이지부터 */
export function sheetFitCam(view: CanvasView): Camera | null {
  const g = sheetOf(view);
  if (!g) return null;
  const zoom = Math.max(MIN_ZOOM, Math.min(1, (view.size.w - 2 * MARGIN) / g.list[0]!.w, (view.size.h - 2 * MARGIN) / g.h));
  return clampSheetCam(view, { zoom, x: -MARGIN / zoom, y: -MARGIN / zoom });
}

/** 끌어 옮기기: 묶음(u)이 종이 폭 안 · 위쪽 여백 아래에 (보드면 보드 안에) 머물게 */
export function clampDragDelta(view: CanvasView, u: Rect, d: Vec2): Vec2 {
  const g = sheetOf(view);
  if (!g) {
    const b = boardOf(view);
    if (!b) return d;
    return { x: Math.max(b.x, Math.min(u.x + d.x, b.x + b.w - u.w)) - u.x, y: Math.max(b.y, Math.min(u.y + d.y, b.y + b.h - u.h)) - u.y };
  }
  const y = pageY(g, Math.max(sheetTop(g), u.y + d.y), u.h, d.y < 0), pw = pageAt(g, y).w; // 쪽 사이 틈에 걸치지 않게 · 놓일 쪽의 폭 안
  const x = Math.max(SHEET_PAD, Math.min(u.x + d.x, pw - SHEET_PAD - u.w));
  return { x: u.w > pw - 2 * SHEET_PAD ? SHEET_PAD - u.x : x - u.x, y: y - u.y };
}

/** 크기 조절: 가장자리가 종이 · 보드 밖으로 나가지 않게 (옮기지 않고 자른다) */
export function clampResize(view: CanvasView, r: Rect): Rect {
  const g = sheetOf(view);
  if (!g) {
    const b = boardOf(view);
    if (!b) return r;
    const x = Math.max(b.x, r.x), y = Math.max(b.y, r.y);
    return { x, y, w: Math.max(60, Math.min(b.x + b.w, r.x + r.w) - x), h: Math.max(24, Math.min(b.y + b.h, r.y + r.h) - y) };
  }
  const x = Math.max(SHEET_PAD, r.x), right = Math.min(pageAt(g, r.y).w - SHEET_PAD, r.x + r.w), y = Math.max(sheetTop(g), r.y);
  return { x, y, w: Math.max(60, right - x), h: r.h - (y - r.y) };
}

/** 새 블록 자리 (만들기 · 붙여넣기 · 넣기) — 종이 안, 보드면 보드 안 */
export function clampNewRect(view: CanvasView, r: Rect): Rect {
  const g = sheetOf(view);
  if (g) return clampToSheet(g, r);
  const b = boardOf(view);
  return b ? { ...r, x: Math.max(b.x, Math.min(r.x, b.x + b.w - r.w)), y: Math.max(b.y, Math.min(r.y, b.y + b.h - r.h)) } : r;
}

/** 종이 그리기: 책상(바깥) · 페이지(그림자 · 종이 · 배경 무늬) · 페이지 번호. 그렸으면 true (아니면 보통 배경) */
export function drawSheets(ctx: CanvasRenderingContext2D, view: CanvasView, vis: Rect): boolean {
  const g = sheetOf(view);
  syncAddButton(view, g);
  if (!g) return drawBoard(ctx, view, vis);
  const { cam } = view, z = cam.zoom;
  ctx.save();
  ctx.fillStyle = view.theme.desk;
  ctx.fillRect(0, 0, view.size.w, view.size.h);
  g.list.forEach((p, i) => {
    const top = p.y;
    if (top > vis.y + vis.h || top + p.h < vis.y) return;
    const sx = -cam.x * z, sy = (top - cam.y) * z, sw = p.w * z, sh = p.h * z;
    ctx.save();
    ctx.shadowColor = 'rgba(15, 15, 15, 0.16)';
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = view.theme.card;
    ctx.fillRect(sx, sy, sw, sh);
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.rect(sx, sy, sw, sh);
    ctx.clip();
    const y0 = Math.max(top, vis.y), y1 = Math.min(top + p.h, vis.y + vis.h);
    drawPaper(ctx, cam, { x: Math.max(0, vis.x), y: y0, w: Math.min(p.w, vis.x + vis.w) - Math.max(0, vis.x), h: y1 - y0 }, view.engine.note.paper, view.theme.grid);
    ctx.restore();
    if (g.pages > 1 && z >= 0.3) {
      ctx.fillStyle = view.theme.muted;
      ctx.font = `${Math.round(Math.max(9, 11 * z))}px system-ui, sans-serif`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`${i + 1} / ${g.pages}`, sx + sw - 14 * z, sy + sh - 10 * z);
    }
  });
  ctx.restore();
  drawCover(ctx, view, vis);
  return true;
}

/** 보드 끝이 화면에 들어오면: 범위 밖은 책상 색, 안은 보통 배경 · 무늬. 화면이 다 보드 안이면 그리지 않는다(false) */
function drawBoard(ctx: CanvasRenderingContext2D, view: CanvasView, vis: Rect): boolean {
  const b = boardOf(view);
  if (!b || (b.x <= vis.x && b.y <= vis.y && b.x + b.w >= vis.x + vis.w && b.y + b.h >= vis.y + vis.h)) return false;
  const { cam } = view, z = cam.zoom;
  const sx = (b.x - cam.x) * z, sy = (b.y - cam.y) * z;
  ctx.save();
  ctx.fillStyle = view.theme.desk;
  ctx.fillRect(0, 0, view.size.w, view.size.h);
  ctx.fillStyle = view.theme.card;
  ctx.fillRect(sx, sy, b.w * z, b.h * z);
  ctx.beginPath();
  ctx.rect(sx, sy, b.w * z, b.h * z);
  ctx.clip();
  const x0 = Math.max(b.x, vis.x), y0 = Math.max(b.y, vis.y);
  drawPaper(ctx, cam, { x: x0, y: y0, w: Math.min(b.x + b.w, vis.x + vis.w) - x0, h: Math.min(b.y + b.h, vis.y + vis.h) - y0 }, view.engine.note.paper, view.theme.grid);
  ctx.restore();
  drawCover(ctx, view, vis);
  return true;
}

/**
 * 표지 쪽 (11/03): 종이 한 장(그림자 · 바탕 무늬) + 위에 '표지' 이름표. A4 노트는 1쪽 위, 끝없는 캔버스는 내용 왼쪽.
 * 끝없는 캔버스에서 보드 전체가 화면을 덮을 때(drawBoard가 false)는 draw-under가 따로 부른다
 */
export function drawCover(ctx: CanvasRenderingContext2D, view: CanvasView, vis: Rect): void {
  const c = coverRect(view.engine.note);
  if (!c || c.x > vis.x + vis.w || c.x + c.w < vis.x || c.y > vis.y + vis.h || c.y + c.h < vis.y) return;
  const { cam } = view, z = cam.zoom;
  const sx = (c.x - cam.x) * z, sy = (c.y - cam.y) * z, sw = c.w * z, sh = c.h * z;
  ctx.save();
  ctx.shadowColor = 'rgba(15, 15, 15, 0.2)';
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 3;
  ctx.fillStyle = view.theme.card;
  ctx.fillRect(sx, sy, sw, sh);
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.rect(sx, sy, sw, sh);
  ctx.clip();
  const x0 = Math.max(c.x, vis.x), y0 = Math.max(c.y, vis.y);
  drawPaper(ctx, cam, { x: x0, y: y0, w: Math.min(c.x + c.w, vis.x + vis.w) - x0, h: Math.min(c.y + c.h, vis.y + vis.h) - y0 }, view.engine.note.paper, view.theme.grid);
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = view.theme.accent;
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 1;
  ctx.strokeRect(sx + 0.5, sy + 0.5, sw - 1, sh - 1);
  ctx.globalAlpha = 1;
  if (z >= 0.2) {
    ctx.fillStyle = view.theme.muted;
    ctx.font = `600 ${Math.round(Math.max(10, 12 * Math.min(1, z * 1.4)))}px system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText('표지', sx, sy - 6);
  }
  ctx.restore();
}

const addButtons = new WeakMap<CanvasView, HTMLButtonElement>();

/** 마지막 페이지 옆 '+ 페이지' (화면 크기 그대로) */
function syncAddButton(view: CanvasView, g: SheetGeom | null): void {
  let b = addButtons.get(view);
  if (!g || view.readOnly) { if (b) b.hidden = true; return; }
  if (!b) {
    b = document.createElement('button');
    b.type = 'button';
    b.className = 'dn-sheet-add dn-ui';
    b.append(iconElement('plus', 20));
    b.title = '새 페이지 — 아래에 A4 한 장 더';
    b.setAttribute('aria-label', '새 페이지');
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    b.addEventListener('mousedown', (e) => e.preventDefault()); // 초점은 캔버스에 (CQ-012)
    b.addEventListener('click', () => {
      const cur = sheetOf(view);
      if (!cur || !setSheetPages(view.engine, cur.pages + 1).ok) return;
      // 새 페이지 위쪽으로 화면을 옮긴다
      const top = cur.total + cur.gap;
      view.setCamera({ ...view.cam, y: top - MARGIN / view.cam.zoom });
    });
    view.root.append(b);
    addButtons.set(view, b);
  }
  const { cam } = view;
  // 마지막 페이지 오른쪽 아래 옆 (아래 가운데는 도구 막대 자리) — 마지막 페이지 바닥이 화면에 보일 때만
  const right = (g.list[g.list.length - 1]!.w - cam.x) * cam.zoom + 12, bottom = (g.total - cam.y) * cam.zoom;
  b.hidden = bottom < 48 || bottom > view.size.h + 4;
  if (b.hidden) return;
  b.style.left = `${Math.min(right, view.size.w - b.offsetWidth - 12)}px`;
  b.style.top = `${bottom - b.offsetHeight}px`;
}
