// 문서 뷰 블록 손잡이 ⋮⋮ (노션처럼): 블록 위에 마우스를 올리면 왼쪽에 손잡이. 끌면 고른 블록(없으면 그 블록)을 놓는 자리로 옮기고,
// 누르면 블록 메뉴(지우기 · 복제 · 위로 · 아래로 · 캔버스에서 보기). 옮기기는 engine-core moveBlocksBelow — id 그대로, 실행 취소 한 번.
// 묶음은 통째로 옮기고, 다른 묶음 · 흐름 가운데에 놓으면 그 끝으로 붙는다 — 놓을 자리 줄도 실제로 놓일 자리에 (DE-007).
import { captionKind, docDropTarget, docStepTarget, docUnitIds, moveBlocksBelow, type Id } from '@dn/engine-core';
import type { DocView } from './doc-view';
import { editCaption } from './caption-view';

const DRAG_PX = 4;

export class DocHandle {
  private readonly grip = document.createElement('button');
  private readonly line = document.createElement('div');
  private menu: HTMLElement | null = null;
  private menuAc: AbortController | null = null;
  private item: HTMLElement | null = null;
  private drag: { x: number; y: number; on: boolean; target: Id | null | undefined } | null = null;
  private readonly ac = new AbortController();

  constructor(private readonly dv: DocView) {
    const signal = this.ac.signal;
    this.grip.type = 'button';
    this.grip.className = 'dn-doc-grip';
    this.grip.title = '끌어서 옮기기 · 눌러서 메뉴';
    this.grip.setAttribute('aria-label', '블록 메뉴');
    this.grip.textContent = '⋮⋮';
    this.grip.hidden = true;
    this.line.className = 'dn-doc-drop';
    this.line.hidden = true;
    dv.root.append(this.grip, this.line);
    dv.root.addEventListener('mousemove', (e) => this.hover(e), { signal });
    dv.root.addEventListener('mouseleave', () => { if (!this.drag && !this.menu) this.grip.hidden = true; }, { signal });
    this.grip.addEventListener('mousedown', (e) => this.down(e), { signal });
    window.addEventListener('mousemove', (e) => this.move(e), { signal });
    window.addEventListener('mouseup', (e) => this.up(e), { signal });
  }

  private items(): HTMLElement[] { return [...this.dv.page.querySelectorAll<HTMLElement>('.dn-doc-item[data-id]')]; }

  private hover(e: MouseEvent): void {
    if (this.drag || this.menu || this.dv.opts.readOnly) return;
    const t = e.target instanceof Element ? e.target : null;
    if (t === this.grip) return;
    const el = t?.closest<HTMLElement>('.dn-doc-item[data-id]') ?? null;
    if (!el) return;
    this.item = el;
    const r = el.getBoundingClientRect(), base = this.dv.root.getBoundingClientRect();
    this.grip.style.left = `${r.left - base.left + this.dv.root.scrollLeft - 26}px`;
    this.grip.style.top = `${r.top - base.top + this.dv.root.scrollTop + 2}px`;
    this.grip.hidden = false;
  }

  private down(e: MouseEvent): void {
    if (e.button !== 0 || !this.item) return;
    e.preventDefault(); e.stopPropagation();
    this.drag = { x: e.clientX, y: e.clientY, on: false, target: undefined };
  }

  /** 옮길 블록: 손잡이 블록이 고른 범위 안이면 고른 블록 전부, 아니면 그 블록 하나 — 묶음 · 나눈 단계는 함께 (캔버스와 같게) */
  private moving(): Id[] {
    const id = this.item?.dataset.id;
    if (!id) return [];
    const sel = this.dv.select?.selected().blocks ?? [];
    return docUnitIds(this.dv.opts.engine, sel.includes(id) ? sel : [id]);
  }

  private move(e: MouseEvent): void {
    const d = this.drag;
    if (!d) return;
    if (!d.on && Math.hypot(e.clientX - d.x, e.clientY - d.y) < DRAG_PX) return;
    if (!d.on) {
      d.on = true;
      const ids = this.moving();
      const all = this.items();
      const idx = all.map((el, i) => (ids.includes(el.dataset.id!) ? i : -1)).filter((i) => i >= 0);
      this.dv.select?.select(Math.min(...idx), Math.max(...idx));
      this.dv.root.classList.add('dn-doc-dragging');
    }
    // 놓을 자리: 항목 가운데보다 위면 그 앞 → 그 앞의 (옮기지 않는) 블록 아래. 묶음 · 흐름 가운데면 엔진이 실제로 놓을 그 끝으로
    const ids = this.moving(), all = this.items().filter((el) => !ids.includes(el.dataset.id!));
    let drop = all.length;
    for (let i = 0; i < all.length; i++) { const r = all[i]!.getBoundingClientRect(); if (e.clientY < r.top + r.height / 2) { drop = i; break; } }
    const target = docDropTarget(this.dv.opts.engine, ids, drop > 0 ? all[drop - 1]!.dataset.id! : null);
    d.target = target;
    const at = target ? all.find((el) => el.dataset.id === target) : all[0];
    if (!at) { this.line.hidden = true; return; }
    const r = at.getBoundingClientRect(), base = this.dv.root.getBoundingClientRect();
    const y = target ? r.bottom + 4 : r.top - 4;
    Object.assign(this.line.style, { left: `${r.left - base.left + this.dv.root.scrollLeft}px`, width: `${r.width}px`, top: `${y - base.top + this.dv.root.scrollTop}px` });
    this.line.hidden = false;
  }

