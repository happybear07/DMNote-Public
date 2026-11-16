// 블록 = 콘텐츠 묶음: 캔버스의 상자들(엔진의 block — 제목 상자 · 내용 상자 · 사진 · 표 …)을 묶음 id(Block.group)로 묶는다.
// 묶인 상자들은 함께 고르고 · 옮기고 · 크기를 바꾼다(글자 크기까지 같은 배율). 이름은 note.groups[id].name (없으면 첫 제목 · 첫 줄).
// 상자가 하나만 남은 묶음은 묶음으로 치지 않는다 — 카드(테두리 '카드')만은 상자 하나여도 카드다(노트형 정리 NS-01). 화살표 · 댓글 · 글자 모양은 상자마다 그대로.
import type { Engine, TxResult } from './engine';
import { unionRects, type Rect, type Vec2 } from './geom';
import { newId } from './id';
import { isTextContent, type Block, type GroupMeta, type Id } from './model';
import { textLines } from './text-doc';
import { readingOrder } from './toc';
import { remapGroupEnds } from './group-anchor';

export interface BlockGroup { readonly id: Id; readonly ids: Id[]; readonly rect: Rect; readonly name: string }

/** 묶음으로 치는 최소 상자 수 — 카드는 하나, 나머지는 둘 */
const minSize = (engine: Engine, gid: Id) => (engine.note.groups?.[gid]?.bracket === 'card' ? 1 : 2);

/** 묶음 id → 상자 id들 (둘 이상인 묶음 · 카드) */
export function groupMembers(engine: Engine): Map<Id, Id[]> {
  const m = new Map<Id, Id[]>();
  for (const b of engine.blocks()) if (b.group) { const a = m.get(b.group); if (a) a.push(b.id); else m.set(b.group, [b.id]); }
  for (const [k, v] of m) if (v.length < minSize(engine, k)) m.delete(k);
  return m;
}

/** 이 상자가 든 묶음 (없으면 null) */
export function groupOf(engine: Engine, blockId: Id): { id: Id; ids: Id[] } | null {
  const g = engine.getBlock(blockId)?.group;
  if (!g) return null;
  const ids = [...engine.blocks()].filter((b) => b.group === g).map((b) => b.id);
  return ids.length >= minSize(engine, g) ? { id: g, ids } : null;
}

/** 묶음 이름: 붙인 이름 → 첫 제목 상자 → 첫 줄 → '블록' */
export function groupName(engine: Engine, gid: Id, ids?: readonly Id[]): string {
  const set = engine.note.groups?.[gid]?.name?.trim();
  if (set) return set;
  const members = readingOrder((ids ?? [...engine.blocks()].filter((b) => b.group === gid).map((b) => b.id)).map((id) => engine.getBlock(id)).filter((b): b is Block => !!b));
  let first = '';
  for (const b of members) for (const c of engine.contentsOf(b.id)) {
    if (!isTextContent(c)) continue;
    const t = textLines(c.doc).find((l) => l.trim())?.trim() ?? '';
    if (c.role === 'title' && t) return t.slice(0, 40);
    if (!first && t) first = t.slice(0, 40);
  }
  return first || '블록';
}

/** 이 노트의 묶음들 (읽는 순서) */
export function noteGroups(engine: Engine): BlockGroup[] {
  const out: BlockGroup[] = [];
  for (const [id, ids] of groupMembers(engine)) {
    const rs = ids.map((x) => engine.blockRect(x)).filter((r): r is Rect => !!r);
    if (rs.length) out.push({ id, ids, rect: unionRects(rs)!, name: groupName(engine, id, ids) });
  }
  return out.sort((a, b) => Math.round(a.rect.y / 40) - Math.round(b.rect.y / 40) || a.rect.x - b.rect.x);
}

/** 상자들을 한 블록으로 묶기 (둘 이상). 이미 다른 묶음에 든 상자가 있으면 그 묶음째 새 묶음으로 합친다. 결과: 묶음 id */
export function groupBlocks(engine: Engine, ids: readonly Id[], name?: string): TxResult<Id | null> {
  return engine.transact((tx) => {
    const take = new Set<Id>();
    for (const id of ids) {
      const b = engine.getBlock(id);
      if (!b) continue;
      const g = groupOf(engine, id);
      for (const x of g?.ids ?? [id]) take.add(x);
    }
    if (take.size < 2) return null;
    const gid = newId();
    const old = new Set([...take].map((id) => engine.getBlock(id)?.group).filter((g): g is Id => !!g));
    for (const id of take) tx.set('block', id, { group: gid });
    remapGroupEnds(engine, tx, old, gid); // 합친 묶음의 묶음 끝 화살표는 새 묶음으로 (v6)
    if (name?.trim()) tx.setNote({ groups: { ...engine.note.groups, [gid]: { name: name.trim() } } });
    return gid;
  }, { origin: 'user', label: '블록으로 묶기' });
}

