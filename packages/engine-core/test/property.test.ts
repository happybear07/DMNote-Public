// 속성 기반 테스트 (ENGINE 15.2, FR-009). 무작위 커맨드 열에 대해
//   P1 불변식 · P2/P3 undo·redo 왕복 · P4 실패 트랜잭션 롤백 · P5 묶음 undo · P6 직렬화 왕복 · P7 공간 인덱스 == 전수 검사.
// 기본 numRuns는 CI용(ENGINE 15.3: 200). G1 판정용 1만 회: `DN_PROP_RUNS=10000 corepack pnpm test packages/engine-core`.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  applyMeasuredHeights, bringToFront, compareKey, createArrow, createTextBlock, deleteEntities, deserialize, distToSegment, duplicateBlocks,
  Engine, moveBlocks, reconnectArrow, rectContains, rectsIntersect, resizeBlock, serialize, setArrowLabel, setNoteTitle, setText, textDoc,
  type Id, type Rect, type Side,
} from '../src';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const RUNS = Number(env.DN_PROP_RUNS ?? 200);
const MAX_LEN = 60; // fast-check 기본 size(small)는 길이를 ~10으로 묶으므로 size: 'max'로 60까지 생성한다
const SIDES: Side[] = ['auto', 'top', 'right', 'bottom', 'left'];

type Cmd =
  | { t: 'create'; x: number; y: number }
  | { t: 'move'; i: number; dx: number; dy: number }
  | { t: 'resize'; i: number; w: number; h: number }
  | { t: 'delete'; i: number }
  | { t: 'dup'; i: number }
  | { t: 'front'; i: number }
  | { t: 'arrow'; i: number; j: number }
  | { t: 'text'; i: number; s: string }
  | { t: 'reconnect'; i: number; j: number; side: number }
  | { t: 'label'; i: number; s: string }
  | { t: 'delArrow'; i: number }
  | { t: 'title'; s: string }
  | { t: 'layout'; i: number; h: number }
  | { t: 'batch'; n: number; x: number; y: number }
  | { t: 'nested'; i: number; dx: number }
  | { t: 'fail'; i: number; dx: number };

const coord = fc.integer({ min: -5000, max: 5000 });
const cmd: fc.Arbitrary<Cmd> = fc.oneof(
  fc.record({ t: fc.constant('create' as const), x: coord, y: coord }),
  fc.record({ t: fc.constant('move' as const), i: fc.nat(), dx: fc.double({ min: -500, max: 500, noNaN: true }), dy: fc.double({ min: -500, max: 500, noNaN: true }) }),
  fc.record({ t: fc.constant('resize' as const), i: fc.nat(), w: fc.integer({ min: 30, max: 900 }), h: fc.integer({ min: 30, max: 900 }) }),
  fc.record({ t: fc.constant('delete' as const), i: fc.nat() }),
  fc.record({ t: fc.constant('dup' as const), i: fc.nat() }),
  fc.record({ t: fc.constant('front' as const), i: fc.nat() }),
  fc.record({ t: fc.constant('arrow' as const), i: fc.nat(), j: fc.nat() }),
  fc.record({ t: fc.constant('text' as const), i: fc.nat(), s: fc.string({ maxLength: 12 }) }),
  fc.record({ t: fc.constant('reconnect' as const), i: fc.nat(), j: fc.nat(), side: fc.nat({ max: 4 }) }),
  fc.record({ t: fc.constant('label' as const), i: fc.nat(), s: fc.string({ maxLength: 8 }) }),
  fc.record({ t: fc.constant('delArrow' as const), i: fc.nat() }),
  fc.record({ t: fc.constant('title' as const), s: fc.string({ maxLength: 8 }) }),
  fc.record({ t: fc.constant('batch' as const), n: fc.integer({ min: 1, max: 12 }), x: coord, y: coord }),
  fc.record({ t: fc.constant('nested' as const), i: fc.nat(), dx: fc.integer({ min: -300, max: 300 }) }),
  fc.record({ t: fc.constant('fail' as const), i: fc.nat(), dx: fc.integer({ min: -300, max: 300 }) }),
);

// layout(측정 높이 반영)은 undo 밖이라(ENGINE 10.2) undo 왕복 속성에서는 빼고, 직렬화 · 인덱스 속성에만 섞는다.
const layoutCmd: fc.Arbitrary<Cmd> = fc.record({ t: fc.constant('layout' as const), i: fc.nat(), h: fc.integer({ min: 24, max: 600 }) });

const undoDepth = (e: Engine) => (e as unknown as { history: { undoStack: unknown[] } }).history.undoStack.length;

