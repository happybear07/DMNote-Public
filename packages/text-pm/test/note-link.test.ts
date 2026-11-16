// P6 노트 링크 (FR-080): 스키마 · 글자 추출 · 제목 칸 변환
import { describe, expect, it } from 'vitest';
import { docText, textLines, toTitleDoc, type TextDoc } from '@dn/engine-core';
import { pmCodec, toNode } from '../src/headless';

const link = (id: string, title: string) => ({ type: 'note_link', attrs: { id, title } });
const para = (...content: object[]) => ({ type: 'paragraph', content });
const doc = (...content: object[]): TextDoc => ({ type: 'doc', content }) as unknown as TextDoc;

describe('노트 링크', () => {
  const d = doc(para({ type: 'text', text: '참고: ' }, link('n1', '펭귄 연구'), { type: 'text', text: ' 끝' }));

  it('문단 안 인라인 노드로 스키마 검사 통과 · JSON 왕복', () => {
    expect(pmCodec.validate(d)).toBeNull();
    expect(toNode(d).toJSON()).toEqual(d);
  });

  it('id는 꼭 있어야 한다', () => {
    expect(pmCodec.validate(doc(para({ type: 'note_link', attrs: { title: 'x' } })))).not.toBeNull();
  });

  it('글자 추출(검색 · 미리보기)에 링크 당시 제목이 들어간다', () => {
    expect(textLines(d)).toEqual(['참고: 펭귄 연구 끝']);
    expect(docText(doc(para(link('n2', 'A')), para({ type: 'text', text: 'B' })))).toBe('A\nB');
  });

  it('제목 칸으로 바꿔도 링크가 남는다', () => {
    const t = toTitleDoc(d);
    expect(pmCodec.validate(t)).toBeNull();
    expect(JSON.stringify(t)).toContain('"note_link"');
    expect(textLines(t)).toEqual(['참고: 펭귄 연구 끝']);
  });
});
