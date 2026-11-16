// '이어서 쓰기' 쪽 그림 (11/11, HOME-DESIGN-REFS 3.5a): 지금 노트에서 마지막 보던 쪽(A4 — 화면 가운데가 든 쪽)이나 화면 범위의
// 상자 배치를 회색 면으로 그린다. 글자는 그리지 않는다(작아서 못 읽고 글씨만 는다 — 제목 · 첫 줄은 옆 글이 맡는다).
// 제목만 있는 상자는 막대 둘, 상자끼리 화살표는 가는 선. 상자는 큰 것부터 24개까지.
import { boxKind, contentBottom, isBound, pageAt, sheetGeom, type Engine, type Rect, type Vec2 } from '@dn/engine-core';
import type { CanvasView } from '@dn/engine-dom';

const MAX_BOXES = 24;

/** 그릴 범위: A4면 화면 가운데가 든 쪽 전체, 아니면 보던 화면(크기를 모르면 내용 전체) */
export function thumbRegion(engine: Engine, view: CanvasView): Rect | null {
  const cam = view.camera, size = view.size;
  const cx = size.w ? cam.x + size.w / 2 / cam.zoom : 0, cy = size.h ? cam.y + size.h / 2 / cam.zoom : 0;
  const g = sheetGeom(engine.note, contentBottom(engine));
  if (g) { const p = pageAt(g, cy); return { x: 0, y: p.y, w: p.w, h: p.h }; }
  if (size.w > 0 && size.h > 0) return { x: cx - size.w / 2 / cam.zoom, y: cam.y, w: size.w / cam.zoom, h: size.h / cam.zoom };
  const bs = [...engine.blocks()];
  if (!bs.length) return null;
  const x = Math.min(...bs.map((b) => b.x)), y = Math.min(...bs.map((b) => b.y));
  return { x, y, w: Math.max(...bs.map((b) => b.x + b.w)) - x, h: Math.max(...bs.map((b) => b.y + b.h)) - y };
}

const inside = (r: Rect, p: Vec2) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

export function NoteThumb({ engine, view }: { engine: Engine; view: CanvasView }) {
  const r = thumbRegion(engine, view);
  if (!r || r.w <= 0 || r.h <= 0) return <svg className="thumb" viewBox="0 0 210 297" aria-hidden><rect className="thumb-paper" width="210" height="297" /></svg>;
  const u = r.w / 160; // 그림 160px 기준 1px
  const boxes = engine.queryBlocks(r).map((id) => engine.getBlock(id)!).filter((b) => b && !b.draft)
    .sort((a, b) => b.w * b.h - a.w * a.h).slice(0, MAX_BOXES);
  const lines = [...engine.arrows()].filter(isBound).map((a) => engine.arrowGeometry(a)).filter((g) => !!g && inside(r, g.a) && inside(r, g.b));
  return (
    <svg className="thumb" viewBox={`${r.x} ${r.y} ${r.w} ${r.h}`} aria-hidden>
      <rect className="thumb-paper" x={r.x} y={r.y} width={r.w} height={r.h} />
      {lines.map((g, i) => <line key={i} className="thumb-arrow" x1={g!.a.x} y1={g!.a.y} x2={g!.b.x} y2={g!.b.y} strokeWidth={u * 1.5} />)}
      {boxes.map((b) => boxKind(engine.contentsOf(b.id)) === 'title' ? (
        <g key={b.id}>
          <rect className="thumb-bar" x={b.x} y={b.y + b.h * 0.2} width={b.w * 0.8} height={Math.min(b.h * 0.3, u * 8)} rx={u * 2} />
          <rect className="thumb-bar soft" x={b.x} y={b.y + b.h * 0.2 + Math.min(b.h * 0.3, u * 8) + u * 4} width={b.w * 0.5} height={u * 5} rx={u * 2} />
        </g>
      ) : <rect key={b.id} className="thumb-box" x={b.x} y={b.y} width={b.w} height={b.h} rx={u * 4} />)}
    </svg>
  );
}
