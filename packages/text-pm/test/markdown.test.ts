import { describe, expect, it } from 'vitest';
import { looksLikeMarkdown, markdownToDoc, pmCodec, plainTextToDoc, toNode } from '../src/headless';
import type { TextDoc, TextNode } from '@dn/engine-core';

const valid = (md: string) => {
  const doc = markdownToDoc(md);
  expect(pmCodec.validate(doc)).toBeNull();
  return doc;
};
const types = (ns: readonly TextNode[] | undefined) => (ns ?? []).map((n) => n.type);
/** 문서에서 글자가 처음 나오는 ProseMirror 위치 */
function findText(doc: TextDoc, s: string): number {
  let found = -1;
  toNode(doc).descendants((n, pos) => {
    if (found >= 0) return false;
    if (n.isText && n.text!.includes(s)) { found = pos + n.text!.indexOf(s) + 1; return false; }
    return true;
  });
  return found;
}

describe('markdownToDoc (FR-031)', () => {
  it('제목 · 문단 · 구분선 · 코드 블록', () => {
    const d = valid('# 금리 인상\n\n본문 첫 줄\n둘째 줄\n\n---\n\n```ts\nconst a = 1;\n```');
    expect(types(d.content)).toEqual(['heading', 'paragraph', 'horizontal_rule', 'code_block']);
    expect(d.content[0]!.attrs).toEqual({ level: 1 });
    expect(types(d.content[1]!.content)).toEqual(['text', 'hard_break', 'text']);
    expect(d.content[3]!.content![0]!.text).toBe('const a = 1;');
  });

  it('#### 은 제목 4, 그 이상은 제목 4로 (노션 · 워드 제목 4)', () => {
    expect(valid('#### 깊은 제목').content[0]!.attrs).toEqual({ level: 4 });
    expect(valid('###### 더 깊은 제목').content[0]!.attrs).toEqual({ level: 4 });
  });

  it('중첩 목록 · 번호 시작값 · 할 일', () => {
    const d = valid('- 하나\n  - 하나의 하위\n- 둘\n\n3. 셋\n4. 넷\n\n- [ ] 할 일\n- [x] 끝난 일');
    expect(types(d.content)).toEqual(['bullet_list', 'ordered_list', 'task_list']);
    const first = d.content[0]!.content![0]!;
    expect(types(first.content)).toEqual(['paragraph', 'bullet_list']);
    expect(d.content[1]!.attrs).toEqual({ order: 3 });
    expect(d.content[2]!.content!.map((n) => n.attrs?.checked)).toEqual([false, true]);
  });

  it('인용 안의 블록', () => {
    const d = valid('> **핵심**: 금리가 오르면\n> - 대출 감소');
    expect(types(d.content)).toEqual(['blockquote']);
    expect(types(d.content[0]!.content)).toEqual(['paragraph', 'bullet_list']);
  });

  it('인라인 서식과 안전한 링크만', () => {
    const d = valid('**굵게** *기울임* ~~취소~~ ==강조== `코드` [링크](https://a.dev) [나쁜](javascript:alert(1))');
    const marks = d.content[0]!.content!.filter((n) => n.marks).map((n) => n.marks!.map((m) => m.type).join('+'));
    expect(marks).toEqual(['strong', 'em', 'strike', 'highlight', 'code', 'link']);
    expect(JSON.stringify(d)).not.toContain('javascript:');
  });

  it('굵게 안의 기울임은 마크를 겹친다', () => {
    const d = valid('**굵게 *둘 다* 굵게**');
    expect(d.content[0]!.content!.find((n) => n.text === '둘 다')!.marks!.map((m) => m.type)).toEqual(['strong', 'em']);
  });

  it('표는 행 단위 문단으로 보존 (표 콘텐츠는 P2)', () => {
    const d = valid('| 항목 | 값 |\n|---|---|\n| A | 1 |');
    expect(d.content.map((n) => n.content?.[0]?.text)).toEqual(['항목 · 값', 'A · 1']);
  });

  it('곱셈 별표 · 밑줄 단어는 서식으로 보지 않는다', () => {
    const d = valid('2 * 3 * 4 = 24, snake_case_name');
    expect(d.content[0]!.content).toEqual([{ type: 'text', text: '2 * 3 * 4 = 24, snake_case_name' }]);
  });

  it('looksLikeMarkdown', () => {
    expect(looksLikeMarkdown('## 요약\n본문')).toBe(true);
    expect(looksLikeMarkdown('그냥 문장입니다.\n두 번째 줄')).toBe(false);
    expect(looksLikeMarkdown('1. 첫째\n2. 둘째')).toBe(true);
  });

  it('plainTextToDoc: 줄마다 문단, 빈 줄 유지', () => {
    const d = plainTextToDoc('# 제목 아님\n\n둘째\n');
    expect(pmCodec.validate(d)).toBeNull();
    expect(d.content.map((n) => n.content?.[0]?.text ?? '')).toEqual(['# 제목 아님', '', '둘째']);
  });

  it('formatSteps: 제목이 있는 블록도 목록 · 인용으로 전환', async () => {
    const { formatSteps } = await import('../src/editor');
    for (const cmd of ['task', 'bullet', 'ordered', 'quote', 'h1', 'paragraph'] as const) {
      const doc = markdownToDoc('### 제목\n본문');
      const steps = formatSteps(doc, cmd);
      expect(steps, cmd).not.toBeNull();
      const r = pmCodec.apply(doc, steps!);
      expect(pmCodec.validate(r.doc)).toBeNull();
    }
  });

  it('Alt+↑/↓ 줄 이동: 최상위 블록 · 목록 항목(하위 포함), 끝에서는 동작 안 함', async () => {
    const { moveLineSteps } = await import('../src/editor');
    const doc = markdownToDoc('첫 문단\n\n- 하나\n  - 하나의 하위\n- 둘\n\n끝 문단');
    // "둘" 항목 안의 위치에서 위로 → "하나"(하위 포함)와 자리 바꿈
    const up = moveLineSteps(doc, findText(doc, '둘'), -1)!;
    const r = pmCodec.apply(doc, up);
    expect(pmCodec.validate(r.doc)).toBeNull();
    const items = r.doc.content[1]!.content!.map((li) => li.content![0]!.content![0]!.text);
    expect(items).toEqual(['둘', '하나']);
    expect(r.doc.content[1]!.content![1]!.content).toHaveLength(2); // 하위 목록이 함께 이동
    // 첫 문단에서 위로는 없음, 끝 문단에서 아래로는 없음
    expect(moveLineSteps(doc, findText(doc, '첫 문단'), -1)).toBeNull();
    expect(moveLineSteps(doc, findText(doc, '끝 문단'), 1)).toBeNull();
    // 최상위 문단 아래로
    const down = pmCodec.apply(doc, moveLineSteps(doc, findText(doc, '첫 문단'), 1)!);
    expect(down.doc.content.map((n) => n.type)).toEqual(['bullet_list', 'paragraph', 'paragraph']);
  });

  it('빈 입력도 유효한 문서', () => {
    expect(types(valid('').content)).toEqual(['paragraph']);
  });
});
