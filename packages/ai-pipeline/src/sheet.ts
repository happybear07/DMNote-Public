// 노트형 정리 (docs/research/NOTE-SHEET-PLAN.md 4.2 ~ 4.4, NS-11 · 12 · 14 · 15): structure.v2의 sheet — 시트 머리 + 번호 카드 + 카드 안 조각.
// 정리(cleanSheet) → 원문 수치 확인(별점) → 청크 합치기(mergeSheet) → 배치(planSheet, 레고 블록 — 10/29 카드 격자에서 바꿈).
// 카드(문단) = 번호 · 제목 + 조각을 한 글 상자로, 상자들은 블록 하나 안에 붙이기 간격으로 빈틈없이. 원문에 없는 사실 · 수치를 만들지 않는다 — 별점은 원문 수치가 있을 때만.
import {
  CARD_GAP, CARD_PAD, DOCK_GAP, makeTable,
  type AiProvenance, type GroupMeta, type Rect, type TextDoc, type TextNode, type Vec2,
} from '@dn/engine-core';
import type { SchemaIssue } from './schema';
import type { MeasureFn, PlannedArrow, PlannedBlock, PlannedContent, PlannedGroup } from './apply';
import type { StructurePattern, StructureTable, StructureNode, StructureEdge } from './structure';

export type SheetTone = 'plain' | 'blue' | 'yellow' | 'green' | 'pink' | 'gray';
export type PieceType = 'text' | 'checklist' | 'table' | 'compare' | 'flow' | 'chips' | 'rating' | 'callout' | 'quote' | 'conclusion' | 'diagram' | 'divider';
export interface SheetSide { label?: string; items: string[] }
export interface RatingRow { label: string; value: number; max?: number; note?: string }
export interface SheetPiece {
  type: PieceType; md?: string; items?: string[]; done?: boolean[]; steps?: string[]; left?: SheetSide; right?: SheetSide; mid?: string;
  rows?: RatingRow[]; table?: string; pattern?: string; label?: string; icon?: string;
}
export interface SheetSection { key?: string; title: string; span?: 1 | 2; tone?: SheetTone; pieces: SheetPiece[] }
export interface StructureSheet { title?: string; subtitle?: string; meta?: { label: string; value: string }[]; sections: SheetSection[]; closing?: string }

type Validate = (v: unknown, def: string, path: (string | number)[]) => SchemaIssue[];
type Drop = (path: string, reason: string) => void;

/** 정리: 형식이 틀린 조각은 그 조각만, 조각이 다 빠진 카드는 카드째 버린다. 표 · 도식 조각은 가리키는 항목이 있어야 한다 */
export function cleanSheet(raw: unknown, validate: Validate, refs: { tables: ReadonlySet<string>; patterns: ReadonlySet<string> }, drop: Drop): StructureSheet | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { drop('/sheet', '객체가 아님'); return undefined; }
  const o = raw as Record<string, unknown>;
  const sections: SheetSection[] = [];
  (Array.isArray(o.sections) ? o.sections : []).slice(0, 24).forEach((s0, i) => {
    if (!s0 || typeof s0 !== 'object') return;
    const s = s0 as Record<string, unknown>;
    const pieces: SheetPiece[] = [];
    (Array.isArray(s.pieces) ? s.pieces : []).slice(0, 12).forEach((p, j) => {
      const issues = validate(p, 'piece', ['sheet', 'sections', i, 'pieces', j]);
      if (issues.length) { drop(`/sheet/sections/${i}/pieces/${j}`, issues.map((x) => `${x.path} ${x.rule}`).slice(0, 2).join(', ')); return; }
      const piece = structuredClone(p) as SheetPiece;
      if (piece.type === 'table' && !(piece.table && refs.tables.has(piece.table))) { drop(`/sheet/sections/${i}/pieces/${j}`, '없는 표를 가리킴'); return; }
      if (piece.type === 'diagram' && !(piece.pattern && refs.patterns.has(piece.pattern))) { drop(`/sheet/sections/${i}/pieces/${j}`, '없는 구조를 가리킴'); return; }
      if (!hasBody(piece)) { drop(`/sheet/sections/${i}/pieces/${j}`, '내용 없는 조각'); return; }
      pieces.push(piece);
    });
    const head = { ...s, pieces: pieces.length ? pieces : [{ type: 'text', md: '·' }] };
    const issues = validate(head, 'section', ['sheet', 'sections', i]);
    if (!pieces.length || issues.length) { drop(`/sheet/sections/${i}`, pieces.length ? issues.map((x) => `${x.path} ${x.rule}`).slice(0, 2).join(', ') : '조각이 모두 빠짐'); return; }
    sections.push({ ...(typeof s.key === 'string' ? { key: s.key } : {}), title: String(s.title), ...(s.span === 2 ? { span: 2 as const } : {}), ...(typeof s.tone === 'string' && s.tone !== 'plain' ? { tone: s.tone as SheetTone } : {}), pieces });
  });
  if (!sections.length) { drop('/sheet', '카드가 없음'); return undefined; }
  const str = (k: string, max: number) => (typeof o[k] === 'string' && (o[k] as string).trim() ? { [k]: (o[k] as string).trim().slice(0, max) } : {});
  const meta = Array.isArray(o.meta) ? (o.meta as unknown[]).filter((m): m is { label: string; value: string } => !!m && typeof (m as { label?: unknown }).label === 'string' && typeof (m as { value?: unknown }).value === 'string').slice(0, 4) : [];
  return { ...str('title', 80), ...str('subtitle', 120), ...(meta.length ? { meta } : {}), sections, ...str('closing', 600) } as StructureSheet;
}

