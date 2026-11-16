// 문서 뷰 편집이 문서 순서(화살표 흐름 · 묶음)를 지키게 (DE-005 ~ 007): 블록을 지우고 · 끼우고 · 옮겨도 "문서에서 보이는 자리 = documentOrder".
// - 한 줄 흐름(단계 번호)의 단계를 지우거나 흐름 밖으로 빼면 앞뒤 단계를 잇는다. 같은 흐름 안에서 옮기면 화살표 차례를 바꾼다.
// - 새로 생기는 이음은 라벨 없는 새 화살표 — 라벨 · 관계는 사용자가 이은 쌍에만 남는다(남는 화살표를 다른 쌍에 다시 쓰지 않는다).
// - 갈래 흐름(마인드맵 · 트리)과 상호 참조 화살표는 건드리지 않는다 — 지어낸 관계가 생기지 않게. 고치기는 캔버스에서.
import type { Engine, Tx } from './engine';
import { isBound, type Block, type BoundArrow, type Id } from './model';
import { newId } from './id';
import { docUnits, documentOrder } from './flow';

/** 단계 하나 = 블록 id 묶음 (묶음 · 나눈 상자는 한 단계) */
type Unit = Id[];

/** 한 줄 흐름들 — 흐름마다 단계 차례대로 */
function chains(engine: Engine): Unit[][] {
  const byFlow = new Map<number, Unit[]>(), isChain = new Set<number>();
  for (const x of documentOrder(engine)) {
    if (x.flow === undefined) continue;
    let us = byFlow.get(x.flow);
    if (!us) byFlow.set(x.flow, (us = []));
    if (x.step !== undefined) { isChain.add(x.flow); us.push([x.block.id]); }
    else if (x.depth === undefined) us[us.length - 1]?.push(x.block.id); // 같은 단계의 나머지 상자
  }
  return [...byFlow].filter(([f]) => isChain.has(f)).map(([, us]) => us);
}

/** 옮기는 블록이 모두 든 한 줄 흐름 */
function ownChain(engine: Engine, moving: ReadonlySet<Id>): Unit[] | undefined {
  return moving.size ? chains(engine).find((c) => [...moving].every((id) => c.some((u) => u.includes(id)))) : undefined;
}

/**
 * 한 줄 흐름의 단계 차례를 old → neu로 (neu: 옛 순번 o와 남는 멤버 — 다시 늘어놓거나 빼거나 멤버를 줄인 것).
 * 그대로인 이웃 쌍의 화살표는 둔다(끝 상자가 빠졌으면 같은 단계의 남은 상자로 옮김), 새 쌍은 라벨 없는 새 화살표, 없어진 쌍은 지운다.
 * keep: 손대지 않을 화살표
 */
function relink(engine: Engine, tx: Tx, old: readonly Unit[], neu: readonly { o: number; ids: Unit }[], keep?: (a: BoundArrow) => boolean): void {
  const unitOf = new Map<Id, number>();
  old.forEach((u, i) => { for (const id of u) unitOf.set(id, i); });
  const members = new Map(neu.map((u) => [u.o, u.ids]));
  const ends = new Map(neu.map((u) => [u.o, u.ids.find((id) => engine.arrowsOf(id).length) ?? u.ids[0]!]));
  const key = (f: number, t: number) => `${f}>${t}`;
  const want = new Set(neu.slice(1).map((u, i) => key(neu[i]!.o, u.o)));
  const have = new Set<string>();
  for (const a of [...engine.arrows()].filter(isBound)) { // 빈 곳 화살표는 문서 단위와 상관없다
    const f = unitOf.get(a.from.blockId), t = unitOf.get(a.to.blockId);
    if (f === undefined || t === undefined || f === t || keep?.(a)) continue;
    const p = key(f, t);
    if (!want.has(p) || have.has(p)) { tx.delete('arrow', a.id); continue; }
    have.add(p);
    if (!members.get(f)!.includes(a.from.blockId)) tx.set('arrow', a.id, { from: { blockId: ends.get(f)!, side: 'auto' } });
    if (!members.get(t)!.includes(a.to.blockId)) tx.set('arrow', a.id, { to: { blockId: ends.get(t)!, side: 'auto' } });
  }
  neu.slice(1).forEach((u, i) => {
    const f = neu[i]!.o;
    if (!have.has(key(f, u.o))) tx.createArrow({ from: { blockId: ends.get(f)!, side: 'auto' }, to: { blockId: ends.get(u.o)!, side: 'auto' } });
  });
}

/** 블록들을 지울 때: 한 줄 흐름의 단계면 앞뒤 단계를 잇는다 (DE-005). 지울 블록에 닿는 나머지 화살표는 부르는 쪽이 지운다 */
export function bridgeChains(engine: Engine, tx: Tx, gone: ReadonlySet<Id>): void {
  for (const old of chains(engine)) {
    if (!old.some((u) => u.some((id) => gone.has(id)))) continue;
    relink(engine, tx, old, old.map((u, o) => ({ o, ids: u.filter((id) => !gone.has(id)) })).filter((u) => u.ids.length));
  }
}

