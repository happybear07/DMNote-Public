// 링크 언급 (노션 붙여넣기 › 언급, GAP #14): 스키마 · 글자 추출 · 제목 칸 · Markdown · 칩 글자 · 붙여넣기 고르기(빈 줄 넷 · 글 사이 둘)
import { describe, expect, it } from 'vitest';
import { textLines, toTitleDoc, type TextDoc } from '@dn/engine-core';
import { mentionLabel, pmCodec, toNode } from '../src/headless';
import { docToMarkdown } from '../src/to-markdown';
import { pasteUrlChoices } from '../src/paste-url';

const mention = (href: string, title = '') => ({ type: 'link_mention', attrs: { href, title, site: '' } });
const para = (...content: object[]) => ({ type: 'paragraph', content });
const doc = (...content: object[]): TextDoc => ({ type: 'doc', content }) as unknown as TextDoc;

describe('링크 언급', () => {
  const d = doc(para({ type: 'text', text: '참고 ' }, mention('https://www.example.com/a', '예시 문서'), { type: 'text', text: ' 끝' }));

  it('문단 안 인라인 노드로 스키마 검사 통과 · JSON 왕복 · 주소는 꼭', () => {
    expect(pmCodec.validate(d)).toBeNull();
    expect(toNode(d).toJSON()).toEqual(d);
    expect(pmCodec.validate(doc(para({ type: 'link_mention', attrs: { title: 'x' } })))).not.toBeNull();
  });

  it('칩 글자: 제목, 없으면 사이트 주소(www. 뺌)', () => {
    expect(mentionLabel({ href: 'https://www.example.com/a', title: '예시 문서' })).toBe('예시 문서');
    expect(mentionLabel({ href: 'https://www.example.com/a' })).toBe('example.com');
  });

  it('글자 추출(검색 · 미리보기)에는 제목, 제목 칸으로 바꿔도 남는다', () => {
    expect(textLines(d)).toEqual(['참고 예시 문서 끝']);
    expect(JSON.stringify(toTitleDoc(d))).toContain('"link_mention"');
  });

  it('Markdown: [제목](주소), 제목이 없으면 사이트 주소', () => {
    expect(docToMarkdown(d)).toBe('참고 [예시 문서](https://www.example.com/a) 끝');
    expect(docToMarkdown(doc(para(mention('https://example.org/x(1)'))))).toBe('[example.org](https://example.org/x(1%29)');
  });

  it('붙여넣기 고르기: 빈 줄 = 링크 · 언급 · 북마크 (+임베드), 글 사이 = 링크 · 언급', () => {
    expect(pasteUrlChoices('https://example.com/a').map((c) => c.id)).toEqual(['link', 'mention', 'bookmark']);
    expect(pasteUrlChoices('https://youtu.be/dQw4w9WgXcQ').map((c) => c.id)).toEqual(['link', 'mention', 'bookmark', 'embed']);
    expect(pasteUrlChoices('https://youtu.be/dQw4w9WgXcQ', true).map((c) => c.id)).toEqual(['link', 'mention']);
  });
});
