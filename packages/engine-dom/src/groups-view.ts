// 블록(콘텐츠 묶음) 화면 (engine-core groups.ts): 상자를 누르면 그 상자 하나, 이름표 · 테두리 선을 누르면 묶음째(10/29 — 안쪽 빈 곳은
// 끌어서 그 콘텐츠들 고르기), 묶음 테두리 · 이름표,
// 모서리 손잡이로 묶음 전체를 같은 배율로 키우기 · 줄이기, 묶기 · 풀기, 블록으로 이동.
import {
  fitRect, GROUP_KIND_LABEL, groupBlocks, groupMembers, groupName, groupOf, noteGroups, scaleBlocks, ungroupBlocks, unionRects,
  type Id, type Rect, type Vec2,
} from '@dn/engine-core';
import type { CanvasView } from './canvas-view';
import { HANDLE } from './constants';
import { roundRect } from './draw-helpers';
import { clampResize } from './sheet-view';
import { cardHeadRect, cardScreenFrame } from './card-view';

/** 묶음 테두리를 상자들 바깥으로 띄우는 거리 (화면 px) */
const PAD = 8;
/** 마지막으로 그린 이름표 자리 (화면 px) — 누르기 판정용 */
const tags = new WeakMap<CanvasView, Map<Id, Rect>>();
/** 마우스가 든 묶음 (테두리 안 · 이름표 줄) — 숨은 이름표를 보이게 (DS-022) */
const zone = new WeakMap<CanvasView, Id | null>();

/** 마우스가 묶음 테두리 안이나 그 위 이름표 줄에 들어오거나 나가면 true — 다시 그려 이름표를 보이거나 숨긴다 (DS-022).
 *  상자에서 이름표 쪽으로 옮기는 사이 이름표가 사라지지 않게. 화면 밖(s = null)이면 비운다 */
export function trackGroupZone(view: CanvasView, s: Vec2 | null): boolean {
  let hit: { gid: Id; area: number } | null = null;
  if (s) for (const [gid, ids] of groupMembers(view.engine)) {
    const u = unionRects(ids.map((id) => view.engine.blockRect(id)).filter((r): r is Rect => !!r));
    if (!u) continue;
    const r = frameOf(view, gid, u);
    const inBox = s.x >= r.x - 5 && s.x <= r.x + r.w + 5 && s.y >= r.y - 5 && s.y <= r.y + r.h + 5;
    const onTag = s.x >= r.x && s.x <= r.x + 232 && s.y >= r.y - 44 && s.y < r.y;
    if ((inBox || onTag) && (!hit || r.w * r.h < hit.area)) hit = { gid, area: r.w * r.h };
  }
  const id = hit?.gid ?? null;
  if (id === (zone.get(view) ?? null)) return false;
  zone.set(view, id);
  return true;
}

/** 이 상자들 + 그 상자들이 든 묶음 전체 */
export function expandToGroups(view: CanvasView, ids: Iterable<Id>): Id[] {
  const out = new Set<Id>();
  for (const id of ids) for (const x of groupOf(view.engine, id)?.ids ?? [id]) out.add(x);
  return [...out];
}

/** 묶음째 잡는 자리: 이름표 · 테두리 선 (상자보다 먼저), 상자 · 화살표가 없는 테두리 안 빈 곳 (onItem이면 빼고). 맞으면 그 묶음 상자들.
 *  누르기 · 끌기는 onItem = true로 이름표 · 테두리 선만(10/29), 오른쪽 클릭 메뉴는 안쪽 빈 곳도 (알파 C-04) */
