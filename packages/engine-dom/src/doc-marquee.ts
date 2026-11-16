// 문서 뷰 끌어 고르기 (캔버스 끌어 고르기 · 노션처럼): 글 밖 빈 곳(여백 · 항목 사이 · 종이 바깥)을 누른 채 끌면 파란 사각형,
// 사각형에 걸친 항목들을 한 범위로 고른다(doc-select — 지우기 · 복사 · 묶기 Ctrl+G …). 끌지 않고 떼면 원래대로(click).
import type { DocView } from './doc-view';

/** 이만큼(화면 px) 움직여야 끌기 — 그보다 작으면 누르기 */
const THRESHOLD = 5;

export class DocMarquee {
  private start: { x: number; y: number; ev: MouseEvent } | null = null;
  private box: HTMLDivElement | null = null;
  private readonly ac = new AbortController();

  /** click: 끌지 않고 뗐을 때 할 일 (맨 아래면 새 문단 · 사이면 가까운 글 칸) */
  constructor(private readonly dv: DocView, private readonly click: (ev: MouseEvent) => void) {
    const signal = this.ac.signal;
    window.addEventListener('mousemove', (e) => this.move(e), { signal });
    window.addEventListener('mouseup', () => this.up(), { signal });
  }

  /** 빈 곳 mousedown (DocView.onDown) */
  begin(ev: MouseEvent): void {
    if (ev.button !== 0) return;
    this.start = { x: ev.clientX, y: ev.clientY, ev };
  }


  private move(ev: MouseEvent): void {
    const s = this.start;
    if (!s) return;
    if (!(ev.buttons & 1)) { this.up(); return; }
    if (!this.box) {
      if (Math.hypot(ev.clientX - s.x, ev.clientY - s.y) < THRESHOLD) return;
      this.dv.word.close();
      this.box = Object.assign(document.createElement('div'), { className: 'dn-doc-marquee' });
      document.body.append(this.box);
    }
    // 끝에 닿으면 문서를 굴린다 (긴 문서에서 아래까지 고르기)
    const root = this.dv.root.getBoundingClientRect();
    if (ev.clientY > root.bottom - 24) this.dv.root.scrollTop += 16;
    else if (ev.clientY < root.top + 24) this.dv.root.scrollTop -= 16;
    const x0 = Math.min(s.x, ev.clientX), x1 = Math.max(s.x, ev.clientX);
    const y0 = Math.min(s.y, ev.clientY), y1 = Math.max(s.y, ev.clientY);
    Object.assign(this.box.style, { left: `${x0}px`, top: `${y0}px`, width: `${x1 - x0}px`, height: `${y1 - y0}px` });
    // 걸친 항목: 세로로 겹치고 가로로도 겹치는 것 (여백에서 시작해 글 쪽으로 끌면 가로는 금방 겹친다)
    const items = [...this.dv.page.querySelectorAll<HTMLElement>('.dn-doc-item')];
    const hit = items.map((el, i) => ({ r: el.getBoundingClientRect(), i })).filter(({ r }) => r.bottom > y0 && r.top < y1 && r.right > x0 && r.left < x1).map((h) => h.i);
    if (hit.length) this.dv.select?.select(Math.min(...hit), Math.max(...hit));
    else this.dv.select?.clear();
  }

  private up(): void {
    const s = this.start;
    this.start = null;
    if (!s) return;
    if (this.box) { this.box.remove(); this.box = null; return; }
    this.click(s.ev);
  }

  destroy(): void { this.ac.abort(); this.box?.remove(); }
}
