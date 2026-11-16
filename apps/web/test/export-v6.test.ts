// Markdown 내보내기 (노트 v6): 화살표 관계 종류가 라벨(원문 구절)과 따로 "관계: …"로 나온다. 모르는 관계 값은 그대로.
import { describe, expect, it } from 'vitest';
import { createTextBlock, Engine, type TextDoc } from '@dn/engine-core';
import { noteToMarkdown } from '../src/export';

const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }) as TextDoc;

describe('Markdown 내보내기 v6', () => {
  it('관계 목록에 관계 종류', () => {
    const e = new Engine();
    const ids = ['금리 인상', '물가 안정', '새 관계'].map((t, i) => {
      const r = createTextBlock(e, { x: 0, y: i * 200 }, { doc: doc(t) });
      if (!r.ok) throw new Error(r.reason);
      return r.value.blockId;
    });
    e.transact((tx) => {
      tx.createArrow({ from: { blockId: ids[0]!, side: 'auto' }, to: { blockId: ids[1]!, side: 'auto' }, label: '그래서', relation: 'causes' });
      tx.createArrow({ from: { blockId: ids[1]!, side: 'auto' }, to: { blockId: ids[2]!, side: 'auto' }, relation: 'future-relation' });
      tx.createArrow({ from: { blockId: ids[2]!, side: 'auto' }, to: { blockId: ids[0]!, side: 'auto' } });
    }, { origin: 'user' });
    const md = noteToMarkdown(e, { id: e.note.id, title: '관계', createdAt: 0, updatedAt: 0 }, { noteTitle: () => null });
    expect(md).toContain('- 금리 인상 → 물가 안정 (그래서) · 관계: 원인 → 결과');
    expect(md).toContain('- 물가 안정 → 새 관계 · 관계: future-relation');
    expect(md).toContain('- 새 관계 → 금리 인상\n');
  });

  it('이름 있는 묶음은 첫 상자 앞에 소제목 한 번 (문서 뷰와 같게)', () => {
    const e = new Engine();
    const ids = ['배포 결정', '명세 작성', '따로'].map((t, i) => { const r = createTextBlock(e, { x: 0, y: i * 200 }, { doc: doc(t) }); if (!r.ok) throw new Error(r.reason); return r.value.blockId; });
    e.transact((tx) => { tx.set('block', ids[0]!, { group: 'g' }); tx.set('block', ids[1]!, { group: 'g' }); tx.setNote({ groups: { g: { name: '결정 사항' } } }); }, { origin: 'user' });
    const md = noteToMarkdown(e, { id: e.note.id, title: '회의', createdAt: 0, updatedAt: 0 }, { noteTitle: () => null });
    expect(md.match(/### 결정 사항/g)).toHaveLength(1);
    expect(md.indexOf('### 결정 사항')).toBeLessThan(md.indexOf('배포 결정'));
  });
});
