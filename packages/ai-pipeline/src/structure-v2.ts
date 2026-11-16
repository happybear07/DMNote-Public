// structure.v2 정리 · 내리기 (STRUCTURE-GUIDE 5.7 · 5.8 · 5.9).
// - 묶음(containers): 없는 노드는 빼고, 다른 묶음과 겹치는 구성원은 먼저 나온 묶음에만(안쪽 묶음은 parent와 겹쳐도 됨), 구성원 둘 미만이면 버린다.
// - 구조 판별(patterns): 없는 key 참조는 빼고, primary는 하나, in 사슬은 2단계까지.
// - 내리기(toV1): v1만 아는 평가기 · 클라이언트에 주는 v1 모양 (5.9).
import type { SchemaIssue } from './schema';
import type { DroppedItem, NodeKindV1, RelationV1, Structure, StructureContainer, StructureEdge, StructureNode, StructurePattern } from './structure';

type Validate = (v: unknown, i: number) => SchemaIssue[];
type Drop = (path: string, reason: string) => void;

const CONTAINER_CAP = 30, PATTERN_CAP = 12, IN_DEPTH = 2;
/** 묶음의 최소 구성원 — 고정 틀의 칸(slot) · 레인(lane)은 상자 하나여도 자리를 지킨다(배치용, 앱 묶음 테두리는 둘 이상일 때만) */
export const minMembers = (kind: string): number => (kind === 'slot' || kind === 'lane' ? 1 : 2);

export function cleanContainers(raw: unknown[], nodeKeys: ReadonlySet<string>, validate: Validate, drop: Drop): StructureContainer[] {
  if (raw.length > CONTAINER_CAP) drop('/containers', `상한 ${CONTAINER_CAP}개 초과 — 앞에서부터 ${CONTAINER_CAP}개만 사용 (${raw.length}개)`);
  const ok: StructureContainer[] = [];
  raw.slice(0, CONTAINER_CAP).forEach((c, i) => {
    const issues = validate(c, i);
    if (issues.length) { drop(`/containers/${i}`, issues.map((x) => `${x.path} ${x.rule}`).slice(0, 3).join(', ')); return; }
    const v = JSON.parse(JSON.stringify(c)) as StructureContainer;
    if (ok.some((o) => o.key === v.key)) { drop(`/containers/${i}`, `key ${v.key} 중복`); return; }
    ok.push(v);
  });
  const keys = new Set(ok.map((c) => c.key));
  for (const c of ok) if (c.parent !== undefined && (!keys.has(c.parent) || c.parent === c.key)) { delete c.parent; drop(`/containers/${c.key}/parent`, '없는 묶음을 가리킴 — parent만 버림'); }
  // parent 사슬이 돌면 끊는다
  const parentOf = new Map(ok.map((c) => [c.key, c.parent]));
  const ancestors = (k: string): string[] => { const out: string[] = []; let p = parentOf.get(k); while (p && !out.includes(p) && p !== k) { out.push(p); p = parentOf.get(p); } return out; };
  for (const c of ok) if (c.parent && ancestors(c.parent).includes(c.key)) { delete c.parent; parentOf.set(c.key, undefined); drop(`/containers/${c.key}/parent`, 'parent가 돌아 끊음'); }
  // 구성원: 있는 노드만, 겹치면 먼저 나온 묶음에(조상 · 자손 사이는 겹쳐도 된다)
  const owner = new Map<string, string>();
  const out: StructureContainer[] = [];
  for (const c of ok) {
    const anc = ancestors(c.key);
    const members = [...new Set(c.members)].filter((m) => {
      if (!nodeKeys.has(m)) { drop(`/containers/${c.key}/members`, `없는 노드 ${m}`); return false; }
      const o = owner.get(m);
      if (o && !anc.includes(o) && !ancestors(o).includes(c.key)) { drop(`/containers/${c.key}/members`, `${m}은(는) 이미 묶음 ${o}에 — 겹침 금지`); return false; }
      return true;
    });
    if (members.length < minMembers(c.kind)) { drop(`/containers/${c.key}`, '구성원이 둘 미만 — 묶음을 버림'); continue; }
    for (const m of members) if (!owner.has(m)) owner.set(m, c.key);
    out.push({ ...c, members });
  }
  const kept = new Set(out.map((c) => c.key));
  for (const c of out) if (c.parent && !kept.has(c.parent)) delete c.parent;
  return out;
}

