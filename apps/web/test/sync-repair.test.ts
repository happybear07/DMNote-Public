// 동기화 다리 + 실제 글 스키마 (SYNC.md 13.4 N7): 두 기기의 동시 구조 편집이 합쳐져 스키마에 안 맞는 글이 와도
// 엔진 규칙(I8)에 막혀 버려지지 않고, 안 맞는 부분만 문단으로 펴서 들인다. 같은 트랜잭션의 다른 변경도 들어간다.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createTextBlock, Engine, newId, setDefaultTextCodec, type TextDoc } from '@dn/engine-core';
import { attach } from '@dn/sync';
import { pmCodec, toNode } from '@dn/text-pm/headless';

beforeAll(() => setDefaultTextCodec(pmCodec));
afterAll(() => setDefaultTextCodec(null));

/** 다른 기기들의 동시 편집이 합쳐진 결과를 받는다: 목록 안에 목록 항목이 아닌 문단(스키마 위반) + 옆 상자 옮김 */
function mergedListCase() {
  const id = newId();
  const a = new Engine({ note: { id, title: '', createdAt: 1, updatedAt: 1 } });
  const list: TextDoc = { type: 'doc', content: [{ type: 'bullet_list', content: [{ type: 'list_item', content: [{ type: 'paragraph', content: [{ type: 'text', text: '항목' }] }] }] }] } as TextDoc;
  const box = createTextBlock(a, { x: 0, y: 0 }, { doc: list });
  const other = createTextBlock(a, { x: 400, y: 0 }, { body: '옆' });
  if (!box.ok || !other.ok) throw new Error('setup');
  const da = new Y.Doc();
  attach(a, da);
  const b = new Engine({ note: { id, title: '', createdAt: 1, updatedAt: 1 } });
  const db = new Y.Doc();
  Y.applyUpdate(db, Y.encodeStateAsUpdate(da));
  const rejected: number[] = [];
  attach(b, db, { onRemote: (_n, r) => { if (r) rejected.push(r); } });

  const remote = new Y.Doc();
  Y.applyUpdate(remote, Y.encodeStateAsUpdate(db));
  remote.transact(() => {
    const frag = remote.getMap<Y.Map<unknown>>('contents').get(box.value.contentId)!.get('doc') as Y.XmlFragment;
    const ul = frag.get(0) as Y.XmlElement;
    const para = new Y.XmlElement('paragraph');
    const t = new Y.XmlText(); t.insert(0, '끼어든 줄');
    para.insert(0, [t]);
    ul.insert(ul.length, [para]);
    remote.getMap<Y.Map<unknown>>('blocks').get(other.value.blockId)!.set('x', 900);
  });
  Y.applyUpdate(db, Y.encodeStateAsUpdate(remote, Y.encodeStateVector(db)), 'peer');

  const doc = (b.getContent(box.value.contentId) as unknown as { doc: TextDoc }).doc;
  return { otherX: b.getBlock(other.value.blockId)!.x, valid: pmCodec.validate(doc) === null, text: toNode(doc).textContent, rejected };
}

describe('합쳐진 글이 스키마에 안 맞을 때', () => {
  it('코덱이 고칠 줄 알면 안 맞는 부분만 문단으로 펴서 들이고, 다른 변경도 반영한다', () => {
    const r = mergedListCase();
    expect(r.otherX).toBe(900);
    expect(r.valid).toBe(true);
    expect(r.text).toContain('끼어든 줄');
    expect(r.text).toContain('항목');
    expect(r.rejected).toEqual([]);
  });

  it('코덱이 고칠 줄 모르면(repair 없음) 그 글 상자 변경만 I8로 빠지고, 다른 변경은 들어간다', () => {
    setDefaultTextCodec({ ...pmCodec, repair: undefined });
    try {
      const r = mergedListCase();
      expect(r.otherX).toBe(900);
      expect(r.rejected).toEqual([1]);
      expect(r.text).not.toContain('끼어든 줄');
    } finally { setDefaultTextCodec(pmCodec); }
  });
});
