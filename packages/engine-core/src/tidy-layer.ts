// 배치 다듬기의 한 덩어리(화살표로 이어진 상자들) 놓기 (tidy.ts): 층은 상자 자리가 아니라 화살표가 정한다 — 화살표를 따라 몇 단계째인지
// (가장 긴 길)가 층(a → b면 b가 뒤 층 — 관계 뜻으로 뒤집을 것은 tidy.ts가 a · b를 바꿔 넘긴다), 층 안 차례는 앞 층 이웃의 차례를 따르고
// (자식은 부모 밑에) 같으면 지금 자리 순서. 그래서 상자를 옮기고 다시 다듬어도 결과가 같다. 흐름 방향(위→아래 · 왼→오)은 화살표가 고르게 가는 쪽.
// byPosition(AI 프리셋 배치를 다듬을 때): 이어진 두 상자 중 흐름 축에서 완전히 앞에 놓인 쪽을 앞 층으로 — 프리셋이 정한 위아래를 지킨다.
// 좌표는 층 사이 · 층 안 간격을 고르게(화살표 라벨이 들어갈 만큼) 하고 이어진 상자끼리 중심을 맞춘다 — 좌표는 덩어리 왼쪽 위 (0,0) 기준.
import type { Vec2 } from './geom';

/** 바깥 사각형 (상자 위 이름표 · 묶음 테두리까지 넣은 것) */
export interface LayerItem { readonly id: string; readonly x: number; readonly y: number; readonly w: number; readonly h: number }
/** label: 라벨 폭(px). 없으면 라벨 없는 화살표. soft: 곁에 두기만 하는 가상 연결 — 층을 정할 때 세지 않고 같은 층 곁에 둔다 */
export interface LayerEdge { readonly a: string; readonly b: string; readonly label?: number; readonly soft?: boolean }
/** pos: 덩어리 안 자리 · lr: 왼→오 흐름(아니면 위→아래) · root: 첫 층 첫 상자 (덩어리를 제자리에 둘 기준) */
export interface LayerResult { readonly pos: Map<string, Vec2>; readonly lr: boolean; readonly root: string }

/** 층 사이 · 층 안 기본 간격, 라벨 양옆 여백, 라벨 높이 */
export const GAP_ALONG = 64, GAP_ACROSS = 40, LABEL_PAD = 20, LABEL_H = 20;
const ROUNDS = 60, MOVE_EPS = 8;

export function layerLayout(items: readonly LayerItem[], edges: readonly LayerEdge[], byPosition = false): LayerResult {
  const by = new Map(items.map((it) => [it.id, it]));
  const es = edges.filter((e) => e.a !== e.b && by.has(e.a) && by.has(e.b));
  const lay = (lr: boolean) => { const cut = cutOf(items, es, lr, byPosition); return { cut, pos: place(items, es, cut, lr), lr }; };
  const h = lay(true), v = lay(false);
  // 이미 한쪽으로 다듬어진 배치면 그 방향 그대로 — 다시 다듬을 때 방향이 바뀌지 않게
  const mh = moved(items, h.pos), mv = moved(items, v.pos);
  const pick = mh <= 2 && mh <= mv ? h : mv <= 2 ? v : lrFirst(items, es) ? h : v;
  return { pos: pick.pos, lr: pick.lr, root: pick.cut.l[0]![0]!.id };
}

/**
 * 흐름 방향: 화살표(층 차례 a → b)가 한쪽(아래든 위든)으로 고르게 가는 수 · 옆으로 고르게 가는 수 — 많은 쪽. 같으면 화살표가
 * 더 뻗은 쪽, 그래도 같으면 위→아래. 부채꼴로 퍼진 트리는 자식이 양옆으로 갈라져 옆 수가 서로 지워지니 위→아래로 읽힌다
 */
function lrFirst(items: readonly LayerItem[], es: readonly LayerEdge[]): boolean {
  const by = new Map(items.map((it) => [it.id, it]));
  let down = 0, right = 0, dySum = 0, dxSum = 0;
  for (const e of es) {
    if (e.soft) continue;
    const p = by.get(e.a)!, q = by.get(e.b)!;
    const dx = q.x + q.w / 2 - p.x - p.w / 2, dy = q.y + q.h / 2 - p.y - p.h / 2;
    down += Math.abs(dy) > MOVE_EPS ? Math.sign(dy) : 0;
    right += Math.abs(dx) > MOVE_EPS ? Math.sign(dx) : 0;
    dySum += Math.abs(dy); dxSum += Math.abs(dx);
  }
  return Math.abs(right) !== Math.abs(down) ? Math.abs(right) > Math.abs(down) : dxSum > dySum;
}

