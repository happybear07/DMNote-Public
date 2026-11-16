// 고른 글 AI 편집 (FR-112): 고른 범위 → Markdown, 결과 넣는 스텝(바꾸기 · 아래에 넣기)이 원래 문서에 그대로 적용되는지
import { describe, expect, it } from 'vitest';
import { applyAiText, blockDataOrigin, createTextBlock, dataOrigin, Engine, setDefaultTextCodec, type TextDoc, type TextNode } from '@dn/engine-core';
import { aiEditSteps, aiSource, docToMarkdown, findInDoc, keptLabel, markdownToDoc, missingKept, pmCodec, rangeMarkdown, sameDoc } from '../src/headless';

const md = (doc: TextDoc) => docToMarkdown(doc as TextNode);
const apply = (doc: TextDoc, steps: unknown[]) => md(pmCodec.apply(doc, steps).doc as TextDoc);
const at = (doc: TextDoc, text: string) => { const m = findInDoc(doc, text)[0]!; return { from: m.from, to: m.to }; };

describe('AI 편집 스텝', () => {
  const d = markdownToDoc('첫 문장. **둘째 문장.** 셋째.\n\n다음 문단');

  it('고른 범위 → Markdown (서식 그대로), 범위가 비면 문서 전체', () => {
    expect(rangeMarkdown(d, at(d, '둘째 문장.'))).toBe('**둘째 문장.**');
    expect(rangeMarkdown(d, { from: 3, to: 3 })).toBe('첫 문장. **둘째 문장.** 셋째.\n\n다음 문단');
  });

  it('바꾸기: 문장 안 고른 글만 결과로 — 앞뒤 글은 그대로', () => {
    expect(apply(d, aiEditSteps(d, at(d, '둘째 문장.'), '고친 문장.', 'replace'))).toBe('첫 문장. 고친 문장. 셋째.\n\n다음 문단');
  });

  it('바꾸기: 결과가 여러 문단이면 고른 자리에서 문단이 나뉜다 (붙여넣기와 같다)', () => {
    expect(apply(d, aiEditSteps(d, at(d, '둘째 문장.'), 'A\n\nB', 'replace'))).toBe('첫 문장. A\n\nB 셋째.\n\n다음 문단');
  });

  it('아래에 넣기: 고른 글이 끝나는 문단 다음에, 고른 글은 그대로', () => {
    expect(apply(d, aiEditSteps(d, at(d, '둘째 문장.'), '- 요점 하나\n- 요점 둘', 'below'))).toBe('첫 문장. **둘째 문장.** 셋째.\n\n- 요점 하나\n- 요점 둘\n\n다음 문단');
  });

  it('아래에 넣기: 목록 안에서 고르면 목록 전체 다음에', () => {
    const l = markdownToDoc('- 사과\n- 배\n\n끝');
    expect(apply(l, aiEditSteps(l, at(l, '사과'), '과일 두 가지', 'below'))).toBe('- 사과\n- 배\n\n과일 두 가지\n\n끝');
  });

  it('이어서 넣기: 문장 가운데서 끝났으면 그 문단에 띄어 이어 붙이고, 남은 문단은 그 아래로', () => {
    const p = markdownToDoc('회의에서 우리는\n\n다른 문단.');
    expect(apply(p, aiEditSteps(p, at(p, '회의에서 우리는'), '결제 모듈을 먼저 하기로 했다.\n\n둘째 문단.', 'after'))).toBe('회의에서 우리는 결제 모듈을 먼저 하기로 했다.\n\n둘째 문단.\n\n다른 문단.');
    // 상자 전체(커서만 있을 때)면 마지막 문단 끝에 — 쉼표로 시작하면 띄우지 않는다
    const q = markdownToDoc('첫 문단.\n\n회의에서 우리는');
    expect(apply(q, aiEditSteps(q, { from: 0, to: docSize(q) }, ', 그리고 끝냈다.', 'after'))).toBe('첫 문단.\n\n회의에서 우리는, 그리고 끝냈다.');
  });

  it('이어서 넣기: 문장이 끝났으면 다음 문단, 같은 종류 목록은 한 목록으로 이어진다', () => {
    expect(apply(d, aiEditSteps(d, at(d, '둘째 문장.'), '이어지는 문장.', 'after'))).toBe('첫 문장. **둘째 문장.** 셋째.\n\n이어지는 문장.\n\n다음 문단');
    const o = markdownToDoc('1. 준비\n2. 실행');
    expect(apply(o, aiEditSteps(o, { from: 0, to: docSize(o) }, '1. 점검\n2. 정리', 'after'))).toBe('1. 준비\n2. 실행\n3. 점검\n4. 정리');
  });

  it('노트 링크 · 날짜는 ⟦n⟧ 표지로 보내고 바꾼 뒤 원래 물건으로 — 알림 · 링크가 남는다, 미리보기는 글자로', () => {
    const t = (text: string, marks?: TextNode['marks']): TextNode => ({ type: 'text', text, ...(marks ? { marks } : {}) });
    const link: TextNode = { type: 'note_link', attrs: { id: 'N1', title: '예산안' } };
    const date: TextNode = { type: 'date_mention', attrs: { date: '2026-11-03', time: '09:00', repeat: '' } };
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [t('회의 '), link, t(' 검토 '), date, t(' 전까지')] }] } as TextDoc;
    const src = aiSource(doc, { from: 0, to: docSize(doc) });
    expect(src.markdown).toBe('회의 ⟦1⟧ 검토 ⟦2⟧ 전까지');
    expect(src.lost).toEqual([]);
    expect(keptLabel('⟦2⟧까지 ⟦1⟧ 검토', src.keep)).toBe('2026-11-03 09:00까지 [[예산안]] 검토');
    const out = pmCodec.apply(doc, aiEditSteps(doc, { from: 0, to: docSize(doc) }, '⟦2⟧까지 ⟦1⟧을 검토한다.', 'replace', src.keep)).doc as TextDoc;
    expect((out.content![0]!.content ?? []).map((n) => n.type)).toEqual(['date_mention', 'text', 'note_link', 'text']);
    expect(missingKept('⟦1⟧만 남김', src.keep)).toBe(1);
  });

  it('표지로도 못 지키는 서식은 미리 알린다 (댓글 표시 · 글자 색)', () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '빨간 글', marks: [{ type: 'textColor', attrs: { color: 'red' } }, { type: 'comment', attrs: { id: 'c1' } }] }, { type: 'text', text: ' 굵게', marks: [{ type: 'strong' }] }] }] } as TextDoc;
    expect([...aiSource(doc, { from: 0, to: docSize(doc) }).lost].sort()).toEqual(['글자 색', '댓글 표시']);
  });

  it('이어서 넣기: 제목 · 목록 항목 끝이면 그 안에 붙이지 않고 다음 블록으로', () => {
    const h = markdownToDoc('메모입니다.\n\n## 다음 단계');
    expect(apply(h, aiEditSteps(h, { from: 0, to: docSize(h) }, '결제 모듈을 먼저 끝낸다.', 'after'))).toBe('메모입니다.\n\n## 다음 단계\n\n결제 모듈을 먼저 끝낸다.');
    const l = markdownToDoc('- 사과\n- 배');
    expect(apply(l, aiEditSteps(l, { from: 0, to: docSize(l) }, '그 밖에 귤도 있다.', 'after'))).toBe('- 사과\n- 배\n\n그 밖에 귤도 있다.');
  });

  it('상자 전체(0 ~ 끝)를 바꾸면 결과만 남는다', () => {
    expect(apply(d, aiEditSteps(d, { from: 0, to: docSize(d) }, '- 요약', 'replace'))).toBe('- 요약');
  });

  it('고른 뒤 글이 바뀌었는지', () => {
    expect(sameDoc(d, markdownToDoc('첫 문장. **둘째 문장.** 셋째.\n\n다음 문단'))).toBe(true);
    expect(sameDoc(d, markdownToDoc('첫 문장. 둘째 문장. 셋째.\n\n다음 문단'))).toBe(false);
  });
});

