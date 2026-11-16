// 노트형 글 요소 (NS-07 · 08 · 09 · 10): 칩 마크 · 별점 노드가 스키마 검사 통과 · Markdown(칩 → `칩`, 별점 → ★) ·
// 형광펜 ==…== 왕복 · 콜아웃 > [!tip] 읽기 · 별점 글자(값 · 최댓값 범위)
import { describe, expect, it } from 'vitest';
import type { TextDoc } from '@dn/engine-core';
import { pmCodec } from '../src/headless';
import { docToMarkdown } from '../src/to-markdown';
import { markdownToDoc } from '../src/markdown';
import { ratingStars } from '../src/schema';

const para = (...content: object[]) => ({ type: 'paragraph', content });
const doc = (...content: object[]): TextDoc => ({ type: 'doc', content }) as unknown as TextDoc;
const chip = (text: string, color = '') => ({ type: 'text', text, marks: [{ type: 'chip', attrs: { color } }] });

describe('노트형 글 요소', () => {
  it('칩 · 별점이 든 문단은 스키마 검사 통과', () => {
    const d = doc(para(chip('소속감', 'blue'), { type: 'text', text: ' ' }, chip('인정')), para({ type: 'text', text: '공감 ' }, { type: 'rating', attrs: { value: 4, max: 5 } }));
    expect(pmCodec.validate(d)).toBeNull();
  });

  it('Markdown: 칩 → `칩`, 별점 → ★★★★☆, 형광펜 → ==…==', () => {
    const d = doc(para(chip('소속감')), para({ type: 'rating', attrs: { value: 4, max: 5 } }), para({ type: 'text', text: '중요', marks: [{ type: 'highlight' }] }));
    expect(docToMarkdown(d)).toBe('`소속감`\n\n★★★★☆\n\n==중요==');
  });

  it('형광펜 ==…== 읽기', () => {
    const p = markdownToDoc('핵심은 ==인정 욕구==다').content[0] as { content: { text: string; marks?: { type: string }[] }[] };
    expect(p.content.find((n) => n.text === '인정 욕구')?.marks?.[0]?.type).toBe('highlight');
  });

  it('콜아웃 > [!tip] 읽기 — 종류 → 아이콘 · 색, 첫 줄 글도 본문으로', () => {
    const d = markdownToDoc('> [!warning] 주의할 점\n> 둘째 줄');
    expect(d.content[0]).toMatchObject({ type: 'callout', attrs: { icon: 'alert', color: 'yellow' } });
    expect(JSON.stringify(d.content[0])).toContain('주의할 점');
    expect(pmCodec.validate(d)).toBeNull();
    expect(markdownToDoc('> 그냥 인용').content[0]!.type).toBe('blockquote');
  });

  it('별점 글자: 값은 0 ~ 최댓값, 최댓값은 1 ~ 10', () => {
    expect(ratingStars(3, 5)).toBe('★★★☆☆');
    expect(ratingStars(9, 5)).toBe('★★★★★');
    expect(ratingStars(-1, 3)).toBe('☆☆☆');
    expect(ratingStars(2, 40).length).toBe(10);
  });
});
