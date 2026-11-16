// 공간 인덱스(R-tree) 동기화. 트랜잭션 중에는 더러운 id만 모아 두고, 커밋 · 롤백 뒤 한 번에 갱신한다.
import type RBush from 'rbush';
import type { ArrowPath } from './arrow-geom';
import type { Arrow, Block, Id } from './model';

export interface SpatialItem { minX: number; minY: number; maxX: number; maxY: number; id: Id }

export interface SpatialState {
  readonly blockTree: RBush<SpatialItem>;
  readonly arrowTree: RBush<SpatialItem>;
  readonly blockItems: Map<Id, SpatialItem>;
  readonly arrowItems: Map<Id, SpatialItem>;
  readonly dirtyBlocks: Set<Id>;
  readonly dirtyArrows: Set<Id>;
  readonly blocksMap: ReadonlyMap<Id, Block>;
  readonly arrowsMap: ReadonlyMap<Id, Arrow>;
  readonly arrowsByBlock: ReadonlyMap<Id, ReadonlySet<Id>>;
  /** 묶음 id → 묶음 끝 화살표 (v6) — 묶음의 상자가 움직이면 그 화살표도 다시 계산 */
  readonly groupArrows: ReadonlyMap<Id, ReadonlySet<Id>>;
  arrowGeometry(a: Arrow): ArrowPath | undefined;
}

/** 열기: 공간 인덱스를 한 번에 적재 (rbush.load — 개별 삽입보다 빠르고 트리 품질이 좋다, ENGINE 12.7). */
export function bulkLoadSpatial(s: SpatialState): void {
  const blocks: SpatialItem[] = [];
  for (const b of s.blocksMap.values()) {
    if (b.draft) continue; // 초안 상자는 캔버스에 없다
    const it = { minX: b.x, minY: b.y, maxX: b.x + b.w, maxY: b.y + b.h, id: b.id };
    blocks.push(it);
    s.blockItems.set(b.id, it);
  }
  s.blockTree.load(blocks);
  const arrows: SpatialItem[] = [];
  for (const a of s.arrowsMap.values()) {
    const g = s.arrowGeometry(a);
    if (!g) continue;
    const it = { ...bbox(g.pts), id: a.id };
    arrows.push(it);
    s.arrowItems.set(a.id, it);
  }
  s.arrowTree.load(arrows);
  s.dirtyBlocks.clear();
  s.dirtyArrows.clear();
}

/** 경로 점들의 사각형 (곡선 · 되돌림 경로는 끝점 밖으로 나간다) */
function bbox(pts: readonly { x: number; y: number }[]): Omit<SpatialItem, 'id'> {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  return { minX, minY, maxX, maxY };
}

export function refreshSpatial(s: SpatialState): void {
  for (const id of s.dirtyBlocks) {
    const old = s.blockItems.get(id);
    if (old) { s.blockTree.remove(old); s.blockItems.delete(id); }
    const b = s.blocksMap.get(id);
    if (b && !b.draft) {
      const it = { minX: b.x, minY: b.y, maxX: b.x + b.w, maxY: b.y + b.h, id };
      s.blockTree.insert(it);
      s.blockItems.set(id, it);
    }
    for (const aid of s.arrowsByBlock.get(id) ?? []) s.dirtyArrows.add(aid);
    const g = b?.group;
    if (g) for (const aid of s.groupArrows.get(g) ?? []) s.dirtyArrows.add(aid);
  }
  for (const id of s.dirtyArrows) {
    const old = s.arrowItems.get(id);
    if (old) { s.arrowTree.remove(old); s.arrowItems.delete(id); }
    const a = s.arrowsMap.get(id);
    const g = a && s.arrowGeometry(a);
    if (g) {
      const it = { ...bbox(g.pts), id };
      s.arrowTree.insert(it);
      s.arrowItems.set(id, it);
    }
  }
  s.dirtyBlocks.clear();
  s.dirtyArrows.clear();
}
