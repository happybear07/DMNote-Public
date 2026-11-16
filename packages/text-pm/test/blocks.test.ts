// P3 텍스트 블록: 토글 (FR-047) · 콜아웃 (FR-048) · 슬래시 메뉴 검색 (FR-029)
import { describe, expect, it } from 'vitest';
import { textLines, type TextDoc } from '@dn/engine-core';
import { commandSteps, flipAttrSteps, formatSteps } from '../src/editor';
import { chosung, filterSlash, pmCodec, SLASH_ITEMS, toNode } from '../src/headless';

const p = (text = ''): TextDoc => ({ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) }) as TextDoc;
const doc = (...content: TextDoc[]): TextDoc => ({ type: 'doc', content }) as TextDoc;
const toggle = (open: boolean, ...content: TextDoc[]): TextDoc => ({ type: 'toggle', attrs: { open }, content }) as TextDoc;

describe('토글 · 콜아웃 스키마', () => {
  it('토글 = 요약 문단 + 아무 블록, 콜아웃 = 블록 여럿 (중첩 포함)', () => {
    const d = doc(
      toggle(false, p('요약'), p('숨은 내용'), { type: 'bullet_list', content: [{ type: 'list_item', content: [p('항목')] }] } as TextDoc,
        toggle(true, p('안쪽 토글'))),
      { type: 'callout', attrs: { icon: 'alert', color: 'red' }, content: [p('주의'), { type: 'blockquote', content: [p('인용')] }] } as TextDoc,
    );
    expect(pmCodec.validate(d)).toBeNull();
    // 접힌 내용도 글자로 읽힌다 — 검색(FR-121) · 미리보기 대상
    expect(textLines(d)).toEqual(['요약', '숨은 내용', '항목', '안쪽 토글', '주의', '인용']);
  });

  it('토글은 문단 또는 제목(토글 제목)으로 시작한다 — 목록으로는 못 시작', () => {
    expect(pmCodec.validate(doc(toggle(true, { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'x' }] } as TextDoc)))).toBeNull();
    expect(pmCodec.validate(doc(toggle(true, { type: 'bullet_list', content: [{ type: 'list_item', content: [p('x')] }] } as TextDoc)))).not.toBeNull();
  });
});

describe('토글 조작', () => {
  it('flipAttrSteps: 접기 → undo(역스텝)로 다시 펼침', () => {
    const d = doc(p('앞'), toggle(true, p('요약'), p('내용')));
    const pos = toNode(d).child(0).nodeSize; // 두 번째 최상위 노드 = 토글
    const steps = flipAttrSteps(d, pos, 'open')!;
    const r = pmCodec.apply(d, steps);
    expect((r.doc.content![1] as TextDoc).attrs!.open).toBe(false);
    expect(pmCodec.apply(r.doc, r.inverse).doc).toEqual(d);
  });

  it('flipAttrSteps: 할 일 체크', () => {
    const d = doc({ type: 'task_list', content: [{ type: 'task_item', attrs: { checked: false }, content: [p('일')] }] } as TextDoc);
    const r = pmCodec.apply(d, flipAttrSteps(d, 1, 'checked')!);
    expect(JSON.stringify(r.doc)).toContain('"checked":true');
    expect(flipAttrSteps(d, 0, 'open')).toBeNull(); // 속성이 없는 노드
  });

  it("'toggle' 명령: 문단을 토글로, 제목 줄은 문단으로 바꾼 뒤 감싼다", () => {
    const a = commandSteps(doc(p('할 말')), 1, 'toggle')!;
    expect(a.doc).toEqual(doc(toggle(true, p('할 말'))));
    const h = doc({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '제목' }] } as TextDoc);
    expect(commandSteps(h, 1, 'toggle')!.doc).toEqual(doc(toggle(true, p('제목'))));
  });

  it('접힌 토글 요약 줄에서 Enter → 토글 다음 줄 (숨은 내용 안으로 안 들어감)', () => {
    const d = doc(toggle(false, p('요약'), p('숨은 내용')));
    const r = commandSteps(d, 3, 'enter')!;
    expect(r.doc).toEqual(doc(toggle(false, p('요약'), p('숨은 내용')), p()));
  });

  it('토글 마지막 빈 줄에서 Enter → 밖으로', () => {
    const d = doc(toggle(true, p('요약'), p()));
    const pos = 1 + toNode(d).child(0).child(0).nodeSize + 1; // 빈 문단 안
    expect(commandSteps(d, pos, 'enter')!.doc).toEqual(doc(toggle(true, p('요약')), p()));
  });

  it('첫 줄 맨 앞 Backspace → 토글 · 콜아웃 풀기', () => {
    expect(commandSteps(doc(toggle(true, p('요약'), p('내용'))), 2, 'backspace')!.doc).toEqual(doc(p('요약'), p('내용')));
    const c = doc({ type: 'callout', attrs: { icon: 'bulb', color: 'yellow' }, content: [p('강조')] } as TextDoc);
    expect(commandSteps(c, 2, 'backspace')!.doc).toEqual(doc(p('강조')));
    expect(commandSteps(c, 3, 'backspace')).toBeNull(); // 맨 앞이 아니면 보통 Backspace
  });

  it("'callout' · 'divider' 명령", () => {
    expect(commandSteps(doc(p('강조')), 1, 'callout')!.doc).toEqual(doc({ type: 'callout', attrs: { icon: 'bulb', color: 'yellow' }, content: [p('강조')] } as TextDoc));
    expect(commandSteps(doc(p()), 1, 'divider')!.doc).toEqual(doc({ type: 'horizontal_rule' } as TextDoc, p()));
  });

  it("'divider' · 'math' 명령: 빈 줄이면 그 줄을 바꾸고, 글이 있는 줄이면 그 아래에", () => {
    const math = { type: 'math_block', attrs: { tex: '' } } as TextDoc;
    expect(commandSteps(doc(p('앞'), p('뒤')), 2, 'divider')!.doc).toEqual(doc(p('앞'), { type: 'horizontal_rule' } as TextDoc, p(), p('뒤')));
    expect(commandSteps(doc(p()), 1, 'math')!.doc).toEqual(doc(math));
    expect(commandSteps(doc(p('앞'), p('뒤')), 2, 'math')!.doc).toEqual(doc(p('앞'), math, p('뒤')));
  });
});

