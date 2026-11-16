// 텍스트 문서(pm-v1 JSON) ⇄ Y.XmlFragment (FR-097 "같은 텍스트의 동시 편집은 글자 단위로 병합").
// 블록 노드 = Y.XmlElement(노드 이름, 속성은 JSON 문자열), 글 줄(문단 · 제목 · 코드) = Y.XmlElement 안 Y.XmlText 하나 —
// 마크는 서식 속성({mark: attrs | true}), 인라인 원자(줄바꿈 · 노트 링크 · 수식)는 embed.
// 로컬 편집은 최소 차이로 반영한다: 자식 목록의 앞뒤 공통 부분은 그대로 두고 가운데만 바꾸며, 같은 글 줄 하나만 바뀌었으면 글자 단위로 고친다.
import * as Y from 'yjs';
import type { TextDoc, TextMark, TextNode } from '@dn/engine-core';

/** 안에 글자(인라인)만 담는 노드 */
const TEXTBLOCK = new Set(['paragraph', 'heading', 'code_block']);
/** ProseMirror가 정렬해 저장하는 마크 순서 (스키마 순서) */
const MARK_ORDER = ['strong', 'em', 'underline', 'strike', 'highlight', 'code', 'link'];

type YNode = Y.XmlElement | Y.XmlText;

// ───────── Y → JSON ─────────

export function fragmentToDoc(frag: Y.XmlFragment): TextDoc {
  const content = frag.toArray().filter((c): c is Y.XmlElement => c instanceof Y.XmlElement).map(elementToNode);
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
}

function attrsOf(el: Y.XmlElement): Record<string, unknown> | undefined {
  const raw = el.getAttributes() as Record<string, string>;
  const keys = Object.keys(raw);
  if (!keys.length) return undefined;
  const out: Record<string, unknown> = {};
  for (const k of keys.sort()) { try { out[k] = JSON.parse(raw[k]!); } catch { out[k] = raw[k]; } }
  return out;
}

function elementToNode(el: Y.XmlElement): TextNode {
  const attrs = attrsOf(el);
  const base: TextNode = attrs ? { type: el.nodeName, attrs } : { type: el.nodeName };
  if (TEXTBLOCK.has(el.nodeName)) {
    const t = el.toArray().find((c): c is Y.XmlText => c instanceof Y.XmlText);
    const inline = t ? deltaToInline(t.toDelta() as DeltaOp[]) : [];
    return inline.length ? { ...base, content: inline } : base;
  }
  const kids = el.toArray().filter((c): c is Y.XmlElement => c instanceof Y.XmlElement).map(elementToNode);
  return kids.length ? { ...base, content: kids } : base;
}

interface DeltaOp { insert: string | Record<string, unknown>; attributes?: Record<string, unknown> }

function marksOf(a: Record<string, unknown> | undefined): TextMark[] | undefined {
  if (!a) return undefined;
  const ms = Object.entries(a).filter(([, v]) => v !== null && v !== undefined && v !== false)
    .map(([type, v]): TextMark => (v === true ? { type } : { type, attrs: v as Record<string, unknown> }))
    .sort((x, y) => MARK_ORDER.indexOf(x.type) - MARK_ORDER.indexOf(y.type));
  return ms.length ? ms : undefined;
}

function deltaToInline(ops: readonly DeltaOp[]): TextNode[] {
  const out: TextNode[] = [];
  for (const op of ops) {
    if (typeof op.insert === 'string') {
      if (!op.insert) continue;
      const marks = marksOf(op.attributes);
      const prev = out[out.length - 1];
      if (prev?.text !== undefined && JSON.stringify(prev.marks) === JSON.stringify(marks)) out[out.length - 1] = { ...prev, text: prev.text + op.insert };
      else out.push(marks ? { type: 'text', text: op.insert, marks } : { type: 'text', text: op.insert });
    } else out.push(structuredClone(op.insert) as unknown as TextNode);
  }
  return out;
}

// ───────── JSON → Y (새로 만들기) ─────────

function buildElement(n: TextNode): Y.XmlElement {
  const el = new Y.XmlElement(n.type);
  for (const [k, v] of Object.entries(n.attrs ?? {})) el.setAttribute(k, JSON.stringify(v));
  if (TEXTBLOCK.has(n.type)) {
    const t = new Y.XmlText();
    el.insert(0, [t]);
    insertUnits(t, 0, unitsOf(n.content ?? []));
  } else {
    el.insert(0, (n.content ?? []).map(buildElement));
  }
  return el;
}

/** 문서 전체를 새 조각으로 (처음 한 번) */
export function writeDoc(frag: Y.XmlFragment, doc: TextDoc): void {
  if (frag.doc && frag.length) frag.delete(0, frag.length);
  frag.insert(0, doc.content.map(buildElement));
}

// ───────── 글자 단위 ─────────

