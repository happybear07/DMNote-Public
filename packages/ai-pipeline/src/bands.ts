// 묶음 띠 (계층형 + 묶음, STRUCTURE-GUIDE 4.7 · S-40 · S-45 "층 묶음"): 계층형으로 놓은 뒤 묶음(절 · 경로) 테두리가
// 서로 겹치거나 남의 상자를 감싸면, 층(열)은 그대로 두고 묶음마다 띠 하나에 모은다 — 왼→오 흐름이면 가로 띠, 위→아래면 세로 띠.
// 묶음에 안 든 상자(뿌리 원인 등)는 맨 앞 띠. 띠 사이는 테두리 · 이름 자리만큼 띄운다.
import type { Vec2 } from '@dn/engine-core';
import type { LayoutNode } from './layout';

export interface BandGroup { readonly key: string; /** 앱 묶음이 되는 맨 바깥 묶음 (안쪽 묶음은 바깥 띠에) */ readonly band?: string; readonly members: readonly string[] }

const LAYER_GAP = 96, GAP = 32, BAND_GAP = 72;

/** 묶음 테두리(구성원 둘 이상의 외곽)끼리 겹치거나, 테두리가 구성원 아닌 상자의 가운데를 감싸면 true */
export function framesClash(pos: ReadonlyMap<string, Vec2>, nodes: readonly LayoutNode[], groups: readonly BandGroup[]): boolean {
  const size = new Map(nodes.map((n) => [n.id, n]));
  const frames = [...new Map(groups.map((g) => [g.band ?? g.key, [] as string[]])).keys()].map((k) => {
    const ms = groups.filter((g) => (g.band ?? g.key) === k).flatMap((g) => g.members).filter((m) => pos.has(m) && size.has(m));
    if (ms.length < 2) return null;
    const r = ms.map((m) => ({ ...pos.get(m)!, w: size.get(m)!.w, h: size.get(m)!.h }));
    return { ms: new Set(ms), x0: Math.min(...r.map((q) => q.x)), y0: Math.min(...r.map((q) => q.y)), x1: Math.max(...r.map((q) => q.x + q.w)), y1: Math.max(...r.map((q) => q.y + q.h)) };
  }).filter((f): f is NonNullable<typeof f> => !!f);
  for (let i = 0; i < frames.length; i++) for (let j = i + 1; j < frames.length; j++) {
    const a = frames[i]!, b = frames[j]!;
    if (a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1) return true;
  }
  return frames.some((f) => nodes.some((n) => {
    if (f.ms.has(n.id) || !pos.has(n.id)) return false;
    const p = pos.get(n.id)!, cx = p.x + n.w / 2, cy = p.y + n.h / 2;
    return cx > f.x0 && cx < f.x1 && cy > f.y0 && cy < f.y1;
  }));
}

/** 층(열) 번호는 계층형 결과에서, 띠는 묶음에서. linked = 화살표로 이어진 상자(층 좌표의 기준) */
export function bands(pos: ReadonlyMap<string, Vec2>, nodes: readonly LayoutNode[], groups: readonly BandGroup[], linked: ReadonlySet<string>, lr: boolean): Map<string, Vec2> {
  const size = new Map(nodes.map((n) => [n.id, n]));
  const along = (id: string) => (lr ? pos.get(id)!.x : pos.get(id)!.y), across = (id: string) => (lr ? pos.get(id)!.y : pos.get(id)!.x);
  const aSize = (id: string) => (lr ? size.get(id)!.w : size.get(id)!.h), cSize = (id: string) => (lr ? size.get(id)!.h : size.get(id)!.w);
  const layers = [...new Set(nodes.filter((n) => linked.has(n.id)).map((n) => along(n.id)))].sort((a, b) => a - b);
  const colOf = (id: string) => { const v = along(id); let c = 0; layers.forEach((x, i) => { if (x <= v) c = i; }); return c; };
  const bandOf = (id: string) => { const g = groups.find((x) => x.members.includes(id)); return g ? g.band ?? g.key : ''; };
  const order = ['', ...groups.map((g) => g.band ?? g.key)].filter((b, i, a) => a.indexOf(b) === i && nodes.some((n) => bandOf(n.id) === b));
  const cells = new Map<string, string[]>();
  for (const n of [...nodes].sort((a, b) => across(a.id) - across(b.id))) {
    const k = `${bandOf(n.id)}\u0000${colOf(n.id)}`;
    cells.set(k, [...(cells.get(k) ?? []), n.id]);
  }
  const cols = Math.max(1, layers.length);
  const colThick = Array.from({ length: cols }, (_, c) => Math.max(0, ...nodes.filter((n) => colOf(n.id) === c).map((n) => aSize(n.id))));
  const colPos = colThick.map((_, c) => colThick.slice(0, c).reduce((s, t) => s + t + LAYER_GAP, 0));
  const stack = (ids: readonly string[]) => ids.reduce((s, id) => s + cSize(id), 0) + Math.max(0, ids.length - 1) * GAP;
  const bandThick = order.map((b) => Math.max(0, ...Array.from({ length: cols }, (_, c) => stack(cells.get(`${b}\u0000${c}`) ?? []))));
  const bandPos = bandThick.map((_, i) => bandThick.slice(0, i).reduce((s, t) => s + t + BAND_GAP, 0));
  const out = new Map<string, Vec2>();
  order.forEach((b, bi) => {
    for (let c = 0; c < cols; c++) {
      let off = bandPos[bi]!;
      for (const id of cells.get(`${b}\u0000${c}`) ?? []) {
        out.set(id, lr ? { x: colPos[c]!, y: off } : { x: off, y: colPos[c]! });
        off += cSize(id) + GAP;
      }
    }
  });
  return out;
}