function run(e: Engine, c: Cmd): void {
  const ids: Id[] = [...e.blocks()].map((b) => b.id).sort();
  const pick = (i: number) => (ids.length ? ids[i % ids.length]! : null);
  const arrows: Id[] = [...e.arrows()].map((a) => a.id).sort();
  const pickArrow = (i: number) => (arrows.length ? arrows[i % arrows.length]! : null);
  switch (c.t) {
    case 'create': createTextBlock(e, { x: c.x, y: c.y }); break;
    case 'move': { const id = pick(c.i); if (id) moveBlocks(e, [id], c.dx, c.dy); break; }
    case 'resize': { const id = pick(c.i); const b = id && e.getBlock(id); if (b) resizeBlock(e, b.id, { x: b.x, y: b.y, w: c.w, h: c.h }, c.h % 2 === 0); break; }
    case 'delete': { const id = pick(c.i); if (id) deleteEntities(e, [id]); break; }
    case 'dup': { const id = pick(c.i); if (id) duplicateBlocks(e, [id]); break; }
    case 'front': { const id = pick(c.i); if (id) bringToFront(e, [id]); break; }
    case 'arrow': { const a = pick(c.i), b = pick(c.j); if (a && b && a !== b) createArrow(e, { blockId: a, side: 'auto' }, { blockId: b, side: 'auto' }); break; }
    case 'text': { const id = pick(c.i); const ct = id && e.contentsOf(id)[0]; if (ct) setText(e, ct.id, textDoc(c.s, '')); break; }
    case 'reconnect': {
      // 같은 블록을 잇게 되면 I2 위반 → 롤백되어야 한다 (일부러 실패하는 경로도 섞는다)
      const a = pickArrow(c.i), b = pick(c.j);
      if (a && b) reconnectArrow(e, a, c.side % 2 ? 'from' : 'to', { blockId: b, side: SIDES[c.side]! });
      break;
    }
    case 'label': { const a = pickArrow(c.i); if (a) setArrowLabel(e, a, c.s); break; }
    case 'delArrow': { const a = pickArrow(c.i); if (a) deleteEntities(e, [], [a]); break; }
    case 'title': setNoteTitle(e, c.s); break;
    case 'layout': { const id = pick(c.i); if (id) applyMeasuredHeights(e, new Map([[id, c.h]])); break; }
    case 'batch':
      e.transact(() => { for (let k = 0; k < c.n; k++) createTextBlock(e, { x: c.x + k * 300, y: c.y }); }, { origin: 'user', label: '묶음' });
      break;
    case 'nested': {
      // 중첩 트랜잭션은 바깥에 합류 → undo 1단계
      const id = pick(c.i);
      if (id) e.transact(() => { moveBlocks(e, [id], c.dx, 0); bringToFront(e, [id]); createTextBlock(e, { x: c.dx, y: 0 }); }, { origin: 'user' });
      break;
    }
    case 'fail': {
      // P4: 변경 후 실패 → 전후 직렬화 동일, undo 스택 불변
      const before = snap(e), depth = undoDepth(e);
      const id = pick(c.i);
      const r = e.transact((tx) => {
        if (id) moveBlocks(e, [id], c.dx, c.dx);
        createTextBlock(e, { x: c.dx, y: c.dx });
        tx.fail('일부러 실패');
      }, { origin: 'user' });
      expect(r.ok).toBe(false);
      expect(snap(e)).toBe(before);
      expect(undoDepth(e)).toBe(depth);
      break;
    }
  }
}

function snap(e: Engine): string {
  const s = serialize(e);
  return JSON.stringify({ ...s, note: { ...s.note, updatedAt: 0 } });
}

/** P1: 전수 불변식 — 참조 무결성 (I1 · I2), 좌표 유한 · 최소 크기 (I6) */
function checkInvariants(e: Engine): void {
  const blocks = new Set([...e.blocks()].map((b) => b.id));
  for (const b of e.blocks()) {
    expect(Number.isFinite(b.x) && Number.isFinite(b.y) && b.w >= 24 && b.h >= 24).toBe(true);
  }
  for (const c of e.contents()) expect(blocks.has(c.blockId)).toBe(true);
  for (const a of e.arrows()) {
    expect(blocks.has(a.from.blockId!) && blocks.has(a.to.blockId!) && a.from.blockId !== a.to.blockId).toBe(true);
  }
}

/** P6: deserialize(serialize(doc)) ≡ doc — JSON을 거쳐 저장소 경로와 같게 */
function checkRoundTrip(e: Engine): void {
  const s = serialize(e);
  const r = deserialize(JSON.parse(JSON.stringify(s)));
  if (!r.ok) throw new Error(JSON.stringify(r));
  const e2 = new Engine(r.data);
  expect(serialize(e2)).toEqual(s);
}

