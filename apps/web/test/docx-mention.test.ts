// 워드 내보내기: 링크 언급 칩(GAP #14) → 하이퍼링크(제목 글자, 없으면 주소), 앞뒤 글은 링크 밖
import { describe, expect, it } from 'vitest';
import type { TextNode } from '@dn/engine-core';
import { textToOoxml, type DocxCtx } from '../src/docx/docx-text';

const links: string[] = [];
const ctx: DocxCtx = { link: (h) => { links.push(h); return `rId${links.length}`; }, footnote: () => 1, orderedList: () => 1, noteTitle: () => null, xref: () => null };

describe('워드 내보내기 · 링크 언급', () => {
  it('칩 → 하이퍼링크 하나, 글자는 제목', () => {
    const doc: TextNode = { type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: '참고 ' }, { type: 'link_mention', attrs: { href: 'https://example.com/a', title: '예시 문서', site: '' } }, { type: 'text', text: ' 끝' },
    ] }] };
    const xml = textToOoxml(doc, ctx).join('');
    expect(links).toEqual(['https://example.com/a']);
    expect(xml).toMatch(/참고 <\/w:t><\/w:r><w:hyperlink r:id="rId1"[^>]*>.*예시 문서.*<\/w:hyperlink>.* 끝/);
    expect(xml.match(/<w:hyperlink/g)).toHaveLength(1);
  });
});
