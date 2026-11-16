// 카드 (노트형 정리, docs/research/NOTE-SHEET-PLAN.md NS-02 · NS-03 · NS-04): 묶음(블록)을 카드 모양으로 — GroupMeta.bracket 'card'.
// 카드 틀 = 묶음 상자들의 합 사각형 + 안쪽 여백 CARD_PAD, 위에 머리(번호 · 이름 · 밑줄) CARD_HEAD. 틀은 그릴 때마다 계산한다(저장하지 않음).
// 격자 맞추기: 고른 카드들을 행 우선으로 열에 놓는다 — 한 줄의 높이는 그 줄에서 가장 큰 카드, A4 노트면 용지 폭 안 · 쪽 틈을 넘지 않게.
// 다시 맞추기(U-2 A): 다른 블록은 자동으로 옮기지 않는다(ADR-0014) — 글이 늘어 카드가 겹치면 사용자가 누를 때만, 겹친 카드만 아래로.
import type { Engine, TxResult } from './engine';
import { unionRects, type Rect, type Vec2 } from './geom';
import type { Id } from './model';
import { groupMembers, groupName } from './groups';
import { pageAt, pageY, SHEET_PAD, sheetGeom, contentBottom } from './sheet';

/** 카드 안쪽 여백 · 머리 높이 · 카드 사이 간격 (월드 px) */
export const CARD_PAD = 14;
export const CARD_HEAD = 34;
export const CARD_GAP = 24;

export interface CardInfo {
  readonly id: Id;
  readonly ids: Id[];
  /** 카드 틀 (머리 · 여백 포함) */
  readonly frame: Rect;
  readonly name: string;
  /** 번호를 켠 카드의 읽는 순서 번호 (1부터) */
  readonly number?: number;
}

export function isCardGroup(engine: Engine, gid: Id | undefined): boolean {
  return !!gid && engine.note.groups?.[gid]?.bracket === 'card';
}

/** 상자들의 합 사각형 → 카드 틀 */
export function cardFrame(r: Rect): Rect {
  return { x: r.x - CARD_PAD, y: r.y - CARD_PAD - CARD_HEAD, w: r.w + 2 * CARD_PAD, h: r.h + 2 * CARD_PAD + CARD_HEAD };
}

const byRows = (a: Rect, b: Rect) => Math.round(a.y / 40) - Math.round(b.y / 40) || a.x - b.x;

/** 이 노트의 카드들 (읽는 순서 — 40px 줄 단위로 위 → 아래, 같은 줄은 왼 → 오). rectOf로 끄는 중 미리보기 자리를 줄 수 있다 */
export function noteCards(engine: Engine, rectOf: (id: Id) => Rect | undefined = (id) => engine.blockRect(id)): CardInfo[] {
  const out: { id: Id; ids: Id[]; frame: Rect }[] = [];
  for (const [id, ids] of groupMembers(engine)) {
    if (!isCardGroup(engine, id)) continue;
    const u = unionRects(ids.map(rectOf).filter((r): r is Rect => !!r));
    if (u) out.push({ id, ids, frame: cardFrame(u) });
  }
  out.sort((a, b) => byRows(a.frame, b.frame));
  let n = 0;
  return out.map((c) => {
    const numbered = !!engine.note.groups?.[c.id]?.numbered;
    return { ...c, name: groupName(engine, c.id, c.ids), ...(numbered ? { number: ++n } : {}) };
  });
}

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** 카드 안 상자 사이 간격 (다시 맞추기) */
export const CARD_INNER_GAP = 8;

/** 카드 안 상자들을 위 → 아래로 쌓은 y (겹친 상자만 아래로) — 상자 id → 새 y */
function stackInside(rects: readonly { id: Id; r: Rect }[], gap: number): Map<Id, number> {
  const list = [...rects].sort((a, b) => a.r.y - b.r.y || a.r.x - b.r.x).map((x) => ({ id: x.id, r: { ...x.r } }));
  const out = new Map<Id, number>();
  for (let i = 0; i < list.length; i++) {
    const c = list[i]!.r;
    let top = c.y;
    for (let j = 0; j < i; j++) {
      const a = list[j]!.r;
      if (c.x < a.x + a.w && a.x < c.x + c.w && top < a.y + a.h && a.y <= top) top = a.y + a.h + gap;
    }
    if (top !== c.y) { c.y = top; out.set(list[i]!.id, top); }
  }
  return out;
}

