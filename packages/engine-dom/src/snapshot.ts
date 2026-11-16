// PNG로 내보내기 (FR-129): 캔버스 전체 또는 고른 블록을 화면 배율과 무관하게 일정한 해상도로.
// 방법: 화면 밖 무대에 100% 배율로 블록을 다시 그리고(같은 CSS · 같은 줄바꿈), 브라우저가 계산한 위치 · 글꼴 · 색을 읽어
// 2D 캔버스에 옮겨 그린다 — 라이브러리 없이, 화면과 같은 모양. 화살표는 엔진 기하로 직접 그린다.
// 영역(region)을 주면 그 영역만 — 표지 쪽 썸네일(홈 책장, 11/03).
import { arrowChip, boundStrokesWorld, effectiveStyle, freeStrokes, isBlockEnd, strokeBounds, type Block, type Id, type Rect } from '@dn/engine-core';
import { paintStrokesWorld } from './ink-layer';
import type { CanvasView } from './canvas-view';
import { drawArrowLabel, roundRect } from './draw-helpers';
import { drawArrow } from './arrow-draw';
import { arrowColor } from './theme';
import { updateBlock } from './mount';
import type { Mounted } from './types';
import { drawPaper } from './paper';
import { paintGroupShapes, quietArrow, shapeMargin } from './group-shapes';

export interface PngOptions {
  /** 이 블록들만 (없으면 전체) — 양 끝이 모두 들어간 화살표만 그린다 */
  ids?: readonly Id[];
  /** 해상도 배율 (기본 2 = 레티나) */
  scale?: number;
  /** 바깥 여백 (월드 px) */
  pad?: number;
  /** 노트 배경(점 · 괘선 · 모눈)도 그린다 (FR-041) — 기본은 단색 */
  paper?: boolean;
  /** 이 영역만 여백 없이 (표지 쪽 썸네일, 11/03) — 영역에 걸친 자유 필기도 그린다 */
  region?: Rect;
  /** 바탕색 (기본 화면 바탕) · 그림 형식 (기본 PNG) */
  bg?: string; type?: string; quality?: number;
}

const MAX_SIDE = 16384, MAX_PIXELS = 64e6;
const FONT_FALLBACK = '"Pretendard Variable", Pretendard, system-ui, "Malgun Gothic", sans-serif';