/** 글 한 칸: 글자 하나(UTF-16 코드 단위) + 서식, 또는 원자 노드 하나 */
type Unit = { ch: string; attrs: Record<string, unknown>; key: string } | { embed: Record<string, unknown>; key: string };

function attrsFromMarks(marks: readonly TextMark[] | undefined): Record<string, unknown> {
  const a: Record<string, unknown> = {};
  for (const m of marks ?? []) a[m.type] = m.attrs && Object.keys(m.attrs).length ? m.attrs : true;
  return a;
}

function unitsOf(inline: readonly TextNode[]): Unit[] {
  const out: Unit[] = [];
  for (const n of inline) {
    if (n.text !== undefined) {
      const attrs = attrsFromMarks(n.marks);
      const k = JSON.stringify(attrs);
      for (const ch of n.text.split('')) out.push({ ch, attrs, key: ch + k });
    } else {
      const embed = structuredClone(n) as unknown as Record<string, unknown>;
      out.push({ embed, key: `\u0000${JSON.stringify(embed)}` });
    }
  }
  return out;
}

/** 같은 서식의 글자는 한 번에 넣는다 */
function insertUnits(t: Y.XmlText, at: number, units: readonly Unit[]): void {
  let i = 0, pos = at;
  while (i < units.length) {
    const u = units[i]!;
    if ('embed' in u) { t.insertEmbed(pos, u.embed); pos++; i++; continue; }
    let s = u.ch;
    let j = i + 1;
    while (j < units.length && 'ch' in units[j]! && JSON.stringify((units[j] as { attrs: unknown }).attrs) === JSON.stringify(u.attrs)) { s += (units[j] as { ch: string }).ch; j++; }
    // 서식 키를 모두 적는다 — 없는 마크는 null로 지워 앞 글자 서식을 물려받지 않게
    const attrs: Record<string, unknown> = { ...Object.fromEntries(MARK_ORDER.map((m) => [m, null])), ...u.attrs };
    t.insert(pos, s, attrs);
    pos += s.length;
    i = j;
  }
}

function diffText(t: Y.XmlText, inline: readonly TextNode[]): void {
  const cur = unitsOf(deltaToInline(t.toDelta() as DeltaOp[]));
  const want = unitsOf(inline);
  let a = 0;
  while (a < cur.length && a < want.length && cur[a]!.key === want[a]!.key) a++;
  let b = 0;
  while (b < cur.length - a && b < want.length - a && cur[cur.length - 1 - b]!.key === want[want.length - 1 - b]!.key) b++;
  const del = cur.length - a - b;
  if (del > 0) t.delete(a, del);
  insertUnits(t, a, want.slice(a, want.length - b));
}

// ───────── JSON → Y (최소 차이) ─────────

const sameNode = (y: YNode, n: TextNode): boolean => y instanceof Y.XmlElement && JSON.stringify(elementToNode(y)) === JSON.stringify(n);

function syncAttrs(el: Y.XmlElement, attrs: Readonly<Record<string, unknown>> | undefined): void {
  const want = attrs ?? {};
  const have = el.getAttributes() as Record<string, string>;
  for (const k of Object.keys(have)) if (!(k in want)) el.removeAttribute(k);
  for (const [k, v] of Object.entries(want)) { const s = JSON.stringify(v); if (have[k] !== s) el.setAttribute(k, s); }
}

function syncChildren(parent: Y.XmlFragment | Y.XmlElement, nodes: readonly TextNode[]): void {
  const cur = parent.toArray().filter((c): c is Y.XmlElement => c instanceof Y.XmlElement);
  let a = 0;
  while (a < cur.length && a < nodes.length && sameNode(cur[a]!, nodes[a]!)) a++;
  let b = 0;
  while (b < cur.length - a && b < nodes.length - a && sameNode(cur[cur.length - 1 - b]!, nodes[nodes.length - 1 - b]!)) b++;
  const midCur = cur.slice(a, cur.length - b), midNew = nodes.slice(a, nodes.length - b);
  // 같은 종류 하나가 바뀌었으면 그 안에서 (글 줄이면 글자 단위)
  if (midCur.length === 1 && midNew.length === 1 && midCur[0]!.nodeName === midNew[0]!.type) {
    const el = midCur[0]!, n = midNew[0]!;
    syncAttrs(el, n.attrs);
    if (TEXTBLOCK.has(n.type)) {
      let t = el.toArray().find((c): c is Y.XmlText => c instanceof Y.XmlText);
      if (!t) { t = new Y.XmlText(); el.insert(0, [t]); }
      diffText(t, n.content ?? []);
    } else syncChildren(el, n.content ?? []);
    return;
  }
  if (midCur.length) parent.delete(a, midCur.length);
  if (midNew.length) parent.insert(a, midNew.map(buildElement));
}

/** 지금 조각을 이 문서와 같게 — 바뀐 곳만 */
export function syncDoc(frag: Y.XmlFragment, doc: TextDoc): void { syncChildren(frag, doc.content); }