/** 다시 맞출 카드 id — 카드 틀끼리 겹치거나 카드 안 상자끼리 겹친 것 (글이 늘어서) */
export function overlappingCards(engine: Engine): Id[] {
  const cards = noteCards(engine);
  const out = new Set<Id>();
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i]!;
    const inner = stackInside(c.ids.map((id) => ({ id, r: engine.blockRect(id)! })).filter((x) => x.r), 0);
    if (inner.size) out.add(c.id);
    for (let j = i + 1; j < cards.length; j++) if (overlaps(c.frame, cards[j]!.frame)) { out.add(c.id); out.add(cards[j]!.id); }
  }
  return [...out];
}

export interface ArrangeOptions {
  /** 열 수 — 없으면 A4 세로 2 · 그 밖 3 (용지 폭에 안 들어가면 줄인다) */
  readonly cols?: number;
  readonly gap?: number;
  /** 첫 카드 틀의 왼쪽 위 — 없으면 지금 카드들의 왼쪽 위(용지면 용지 안 여백) */
  readonly origin?: Vec2;
}

/** 카드 자리 계산만 (순수) — 카드 id → 새 틀 왼쪽 위. AI 배치(P-24)와 명령이 함께 쓴다 */
export function gridPlan(frames: readonly { id: Id; w: number; h: number }[], opts: { cols: number; gap: number; origin: Vec2; place?: (y: number, h: number) => number }): Map<Id, Vec2> {
  const { cols, gap, origin } = opts;
  const colW: number[] = [];
  frames.forEach((f, i) => { const c = i % cols; colW[c] = Math.max(colW[c] ?? 0, f.w); });
  const colX: number[] = [];
  colW.forEach((w, c) => { colX[c] = c === 0 ? origin.x : colX[c - 1]! + colW[c - 1]! + gap; });
  const out = new Map<Id, Vec2>();
  let y = origin.y;
  for (let r = 0; r * cols < frames.length; r++) {
    const row = frames.slice(r * cols, r * cols + cols);
    const h = Math.max(...row.map((f) => f.h));
    if (opts.place) y = opts.place(y, h);
    row.forEach((f, c) => out.set(f.id, { x: colX[c]!, y }));
    y += h + gap;
  }
  return out;
}

/** 고른 카드들을 격자로 (지금 읽는 순서대로 행 우선). 트랜잭션 한 번 · 실행 취소 한 번 */
export function arrangeCards(engine: Engine, gids: readonly Id[], opts: ArrangeOptions = {}): TxResult<void> {
  const want = new Set(gids);
  const cards = noteCards(engine).filter((c) => want.has(c.id));
  const gap = opts.gap ?? CARD_GAP;
  const sheet = sheetGeom(engine.note, contentBottom(engine));
  const maxW = cards.reduce((m, c) => Math.max(m, c.frame.w), 0);
  const first = cards[0]?.frame;
  const origin = opts.origin ?? (sheet ? { x: SHEET_PAD, y: Math.max(SHEET_PAD, first?.y ?? SHEET_PAD) } : { x: Math.min(...cards.map((c) => c.frame.x)), y: Math.min(...cards.map((c) => c.frame.y)) });
  const page = sheet ? pageAt(sheet, origin.y) : null; // 첫 카드가 놓일 쪽 — 쪽마다 가로 · 세로가 다를 수 있다
  let cols = opts.cols ?? (page && !page.landscape ? 2 : 3);
  if (page) cols = Math.max(1, Math.min(cols, Math.floor((page.w - 2 * SHEET_PAD + gap) / (maxW + gap))));
  const plan = gridPlan(cards.map((c) => ({ id: c.id, w: c.frame.w, h: c.frame.h })), { cols: Math.max(1, cols), gap, origin, ...(sheet ? { place: (y: number, h: number) => pageY(sheet, y, h) } : {}) });
  return engine.transact((tx) => {
    for (const c of cards) {
      const to = plan.get(c.id);
      if (!to) continue;
      const dx = to.x - c.frame.x, dy = to.y - c.frame.y;
      if (!dx && !dy) continue;
      for (const id of c.ids) { const b = engine.getBlock(id); if (b) tx.set('block', id, { x: b.x + dx, y: b.y + dy }); }
    }
  }, { origin: 'user', label: '카드 격자로 맞추기' });
}

