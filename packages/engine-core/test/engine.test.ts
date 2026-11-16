import { describe, expect, it } from 'vitest';
import {
  createArrow, createTextBlock, deleteEntities, deserialize, duplicateBlocks, Engine, keyBetween, moveBlocks,
  serialize, setText, textDoc, bodyDoc, zoomAt, screenToWorld, type Camera,
} from '../src';

/** updatedAt은 표시용이라 비교에서 뺀다. */
const snap = (e: Engine) => { const s = serialize(e); return JSON.stringify({ ...s, note: { ...s.note, updatedAt: 0 } }); };

function twoBlocksWithArrow() {
  const e = new Engine();
  const a = createTextBlock(e, { x: 0, y: 0 }, { title: 'A' });
  const b = createTextBlock(e, { x: 400, y: 0 }, { title: 'B' });
  if (!a.ok || !b.ok) throw new Error('setup');
  const arr = createArrow(e, { blockId: a.value.blockId, side: 'auto' }, { blockId: b.value.blockId, side: 'auto' }, '다음');
  if (!arr.ok) throw new Error('setup arrow');
  return { e, a: a.value.blockId, b: b.value.blockId, arrow: arr.value };
}

describe('트랜잭션 · undo (FR-002)', () => {
  it('블록 삭제는 콘텐츠와 연결 화살표를 함께 지우고, undo 한 번으로 모두 복원한다', () => {
    const { e, a, arrow } = twoBlocksWithArrow();
    const before = snap(e);
    expect(deleteEntities(e, [a]).ok).toBe(true);
    expect(e.getBlock(a)).toBeUndefined();
    expect(e.getArrow(arrow)).toBeUndefined();
    expect([...e.contents()].some((c) => c.blockId === a)).toBe(false);
    expect(e.undo()).toBe(true);
    expect(snap(e)).toBe(before);
    expect(e.redo()).toBe(true);
    expect(e.getBlock(a)).toBeUndefined();
  });

  it('불변식을 깨는 트랜잭션은 전체 롤백된다', () => {
    const { e, a } = twoBlocksWithArrow();
    const before = snap(e);
    // 연결 화살표를 남긴 채 블록만 지우기 → I2 위반
    const r = e.transact((tx) => {
      for (const c of e.contentsOf(a)) tx.delete('content', c.id);
      tx.delete('block', a);
    }, { origin: 'user' });
    expect(r.ok).toBe(false);
    expect(snap(e)).toBe(before);
    expect(e.hitTest({ x: 10, y: 10 })?.id).toBe(a); // 공간 인덱스도 복원
  });

  it('tx.fail은 롤백하고 이벤트를 보내지 않는다', () => {
    const e = new Engine();
    let events = 0;
    e.subscribe(() => events++);
    const r = e.transact((tx) => { tx.createBlock({ x: 0, y: 0, w: 100, h: 50 }); tx.fail('중단'); }, { origin: 'user' });
    expect(r).toEqual({ ok: false, reason: '중단' });
    expect(e.blockCount).toBe(0);
    expect(events).toBe(0);
  });

  it('연속 타이핑은 undo 엔트리 하나로 묶인다', () => {
    const e = new Engine();
    const r = createTextBlock(e, { x: 0, y: 0 });
    if (!r.ok) throw new Error();
    const cid = r.value.contentId;
    for (const t of ['가', '가나', '가나다']) setText(e, cid, textDoc(t, ''));
    expect(e.undo()).toBe(true); // 타이핑 전체 취소
    expect((e.getContent(cid) as { doc: unknown }).doc).toEqual(bodyDoc(''));
    expect(e.undo()).toBe(true); // 블록 생성 취소
    expect(e.blockCount).toBe(0);
  });

  it('새 변경은 redo 스택을 비운다', () => {
    const { e, a } = twoBlocksWithArrow();
    moveBlocks(e, [a], 10, 10);
    e.undo();
    expect(e.canRedo()).toBe(true);
    moveBlocks(e, [a], 5, 5);
    expect(e.canRedo()).toBe(false);
  });

  it('layout 트랜잭션은 undo 대상이 아니다', () => {
    const e = new Engine();
    createTextBlock(e, { x: 0, y: 0 });
    const id = [...e.blocks()][0]!.id;
    e.transact((tx) => tx.set('block', id, { h: 120 }), { origin: 'layout' });
    expect(e.undo()).toBe(true); // 생성 취소
    expect(e.canUndo()).toBe(false);
  });
});