export async function exportPng(view: CanvasView, opts: PngOptions = {}): Promise<Blob | null> {
  if (view.editingId) view.endEditing();
  const blocks = (opts.ids ? opts.ids.map((id) => view.engine.getBlock(id)) : [...view.engine.blocks()])
    .filter((b): b is Block => !!b)
    .sort((a, b) => (a.z < b.z ? -1 : a.z > b.z ? 1 : a.id < b.id ? -1 : 1));
  const box = opts.region;
  const overlaps = (r: Rect) => !!box && r.x < box.x + box.w && box.x < r.x + r.w && r.y < box.y + box.h && box.y < r.y + r.h;
  const regionInk = box ? freeStrokes(view.engine).filter((s) => overlaps(strokeBounds(s))) : [];
  if (!blocks.length && !regionInk.length && !(opts.ids || box ? 0 : freeStrokes(view.engine).length)) return null;

  // 1) 무대: 100% 배율, 보이지 않게 (레이아웃 · 글꼴은 그대로)
  const stage = document.createElement('div');
  stage.className = 'dn-world dn-export-stage';
  stage.style.cssText = 'transform:none;visibility:hidden;pointer-events:none;';
  view.root.appendChild(stage);
  try {
    const els = new Map<Id, HTMLElement>();
    for (const b of blocks) {
      const el = document.createElement('div');
      el.className = 'dn-block';
      el.dataset.id = b.id;
      stage.appendChild(el);
      const m: Mounted = { el, parts: [], editor: null, editingPart: null };
      updateBlock(view, b, m);
      el.classList.remove('dn-editing');
      els.set(b.id, el);
    }
    await Promise.all([...stage.querySelectorAll('img')].map((img) => waitImage(img)));
    if (document.fonts?.ready) await document.fonts.ready;

    // 2) 영역: 블록 실제 높이(측정) 기준
    const origin = stage.getBoundingClientRect();
    const rects = new Map<Id, Rect>();
    for (const b of blocks) {
      const r = els.get(b.id)!.getBoundingClientRect();
      rects.set(b.id, { x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height });
    }
    const pad = (opts.pad ?? 32) + shapeMargin(view, new Set(blocks.map((b) => b.id))); // 축 · 타원은 상자 바깥까지
    // 전체 내보내기면 자유 잉크도 (FR-035) — 영역에 넣고 블록 위에 그린다. 블록에 묶인 잉크(FR-037)는 그 블록이 들어가면 함께
    const inBlock = (s: { parent: unknown }) => { const c = view.engine.getContent((s.parent as { contentId: Id }).contentId); return !!c && rects.has(c.blockId); };
    const ink = [...(box ? regionInk : opts.ids ? [] : freeStrokes(view.engine)), ...boundStrokesWorld(view.engine).filter(inBlock)];
    const all = [...rects.values(), ...ink.map(strokeBounds)];
    const x = Math.min(...all.map((r) => r.x)) - pad, y = Math.min(...all.map((r) => r.y)) - pad;
    const region = box ?? { x, y, w: Math.max(...all.map((r) => r.x + r.w)) + pad - x, h: Math.max(...all.map((r) => r.y + r.h)) + pad - y };
    const scale = Math.min(opts.scale ?? 2, MAX_SIDE / region.w, MAX_SIDE / region.h, Math.sqrt(MAX_PIXELS / (region.w * region.h)));

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(region.w * scale));
    canvas.height = Math.max(1, Math.round(region.h * scale));
    const ctx = canvas.getContext('2d')!;
    ctx.scale(scale, scale);
    ctx.translate(-region.x, -region.y);
    ctx.fillStyle = opts.bg ?? view.theme.bg;
    ctx.fillRect(region.x, region.y, region.w, region.h);
    if (opts.paper) drawPaper(ctx, { x: 0, y: 0, zoom: 1 }, region, view.engine.note.paper, view.theme.grid);

    // 3) 묶음 도식 모양(시간축 · 사분면 · 척도 · 벤 · 피시본) → 화살표 (블록 아래) — 양 끝이 다 들어간 것만
    const inside = new Set(blocks.map((b) => b.id));
    paintGroupShapes(ctx, view, (id) => rects.get(id) ?? null, 1, inside);
    ctx.font = `10.5px ${FONT_FALLBACK}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    const heads = new Map<string, Id | undefined>();
    // 화살표: 상자 끝은 그린 상자여야 하고, 빈 곳의 점 끝은 전체 그림이면 늘 · 영역(표지)이면 그 안일 때만 · 고른 블록 그림이면 빼고
    const inBox = (p: { x: number; y: number }) => !!box && p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h;
    for (const a of view.engine.arrows()) {
      if (![a.from, a.to].every((an) => (isBlockEnd(an) ? inside.has(an.blockId) : !opts.ids || inBox(an.point)))) continue;
      const geo = view.engine.arrowGeometry(a, (id) => rects.get(id));
      if (!geo) continue;
      const look = effectiveStyle(a), quiet = quietArrow(view, a, heads); // 모양이 보이는 화살표는 화면처럼 옅게
      if (quiet) ctx.globalAlpha = 0.25;
      drawArrow(ctx, geo.pts, arrowColor(view.theme, a, look), (1.25 * look.width) / 1.5, look);
      ctx.globalAlpha = 1;
      const chip = arrowChip(a);
      if (chip && !quiet) drawArrowLabel(ctx, chip, geo.mid, view.theme.card, view.theme.line, view.theme.muted);
    }

    // 4) 블록: 상자 → 안쪽 요소 상자(배경 · 테두리) → 목록 표시 · 체크 → 그림(SVG · 이미지) → 글자
    for (const b of blocks) await paintTree(ctx, els.get(b.id)!, origin);
    if (ink.length) paintStrokesWorld(ctx, ink, view.theme);

    return await new Promise<Blob | null>((res) => canvas.toBlob(res, opts.type ?? 'image/png', opts.quality));
  } finally {
    stage.remove();
  }
}

function waitImage(img: HTMLImageElement): Promise<void> {
  return new Promise((res) => {
    const done = () => res();
    const t = setTimeout(done, 3000);
    const check = () => {
      if (img.src && img.complete) { clearTimeout(t); void img.decode().catch(() => {}).finally(done); return true; }
      return false;
    };
    if (check()) return;
    // src는 첨부 주소가 오면 비동기로 붙는다
    const iv = setInterval(() => { if (check()) clearInterval(iv); }, 30);
    setTimeout(() => clearInterval(iv), 3000);
  });
}

const transparent = (c: string) => !c || c === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(c);

/** 요소 하나와 그 안을 그린다 (문서 순서 = 쌓임 순서로 충분 — 블록 안에서는 겹침이 거의 없다) */
async function paintTree(ctx: CanvasRenderingContext2D, root: HTMLElement, origin: DOMRect): Promise<void> {
  const rel = (r: DOMRect) => ({ x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height });
  const walk = async (el: Element): Promise<void> => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none') return; // 무대 전체가 visibility:hidden이라 그 값은 보지 않는다
    const r = rel(el.getBoundingClientRect());
    if (el instanceof HTMLElement || el instanceof SVGSVGElement) paintBox(ctx, cs, r);
    if (el.tagName === 'LI') paintMarker(ctx, el as HTMLLIElement, cs, r);
    if (el.classList.contains('dn-toggle-btn')) paintToggle(ctx, el, cs, r);
    if (el.tagName === 'HR') { ctx.fillStyle = cs.borderTopColor || '#e9e9e7'; ctx.fillRect(r.x, r.y + r.h / 2, r.w, 1); return; }
    if (el instanceof SVGSVGElement) { await paintSvg(ctx, el, r); return; }
    if (el instanceof HTMLImageElement) { if (el.complete && el.naturalWidth) ctx.drawImage(el, r.x, r.y, r.w, r.h); return; }
    for (const child of el.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) paintText(ctx, child as Text, cs, origin);
      else if (child instanceof Element) await walk(child);
    }
  };
  await walk(root);
}

function paintBox(ctx: CanvasRenderingContext2D, cs: CSSStyleDeclaration, r: { x: number; y: number; w: number; h: number }): void {
  const radius = parseFloat(cs.borderTopLeftRadius) || 0;
  if (!transparent(cs.backgroundColor)) {
    ctx.fillStyle = cs.backgroundColor;
    roundRect(ctx, r.x, r.y, r.w, r.h, Math.min(radius, r.h / 2));
    ctx.fill();
  }
  const sides: [string, string, number, number, number, number][] = [
    ['Top', cs.borderTopColor, r.x, r.y, r.w, parseFloat(cs.borderTopWidth)],
    ['Bottom', cs.borderBottomColor, r.x, r.y + r.h - parseFloat(cs.borderBottomWidth), r.w, parseFloat(cs.borderBottomWidth)],
    ['Left', cs.borderLeftColor, r.x, r.y, parseFloat(cs.borderLeftWidth), r.h],
    ['Right', cs.borderRightColor, r.x + r.w - parseFloat(cs.borderRightWidth), r.y, parseFloat(cs.borderRightWidth), r.h],
  ];
  const uniform = sides.every((s) => s[1] === sides[0]![1]) && ['Top', 'Bottom', 'Left', 'Right'].every((k) => cs.getPropertyValue(`border-${k.toLowerCase()}-width`) === cs.borderTopWidth);
  if (uniform && parseFloat(cs.borderTopWidth) > 0 && !transparent(cs.borderTopColor) && cs.borderTopStyle !== 'none') {
    const w = parseFloat(cs.borderTopWidth);
    ctx.strokeStyle = cs.borderTopColor;
    ctx.lineWidth = w;
    roundRect(ctx, r.x + w / 2, r.y + w / 2, r.w - w, r.h - w, Math.max(0, Math.min(radius, r.h / 2) - w / 2));
    ctx.stroke();
    return;
  }
  for (const [side, color, x, y, w, h] of sides) {
    if (!(w > 0 && h > 0) || transparent(color) || cs.getPropertyValue(`border-${side.toLowerCase()}-style`) === 'none') continue;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  }
}

/** 목록 표시(•, 1.)와 할 일 상자 — 가상 요소라 DOM 글자가 아니다 */
function paintMarker(ctx: CanvasRenderingContext2D, li: HTMLLIElement, cs: CSSStyleDeclaration, r: { x: number; y: number; w: number; h: number }): void {
  const fontPx = parseFloat(cs.fontSize) || 13;
  const lineH = parseFloat(cs.lineHeight) || fontPx * 1.5;
  const midY = r.y + Math.min(lineH, r.h) / 2;
  ctx.fillStyle = cs.color;
  if (li.dataset.checked !== undefined) {
    const s = Math.round(fontPx * 1.05), x = r.x + 1, y = midY - s / 2;
    const on = li.dataset.checked === 'true';
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = on ? '#4c6ef5' : '#b4b4b0';
    ctx.fillStyle = on ? '#4c6ef5' : '#fff';
    roundRect(ctx, x, y, s, s, 3);
    ctx.fill();
    ctx.stroke();
    if (on) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(x + s * 0.25, y + s * 0.52); ctx.lineTo(x + s * 0.43, y + s * 0.7); ctx.lineTo(x + s * 0.76, y + s * 0.32);
      ctx.stroke();
    }
    return;
  }
  const list = li.parentElement;
  ctx.font = `${cs.fontWeight} ${fontPx}px ${cs.fontFamily || FONT_FALLBACK}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  if (list?.tagName === 'OL') {
    const start = Number(list.getAttribute('start') ?? 1);
    ctx.fillText(`${start + [...list.children].indexOf(li)}.`, r.x - 6, midY);
  } else if (list?.tagName === 'UL') {
    ctx.fillText('•', r.x - 7, midY);
  }
  ctx.textAlign = 'left';
}

