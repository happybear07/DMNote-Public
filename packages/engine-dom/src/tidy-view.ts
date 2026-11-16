// 배치 다듬기 명령 (서브 구조화): 고른 상자들(없으면 캔버스 전체)의 자리 · 크기를 다듬는다. 계산은 engine-core tidy.ts,
// 여기서는 화면으로 잰다 — 제목 상자의 한 줄 폭 · 폭을 바꾼 글 상자의 높이. 실행 취소 한 번.
// 제목 상자는 글보다 훨씬 넓을 때(¾ 넘게 비었을 때)만 줄이고, 그림 · 표 · 그래프 폭은 그대로. 글만 든 본문 상자는 한 도식 안에서
// 같은 폭 · 같은 높이(uniform), 화살표는 곧게 · 안 되면 꺾은선(tidy.ts TidyPlan).
import { applyTidy, groupMembers, isBound, isTextContent, relationSpec, tidyPlan, type Arrow, type Block, type Id, type TextDoc, type TidyGroup, type TidyNode, type TxResult } from '@dn/engine-core';
import type { CanvasView } from './canvas-view';
import { measureTitleWidth } from './mount';

/** 한 번에 다듬는 상자 수 상한 — 넘으면 일부를 골라 달라고 한다 */
export const TIDY_LIMIT = 400;
const MIN_TITLE_W = 120, TAG_H = 20;

/**
 * 화살표의 배치 차례: 관계가 '뒤 → 앞'(일부 · 종류 · 예시 · 의존 · 답 …)이거나 뒷받침 · 반박(주장이 위 — AI 논증 배치와 같게)이면
 * 도착 쪽이 앞 층, 같은 줄 관계(대조 · 동치 · 관련 …)는 곁에. 관계가 없으면(직접 그은 화살표) 화살표 방향 그대로
 */
function tidyDir(a: Arrow): 'forward' | 'reverse' | 'same' {
  return a.relation === 'supports' || a.relation === 'refutes' ? 'reverse' : relationSpec(a.relation).layout;
}

/** 상자 위 종류 태그가 붙는가 (groups-view 이름표 올림과 같은 조건) */
const tagged = (b: Block) => !!(b.nodeKind || b.role || b.speaker || b.time || b.owner || b.due || b.start || b.end);

export function tidyBlocks(view: CanvasView, ids?: readonly Id[]): TxResult<number> {
  if (view.readOnly) return { ok: false, reason: '이 노트는 지금 고칠 수 없어요.' };
  const engine = view.engine;
  const set = (ids && ids.length >= 2 ? ids : [...engine.blocks()].map((b) => b.id)).filter((id) => engine.getBlock(id));
  if (set.length < 2) return { ok: false, reason: '다듬을 상자가 둘 이상 있어야 해요.' };
  if (set.length > TIDY_LIMIT) return { ok: false, reason: `상자가 ${TIDY_LIMIT}개가 넘어요. 다듬을 상자를 골라 주세요.` };
  const inSet = new Set(set);
  const docs = new Map<Id, { doc: TextDoc; kind: 'title' | 'text' }>();
  const nodes: TidyNode[] = set.map((id) => {
    const b = engine.getBlock(id)!;
    const cs = engine.contentsOf(id);
    const t = cs.length === 1 && isTextContent(cs[0]!) && b.sizing === 'auto' ? cs[0] : null;
    let minW: number | undefined;
    if (t) {
      const kind = t.role === 'title' ? 'title' : 'text';
      docs.set(id, { doc: t.doc, kind });
      if (kind === 'title') {
        const fit = Math.max(MIN_TITLE_W, measureTitleWidth(view, t.doc));
        minW = fit < b.w * 0.75 ? fit : b.w;
      } else minW = b.w;
    }
    return { id, x: b.x, y: b.y, w: b.w, h: b.h, ...(tagged(b) ? { top: TAG_H } : {}), ...(minW !== undefined ? { minW } : {}), ...(t && t.role !== 'title' ? { uniform: true } : {}) };
  });
  const edges = [...engine.arrows()].filter(isBound).filter((a) => inSet.has(a.from.blockId) && inSet.has(a.to.blockId))
    .map((a) => ({ id: a.id, from: a.from.blockId, to: a.to.blockId, dir: tidyDir(a), ...(a.label ? { label: a.label } : {}) }));
  // 묶음: 고른 것 안에 다 든 묶음만. 모양 묶음(시간축 · 사분면 · 척도 · 벤 · 피시본) · 카드는 안쪽을 그대로(통째로만)
  const groups: TidyGroup[] = [];
  for (const [gid, ms] of groupMembers(engine)) {
    if (ms.length < 2 || !ms.every((m) => inSet.has(m))) continue;
    const meta = engine.note.groups?.[gid];
    groups.push({ id: gid, members: ms, ...(meta?.shape || meta?.bracket === 'card' ? { rigid: true } : {}) });
  }
  const plan = tidyPlan({
    nodes, edges, groups,
    heightAt: (id, w) => { const d = docs.get(id); return d ? view.measureText(d.doc, w, d.kind) : engine.getBlock(id)!.h; },
  });
  return applyTidy(engine, plan);
}
