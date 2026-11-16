// 엔진 본체: 정규화 맵 상태 · 트랜잭션 · undo · 변경 이벤트 · 공간 인덱스 (ENGINE 3.5 · 5장 · 7장).
//
// 트랜잭션은 동기적으로 실행된다. 연산을 상태에 바로 적용하고 기록해 두었다가, 실패하면
// 역연산을 역순으로 적용해 되돌린다. 실행 중에는 바깥에서 상태를 관찰할 수 없으므로
// ENGINE 5.4의 "드래프트 후 커밋"과 관찰 가능한 결과가 같다.
//
// 상태(필드)는 모두 Engine이 private으로 든다 (API 표면 테스트가 고정). 나머지 파일에는 필요한 것만 넘긴다:
// Tx 핸들은 tx.ts, 불변식은 invariants.ts, undo 기록 규칙은 history.ts, R-tree 동기화는 spatial.ts.
import RBush from 'rbush';
import { arrowPath, endsTouch, fitAnchors, type ArrowPath } from './arrow-geom';
import {
  distToSegment, polygonBounds, polygonContainsRect, polygonIntersectsRect, rectContains, type Rect, type Vec2,
} from './geom';
import { History, type UndoNotice } from './history';
import { newId } from './id';
import { validateOps } from './invariants';
import { isBlockEnd, isBound, type Anchor, type Arrow, type Block, type BlockAnchor, type Content, type EntityKind, type Id, type Note, type StrokeRecord, type TextCodec, type TextContent, type TextDoc } from './model';

/** 경로 계산에 넘길 끝 — 빈 곳의 점 끝은 크기 0인 사각형의 'auto' 끝(그 점이 곧 끝점, arrow-geom.ts) */
const geoEnd = (an: Anchor): BlockAnchor => (isBlockEnd(an) ? an : { blockId: '', side: 'auto' });
import { invertAll, type Op, type Origin } from './ops';
import { compareByOrder, compareKey } from './order';
import { stampEdits } from './provenance';
import { endRect } from './group-anchor';
import { pathMid, routePoints } from './arrow-route';
import { bulkLoadSpatial, refreshSpatial, type SpatialItem } from './spatial';
import { frozen, makeTx, TxFail, type Tx, type TxOptions, type TxResult } from './tx';

export { setDevChecks } from './tx';
export type { ArrowInit, BlockInit, ContentInit, Tx, TxOptions, TxResult } from './tx';

export interface DocData {
  note: Note;
  blocks: Iterable<Block>;
  contents: Iterable<Content>;
  arrows: Iterable<Arrow>;
  strokes: Iterable<StrokeRecord>;
}

export interface ChangeEvent {
  readonly txId: string;
  readonly origin: Origin;
  readonly label?: string;
  readonly ops: readonly Op[];
  /** 바뀐 엔티티 id (노트 필드 변경이면 노트 id 포함) */
  readonly changed: ReadonlySet<Id>;
}

export interface HitResult { kind: 'block' | 'arrow'; id: Id }

let defaultCodec: TextCodec | null = null;
/** 앱 시작 시 한 번 등록한다 (text-pm). 엔진 생성 시 codec을 따로 주면 그것이 우선. */
export function setDefaultTextCodec(c: TextCodec | null): void { defaultCodec = c; }
/** 앱이 정한 텍스트 코덱 (동기화 다리가 합쳐진 글을 고칠 때) */
export function defaultTextCodec(): TextCodec | null { return defaultCodec; }

const ARROW_HIT_TOLERANCE = 8;

export class Engine {
  private _note: Note;
  private readonly blocksMap = new Map<Id, Block>();
  private readonly contentsMap = new Map<Id, Content>();
  private readonly arrowsMap = new Map<Id, Arrow>();
  private readonly strokesMap = new Map<Id, StrokeRecord>();

  // 파생 인덱스 (저장 안 함)
  private readonly contentsByBlock = new Map<Id, Set<Id>>();
  private readonly arrowsByBlock = new Map<Id, Set<Id>>();
  /** 묶음 id → 상자 · 묶음 끝 화살표 (v6 묶음 끝 화살표의 기하 · 다시 그리기) */
  private readonly groupMembersMap = new Map<Id, Set<Id>>();
  private readonly groupArrowsMap = new Map<Id, Set<Id>>();
  private readonly blockTree = new RBush<SpatialItem>();
  private readonly arrowTree = new RBush<SpatialItem>();
  private readonly blockItems = new Map<Id, SpatialItem>();
  private readonly arrowItems = new Map<Id, SpatialItem>();
  private readonly dirtyBlocks = new Set<Id>();
  private readonly dirtyArrows = new Set<Id>();
  private maxZ: string | null = null;

