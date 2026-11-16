// 스키마에 맞지 않는 글 문서 고치기 (SYNC.md 13.4 N7): 두 기기가 같은 글 상자의 구조를 동시에 바꿔 합치면
// (예: 한쪽은 목록 항목을 문단으로, 다른 쪽은 그 항목 안에 줄을 더함) pm-v1 스키마에 맞지 않는 문서가 나올 수 있다.
// 그대로 엔진에 넣으면 I8에 걸린다. 그래서 맞는 최상위 블록은 그대로 두고, 맞지 않는 블록만 같은 글자의 문단으로 펼친다
// — 글자와 서식은 남기고 구조만 잃는다. 결정적이라 모든 기기가 같은 결과를 낸다.
import { bodyDoc, type TextDoc, type TextNode } from '@dn/engine-core';
import { schema } from './schema';

/** 스키마에 안 맞으면 이유, 맞으면 null (pmCodec.validate) */
type Validate = (doc: unknown) => string | null;

const isInline = (n: TextNode): boolean => n.text !== undefined || !!schema.nodes[n.type]?.isInline;

/** 블록 하나를 문단들로 펼친다 — 글 줄(인라인 자식을 가진 노드)마다 문단 하나 */
function flatten(n: TextNode, out: TextNode[], bad: Validate): void {
  const kids = n.content ?? [];
  if (kids.length && kids.some(isInline)) {
    const inline = kids.filter((k) => isInline(k) && !(k.text !== undefined && k.text === ''));
    const tries: TextNode[] = [
      { type: 'paragraph', content: inline },
      { type: 'paragraph', content: inline.filter((k) => k.text !== undefined).map((k) => ({ type: 'text', text: k.text })) },
    ];
    out.push(tries.find((p) => !bad({ type: 'doc', content: [p] })) ?? { type: 'paragraph' });
    // 같은 노드 안에 블록 자식도 섞여 있으면 그것도 펼친다
    for (const k of kids) if (!isInline(k)) flatten(k, out, bad);
    return;
  }
  for (const k of kids) flatten(k, out, bad);
}

const textOf = (n: TextNode): string => (n.text ?? '') + (n.content ?? []).map(textOf).join(n.content?.some((k) => !isInline(k)) ? '\n' : '');

export function repairDoc(doc: unknown, bad: Validate): TextDoc {
  if (!bad(doc)) return doc as TextDoc;
  const d = doc as Partial<TextNode> | null;
  const kids = d && typeof d === 'object' && Array.isArray(d.content) ? (d.content as TextNode[]) : [];
  const out: TextNode[] = [];
  for (const k of kids) {
    if (k && typeof k === 'object' && !bad({ type: 'doc', content: [k] })) out.push(k);
    else if (k && typeof k === 'object') flatten(k, out, bad);
  }
  const fixed = { type: 'doc', content: out.length ? out : [{ type: 'paragraph' }] } as TextDoc;
  if (!bad(fixed)) return fixed;
  // 그래도 안 맞으면 글자만 줄마다 문단으로
  return bodyDoc(kids.map((k) => (k && typeof k === 'object' ? textOf(k) : '')).join('\n'));
}
