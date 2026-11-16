// AI 결과 자동 배치 (FR-109, ENGINE 10.4 GraphLayoutInput/GraphLayoutEngine 형태).
// 계층형(Sugiyama 축약판): 순환 끊기 → 최장 경로 층 나누기 → 무게중심 정렬 몇 번 → 층별 좌표. 결정적이고 겹치지 않는다.
// dagre/elkjs를 들이지 않은 이유: 노드 ≤ 60 · 엣지 ≤ 120이라 이 정도로 충분하고, 번들 · 비동기 워커 비용이 없다.
// 품질이 모자라면 같은 입력 · 출력 형태 그대로 엔진을 바꾼다(ENGINE 10.4 "알고리즘 확정은 Phase 3").
import type { Vec2 } from '@dn/engine-core';

export interface LayoutNode { readonly id: string; readonly w: number; readonly h: number }
export interface LayoutEdge { readonly from: string; readonly to: string; /** 층 제약 없이 같은 층 근처에 (contrasts) */ readonly sameLayer?: boolean }
export interface GraphLayoutInput {
  readonly nodes: readonly LayoutNode[];
  readonly edges: readonly LayoutEdge[];
  /** LR: 층 = 열(왼쪽 → 오른쪽), TB: 층 = 행(위 → 아래) */
  readonly direction: 'LR' | 'TB';
}