  private current: { ops: Op[]; tx: Tx; txId: string } | null = null;
  private readonly history = new History();
  private readonly listeners = new Set<(e: ChangeEvent) => void>();
  private lastChangeAt = 0;
  private readonly codec: TextCodec | null;

  constructor(data?: Partial<DocData> & { note?: Note }, opts: { codec?: TextCodec } = {}) {
    this.codec = opts.codec ?? defaultCodec;
    const now = Date.now();
    this._note = frozen(data?.note ? { ...data.note } : { id: newId(), title: '', createdAt: now, updatedAt: now });
    for (const b of data?.blocks ?? []) this.applyRaw({ k: 'create', e: 'block', id: b.id, value: b });
    for (const c of data?.contents ?? []) this.applyRaw({ k: 'create', e: 'content', id: c.id, value: c });
    for (const a of data?.arrows ?? []) this.applyRaw({ k: 'create', e: 'arrow', id: a.id, value: a });
    for (const s of data?.strokes ?? []) this.applyRaw({ k: 'create', e: 'stroke', id: s.id, value: s });
    this.refreshSpatial(true);
    this.lastChangeAt = this._note.updatedAt;
  }

  // ───────── 읽기 ─────────
  get note(): Note { return this._note; }
  get updatedAt(): number { return this.lastChangeAt; }
  getBlock(id: Id): Block | undefined { return this.blocksMap.get(id); }
  getContent(id: Id): Content | undefined { return this.contentsMap.get(id); }
  getArrow(id: Id): Arrow | undefined { return this.arrowsMap.get(id); }
  getStroke(id: Id): StrokeRecord | undefined { return this.strokesMap.get(id); }
  blocks(): IterableIterator<Block> { return this.blocksMap.values(); }
  arrows(): IterableIterator<Arrow> { return this.arrowsMap.values(); }
  contents(): IterableIterator<Content> { return this.contentsMap.values(); }
  strokes(): IterableIterator<StrokeRecord> { return this.strokesMap.values(); }
  get blockCount(): number { return this.blocksMap.size; }

  contentsOf(blockId: Id): Content[] {
    const ids = this.contentsByBlock.get(blockId);
    if (!ids) return [];
    const out: Content[] = [];
    for (const id of ids) { const c = this.contentsMap.get(id); if (c) out.push(c); }
    return out.sort(compareByOrder);
  }

  arrowsOf(blockId: Id): Arrow[] {
    const ids = this.arrowsByBlock.get(blockId);
    if (!ids) return [];
    const out: Arrow[] = [];
    for (const id of ids) { const a = this.arrowsMap.get(id); if (a) out.push(a); }
    return out;
  }

  topZ(): string | null { return this.maxZ; }

  blockRect(id: Id): Rect | undefined {
    const b = this.blocksMap.get(id);
    return b ? { x: b.x, y: b.y, w: b.w, h: b.h } : undefined;
  }

  /** 화살표 기하. `rectOf`로 프리뷰 중인 블록 위치를 덮어쓸 수 있다 (드래그 중 추종).
   *  undefined: 끝 상자가 없거나, 두 상자가 붙어 있음 — 그리기 · 누르기 · 공간 색인에서 빠지고 화살표 · 라벨은 그대로(떼면 다시 보인다) */
  arrowGeometry(a: Arrow, rectOf?: (id: Id) => Rect | undefined): ArrowPath | undefined {
    const rect = (id: Id) => rectOf?.(id) ?? this.blockRect(id);
    // 묶음 끝(v6)이면 묶음 둘레에서
    const fr = endRect(a.from, this.groupMembersMap, rect), tr = endRect(a.to, this.groupMembersMap, rect);
    const boxes = isBound(a);
    if (!fr || !tr || (boxes && endsTouch(fr, tr)) || (!boxes && fr.x === tr.x && fr.y === tr.y && !fr.w && !tr.w)) return undefined; // 붙은 두 상자 · 길이 0
    const [fa, ta] = fitAnchors(fr, geoEnd(a.from), tr, geoEnd(a.to)); // 정한 변이 상대를 등지면 마주 보는 변으로
    const p = arrowPath(fr, fa, tr, ta);
    const route = a.style?.route; // 꺾은선 · 곡선 · 되돌림 (v6 모양) — 누르기 · 색인 · 라벨도 같은 경로
    if (!route || route === 'straight') return p;
    const side = fa.side, first = side === 'top' || side === 'bottom' ? 'v' : side === 'left' || side === 'right' ? 'h' : undefined;
    const pts = routePoints(p.a, p.b, route, first);
    return { ...p, pts, mid: pathMid(pts) };
  }

