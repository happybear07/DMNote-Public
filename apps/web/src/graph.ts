// 노트 관계 그래프 (FR-083): 노트 = 블록, 노트 링크(FR-080) = 화살표. 캔버스 엔진 · 렌더러(FR-005)를 그대로 쓴다 — 메모리 엔진(저장 안 함)을 보기 전용 캔버스에.
// 배치는 힘 모형(서로 밀고 링크는 당김, 식힘), 링크가 많은 노트일수록 상자를 크게. DOM 없이 계산만 — 화면은 GraphPage.
import { Engine, type Id, type Vec2 } from '@dn/engine-core';

export interface GraphNode { id: Id; title: string; icon?: string; degree: number }
export interface GraphEdge { from: Id; to: Id }

/** 상자 크기: 링크 수에 따라 (최대 10개까지 커진다) */
export function nodeSize(degree: number): { w: number; h: number } {
  const k = Math.min(10, degree);
  return { w: 150 + k * 16, h: 44 + k * 3 };
}

/**
 * 힘 모형 배치 (Fruchterman–Reingold). 반복 수는 노드가 많을수록 줄인다(노트 수백 개도 1초 안).
 * 결과는 노드 가운데 좌표. 같은 입력이면 같은 결과(처음 자리는 나선 — 난수 없음).
 */
export function forceLayout(nodes: readonly GraphNode[], edges: readonly GraphEdge[]): Map<Id, Vec2> {
  const n = nodes.length;
  const idx = new Map(nodes.map((x, i) => [x.id, i]));
  const k = 260;
  const pos = nodes.map((_, i) => { const a = i * 2.399963, r = k * 0.6 * Math.sqrt(i + 1); return { x: Math.cos(a) * r, y: Math.sin(a) * r }; });
  const links = edges.map((e) => [idx.get(e.from), idx.get(e.to)] as const).filter((p): p is readonly [number, number] => p[0] !== undefined && p[1] !== undefined && p[0] !== p[1]);
  const iters = n > 400 ? 40 : n > 150 ? 90 : 220;
  let temp = k * 2;
  for (let it = 0; it < iters; it++) {
    const disp = pos.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      let dx = pos[i]!.x - pos[j]!.x, dy = pos[i]!.y - pos[j]!.y;
      let d2 = dx * dx + dy * dy;
      if (d2 < 1) { dx = (i - j) || 1; dy = 1; d2 = dx * dx + dy * dy; }
      const f = (k * k) / d2;
      disp[i]!.x += dx * f; disp[i]!.y += dy * f;
      disp[j]!.x -= dx * f; disp[j]!.y -= dy * f;
    }
    for (const [a, b] of links) {
      const dx = pos[a]!.x - pos[b]!.x, dy = pos[a]!.y - pos[b]!.y;
      const d = Math.max(1, Math.hypot(dx, dy));
      const f = d / k;
      disp[a]!.x -= dx * f; disp[a]!.y -= dy * f;
      disp[b]!.x += dx * f; disp[b]!.y += dy * f;
    }
    // 가운데로 살짝 (연결 없는 무리가 멀리 흩어지지 않게)
    for (let i = 0; i < n; i++) { disp[i]!.x -= pos[i]!.x * 0.02; disp[i]!.y -= pos[i]!.y * 0.02; }
    for (let i = 0; i < n; i++) {
      const d = Math.max(1, Math.hypot(disp[i]!.x, disp[i]!.y));
      const s = Math.min(d, temp) / d;
      pos[i]!.x += disp[i]!.x * s; pos[i]!.y += disp[i]!.y * s;
    }
    temp = Math.max(4, temp * 0.95);
  }
  return new Map(nodes.map((x, i) => [x.id, pos[i]!]));
}

/** 그래프 → 보기 전용 캔버스에 넣을 메모리 엔진. blockOf: 블록 → 노트 */
export function buildGraphEngine(nodes: readonly GraphNode[], edges: readonly GraphEdge[], current: Id | null): { engine: Engine; noteOf: Map<Id, Id> } {
  const engine = new Engine({ note: { id: 'graph-view', title: '노트 그래프', createdAt: 0, updatedAt: 0 } });
  const at = forceLayout(nodes, edges);
  const noteOf = new Map<Id, Id>();
  engine.transact((tx) => {
    const blockOf = new Map<Id, Id>();
    for (const nd of nodes) {
      const c = at.get(nd.id)!, s = nodeSize(nd.degree);
      const b = tx.createBlock({ x: Math.round(c.x - s.w / 2), y: Math.round(c.y - s.h / 2), w: s.w, h: s.h });
      if (nd.id === current) tx.set('block', b, { style: { color: 'blue' } });
      const label = nd.icon && !nd.icon.startsWith('icon:') ? `${nd.icon} ${nd.title}` : nd.title;
      // 테두리 있는 내용 상자(굵은 글자) — 제목 상자는 테두리가 없어 노드처럼 보이지 않는다
      tx.createContent({ blockId: b, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: label, marks: [{ type: 'strong' }] }] }] } });
      blockOf.set(nd.id, b);
      noteOf.set(b, nd.id);
    }
    for (const e of edges) {
      const from = blockOf.get(e.from), to = blockOf.get(e.to);
      if (from && to && from !== to) tx.createArrow({ from: { blockId: from, side: 'auto' }, to: { blockId: to, side: 'auto' } });
    }
  }, { origin: 'load' });
  engine.clearHistory();
  return { engine, noteOf };
}