function hasBody(p: SheetPiece): boolean {
  switch (p.type) {
    case 'text': case 'callout': case 'quote': case 'conclusion': return !!p.md?.trim();
    case 'checklist': case 'chips': return !!p.items?.some((x) => x.trim());
    case 'flow': return (p.steps?.filter((x) => x.trim()).length ?? 0) >= 2;
    case 'compare': return !!(p.left?.items.length && p.right?.items.length);
    case 'rating': return !!p.rows?.length;
    case 'table': case 'diagram': case 'divider': return true;
  }
}

/** 별점 값은 원문 수치일 때만 — 원문에 없는 값의 줄은 별점 없이 글로 (16.3 수치 검사와 같은 규칙). 결과: 고친 줄 수 */
export function checkSheetNumbers(sheet: StructureSheet, numbers: ReadonlySet<number>): number {
  let fixed = 0;
  for (const s of sheet.sections) {
    s.pieces = s.pieces.map((p) => {
      if (p.type !== 'rating' || !p.rows) return p;
      const bad = p.rows.filter((r) => !numbers.has(r.value));
      if (!bad.length) return p;
      fixed += bad.length;
      const good = p.rows.filter((r) => numbers.has(r.value));
      const lines = bad.map((r) => `- ${r.label}${r.note ? ` — ${r.note}` : ''}`).join('\n');
      return good.length ? { ...p, rows: good, md: lines } : { type: 'text', md: lines };
    });
  }
  return fixed;
}

/** 청크 합치기: 카드를 차례로 잇는다 — 머리는 첫 청크, 맺음말은 마지막 청크. 표 · 도식 참조는 청크 이름공간으로 */
export function mergeSheet(acc: StructureSheet | undefined, s: StructureSheet, ns: (k: string) => string): StructureSheet {
  const sections = s.sections.map((x) => ({ ...x, pieces: x.pieces.map((p) => ({ ...p, ...(p.table ? { table: ns(p.table) } : {}), ...(p.pattern ? { pattern: ns(p.pattern) } : {}) })) }));
  if (!acc) return { ...s, sections };
  return { ...acc, sections: [...acc.sections, ...sections].slice(0, 40), ...(s.closing ? { closing: s.closing } : {}) };
}