export function hitGroup(view: CanvasView, s: Vec2, onItem: boolean): Id[] | null {
  const members = groupMembers(view.engine);
  if (!members.size) return null;
  const inside = (r: Rect, m: number) => s.x >= r.x - m && s.x <= r.x + r.w + m && s.y >= r.y - m && s.y <= r.y + r.h + m;
  let best: { ids: Id[]; area: number } | null = null;
  for (const [gid, ids] of members) {
    const tag = tags.get(view)?.get(gid);
    if (tag && inside(tag, 0)) return ids;
    const u = unionRects(ids.map((id) => view.engine.blockRect(id)).filter((r): r is Rect => !!r));
    if (!u) continue;
    const r = frameOf(view, gid, u);
    if (!inside(r, 5)) continue;
    const edge = !inside({ x: r.x + 5, y: r.y + 5, w: r.w - 10, h: r.h - 10 }, 0);
    // 묶음이 겹치면 작은 쪽 (안쪽에 있는 묶음)
    if ((edge || !onItem) && (!best || r.w * r.h < best.area)) best = { ids, area: r.w * r.h };
  }
  return best?.ids ?? null;
}

/** s(화면 px)를 테두리 안에 둔 가장 안쪽 묶음의 상자들 — 묶음 안 빈 곳에서 끌면 그 콘텐츠들을 하나씩 고른다 (10/29) */
export function groupAround(view: CanvasView, s: Vec2): Id[] | null {
  let best: { ids: Id[]; area: number } | null = null;
  for (const [gid, ids] of groupMembers(view.engine)) {
    const u = unionRects(ids.map((id) => view.engine.blockRect(id)).filter((r): r is Rect => !!r));
    if (!u) continue;
    const r = frameOf(view, gid, u);
    if (s.x >= r.x && s.x <= r.x + r.w && s.y >= r.y && s.y <= r.y + r.h && (!best || r.w * r.h < best.area)) best = { ids, area: r.w * r.h };
  }
  return best?.ids ?? null;
}

/** 고른 것이 묶음 하나와 정확히 같으면 그 묶음 */
export function selectedGroup(view: CanvasView): { id: Id; ids: Id[]; rect: Rect } | null {
  const sel = [...view.selBlocks];
  if (sel.length < 2) return null;
  const g = groupOf(view.engine, sel[0]!);
  if (!g || g.ids.length !== sel.length || !g.ids.every((id) => view.selBlocks.has(id))) return null;
  const rect = unionRects(g.ids.map((id) => view.previewRect(id) ?? view.engine.blockRect(id)).filter((r): r is Rect => !!r));
  return rect ? { id: g.id, ids: g.ids, rect } : null;
}

/** 묶음 테두리 사각형 (화면 px, 바깥으로 PAD) */
function screenRect(view: CanvasView, r: Rect): Rect {
  const a = view.toScreen(r), z = view.cam.zoom;
  return { x: a.x - PAD, y: a.y - PAD, w: r.w * z + 2 * PAD, h: r.h * z + 2 * PAD };
}

/** 묶음 틀 (화면 px) — 카드면 카드 틀(머리 · 여백), 아니면 테두리 */
function frameOf(view: CanvasView, gid: Id, u: Rect): Rect {
  return cardScreenFrame(view, gid, u) ?? screenRect(view, u);
}

/** 고른 묶음의 모서리 손잡이를 눌렀나 — 맞으면 묶음 크기 조절 시작 */
export function startGroupScale(view: CanvasView, s: Vec2): boolean {
  const g = selectedGroup(view);
  if (!g || view.editingId) return false;
  const r = frameOf(view, g.id, g.rect);
  const corners: [Vec2, Vec2][] = [
    [{ x: r.x, y: r.y }, { x: g.rect.x + g.rect.w, y: g.rect.y + g.rect.h }], [{ x: r.x + r.w, y: r.y }, { x: g.rect.x, y: g.rect.y + g.rect.h }],
    [{ x: r.x, y: r.y + r.h }, { x: g.rect.x + g.rect.w, y: g.rect.y }], [{ x: r.x + r.w, y: r.y + r.h }, { x: g.rect.x, y: g.rect.y }],
  ];
  for (const [p, anchor] of corners) {
    if (Math.abs(p.x - s.x) <= HANDLE + 3 && Math.abs(p.y - s.y) <= HANDLE + 3) {
      view.gesture = { k: 'gscale', ids: g.ids, start: g.rect, anchor, f: 1 };
      return true;
    }
  }
  return false;
}

