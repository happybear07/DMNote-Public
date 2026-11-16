// 헤드리스 텍스트 코덱: 엔진의 텍스트 Op(스텝 JSON)를 적용하고 역스텝을 계산한다 (ENGINE 5.6).
// DOM을 쓰지 않으므로 Node 테스트에서도 동작한다.
import type { TextCodec, TextDoc } from '@dn/engine-core';
import { Node as PMNode } from 'prosemirror-model';
import { Step } from 'prosemirror-transform';
import { repairDoc } from './repair';
import { schema } from './schema';

export const TEXT_SCHEMA_ID = 'pm-v1';

// 같은 JSON 객체를 반복해서 파싱하지 않도록 캐시한다 (문서 JSON은 불변).
const nodeCache = new WeakMap<object, PMNode>();
const jsonCache = new WeakMap<PMNode, TextDoc>();

export function toNode(doc: TextDoc): PMNode {
  let n = nodeCache.get(doc);
  if (!n) {
    n = schema.nodeFromJSON(doc);
    nodeCache.set(doc, n);
    jsonCache.set(n, doc);
  }
  return n;
}

export function toJSON(n: PMNode): TextDoc {
  let j = jsonCache.get(n);
  if (!j) {
    j = n.toJSON() as TextDoc;
    jsonCache.set(n, j);
    nodeCache.set(j, n);
  }
  return j;
}

export const pmCodec: TextCodec = {
  id: TEXT_SCHEMA_ID,
  apply(doc, steps) {
    let node = toNode(doc);
    const inverses: unknown[] = [];
    for (const raw of steps) {
      const step = Step.fromJSON(schema, raw);
      const r = step.apply(node);
      if (r.failed || !r.doc) throw new Error(r.failed ?? 'step 적용 실패');
      inverses.push(step.invert(node).toJSON());
      node = r.doc;
    }
    return { doc: toJSON(node), inverse: inverses.reverse() };
  },
  validate(doc) {
    try {
      toNode(doc as TextDoc).check();
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  },
  repair(doc) { return repairDoc(doc, pmCodec.validate); },
};
