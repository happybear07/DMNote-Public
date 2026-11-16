// Y → 엔진 맞추기 (SYNC.md 2.3): 바뀐 엔티티(없으면 전부)를 엔진 트랜잭션 하나(origin 'remote', 실행 취소 기록 없음)로 Y에 맞춘다.
// - 살아 있음은 묘비 판정(tombstone.ts Liveness) — 지워진 것(묘비, 보류 아님)은 엔진에서 숨기고, 보류 중인 삭제 묶음은 살려서
//   블록에 충돌 표시(conflict)를 투영한다(Y에는 쓰지 않는다)
// - 들이기 전 엔진 규칙에 맞게 편다(normalize.ts). 끊긴 참조(지워진 블록을 가리키는 콘텐츠 · 화살표 · 묶인 잉크)는 넣지 않는다
// - 13.4 N5 · N6 · N8: 잉크가 아닌 콘텐츠에 묶인 획 · 획이 하나도 없는 잉크 · 다른 종류 맵에 같은 id가 있는 엔티티(block > content > arrow > stroke)는 숨긴다
// - 13.3 #20 `layout` 마스크: 높이 자동(sizing 'auto') 블록의 h는 기기마다 잰 값이라 Y의 h로 덮지 않는다(새로 만들 때만 처음 값으로)
// - 한 트랜잭션이 막히면 걸음마다 따로 들여 나머지는 살리고, 못 들인 수를 돌려준다
import * as Y from 'yjs';
import { isBlockEnd, sameValue, validEnd, type Engine, type Id, type Tx } from '@dn/engine-core';
import { fitIncoming } from './normalize';
import { Liveness } from './tombstone';
import { getOf, KIND_OF, KINDS, listOf, noteFields, rootOf, yToEntity, type Kind } from './ymap';

type Step = (tx: Tx) => void;