describe('슬래시 메뉴 검색 (FR-029)', () => {
  const ids = (q: string) => filterSlash(SLASH_ITEMS, q).map((i) => i.id);
  it('빈 검색어 = 전체', () => expect(ids('')).toHaveLength(SLASH_ITEMS.length));
  it('한글 · 영문 · 초성', () => {
    expect(ids('제목').slice(0, 3)).toEqual(['h1', 'h2', 'h3']); // 뒤에 토글 제목 1 · 2 · 3
    expect(ids('h2')[0]).toBe('h2'); // 뒤에 토글 제목 2
    expect(ids('todo')).toEqual(['task']);
    expect(ids('토글')).toEqual(['toggle', 'toggleH1', 'toggleH2', 'toggleH3']);
    expect(ids('ㅋㅇㅇ')).toEqual(['callout']);
    expect(ids('구조화')).toEqual(['ai']);
    expect(ids('AI')[0]).toBe('ai');
    expect(ids('없는말')).toEqual([]);
  });
  it('초성 변환', () => expect(chosung('제목 abc')).toBe('ㅈㅁ abc'));
});

describe('위/아래 첨자 · 서식 지우기', () => {
  it('위 첨자를 걸면 아래 첨자는 풀리고, 서식 지우기는 링크만 남기고 제목은 본문으로', () => {
    const d = { type: 'doc', content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '굵은링크', marks: [{ type: 'strong' }, { type: 'sub' }, { type: 'link', attrs: { href: 'https://a.b' } }] }] }] } as TextDoc;
    const apply = (doc: TextDoc, steps: unknown[]) => pmCodec.apply(doc, steps).doc;
    const sup = apply(d, formatSteps(d, 'sup') ?? []);
    const marks = (doc: TextDoc) => (toNode(doc).firstChild!.firstChild!.marks.map((m) => m.type.name)).sort();
    expect(marks(sup)).toEqual(['link', 'strong', 'sup']);
    const clean = apply(sup, formatSteps(sup, 'clear') ?? []);
    expect(marks(clean)).toEqual(['link']);
    expect(toNode(clean).firstChild!.type.name).toBe('paragraph');
  });
});

describe('토글 제목 (노션 Toggle heading)', () => {
  const h = (level: number, text: string): TextDoc => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] }) as TextDoc;
  it('문단에서 → 제목 요약 줄의 토글 (한 번에)', () => {
    expect(commandSteps(doc(p('요약')), 1, 'toggleH2')!.doc).toEqual(doc(toggle(true, h(2, '요약'))));
  });
  it('토글 안에서 → 요약 줄만 제목으로, 내용은 그대로', () => {
    expect(commandSteps(doc(toggle(true, p('요약'), p('내용'))), 4, 'toggleH1')!.doc).toEqual(doc(toggle(true, h(1, '요약'), p('내용'))));
  });
  it('/토글은 예전처럼 — 제목 줄은 문단 토글로', () => {
    expect(commandSteps(doc(h(1, '제목')), 1, 'toggle')!.doc).toEqual(doc(toggle(true, p('제목'))));
  });
});