  queryBlocks(r: Rect): Id[] {
    return this.blockTree.search({ minX: r.x, minY: r.y, maxX: r.x + r.w, maxY: r.y + r.h }).map((i) => i.id);
  }

  /** 캔버스에 놓인 블록 전체를 감싸는 사각형 — 공간 색인 뿌리에서 바로(블록 수와 무관). 없으면 null */
  blocksBounds(): Rect | null {
    const r = this.blockTree.toJSON() as { minX: number; minY: number; maxX: number; maxY: number };
    return Number.isFinite(r.minX) ? { x: r.minX, y: r.minY, w: r.maxX - r.minX, h: r.maxY - r.minY } : null;
  }

  queryArrows(r: Rect): Id[] {
    return this.arrowTree.search({ minX: r.x, minY: r.y, maxX: r.x + r.w, maxY: r.y + r.h }).map((i) => i.id);
  }

  /**
   * 올가미(자유곡선) 영역 질의 (FR-004): R-tree로 후보를 좁힌 뒤 다각형 판정.
   * `contain`: 블록이 올가미 안에 완전히 들어가야 함(기본, 필기 앱 관례) · `intersect`: 조금이라도 겹치면.
   */
  queryBlocksInPolygon(poly: readonly Vec2[], mode: 'contain' | 'intersect' = 'contain'): Id[] {
    const bb = polygonBounds(poly);
    if (!bb || poly.length < 3) return [];
    const test = mode === 'contain' ? polygonContainsRect : polygonIntersectsRect;
    return this.queryBlocks(bb).filter((id) => { const b = this.blocksMap.get(id); return !!b && test(poly, b); });
  }

  /** 점 판정: 블록(z 최상위) → 화살표(선 거리 tol 이내 최근접). 화살표는 블록 아래 레이어 (D4). */
  hitTest(p: Vec2, tolerance = ARROW_HIT_TOLERANCE): HitResult | null {
    let best: Block | null = null;
    for (const it of this.blockTree.search({ minX: p.x, minY: p.y, maxX: p.x, maxY: p.y })) {
      const b = this.blocksMap.get(it.id);
      if (!b || !rectContains(b, p)) continue;
      if (!best || compareKey(b.z, best.z) > 0 || (b.z === best.z && b.id > best.id)) best = b;
    }
    if (best) return { kind: 'block', id: best.id };
    let bestArrow: { id: Id; d: number } | null = null;
    for (const it of this.arrowTree.search({ minX: p.x - tolerance, minY: p.y - tolerance, maxX: p.x + tolerance, maxY: p.y + tolerance })) {
      const a = this.arrowsMap.get(it.id);
      const g = a && this.arrowGeometry(a);
      if (!g) continue;
      let d = Infinity;
      for (let i = 1; i < g.pts.length; i++) d = Math.min(d, distToSegment(p, g.pts[i - 1]!, g.pts[i]!));
      if (d <= tolerance && (!bestArrow || d < bestArrow.d)) bestArrow = { id: it.id, d };
    }
    return bestArrow ? { kind: 'arrow', id: bestArrow.id } : null;
  }

