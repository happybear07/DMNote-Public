// 상호 참조 (워드 삽입 › 상호 참조): 스키마 · 글자 추출 · 제목 칸 변환 · Markdown (지금 번호, 없으면 넣을 때 번호)
import { describe, expect, it } from 'vitest';
import { textLines, toTitleDoc, type TextDoc } from '@dn/engine-core';
import { pmCodec, toNode } from '../src/headless';
import { docToMarkdown } from '../src/to-markdown';

const xref = (id: string, label: string) => ({ type: 'xref', attrs: { id, label } });
const para = (...content: object[]) => ({ type: 'paragraph', content });
const doc = (...content: object[]): TextDoc => ({ type: 'doc', content }) as unknown as TextDoc;

describe('상호 참조', () => {
  const d = doc(para({ type: 'text', text: '결과는 ' }, xref('b1', '그림 2'), { type: 'text', text: '를 보라' }));

  it('문단 안 인라인 노드로 스키마 검사 통과 · JSON 왕복 · id는 꼭', () => {
    expect(pmCodec.validate(d)).toBeNull();
    expect(toNode(d).toJSON()).toEqual(d);
    expect(pmCodec.validate(doc(para({ type: 'xref', attrs: { label: '그림 1' } })))).not.toBeNull();
  });

  it('글자 추출(검색 · 미리보기)에는 넣을 때 번호, 제목 칸으로 바꿔도 남는다', () => {
    expect(textLines(d)).toEqual(['결과는 그림 2를 보라']);
    expect(JSON.stringify(toTitleDoc(d))).toContain('"xref"');
  });

  it('Markdown: 지금 번호 (없으면 넣을 때 번호)', () => {
    expect(docToMarkdown(d, { xref: (id) => (id === 'b1' ? '그림 1' : null) })).toBe('결과는 그림 1를 보라');
    expect(docToMarkdown(d, { xref: () => null })).toBe('결과는 그림 2를 보라');
  });
});
