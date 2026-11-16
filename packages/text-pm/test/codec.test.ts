import 'fake-indexeddb/auto';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createTextBlock, editText, Engine, serialize, setDefaultTextCodec, textDoc, type TextDoc } from '@dn/engine-core';
import { createNote, IdbNoteStore, openNote } from '@dn/storage-idb';
import { wrapInList } from 'prosemirror-schema-list';
import { EditorState, TextSelection } from 'prosemirror-state';
import { pmCodec, schema, toJSON, toNode } from '../src/headless';

const snap = (e: Engine) => { const s = serialize(e); return JSON.stringify({ ...s, note: { ...s.note, updatedAt: 0 } }); };

/** 에디터에서 일어나는 트랜잭션을 흉내 내 스텝 JSON을 만든다. */
function typeSteps(doc: TextDoc, pos: number, text: string): unknown[] {
  const state = EditorState.create({ doc: toNode(doc) });
  return state.tr.insertText(text, pos).steps.map((s) => s.toJSON());
}
function boldSteps(doc: TextDoc, from: number, to: number): unknown[] {
  const state = EditorState.create({ doc: toNode(doc) });
  return state.tr.addMark(from, to, schema.marks.strong!.create()).steps.map((s) => s.toJSON());
}
function listSteps(doc: TextDoc, pos: number): unknown[] {
  let state = EditorState.create({ doc: toNode(doc) });
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)));
  let steps: unknown[] = [];
  wrapInList(schema.nodes.bullet_list!)(state, (tr) => { steps = tr.steps.map((s) => s.toJSON()); });
  return steps;
}
describe('pmCodec (ENGINE 5.6)', () => {
  it('스텝 적용 → 역스텝 적용 = 원래 문서', () => {
    const doc = textDoc('제목', '첫 줄\n둘째 줄');
    const r = pmCodec.apply(doc, typeSteps(doc, 3, '한글 입력'));
    expect(toNode(r.doc).textContent).toContain('한글 입력');
    const back = pmCodec.apply(r.doc, r.inverse);
    expect(toNode(back.doc).eq(toNode(doc))).toBe(true);
  });

  it('잘못된 스텝은 throw', () => {
    const doc = textDoc('a', '');
    expect(() => pmCodec.apply(doc, [{ stepType: 'replace', from: 999, to: 1000 }])).toThrow();
  });

  it('스키마 검증: 알 수 없는 노드는 오류', () => {
    expect(pmCodec.validate(textDoc('a', 'b'))).toBeNull();
    expect(pmCodec.validate({ type: 'doc', content: [{ type: 'video' }] })).not.toBeNull();
  });

  it('JSON ↔ Node 캐시: 같은 객체는 같은 노드', () => {
    const doc = textDoc('a', 'b');
    expect(toNode(doc)).toBe(toNode(doc));
    expect(toJSON(toNode(doc))).toBe(doc);
  });

  it('무작위 삽입 · 서식 스텝 연쇄 왕복', () => {
    fc.assert(fc.property(fc.array(fc.tuple(fc.nat(), fc.string({ minLength: 1, maxLength: 5 }), fc.boolean()), { maxLength: 15 }), (edits) => {
      const start = textDoc('제목', '본문');
      let doc = start;
      const inverses: unknown[][] = [];
      for (const [p, s, bold] of edits) {
        const size = toNode(doc).content.size;
        const pos = 1 + (p % Math.max(1, size - 1));
        const $p = toNode(doc).resolve(pos);
        if (!$p.parent.isTextblock) continue;
        const steps = bold && size > 4 ? boldSteps(doc, 1, Math.min(size - 1, 3)) : typeSteps(doc, pos, s);
        const r = pmCodec.apply(doc, steps);
        inverses.push(r.inverse);
        doc = r.doc;
      }
      for (const inv of inverses.reverse()) doc = pmCodec.apply(doc, inv).doc;
      expect(toNode(doc).eq(toNode(start))).toBe(true);
    }), { numRuns: 200 });
  });
});