  // ───────── 쓰기 ─────────
  transact<R>(fn: (tx: Tx) => R, opts: TxOptions): TxResult<R> {
    if (this.current) {
      // 중첩 호출은 바깥 트랜잭션에 합류한다.
      return { ok: true, value: fn(this.current.tx), txId: this.current.txId };
    }
    const ops: Op[] = [];
    const txId = newId();
    const tx = makeTx(ops, {
      engine: this,
      isLive: (t) => this.current?.tx === t,
      applyRaw: (op) => this.applyRaw(op),
      mapOf: (e) => this.mapOf(e),
      applySteps: (doc, steps) => this.applySteps(doc, steps),
    });
    this.current = { ops, tx, txId };
    let value: R | undefined;
    let failure: string | null = null;
    let thrown: unknown = null;
    try {
      value = fn(tx);
      // 사람이 AI 개체의 의미를 고쳤으면 그 개체 출처에 시각을 찍는다 — 같은 트랜잭션 (v6, provenance.ts)
      if (opts.origin === 'user' || opts.origin === 'text') stampEdits(tx, ops, (e, id) => this.mapOf(e).get(id), Date.now());
      // 커밋 직전 검사 — 변경된 엔티티와 그 이웃만 (ENGINE 3.7). 위반이면 이유 문자열.
      failure = validateOps(ops, {
        blocksMap: this.blocksMap, contentsByBlock: this.contentsByBlock, arrowsByBlock: this.arrowsByBlock, codec: this.codec,
        mapOf: (e) => this.mapOf(e),
      });
    } catch (e) {
      failure = e instanceof Error ? e.message : String(e);
      if (!(e instanceof TxFail)) thrown = e;
    } finally {
      this.current = null;
    }
    if (failure !== null) {
      for (const op of invertAll(ops)) this.applyRaw(op);
      this.refreshSpatial();
      if (thrown) throw thrown;
      return { ok: false, reason: failure };
    }
    this.refreshSpatial();
    if (ops.length > 0) {
      if (opts.origin !== 'load' && opts.origin !== 'layout') this.lastChangeAt = Date.now();
      if (opts.origin === 'remote') this.history.noteRemote(new Set(ops.map((op) => op.id)));
      else this.history.record(ops, opts);
      const ev: ChangeEvent = { txId, origin: opts.origin, label: opts.label, ops, changed: new Set(ops.map((op) => op.id)) };
      for (const l of [...this.listeners]) l(ev);
    }
    return { ok: true, value: value as R, txId };
  }

  /** 저장된 연산 로그 재생 (열기). 이벤트 · undo 없음. 적용 실패한 Op 수를 돌려준다. */
  replay(ops: readonly Op[]): number {
    let failed = 0;
    for (const op of ops) {
      const r = this.transact((tx) => tx.apply(op), { origin: 'load', undoable: false });
      if (!r.ok) failed++;
    }
    return failed;
  }

  /** 다음 트랜잭션이 직전 undo 엔트리와 합쳐지지 않게 한다 (편집 시작 · 종료 등 의미 경계). */
  breakUndoMerge(): void { this.history.breakMerge(); }
  canUndo(): boolean { return this.history.canUndo(); }
  canRedo(): boolean { return this.history.canRedo(); }
  clearHistory(): void { this.history.clear(); }
  /** 다른 곳 변경과 겹쳐 일부만 되돌렸을 때 알림 (history.ts) */
  set undoNotice(fn: UndoNotice | null) { this.history.notice = fn; }

  /** 되돌리기 · 다시 실행 — 원격 변경이 끼어들었으면 겹친 연산은 건너뛴다(undo-guard.ts). 다 겹친 기록은 버리고 다음 것을 */
  undo(): boolean { return this.history.undo(this.runHistory, this.guardView); }
  redo(): boolean { return this.history.redo(this.runHistory, this.guardView); }
  private readonly runHistory = (fn: (tx: Tx) => void, origin: 'undo' | 'redo', label?: string) => this.transact(fn, { origin, label });
  private readonly guardView = {
    get: (e: EntityKind, id: Id) => this.mapOf(e).get(id),
    note: () => this._note as unknown as Record<string, unknown>,
    hasChildren: (blockId: Id) => !!(this.contentsByBlock.get(blockId)?.size || this.arrowsByBlock.get(blockId)?.size),
  };