/** 지금 자리(왼쪽 위를 0으로 맞춘 것)에서 얼마나 움직이나 */
function moved(items: readonly LayerItem[], pos: ReadonlyMap<string, Vec2>): number {
  const x0 = Math.min(...items.map((it) => it.x)), y0 = Math.min(...items.map((it) => it.y));
  const px = Math.min(...[...pos.values()].map((p) => p.x)), py = Math.min(...[...pos.values()].map((p) => p.y));
  return items.reduce((t, it) => { const p = pos.get(it.id)!; return t + Math.abs(p.x - px - (it.x - x0)) + Math.abs(p.y - py - (it.y - y0)); }, 0);
}

interface Cut { readonly l: LayerItem[][]; readonly of: Map<string, number>; readonly gaps: number[] }

/**
 * 층: 화살표를 따라 가장 긴 길의 단계 수. 고리는 자리와 무관한 차례로 훑어 처음 되돌아가는 화살표만 빼고 센다.
 * 곁 연결(soft)만 있는 상자는 붙은 상자와 같은 층. 층 안 차례: 첫 층은 지금 자리 순서, 다음 층부터는 앞 층 이웃 차례의 평균(같으면 지금 자리)
 */
function cutOf(items: readonly LayerItem[], es: readonly LayerEdge[], lr: boolean, byPosition: boolean): Cut {
  const along = (it: LayerItem) => (lr ? it.x + it.w / 2 : it.y + it.h / 2), across = (it: LayerItem) => (lr ? it.y + it.h / 2 : it.x + it.w / 2);
  const read = [...items].sort((p, q) => along(p) - along(q) || across(p) - across(q) || (p.id < q.id ? -1 : 1));
  const hard = es.filter((e) => !e.soft);
  // a → b면 b가 뒤 층. byPosition이면 b가 흐름 축에서 a보다 완전히 앞(겹치지 않게)에 놓였을 때만 b가 앞 층(프리셋의 위아래)
  const byId = new Map(items.map((it) => [it.id, it]));
  const out = new Map(items.map((it) => [it.id, [] as string[]]));
  for (const e of hard) {
    const p = byId.get(e.a)!, q = byId.get(e.b)!;
    const before = byPosition && (lr ? q.x + q.w <= p.x + MOVE_EPS : q.y + q.h <= p.y + MOVE_EPS);
    if (before) out.get(e.b)!.push(e.a); else out.get(e.a)!.push(e.b);
  }
  for (const ws of out.values()) ws.sort();
  // 고리 끊기: 깊이 우선으로 훑으며 지금 길 위로 되돌아가는 화살표는 뺀다. 훑는 차례는 자리와 무관하게(들어오는 화살표 없는 상자 먼저,
  // 그다음 id 차례) — 자리로 정하면 다듬은 뒤 다시 다듬을 때 다른 화살표를 끊어 층이 바뀐다
  const state = new Map<string, 1 | 2>(), keep = new Map(items.map((it) => [it.id, [] as string[]]));
  const visit = (u: string) => {
    state.set(u, 1);
    for (const w of out.get(u)!) {
      if (state.get(w) === 1) continue;
      keep.get(u)!.push(w);
      if (!state.has(w)) visit(w);
    }
    state.set(u, 2);
  };
  const into = new Set([...out.values()].flat());
  const ids = items.map((it) => it.id).sort();
  for (const id of [...ids.filter((x) => !into.has(x)), ...ids]) if (!state.has(id)) visit(id);
  // 가장 긴 길 (위상 정렬)
  const indeg = new Map(items.map((it) => [it.id, 0]));
  for (const ws of keep.values()) for (const w of ws) indeg.set(w, indeg.get(w)! + 1);
  const rank = new Map(items.map((it) => [it.id, 0]));
  const queue = read.filter((it) => indeg.get(it.id) === 0).map((it) => it.id);
  for (let i = 0; i < queue.length; i++) {
    const u = queue[i]!;
    for (const w of keep.get(u)!) {
      rank.set(w, Math.max(rank.get(w)!, rank.get(u)! + 1));
      indeg.set(w, indeg.get(w)! - 1);
      if (indeg.get(w) === 0) queue.push(w);
    }
  }
  // 곁 연결만 있는 상자: 붙은 상자의 층으로 (그 상자도 곁 연결뿐이면 다음 바퀴에)
  const linked = new Set(hard.flatMap((e) => [e.a, e.b]));
  for (let k = 0; k < items.length; k++) {
    let changed = false;
    for (const e of es) {
      if (!e.soft) continue;
      const [x, y] = linked.has(e.a) || !linked.has(e.b) ? [e.a, e.b] : [e.b, e.a];
      if (linked.has(y) || !linked.has(x)) continue;
      rank.set(y, rank.get(x)!); linked.add(y); changed = true;
    }
    if (!changed) break;
  }
  // 빈 층 없이 0, 1, 2 …로 당긴다
  const ranks = [...new Set(rank.values())].sort((p, q) => p - q);
  for (const [id, r] of rank) rank.set(id, ranks.indexOf(r));
  const layers: LayerItem[][] = ranks.map(() => []);
  for (const it of read) layers[rank.get(it.id)!]!.push(it);
  const nb = new Map(items.map((it) => [it.id, [] as string[]]));
  for (const e of es) { nb.get(e.a)!.push(e.b); nb.get(e.b)!.push(e.a); }
  const order = new Map<string, number>();
  layers.forEach((l, i) => {
    const key = new Map(l.map((it) => {
      const prev = nb.get(it.id)!.filter((o) => rank.get(o)! < i && order.has(o));
      return [it.id, prev.length ? prev.reduce((t, o) => t + order.get(o)!, 0) / prev.length : NaN];
    }));
    const cross = [...l].sort((p, q) => across(p) - across(q) || (p.id < q.id ? -1 : 1));
    // 앞 층 이웃이 없는 상자는 지금 자리 순서대로 이웃 있는 상자들 사이에 끼운다 (자기 바로 앞 상자의 값을 이어받음)
    let last = -Infinity;
    for (const it of cross) { const k = key.get(it.id)!; if (Number.isNaN(k)) key.set(it.id, last); else last = k; }
    l.sort((p, q) => key.get(p.id)! - key.get(q.id)! || across(p) - across(q) || (p.id < q.id ? -1 : 1));
    l.forEach((it, k) => order.set(it.id, k / Math.max(1, l.length - 1)));
  });
  const of = indexOf(layers);
  return { l: layers, of, gaps: layerGaps(layers, of, es, lr) };
}

