// 텍스트 상자 두 종류 (스키마 v3: 제목 상자 · 내용 상자) · 마이그레이션 v1 → v3 · v2 → v3 (FR-090).
import { describe, expect, it } from 'vitest';
import {
  blockTextParts, bodyDoc, boxKind, convertBoxes, createTextBlock, deserialize, docText, Engine, extractToBlock, isBlankDoc,
  mergeTitleBody, newId, SCHEMA_VERSION, serialize, textDoc, titleDoc, toTitleDoc, type TextContent,
} from '../src';

const textOf = (e: Engine, blockId: string) => blockTextParts(e.contentsOf(blockId));

describe('제목 상자 · 내용 상자', () => {
  it('제목 상자: 텍스트 콘텐츠 하나(role title, 문단 하나) · 내용 상자: 하나(role body)', () => {
    const e = new Engine();
    const t = createTextBlock(e, { x: 0, y: 0 }, { kind: 'title', title: '회의' });
    const c = createTextBlock(e, { x: 0, y: 200 }, { body: '안건 1\n안건 2' });
    if (!t.ok || !c.ok) throw new Error();
    expect(e.contentsOf(t.value.blockId)).toHaveLength(1);
    expect(boxKind(e.contentsOf(t.value.blockId))).toBe('title');
    expect(docText(textOf(e, t.value.blockId).title!.doc)).toBe('회의');
    expect(e.contentsOf(c.value.blockId)).toHaveLength(1);
    expect(boxKind(e.contentsOf(c.value.blockId))).toBe('text');
    expect(docText(textOf(e, c.value.blockId).bodies[0]!.doc)).toBe('안건 1\n안건 2');
  });

  it('I10: 제목 상자를 여러 줄 · 다른 노드로 바꾸는 트랜잭션은 롤백된다', () => {
    const e = new Engine();
    const r = createTextBlock(e, { x: 0, y: 0 }, { kind: 'title', title: '회의' });
    if (!r.ok) throw new Error();
    const before = JSON.stringify(serialize(e).contents);
    for (const doc of [bodyDoc('한 줄\n두 줄'), textDoc('제목', '')]) {
      expect(e.transact((tx) => tx.set('content', r.value.contentId, { doc }), { origin: 'user' }).ok).toBe(false);
    }
    expect(JSON.stringify(serialize(e).contents)).toBe(before);
  });

  it('상자 종류 바꾸기: 내용 → 제목은 한 줄로 펴고, 제목 → 내용은 글자 그대로 · undo 한 번', () => {
    const e = new Engine();
    const r = createTextBlock(e, { x: 0, y: 0 }, { doc: textDoc('제목줄', '둘째 줄\n셋째 줄') });
    if (!r.ok) throw new Error();
    expect(convertBoxes(e, [r.value.blockId], 'title').ok).toBe(true);
    const t = textOf(e, r.value.blockId).title!;
    expect(docText(t.doc)).toBe('제목줄 둘째 줄 셋째 줄');
    expect(t.doc.content).toHaveLength(1);
    expect(convertBoxes(e, [r.value.blockId], 'text').ok).toBe(true);
    expect(boxKind(e.contentsOf(r.value.blockId))).toBe('text');
    e.undo(); e.undo();
    expect(docText(textOf(e, r.value.blockId).bodies[0]!.doc)).toBe('제목줄\n둘째 줄\n셋째 줄');
  });

  it('toTitleDoc: 글자 서식은 남기고 줄바꿈 · 목록 구조는 공백으로', () => {
    const d = toTitleDoc({ type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: '굵게', marks: [{ type: 'strong' }] }, { type: 'hard_break' }, { type: 'text', text: '다음' }] },
      { type: 'bullet_list', content: [{ type: 'list_item', content: [{ type: 'paragraph', content: [{ type: 'text', text: '항목' }] }] }] },
    ] });
    expect(d.content).toHaveLength(1);
    expect(docText(d)).toBe('굵게 다음 항목');
    expect(d.content[0]!.content![0]!.marks).toEqual([{ type: 'strong' }]);
  });

  it('블록으로 분리: 떼어 낸 글은 서식 그대로 새 내용 상자', () => {
    const e = new Engine(undefined, { codec: { id: 'noop', apply: (doc) => ({ doc, inverse: [] }), validate: () => null } });
    const r = createTextBlock(e, { x: 0, y: 0 }, { body: '남는 글' });
    if (!r.ok) throw new Error();
    const x = extractToBlock(e, r.value.contentId, [], textDoc('떼어 낸 제목', '떼어 낸 본문'), { x: 400, y: 0 });
    if (!x.ok) throw new Error(x.reason);
    expect(boxKind(e.contentsOf(x.value.blockId))).toBe('text');
    expect(docText(textOf(e, x.value.blockId).bodies[0]!.doc)).toBe('떼어 낸 제목\n떼어 낸 본문');
  });
});