/** 크기 조절 중: 고정점에서 포인터까지 → 같은 배율 (용지면 종이 폭 안) */
export function moveGroupScale(view: CanvasView, w: Vec2): void {
  const g = view.gesture;
  if (g.k !== 'gscale') return;
  const s = g.start, a = g.anchor;
  let f = Math.max(Math.abs(w.x - a.x) / Math.max(1, s.w), Math.abs(w.y - a.y) / Math.max(1, s.h));
  f = Math.max(0.2, Math.min(5, f));
  const left = a.x > s.x + s.w / 2 ? a.x - s.w * f : a.x;
  const top = a.y > s.y + s.h / 2 ? a.y - s.h * f : a.y;
  const c = clampResize(view, { x: left, y: top, w: s.w * f, h: s.h * f });
  if (c.w < s.w * f - 0.5) f = c.w / s.w;
  g.f = f;
}

/** 크기 조절 미리보기 · 끌기 · 상자 크기 조절 중 상자 자리 (화살표 · 묶인 필기가 따라간다) */
export function previewRectOf(view: CanvasView, id: Id): Rect | undefined {
  const g = view.gesture;
  if (g.k === 'drag' && g.moved && g.ids.includes(id)) {
    const b = view.engine.getBlock(id);
    if (b) return { x: b.x + g.delta.x, y: b.y + g.delta.y, w: b.w, h: b.h };
  }
  if (g.k === 'resize' && g.id === id) {
    const b = view.engine.getBlock(id);
    return b ? { ...g.rect, h: Math.max(g.rect.h, b.h) } : g.rect;
  }
  if (g.k === 'gscale' && g.ids.includes(id)) {
    const b = view.engine.getBlock(id);
    if (b) return { x: g.anchor.x + (b.x - g.anchor.x) * g.f, y: g.anchor.y + (b.y - g.anchor.y) * g.f, w: b.w * g.f, h: b.h * g.f };
  }
  return undefined;
}

/** 크기 조절 미리보기: 상자 DOM에 이동 + 배율 (글자까지 같이 커 보이게) */
export function styleGroupScale(view: CanvasView, id: Id, el: HTMLElement): boolean {
  const g = view.gesture;
  if (g.k !== 'gscale' || !g.ids.includes(id)) { if (el.style.transformOrigin) el.style.transformOrigin = ''; return false; }
  const b = view.engine.getBlock(id);
  if (!b) return false;
  const r = previewRectOf(view, id)!;
  el.style.transformOrigin = '0 0';
  el.style.transform = `translate(${r.x - b.x}px, ${r.y - b.y}px) scale(${g.f})`;
  return true;
}

export function endGroupScale(view: CanvasView, g: { ids: Id[]; anchor: Vec2; f: number }): void {
  if (Math.abs(g.f - 1) > 1e-3) scaleBlocks(view.engine, g.ids, g.anchor, g.f);
}

/** 오른쪽 중괄호 } — x: 왼쪽 끝, y · h: 위 · 높이 (화면 px). 꼭짓점은 가운데 오른쪽 (x + 12) */
function drawBrace(ctx: CanvasRenderingContext2D, x: number, y: number, h: number): void {
  const w = 6, m = y + h / 2, r = Math.min(8, h / 4);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, m - r);
  ctx.quadraticCurveTo(x + w, m, x + 2 * w, m);
  ctx.quadraticCurveTo(x + w, m, x + w, m + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x, y + h);
  ctx.stroke();
}

/** 화면 사각형 r(이름표)이 이 묶음 밖 상자를 덮나 */
function coversOther(view: CanvasView, r: Rect, ids: readonly Id[]): boolean {
  const z = view.cam.zoom, x = view.cam.x + r.x / z, y = view.cam.y + r.y / z;
  return view.engine.queryBlocks({ x, y, w: r.w / z, h: r.h / z }).some((id) => !ids.includes(id));
}

