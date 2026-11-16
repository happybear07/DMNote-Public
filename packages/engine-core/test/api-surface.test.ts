// API 표면 테스트 (FR-001 "모델 변경은 커맨드로만, 직접 변이 API 없음", ENGINE 2.4 · 18절).
// 런타임: 공개 멤버 · export 목록을 고정해 새 변이 경로가 리뷰 없이 생기지 못하게 하고, 모든 커맨드의 변경이 트랜잭션(이벤트)을 거치는지 본다.
// 컴파일 타임: 레코드 readonly · 내부 멤버 private 을 @ts-expect-error 로 단언한다 (tsc -p packages/engine-core/test).
import { describe, expect, it } from 'vitest';
import * as core from '../src';
import {
  applyMeasuredHeights, setBlockColor, editTexts, bringToFront, createArrow, createTextBlock, deleteEntities, duplicateBlocks, editText, Engine, moveBlocks,
  reconnectArrow, resizeBlock, serialize, setArrowLabel, setNoteTitle, setText, textDoc, type Id,
} from '../src';

// 읽기 전용 멤버와, 트랜잭션 · 기록만 다루는 쓰기 진입점. 여기에 없는 공개 멤버가 생기면 실패한다 — 변이 경로인지 리뷰 후 추가할 것.
const READ = [
  'note', 'updatedAt', 'getBlock', 'getContent', 'getArrow', 'getStroke', 'blocks', 'arrows', 'contents', 'strokes', 'blockCount',
  'contentsOf', 'arrowsOf', 'topZ', 'blockRect', 'arrowGeometry', 'queryBlocks', 'queryArrows', 'blocksBounds', 'queryBlocksInPolygon', 'hitTest', 'canUndo', 'canRedo', 'subscribe',
];
// undoNotice: 일부만 되돌렸을 때 알림을 받는 콜백(setter) — 상태를 바꾸지 않는다 (SYNC 13.7)
const WRITE = ['transact', 'replay', 'undo', 'redo', 'breakUndoMerge', 'clearHistory', 'undoNotice'];
// TS private — 런타임에는 프로토타입에 보이지만 타입상 접근 불가 (아래 @ts-expect-error 로 고정)
const PRIVATE = ['mapOf', 'applyRaw', 'applySteps', 'indexAdd', 'indexRemove', 'markDirty', 'refreshSpatial', 'groupEnds', 'dirtyGroup'];

const snap = (e: Engine) => { const s = serialize(e); return JSON.stringify({ ...s, note: { ...s.note, updatedAt: 0 } }); };

function setup() {
  const e = new Engine();
  const a = createTextBlock(e, { x: 0, y: 0 }, { title: 'A' });
  const b = createTextBlock(e, { x: 400, y: 0 }, { title: 'B' });
  if (!a.ok || !b.ok) throw new Error('setup');
  const arr = createArrow(e, { blockId: a.value.blockId, side: 'auto' }, { blockId: b.value.blockId, side: 'auto' });
  if (!arr.ok) throw new Error('setup');
  return { e, a: a.value.blockId, ac: a.value.contentId, b: b.value.blockId, arrow: arr.value };
}

