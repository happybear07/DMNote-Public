// 문서 뷰 컬럼 (FR-049): 캔버스에서 같은 줄(읽는 순서의 40px 줄)에 나란히 놓인 블록은 문서 뷰에서도 좌우 컬럼으로 — 따로 구조를 두지 않는다.
// 컬럼 너비는 캔버스 폭 비율 그대로, 사이 막대를 끌면 두 블록의 캔버스 폭이 바뀐다(합은 그대로, 끌기 한 번 = 실행 취소 한 번).
// 캔버스 ↔ 문서 전환에서 바뀌는 것이 없다: 컬럼은 자리에서 나온다. 좁은 화면에서는 세로로 쌓는다(CSS).
import type { Block, Engine, Id } from '@dn/engine-core';

const ROW = 40;
const MIN_W = 120;

/** 문서 순서의 블록 → 줄 묶음 (같은 40px 줄이면 한 줄). columnable이 아닌 블록(흐름의 단계)은 늘 혼자 한 줄 */
export function docRows(order: readonly Block[], columnable: (b: Block) => boolean = () => true): Block[][] {
  const rows: Block[][] = [];
  for (const b of order) {
    const last = rows[rows.length - 1];
    if (last && columnable(b) && columnable(last[0]!) && Math.round(last[0]!.y / ROW) === Math.round(b.y / ROW)) last.push(b);
    else rows.push([b]);
  }
  return rows;
}

/** 묶음(상자 둘 이상)의 문서 차례 연속 구간: 첫 · 가운데 · 끝 — 왼쪽 선으로 한 블록임을 보인다 */
export function groupRuns(order: readonly Block[]): Map<Id, string> {
  const out = new Map<Id, string>();
  order.forEach((b, i) => {
    if (!b.group) return;
    const prev = order[i - 1]?.group === b.group, next = order[i + 1]?.group === b.group;
    if (prev || next) out.set(b.id, prev && next ? 'mid' : prev ? 'last' : 'first');
  });
  return out;
}

/** 두 컬럼 사이 막대: 끌면 왼쪽 · 오른쪽 블록의 캔버스 폭을 나눈다 */
export function columnGap(engine: Engine, left: Id, right: Id, readOnly: boolean): HTMLDivElement {
  const gap = document.createElement('div');
  gap.className = 'dn-doc-gap';
  gap.setAttribute('aria-hidden', 'true');
  if (readOnly) return gap;
  gap.title = '끌어서 컬럼 너비 바꾸기';
  gap.addEventListener('pointerdown', (e) => {
    const l = gap.previousElementSibling as HTMLElement | null, r = gap.nextElementSibling as HTMLElement | null;
    const bl = engine.getBlock(left), br = engine.getBlock(right);
    if (!l || !r || !bl || !br) return;
    e.preventDefault();
    gap.setPointerCapture(e.pointerId);
    gap.classList.add('dragging');
    const sum = bl.w + br.w;
    const x0 = l.getBoundingClientRect().left, x1 = r.getBoundingClientRect().right;
    engine.breakUndoMerge();
    const move = (ev: PointerEvent) => {
      const ratio = (ev.clientX - x0) / Math.max(1, x1 - x0);
      const wl = Math.round(Math.max(MIN_W, Math.min(sum - MIN_W, sum * ratio)));
      engine.transact((tx) => { tx.set('block', left, { w: wl }); tx.set('block', right, { w: sum - wl }); },
        { origin: 'user', label: '컬럼 너비', mergeKey: `colw:${left}|${right}` });
    };
    const up = () => { gap.classList.remove('dragging'); gap.removeEventListener('pointermove', move); gap.removeEventListener('pointerup', up); engine.breakUndoMerge(); };
    gap.addEventListener('pointermove', move);
    gap.addEventListener('pointerup', up);
  });
  return gap;
}