/** 묶음 테두리 · 이름표 (모든 묶음), 고른 묶음은 진하게 + 모서리 손잡이 */
export function drawGroups(view: CanvasView, ctx: CanvasRenderingContext2D): void {
  const members = groupMembers(view.engine);
  if (!members.size) return;
  const sel = selectedGroup(view);
  const tagAt = new Map<Id, Rect>();
  tags.set(view, tagAt);
  ctx.save();
  ctx.font = '600 11px Pretendard, system-ui, sans-serif';
  ctx.textBaseline = 'bottom';
  for (const [gid, ids] of members) {
    const u = unionRects(ids.map((id) => view.previewRect(id) ?? view.engine.blockRect(id)).filter((r): r is Rect => !!r));
    if (!u) continue;
    const r = frameOf(view, gid, u);
    if (r.x > view.size.w || r.y > view.size.h || r.x + r.w < 0 || r.y + r.h < 0) continue;
    const on = sel?.id === gid;
    const meta = view.engine.note.groups?.[gid];
    const bracket = meta?.bracket ?? 'box';
    // 카드: 바탕 · 머리는 밑층(card-view.ts)이 그렸다 — 여기서는 머리 자리를 누르기 판정에 두고, 고른 카드만 강조 테두리 · 손잡이
    if (bracket === 'card') {
      tagAt.set(gid, cardHeadRect(view, r));
      if (!on) continue;
      ctx.setLineDash([]); ctx.lineWidth = 2; ctx.strokeStyle = view.theme.accent;
      roundRect(ctx, r.x, r.y, r.w, r.h, 12 * view.cam.zoom); ctx.stroke();
      if (!view.editingId) drawHandles(view, ctx, r);
      continue;
    }
    ctx.setLineDash(on ? [] : [5, 4]);
    ctx.lineWidth = on ? 2 : 1;
    // 고르지 않은 묶음 점선은 옅게 (DS-022) — 상자 테두리보다 눈에 덜 띄게
    ctx.strokeStyle = on ? view.theme.accent : view.theme.muted;
    ctx.globalAlpha = on ? 1 : 0.35;
    // 테두리 모양 (v6): 상자(기본) · 중괄호(여럿을 하나로 묶어 한 관계 — 오른쪽 } ) · 없음. 고른 묶음은 늘 상자로 보인다
    if (on || bracket === 'box') { roundRect(ctx, r.x, r.y, r.w, r.h, 10); ctx.stroke(); }
    if (bracket === 'brace') { ctx.globalAlpha = 1; ctx.setLineDash([]); ctx.lineWidth = 1.5; ctx.strokeStyle = on ? view.theme.accent : view.theme.muted; drawBrace(ctx, r.x + r.w + 2, r.y, r.h); }
    ctx.globalAlpha = 1;
    // 이름표: 이름 · 종류를 붙인 묶음만 늘, 나머지는 고르거나 마우스를 올릴 때만 (DS-022 · U-3 A — 사이드바에 블록 목록이 있다)
    // 상자 위면 그 상자가 이 묶음 것인지, 빈 곳이면 테두리 안 · 이름표 줄인지 (다른 상자를 덮는 이름표는 그 상자 위에서 숨은 채)
    const hovered = view.hover ? ids.includes(view.hover) : zone.get(view) === gid;
    if (view.cam.zoom >= 0.35 && (on || hovered || meta?.name?.trim() || meta?.kind)) {
      // 이름을 붙이지 않은 블록은 '블록'만 — 첫 제목을 쓰면 바로 아래 상자 제목과 같은 글이 두 번 겹쳐 보인다 (사이드바 목록은 첫 제목)
      const base = meta?.name?.trim() ? groupName(view.engine, gid, ids) : '블록';
      const name = meta?.kind ? `${GROUP_KIND_LABEL[meta.kind as keyof typeof GROUP_KIND_LABEL] ?? meta.kind} · ${base}` : base;
      const tw = Math.min(ctx.measureText(name).width, 220) + 12;
      // 맨 위 상자에 노드 종류 태그(v6, 상자 위 19px)가 있으면 이름표를 그만큼 올린다 — 겹치지 않게
      const lift = ids.some((id) => { const x = view.engine.getBlock(id); return !!x && !!(x.nodeKind || x.role || x.speaker || x.time || x.owner || x.due || x.start || x.end) && Math.abs(x.y - u.y) < 2; }) ? 19 * view.cam.zoom : 0;
      const tag = { x: r.x, y: r.y - 20 - lift, w: tw, h: 18 };
      // 이름표가 위쪽 다른 상자를 덮으면 평소에는 숨긴다 — 고르거나 마우스를 올린 블록만 (작게 볼수록 이름표가 상자를 가린다)
      if (!on && !hovered && coversOther(view, tag, ids)) continue;
      tagAt.set(gid, tag);
      ctx.save();
      ctx.translate(0, -lift);
      ctx.fillStyle = on ? view.theme.accent : view.theme.card;
      roundRect(ctx, r.x, r.y - 20, tw, 18, 5);
      ctx.fill();
      if (!on) { ctx.setLineDash([]); ctx.lineWidth = 1; ctx.strokeStyle = view.theme.line; ctx.stroke(); }
      ctx.fillStyle = on ? '#fff' : view.theme.muted;
      ctx.save();
      ctx.beginPath(); ctx.rect(r.x, r.y - 22, tw - 4, 22); ctx.clip();
      ctx.fillText(name, r.x + 6, r.y - 5);
      ctx.restore();
      ctx.restore();
    }
    if (on && !view.editingId) drawHandles(view, ctx, r);
  }
  ctx.restore();
}