describe('API 표면 (FR-001 직접 변이 API 없음)', () => {
  it('Engine 공개 멤버는 읽기 · 트랜잭션 · 기록 진입점뿐이다', () => {
    const own = Object.getOwnPropertyNames(Engine.prototype).filter((k) => k !== 'constructor');
    expect(new Set(own)).toEqual(new Set([...READ, ...WRITE, ...PRIVATE]));
    // 인스턴스 필드도 모두 private 선언이어야 한다 — 공개 필드가 생기면 여기서 드러난다
    const fields = Object.keys(new Engine());
    expect(fields.filter((k) => !/^(_note|\w+Map|contentsByBlock|arrowsByBlock|blockTree|arrowTree|blockItems|arrowItems|dirtyBlocks|dirtyArrows|maxZ|current|history|runHistory|guardView|listeners|lastChangeAt|codec)$/.test(k))).toEqual([]);
    // 접근자는 getter만 (setter 없음)
    for (const k of ['note', 'updatedAt', 'blockCount']) {
      const d = Object.getOwnPropertyDescriptor(Engine.prototype, k)!;
      expect(d.get).toBeTypeOf('function');
      expect(d.set).toBeUndefined();
    }
  });

  it('엔진을 받는 export 함수(커맨드)는 모두 engine.transact 로만 바꾼다', () => {
    // 커맨드 카탈로그는 계속 늘어나므로 목록 대신 규칙으로 검사한다: 첫 인자가 engine 인 함수 = 커맨드 (읽기 전용 함수는 제외).
    const readOnly = new Set(['serialize', 'freeStrokes', 'lassoStrokes', 'strokesOfContent', 'inkTransform', 'boundStrokesWorld', 'cloneBoundStrokes', 'inkPaths', 'tocEntries', 'noteAttachments', 'noteOpenComments', 'blockClip', 'diffBlocks', 'relationTargets', 'relationPair', 'rollupValue', 'dbCellTextIn', 'contentBottom', 'boardBounds', 'clampToNoteSheet', 'sheetFits', 'groupMembers', 'groupOf', 'groupName', 'noteGroups', 'documentOrder', 'docUnits', 'docUnitIds', 'docDropTarget', 'docStepTarget', 'blockDataOrigin', 'inkFigures', 'figurePaths', 'createFromClip', 'captionKind', 'captionNumbers', 'dbToCsv', 'diagramToMermaid', 'mermaidOfBlock', 'presentSlides', 'isCardGroup', 'noteCards', 'overlappingCards', 'dividerOf', 'groupHeadings', 'clearTargets', 'coverItems']);
    const cmds = Object.entries(core).filter((x): x is [string, (...a: unknown[]) => unknown] =>
      typeof x[1] === 'function' && /^function\s*\w*\s*\(\s*engine\b/.test(String(x[1])) && !readOnly.has(x[0]));
    expect(cmds.length).toBeGreaterThan(10);
    for (const [name, fn] of cmds) expect(String(fn), name).toMatch(/\bengine\.transact\(/);
  });

  it('모든 커맨드의 상태 변경은 트랜잭션을 거쳐 변경 이벤트로 드러난다', () => {
    const { e, a, ac, b, arrow } = setup();
    let txCalls = 0;
    const orig = e.transact.bind(e);
    (e as { transact: Engine['transact'] }).transact = ((fn, opts) => { txCalls++; return orig(fn, opts); }) as Engine['transact'];
    let events = 0;
    e.subscribe(() => events++);
    const codecFree: Record<string, () => unknown> = {
      createTextBlock: () => createTextBlock(e, { x: 900, y: 900 }),
      moveBlocks: () => moveBlocks(e, [a], 5, 5),
      resizeBlock: () => resizeBlock(e, a, { x: 5, y: 5, w: 300, h: 200 }, true),
      duplicateBlocks: () => duplicateBlocks(e, [a, b]),
      bringToFront: () => bringToFront(e, [a]),
      createArrow: () => createArrow(e, { blockId: b, side: 'auto' }, { blockId: a, side: 'auto' }),
      reconnectArrow: () => reconnectArrow(e, arrow, 'to', { blockId: b, side: 'left' }),
      setArrowLabel: () => setArrowLabel(e, arrow, '라벨'),
      setText: () => setText(e, ac, textDoc('바뀐 제목', '')),
      // 코덱 없는 엔진에서는 실패 → 롤백되어야 한다 (변경 없음 · 이벤트 없음)
      editText: () => editText(e, ac, [{ stepType: 'replace', from: 1, to: 1 }]),
      editTexts: () => editTexts(e, [{ contentId: ac, steps: [{ stepType: 'replace', from: 1, to: 1 }] }]),
      setBlockColor: () => setBlockColor(e, [a], '#f00'),
      setNoteTitle: () => setNoteTitle(e, '제목'),
      applyMeasuredHeights: () => applyMeasuredHeights(e, new Map([[b, 333]])),
      deleteEntities: () => deleteEntities(e, [b]),
    };
    for (const [name, run] of Object.entries(codecFree)) {
      const before = snap(e), tx0 = txCalls, ev0 = events;
      run();
      const changed = snap(e) !== before;
      expect(txCalls - tx0, `${name}: transact 호출`).toBeGreaterThan(0);
      expect(events - ev0 > 0, `${name}: 상태가 바뀌면(${changed}) 이벤트도 있어야 한다`).toBe(changed);
    }
  });

  it('컴파일 타임: 레코드는 readonly, 내부 상태는 private', () => {
    const { e, a } = setup();
    const b = e.getBlock(a)!;
    const probes = () => {
      // @ts-expect-error 레코드 필드는 readonly
      b.x = 1;
      // @ts-expect-error 노트도 readonly
      e.note.title = 'x';
      // @ts-expect-error 내부 맵은 private
      e.blocksMap.clear();
      // @ts-expect-error Op 직접 적용 경로는 private
      e.applyRaw({ k: 'delete', e: 'block', id: a, prev: b });
      // @ts-expect-error 변경 이벤트의 ops 는 readonly 배열
      e.subscribe((ev) => ev.ops.push(ev.ops[0]!));
      const id: Id = a;
      return id;
    };
    expect(probes).toBeTypeOf('function'); // 실행하지 않는다 — 타입 검사 대상일 뿐
  });

  // ── 개발 빌드 검사 (vitest.setup.ts가 setDevChecks(true)) ──

  it('개발 빌드에서 반환 레코드는 얼어 있다 (ENGINE 2.4)', () => {
    const { e, a } = setup();
    expect(Object.isFrozen(e.getBlock(a))).toBe(true);
    expect(Object.isFrozen(e.note)).toBe(true);
  });

  it('끝난 트랜잭션의 Tx를 붙잡아 써도 상태가 바뀌지 않는다', () => {
    const { e, a } = setup();
    let leaked: core.Tx | null = null;
    e.transact((tx) => { leaked = tx; }, { origin: 'user' });
    const before = snap(e);
    let events = 0;
    e.subscribe(() => events++);
    try { (leaked as core.Tx | null)?.set('block', a, { x: 999 }); } catch { /* 막혔다면 정상 */ }
    // 바뀌었다면 이벤트 · undo 없이 바뀐 것이다
    expect(snap(e)).toBe(before);
    expect(events).toBe(0);
  });
});
