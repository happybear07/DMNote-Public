// 수식 (FR-018): Markdown $식$ · $$블록$$ 읽기 · 쓰기 왕복, 돈 표기는 수식이 아님, 스키마 검증, 검색 글자
import { describe, expect, it } from 'vitest';
import { docText, textLines } from '@dn/engine-core';
import { docToMarkdown, markdownToDoc, pmCodec } from '../src/headless';

describe('수식', () => {
  it('인라인 $식$ · 블록 $$ … $$ 읽기', () => {
    const d = markdownToDoc('넓이는 $\\pi r^2$ 이다.\n\n$$\n\\sum_{i=1}^n i = \\frac{n(n+1)}{2}\n$$\n\n한 줄 $$E=mc^2$$');
    expect(pmCodec.validate(d)).toBeNull();
    const p = d.content[0]!;
    expect(p.content!.find((n) => n.type === 'math_inline')?.attrs?.tex).toBe('\\pi r^2');
    expect(d.content[1]).toEqual({ type: 'math_block', attrs: { tex: '\\sum_{i=1}^n i = \\frac{n(n+1)}{2}' } });
    expect(d.content.at(-1)!.content!.find((n) => n.type === 'math_inline')?.attrs?.tex).toBe('E=mc^2');
  });

  it('돈 표기는 수식이 아니다', () => {
    const d = markdownToDoc('가격은 $5 그리고 $10 이다. 합계 $15$');
    expect(JSON.stringify(d)).not.toContain('math_inline');
  });

  it('Markdown 쓰기 왕복', () => {
    const src = '식 $a^2+b^2=c^2$ 끝\n\n$$\n\\int_0^1 x\\,dx\n$$';
    const d = markdownToDoc(src);
    const md = docToMarkdown(d);
    expect(md).toContain('$a^2+b^2=c^2$');
    expect(md).toContain('$$\n\\int_0^1 x\\,dx\n$$');
    expect(markdownToDoc(md)).toEqual(d);
  });

  it('검색 · 미리보기 글자는 LaTeX 원문', () => {
    const d = markdownToDoc('식 $x^2$ 끝\n\n$$\ny=mx+b\n$$');
    expect(textLines(d)).toEqual(['식 x^2 끝', 'y=mx+b']);
    expect(docText(d)).toContain('y=mx+b');
  });
});

describe('수식 입력 도우미', () => {
  it('도우미 판의 모든 틀 · 기호 · 공식이 올바른 LaTeX (빈칸을 채우면 오류 없음)', async () => {
    const { MATH_GROUPS, texError } = await import('../src/math-palette');
    const bad = MATH_GROUPS.flatMap((g) => g.items).filter((it) => texError(it.tex.replace(/\{\}/g, '{x}'), true) !== null).map((it) => it.label);
    expect(bad).toEqual([]);
    expect(MATH_GROUPS.flatMap((g) => g.items).length).toBeGreaterThan(80);
  });

  it('문법 오류는 무엇이 틀렸는지 알려 주고, 빈 수식 · 맞는 수식은 오류 없음', async () => {
    const { texError } = await import('../src/math-palette');
    expect(texError('', true)).toBeNull();
    expect(texError(String.raw`\frac{a}{b}`, true)).toBeNull();
    expect(texError(String.raw`\frac{a}{b`, true)).toMatch(/Expected|end of input/i);
    expect(texError(String.raw`\nosuchcommand`, false)).toMatch(/Undefined control sequence/);
    expect(texError('x^', true)).toMatch(/Expected group/);
  });
});