describe('스키마 마이그레이션 → v3 (FR-090)', () => {
  const block = (id: string, x: number) => ({ id, x, y: 0, w: 260, h: 84, sizing: 'auto', layout: 'flow', z: 'a0' });

  it('v1 (제목 heading + 본문이 한 문서) → 둘 다 있으면 내용 상자 그대로 · 제목만이면 제목 상자 · 출처 보존', () => {
    const [b1, b2, b3, c1, c2, c3] = Array.from({ length: 6 }, () => newId());
    const snap = {
      schemaVersion: 1, engine: { textSchema: 'pm-v1' }, note: { id: newId(), title: '옛 노트', createdAt: 1, updatedAt: 1 },
      blocks: { [b1!]: block(b1!, 0), [b2!]: block(b2!, 400), [b3!]: block(b3!, 800) },
      contents: {
        [c1!]: { id: c1, blockId: b1, order: 'a0', type: 'text', doc: textDoc('회의 결과', '다음 주 배포'), ai: { generated: true, runId: 'r1' } },
        [c2!]: { id: c2, blockId: b2, order: 'a0', type: 'text', doc: textDoc('제목만', '') },
        [c3!]: { id: c3, blockId: b3, order: 'a0', type: 'text', doc: bodyDoc('제목 없는 메모') },
      },
      arrows: {}, strokes: {},
    };
    const r = deserialize(JSON.parse(JSON.stringify(snap)));
    if (!r.ok) throw new Error(JSON.stringify(r));
    expect(r.migratedFrom).toBe(1);
    const e = new Engine(r.data);
    for (const id of [b1, b2, b3]) expect(e.contentsOf(id!)).toHaveLength(1);
    expect(boxKind(e.contentsOf(b1!))).toBe('text');
    expect(e.contentsOf(b1!)[0]!.id).toBe(c1); // 원래 콘텐츠 id 유지 (AI 출처 참조)
    expect(docText((e.getContent(c1!) as TextContent).doc)).toBe('회의 결과\n다음 주 배포');
    expect((e.getContent(c1!) as TextContent).ai?.runId).toBe('r1');
    expect(boxKind(e.contentsOf(b2!))).toBe('title');
    expect(docText(textOf(e, b2!).title!.doc)).toBe('제목만');
    expect(boxKind(e.contentsOf(b3!))).toBe('text');
    expect(docText(textOf(e, b3!).bodies[0]!.doc)).toBe('제목 없는 메모');
    expect(serialize(e).schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('v2 (제목 칸 + 본문 칸이 한 블록에) → 상자 하나로 합친다', () => {
    const [b1, t1, x1, b2, t2, x2] = Array.from({ length: 6 }, () => newId());
    const snap = {
      schemaVersion: 2, engine: { textSchema: 'pm-v1' }, note: { id: newId(), title: 'v2', createdAt: 1, updatedAt: 1 },
      blocks: { [b1!]: block(b1!, 0), [b2!]: block(b2!, 400) },
      contents: {
        [t1!]: { id: t1, blockId: b1, order: 'Zz', type: 'text', role: 'title', doc: titleDoc('제목') },
        [x1!]: { id: x1, blockId: b1, order: 'a0', type: 'text', role: 'body', doc: bodyDoc('본문') },
        [t2!]: { id: t2, blockId: b2, order: 'Zz', type: 'text', role: 'title', doc: titleDoc('제목뿐') },
        [x2!]: { id: x2, blockId: b2, order: 'a0', type: 'text', role: 'body', doc: bodyDoc('') },
      },
      arrows: {}, strokes: {},
    };
    const r = deserialize(JSON.parse(JSON.stringify(snap)));
    if (!r.ok) throw new Error(JSON.stringify(r));
    const e = new Engine(r.data);
    expect(e.contentsOf(b1!).map((c) => c.id)).toEqual([x1]);
    expect((e.getContent(x1!) as TextContent).doc).toEqual(mergeTitleBody(titleDoc('제목'), bodyDoc('본문')));
    expect(e.contentsOf(b2!).map((c) => c.id)).toEqual([t2]);
    expect(boxKind(e.contentsOf(b2!))).toBe('title');
    expect(isBlankDoc(bodyDoc(''))).toBe(true);
  });
});
