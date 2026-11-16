// 문서 뷰에서 여러 글 상자에 걸친 글자 고르기 (워드처럼): 편집기가 닫힌 칸(정적 렌더)의 화면 위치 ↔ 문서 위치,
// 그리고 고른 범위를 지울 때의 스텝. 위치는 "단위"를 세어 맞춘다 — 글자 1개 = 1, 원자(수식 · 노트 링크 · 날짜 · 줄바꿈 · 구분선) = 1,
// 글 덩어리(문단 · 제목 · 코드) 시작 = 1. 정적 렌더(toDOM)와 문서 노드가 같은 차례라 두 쪽이 같은 수를 센다.
import type { TextDoc } from '@dn/engine-core';
import type { Node as PMNode } from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';
import { toNode } from './codec';

const TEXTBLOCK = new Set(['P', 'H1', 'H2', 'H3', 'PRE']);
/** 원자 = 문서의 잎 노드(줄바꿈 · 구분선 · 수식 · 노트 링크 · 날짜)를 그린 요소. 원자가 아닌 contenteditable=false는
 * 문서에 없는 장식(토글 단추 · 콜아웃 아이콘 …)이라 세지 않고 건너뛴다 — 장식이 늘어도 위치가 어긋나지 않게 */
const ATOM = 'br, hr, [data-tex], a.dn-note-link, time.dn-date';
const isAtomEl = (el: Element) => el.matches(ATOM);
const isSkipEl = (el: Element) => !isAtomEl(el) && el.getAttribute('contenteditable') === 'false';

// ───────── 문서 쪽 ─────────

/** 문서 위치 pos 앞의 단위 수 */
export function unitsAtPos(doc: TextDoc, pos: number): number {
  const n = toNode(doc);
  let u = 0;
  n.descendants((node, p) => {
    if (p >= pos) return false;
    if (node.isText) { u += Math.min(node.text!.length, pos - p); return false; }
    if (node.isTextblock) u += 1;
    else if (node.isLeaf) { u += 1; return false; }
    return true;
  });
  return u;
}

function posAtUnitsIn(n: PMNode, target: number): number {
  let u = 0, res: number | null = null;
  n.descendants((node, p) => {
    if (res !== null) return false;
    if (node.isText) {
      const len = node.text!.length;
      if (target <= u + len) { res = p + Math.max(0, target - u); return false; }
      u += len; return false;
    }
    if (node.isTextblock) { u += 1; if (target <= u) { res = p + 1; return false; } return true; }
    if (node.isLeaf) { if (target <= u) { res = p; return false; } u += 1; return false; }
    return true;
  });
  const pos = res ?? n.content.size;
  return TextSelection.near(n.resolve(Math.min(pos, n.content.size))).head;
}

/** 단위 수 → 문서 위치 (글을 쓸 수 있는 가장 가까운 자리) */
export function posAtUnits(doc: TextDoc, units: number): number { return posAtUnitsIn(toNode(doc), units); }

// ───────── 화면 쪽 (정적 렌더) ─────────

/** 정적 렌더 root 안의 화면 지점(node, offset) 앞의 단위 수 */
export function unitsAtDom(root: Node, node: Node, offset: number): number {
  let u = 0, done = false;
  const visit = (n: Node): void => {
    if (done) return;
    if (n.nodeType === Node.TEXT_NODE) {
      if (n === node) { u += Math.min(offset, n.textContent!.length); done = true; return; }
      u += n.textContent!.length; return;
    }
    if (!(n instanceof Element)) return;
    if (n !== root && (isAtomEl(n) || isSkipEl(n))) {
      if (n.contains(node)) { done = true; return; } // 원자 안은 원자 앞으로
      if (!isSkipEl(n)) u += 1;
      return;
    }
    if (n !== root && TEXTBLOCK.has(n.tagName)) u += 1;
    const kids = n.childNodes;
    for (let i = 0; i < kids.length; i++) {
      if (n === node && i === offset) { done = true; return; }
      visit(kids[i]!);
      if (done) return;
    }
    if (n === node) done = true;
  };
  visit(root);
  return u;
}

/** 단위 수 → 정적 렌더 안의 화면 지점 */
export function domAtUnits(root: Node, units: number): { node: Node; offset: number } {
  let u = 0;
  let res: { node: Node; offset: number } | null = null, last: { node: Node; offset: number } = { node: root, offset: root.childNodes.length };
  const visit = (n: Node): void => {
    if (res) return;
    if (n.nodeType === Node.TEXT_NODE) {
      const len = n.textContent!.length;
      if (units <= u + len) { res = { node: n, offset: Math.max(0, units - u) }; return; }
      u += len; last = { node: n, offset: len }; return;
    }
    if (!(n instanceof Element)) return;
    if (n !== root && (isAtomEl(n) || isSkipEl(n))) {
      if (isSkipEl(n)) return;
      const parent = n.parentNode!, i = [...parent.childNodes].indexOf(n as ChildNode);
      if (units <= u) { res = { node: parent, offset: i }; return; }
      u += 1; last = { node: parent, offset: i + 1 }; return;
    }
    if (n !== root && TEXTBLOCK.has(n.tagName)) { u += 1; if (units <= u) { res = { node: n, offset: 0 }; return; } }
    for (const k of n.childNodes) { visit(k); if (res) return; }
  };
  visit(root);
  return res ?? last;
}

// ───────── 지우기 ─────────

/** 같은 칸 안 [from, to) 지우기 스텝 */
export function deleteRangeSteps(doc: TextDoc, from: number, to: number): unknown[] {
  const st = EditorState.create({ doc: toNode(doc) });
  return st.tr.delete(from, to).steps.map((x) => x.toJSON());
}

/**
 * 칸 a의 aPos부터 칸 b의 bPos까지 지울 때: a = a 앞부분 + b 뒷부분(워드처럼 이어 붙임).
 * a가 제목(한 줄)이면 b 뒷부분의 첫 줄 글만 붙이고, 남는 줄은 b에 남긴다(bSteps). b를 통째로 지우면 bSteps는 null.
 */
export function crossDeleteSteps(a: TextDoc, aPos: number, b: TextDoc, bPos: number, aIsTitle: boolean): { aSteps: unknown[]; bSteps: unknown[] | null; caret: number } {
  const an = toNode(a), bn = toNode(b);
  const st = EditorState.create({ doc: an });
  const tr = st.tr;
  if (!aIsTitle) {
    tr.replace(aPos, an.content.size, bn.slice(bPos, bn.content.size));
    return { aSteps: tr.steps.map((x) => x.toJSON()), bSteps: null, caret: aPos };
  }
  // 제목: b 뒷부분 중 bPos가 든 글 덩어리의 남은 글만 붙이고, 그 덩어리까지는 b에서 지운다
  const $b = bn.resolve(bPos);
  if (!$b.parent.isTextblock) return { aSteps: tr.delete(aPos, an.content.size).steps.map((x) => x.toJSON()), bSteps: null, caret: aPos };
  tr.replace(aPos, an.content.size, bn.slice(bPos, $b.end()));
  const bt = EditorState.create({ doc: bn }).tr.delete(0, $b.after());
  const left = bt.doc;
  const empty = !left.textContent && !hasLeaf(left);
  return { aSteps: tr.steps.map((x) => x.toJSON()), bSteps: empty ? null : bt.steps.map((x) => x.toJSON()), caret: aPos };
}

function hasLeaf(n: PMNode): boolean {
  let found = false;
  n.descendants((c) => { if (found) return false; if (c.isLeaf && !c.isText) found = true; return !found; });
  return found;
}
