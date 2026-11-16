// 발표 모드 층 (GAP #21 — 노션 발표 · Ctrl+Alt+P): 지금 노트를 장면별로 화면 가득(engine-dom present.ts).
// 문서 뷰에서 시작하면 캔버스로 바꿔 발표한다 — 도식(상자 · 화살표 · 묶음 모양)이 그대로 보이게. 끝나면 보기 전용을 원래대로.
// 층 순서: … → ws-move → 여기 → ws-todos
import { presentSlides } from '@dn/engine-core';
import { startPresent, type Presenting } from '@dn/engine-dom';
import { MoveLayer } from './ws-move';

export abstract class PresentLayer extends MoveLayer {
  private presenting: Presenting | null = null;
  get isPresenting(): boolean { return !!this.presenting; }

  present(): void {
    const o = this.open;
    if (!o || this.presenting) return;
    if (this.state.viewMode === 'doc') this.setViewMode('canvas');
    const slides = presentSlides(o.engine);
    if (!slides.length) { this.toast('발표할 내용이 없어요 — 상자를 먼저 만들어 주세요.'); return; }
    this.set({ blockMenu: null, insertMenu: null, noteMenu: null, arrowMenu: null, chip: null });
    this.presenting = startPresent(o.view, slides, () => { this.presenting = null; this.syncReadOnly(); });
  }
}
