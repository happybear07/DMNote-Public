// AI 결과 전체 배치 (FR-109, STRUCTURE-GUIDE 2.1 · 4.9): 구조 판별(patterns)마다 상자를 나눠 원형 프리셋(presets.ts)으로 놓고,
// 덩어리들을 주 구조부터 왼→오(넓으면 아래 줄)로 잇는다. 어느 구조에도 안 든 상자 · 차트 · 표는 맨 아래 계층형 덩어리로.
// - 계층형 원형(사슬 · 단계 · 트리 · 논증 …)끼리 상자를 나눠 쓰면(겹침 · 이어짐) 한 덩어리로 합친다 — 화살표가 덩어리 사이를 길게 건너지 않게.
// - 구조 판별이 없으면(v1 · 판별 실패) 예전과 같은 계층형 하나.
import { tidyLayout, type Vec2 } from '@dn/engine-core';
import { isGraphArchetype, parseArchetype, runPreset, type Archetype, type PresetEdge, type PresetGroup, type PresetNode } from './presets';
import { prompt } from './prompts';
import type { StructureContainer, StructurePattern } from './structure';

export interface ArrangeItem extends PresetNode {
  readonly kind: 'node' | 'chart' | 'table'; readonly attachTo?: string;
  /** 배치 다듬기에서 줄일 수 있는 가장 좁은 폭 (제목 상자는 글 폭, 본문 상자는 기본 폭). 없으면 폭을 바꾸지 않는다 */
  readonly minW?: number;
}
export interface ArrangeInput {
  /** 상자 (노드 · 차트 · 표) — 원문 차례 */
  readonly items: readonly ArrangeItem[];
  /** 끝이 상자 id인 엣지 (묶음 끝은 이미 첫 구성원으로) */
  readonly edges: readonly PresetEdge[];
  readonly containers: readonly StructureContainer[];
  readonly patterns: readonly StructurePattern[];
  /** 폭을 바꾼 상자의 높이 (배치 다듬기) — 없으면 높이는 그대로 */
  readonly heightAt?: (id: string, w: number) => number;
  /** 덩어리를 잇는 줄의 폭 상한 (A4 용지 안쪽 폭 — 넘으면 다음 줄) */
  readonly maxWidth?: number;
  /** 흐름형 덩어리를 위→아래로 (A4 용지에서 가로로 넘칠 때) */
  readonly vertical?: boolean;
}
export interface Arranged { readonly pos: Map<string, Vec2>; readonly width: Map<string, number>; readonly height: Map<string, number> }

/** 노드 상자 위 종류 태그 높이 (engine-dom — 상자 위 19px) */
export const TAG_H = 20;

type Dir = 'LR' | 'RL' | 'TB' | 'BT';
interface Cluster { readonly arch: Archetype | 'rest'; readonly hint?: Dir; readonly pattern?: StructurePattern; readonly ids: string[] }

const CLUSTER_GAP = 160, ROW_MAX = 2400, PAGE_GAP = 96;
const NEEDS_GROUPS = new Set<Archetype>(['form', 'lanes', 'nest']);

let catalog: Map<string, { key?: Archetype; dir?: Dir }> | undefined;
/** 구조 ID → 원형 (구조 목록의 대괄호, 여럿이면 첫째) — 모델이 pattern을 엉뚱하게 적었을 때 */
function archetypeOf(id: string): { key?: Archetype; dir?: Dir } {
  catalog ??= new Map([...prompt('structure.v2.catalog.md').body.matchAll(/^(S-\d{2}) [^[\n]*\[([^\]]+)\]/gm)].map((m) => [m[1]!, parseArchetype(m[2])]));
  return catalog.get(id) ?? {};
}

/** 구조 판별 하나의 원형 — pattern 글자, 엉뚱하면 구조 목록의 대괄호 */
export function patternArchetype(p: StructurePattern): Archetype | undefined {
  return parseArchetype(p.pattern).key ?? archetypeOf(p.id).key;
}

