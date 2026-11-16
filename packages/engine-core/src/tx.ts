// 트랜잭션 핸들(Tx) 생성 · 개발 빌드 검사. 엔진 내부 상태는 TxHost로만 만진다 —
// Engine의 private 필드를 공개하지 않고도 파일을 나누기 위해서다.
import { q } from './geom';
import { newId } from './id';
import type { Arrow, Block, Content, EntityKind, Id, Note, TextContent, TextDoc } from './model';
import { sameValue, type Op, type Origin } from './ops';
import { keyBetween } from './order';
import type { Engine } from './engine';

export interface TxOptions {
  origin: Origin;
  label?: string;
  /** 기본: origin이 user · text · ai면 undo 대상 */
  undoable?: boolean;
  /** 같은 키의 연속 트랜잭션(1초 이내)은 undo 엔트리 하나로 합친다 — 타이핑 묶음 */
  mergeKey?: string;
}

export type TxResult<R> = { ok: true; value: R; txId: string } | { ok: false; reason: string };

export type BlockInit = Partial<Omit<Block, 'x' | 'y' | 'w' | 'h'>> & Pick<Block, 'x' | 'y' | 'w' | 'h'>;
export type ContentInit = Partial<Content> & Pick<Content, 'blockId' | 'type'> & Record<string, unknown>;
export type ArrowInit = Partial<Arrow> & Pick<Arrow, 'from' | 'to'>;

export interface Tx {
  readonly engine: Engine;
  createBlock(init: BlockInit): Id;
  createContent(init: ContentInit): Id;
  createArrow(init: ArrowInit): Id;
  set(e: EntityKind, id: Id, patch: Record<string, unknown>): void;
  setNote(patch: Partial<Omit<Note, 'id'>>): void;
  delete(e: EntityKind, id: Id): void;
  /** 텍스트 콘텐츠에 ProseMirror 스텝 적용 (역스텝은 코덱이 계산) */
  text(contentId: Id, steps: readonly unknown[]): void;
  /** 이미 만들어진 Op 적용 (undo · redo · 로그 재생). prev는 현재 상태로 다시 읽는다. */
  apply(op: Op): void;
  fail(reason: string): never;
}

export class TxFail extends Error {}

// 개발 빌드 검사 (ENGINE 2.4): 엔진이 돌려주는 레코드를 얼려, 밖에서 직접 고치는 실수를 그 자리에서 터뜨린다.
// 얕게만 언다 — 레코드는 매번 새 객체로 바뀌므로(불변) 이걸로 충분하고, 운영 빌드에서는 열기 비용을 아끼려 끈다.
let devChecks = false;
export function setDevChecks(on: boolean): void { devChecks = on; }
export function frozen<T>(v: T): T { return devChecks ? Object.freeze(v) : v; }

/** Tx가 엔진 내부에 닿는 통로. 엔진이 자기 private 멤버로 채워 넘긴다. */
export interface TxHost {
  readonly engine: Engine;
  /** 이 Tx가 지금 진행 중인 트랜잭션의 것인가 */
  isLive(tx: Tx): boolean;
  applyRaw(op: Op): void;
  mapOf(e: EntityKind): Map<Id, any>;
  applySteps(doc: TextDoc, steps: readonly unknown[]): { doc: TextDoc; inverse: unknown[] };
}

export function makeTx(ops: Op[], host: TxHost): Tx {
  const engine = host.engine;
  // 끝난 트랜잭션의 Tx를 붙잡아 두고 쓰면 이벤트 · undo 없이 상태가 바뀐다 — 막는다 (FR-001 "직접 변이 API 없음")
  const live = () => { if (!host.isLive(tx)) throw new Error('끝난 트랜잭션의 Tx는 쓸 수 없음'); };
  const push = (op: Op) => { live(); host.applyRaw(op); ops.push(op); };
  const fail = (reason: string): never => { throw new TxFail(reason); };
  const tx: Tx = {
    engine,
    createBlock(init) {
      const id = init.id ?? newId();
      const value: Block = {
        sizing: 'auto', layout: 'flow', ...init, id,
        z: init.z ?? keyBetween(engine.topZ(), null),
        x: q(init.x), y: q(init.y), w: q(init.w), h: q(init.h),
      } as Block;
      tx.apply({ k: 'create', e: 'block', id, value });
      return id;
    },
    createContent(init) {
      const id = (init.id as Id | undefined) ?? newId();
      let order = init.order as string | undefined;
      if (!order) {
        const sibs = engine.contentsOf(init.blockId);
        order = keyBetween(sibs.length ? sibs[sibs.length - 1]!.order : null, null);
      }
      tx.apply({ k: 'create', e: 'content', id, value: { ...init, id, order } });
      return id;
    },
    createArrow(init) {
      const id = init.id ?? newId();
      tx.apply({ k: 'create', e: 'arrow', id, value: { ...init, id } });
      return id;
    },
    set(e, id, patch) {
      if (!host.mapOf(e).has(id)) fail(`set: ${e} ${id} 없음`);
      for (const [field, raw] of Object.entries(patch)) {
        if (field === 'id') continue;
        const value = quantizeField(e, field, raw);
        const cur = host.mapOf(e).get(id)[field];
        if (sameValue(cur, value)) continue;
        push({ k: 'set', e, id, field, value, prev: cur });
      }
    },
    setNote(patch) {
      for (const [field, value] of Object.entries(patch)) {
        if (field === 'id') continue;
        const cur = (engine.note as unknown as Record<string, unknown>)[field];
        if (sameValue(cur, value)) continue;
        push({ k: 'set', e: 'note', id: engine.note.id, field, value, prev: cur });
      }
    },
    delete(e, id) {
      const prev = host.mapOf(e).get(id);
      if (!prev) fail(`delete: ${e} ${id} 없음`);
      push({ k: 'delete', e, id, prev });
    },
    text(id, steps) {
      live();
      const contents = host.mapOf('content');
      const c = contents.get(id) as TextContent | undefined;
      if (!c || c.type !== 'text') return fail(`text: 텍스트 콘텐츠 ${id} 없음`);
      const r = host.applySteps(c.doc, steps);
      contents.set(id, frozen({ ...c, doc: r.doc }));
      ops.push({ k: 'text', e: 'content', id, steps: [...steps], inverse: r.inverse });
    },
    apply(op) {
      switch (op.k) {
        case 'text':
          tx.text(op.id, op.steps);
          return;
        case 'create':
          if (host.mapOf(op.e).has(op.id)) fail(`create: ${op.e} ${op.id} 이미 있음`);
          push(op);
          return;
        case 'delete':
          tx.delete(op.e, op.id);
          return;
        case 'set':
          if (op.e === 'note') tx.setNote({ [op.field]: op.value } as Partial<Note>);
          else tx.set(op.e, op.id, { [op.field]: op.value });
          return;
      }
    },
    fail,
  };
  return tx;
}

function quantizeField(e: EntityKind, field: string, v: unknown): unknown {
  if (e === 'block' && typeof v === 'number' && (field === 'x' || field === 'y' || field === 'w' || field === 'h' || field === 'minH')) return q(v);
  // 잉크 원점도 1/64 격자 — 이동 · 묶기 왕복이 오차 없이 (ENGINE 3.3)
  if (e === 'stroke' && field === 'origin' && v && typeof v === 'object') { const o = v as { x: number; y: number }; return { x: q(o.x), y: q(o.y) }; }
  return v;
}
