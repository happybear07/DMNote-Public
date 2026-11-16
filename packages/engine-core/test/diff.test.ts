// 변경 이력 비교 (FR-135): 지난 버전 ↔ 지금 — 지운 블록 · 새 블록 · 내용을 고친 블록. 자리만 옮긴 것은 고침이 아니다.
import { describe, expect, it } from 'vitest';
import { createTextBlock, deleteEntities, deserialize, diffBlocks, Engine, serialize, type TextDoc } from '../src';

const reload = (e: Engine) => { const r = deserialize(JSON.parse(JSON.stringify(serialize(e)))); if (!r.ok) throw new Error('round trip'); return new Engine(r.data); };
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }) as TextDoc;

describe('diffBlocks', () => {
  it('같은 노트를 저장본으로 다시 읽으면 차이 없음 (키 순서와 무관)', () => {
    const e = new Engine();
    expect(createTextBlock(e, { x: 0, y: 0 }, { doc: doc('하나') }).ok).toBe(true);
    expect(createTextBlock(e, { x: 0, y: 200 }, { kind: 'title', title: '제목' }).ok).toBe(true);
    const old = reload(e);
    expect(diffBlocks(old, e)).toEqual({ onlyA: [], onlyB: [], changed: [], arrowsA: 0, arrowsB: 0 });
  });

  it('지운 블록 · 새 블록 · 고친 블록, 옮기기만 한 블록은 그대로', () => {
    const e = new Engine();
    const keep = createTextBlock(e, { x: 0, y: 0 }, { doc: doc('그대로') });
    const edit = createTextBlock(e, { x: 0, y: 200 }, { doc: doc('고치기 전') });
    const gone = createTextBlock(e, { x: 0, y: 400 }, { doc: doc('지울 것') });
    if (!keep.ok || !edit.ok || !gone.ok) throw new Error('setup');
    const old = reload(e);
    e.transact((tx) => {
      tx.set('block', keep.value.blockId, { x: 300, y: 50, w: 500 });
      tx.set('content', edit.value.contentId, { doc: doc('고친 뒤') });
    }, { origin: 'user' });
    expect(deleteEntities(e, [gone.value.blockId]).ok).toBe(true);
    const added = createTextBlock(e, { x: 0, y: 600 }, { doc: doc('새 블록') });
    if (!added.ok) throw new Error('add');
    expect(diffBlocks(old, e)).toEqual({ onlyA: [gone.value.blockId], onlyB: [added.value.blockId], changed: [edit.value.blockId], arrowsA: 0, arrowsB: 0 });
  });
});