  private up(e: MouseEvent): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    this.line.hidden = true;
    this.dv.root.classList.remove('dn-doc-dragging');
    if (!d.on) { this.openMenu(e); return; }
    if (d.target === undefined) return;
    const ids = this.moving(), all = this.items();
    // 제자리: 놓을 블록이 지금 바로 앞 블록이면
    const first = all.findIndex((el) => ids.includes(el.dataset.id!));
    let prev = first - 1;
    while (prev >= 0 && ids.includes(all[prev]!.dataset.id!)) prev--;
    if (d.target === (prev >= 0 ? all[prev]!.dataset.id! : null)) return;
    this.moveTo(ids, d.target);
  }

  private moveTo(ids: Id[], target: Id | null): void {
    const r = moveBlocksBelow(this.dv.opts.engine, ids, target);
    if (!r.ok) return;
    this.dv.render();
    const all = this.items(), idx = all.map((el, i) => (ids.includes(el.dataset.id!) ? i : -1)).filter((i) => i >= 0);
    if (idx.length) this.dv.select?.select(Math.min(...idx), Math.max(...idx));
  }

  /** 한 조각 위 · 아래로 — 묶음 · 다른 흐름은 통째로 건너뛰고, 같은 흐름 안에선 단계마다 */
  private step(dir: -1 | 1): void {
    const ids = this.moving();
    const t = docStepTarget(this.dv.opts.engine, ids, dir);
    if (t !== undefined) this.moveTo(ids, t);
  }

  private openMenu(e: MouseEvent): void {
    const id = this.item?.dataset.id;
    if (!id) return;
    if (!(this.dv.select?.selected().blocks.includes(id))) this.dv.select?.selectBlock(id);
    this.closeMenu();
    const m = document.createElement('div');
    m.className = 'dn-doc-menu';
    m.setAttribute('role', 'menu');
    const act = (label: string, key: string, run: () => void) => {
      const b = document.createElement('button');
      b.type = 'button'; b.setAttribute('role', 'menuitem');
      b.append(label, Object.assign(document.createElement('kbd'), { textContent: key }));
      b.addEventListener('mousedown', (ev) => ev.preventDefault());
      b.addEventListener('click', () => { this.closeMenu(); run(); });
      m.append(b);
    };
    act('지우기', 'Del', () => this.dv.select?.remove());
    act('복제', 'Ctrl+D', () => this.dv.select?.duplicate());
    const sel = this.dv.select?.selected().blocks ?? [];
    if (sel.length > 1) act('블록으로 묶기', 'Ctrl+G', () => this.dv.select?.group(true));
    if (sel.some((b) => this.dv.opts.engine.getBlock(b)?.group)) act('묶음 풀기', 'Ctrl+Shift+G', () => this.dv.select?.group(false));
    act('위로 옮기기', 'Alt+↑', () => this.step(-1));
    act('아래로 옮기기', 'Alt+↓', () => this.step(1));
    // 그림 · 표 캡션 (워드 캡션 삽입)
    if (captionKind(this.dv.opts.engine, id)) act(this.dv.opts.engine.getBlock(id)?.caption ? '캡션 고치기' : '캡션 달기', '', () => { const r = this.dv.items.get(id)?.el.getBoundingClientRect(); if (r) editCaption(this.dv.opts.engine, id, { left: r.left, top: r.bottom + 4, width: r.width }); });
    if (this.dv.opts.word?.openInCanvas) act('캔버스에서 보기', '', () => this.dv.opts.word?.openInCanvas?.(id));
    document.body.append(m);
    const r = m.getBoundingClientRect();
    m.style.left = `${Math.max(8, Math.min(e.clientX, innerWidth - r.width - 8))}px`;
    m.style.top = `${Math.max(8, Math.min(e.clientY + 8, innerHeight - r.height - 8))}px`;
    this.menu = m;
    const off = (ev: Event) => { if (ev.type === 'keydown' && (ev as KeyboardEvent).key !== 'Escape') return; if (ev.type === 'pointerdown' && m.contains(ev.target as Node)) return; this.closeMenu(); };
    const ac = (this.menuAc = new AbortController());
    setTimeout(() => { if (ac.signal.aborted) return; window.addEventListener('pointerdown', off, { capture: true, signal: ac.signal }); window.addEventListener('keydown', off, { capture: true, signal: ac.signal }); }, 0);
    (m.firstElementChild as HTMLElement | null)?.focus();
  }

  private closeMenu(): void {
    this.menuAc?.abort();
    this.menuAc = null;
    this.menu?.remove();
    this.menu = null;
  }

  /** 키보드: 고른 블록 Alt+↑↓ 옮기기 (doc-select가 부른다) */
  stepSelected(dir: -1 | 1): void {
    const sel = this.dv.select?.selected().blocks ?? [];
    if (!sel.length) return;
    this.item = this.items().find((el) => el.dataset.id === sel[0]) ?? null;
    this.step(dir);
  }

  destroy(): void { this.ac.abort(); this.closeMenu(); this.grip.remove(); this.line.remove(); }
}