export function cleanPatterns(raw: unknown[], refs: { nodes: ReadonlySet<string>; containers: ReadonlySet<string>; charts: ReadonlySet<string>; tables: ReadonlySet<string> }, validate: Validate, drop: Drop): StructurePattern[] {
  if (raw.length > PATTERN_CAP) drop('/patterns', `상한 ${PATTERN_CAP}개 초과 — 앞에서부터 ${PATTERN_CAP}개만 사용 (${raw.length}개)`);
  const out: StructurePattern[] = [];
  raw.slice(0, PATTERN_CAP).forEach((p, i) => {
    const issues = validate(p, i);
    if (issues.length) { drop(`/patterns/${i}`, issues.map((x) => `${x.path} ${x.rule}`).slice(0, 3).join(', ')); return; }
    const v = JSON.parse(JSON.stringify(p)) as StructurePattern;
    if (v.key && out.some((o) => o.key === v.key)) { drop(`/patterns/${i}`, `key ${v.key} 중복`); return; }
    for (const f of ['nodes', 'containers', 'charts', 'tables'] as const) {
      const list = v[f];
      if (!list) continue;
      const keep = list.filter((k) => refs[f].has(k));
      if (keep.length !== list.length) drop(`/patterns/${i}/${f}`, '없는 key를 뺌');
      if (keep.length) v[f] = keep; else delete v[f];
    }
    if (v.frame && !refs.containers.has(v.frame)) { delete v.frame; drop(`/patterns/${i}/frame`, '없는 묶음'); }
    if (v.parent && !refs.containers.has(v.parent)) { delete v.parent; drop(`/patterns/${i}/parent`, '없는 묶음'); }
    if (v.primary && out.some((o) => o.primary)) { delete v.primary; drop(`/patterns/${i}/primary`, '주 구조는 하나'); }
    out.push(v);
  });
  const keys = new Set(out.flatMap((p) => (p.key ? [p.key] : [])));
  for (const p of out) {
    for (const f of ['in', 'with'] as const) if (p[f] !== undefined && (!keys.has(p[f]!) || p[f] === p.key)) { delete p[f]; drop(`/patterns/${p.key ?? p.id}/${f}`, '없는 구조를 가리킴'); }
    if (p.primary && p.in) delete p.in; // 주 구조는 맨 위 (5.8)
  }
  // in 사슬 깊이 ≤ 2 (4.9.6) — 넘으면 in을 끊는다
  const byKey = new Map(out.flatMap((p) => (p.key ? [[p.key, p] as const] : [])));
  for (const p of out) {
    let d = 0, cur = p.in ? byKey.get(p.in) : undefined;
    const seen = new Set<StructurePattern>([p]);
    while (cur && !seen.has(cur)) { d++; seen.add(cur); cur = cur.in ? byKey.get(cur.in) : undefined; }
    if (cur || d > IN_DEPTH) { delete p.in; drop(`/patterns/${p.key ?? p.id}/in`, cur ? 'in이 돌아 끊음' : `중첩 깊이 ${IN_DEPTH} 초과`); }
  }
  return out;
}

// ───────── v2 → v1 내리기 (5.9) ─────────

/** 새 노드 종류 → v1 종류 + 제목 접두 (5.3 표) */
const KIND_DOWN: Record<string, [NodeKindV1, string]> = {
  definition: ['concept', '정의'], theorem: ['claim', '정리'], assumption: ['claim', '가정'], contradiction: ['concept', '모순'],
  rebuttal: ['claim', '반박'], condition: ['question', ''], decision: ['conclusion', ''], action: ['step', ''], goal: ['concept', '목표'],
  event: ['concept', ''], state: ['concept', ''], actor: ['concept', ''],
  premise: ['claim', '전제'], problem: ['concept', '문제'], rule: ['concept', '규칙'], example: ['concept', '예'], risk: ['concept', '위험'],
};
/** 새 관계 → v1 관계 + 라벨 (5.5 표). null = 엣지 버림 */
const REL_DOWN: Record<string, [RelationV1, string] | null> = {
  refutes: ['contrasts', '반박'], implies: ['leads-to', '⇒'], equivalent: ['leads-to', '⇔'], 'kind-of': ['part-of', '종류'], inhibits: ['causes', '억제'],
  answers: ['leads-to', '답'], transitions: ['leads-to', ''], serves: ['supports', '위해'], becomes: ['leads-to', '변경'], 'flows-to': ['leads-to', ''],
  'subset-of': ['part-of', '⊂'], 'maps-to': ['leads-to', ''], symbolizes: ['leads-to', ''], relates: ['leads-to', ''], sends: ['leads-to', ''],
  elaborates: ['part-of', '구체적으로'], solves: null, 'analogous-to': null, correlates: null, moderates: null,
};
const V1_KINDS = new Set(['concept', 'step', 'option', 'claim', 'evidence', 'question', 'conclusion']);
const V1_RELS = new Set(['causes', 'leads-to', 'part-of', 'example-of', 'contrasts', 'supports', 'depends-on', 'next']);
/** v2 관계 → v1 관계 (5.5 표). null = v1에서 엣지로 그리지 않음 — 평가기도 이 표로 v2 관계를 v1 기대값과 맞춘다 */
export function relationV1(rel: string): RelationV1 | null {
  return V1_RELS.has(rel) ? rel as RelationV1 : REL_DOWN[rel]?.[0] ?? null;
}

