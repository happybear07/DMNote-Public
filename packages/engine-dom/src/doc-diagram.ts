// 문서 뷰의 도식 그림 (워드 SmartArt 자리 · GAP-PLAN 24): '문서에서 그림으로'를 켠 묶음(블록)은 상자 · 화살표를 캔버스 모양 그대로
// 그림 한 장으로 보인다(글 항목 대신, 묶음의 첫 자리에). 그림은 앱이 캔버스로 그려 준다(opts.diagram — exportPng).
// 묶음의 상자 · 글 · 화살표가 바뀌면 조금 모아 다시 그린다. 두 번 누르면 캔버스로, 오른쪽 클릭은 묶음 메뉴(그림 ↔ 글).
import { groupName, isBound, type Block, type Engine, type Id } from '@dn/engine-core';

export type DiagramHost = (ids: readonly Id[]) => Promise<Blob | null>;

/** 그림으로 보일 묶음 (묶음 id → 상자들, 문서 차례) — 상자가 둘 이상인 묶음만 */
export function diagramGroups(e: Engine, order: readonly Block[]): Map<Id, Id[]> {
  const out = new Map<Id, Id[]>();
  const meta = e.note.groups ?? {};
  for (const b of order) if (b.group && meta[b.group]?.figure) { const a = out.get(b.group); if (a) a.push(b.id); else out.set(b.group, [b.id]); }
  for (const [k, v] of out) if (v.length < 2) out.delete(k);
  return out;
}

interface Fig { el: HTMLElement; img: HTMLImageElement; cap: HTMLElement; ids: readonly Id[]; sig: unknown[]; url: string | null; ver: number; timer: ReturnType<typeof setTimeout> | undefined; pending: Promise<void> | null; done?: () => void }

export class DocDiagrams {
  private readonly figs = new Map<Id, Fig>();
  constructor(private readonly e: Engine, private readonly host: DiagramHost | undefined,
    private readonly ui: { open?(id: Id): void; menu?(ids: readonly Id[], x: number, y: number): void }) {}

  /** 묶음 그림 요소 — 바뀌었으면 다시 그리기를 예약한다 */
  el(gid: Id, ids: readonly Id[]): HTMLElement {
    const e = this.e, inside = new Set(ids);
    const arrows = [...e.arrows()].filter(isBound).filter((a) => inside.has(a.from.blockId) && inside.has(a.to.blockId));
    const sig = [...ids.map((id) => e.getBlock(id)), ...ids.flatMap((id) => e.contentsOf(id)), ...arrows, e.note.groups?.[gid]?.name, e.note.groups?.[gid]?.bracket];
    let f = this.figs.get(gid);
    if (!f) {
      const el = Object.assign(document.createElement('figure'), { className: 'dn-doc-item dn-doc-diagram', title: '캔버스의 도식 — 두 번 누르면 캔버스에서 고쳐요' });
      el.dataset.group = gid;
      const img = document.createElement('img');
      img.draggable = false;
      const cap = Object.assign(document.createElement('figcaption'), { className: 'dn-doc-diagram-cap' });
      el.append(img, cap);
      const fig: Fig = { el, img, cap, ids, sig: [], url: null, ver: 0, timer: undefined, pending: null };
      el.addEventListener('dblclick', (ev) => { ev.stopPropagation(); ev.preventDefault(); this.ui.open?.(fig.ids[0]!); });
      el.addEventListener('contextmenu', (ev) => { if (!this.ui.menu || ev.shiftKey) return; ev.preventDefault(); ev.stopPropagation(); this.ui.menu(fig.ids, ev.clientX, ev.clientY); });
      f = fig;
      this.figs.set(gid, f);
    }
    f.ids = ids;
    const name = groupName(e, gid, ids);
    if (f.cap.textContent !== name) f.cap.textContent = name;
    f.img.alt = `도식: ${name}`;
    if (sig.length !== f.sig.length || sig.some((x, i) => x !== f!.sig[i])) { f.sig = sig; this.schedule(f); }
    return f.el;
  }

  private schedule(f: Fig): void {
    clearTimeout(f.timer);
    f.done?.(); // 미룬 그리기는 끝난 것으로 — 기다리던 쪽이 멈추지 않게
    f.pending = new Promise((done) => { f.done = done; f.timer = setTimeout(() => { void this.draw(f).finally(done); }, f.url ? 250 : 0); });
  }

  private async draw(f: Fig): Promise<void> {
    if (!this.host) return;
    const ver = ++f.ver;
    const blob = await this.host(f.ids).catch(() => null);
    if (ver !== f.ver || ![...this.figs.values()].includes(f)) return;
    f.el.classList.toggle('dn-missing', !blob);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const probe = new Image();
    probe.src = url;
    await probe.decode().catch(() => {});
    if (ver !== f.ver) { URL.revokeObjectURL(url); return; }
    if (f.url) URL.revokeObjectURL(f.url);
    f.url = url;
    f.img.src = url;
    f.img.style.width = probe.naturalWidth ? `${Math.round(probe.naturalWidth / 2)}px` : ''; // 2배로 그린 그림 — 화면 크기는 절반 (넓으면 CSS가 줄인다)
  }

  /** 그리는 중인 그림이 다 그려질 때까지 (인쇄 · PDF 전에) */
  async ready(): Promise<void> { await Promise.all([...this.figs.values()].map((f) => f.pending)); }

  /** 이번에 안 쓴 묶음 그림은 뗀다 */
  sweep(used: ReadonlySet<Id>): void {
    for (const [k, f] of this.figs) {
      if (used.has(k)) continue;
      clearTimeout(f.timer);
      f.done?.();
      f.ver++;
      if (f.url) URL.revokeObjectURL(f.url);
      f.el.remove();
      this.figs.delete(k);
    }
  }
}