  subscribe(fn: (e: ChangeEvent) => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  // ───────── 내부 ─────────
  private mapOf(e: EntityKind): Map<Id, any> {
    switch (e) {
      case 'block': return this.blocksMap;
      case 'content': return this.contentsMap;
      case 'arrow': return this.arrowsMap;
      case 'stroke': return this.strokesMap;
    }
  }

  private applyRaw(op: Op): void {
    if (op.k === 'set' && op.e === 'note') {
      const next = { ...this._note } as Record<string, unknown>;
      if (op.value === undefined) delete next[op.field]; else next[op.field] = op.value;
      this._note = frozen(next as unknown as Note);
      return;
    }
    const e = op.e as EntityKind;
    const map = this.mapOf(e);
    switch (op.k) {
      case 'text': {
        const c = this.contentsMap.get(op.id) as TextContent | undefined;
        if (!c) throw new TxFail(`text: ${op.id} 없음`);
        this.contentsMap.set(op.id, frozen({ ...c, doc: this.applySteps(c.doc, op.steps).doc }));
        break;
      }
      case 'create': {
        const v = frozen(op.value as { id: Id });
        map.set(op.id, v);
        this.indexAdd(e, v);
        break;
      }
      case 'delete': {
        const prev = map.get(op.id);
        if (prev === undefined) return;
        map.delete(op.id);
        this.indexRemove(e, prev);
        break;
      }
      case 'set': {
        const cur = map.get(op.id);
        if (cur === undefined) throw new TxFail(`set: ${e} ${op.id} 없음`);
        const next = { ...cur };
        if (op.value === undefined) delete next[op.field]; else next[op.field] = op.value;
        map.set(op.id, frozen(next));
        if (indexedField(e, op.field)) { this.indexRemove(e, cur); this.indexAdd(e, next); }
        else this.markDirty(e, op.id);
        break;
      }
    }
  }

  private applySteps(doc: TextDoc, steps: readonly unknown[]): { doc: TextDoc; inverse: unknown[] } {
    if (!this.codec) throw new TxFail('텍스트 코덱이 등록되지 않음');
    try { return this.codec.apply(doc, steps); }
    catch (err) { throw new TxFail(`text: 스텝 적용 실패 — ${err instanceof Error ? err.message : String(err)}`); }
  }

  private indexAdd(e: EntityKind, v: any): void {
    if (e === 'content') addTo(this.contentsByBlock, v.blockId, v.id);
    if (e === 'arrow') { for (const an of [v.from, v.to] as Anchor[]) if (isBlockEnd(an)) addTo(this.arrowsByBlock, an.blockId, v.id); this.groupEnds(v, addTo); }
    if (e === 'block' && (this.maxZ === null || compareKey(v.z, this.maxZ) > 0)) this.maxZ = v.z;
    if (e === 'block' && v.group) { addTo(this.groupMembersMap, v.group, v.id); this.dirtyGroup(v.group); }
    this.markDirty(e, v.id);
  }

  private indexRemove(e: EntityKind, v: any): void {
    if (e === 'content') removeFrom(this.contentsByBlock, v.blockId, v.id);
    if (e === 'arrow') { for (const an of [v.from, v.to] as Anchor[]) if (isBlockEnd(an)) removeFrom(this.arrowsByBlock, an.blockId, v.id); this.groupEnds(v, removeFrom); }
    if (e === 'block' && v.group) { removeFrom(this.groupMembersMap, v.group, v.id); this.dirtyGroup(v.group); }
    this.markDirty(e, v.id);
  }

  /** 묶음 끝 화살표 색인 (from · to의 groupId) */
  private groupEnds(a: Arrow, f: (m: Map<Id, Set<Id>>, k: Id, v: Id) => void): void {
    for (const g of new Set([a.from, a.to].map((an) => (isBlockEnd(an) ? an.groupId : undefined)))) if (g) f(this.groupArrowsMap, g, a.id);
  }

  /** 묶음의 모양이 바뀌면 그 묶음 끝 화살표를 다시 계산 */
  private dirtyGroup(g: Id): void { for (const id of this.groupArrowsMap.get(g) ?? []) this.dirtyArrows.add(id); }

  private markDirty(e: EntityKind, id: Id): void {
    if (e === 'block') this.dirtyBlocks.add(id);
    else if (e === 'arrow') this.dirtyArrows.add(id);
  }

  /** 공간 인덱스 동기화. bulk = 열기: 한 번에 적재 (rbush.load — 개별 삽입보다 빠르고 트리 품질이 좋다, ENGINE 12.7). */
  private refreshSpatial(bulk = false): void {
    (bulk ? bulkLoadSpatial : refreshSpatial)({
      blockTree: this.blockTree, arrowTree: this.arrowTree, blockItems: this.blockItems, arrowItems: this.arrowItems,
      dirtyBlocks: this.dirtyBlocks, dirtyArrows: this.dirtyArrows,
      blocksMap: this.blocksMap, arrowsMap: this.arrowsMap, arrowsByBlock: this.arrowsByBlock,
      arrowGeometry: (a) => this.arrowGeometry(a), groupArrows: this.groupArrowsMap,
    });
  }
}

function indexedField(e: EntityKind, field: string): boolean {
  return (e === 'content' && field === 'blockId') || (e === 'arrow' && (field === 'from' || field === 'to')) || (e === 'block' && (field === 'z' || field === 'group'));
}

function addTo(m: Map<Id, Set<Id>>, k: Id, v: Id): void {
  let s = m.get(k);
  if (!s) { s = new Set(); m.set(k, s); }
  s.add(v);
}

function removeFrom(m: Map<Id, Set<Id>>, k: Id, v: Id): void {
  const s = m.get(k);
  if (!s) return;
  s.delete(v);
  if (s.size === 0) m.delete(k);
}
