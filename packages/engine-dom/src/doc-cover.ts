// 문서 보기 첫 쪽 = 표지 (11/09): 노트에 표지 쪽(note.coverPage)이 있으면 문서 맨 앞에 둔다 — 쪽 보기면 첫 쪽 본문 칸을 다 쓰고,
// 본문은 다음 쪽부터(doc-view isBreak). 그림은 앱이 캔버스로 그려 준다(host.image — 표지 영역 exportPng). data URL로 바꿔 인쇄 · PDF에도 그대로.
// 표지가 비었으면 제목 쪽(노트 제목 · 만든 날). 두 번 누르면 캔버스의 표지 쪽으로(host.open).
import { coverItems, coverRect } from '@dn/engine-core';
import type { DocView } from './doc-view';

export interface DocCoverHost { image(): Promise<Blob | null>; open(): void }

/** 그림 → data URL (못 읽으면 null) — 앱의 서재 표지 썸네일(cover-flow.ts)도 쓴다 */
export const blobToDataUrl = (blob: Blob) => new Promise<string | null>((res) => {
  const r = new FileReader();
  r.onload = () => res(typeof r.result === 'string' ? r.result : null);
  r.onerror = () => res(null);
  r.readAsDataURL(blob);
});

export class DocCover {
  private el: HTMLElement | null = null;
  private sig = '';
  private ver = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private readonly dv: DocView) {}

  /** 표지 요소 — 표지가 없으면 null (있던 요소는 뺀다). 표지 안이 바뀌었으면 다시 그린다 */
  element(): HTMLElement | null {
    const e = this.dv.opts.engine, cr = coverRect(e.note);
    if (!cr) { clearTimeout(this.timer); this.el?.remove(); this.el = null; this.sig = ''; return null; }
    if (!this.el) {
      const el = this.el = Object.assign(document.createElement('section'), { className: 'dn-doc-cover' });
      el.title = '표지 — 두 번 누르면 캔버스의 표지 쪽으로';
      el.addEventListener('dblclick', (ev) => { ev.preventDefault(); ev.stopPropagation(); this.dv.opts.cover?.open(); });
    }
    const { blocks, strokes } = coverItems(e);
    const empty = !blocks.length && !strokes.length;
    const title = e.note.title.trim() || this.dv.opts.title?.() || '제목 없음';
    const sig = JSON.stringify([cr, empty, empty ? title : '', blocks.map((id) => [e.getBlock(id), e.contentsOf(id)]), strokes.map((id) => e.getStroke(id)), e.note.paper]);
    if (sig !== this.sig) { this.sig = sig; this.fill(empty, title); }
    return this.el;
  }

  private fill(empty: boolean, title: string): void {
    const el = this.el!, host = this.dv.opts.cover;
    clearTimeout(this.timer);
    const ver = ++this.ver;
    if (empty || !host) {
      const box = Object.assign(document.createElement('div'), { className: 'dn-doc-cover-title' });
      box.append(Object.assign(document.createElement('h1'), { textContent: title }),
        Object.assign(document.createElement('p'), { textContent: new Date(this.dv.opts.engine.note.createdAt).toLocaleDateString('ko-KR') }));
      el.replaceChildren(box);
      return;
    }
    // 고치는 동안은 조금 모아서 다시 그린다 (처음은 바로)
    this.timer = setTimeout(async () => {
      const blob = await host.image().catch(() => null);
      const url = blob && ver === this.ver ? await blobToDataUrl(blob) : null;
      if (!url || ver !== this.ver) return;
      el.replaceChildren(Object.assign(document.createElement('img'), { src: url, alt: '표지', draggable: false }));
    }, el.querySelector('img') ? 400 : 0);
  }
}