/** 묶음 풀기 — 고른 상자들이 든 묶음 전체 */
export function ungroupBlocks(engine: Engine, ids: readonly Id[]): TxResult<void> {
  return engine.transact((tx) => {
    const gids = new Set<Id>();
    for (const id of ids) { const g = engine.getBlock(id)?.group; if (g) gids.add(g); }
    if (!gids.size) return;
    for (const b of engine.blocks()) if (b.group && gids.has(b.group)) tx.set('block', b.id, { group: undefined });
    remapGroupEnds(engine, tx, gids); // 풀린 묶음 끝 화살표는 상자 끝으로 (v6)
    const groups = { ...engine.note.groups };
    let named = false;
    for (const g of gids) if (groups[g]) { delete groups[g]; named = true; }
    if (named) tx.setNote({ groups: Object.keys(groups).length ? groups : undefined });
  }, { origin: 'user', label: '묶음 풀기' });
}

/** 묶음 종류 · 테두리 모양 (v6 3단계). undefined면 그 값을 지운다 */
export function setGroupMeta(engine: Engine, gid: Id, patch: Partial<Pick<GroupMeta, 'kind' | 'bracket' | 'figure' | 'tone' | 'numbered'>>): TxResult<void> {
  return engine.transact((tx) => {
    const groups = { ...engine.note.groups };
    const next: Record<string, unknown> = { ...groups[gid], ...patch };
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
    if (Object.keys(next).length) groups[gid] = next as GroupMeta; else delete groups[gid];
    tx.setNote({ groups: Object.keys(groups).length ? groups : undefined });
  }, { origin: 'user', label: 'figure' in patch ? (patch.figure ? '문서에서 그림으로' : '문서에서 글로') : 'tone' in patch || 'numbered' in patch || patch.bracket === 'card' ? '카드 모양' : '묶음 종류' });
}

export function renameGroup(engine: Engine, gid: Id, name: string): TxResult<void> {
  return engine.transact((tx) => {
    const groups = { ...engine.note.groups };
    const n = name.trim();
    // 이름만 지운다 — 종류 · 카드 모양 같은 다른 정보는 그대로 (다 비면 항목째)
    const rest: Record<string, unknown> = { ...groups[gid] };
    if (n) rest.name = n; else delete rest.name;
    if (Object.keys(rest).length) groups[gid] = rest as GroupMeta; else delete groups[gid];
    tx.setNote({ groups: Object.keys(groups).length ? groups : undefined });
  }, { origin: 'user', label: '블록 이름' });
}

/**
 * 상자들을 같은 배율로 키우기 · 줄이기 (블록 크기 조절): anchor(고정점) 기준 자리 · 크기 · 글자 크기 · 고정 높이까지 f배.
 * 사진은 폭에 맞춰 비율대로, 블록에 묶인 필기는 폭을 따라 같이 커진다.
 */
export function scaleBlocks(engine: Engine, ids: readonly Id[], anchor: Vec2, f: number): TxResult<void> {
  const k = Math.max(0.1, Math.min(10, f));
  return engine.transact((tx) => {
    if (Math.abs(k - 1) < 1e-3) return;
    for (const id of ids) {
      const b = engine.getBlock(id);
      if (!b) continue;
      const hasText = engine.contentsOf(id).some((c) => isTextContent(c));
      const fs = hasText ? Math.max(0.5, Math.min(4, (b.fontScale ?? 1) * k)) : undefined;
      tx.set('block', id, {
        x: Math.round(anchor.x + (b.x - anchor.x) * k), y: Math.round(anchor.y + (b.y - anchor.y) * k),
        w: Math.max(40, Math.round(b.w * k)), h: Math.max(24, Math.round(b.h * k)),
        ...(b.sizing === 'fixed' && b.minH ? { minH: Math.round(b.minH * k) } : {}),
        ...(hasText ? { fontScale: fs && Math.abs(fs - 1) > 1e-3 ? Math.round(fs * 1000) / 1000 : undefined } : {}),
      });
    }
  }, { origin: 'user', label: '블록 크기 조절' });
}
