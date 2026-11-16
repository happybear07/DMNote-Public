// 표 크기 고르기 (워드의 "표 삽입" 칸): 칸 위에 마우스를 올려 열 × 행을 고르고 누르면 넣는다.
// 큰 표는 아래 숫자 칸으로. 첫 행은 머리글(열 이름) — 고른 행 수에 포함된다. 표를 넣는 모든 길(서식 막대 · 넣기 메뉴 · 도구 막대 · /표)이 같이 쓴다.
import { makeTable, type TableData } from '@dn/engine-core';

export interface TableSize { cols: number; rows: number }

const GRID_C = 10, GRID_R = 8, MAX_C = 20, MAX_R = 100;
let openPicker: (() => void) | null = null;

/** 고른 크기의 빈 표 — 열 이름은 '열 1' …, 머리글 행을 뺀 나머지가 빈 행 */
export function sizedTable(s: TableSize): TableData {
  const cols = Array.from({ length: s.cols }, (_, i) => `열 ${i + 1}`);
  return makeTable(cols, Array.from({ length: Math.max(1, s.rows - 1) }, () => cols.map(() => '')));
}

/** 표 블록 크기 (월드 px) */
export function tableBlockSize(s: TableSize): { w: number; h: number } {
  return { w: Math.max(420, s.cols * 110), h: Math.max(80, s.rows * 40) };
}

/** 지금 커서(글 선택) 자리 — 없으면 null */
function caretPoint(): { x: number; y: number } | null {
  const sel = typeof getSelection === 'function' ? getSelection() : null;
  if (!sel?.rangeCount) return null;
  const r = sel.getRangeAt(0).getBoundingClientRect();
  return r.width || r.height || r.top ? { x: r.left, y: r.bottom + 6 } : null;
}

/**
 * 표 크기 고르기 창을 띄운다. 고르면 onPick, Esc · 바깥 누르기는 아무 일 없이 닫힘.
 * at: 화면 좌표(창 왼쪽 위). 없으면 커서 아래, 그것도 없으면 화면 가운데.
 */
export function pickTableSize(onPick: (s: TableSize) => void, at?: { x: number; y: number } | null): void {
  openPicker?.();
  const prevFocus = document.activeElement as HTMLElement | null;
  const box = document.createElement('div');
  box.className = 'dn-table-picker';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', '표 크기 고르기');
  const label = document.createElement('div');
  label.className = 'dn-tp-label';
  const grid = document.createElement('div');
  grid.className = 'dn-tp-grid';
  grid.style.gridTemplateColumns = `repeat(${GRID_C}, 1fr)`;
  grid.tabIndex = 0;
  grid.setAttribute('role', 'grid');
  const cells: HTMLElement[] = [];
  for (let r = 1; r <= GRID_R; r++) for (let c = 1; c <= GRID_C; c++) {
    const cell = document.createElement('span');
    cell.className = 'dn-tp-cell';
    cell.dataset.c = String(c); cell.dataset.r = String(r);
    cells.push(cell);
  }
  grid.append(...cells);
  const form = document.createElement('form');
  form.className = 'dn-tp-form';
  const num = (name: string, max: number, v: number) => {
    const i = document.createElement('input');
    i.type = 'number'; i.min = '1'; i.max = String(max); i.value = String(v); i.name = name; i.setAttribute('aria-label', name);
    return i;
  };
  const colIn = num('열', MAX_C, 3), rowIn = num('행', MAX_R, 3);
  const ok = document.createElement('button');
  ok.type = 'submit'; ok.textContent = '넣기';
  const lab = (t: string, i: HTMLInputElement) => { const l = document.createElement('label'); l.append(t, i); return l; };
  form.append(lab('열', colIn), lab('행', rowIn), ok);
  box.append(label, grid, form);

  let cur: TableSize = { cols: 3, rows: 3 };
  const show = (s: TableSize) => {
    cur = s;
    for (const cell of cells) cell.classList.toggle('on', Number(cell.dataset.c) <= s.cols && Number(cell.dataset.r) <= s.rows);
    label.textContent = `${s.cols} × ${s.rows} 표 (열 × 행, 첫 행은 머리글)`;
    colIn.value = String(s.cols); rowIn.value = String(s.rows);
  };
  const close = () => {
    if (openPicker !== close) return;
    openPicker = null;
    box.remove();
    window.removeEventListener('pointerdown', outside, true);
    window.removeEventListener('keydown', onEsc, true);
  };
  const pick = (s: TableSize) => {
    close();
    prevFocus?.focus?.({ preventScroll: true });
    onPick({ cols: Math.min(MAX_C, Math.max(1, s.cols)), rows: Math.min(MAX_R, Math.max(2, s.rows)) });
  };
  const outside = (e: PointerEvent) => { if (!box.contains(e.target as Node)) close(); };
  const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); prevFocus?.focus?.({ preventScroll: true }); } };
  const cellOf = (t: EventTarget | null) => (t instanceof HTMLElement && t.classList.contains('dn-tp-cell') ? { cols: Number(t.dataset.c), rows: Number(t.dataset.r) } : null);
  grid.addEventListener('mouseover', (e) => { const s = cellOf(e.target); if (s) show(s); });
  // 누르는 동안 편집기 초점을 빼앗지 않게 (서식 막대처럼)
  grid.addEventListener('mousedown', (e) => e.preventDefault());
  grid.addEventListener('click', (e) => { const s = cellOf(e.target); if (s) pick(s); });
  grid.addEventListener('keydown', (e) => {
    const d = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] }[e.key];
    if (d) { e.preventDefault(); show({ cols: Math.min(GRID_C, Math.max(1, cur.cols + d[0]!)), rows: Math.min(GRID_R, Math.max(2, cur.rows + d[1]!)) }); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(cur); }
  });
  form.addEventListener('submit', (e) => { e.preventDefault(); pick({ cols: Number(colIn.value) || 1, rows: Number(rowIn.value) || 2 }); });
  form.addEventListener('input', () => show({ cols: Math.min(MAX_C, Number(colIn.value) || 1), rows: Math.min(MAX_R, Number(rowIn.value) || 2) }));

  show(cur);
  document.body.appendChild(box);
  const p = at ?? caretPoint() ?? { x: innerWidth / 2 - 120, y: innerHeight / 2 - 120 };
  const r = box.getBoundingClientRect();
  box.style.left = `${Math.max(8, Math.min(p.x, innerWidth - r.width - 8))}px`;
  box.style.top = `${Math.max(8, Math.min(p.y, innerHeight - r.height - 8))}px`;
  openPicker = close;
  // 창을 띄운 그 누르기가 바로 닫지 않게 다음 틱부터
  setTimeout(() => { if (openPicker === close) window.addEventListener('pointerdown', outside, true); }, 0);
  window.addEventListener('keydown', onEsc, true);
  grid.focus({ preventScroll: true });
}
