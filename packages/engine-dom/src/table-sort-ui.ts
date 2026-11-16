// 표 열 머리 정렬 단추 (engine-core table-sort.ts): 머리 칸 오른쪽의 작은 단추 — 누르면 오름차순, 그 열로 오름차순이면 내림차순.
// 정렬한 열은 ↑ · ↓가 늘 보인다. 캔버스 · 문서 뷰가 같은 그리기(rich-render.ts)를 쓰고, 누르기는 뷰 뿌리에서 한 번에 받는다.
import { hasRowMerges, isTableContent, sortTable, tableSortState, type Engine, type SortDir } from '@dn/engine-core';
import { iconElement } from '@dn/text-pm';

/** 열 머리 칸: 이름 + 정렬 단추 */
export function headerCell(th: HTMLElement, name: string, dir: SortDir | null): void {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `dn-table-sort dn-ui${dir ? ' on' : ''}`;
  b.title = dir === 'asc' ? '내림차순으로 정렬' : '오름차순으로 정렬';
  b.setAttribute('aria-label', `${name} 열 ${b.title}`);
  b.append(iconElement(dir === 'desc' ? 'arrowDown' : 'arrowUp', 12));
  th.replaceChildren(Object.assign(document.createElement('span'), { className: 'dn-th-name', textContent: name }), b);
}

/** 뷰 뿌리에서 정렬 단추 누르기를 받는다 — 세로로 합친 칸이 있어 못 하면 onRefused */
export function bindTableSort(root: HTMLElement, engine: Engine, o: { readOnly: () => boolean; onRefused?: () => void; signal?: AbortSignal }): void {
  root.addEventListener('click', (e) => {
    const b = e.target instanceof Element ? e.target.closest<HTMLElement>('.dn-table-sort') : null;
    if (!b || b.closest('.dn-embed')) return;
    e.preventDefault();
    e.stopPropagation();
    const col = b.closest<HTMLElement>('th[data-col]')?.dataset.col, part = b.closest<HTMLElement>('[data-part]')?.dataset.part;
    const t = part ? engine.getContent(part) : undefined;
    if (o.readOnly() || !col || !part || !isTableContent(t)) return;
    if (hasRowMerges(t)) { o.onRefused?.(); return; }
    sortTable(engine, part, col, tableSortState(t, col) === 'asc' ? 'desc' : 'asc');
  }, o.signal ? { signal: o.signal } : undefined);
}