/** 문서 내용 크기 (ProseMirror doc.content.size) — 문단마다 여닫는 2 + 글자 수, 글 속 물건(노트 링크 · 날짜)은 1 */
function docSize(doc: TextDoc): number {
  const len = (n: TextNode): number => (n.text !== undefined ? n.text.length : n.content ? n.content.reduce((s, c) => s + len(c), 0) + 2 : n.type === 'paragraph' || n.type === 'heading' ? 2 : 1);
  return (doc.content ?? []).reduce((s, c) => s + len(c), 0);
}

describe('applyAiText — 작성 도우미가 넣은 글의 출처 (10/29 교차 검토 C3 · A11)', () => {
  const AI = { generated: true as const, runId: 'r1', promptVersion: 'edit.v1' };
  const setup = (markdown: string) => {
    setDefaultTextCodec(pmCodec);
    const e = new Engine();
    const r = createTextBlock(e, { x: 0, y: 0 }, { doc: markdownToDoc(markdown) });
    if (!r.ok) throw new Error(r.reason);
    return { e, ...r.value, doc: () => (e.getContent(r.value.contentId) as { doc: TextDoc }).doc };
  };
  it('사람 글을 바꾸면 콘텐츠만 AI + 고침(claude_edited), 블록 테두리는 없음 · 실행 취소 한 번', () => {
    const { e, blockId, contentId, doc } = setup('사람이 쓴 첫 문장. 둘째 문장.');
    const d0 = doc();
    const r = applyAiText(e, contentId, aiEditSteps(d0, at(d0, '둘째 문장.'), 'AI가 고친 문장.', 'replace'), AI, 'AI로 고치기', 1000);
    expect(r.ok).toBe(true);
    expect(md(doc())).toBe('사람이 쓴 첫 문장. AI가 고친 문장.');
    expect(e.getContent(contentId)!.ai).toMatchObject({ generated: true, editedAt: 1000 });
    expect(dataOrigin(e.getContent(contentId))).toBe('claude_edited');
    expect(e.getBlock(blockId)!.ai).toBeUndefined();
    expect(blockDataOrigin(e, blockId)).toBe('claude_edited');
    e.undo();
    expect(e.getContent(contentId)!.ai).toBeUndefined();
    expect(md(doc())).toBe('사람이 쓴 첫 문장. 둘째 문장.');
  });
  it('빈 상자를 AI 초안으로만 채우면 고침 표시 없이 claude, 블록에도 출처(AI 테두리)', () => {
    const { e, blockId, contentId, doc } = setup('');
    const d0 = doc();
    expect(applyAiText(e, contentId, aiEditSteps(d0, { from: 1, to: d0.content.length ? 1 : 1 }, '초안 글', 'replace'), AI, 'AI 초안').ok).toBe(true);
    expect(md(doc())).toContain('초안 글');
    expect(e.getContent(contentId)!.ai?.editedAt).toBeUndefined();
    expect(dataOrigin(e.getContent(contentId))).toBe('claude');
    expect(e.getBlock(blockId)!.ai).toEqual(AI);
  });
});