// ───────── 배치 (레고 블록, 10/29) ─────────
// 사용자(10/29): "사이즈 맞춰서 블록을 생성하고, 그 블록에 빈틈없이 각 블록들이 레고처럼 조립되도록" — 카드 격자(P-24: 카드마다 묶음,
// 카드 사이 24 · 조각 사이 8)를 바꿨다. 결과 = 블록(묶음) 하나, 안의 상자는 붙이기 간격(DOCK_GAP)으로 빈틈없이:
// · 카드(문단) 하나 = 글 상자 하나(번호 · 제목 + 조각들을 한 글로) — 표 · 비교 · 구분선에서만 상자를 나눈다(비교는 나란히 둘)
// · 카드들은 신문처럼 세로 단으로(위 → 아래, 다음 단) — 단 높이가 고르도록 나누고, 단마다 마지막 글 상자를 늘려 아래 끝을 맞춘다
// · 머리(제목 · 부제 · 메타)는 맨 위, 맺음말은 맨 아래 — 블록 폭 전체
// · A4 노트는 쪽마다 블록 하나 — 그 쪽에 들어가는 만큼만 담고 나머지는 다음 쪽 블록으로(상자가 쪽 틈에 걸치지 않게)

export interface SheetDeps {
  readonly measure: MeasureFn;
  readonly ai: AiProvenance;
  readonly run: NonNullable<GroupMeta['ai']>;
  readonly sanitize: (md: string) => TextNode[];
  /** 결과 전체 크기 → 놓을 왼쪽 위 (기존 블록과 겹치지 않는 빈 자리) */
  readonly free: (r: Rect) => Vec2;
  readonly tables: readonly StructureTable[];
  readonly patterns: readonly StructurePattern[];
  readonly nodes: readonly StructureNode[];
  readonly edges: readonly StructureEdge[];
  /** A4 노트: 카드 안쪽 폭 · 열 수(블록 폭 = 예전 카드 격자 폭), 쪽 틈 피하기 · y부터 그 쪽 아래 여백까지 남은 높이 (없으면 끝없는 캔버스 3단) */
  readonly sheet?: { readonly inner: number; readonly cols: number; readonly place?: (y: number, h: number) => number; readonly room?: (y: number) => number };
}

const doc = (...content: TextNode[]): TextDoc => ({ type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] }) as TextDoc;
const txt = (text: string, marks?: TextNode['marks']): TextNode => ({ type: 'text', text, ...(marks ? { marks } : {}) }) as TextNode;
const strong = [{ type: 'strong' }] as TextNode['marks'];
const para = (...content: TextNode[]): TextNode => ({ type: 'paragraph', ...(content.length ? { content } : {}) }) as TextNode;
const chip = (s: string) => txt(s, [{ type: 'chip', attrs: { color: '' } }] as TextNode['marks']);
const bullets = (items: readonly string[]): TextNode => ({ type: 'bullet_list', content: items.map((t) => ({ type: 'list_item', content: [para(txt(t))] })) }) as TextNode;

/** 차례를 지키며 k단으로 나눈다 — 가장 높은 단이 가장 낮게(선형 분할). cuts: 단마다 [시작, 끝), H: 가장 높은 단 */
export function balanceColumns(hs: readonly number[], k: number, gap: number): { cuts: [number, number][]; H: number } {
  const n = hs.length, pre = [0];
  for (const h of hs) pre.push(pre[pre.length - 1]! + h);
  const col = (i: number, j: number) => pre[j]! - pre[i]! + gap * (j - i - 1);
  const best = Array.from({ length: k + 1 }, () => new Array<number>(n + 1).fill(Infinity)), from = Array.from({ length: k + 1 }, () => new Array<number>(n + 1).fill(0));
  best[0]![0] = 0;
  for (let c = 1; c <= k; c++) for (let j = c; j <= n; j++) for (let i = c - 1; i < j; i++) {
    const v = Math.max(best[c - 1]![i]!, col(i, j));
    if (v < best[c]![j]!) { best[c]![j] = v; from[c]![j] = i; }
  }
  const cuts: [number, number][] = [];
  for (let c = k, j = n; c > 0; c--) { const i = from[c]![j]!; cuts.unshift([i, j]); j = i; }
  return { cuts, H: best[k]![n]! };
}