/** 좌상단 기준 상대 좌표. 연결이 하나도 없는 노드는 그래프 아래 격자로 */
export function layeredLayout(input: GraphLayoutInput): Map<string, Vec2> {
  const layerGap = 96, nodeGap = 32; // 층 사이(화살표 라벨 자리) · 같은 층 안 블록 간격
  const ids = input.nodes.map((n) => n.id);
  const size = new Map(input.nodes.map((n) => [n.id, n]));
  const idx = new Map(ids.map((id, i) => [id, i]));
  const edges = input.edges.filter((e) => idx.has(e.from) && idx.has(e.to) && e.from !== e.to);
  const directed = edges.filter((e) => !e.sameLayer);

  // 1) 순환 끊기: 입력 순서대로 DFS, 뒤로 가는 엣지를 뒤집는다 (되먹임 고리도 방향이 읽히게)
  const out = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of directed) out.get(e.from)!.push(e.to);
  const state = new Map<string, 0 | 1 | 2>();
  const dag: [string, string][] = [];
  const visit = (v: string) => {
    state.set(v, 1);
    for (const w of out.get(v)!) {
      const s = state.get(w) ?? 0;
      if (s === 1) dag.push([w, v]);        // 뒤로 가는 엣지 → 뒤집기
      else { dag.push([v, w]); if (s === 0) visit(w); }
    }
    state.set(v, 2);
  };
  for (const id of ids) if (!state.get(id)) visit(id);

  // 2) 최장 경로 층 (위상 순서)
  const preds = new Map<string, string[]>(ids.map((id) => [id, []]));
  const succs = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const [a, b] of dag) { preds.get(b)!.push(a); succs.get(a)!.push(b); }
  const rank = new Map<string, number>();
  const indeg = new Map(ids.map((id) => [id, preds.get(id)!.length]));
  const queue = ids.filter((id) => indeg.get(id) === 0);
  while (queue.length) {
    const v = queue.shift()!;
    const r = Math.max(0, ...preds.get(v)!.map((p) => rank.get(p)! + 1));
    rank.set(v, r);
    for (const w of succs.get(v)!) { indeg.set(w, indeg.get(w)! - 1); if (indeg.get(w) === 0) queue.push(w); }
  }
  // 출발점(들어오는 화살표 없음)은 가리키는 상대 중 가장 앞 층의 바로 앞으로 — 맨 앞 층에 몰아 두면 화살표가 여러 층을 건너 길어진다
  for (const id of ids) {
    const s = succs.get(id)!;
    if (preds.get(id)!.length || !s.length) continue;
    rank.set(id, Math.max(rank.get(id)!, Math.min(...s.map((w) => rank.get(w)!)) - 1));
  }
  // 대조(contrasts)만으로 이어진 노드는 상대와 같은 층에
  const linked = new Set<string>();
  for (const [a, b] of dag) { linked.add(a); linked.add(b); }
  for (const e of edges) if (e.sameLayer) {
    if (!linked.has(e.to) && linked.has(e.from)) { rank.set(e.to, rank.get(e.from)!); linked.add(e.to); }
    else if (!linked.has(e.from) && linked.has(e.to)) { rank.set(e.from, rank.get(e.to)!); linked.add(e.from); }
    else if (!linked.has(e.from) && !linked.has(e.to)) { rank.set(e.to, rank.get(e.from)!); linked.add(e.from); linked.add(e.to); }
  }

  const graphIds = ids.filter((id) => linked.has(id));
  const loose = ids.filter((id) => !linked.has(id));

  // 3) 층별 순서: 입력 순서에서 시작해 무게중심(위 · 아래 층 이웃 평균 위치)으로 몇 번 훑는다
  const layers: string[][] = [];
  for (const id of graphIds) (layers[rank.get(id)!] ??= []).push(id);
  for (let i = 0; i < layers.length; i++) layers[i] ??= [];
  const pos = new Map<string, number>();
  const reindex = () => layers.forEach((l) => l.forEach((id, i) => pos.set(id, i)));
  reindex();
  const nbr = (id: string, up: boolean) => [...(up ? preds : succs).get(id)!, ...edges.filter((e) => e.sameLayer && (e.from === id || e.to === id)).map((e) => (e.from === id ? e.to : e.from))];
  for (let sweep = 0; sweep < 4; sweep++) {
    const down = sweep % 2 === 0;
    const order = down ? layers.keys() : [...layers.keys()].reverse();
    for (const li of order) {
      const l = layers[li]!;
      const bc = new Map(l.map((id) => {
        const ns = nbr(id, down).filter((n) => pos.has(n));
        return [id, ns.length ? ns.reduce((s, n) => s + pos.get(n)!, 0) / ns.length : pos.get(id)!];
      }));
      l.sort((a, b) => bc.get(a)! - bc.get(b)! || idx.get(a)! - idx.get(b)!);
      reindex();
    }
  }

  // 4) 좌표. 층 두께 = 층 안 최대 폭(LR) · 높이(TB). 층 안에서는 가운데 정렬
  const result = new Map<string, Vec2>();
  const lr = input.direction === 'LR';
  const along = (id: string) => (lr ? size.get(id)!.h : size.get(id)!.w);   // 층 안에서 쌓는 방향
  const across = (id: string) => (lr ? size.get(id)!.w : size.get(id)!.h);  // 층 두께 방향
  const spans = layers.map((l) => l.reduce((s, id) => s + along(id), 0) + Math.max(0, l.length - 1) * nodeGap);
  const maxSpan = Math.max(0, ...spans);
  let offset = 0;
  layers.forEach((l, li) => {
    const thick = Math.max(0, ...l.map(across));
    let p = (maxSpan - spans[li]!) / 2;
    for (const id of l) {
      result.set(id, lr ? { x: offset, y: p } : { x: p, y: offset });
      p += along(id) + nodeGap;
    }
    offset += thick + layerGap;
  });

  // 5) 연결 없는 노드: 그래프 아래(LR) · 옆이 아닌 아래(TB도 아래) 격자, 입력 순서
  const graphBottom = Math.max(0, ...graphIds.map((id) => result.get(id)!.y + size.get(id)!.h));
  const graphWidth = Math.max(0, ...graphIds.map((id) => result.get(id)!.x + size.get(id)!.w));
  placeGrid(loose.map((id) => size.get(id)!), graphIds.length ? graphBottom + layerGap : 0, Math.max(graphWidth, 900), nodeGap, result);
  return result;
}

/** 줄 바꿈 격자 배치 (선반 알고리즘). 비교 · 수치 결과처럼 엣지가 없을 때 (ENGINE 10.4 표 마지막 행) */
export function placeGrid(items: readonly LayoutNode[], top: number, maxWidth: number, gap: number, into: Map<string, Vec2>): void {
  let x = 0, y = top, rowH = 0;
  for (const n of items) {
    if (x > 0 && x + n.w > maxWidth) { x = 0; y += rowH + gap; rowH = 0; }
    into.set(n.id, { x, y });
    x += n.w + gap;
    rowH = Math.max(rowH, n.h);
  }
}