describe('order (FR-001)', () => {
  it('중간 삽입은 다른 콘텐츠의 order를 바꾸지 않는다', () => {
    const e = new Engine();
    const r = createTextBlock(e, { x: 0, y: 0 });
    if (!r.ok) throw new Error();
    const blockId = r.value.blockId;
    const first = e.contentsOf(blockId)[0]!;
    let ops: readonly { k: string; field?: string; id: string }[] = [];
    e.subscribe((ev) => { ops = ev.ops as typeof ops; });
    e.transact((tx) => tx.createContent({ blockId, type: 'text', doc: textDoc('', 'x'), order: keyBetween(null, first.order) }), { origin: 'user' });
    expect(ops.filter((o) => o.k === 'set' && o.field === 'order')).toHaveLength(0);
    expect(e.contentsOf(blockId)[1]!.id).toBe(first.id);
  });
});

describe('직렬화 (FR-006)', () => {
  it('왕복 무손실 · 모르는 필드 보존', () => {
    const { e, a } = twoBlocksWithArrow();
    e.transact((tx) => tx.set('block', a, { futureField: { k: 1 } }), { origin: 'user' });
    const snap = serialize(e, { futureTop: [1, 2] });
    const r = deserialize(JSON.parse(JSON.stringify(snap)));
    if (!r.ok) throw new Error(JSON.stringify(r));
    const e2 = new Engine(r.data);
    expect(serialize(e2, r.extra)).toEqual(snap);
    expect((e2.getBlock(a) as unknown as Record<string, unknown>).futureField).toEqual({ k: 1 });
  });

  it('상위 버전은 거부한다 (FR-090)', () => {
    const { e } = twoBlocksWithArrow();
    const snap = { ...serialize(e), schemaVersion: 99 };
    expect(deserialize(snap)).toEqual({ ok: false, reason: 'newer-version', version: 99 });
  });

  it('참조가 깨진 스냅샷은 invalid', () => {
    const { e, a } = twoBlocksWithArrow();
    const snap = serialize(e);
    delete snap.blocks[a];
    const r = deserialize(snap);
    expect(r.ok).toBe(false);
  });
});

describe('공간 인덱스 · 히트테스트 (FR-004)', () => {
  it('겹친 블록 중 z가 가장 높은 것을 고른다', () => {
    const e = new Engine();
    const r1 = createTextBlock(e, { x: 0, y: 0 });
    const r2 = createTextBlock(e, { x: 50, y: 20 });
    if (!r1.ok || !r2.ok) throw new Error();
    expect(e.hitTest({ x: 60, y: 30 })?.id).toBe(r2.value.blockId);
  });

  it('화살표는 선 근처(8px)에서 잡히고 블록 이동을 따라간다', () => {
    const { e, a, arrow } = twoBlocksWithArrow();
    expect(e.hitTest({ x: 330, y: 44 })).toEqual({ kind: 'arrow', id: arrow });
    moveBlocks(e, [a], 0, 400);
    expect(e.hitTest({ x: 330, y: 44 })).toBeNull();
    expect(e.queryArrows({ x: 0, y: 0, w: 1000, h: 1000 })).toContain(arrow);
  });

  it('복제는 대상끼리의 화살표도 복제한다', () => {
    const { e, a, b } = twoBlocksWithArrow();
    const r = duplicateBlocks(e, [a, b]);
    if (!r.ok) throw new Error();
    expect(e.blockCount).toBe(4);
    expect([...e.arrows()]).toHaveLength(2);
  });
});

describe('뷰포트 (FR-003)', () => {
  it('고정점 줌: 커서 아래 월드 점이 그대로 남는다', () => {
    const c: Camera = { x: 120, y: -40, zoom: 1 };
    const at = { x: 300, y: 200 };
    const before = screenToWorld(c, at);
    const after = screenToWorld(zoomAt(c, at, 2.5), at);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });
});