/** 고른 묶음의 모서리 손잡이 넷 */
function drawHandles(view: CanvasView, ctx: CanvasRenderingContext2D, r: Rect): void {
  ctx.setLineDash([]);
  for (const p of [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x, y: r.y + r.h }, { x: r.x + r.w, y: r.y + r.h }]) {
    ctx.fillStyle = view.theme.card;
    ctx.fillRect(p.x - HANDLE / 2, p.y - HANDLE / 2, HANDLE, HANDLE);
    ctx.lineWidth = 1;
    ctx.strokeStyle = view.theme.accent;
    ctx.strokeRect(p.x - HANDLE / 2 + 0.5, p.y - HANDLE / 2 + 0.5, HANDLE - 1, HANDLE - 1);
  }
}

/** 고른 상자들을 한 블록으로 묶기 (둘 이상) */
export function groupSelection(view: CanvasView, name?: string): Id | null {
  const ids = [...view.selBlocks];
  if (ids.length < 2) return null;
  const r = groupBlocks(view.engine, ids, name);
  if (!r.ok || !r.value) return null;
  view.select(expandToGroups(view, ids));
  return r.value;
}

/** 고른 상자들이 든 묶음 풀기 */
export function ungroupSelection(view: CanvasView): boolean {
  const ids = [...view.selBlocks];
  if (!ids.some((id) => groupOf(view.engine, id))) return false;
  return ungroupBlocks(view.engine, ids).ok;
}


/** 블록으로 이동: 묶음 전체가 화면에 들어오게 · 그 묶음을 고른다 */
export function focusGroup(view: CanvasView, gid: Id): void {
  const g = noteGroups(view.engine).find((x) => x.id === gid);
  if (!g) return;
  const pad = 60;
  const c = fitRect({ x: g.rect.x - pad, y: g.rect.y - pad, w: g.rect.w + 2 * pad, h: g.rect.h + 2 * pad }, view.size);
  view.animateTo({ ...c, zoom: Math.min(c.zoom, 1.2) });
  view.select(g.ids);
}
