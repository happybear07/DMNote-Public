// 목차 (FR-053): 제목 상자(1단계) · 글 속 제목 1~3을 읽는 순서대로, 단계 제한, 바뀌면 표식이 바뀐다. 직렬화 왕복.
import { describe, expect, it } from 'vitest';
import { createTextBlock, deserialize, Engine, readingOrder, serialize, tocEntries, tocSignature, type TextDoc } from '../src';

const h = (level: number, text: string) => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] });
const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const doc = (...content: unknown[]) => ({ type: 'doc', content }) as TextDoc;

function sample() {
  const e = new Engine();
  const right = createTextBlock(e, { x: 400, y: 210 }, { doc: doc(h(2, '비용'), p('본문'), h(3, '세부 비용')) });
  const top = createTextBlock(e, { x: 0, y: 0 }, { kind: 'title', title: '프로젝트 개요' });
  const left = createTextBlock(e, { x: 0, y: 200 }, { doc: doc(p('제목 없는 글'), h(2, '일정'), h(1, '')) });
  if (!right.ok || !top.ok || !left.ok) throw new Error('setup');
  return { e, right: right.value, top: top.value, left: left.value };
}

describe('목차', () => {
  it('읽는 순서(위 → 아래, 같은 줄은 왼쪽 → 오른쪽) · 제목 상자 = 1단계 · 빈 제목은 뺀다', () => {
    const { e, top, left, right } = sample();
    expect(readingOrder(e.blocks()).map((b) => b.id)).toEqual([top.blockId, left.blockId, right.blockId]);
    expect(tocEntries(e).map((x) => `${x.level} ${x.text}`)).toEqual(['1 프로젝트 개요', '2 일정', '2 비용', '3 세부 비용']);
    expect(tocEntries(e)[1]!.blockId).toBe(left.blockId);
  });

  it('단계 제한 · 제목을 고치면 표식이 바뀐다', () => {
    const { e, right } = sample();
    expect(tocEntries(e, 2).map((x) => x.text)).toEqual(['프로젝트 개요', '일정', '비용']);
    const before = tocSignature(tocEntries(e));
    expect(e.transact((tx) => tx.set('content', right.contentId, { doc: doc(h(2, '예산'), p('본문')) }), { origin: 'user' }).ok).toBe(true);
    expect(tocSignature(tocEntries(e))).not.toBe(before);
    expect(tocEntries(e).map((x) => x.text)).toEqual(['프로젝트 개요', '일정', '예산']);
  });

  it('목차 콘텐츠는 직렬화 왕복에서 그대로', () => {
    const { e } = sample();
    const r = e.transact((tx) => { const b = tx.createBlock({ x: 0, y: 600, w: 300, h: 160 }); return tx.createContent({ blockId: b, type: 'toc', depth: 2 }); }, { origin: 'user' });
    expect(r.ok).toBe(true);
    const back = deserialize(serialize(e));
    expect(back.ok).toBe(true);
    if (back.ok) {
      const toc = [...back.data.contents].find((c) => c.type === 'toc') as { depth?: number } | undefined;
      expect(toc?.depth).toBe(2);
    }
  });
});