describe('엔진 텍스트 Op (FR-007 · FR-002)', () => {
  const setup = () => {
    const e = new Engine(undefined, { codec: pmCodec });
    const r = createTextBlock(e, { x: 0, y: 0 }, { body: '회의' });
    if (!r.ok) throw new Error();
    return { e, cid: r.value.contentId };
  };
  const docOf = (e: Engine, cid: string) => (e.getContent(cid) as { doc: TextDoc }).doc;

  it('연속 입력은 undo 한 번, redo로 복원', () => {
    const { e, cid } = setup();
    const before = snap(e);
    for (const ch of ['결', '정', ' 사항']) {
      const d = docOf(e, cid);
      editText(e, cid, typeSteps(d, toNode(d).firstChild!.nodeSize - 1, ch));
    }
    expect(toNode(docOf(e, cid)).textContent).toBe('회의결정 사항');
    const after = snap(e);
    e.undo();
    expect(snap(e)).toBe(before);
    e.redo();
    expect(snap(e)).toBe(after);
  });

  it('서식 · 목록 변환도 스텝으로 저장되고 되돌릴 수 있다', () => {
    const { e, cid } = setup();
    e.transact((tx) => tx.set('content', cid, { doc: textDoc('회의', '안건') }), { origin: 'user' });
    const before = snap(e);
    editText(e, cid, boldSteps(docOf(e, cid), 1, 3));
    const d = docOf(e, cid);
    const ls = listSteps(d, toNode(d).firstChild!.nodeSize + 1);
    expect(ls.length).toBeGreaterThan(0);
    editText(e, cid, ls);
    const json = JSON.stringify(docOf(e, cid));
    expect(json).toContain('strong');
    expect(json).toContain('bullet_list');
    // 글자 서식만 바꾼 변경(굵게)은 따로 한 단계 (DQ-027) — 목록 취소 → 굵게 취소 순서로 처음으로
    e.undo();
    expect(JSON.stringify(docOf(e, cid))).not.toContain('bullet_list');
    expect(JSON.stringify(docOf(e, cid))).toContain('strong');
    e.undo();
    expect(snap(e)).toBe(before);
  });

  it('적용할 수 없는 스텝은 트랜잭션 전체 롤백', () => {
    const { e, cid } = setup();
    const before = snap(e);
    const r = editText(e, cid, [{ stepType: 'replace', from: 500, to: 600 }]);
    expect(r.ok).toBe(false);
    expect(snap(e)).toBe(before);
  });

  it('텍스트 스텝 로그를 저장했다가 다시 열면 같은 문서 (FR-089)', async () => {
    setDefaultTextCodec(pmCodec); // 앱 시작 시 등록과 같은 상태
    const store = await IdbNoteStore.open(`t-${Math.random()}`);
    const { e, cid } = setup();
    const s = await createNote(store, e);
    for (const ch of ['가', '나', '다']) { const d = docOf(e, cid); editText(e, cid, typeSteps(d, 1, ch)); }
    editText(e, cid, boldSteps(docOf(e, cid), 1, 3));
    await s.flush();
    const r = await openNote(store, e.note.id);
    if (!r.ok) throw new Error(r.reason);
    expect(r.warning).toBeUndefined();
    expect(snap(r.engine)).toBe(snap(e));
  });
});

describe('초안 상자 글 입력', () => {
  it('글이 들어오면 초안 표시가 풀려 캔버스 색인에 들어온다', async () => {
    const { appendTextBox } = await import('@dn/engine-core');
    setDefaultTextCodec(pmCodec);
    const e = new Engine();
    const r = appendTextBox(e);
    if (!r.ok) throw new Error(r.reason);
    const all = { x: -1e6, y: -1e6, w: 2e6, h: 2e6 };
    expect(e.getBlock(r.value.blockId)!.draft).toBe(true);
    expect(e.queryBlocks(all)).not.toContain(r.value.blockId);
    const c = e.getContent(r.value.contentId) as { doc: TextDoc };
    const t = editText(e, r.value.contentId, typeSteps(c.doc, 1, '새 글'));
    expect(t.ok).toBe(true);
    expect(e.getBlock(r.value.blockId)!.draft).toBeUndefined();
    expect(e.queryBlocks(all)).toContain(r.value.blockId);
  });
});
