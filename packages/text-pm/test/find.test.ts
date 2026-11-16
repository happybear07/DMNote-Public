// 찾아 바꾸기 (FR-123)
import { describe, expect, it } from 'vitest';
import type { TextDoc } from '@dn/engine-core';
import { findInDoc, markdownToDoc, pmCodec, replaceSteps } from '../src/headless';

describe('찾아 바꾸기', () => {
  const d = markdownToDoc('사과는 **사과**다. Apple과 apple\n\n- 사과 목록');

  it('찾기: 대소문자 · 서식 조각 안', () => {
    expect(findInDoc(d, '사과').length).toBe(3);
    expect(findInDoc(d, 'apple').length).toBe(2);
    expect(findInDoc(d, 'apple', { caseSensitive: true }).length).toBe(1);
    expect(findInDoc(d, '')).toEqual([]);
  });

  it('모두 바꾸기: 서식 유지 · 스텝을 원래 문서에 적용하면 같은 결과', () => {
    const r = replaceSteps(d, '사과', '배')!;
    expect(r.count).toBe(3);
    const json = JSON.stringify(r.doc);
    expect(json).not.toContain('사과');
    expect(json).toContain('{"type":"text","marks":[{"type":"strong"}],"text":"배"}');
    expect(pmCodec.apply(d as TextDoc, r.steps).doc).toEqual(r.doc);
  });

  it('하나씩 바꾸기 · 지우기 · 없으면 null', () => {
    const first = findInDoc(d, '사과')[1]!;
    const r = replaceSteps(d, '사과', '배', { only: first.from })!;
    expect(r.count).toBe(1);
    expect(findInDoc(r.doc, '사과').length).toBe(2);
    expect(findInDoc(replaceSteps(d, 'apple', '')!.doc, 'apple').length).toBe(0);
    expect(replaceSteps(d, '없는 말', 'x')).toBeNull();
  });
});
