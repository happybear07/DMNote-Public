// 머메이드 순서도 ↔ 캔버스 도식 (GAP #18 — 노션 /mermaid, "AI 구조화와 글로 주고받는 통로"):
// 그림 라이브러리 없이 flowchart 글을 이 앱의 상자 · 화살표 · 묶음으로 바꾸고(층 배치), 거꾸로 고른 상자 · 화살표를 flowchart 글로 쓴다.
// 읽는 것: graph|flowchart TD/TB/BT/LR/RL, 노드 모양 [] () ([]) [[]] (()) {} {{}} >] [//], "따옴표 이름", 이름 속 <br>,
//   선 --> --- -.-> ==> <-->, 라벨 -->|글| · -- 글 -->, 이어 쓰기 A --> B --> C, A & B --> C, subgraph … end, %% 주석.
// 무시: classDef · class · style · linkStyle · click · direction · :::꾸밈 (모양 꾸밈). 다른 도식(sequence · pie …)은 null.
import type { Engine, TxResult } from './engine';
import { isBound, type ArrowStyle, type Id, type TextDoc } from './model';
import { isTextContent } from './model';
import { textLines } from './text-doc';
import type { BlockClip, ClipArrow, ClipBlock } from './clip';
import { insertClipBelow } from './doc-edit';
import { groupBlocks, groupMembers, groupName } from './groups';

export type MermaidDir = 'TD' | 'LR' | 'BT' | 'RL';
export type MermaidShape = 'rect' | 'round' | 'stadium' | 'subroutine' | 'circle' | 'diamond' | 'hexagon' | 'flag' | 'slant';
export interface MermaidNode { id: string; label: string; shape: MermaidShape }
export interface MermaidEdge { from: string; to: string; label?: string; line: 'solid' | 'dotted' | 'thick'; head: boolean; both?: boolean }
export interface MermaidGroup { title: string; nodes: string[] }
export interface MermaidGraph { dir: MermaidDir; nodes: MermaidNode[]; edges: MermaidEdge[]; groups: MermaidGroup[] }