/** 정한 방향 · 층대로 좌표를 놓는다 — 지금 자리는 쓰지 않는다(층 · 차례만) */
function place(items: readonly LayerItem[], es: readonly LayerEdge[], cut: Cut, lr: boolean): Map<string, Vec2> {
  const by = new Map(items.map((it) => [it.id, it]));
  const { l: layers, of: layerOf, gaps: gapAfter } = cut;
  const cZ = (it: LayerItem) => (lr ? it.h : it.w);
  const aZ = (it: LayerItem) => (lr ? it.w : it.h);

  // 층 사이 (layerGaps) · 층 두께 안 가운데
  const along = new Map<string, number>();
  let off = 0;
  layers.forEach((l, i) => {
    const thick = Math.max(...l.map(aZ));
    for (const it of l) along.set(it.id, off + (thick - aZ(it)) / 2);
    off += thick + gapAfter[i]!;
  });

  // 층 안: 같은 층끼리 이은 화살표(라벨)가 있으면 그 사이를 넓게
  const gapIn = (p: string, q: string) => {
    let g = GAP_ACROSS;
    for (const e of es) {
      if (!((e.a === p && e.b === q) || (e.a === q && e.b === p)) || e.label === undefined) continue;
      g = Math.max(g, lr ? LABEL_H + 2 * LABEL_PAD : e.label + 2 * LABEL_PAD);
    }
    return g;
  };
  const nb = new Map<string, string[]>(items.map((it) => [it.id, []]));
  for (const e of es) { nb.get(e.a)!.push(e.b); nb.get(e.b)!.push(e.a); }

  // 가로지르는 축: 층 안 차례를 지키며 바라는 중심에 가장 가깝게 (등위 회귀 — 차례 제약 + 최소 간격)
  const cross = new Map<string, number>();
  const center = (id: string) => cross.get(id)! + cZ(by.get(id)!) / 2;
  const offsets = (l: readonly LayerItem[]) => {
    const offs: number[] = [];
    let acc = 0;
    l.forEach((it, k) => { offs.push(acc); acc += cZ(it) + (k < l.length - 1 ? gapIn(it.id, l[k + 1]!.id) : 0); });
    return offs;
  };
  const pack = (l: readonly LayerItem[], want: (it: LayerItem) => number) => {
    const offs = offsets(l);
    const pools: { v: number; n: number }[] = [];
    l.forEach((it, k) => {
      pools.push({ v: want(it) - cZ(it) / 2 - offs[k]!, n: 1 });
      while (pools.length > 1 && pools.at(-2)!.v > pools.at(-1)!.v) {
        const b = pools.pop()!, a = pools.at(-1)!;
        a.v = (a.v * a.n + b.v * b.n) / (a.n + b.n); a.n += b.n;
      }
    });
    let k = 0;
    for (const p of pools) for (let m = 0; m < p.n; m++, k++) cross.set(l[k]!.id, p.v + offs[k]!);
  };
  // 처음엔 층마다 가운데 0에 붙여 놓고, 앞 층 이웃의 가운데로 → 뒤 층 이웃의 가운데로(부모는 자식들 가운데) 번갈아 움직이지 않을 때까지
  for (const l of layers) pack(l, () => 0);
  for (let r = 0; r < ROUNDS; r++) {
    const before = new Map(cross);
    for (const down of [true, false]) {
      for (let s = 0; s < layers.length; s++) {
        const i = down ? s : layers.length - 1 - s;
        const l = layers[i]!;
        // 이쪽 이웃이 없으면: 같은 층 이웃이 있으면 그 바로 옆자리로, 없으면 제자리
        const mean = (ns: readonly string[]) => ns.reduce((t, o) => t + center(o), 0) / ns.length;
        const offs = offsets(l), at = new Map(l.map((it, k) => [it.id, offs[k]! + cZ(it) / 2]));
        const want = new Map(l.map((it) => {
          const all = nb.get(it.id)!, other = all.filter((o) => layerOf.get(o) !== i);
          const side = other.filter((o) => (down ? layerOf.get(o)! < i : layerOf.get(o)! > i));
          if (side.length) return [it.id, mean(side)];
          const same = all.filter((o) => layerOf.get(o) === i);
          if (!same.length) return [it.id, center(it.id)];
          return [it.id, same.reduce((t, o) => t + center(o) + at.get(it.id)! - at.get(o)!, 0) / same.length];
        }));
        pack(l, (it) => want.get(it.id)!);
      }
    }
    if ([...cross].every(([id, c]) => Math.abs(c - before.get(id)!) < 0.25)) break;
  }
  const min = Math.min(...items.map((it) => cross.get(it.id)!));
  return new Map(items.map((it) => {
    const a = along.get(it.id)!, c = cross.get(it.id)! - min;
    return [it.id, lr ? { x: a, y: c } : { x: c, y: a }];
  }));
}

/** 층 사이 간격: 기본, 이웃 층을 잇는 화살표에 라벨이 있으면 그 라벨이 들어갈 만큼 (가로 흐름은 라벨 폭, 세로 흐름은 라벨 높이) */
function layerGaps(layers: readonly LayerItem[][], of: ReadonlyMap<string, number>, es: readonly LayerEdge[], lr: boolean): number[] {
  const gaps = layers.map(() => GAP_ALONG);
  for (const e of es) {
    const i = of.get(e.a)!, j = of.get(e.b)!;
    if (Math.abs(i - j) !== 1 || e.label === undefined) continue;
    const k = Math.min(i, j);
    gaps[k] = Math.max(gaps[k]!, lr ? e.label + 2 * LABEL_PAD : LABEL_H + 2 * LABEL_PAD);
  }
  return gaps;
}

function indexOf(layers: readonly LayerItem[][]): Map<string, number> {
  const of = new Map<string, number>();
  layers.forEach((l, i) => l.forEach((it) => of.set(it.id, i)));
  return of;
}