export function arrange(input: ArrangeInput): Arranged {
  const byId = new Map(input.items.map((i) => [i.id, i]));
  const owner = new Map<string, Cluster>();
  const clusters: Cluster[] = [];
  const graphLike = (c?: Cluster) => !!c && c.arch !== 'rest' && isGraphArchetype(c.arch);
  const take = (c: Cluster, id: string) => { c.ids.push(id); owner.set(id, c); };

  // 1) 구조마다 덩어리 — 주 구조 먼저, 나머지는 판별 차례
  for (const p of [...input.patterns].sort((a, b) => Number(!!b.primary) - Number(!!a.primary))) {
    const parsed = parseArchetype(p.pattern), byCatalog = archetypeOf(p.id);
    const members = [...(p.nodes ?? []), ...(p.containers ?? []).flatMap((k) => input.containers.find((c) => c.key === k)?.members ?? []), ...(p.charts ?? []), ...(p.tables ?? [])];
    const ids = [...new Set(members)].filter((id) => byId.has(id));
    // 칸 · 띠가 곧 모양인 원형(고정 틀 · 레인 · 포함 중첩)인데 묶음이 없으면 흐름(계층형)으로 — 이웃 구조와 합칠 수 있게
    const want = parsed.key ?? byCatalog.key ?? 'network';
    const arch: Archetype = NEEDS_GROUPS.has(want) && !input.containers.some((c) => c.members.some((m) => ids.includes(m))) ? 'network' : want;
    const fresh = ids.filter((id) => !owner.has(id));
    if (!fresh.length) continue;
    // 이미 계층형 덩어리에 든 상자를 나눠 쓰면 그 덩어리로 (겹침) — 모양 원형도 가운데 · 짝이 다른 덩어리에 있으면 제 모양을 못 낸다
    const host = ids.map((id) => owner.get(id)).find(graphLike);
    if (host) { fresh.forEach((id) => take(host, id)); continue; }
    const c: Cluster = { arch, hint: parsed.dir ?? byCatalog.dir, pattern: p, ids: [] };
    fresh.forEach((id) => take(c, id));
    clusters.push(c);
  }

  // 2) 구조에 안 든 노드: 화살표로 이어진 계층형 덩어리로 (이웃의 이웃까지), 차트 · 표는 붙은 노드의 덩어리로
  for (let changed = true; changed;) {
    changed = false;
    for (const it of input.items) {
      if (owner.has(it.id)) continue;
      const nbr = it.kind === 'node'
        ? input.edges.flatMap((e) => (e.from === it.id ? [e.to] : e.to === it.id ? [e.from] : [])).map((o) => owner.get(o)).find(graphLike)
        : it.attachTo ? owner.get(it.attachTo) : undefined;
      if (nbr && graphLike(nbr)) { take(nbr, it.id); changed = true; }
    }
  }
  const restIds = input.items.filter((i) => !owner.has(i.id)).map((i) => i.id);
  const rest: Cluster | undefined = restIds.length ? { arch: 'rest', ids: restIds } : undefined;

  // 3) 덩어리마다 배치 — 흐름형(계층형) 덩어리는 배치 다듬기를 한 번 거친다(줄 맞춤 · 고른 간격 · 폭 단계, engine-core tidy.ts)
  const pos = new Map<string, Vec2>(), width = new Map<string, number>(), height = new Map<string, number>();
  const boxes = [...clusters, ...(rest ? [rest] : [])].map((c) => {
    const local = tidyCluster(c, layoutCluster(c, input, byId), input, byId);
    for (const [id, w] of local.width ?? []) width.set(id, w);
    for (const [id, h] of local.height ?? []) height.set(id, h);
    const w = (id: string) => width.get(id) ?? byId.get(id)!.w, h = (id: string) => height.get(id) ?? byId.get(id)!.h;
    const right = Math.max(0, ...c.ids.map((id) => local.pos.get(id)!.x + w(id)));
    const bottom = Math.max(0, ...c.ids.map((id) => local.pos.get(id)!.y + h(id)));
    return { c, local: local.pos, w: right, h: bottom };
  });

  // 4) 잇기: 주 구조부터 왼→오, 줄이 넘치면 아래 줄. 나머지(rest)는 늘 맨 아래 새 줄. 용지 안이면 줄 폭 · 덩어리 사이를 좁게
  const rowMax = input.maxWidth ?? ROW_MAX, gap = input.maxWidth ? PAGE_GAP : CLUSTER_GAP;
  let x = 0, y = 0, rowH = 0;
  for (const b of boxes) {
    const newRow = x > 0 && (x + b.w > rowMax || b.c.arch === 'rest');
    if (newRow) { x = 0; y += rowH + gap; rowH = 0; }
    for (const id of b.c.ids) { const p = b.local.get(id)!; pos.set(id, { x: x + p.x, y: y + p.y }); }
    x += b.w + gap;
    rowH = Math.max(rowH, b.h);
  }
  return { pos, width, height };
}

type Laid = { pos: Map<string, Vec2>; width?: Map<string, number>; height?: Map<string, number> };