const SHAPES: [string, string, MermaidShape][] = [
  ['([', '])', 'stadium'], ['[[', ']]', 'subroutine'], ['((', '))', 'circle'], ['{{', '}}', 'hexagon'], ['[/', '/]', 'slant'],
  ['[', ']', 'rect'], ['(', ')', 'round'], ['{', '}', 'diamond'], ['>', ']', 'flag'],
];
const ID = /^[\p{L}\p{N}_]+/u;
const EDGE_TEXT = /^\s*(<?)(--|==|-\.)\s+(.+?)\s+(--+|==+|\.+-)(>?)\s*/;
const EDGE = /^\s*(<?)(--+|==+|-\.+-)(>|o|x)?(?:\|([^|]*)\|)?\s*/;
const clean = (s: string) => s.replace(/^"(.*)"$/s, '$1').replace(/<br\s*\/?>/gi, '\n').replace(/#quot;/g, '"').trim();

/** flowchart 글 → 그래프. flowchart가 아니면 null */
export function parseMermaid(text: string): MermaidGraph | null {
  const lines = text.replace(/\r/g, '').split('\n').map((l) => l.replace(/%%.*$/, '').trim()).filter(Boolean);
  const head = /^(graph|flowchart)\b\s*(TD|TB|BT|LR|RL)?\s*;?\s*(.*)$/i.exec(lines[0] ?? '');
  if (!head) return null;
  const dirRaw = (head[2] ?? 'TD').toUpperCase();
  const g: MermaidGraph = { dir: dirRaw === 'TB' ? 'TD' : (dirRaw as MermaidDir), nodes: [], edges: [], groups: [] };
  const byId = new Map<string, MermaidNode>();
  const stack: MermaidGroup[] = [];
  const touch = (id: string, label?: string, shape?: MermaidShape) => {
    let n = byId.get(id);
    if (!n) { n = { id, label: id, shape: 'rect' }; byId.set(id, n); g.nodes.push(n); stack.at(-1)?.nodes.push(id); }
    if (label !== undefined) { n.label = clean(label) || id; n.shape = shape ?? n.shape; }
    return id;
  };
  /** 노드 하나 (id + 모양 이름) — 읽은 길이 */
  const readNode = (s: string): { id: string; len: number } | null => {
    const m = ID.exec(s);
    if (!m) return null;
    let i = m[0].length;
    for (const [open, close, shape] of SHAPES) {
      if (!s.startsWith(open, i)) continue;
      const from = i + open.length;
      const end = s[from] === '"' ? s.indexOf(close, s.indexOf('"', from + 1) + 1) : s.indexOf(close, from);
      if (end < 0) continue;
      touch(m[0], s.slice(from, end), shape);
      i = end + close.length;
      return { id: m[0], len: i };
    }
    touch(m[0]);
    return { id: m[0], len: i };
  };
  const readGroup = (s: string): { ids: string[]; len: number } | null => {
    const ids: string[] = [];
    let at = 0;
    for (;;) {
      const ws = /^\s*/.exec(s.slice(at))![0].length;
      const n = readNode(s.slice(at + ws));
      if (!n) return ids.length ? { ids, len: at } : null;
      ids.push(n.id);
      at += ws + n.len;
      const amp = /^\s*&\s*/.exec(s.slice(at));
      if (!amp) return { ids, len: at };
      at += amp[0].length;
    }
  };
  const statements = [head[3] ?? '', ...lines.slice(1)].flatMap((l) => l.split(';')).map((l) => l.replace(/:::[\w-]+/g, '').trim()).filter(Boolean);
  for (const st of statements) {
    const sub = /^subgraph\s+(.+)$/i.exec(st);
    if (sub) {
      const t = /^[\p{L}\p{N}_]+\s*\[(.*)\]$/u.exec(sub[1]!.trim());
      const grp = { title: clean(t ? t[1]! : sub[1]!), nodes: [] };
      g.groups.push(grp);
      stack.push(grp);
      continue;
    }
    if (/^end$/i.test(st)) { stack.pop(); continue; }
    if (/^(classDef|class|style|linkStyle|click|direction)\b/i.test(st)) continue;
    let rest = st;
    let left = readGroup(rest);
    if (!left) continue;
    rest = rest.slice(left.len);
    while (rest.trim()) {
      const t = EDGE_TEXT.exec(rest), e = t ? null : EDGE.exec(rest);
      if (!t && !e) break;
      const op = t ? t[2]! + t[4]! : e![2]!, label = t ? t[3] : e![4];
      const head = t ? t[5] === '>' : !!e![3];
      rest = rest.slice((t ?? e)![0].length);
      const right = readGroup(rest);
      if (!right) break;
      rest = rest.slice(right.len);
      const line = op.includes('.') ? 'dotted' : op.includes('=') ? 'thick' : 'solid';
      for (const a of left.ids) for (const b of right.ids) {
        g.edges.push({ from: a, to: b, line, head, ...(label?.trim() ? { label: clean(label) } : {}), ...((t ? t[1] : e![1]) === '<' ? { both: true } : {}) });
      }
      left = right;
    }
  }
  return g.nodes.length ? g : null;
}

export interface MermaidSize { w: number; h: number }
const defaultSize = (label: string): MermaidSize => ({ w: Math.max(120, Math.min(260, 40 + [...label.split('\n')[0]!].length * 13)), h: 44 + 22 * (label.split('\n').length - 1) });

/** 층 배치: 원천에서 가장 긴 길로 층, 층 안은 묶음 · 앞뒤 층 평균 자리 순 — 노드 순번별 왼쪽 위 */
export function layoutMermaid(g: MermaidGraph, size: (n: MermaidNode) => MermaidSize = (n) => defaultSize(n.label)): { x: number; y: number; w: number; h: number }[] {
  const idx = new Map(g.nodes.map((n, i) => [n.id, i]));
  const N = g.nodes.length;
  const out: number[][] = Array.from({ length: N }, () => []);
  // 고리는 처음 본 차례로 끊는다 (뒤로 가는 선은 층 계산에서 뺀다)
  const state = new Array<number>(N).fill(0);
  const fwd = new Set<string>();
  const adj = Array.from({ length: N }, (_, i) => g.edges.filter((e) => idx.get(e.from) === i).map((e) => idx.get(e.to)!).filter((j) => j !== i));
  const dfs = (i: number) => { state[i] = 1; for (const j of adj[i]!) { if (state[j] === 0) { fwd.add(`${i}>${j}`); dfs(j); } else if (state[j] === 2) fwd.add(`${i}>${j}`); } state[i] = 2; };
  for (let i = 0; i < N; i++) if (state[i] === 0) dfs(i);
  for (const k of fwd) { const [a, b] = k.split('>').map(Number); out[a!]!.push(b!); }
  const rank = new Array<number>(N).fill(0);
  for (let pass = 0; pass < N; pass++) { let moved = false; for (let i = 0; i < N; i++) for (const j of out[i]!) if (rank[j]! < rank[i]! + 1) { rank[j] = rank[i]! + 1; moved = true; } if (!moved) break; }
  const groupOf = new Map<string, number>();
  g.groups.forEach((gr, gi) => gr.nodes.forEach((id) => { if (!groupOf.has(id)) groupOf.set(id, gi); }));
  const layers: number[][] = [];
  for (let i = 0; i < N; i++) (layers[rank[i]!] ??= []).push(i);
  const pos = new Array<number>(N).fill(0);
  const setPos = () => layers.forEach((l) => l.forEach((i, k) => { pos[i] = k; }));
  setPos();
  const preds = Array.from({ length: N }, (_, j) => out.flatMap((o, i) => (o.includes(j) ? [i] : [])));
  for (let sweep = 0; sweep < 2; sweep++) {
    for (const l of layers.slice(1)) {
      const bc = (i: number) => (preds[i]!.length ? preds[i]!.reduce((s, p) => s + pos[p]!, 0) / preds[i]!.length : pos[i]!);
      l.sort((a, b) => (groupOf.get(g.nodes[a]!.id) ?? -1) - (groupOf.get(g.nodes[b]!.id) ?? -1) || bc(a) - bc(b));
      setPos();
    }
  }
  const sz = g.nodes.map(size);
  const across = g.dir === 'LR' || g.dir === 'RL';
  // 층 방향 자리 (층마다 가장 큰 상자) · 층 안 자리 (가운데 맞춤)
  const depth: number[] = [];
  let acc = 0;
  for (const l of layers) { depth.push(acc); acc += Math.max(...l.map((i) => (across ? sz[i]!.w : sz[i]!.h))) + (across ? 80 : 64); }
  const spans = layers.map((l) => l.reduce((s, i) => s + (across ? sz[i]!.h : sz[i]!.w), 0) + (l.length - 1) * (across ? 28 : 40));
  const widest = Math.max(...spans);
  const rects = new Array<{ x: number; y: number; w: number; h: number }>(N);
  layers.forEach((l, r) => {
    let along = (widest - spans[r]!) / 2;
    for (const i of l) {
      const s = sz[i]!;
      const d = depth[r]!;
      rects[i] = across ? { x: d, y: along, w: s.w, h: s.h } : { x: along, y: d, w: s.w, h: s.h };
      along += (across ? s.h + 28 : s.w + 40);
    }
  });
  const flip = g.dir === 'BT' ? 'y' : g.dir === 'RL' ? 'x' : null;
  if (flip) { const max = Math.max(...rects.map((r) => (flip === 'y' ? r.y + r.h : r.x + r.w))); for (const r of rects) { if (flip === 'y') r.y = max - r.y - r.h; else r.x = max - r.x - r.w; } }
  return rects.map((r) => ({ x: Math.round(r.x), y: Math.round(r.y), w: r.w, h: r.h }));
}

const labelDoc = (label: string): TextDoc => ({ type: 'doc', content: label.split('\n').map((l) => (l ? { type: 'paragraph', content: [{ type: 'text', text: l }] } : { type: 'paragraph' })) });

/** 그래프 → 블록 묶음 (상자 · 화살표) + 묶음(subgraph) 목록(클립 안 순번) */
export function mermaidClip(g: MermaidGraph, size?: (n: MermaidNode) => MermaidSize): { clip: BlockClip; groups: { title: string; members: number[] }[] } {
  const rects = layoutMermaid(g, size);
  const idx = new Map(g.nodes.map((n, i) => [n.id, i]));
  const blocks: ClipBlock[] = g.nodes.map((n, i) => ({
    dx: rects[i]!.x, dy: rects[i]!.y, w: rects[i]!.w, h: rects[i]!.h, sizing: 'auto', layout: 'flow',
    ...(n.shape === 'diamond' ? { nodeKind: 'decision' as const } : {}),
    contents: [{ type: 'text', role: 'body', doc: labelDoc(n.label) }],
  }));
  const arrows: ClipArrow[] = g.edges.filter((e) => e.from !== e.to).map((e) => {
    const style: ArrowStyle = { ...(e.line === 'dotted' ? { line: 'dotted' as const } : {}), ...(e.line === 'thick' ? { width: 2 as const } : {}), ...(!e.head ? { head: 'none' as const } : {}), ...(e.both ? { tail: 'triangle' as const } : {}) };
    return { from: idx.get(e.from)!, to: idx.get(e.to)!, ...(e.label ? { label: e.label } : {}), ...(Object.keys(style).length ? { style } : {}) };
  });
  return { clip: { kind: 'dn-blocks', v: 2, blocks, arrows }, groups: g.groups.filter((gr) => gr.nodes.length >= 2).map((gr) => ({ title: gr.title, members: gr.nodes.map((id) => idx.get(id)!) })) };
}

/** flowchart 글 → 이 블록 바로 아래(없으면 문서 끝)에 상자 · 화살표 · 묶음. 실행 취소 한 번. flowchart가 아니면 실패 */
export function insertMermaid(engine: Engine, below: Id | null, text: string, size?: (n: MermaidNode) => MermaidSize): TxResult<Id[]> {
  return engine.transact((tx) => {
    const g = parseMermaid(text);
    if (!g) return tx.fail('flowchart · graph로 시작하는 순서도만 바꿀 수 있어요');
    const { clip, groups } = mermaidClip(g, size);
    const r = insertClipBelow(engine, below, clip, '머메이드 도식');
    if (!r.ok) return tx.fail(r.reason);
    for (const gr of groups) groupBlocks(engine, gr.members.map((i) => r.value[i]!), gr.title);
    return r.value;
  }, { origin: 'user', label: '머메이드 → 도식' });
}

/** 블록 글 속 첫 머메이드 코드 (코드 블록 언어 mermaid, 또는 flowchart · graph로 시작하는 코드) */
export function mermaidOfBlock(engine: Engine, blockId: Id): string | null {
  for (const c of engine.contentsOf(blockId)) {
    if (!isTextContent(c)) continue;
    let found: string | null = null;
    const walk = (n: { type: string; attrs?: Record<string, unknown>; content?: readonly unknown[] }) => {
      if (found) return;
      if (n.type === 'code_block') {
        const code = textLines(n as never).join('\n');
        if (n.attrs?.language === 'mermaid' || /^\s*(graph|flowchart)\b/i.test(code)) { found = code; return; }
      }
      for (const k of n.content ?? []) walk(k as never);
    };
    walk(c.doc as never);
    if (found) return found;
  }
  return null;
}

/** 고른 상자 · 그 사이 화살표 → flowchart 글 (넓으면 LR, 아니면 TD). 묶음 하나를 다 고른 것은 subgraph로 */
export function diagramToMermaid(engine: Engine, ids: readonly Id[]): string {
  const bs = ids.map((id) => engine.getBlock(id)).filter((b) => !!b).sort((a, b) => a!.y - b!.y || a!.x - b!.x);
  const name = new Map(bs.map((b, i) => [b!.id, `n${i + 1}`]));
  const q = (s: string) => `"${s.replace(/"/g, '#quot;').replace(/\n/g, '<br>')}"`;
  const label = (id: Id) => {
    const c = engine.contentsOf(id)[0];
    const t = c && isTextContent(c) ? textLines(c.doc).filter((l) => l.trim()).slice(0, 2).join('\n') : '';
    return t || (c ? String((c as { title?: unknown }).title ?? c.type) : '상자');
  };
  const w = Math.max(...bs.map((b) => b!.x + b!.w)) - Math.min(...bs.map((b) => b!.x)), h = Math.max(...bs.map((b) => b!.y + b!.h)) - Math.min(...bs.map((b) => b!.y));
  const lines = [`flowchart ${w > h * 1.4 ? 'LR' : 'TD'}`];
  const node = (b: (typeof bs)[number]) => `${name.get(b!.id)}${b!.nodeKind === 'decision' || b!.nodeKind === 'condition' ? `{${q(label(b!.id))}}` : `[${q(label(b!.id))}]`}`;
  const inGroup = new Set<Id>();
  for (const [gid, members] of groupMembers(engine)) {
    if (!members.every((id) => name.has(id))) continue;
    lines.push(`  subgraph g${lines.length} [${q(groupName(engine, gid, members))}]`);
    for (const b of bs) if (members.includes(b!.id)) { lines.push(`    ${node(b)}`); inGroup.add(b!.id); }
    lines.push('  end');
  }
  for (const b of bs) if (!inGroup.has(b!.id)) lines.push(`  ${node(b)}`);
  for (const a of [...engine.arrows()].filter(isBound)) { // 빈 곳 화살표는 순서도 글에 안 넣는다
    const f = name.get(a.from.blockId), t = name.get(a.to.blockId);
    if (!f || !t) continue;
    const s = a.style ?? {};
    const op = s.line === 'dotted' || s.line === 'dashed' || s.dash ? (s.head === 'none' ? '-.-' : '-.->') : s.width === 2 ? (s.head === 'none' ? '===' : '==>') : s.head === 'none' ? '---' : '-->';
    lines.push(`  ${f} ${s.tail && s.tail !== 'none' ? '<' : ''}${op}${a.label ? `|${q(a.label)}|` : ''} ${t}`); // 양방향은 <-->
  }
  return lines.join('\n');
}