/** P7: 영역 질의 · 점 판정 == 전수 검사 */
function checkIndex(e: Engine, probes: readonly { i: number; dx: number; dy: number; w: number; h: number }[]): void {
  const blocks = [...e.blocks()];
  const arrows = [...e.arrows()];
  const sorted = (xs: Id[]) => [...xs].sort();
  for (const p of probes) {
    // 기존 블록 근처를 노려야 겹침 · 경계 사례가 나온다
    const b = blocks.length ? blocks[p.i % blocks.length]! : null;
    const r: Rect = { x: (b?.x ?? 0) + p.dx, y: (b?.y ?? 0) + p.dy, w: p.w, h: p.h };
    expect(sorted(e.queryBlocks(r))).toEqual(sorted(blocks.filter((x) => rectsIntersect(x, r)).map((x) => x.id)));
    const arrowHits = arrows.filter((a) => {
      const g = e.arrowGeometry(a);
      if (!g) return false;
      const box = { x: Math.min(g.a.x, g.b.x), y: Math.min(g.a.y, g.b.y), w: Math.abs(g.a.x - g.b.x), h: Math.abs(g.a.y - g.b.y) };
      return rectsIntersect(box, r);
    });
    expect(sorted(e.queryArrows(r))).toEqual(sorted(arrowHits.map((a) => a.id)));

    const pt = { x: r.x, y: r.y };
    let top: (typeof blocks)[number] | null = null;
    for (const x of blocks) {
      if (rectContains(x, pt) && (!top || compareKey(x.z, top.z) > 0 || (x.z === top.z && x.id > top.id))) top = x;
    }
    const hit = e.hitTest(pt);
    if (top) { expect(hit).toEqual({ kind: 'block', id: top.id }); continue; }
    let best = Infinity;
    for (const a of arrows) { const g = e.arrowGeometry(a); if (g) best = Math.min(best, distToSegment(pt, g.a, g.b)); }
    if (best <= 8) {
      expect(hit?.kind).toBe('arrow');
      const a = e.getArrow(hit!.id)!; const g = e.arrowGeometry(a)!;
      expect(distToSegment(pt, g.a, g.b)).toBe(best); // 동률이면 id는 다를 수 있어 거리로 비교
    } else expect(hit).toBeNull();
  }
}

const probe = fc.record({
  i: fc.nat(), dx: fc.integer({ min: -400, max: 400 }), dy: fc.integer({ min: -200, max: 200 }),
  w: fc.integer({ min: 0, max: 800 }), h: fc.integer({ min: 0, max: 600 }),
});

describe('무작위 커맨드 열 속성 (FR-002 · FR-004 · FR-006 · FR-009)', () => {
  it('P1 · P2 · P3 · P4 · P6 · P7: 매 커맨드 후 불변식 · 직렬화 왕복 · 인덱스 일치, 끝에 전부 undo/redo 왕복', () => {
    fc.assert(
      fc.property(fc.array(cmd, { minLength: 1, maxLength: MAX_LEN, size: 'max' }), fc.array(probe, { minLength: 1, maxLength: 6 }), (cmds, probes) => {
        const e = new Engine();
        createTextBlock(e, { x: 0, y: 0 });
        e.clearHistory();
        const initial = snap(e);
        for (const c of cmds) {
          run(e, c);
          // 타이핑 병합 창(1초)을 끊어 엔트리 경계를 커맨드와 맞춘다
          (e as unknown as { history: { undoStack: { at: number }[] } }).history.undoStack.forEach((x) => { x.at = 0; });
          checkInvariants(e);
          checkRoundTrip(e);
          checkIndex(e, probes);
        }
        const final = snap(e);
        while (e.undo()) checkIndex(e, probes);
        expect(snap(e)).toBe(initial);
        while (e.redo()) { /* 전부 재실행 */ }
        expect(snap(e)).toBe(final);
        checkIndex(e, probes);
      }),
      { numRuns: RUNS },
    );
  }, 600_000);

  it('P1 · P6 · P7 (layout 트랜잭션 포함): 매 커맨드 후 불변식 · 직렬화 왕복 · 인덱스 일치', () => {
    fc.assert(
      fc.property(fc.array(fc.oneof({ arbitrary: cmd, weight: 4 }, { arbitrary: layoutCmd, weight: 1 }), { minLength: 1, maxLength: MAX_LEN, size: 'max' }), fc.array(probe, { minLength: 1, maxLength: 6 }), (cmds, probes) => {
        const e = new Engine();
        for (const c of cmds) {
          run(e, c);
          checkInvariants(e);
          checkRoundTrip(e);
          checkIndex(e, probes);
        }
      }),
      { numRuns: Math.max(50, Math.round(RUNS / 2)) },
    );
  }, 600_000);

  it('P5: 블록 N개를 만드는 트랜잭션은 undo 1회로 전부 사라진다 (FR-002 "100개 = 1단계")', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 120 }), fc.array(cmd, { maxLength: 10, size: 'max' }), (n, pre) => {
        const e = new Engine();
        for (const c of pre) run(e, c);
        (e as unknown as { history: { undoStack: { at: number }[] } }).history.undoStack.forEach((x) => { x.at = 0; });
        const before = snap(e), count = e.blockCount;
        e.transact(() => { for (let k = 0; k < n; k++) createTextBlock(e, { x: k * 10, y: 7000 }); }, { origin: 'ai', label: 'AI 적용' });
        expect(e.blockCount).toBe(count + n);
        expect(e.undo()).toBe(true);
        expect(snap(e)).toBe(before);
      }),
      { numRuns: Math.max(50, Math.round(RUNS / 4)) },
    );
  });
});
