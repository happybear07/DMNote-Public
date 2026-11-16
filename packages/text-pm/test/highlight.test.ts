// 코드 구문 강조 (FR-026): 언어 이름 정리 · 언어별 토큰 (주석 · 문자열 · 숫자 · 키워드 · 함수 · 키 · 태그)
import { describe, expect, it } from 'vitest';
import { CODE_LANGUAGES, normalizeLanguage, tokenizeCode } from '../src/highlight';

const toks = (code: string, lang: string) => tokenizeCode(code, lang).map((t) => `${t.cls}:${code.slice(t.from, t.to)}`);

describe('코드 강조', () => {
  it('언어 이름: 별칭 · language- 접두 · 모르는 언어', () => {
    expect(normalizeLanguage('JS')).toBe('javascript');
    expect(normalizeLanguage('language-ts')).toBe('typescript');
    expect(normalizeLanguage('py')).toBe('python');
    expect(normalizeLanguage('brainfuck')).toBe('');
    expect(CODE_LANGUAGES[0]).toEqual({ id: '', name: '일반 텍스트' });
  });

  it('JavaScript: 키워드 · 함수 · 문자열 · 숫자 · 주석 · 템플릿 문자열', () => {
    expect(toks('const n = sum(1, 2.5); // 합\nreturn `a${n}`', 'js')).toEqual([
      'kw:const', 'fn:sum', 'num:1', 'num:2.5', 'com:// 합', 'kw:return', 'str:`a${n}`',
    ]);
  });

  it('Python: 삼중 따옴표 · # 주석 · 리터럴', () => {
    expect(toks('def f(x):\n    """doc"""\n    return None  # 없음', 'python')).toEqual(['kw:def', 'fn:f', 'str:"""doc"""', 'kw:return', 'lit:None', 'com:# 없음']);
  });

  it('SQL은 대소문자 무시 · JSON 키와 값 구분', () => {
    expect(toks('SELECT name FROM t WHERE id = 3', 'sql')).toEqual(['kw:SELECT', 'kw:FROM', 'kw:WHERE', 'num:3']);
    expect(toks('{"a": "b", "n": 1, "ok": true}', 'json')).toEqual(['key:"a"', 'str:"b"', 'key:"n"', 'num:1', 'key:"ok"', 'lit:true']);
  });

  it('HTML: 태그 · 속성 · 속성 값, 본문 따옴표는 문자열이 아님', () => {
    expect(toks(`<a href="x">Don't</a>`, 'html')).toEqual(['tag:<a', 'attr:href', 'str:"x"', 'tag:>', 'tag:</a', 'tag:>']);
  });

  it('CSS: 속성 · 색 · 단위, 선택자 안 숫자는 아님', () => {
    expect(toks('h1:hover { color: #fff; margin: 4px; }', 'css')).toEqual(['attr:color', 'num:#fff', 'attr:margin', 'num:4px']);
  });

  it('닫히지 않은 문자열 · 주석도 멈추지 않고, 모르는 언어는 강조 없음', () => {
    expect(toks('"abc', 'js')).toEqual(['str:"abc']);
    expect(toks('/* 열린 주석', 'c')).toEqual(['com:/* 열린 주석']);
    expect(tokenizeCode('anything', '')).toEqual([]);
  });
});

describe('코드 언어 저장', () => {
  it('마크다운 ```언어 펜스 읽기 · 쓰기 왕복, 모르는 언어는 빈 값', async () => {
    const { markdownToDoc, docToMarkdown } = await import('../src/headless');
    const doc = markdownToDoc('```ts\nconst a = 1\n```');
    expect(doc.content?.[0]).toMatchObject({ type: 'code_block', attrs: { language: 'typescript' } });
    expect(docToMarkdown(doc)).toBe('```typescript\nconst a = 1\n```');
    expect(markdownToDoc('```nope\nx\n```').content?.[0]?.attrs).toBeUndefined();
  });
});