/** 흐름형 덩어리(계층형 원형 · 나머지)만 다듬는다 — 피시본 · 원 · 칸 · 레인 · 층 쌓기처럼 모양이 곧 뜻인 원형은 프리셋 그대로 */
function tidyCluster(c: Cluster, laid: Laid, input: ArrangeInput, byId: Map<string, ArrangeItem>): Laid {
  if (c.arch !== 'rest' && (!isGraphArchetype(c.arch) || c.arch === 'fishbone')) return laid;
  const ids = new Set(c.ids);
  const nodes = c.ids.map((id) => {
    const it = byId.get(id)!, p = laid.pos.get(id)!;
    return { id, x: p.x, y: p.y, w: laid.width?.get(id) ?? it.w, h: it.h, top: it.kind === 'node' ? TAG_H : 0, ...(it.minW !== undefined ? { minW: it.minW } : {}) };
  });
  // 차트 · 표는 붙은 노드 곁에 (배치용 가상 화살표)
  const attach = c.ids.flatMap((id) => { const t = byId.get(id)!.attachTo; return t && ids.has(t) ? [{ from: t, to: id, soft: true }] : []; });
  const edges = [...input.edges.filter((e) => ids.has(e.from) && ids.has(e.to)).map((e) => ({ from: e.from, to: e.to, ...(e.label ? { label: e.label } : {}) })), ...attach];
  const groups = c.arch === 'rest' ? [] : groupsOf(c, input, ids).map((g) => ({ id: g.key, members: g.members }));
  const out = tidyLayout({ nodes, edges, groups, byPosition: true, ...(input.heightAt ? { heightAt: input.heightAt } : {}) });
  const x0 = Math.min(...[...out.values()].map((r) => r.x)), y0 = Math.min(...[...out.values()].map((r) => r.y));
  return {
    pos: new Map([...out].map(([id, r]) => [id, { x: r.x - x0, y: r.y - y0 }])),
    width: new Map([...out].map(([id, r]) => [id, r.w])),
    height: new Map([...out].map(([id, r]) => [id, r.h])),
  };
}

function layoutCluster(c: Cluster, input: ArrangeInput, byId: Map<string, ArrangeItem>): { pos: Map<string, Vec2>; width?: Map<string, number> } {
  const ids = new Set(c.ids);
  const nodes = c.ids.map((id) => byId.get(id)!);
  const edges = input.edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  // 차트 · 표는 붙은 노드와 같은 층, 그 곁에 (배치용 가상 엣지) — 다음 층에 두면 흐름 한가운데를 차지해 화살표가 그 위를 지난다
  const attach: PresetEdge[] = nodes.flatMap((n) => (n.attachTo && ids.has(n.attachTo) ? [{ from: n.attachTo, to: n.id, same: true }] : []));
  // 용지에서 가로로 넘치면 흐름형은 위→아래로 (원문 판별의 방향보다 앞선다)
  const down = input.vertical && (c.arch === 'rest' || isGraphArchetype(c.arch));
  if (c.arch === 'rest') return runPreset('network', { nodes, edges: [...edges, ...attach], groups: [] }, down ? 'TB' : 'LR');
  const pattern = c.pattern && down ? { ...c.pattern, direction: 'TB' as const } : c.pattern;
  return runPreset(c.arch, { nodes, edges: isGraphArchetype(c.arch) ? [...edges, ...attach] : edges, groups: groupsOf(c, input, ids), ...(pattern ? { pattern } : {}) }, down ? 'TB' : c.hint);
}

/** 덩어리 안의 묶음: 판별이 적은 묶음 그대로, 없으면 구성원이 든 묶음 중 안쪽 것(구조 고유의 묶음 — 증명 · 경우 · 레인은 절 안에) */
function groupsOf(c: Cluster, input: ArrangeInput, ids: ReadonlySet<string>): PresetGroup[] {
  const pick = c.pattern?.containers?.length
    ? c.pattern.containers.map((k) => input.containers.find((x) => x.key === k)).filter((x): x is StructureContainer => !!x)
    : input.containers.filter((x) => x.members.some((m) => ids.has(m)) && !input.containers.some((y) => y.parent === x.key && y.members.some((m) => ids.has(m))));
  const top = (x: StructureContainer) => { let cur = x; for (let i = 0; i < 10 && cur.parent; i++) { const p = input.containers.find((y) => y.key === cur.parent); if (!p) break; cur = p; } return cur.key; };
  return pick.map((x) => ({ key: x.key, ...(x.title ? { title: x.title } : {}), kind: x.kind, band: top(x), members: x.members.filter((m) => ids.has(m)) })).filter((g) => g.members.length);
}