/**
 * 블록들을 target 아래로 옮길 때 흐름 차례 (DE-007): 옮기는 블록이 모두 한 줄 흐름의 단계이고 target이 그 흐름 안(또는 흐름 바로 앞)이면
 * 그 자리에 끼워 잇는다. 아니면 흐름 밖으로 빼며 앞뒤를 잇는다 — 함께 옮기는 단계끼리의 화살표는 둔다
 */
export function reorderForMove(engine: Engine, tx: Tx, moving: ReadonlySet<Id>, target: Id | null): void {
  const order = documentOrder(engine).filter((x) => !moving.has(x.block.id));
  for (const old of chains(engine)) {
    const own = [...moving].every((id) => old.some((u) => u.includes(id)));
    const all = old.map((u, o) => ({ o, ids: u }));
    const mov = all.filter((u) => u.ids.some((id) => moving.has(id)));
    if (!mov.length) continue;
    const rest = all.filter((u) => !u.ids.some((id) => moving.has(id)));
    let at = -1;
    if (own && rest.length) {
      const ti = target ? rest.findIndex((u) => u.ids.includes(target)) : -1;
      const k = target ? order.findIndex((x) => x.block.id === target) : -1;
      at = ti >= 0 ? ti + 1 : order[k + 1]?.block.id === rest[0]!.ids[0] ? 0 : -1;
    }
    if (at >= 0) relink(engine, tx, old, [...rest.slice(0, at), ...mov, ...rest.slice(at)]);
    else relink(engine, tx, old, rest, (a) => moving.has(a.from.blockId) && moving.has(a.to.blockId));
  }
}

/** 붙여넣기 · 복제로 b 바로 아래에 생긴 블록들을 b와 같은 단위로 (DE-006) — b가 묶음이면 그 묶음, 흐름에 든 낱 상자면 b와 새 묶음 */
export function joinUnit(engine: Engine, tx: Tx, b: Block, ids: readonly Id[]): void {
  const grouped = !!b.group && [...engine.blocks()].some((x) => x.id !== b.id && x.group === b.group);
  if (!grouped && !engine.arrowsOf(b.id).length) return; // 흐름 밖 낱 상자 — 자리만으로 차례가 맞다
  const group = b.group ?? newId();
  if (!b.group) tx.set('block', b.id, { group });
  for (const id of ids) tx.set('block', id, { group });
}

/** ids가 든 단위(묶음 · 한 단계)의 블록 전부 — 문서 뷰에서 블록 하나를 끌어도 묶음은 함께 (캔버스와 같게) */
export function docUnitIds(engine: Engine, ids: readonly Id[]): Id[] {
  const want = new Set(ids);
  return docUnits(engine).filter((u) => u.some((b) => want.has(b.id))).flatMap((u) => u.map((b) => b.id));
}

/** 문서 차례를 옮기기 조각으로: 묶음 · 단계는 한 조각, 다른 흐름은 통째로 한 조각 (옮기는 블록이 든 한 줄 흐름만 단계마다) */
function docSegments(engine: Engine, moving: ReadonlySet<Id>): Id[][] {
  const unitOf = new Map<Id, number>();
  docUnits(engine).forEach((u, i) => { for (const b of u) unitOf.set(b.id, i); });
  const own = new Set(ownChain(engine, moving)?.flat() ?? []);
  const segs: Id[][] = [];
  let last = '';
  for (const x of documentOrder(engine)) {
    const id = x.block.id, key = x.flow !== undefined && !own.has(id) ? `f${x.flow}` : `u${unitOf.get(id)}`;
    if (key !== last) segs.push([]);
    segs[segs.length - 1]!.push(id);
    last = key;
  }
  return segs.map((s) => s.filter((id) => !moving.has(id))).filter((s) => s.length);
}

/** 블록들을 target 아래로 놓을 때 실제 자리 — target이 다른 묶음 · 흐름 가운데면 그 조각의 끝 (보이는 자리 = 문서 순서) */
export function docDropTarget(engine: Engine, ids: readonly Id[], target: Id | null): Id | null {
  if (!target) return null;
  return docSegments(engine, new Set(ids)).find((s) => s.includes(target))?.at(-1) ?? target;
}

/** 한 조각 위 · 아래로 옮길 자리 (null = 맨 위, undefined = 더 못 감) */
export function docStepTarget(engine: Engine, ids: readonly Id[], dir: -1 | 1): Id | null | undefined {
  const order = documentOrder(engine).map((x) => x.block.id);
  const at = ids.map((id) => order.indexOf(id)).filter((i) => i >= 0);
  if (!at.length) return undefined;
  const segs = docSegments(engine, new Set(ids)), pos = (s: Id[]) => order.indexOf(s[0]!);
  if (dir < 0) {
    const before = segs.filter((s) => pos(s) < Math.min(...at));
    return !before.length ? undefined : before.length >= 2 ? before[before.length - 2]!.at(-1)! : null;
  }
  return segs.find((s) => pos(s) > Math.max(...at))?.at(-1);
}
