// 찾아 바꾸기 (FR-123): 텍스트 문서에서 글자 찾기 · 바꾸는 스텝 만들기. DOM 없이 동작 (헤드리스).
// 한 글자 조각(같은 서식) 안에서만 찾는다 — 서식이 바뀌는 경계를 넘는 일치는 바꾸면 서식이 깨지므로 찾지 않는다.
// 바꾼 글자는 원래 조각의 서식을 이어받는다. 코드 블록 안도 찾는다(글자 그대로).
import type { TextDoc } from '@dn/engine-core';
import { Transform } from 'prosemirror-transform';
import { toJSON, toNode } from './codec';
import { schema } from './schema';

export interface FindOptions { caseSensitive?: boolean }
export interface TextMatch { from: number; to: number; text: string }

const norm = (s: string, cs?: boolean) => (cs ? s : s.toLowerCase());

/** 문서 안 일치 위치 (문서 순서) */
export function findInDoc(doc: TextDoc, query: string, opts: FindOptions = {}): TextMatch[] {
  if (!query) return [];
  const q = norm(query, opts.caseSensitive);
  const out: TextMatch[] = [];
  toNode(doc).descendants((n, pos) => {
    if (!n.isText || !n.text) return true;
    const t = norm(n.text, opts.caseSensitive);
    for (let i = t.indexOf(q); i >= 0; i = t.indexOf(q, i + q.length)) {
      out.push({ from: pos + i, to: pos + i + q.length, text: n.text.slice(i, i + q.length) });
    }
    return false;
  });
  return out;
}

/** 바꾸는 스텝과 결과 문서. `only`: 이 위치의 일치만(하나씩 바꾸기), 없으면 모두. 바꿀 게 없으면 null. */
export function replaceSteps(doc: TextDoc, query: string, replacement: string, opts: FindOptions & { only?: number } = {}): { steps: unknown[]; doc: TextDoc; count: number } | null {
  let matches = findInDoc(doc, query, opts);
  if (opts.only !== undefined) matches = matches.filter((m) => m.from === opts.only);
  if (!matches.length) return null;
  const node = toNode(doc);
  const t = new Transform(node);
  // 뒤에서부터 바꿔야 앞쪽 위치가 밀리지 않는다
  for (const m of [...matches].reverse()) {
    const marks = node.resolve(m.from + 1).marks();
    if (replacement) t.replaceWith(m.from, m.to, schema.text(replacement, marks));
    else t.delete(m.from, m.to);
  }
  return { steps: t.steps.map((s) => s.toJSON()), doc: toJSON(t.doc), count: matches.length };
}

/** `from` 문서를 `to` 문서로 바꾸는 스텝 (바꾸기 되돌리기 — 닫힌 노트는 실행 취소 기록이 없어서) */
export function docReplaceSteps(from: TextDoc, to: TextDoc): unknown[] {
  const a = toNode(from), b = toNode(to);
  if (a.eq(b)) return [];
  const t = new Transform(a).replaceWith(0, a.content.size, b.content);
  return t.steps.map((s) => s.toJSON());
}