function paintToggle(ctx: CanvasRenderingContext2D, el: Element, cs: CSSStyleDeclaration, r: { x: number; y: number; w: number; h: number }): void {
  const open = el.parentElement?.dataset.open !== 'false';
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2, s = Math.min(r.w, r.h) * 0.28 || 4;
  ctx.fillStyle = cs.color || '#73726e';
  ctx.beginPath();
  if (open) { ctx.moveTo(cx - s, cy - s * 0.6); ctx.lineTo(cx + s, cy - s * 0.6); ctx.lineTo(cx, cy + s * 0.8); }
  else { ctx.moveTo(cx - s * 0.6, cy - s); ctx.lineTo(cx + s * 0.8, cy); ctx.lineTo(cx - s * 0.6, cy + s); }
  ctx.closePath();
  ctx.fill();
}

/** 글자: 줄마다 끊어 화면과 같은 자리에 (같은 줄의 연속 글자를 한 번에) */
function paintText(ctx: CanvasRenderingContext2D, node: Text, cs: CSSStyleDeclaration, origin: DOMRect): void {
  const text = node.data;
  if (!text.trim()) return;
  ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily || FONT_FALLBACK}`;
  ctx.fillStyle = cs.color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const deco = cs.textDecorationLine;
  const range = document.createRange();
  let start = 0, lineTop = NaN, left = 0, mid = 0, right = 0;
  const flush = (end: number) => {
    if (end <= start) return;
    const s = text.slice(start, end).replace(/\s+$/, '');
    if (s) {
      ctx.fillText(s, left, mid);
      if (deco.includes('line-through') || deco.includes('underline')) {
        const w = Math.min(ctx.measureText(s).width, right - left);
        ctx.fillRect(left, deco.includes('underline') ? mid + parseFloat(cs.fontSize) * 0.55 : mid, w, 1);
      }
    }
  };
  for (let i = 0; i < text.length; i++) {
    range.setStart(node, i);
    range.setEnd(node, i + 1);
    const r = range.getClientRects()[0];
    if (!r) continue;
    const top = Math.round(r.top);
    if (top !== lineTop) {
      flush(i);
      start = i;
      lineTop = top;
      left = r.left - origin.left;
      mid = r.top - origin.top + r.height / 2;
    }
    right = r.right - origin.left;
  }
  flush(text.length);
}

/** SVG(그래프 · 아이콘): 계산된 색 · 선 · 글꼴을 속성으로 옮긴 사본을 이미지로 그린다 */
async function paintSvg(ctx: CanvasRenderingContext2D, svg: SVGSVGElement, r: { x: number; y: number; w: number; h: number }): Promise<void> {
  if (r.w < 1 || r.h < 1) return;
  const copy = svg.cloneNode(true) as SVGSVGElement;
  const src = [svg, ...svg.querySelectorAll('*')];
  const dst = [copy, ...copy.querySelectorAll('*')];
  src.forEach((el, i) => {
    const cs = getComputedStyle(el);
    const d = dst[i]!;
    for (const p of ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'opacity', 'font-size', 'font-weight', 'font-family', 'text-anchor']) {
      const v = cs.getPropertyValue(p);
      if (v) d.setAttribute(p, v);
    }
    d.removeAttribute('class');
  });
  copy.setAttribute('width', String(r.w));
  copy.setAttribute('height', String(r.h));
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(copy))}`;
  const img = new Image();
  img.src = url;
  await img.decode().catch(() => {});
  if (img.complete && img.naturalWidth) ctx.drawImage(img, r.x, r.y, r.w, r.h);
}