/** v2 결과를 v1 모양으로 (v1이면 그대로). dropped: 내리며 버린 것 */
export function toV1(s: Structure): { value: Structure; dropped: DroppedItem[] } {
  if (s.version !== 'structure.v2') return { value: s, dropped: [] };
  const dropped: DroppedItem[] = [];
  const containers = s.containers ?? [];
  // 묶음: 구성원의 group = 가장 안쪽 묶음 title, 묶음을 가리키는 엣지는 첫 구성원으로
  const depth = (c: StructureContainer): number => { let d = 0, p = c.parent; while (p && d < 10) { d++; p = containers.find((x) => x.key === p)?.parent; } return d; };
  const groupOf = new Map<string, string>();
  for (const c of [...containers].sort((a, b) => depth(a) - depth(b))) for (const m of c.members) if (c.title) groupOf.set(m, c.title.slice(0, 40));
  const firstOf = new Map(containers.map((c) => [c.key, c.members[0]!]));
  const nodes: StructureNode[] = s.nodes.map((n) => {
    const [kind, prefix] = V1_KINDS.has(n.kind) ? [n.kind as NodeKindV1, ''] : KIND_DOWN[n.kind] ?? ['concept', ''];
    const tag = n.kind === 'theorem' ? n.role || prefix : prefix;
    const head = tag ? `${tag}: ` : n.kind === 'event' && n.time ? `${n.time} ` : '';
    const title = head && head.length + n.title.length <= 80 ? head + n.title : n.title;
    const meta = [n.time && n.kind !== 'event' ? n.time : '', n.owner ?? '', n.due ? `${n.due}까지` : '', n.start && n.end ? `${n.start}~${n.end}` : '', n.speaker ? `${n.speaker}:` : ''].filter(Boolean).join(' · ');
    const body = meta ? `${meta}${n.body ? `\n${n.body}` : ''}`.slice(0, 2000) : n.body;
    const group = groupOf.get(n.key) ?? n.group;
    return { key: n.key, title, kind, ...(body ? { body } : {}), ...(group ? { group } : {}), ...(n.source ? { source: n.source } : {}) };
  });
  const edges: StructureEdge[] = [];
  const seen = new Set<string>();
  s.edges.forEach((e, i) => {
    if (e.negated) { dropped.push({ path: `/edges/${i}`, reason: '성립 안 함(⇏) 엣지는 v1에 없음' }); return; }
    const down = V1_RELS.has(e.relation) ? [e.relation as RelationV1, ''] as const : REL_DOWN[e.relation];
    if (!down) { dropped.push({ path: `/edges/${i}`, reason: `${e.relation}는 v1에서 엣지로 그리지 않음` }); return; }
    let [from, to] = [firstOf.get(e.from) ?? e.from, firstOf.get(e.to) ?? e.to];
    if (e.relation === 'answers') [from, to] = [to, from];
    if (from === to) return;
    const label = (e.label || down[1] || e.prob || (e.sign === '-' ? '−' : e.sign === '+' ? '+' : '')).slice(0, 24);
    const sig = `${from}\u0000${to}\u0000${down[0]}`;
    if (seen.has(sig)) return;
    seen.add(sig);
    edges.push({ from, to, relation: down[0], ...(label ? { label } : {}) });
  });
  return { value: { ...(s.title ? { title: s.title } : {}), nodes, edges, charts: s.charts, tables: s.tables }, dropped };
}