/** 다시 맞추기: 카드 안에서 겹친 상자를 아래로 쌓고(간격 CARD_INNER_GAP), 그다음 겹친 카드를 아래로 — 위에서부터, 위 카드와 겹친 만큼 + 간격.
 *  카드에 밀려 겹치게 된 아래쪽 블록 · 묶음(카드 아님)도 같이 내린다. 원래 아무것과도 안 겹치던 것은 그대로.
 *  결과: 옮긴 카드 · 블록 덩어리 수 (카드 안만 고친 카드도 센다) */
export function restackCards(engine: Engine, gap = CARD_GAP): TxResult<number> {
  const newY = new Map<Id, number>();
  type Item = { ids: Id[]; frame: Rect; card: boolean; inner: boolean; dy: number };
  const items: Item[] = noteCards(engine).map((c) => {
    const rects = c.ids.map((id) => ({ id, r: engine.blockRect(id) })).filter((x): x is { id: Id; r: Rect } => !!x.r);
    const inner = stackInside(rects, CARD_INNER_GAP);
    for (const [id, y] of inner) newY.set(id, y);
    const u = unionRects(rects.map((x) => ({ ...x.r, y: inner.get(x.id) ?? x.r.y })))!;
    return { ids: c.ids, frame: cardFrame(u), card: true, inner: inner.size > 0, dy: 0 };
  });
  // 카드가 아닌 덩어리 — 묶음은 묶음째, 나머지는 블록 하나씩 (밀릴 때만 움직인다)
  const inCard = new Set(items.flatMap((x) => x.ids));
  const members = groupMembers(engine);
  for (const ids of members.values()) {
    if (ids.some((id) => inCard.has(id))) continue;
    const u = unionRects(ids.map((id) => engine.blockRect(id)).filter((r): r is Rect => !!r));
    if (u) { items.push({ ids, frame: u, card: false, inner: false, dy: 0 }); ids.forEach((id) => inCard.add(id)); }
  }
  for (const b of engine.blocks()) if (!inCard.has(b.id) && !b.draft) items.push({ ids: [b.id], frame: { x: b.x, y: b.y, w: b.w, h: b.h }, card: false, inner: false, dy: 0 });
  items.sort((a, b) => a.frame.y - b.frame.y || a.frame.x - b.frame.x);
  for (let i = 0; i < items.length; i++) {
    const c = items[i]!;
    let top = c.frame.y;
    for (let j = 0; j < i; j++) {
      const a = items[j]!;
      if (!a.card && !a.dy) continue; // 가만히 있는 보통 블록은 피하지 않는다 (원래 겹침은 그대로)
      if (!c.card && !a.card && !a.dy) continue;
      const f = a.frame;
      if (c.frame.x < f.x + f.w && f.x < c.frame.x + c.frame.w && top < f.y + f.h && f.y <= top) top = f.y + f.h + gap;
    }
    if (top !== c.frame.y) { c.dy = top - c.frame.y; c.frame = { ...c.frame, y: top }; }
  }
  return engine.transact((tx) => {
    let n = 0;
    for (const c of items) {
      if (!c.dy && !c.inner) continue;
      n++;
      for (const id of c.ids) {
        const b = engine.getBlock(id);
        if (!b) continue;
        const y = (newY.get(id) ?? b.y) + c.dy;
        if (y !== b.y) tx.set('block', id, { y });
      }
    }
    return n;
  }, { origin: 'user', label: '카드 다시 맞추기' });
}

/** 묶음 소제목 글 — 이름 있는 묶음은 이름, 번호 켠 카드는 '번호. 이름' (문서 뷰 · Markdown · 워드가 같은 글을 쓴다) */
export function groupHeadings(engine: Engine): Map<Id, string> {
  const out = new Map<Id, string>();
  for (const [gid, m] of Object.entries(engine.note.groups ?? {})) { const n = m.name?.trim(); if (n) out.set(gid, n); }
  for (const c of noteCards(engine)) if (c.number) out.set(c.id, `${c.number}. ${engine.note.groups?.[c.id]?.name?.trim() ?? ''}`.trim());
  return out;
}
