// [[위키링크]] → 노트 링크 노드 (FR-125 가져오기). 글자 노드를 걸어 '[[이름]]' · '[[이름|별칭]]' · '[[이름#제목]]'을 찾고,
// 찾은 노트가 있으면 note_link로 바꾼다. 못 찾으면 글자 그대로 둔다. 코드 블록 · 인라인 코드 안은 건드리지 않는다.
import type { TextDoc, TextNode } from '@dn/engine-core';

const WIKI = /\[\[([^[\]|#]+)(?:#[^[\]|]*)?(?:\|[^[\]]*)?\]\]/g;

export interface WikiTarget { id: string; title: string }

/** 바꾼 문서와 링크 수 · 못 찾은 이름 */
export function linkWikiLinks(doc: TextDoc, resolve: (name: string) => WikiTarget | null): { doc: TextDoc; linked: number; missing: string[] } {
  let linked = 0;
  const missing: string[] = [];
  const walk = (n: TextNode): TextNode => {
    if (n.type === 'code_block') return n;
    if (!n.content) return n;
    const out: TextNode[] = [];
    for (const k of n.content) {
      if (k.text === undefined || k.marks?.some((m) => m.type === 'code')) { out.push(k.text === undefined ? walk(k) : k); continue; }
      let last = 0;
      for (const m of k.text.matchAll(WIKI)) {
        const target = resolve(m[1]!.trim());
        if (!target) { missing.push(m[1]!.trim()); continue; }
        if (m.index! > last) out.push({ ...k, text: k.text.slice(last, m.index) });
        out.push({ type: 'note_link', attrs: { id: target.id, title: target.title } });
        linked++;
        last = m.index! + m[0].length;
      }
      if (last === 0) out.push(k);
      else if (last < k.text.length) out.push({ ...k, text: k.text.slice(last) });
    }
    return { ...n, content: out };
  };
  return { doc: walk(doc) as TextDoc, linked, missing };
}