export function planSheet(sheet: StructureSheet, at: Vec2, deps: SheetDeps): { blocks: PlannedBlock[]; groups: PlannedGroup[]; arrows: PlannedArrow[] } {
  const W = deps.sheet?.inner ?? 330, cols = Math.max(1, deps.sheet?.cols ?? 3), G = DOCK_GAP;
  const cw = Math.floor((cols * (W + 2 * CARD_PAD) + (cols - 1) * CARD_GAP - (cols - 1) * G) / cols); // 단 폭 — 블록 폭은 예전 카드 격자 그대로
  const widthOf = (k: number) => k * cw + (k - 1) * G;
  const measureText = (d: TextDoc, w: number) => deps.measure({ content: { type: 'text', doc: d }, w }).h;
  type Box = { content: PlannedContent; w: number; h: number; text: boolean };
  type Sec = { parts: Box[][]; h: number }; // 한 줄 = 상자 하나, 비교는 나란히 둘
  const partH = (p: readonly Box[]) => Math.max(...p.map((b) => b.h));
  const stackH = (hs: readonly number[]) => hs.reduce((s, h) => s + h, 0) + G * Math.max(0, hs.length - 1);
  const textBox = (d: TextDoc, w: number): Box => ({ content: { type: 'text', doc: d }, w, h: measureText(d, w), text: true });

  // 조각 → 글 (한 상자에 이어 쓴다)
  const pieceNodes = (p: SheetPiece): TextNode[] => {
    switch (p.type) {
      case 'text': return deps.sanitize(p.md ?? '');
      case 'checklist': return [{ type: 'task_list', content: (p.items ?? []).filter((t) => t.trim()).map((t, i) => ({ type: 'task_item', attrs: { checked: !!p.done?.[i] }, content: [para(txt(t))] })) } as TextNode];
      case 'chips': return [para(...(p.items ?? []).filter((t) => t.trim()).flatMap((t, i) => (i ? [txt(' '), chip(t)] : [chip(t)])))];
      case 'flow': return [para(...(p.steps ?? []).filter((t) => t.trim()).flatMap((t, i) => (i ? [txt(' → '), chip(t)] : [chip(t)])))]; // 한 줄 흐름 (NS-11)
      case 'rating': return [...(p.rows ?? []).map((r) => para(txt(`${r.label} `), { type: 'rating', attrs: { value: r.value, max: r.max ?? 5 } } as TextNode, ...(r.note ? [txt(` ${r.note}`)] : []))), ...(p.md ? deps.sanitize(p.md) : [])];
      case 'callout': return [{ type: 'callout', attrs: { icon: p.icon ?? 'bulb', color: 'yellow' }, content: deps.sanitize(p.md ?? '') } as TextNode];
      case 'quote': return [{ type: 'blockquote', content: deps.sanitize(p.md ?? '') } as TextNode];
      case 'conclusion': {
        const kids = deps.sanitize(p.md ?? ''), first = kids[0]?.type === 'paragraph' ? kids[0] : para(txt(p.md ?? ''));
        return [{ ...first, content: [txt('→ ', strong), ...(first.content ?? [])] } as TextNode, ...kids.slice(kids[0]?.type === 'paragraph' ? 1 : 0)];
      }
      case 'diagram': {
        // 작은 도식: 구조의 화살표를 'A → B' 줄로 (상자 · 화살표 도식은 도식형 결과에서)
        const pat = deps.patterns.find((x) => x.key === p.pattern);
        const keys = new Set(pat?.nodes ?? []), title = (k: string) => deps.nodes.find((x) => x.key === k)?.title ?? k;
        const lines = deps.edges.filter((e) => keys.has(e.from) && keys.has(e.to)).map((e) => `${title(e.from)} → ${title(e.to)}${e.label ? ` (${e.label})` : ''}`);
        return lines.length || keys.size ? [bullets(lines.length ? lines : [...keys].map(title))] : [];
      }
      default: return [];
    }
  };

  // 카드 → 상자 줄들: 번호 · 제목 + 조각 글을 한 상자로, 표 · 비교 · 구분선에서 나눈다
  const numbered = sheet.sections.length > 1;
  const secs: Sec[] = sheet.sections.map((s, i) => {
    const parts: Box[][] = [];
    const title = numbered && !/^\d+[.)]/.test(s.title.trim()) ? `${i + 1}. ${s.title}` : s.title;
    let nodes: TextNode[] = [{ type: 'heading', attrs: { level: 3 }, content: [txt(title)] } as TextNode];
    const flush = () => { if (nodes.length) parts.push([textBox(doc(...nodes), cw)]); nodes = []; };
    for (const p of s.pieces) {
      if (p.type === 'divider') { flush(); if (p.label) nodes.push(para(txt(p.label, strong))); }
      else if (p.type === 'table') {
        const t = deps.tables.find((x) => x.key === p.table);
        if (!t) continue;
        flush();
        const content: PlannedContent = { type: 'table', ...makeTable(t.columns, t.rows, t.title) };
        parts.push([{ content, w: cw, h: deps.measure({ content, w: cw }).h, text: false }]);
      } else if (p.type === 'compare' && p.left && p.right) {
        flush();
        const side = (sd: SheetSide) => doc(...(sd.label ? [para(txt(sd.label, strong))] : []), bullets(sd.items));
        const lw = Math.floor((cw - G) / 2);
        parts.push([textBox(side(p.left), lw), textBox(side(p.right), cw - lw - G)]);
      } else nodes.push(...pieceNodes(p));
    }
    flush();
    return { parts, h: stackH(parts.map(partH)) };
  });
  // 머리: 제목은 제목 상자(이름 없는 블록은 첫 제목 상자를 이름으로 — 사이드바 · 문서 소제목이 겹치지 않게), 부제 · 메타는 그 아래 내용 상자
  const metaLine = (sheet.meta ?? []).map((m) => `${m.label}: ${m.value}`).join(' · ');
  const headDocs = [sheet.title ? doc({ type: 'heading', attrs: { level: 1 }, content: [txt(sheet.title)] } as TextNode) : null,
    sheet.subtitle || metaLine ? doc(...[sheet.subtitle, metaLine].filter((x): x is string => !!x).map((t) => para(txt(t)))) : null].filter((d): d is TextDoc => !!d);
  const tailDoc = sheet.closing ? doc({ type: 'callout', attrs: { icon: 'pin', color: 'gray' }, content: deps.sanitize(sheet.closing) } as TextNode) : null;

  // 블록 나누기: 끝없는 캔버스는 하나, A4는 쪽에 들어가는 만큼씩 (단이 고르게 나뉜 높이로 잰다)
  const room = deps.sheet?.room, place = deps.sheet?.place;
  const nextTop = (y: number) => (room && place ? place(y + Math.max(0, room(y)), 1) : y);
  type Chunk = { from: number; to: number; k: number; cuts: [number, number][]; H: number; y: number; headH: number; tail?: number };
  const chunks: Chunk[] = [];
  let y = deps.sheet ? at.y : 0, i = 0;
  while (i < secs.length) {
    const avail = room ? room(y) : Infinity;
    const headH = (k: number) => (chunks.length ? 0 : headDocs.reduce((s, d) => s + measureText(d, widthOf(k)) + G, 0));
    let best: Chunk | null = null;
    for (let t = 1; i + t <= secs.length; t++) {
      const k = Math.min(cols, t), b = balanceColumns(secs.slice(i, i + t).map((s) => s.h), k, G), hh = headH(k);
      if (hh + b.H > avail) break;
      best = { from: i, to: i + t, k, ...b, y, headH: hh };
    }
    if (!best) {
      const ny = nextTop(y);
      if (ny !== y && room!(ny) > avail) { y = ny; continue; } // 다음 쪽 위에서 다시
      best = { from: i, to: i + 1, k: 1, ...balanceColumns([secs[i]!.h], 1, G), y, headH: headH(1) }; // 한 쪽보다 큰 카드 — 그대로
    }
    chunks.push(best);
    i = best.to;
    y = nextTop(y);
  }
  // 맺음말: 마지막 블록 아래에 들어가면 그 블록 안, 아니면 다음 쪽 맨 위에 상자 하나로
  let tailAlone: { y: number } | null = null;
  const last = chunks[chunks.length - 1];
  if (tailDoc && last) {
    const th = measureText(tailDoc, widthOf(last.k));
    if (!room || room(last.y) >= last.headH + last.H + G + th) last.tail = th;
    else tailAlone = { y: nextTop(last.y) };
  }

  // 상자 놓기 — 블록마다 묶음 하나(상자가 둘 이상일 때), 늘린 상자는 그 높이를 최소 높이로
  const blocks: PlannedBlock[] = [], groups: PlannedGroup[] = [];
  let n = 0;
  const ox = deps.sheet ? at.x : 0;
  const put = (b: Box, x: number, y: number, h: number, group?: string) => blocks.push({
    ref: `sheet:${n++}`, kind: b.content.type === 'table' ? 'table' : 'node', content: b.content, ai: deps.ai, rect: { x: ox + x, y, w: b.w, h },
    ...(group ? { group } : {}), ...(h > b.h + 0.5 ? { minH: h } : {}),
  });
  chunks.forEach((c, ci) => {
    const w = widthOf(c.k), gkey = `sheet:${ci}`, start = blocks.length;
    let cy = c.y;
    if (ci === 0) for (const d of headDocs) { const h = measureText(d, w); put({ content: { type: 'text', doc: d }, w, h, text: true }, 0, cy, h, gkey); cy += h + G; }
    c.cuts.forEach(([a, b], col) => {
      const list = secs.slice(c.from + a, c.from + b), extra = c.H - stackH(list.map((s) => s.h));
      // 늘릴 줄: 이 단 마지막 카드의 마지막 글 줄 (표뿐이면 마지막 줄)
      const lastParts = list[list.length - 1]!.parts;
      let grow = lastParts.length - 1;
      for (let p = grow; p >= 0; p--) if (lastParts[p]!.every((bx) => bx.text)) { grow = p; break; }
      let yy = cy;
      list.forEach((s, si) => s.parts.forEach((part, pi) => {
        const h = partH(part) + (si === list.length - 1 && pi === grow ? extra : 0);
        let xx = col * (cw + G);
        for (const bx of part) { put(bx, xx, yy, h, gkey); xx += bx.w + G; }
        yy += h + G;
      }));
    });
    if (c.tail !== undefined) put({ content: { type: 'text', doc: tailDoc! }, w, h: c.tail, text: true }, 0, cy + c.H + G, c.tail, gkey);
    if (blocks.length - start > 1) groups.push({ key: gkey, meta: { ai: deps.run } });
    else for (let j = start; j < blocks.length; j++) { const { group: _g, ...rest } = blocks[j]!; blocks[j] = rest; }
  });
  if (tailAlone && last) { const w = widthOf(last.k), h = measureText(tailDoc!, w); put({ content: { type: 'text', doc: tailDoc! }, w, h, text: true }, 0, tailAlone.y, h); }

  // 빈 자리로 옮긴다 (A4면 앱이 at을 용지 안 여백으로 준다)
  const xs = blocks.map((b) => b.rect);
  const minX = Math.min(...xs.map((r) => r.x)), minY = Math.min(...xs.map((r) => r.y));
  const maxX = Math.max(...xs.map((r) => r.x + r.w)), maxY = Math.max(...xs.map((r) => r.y + r.h));
  const to = deps.sheet ? { x: minX, y: minY } : deps.free({ x: at.x, y: at.y, w: maxX - minX, h: maxY - minY });
  const dx = to.x - minX, dy = to.y - minY;
  return { blocks: blocks.map((b) => ({ ...b, rect: { ...b.rect, x: Math.round(b.rect.x + dx), y: Math.round(b.rect.y + dy) }, ...(b.minH ? { minH: Math.round(b.minH) } : {}) })), groups, arrows: [] };
}

/** 이 응답이 노트형인가 (모드 · 카드가 있을 때) */
export function isSheet(s: { mode?: string; sheet?: StructureSheet }): s is { mode: 'sheet'; sheet: StructureSheet } {
  return s.mode === 'sheet' && !!s.sheet?.sections.length;
}