export function reconcile(engine: Engine, doc: Y.Doc, touched: Map<Kind, Set<Id>> | null, noteTouched = true, device?: string): { changed: number; rejected: number } {
  const live = new Liveness(doc, device);
  const parentOf = (sid: Id) => { const p = rootOf(doc, 'strokes').get(sid)?.get('parent') as { kind?: string; contentId?: Id } | undefined; return p?.kind === 'content' ? p.contentId : undefined; };
  const ids = (kind: Kind): Id[] => {
    if (touched) {
      const set = new Set<Id>(touched.get(kind) ?? []);
      // N8: 다른 종류 맵의 같은 id가 바뀌면 이 맵의 그 id도 다시 본다 · N6: 획이 바뀌면 그 부모 잉크도 다시 본다
      for (const [k, s] of touched) if (k !== kind) for (const id of s) if (rootOf(doc, kind).has(id)) set.add(id);
      if (kind === 'contents') for (const id of touched.get('strokes') ?? []) { const p = parentOf(id); if (p) set.add(p); }
      return [...set];
    }
    const all = new Set<Id>(rootOf(doc, kind).keys());
    for (const x of listOf(engine, kind)) all.add(x.id);
    return [...all];
  };
  const get = (kind: Kind, id: Id) => getOf(engine, kind, id);
  // N8: 앞 종류 맵에 살아 있는 같은 id가 있으면 이 엔티티는 숨긴다
  const shadowed = (kind: Kind, id: Id) => KINDS.slice(0, KINDS.indexOf(kind)).some((k) => rootOf(doc, k).has(id) && live.alive(k, id));
  // N6: 잉크 콘텐츠마다 살아 있는 획 수 (처음 물을 때 한 번 센다)
  let inkCount: Map<Id, number> | null = null;
  const strokesOf = (cid: Id) => {
    if (!inkCount) {
      inkCount = new Map();
      for (const [sid, sm] of rootOf(doc, 'strokes').entries()) {
        if (!(sm instanceof Y.Map) || !live.alive('strokes', sid)) continue;
        const p = sm.get('parent') as { kind?: string; contentId?: Id } | undefined;
        if (p?.kind === 'content' && p.contentId) inkCount.set(p.contentId, (inkCount.get(p.contentId) ?? 0) + 1);
      }
    }
    return inkCount.get(cid) ?? 0;
  };
  const want = (kind: Kind, id: Id) => {
    const m = rootOf(doc, kind).get(id);
    if (!(m instanceof Y.Map) || !live.alive(kind, id) || shadowed(kind, id)) return undefined;
    if (kind === 'contents' && m.get('type') === 'ink' && !strokesOf(id)) return undefined;
    let rec = yToEntity(KIND_OF[kind], id, m);
    if (kind === 'blocks') { const c = live.conflictOf(id); if (c) rec = { ...rec, conflict: c }; }
    return fitIncoming(KIND_OF[kind], rec);
  };
  // 최종 상태에서 블록이 살아 있는가 (끊긴 참조 거르기)
  const blockAlive = (id: Id) => live.alive('blocks', id);
  const contentAlive = (id: Id) => { const m = rootOf(doc, 'contents').get(id); return !!m && live.alive('contents', id) && blockAlive(String(m.get('blockId'))); };
  const plan = (kind: Kind) => ids(kind).map((id) => ({ id, cur: get(kind, id), next: want(kind, id) }));
  const blocks = plan('blocks'), contents = plan('contents'), arrows = plan('arrows'), strokes = plan('strokes');
  const okContent = (v: Record<string, unknown>) => blockAlive(String(v.blockId));
  // 화살표 끝: 상자 끝이면 그 상자가 살아 있어야 하고, 빈 곳의 점 끝(11/09)은 그대로
  const okEnd = (an: unknown) => validEnd(an) && (!isBlockEnd(an) || blockAlive(an.blockId));
  const okArrow = (v: Record<string, unknown>) => okEnd(v.from) && okEnd(v.to);
  // N5: 묶인 획의 부모는 살아 있는 잉크 콘텐츠여야 한다
  const okStroke = (v: Record<string, unknown>) => {
    const p = v.parent as { kind: string; contentId?: Id };
    return p?.kind !== 'content' || (contentAlive(String(p.contentId)) && rootOf(doc, 'contents').get(String(p.contentId))?.get('type') === 'ink');
  };

  // 바꿀 일을 한 걸음씩 모은다 — 한 트랜잭션에 다 넣어 보고, 막히면 걸음마다 따로 들인다
  const steps: Step[] = [];
  if (noteTouched) {
    const want = noteFields(doc.getMap<unknown>('note'));
    const cur = engine.note as unknown as Record<string, unknown>;
    // Y의 필드 + 엔진에만 있는 필드(다른 곳에서 지운 것 — 필드를 지우면 Y에서 키가 사라진다. 예: 편집 잠금을 풀어 page가 빠짐)
    for (const k of new Set([...Object.keys(want), ...Object.keys(cur)])) {
      if (k === 'id') continue;
      const v = want[k];
      if (!sameValue(cur[k], v)) steps.push((tx) => tx.setNote({ [k]: v === undefined ? undefined : structuredClone(v) }));
    }
  }
  // 지우기: 화살표 · 잉크 → 콘텐츠 → 블록
  for (const [kind, list, ok] of [['arrows', arrows, okArrow], ['strokes', strokes, okStroke], ['contents', contents, okContent]] as const) {
    for (const x of list) if (x.cur && (!x.next || !ok(x.next))) steps.push((tx) => { if (get(kind, x.id)) tx.delete(KIND_OF[kind], x.id); });
  }
  // 블록을 지울 때 엔진에서 그 블록에 붙은 콘텐츠 · 화살표는 같이 지운다 — 단, Y에서는 이미 다른 블록으로 옮겨 살아 있으면(화살표 다시 잇기 ·
  // 콘텐츠 옮기기와 블록 지우기가 한꺼번에 들어옴) 지우지 않고 그리로 옮긴다. 전에는 지워 버려 뒤의 '고치기' 걸음이 건너뛰어 그 기기에서만 사라졌다 (S4 반례 s4-01)
  for (const x of blocks) if (x.cur && !x.next) {
    steps.push((tx) => {
      if (!engine.getBlock(x.id)) return;
      for (const c of [...engine.contentsOf(x.id)]) {
        const n = want('contents', c.id);
        if (n && okContent(n)) tx.set('content', c.id, patchOf(c as unknown as Record<string, unknown>, n)); else tx.delete('content', c.id);
      }
      for (const a of [...engine.arrowsOf(x.id)]) {
        const n = want('arrows', a.id);
        if (n && okArrow(n)) tx.set('arrow', a.id, patchOf(a as unknown as Record<string, unknown>, n)); else tx.delete('arrow', a.id);
      }
      tx.delete('block', x.id);
    });
  }
  // 만들기 · 고치기: 블록 → 콘텐츠 → 화살표 · 잉크
  for (const [kind, list, ok] of [['blocks', blocks, () => true], ['contents', contents, okContent], ['arrows', arrows, okArrow], ['strokes', strokes, okStroke]] as const) {
    for (const x of list) {
      const next = x.next;
      if (!next || !ok(next)) continue;
      if (!x.cur) {
        steps.push((tx) => {
          if (get(kind, x.id)) return;
          if (kind === 'blocks') tx.createBlock(next as never);
          else if (kind === 'contents') tx.createContent(next as never);
          else if (kind === 'arrows') tx.createArrow(next as never);
          else tx.apply({ k: 'create', e: 'stroke', id: x.id, value: next } as never);
        });
        continue;
      }
      const patch = patchOf(x.cur, next);
      // layout 마스크: 높이 자동 블록의 h는 이 기기가 잰 값을 둔다
      if (kind === 'blocks' && x.cur.sizing === 'auto' && next.sizing === 'auto') delete patch.h;
      if (Object.keys(patch).length) steps.push((tx) => { if (get(kind, x.id)) tx.set(KIND_OF[kind], x.id, patch); });
    }
  }
  if (!steps.length) return { changed: 0, rejected: 0 };
  const run = (list: readonly Step[]) => engine.transact((tx) => { for (const s of list) s(tx); }, { origin: 'remote', undoable: false });
  const all = run(steps);
  if (all.ok) return { changed: steps.length, rejected: 0 };
  // 한 걸음이 막아 전부 되돌려졌다 — 걸음마다 따로 들여 나머지는 살린다
  let changed = 0, rejected = 0, why = all.reason;
  for (const s of steps) {
    const r = run([s]);
    if (r.ok) changed++; else { rejected++; why = r.reason; }
  }
  if (rejected) console.warn(`동기화: 다른 곳 변경 ${rejected}개를 엔진 규칙 때문에 들이지 못했어요`, why);
  return { changed, rejected };
}

/** 엔진 레코드 → Y 레코드로 바꿀 필드 (id 제외, 엔진에만 있는 필드는 지움) */
function patchOf(cur: Record<string, unknown>, next: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(next)) if (k !== 'id' && !sameValue(cur[k], v)) patch[k] = v;
  for (const k of Object.keys(cur)) if (!(k in next) && k !== 'id') patch[k] = undefined;
  return patch;
}
