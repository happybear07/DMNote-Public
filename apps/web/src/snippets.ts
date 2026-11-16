// 내 블록 (사용자 요청 10/30 알파 8): 고른 상자 · 블록을 넣기(＋) 메뉴에 저장해 두고, 누를 때마다 똑같은 사본을 빈 자리에 넣는다.
// 사본이다 — 하나를 고쳐도 다른 것은 그대로(동기화 블록 아님). 저장 형식은 블록 복사 묶음(BlockClip v2)과 같아 글 · 그림(같은 기기 첨부) ·
// 표 · 화살표 · 의미 · AI 출처까지 따라가고, 블록에 묶인 필기는 빠진다(복사와 같음). 이 기기 설정에 저장(노트 백업과 따로).
// 11/03: 저장할 때 양식 이름을, 넣을 때 블록 이름을 묻고, 넣은 상자들은 그 이름의 블록(콘텐츠 묶음)으로 묶는다 — 저장한 것이 블록 하나 전체였으면 그 모양(종류 · 테두리 · 카드)째.
import { blockClip, clipHeight, createFromClip, docText, groupName, groupOf, isBlockClip, newId, type BlockClip, type GroupMeta, type Id, type TextNode, type Vec2 } from '@dn/engine-core';
import { placeNew, type CanvasView } from '@dn/engine-dom';

export interface Snippet {
  readonly id: string; readonly name: string; readonly clip: BlockClip; readonly at: number;
  /** 저장한 것이 블록 하나 전체였으면 그 묶음 모양(이름 빼고) — 넣을 때 그대로 */
  readonly group?: Omit<GroupMeta, 'name'>;
}
/** 도구 막대 고정 이름 — 넣기 항목(InsertKind)과 섞이지 않게 */
export const SNIPPET_PIN = 'snip:';
export const MAX_SNIPPETS = 30;

/** 이름: 첫 블록의 첫 글 줄(24자), 없으면 '내 블록 n' */
function nameOf(clip: BlockClip, n: number): string {
  for (const b of clip.blocks) for (const c of b.contents) {
    const line = c.doc ? docText(c.doc as TextNode).split('\n').find((l) => l.trim()) : undefined;
    if (line) return line.trim().slice(0, 24);
  }
  return `내 블록 ${n}`;
}

/** 고른 상자들이 블록 하나 전체인가 — 그 묶음 id */
function wholeGroup(engine: CanvasView['engine'], ids: readonly Id[]): Id | null {
  const g = ids[0] ? groupOf(engine, ids[0]) : null;
  return g && g.ids.length === ids.length && ids.every((id) => g.ids.includes(id)) ? g.id : null;
}

/** name: 사용자가 정한 양식 이름 — 없으면 블록 이름 · 첫 글 줄 */
export function makeSnippet(engine: CanvasView['engine'], ids: readonly Id[], taken: readonly Snippet[], name?: string): Snippet | null {
  if (!ids.some((id) => engine.getBlock(id))) return null;
  const clip = blockClip(engine, ids), gid = wholeGroup(engine, ids);
  const { name: _n, ...look } = (gid && engine.note.groups?.[gid]) || {};
  return {
    id: newId(), name: (name?.trim() || (gid ? groupName(engine, gid) : nameOf(clip, taken.length + 1))).slice(0, 40), clip, at: Date.now(),
    ...(Object.keys(look).length ? { group: look } : {}),
  };
}

/** 넣으면 블록(콘텐츠 묶음)이 되는가 — 상자 둘 이상, 또는 카드 하나 */
export const snippetIsBlock = (s: Snippet): boolean => s.clip.blocks.length >= 2 || s.group?.bracket === 'card';

/**
 * 넣기: at(넣기 메뉴를 연 자리)이 있으면 거기서, 없으면 화면 가운데에서 가장 가까운 빈 자리. 새 블록들을 골라 둔다.
 * 블록이 되는 것이면 name(없으면 저장한 이름)의 블록으로 묶는다 — 사본 · 묶기가 실행 취소 한 번
 */
export function insertSnippet(view: CanvasView, s: Snippet, at?: Vec2, name?: string): Id[] | null {
  const w = s.clip.blocks.reduce((m, b) => Math.max(m, b.dx + b.w), 0), h = clipHeight(s.clip);
  const vr = view.visibleRect();
  const want = at ?? { x: vr.x + vr.w / 2 - w / 2, y: vr.y + vr.h / 2 - h / 2 };
  const spot = placeNew(view, { x: want.x, y: want.y, w, h });
  const engine = view.engine;
  const r = engine.transact((tx) => {
    const ids = createFromClip(engine, tx, s.clip, spot);
    if (!snippetIsBlock(s)) return ids;
    const gid = newId();
    for (const id of ids) tx.set('block', id, { group: gid });
    tx.setNote({ groups: { ...engine.note.groups, [gid]: { ...s.group, name: (name?.trim() || s.name).slice(0, 40) } } });
    return ids;
  }, { origin: 'user', label: `내 블록 넣기 · ${s.name}` });
  if (!r.ok) return null;
  view.select(r.value);
  return r.value;
}

/** 저장된 값 읽기 — 깨진 항목은 버린다 */
export function validSnippets(v: unknown): Snippet[] {
  if (!Array.isArray(v)) return [];
  return v.filter((s): s is Snippet => !!s && typeof s.id === 'string' && typeof s.name === 'string' && isBlockClip(s.clip)).slice(0, MAX_SNIPPETS);
}
