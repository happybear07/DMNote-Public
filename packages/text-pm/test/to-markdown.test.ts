// Markdown 내보내기 (FR-130)
import { describe, expect, it } from 'vitest';
import type { TextDoc } from '@dn/engine-core';
import { docToMarkdown, markdownToDoc } from '../src/headless';

const t = (text: string, marks?: object[]) => ({ type: 'text', text, ...(marks ? { marks } : {}) });
const p = (...c: object[]) => ({ type: 'paragraph', content: c });
const doc = (...c: object[]) => ({ type: 'doc', content: c }) as unknown as TextDoc;

describe('Markdown 내보내기', () => {
  it('제목 · 문단 · 인라인 서식', () => {
    const d = doc({ type: 'heading', attrs: { level: 2 }, content: [t('제목')] },
      p(t('굵게', [{ type: 'strong' }]), t(' · '), t('기울임', [{ type: 'em' }]), t(' · '), t('코드', [{ type: 'code' }]),
        t(' · '), t('링크', [{ type: 'link', attrs: { href: 'https://a.b' } }]), t(' · '), t('형광', [{ type: 'highlight' }]), t(' · '), t('취소', [{ type: 'strike' }])));
    expect(docToMarkdown(d)).toBe('## 제목\n\n**굵게** · *기울임* · `코드` · [링크](https://a.b) · ==형광== · ~~취소~~');
  });

  it('목록 (중첩) · 번호 · 할 일', () => {
    const md = '- 하나\n  - 둘\n- 셋\n\n1. 가\n2. 나\n\n- [ ] 할 일\n- [x] 끝남';
    expect(docToMarkdown(markdownToDoc(md))).toBe(md);
  });

  it('인용 · 코드 블록 · 구분선', () => {
    const md = '> 인용문\n\n```\nconst a = 1;\n```\n\n---';
    expect(docToMarkdown(markdownToDoc(md))).toBe(md);
  });

  it('토글 · 콜아웃 · 노트 링크(지금 제목)', () => {
    const d = doc(
      { type: 'toggle', attrs: { open: false }, content: [p(t('요약')), p(t('숨은 내용'))] },
      { type: 'callout', attrs: { icon: 'alert', color: 'red' }, content: [p(t('주의'))] },
      p(t('참고 '), { type: 'note_link', attrs: { id: 'n1', title: '옛 제목' } }),
    );
    expect(docToMarkdown(d, { noteTitle: (id) => (id === 'n1' ? '새 제목' : null) })).toBe(
      '<details>\n<summary>요약</summary>\n\n숨은 내용\n\n</details>\n\n> [!warning]\n> 주의\n\n참고 [[새 제목]]');
  });

  it('서식 기호로 읽힐 글자는 이스케이프', () => {
    expect(docToMarkdown(doc(p(t('# 아님 *별* [괄호]'))))).toBe(String.raw`\# 아님 \*별\* \[괄호\]`);
  });

  it('밑줄 · 겹친 서식 (굵게+기울임) — 내보내고 다시 읽어도 서식 그대로 (FR-027)', () => {
    const d = doc(p(t('둘 다', [{ type: 'strong' }, { type: 'em' }]), t(' · '), t('밑줄', [{ type: 'underline' }]), t(' · '), t('굵은 취소', [{ type: 'strong' }, { type: 'strike' }])));
    const md = docToMarkdown(d);
    expect(md).toBe('***둘 다*** · <u>밑줄</u> · **~~굵은 취소~~**');
    const back = markdownToDoc(md).content?.[0]?.content ?? [];
    const marks = (text: string) => back.find((n) => n.text === text)?.marks?.map((m) => m.type).sort();
    expect(marks('둘 다')).toEqual(['em', 'strong']);
    expect(marks('굵은 취소')).toEqual(['strike', 'strong']);
    expect(marks('밑줄')).toEqual(['underline']);
  });
});
