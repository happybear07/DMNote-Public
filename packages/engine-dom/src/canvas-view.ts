// 캔버스 뷰: 하이브리드 렌더러(DOM 블록 + Canvas2D 레이어) + 입력 컨트롤러 (ENGINE 8 · 9장, FR-005 · 010~016 · 064~065).
// 레이어 (아래 → 위): under 캔버스(도트 그리드 · 화살표, D4) → 블록 DOM(래퍼 transform 하나) → over 캔버스(선택 · 핸들 · 미리보기).
// 팬 · 줌은 래퍼 transform만 바꾸고 블록 개별 스타일은 건드리지 않는다.
// 이 클래스는 상태 · 공개 API · 렌더 순서만 갖고, 그리기 · 입력 · 블록 DOM · 편집은 역할별 모듈 함수가 맡는다.
import {
  applyMeasuredHeights, deleteEntities, duplicateBlocks, fitRect, nextZoomStep, screenToWorld, setBlockColor,
  unionRects, visibleWorldRect, worldToScreen, zoomAt, convertBoxes,
  type ArrowStyle, type BoxKind, type Camera, type Engine, type Id, type Rect, type TextDoc, type Vec2,
  MAX_ZOOM, MIN_ZOOM,
} from '@dn/engine-core';
import { refreshNoteLinks, type FormatCommand } from '@dn/text-pm';
import { bindInput } from './bind-input';
import { animateTo } from './camera';
import { cancelConnect } from './a11y';
import { handleChange } from './changes';
import { LOD_ZOOM } from './constants';
import { createBlockAt } from './create';
import { drawOver } from './draw-over';
import { syncSourceLink } from './source-link';
import { drawUnder } from './draw-under';
import { editArrowLabel, endEditing, formatSelection, startEditing } from './editing';
import { closeEditor, createGrip, measureText, syncMounts } from './mount';
import type { CellEdit } from './table-edit';
import type { TabEdit } from './tabs-render';
import { exportPng, type PngOptions } from './snapshot';
import { readTheme, type CanvasTheme } from './theme';
import { applyPaperColor } from './paper';
import { clampSheetCam, sheetFitCam } from './sheet-view';
import { previewRectOf } from './groups-view';
import { createInk, drawInk, type InkState } from './ink-layer';
import type { BlockMenuRequest, CanvasUiState, CanvasViewOptions, EditAt, Gesture, Mounted, Tool } from './types';

export { BLOCK_COLORS } from './constants';
export type { AiEditRequest, ArrowMenuRequest, BlockMenuRequest, CanvasNotice, CanvasUiState, CanvasViewOptions, CommentRequest, InsertMenuRequest, Tool } from './types';

export class CanvasView {
  readonly engine: Engine;
  readonly root: HTMLElement;
  /** @internal */ readonly under: HTMLCanvasElement;
  /** @internal */ readonly over: HTMLCanvasElement;
  /** @internal */ readonly world: HTMLDivElement;
  /** @internal */ readonly mounted = new Map<Id, Mounted>();
  private readonly resizeObs: ResizeObserver;
  /** @internal */ readonly blockObs: ResizeObserver;
  private readonly unsub: () => void;
  private readonly unbindInput: () => void;
  /** @internal */ readonly onBlockMenu?: (r: BlockMenuRequest) => void;
  /** @internal 앱이 준 옵션 전체 — 새 콜백(넣기 메뉴 · 콘텐츠 열기 등)은 여기서 읽는다 */
  readonly host: CanvasViewOptions;
  /** @internal Ctrl+Shift+V로 시작한 붙여넣기 — paste 이벤트에는 Shift 정보가 없어 keydown에서 기억한다 */
  plainPaste = false;
  /** @internal */ lastPointer: Vec2 | null = null;
  /** @internal 블록 핸들 (⋮⋮) — 화면 좌표에 떠 있는 DOM 하나를 호버한 블록 옆으로 옮겨 쓴다 */
  readonly grip: HTMLDivElement;
  /** @internal */ gripId: Id | null = null;
  /** 보기 전용 — 다른 탭이 편집 중 · 새 버전 노트 · 읽기 모드(FR-085) */
  readOnly: boolean;

  /** @internal */ cam: Camera;
  /** @internal */ size = { w: 0, h: 0 };
  /** 마지막으로 누른 포인터 종류 — 터치 · 펜이면 손잡이 · 누르는 범위를 키운다 (TABLET-CHECK T2 · T6) */
  pointerKind: string = 'mouse';
  /** @internal */ dpr = 1;
  /** @internal */ _tool: Tool = 'select';
  /** Esc · 상자를 만든 뒤 돌아가는 선택 도구 — 앱이 고른 선택 방식 (필기 뺀 콘텐츠 · 필기만 · 둘 다) */
  homeTool: 'select' | 'lasso' | 'both' = 'select';
  /** 새로 긋는 화살표 모양 — 앱이 도구 막대에서 고른 것(화살표 도구 · 상자 끝에서 끌기 · 키보드 C 연결). 없으면 관계 기본 */
  arrowStyle: ArrowStyle | undefined = undefined;
  readonly selBlocks = new Set<Id>();
  readonly selArrows = new Set<Id>();
  /** @internal */ hover: Id | null = null;
  /** @internal */ editingId: Id | null = null;
  /** @internal 표 셀 편집 중 (editingId도 그 블록) */ cellEdit: CellEdit | null = null;
  /** @internal 탭 블록 글 편집 중 (tabs-render.ts) */ tabEdit: TabEdit | null = null;
  /** @internal */ gesture: Gesture = { k: 'none' };
  /** @internal */ readonly pointers = new Map<number, Vec2>();
  /** @internal */ space = false;
  /** @internal */ labelInput: HTMLInputElement | null = null;

  private frame = 0;
  /** @internal */ dirtyCamera = true;
  /** @internal */ dirtyIds = new Set<Id>();
  /** @internal */ dirtyAll = true;
  /** @internal */ pendingHeights = new Map<Id, number>();
  private readonly uiListeners = new Set<(s: CanvasUiState) => void>();
  private lastUi = '';
  /** @internal */ anim = 0;
  private pendingFit = false;
  private pendingFocus: Id | null = null;
  /** 잉크 레이어 · 도구 상태 (FR-034~036) — 조작은 ink-input.ts의 함수로 */
  readonly ink: InkState;
  /** @internal 캔버스로 그리는 색 (FR-086) — 테마가 바뀌면 refreshTheme */
  theme: CanvasTheme;
  /** @internal */ readonly titleCache = new Map<Id, { doc: unknown; title: string }>();

  /** 휠 동작 (D7 · FR-011): pan(기본) — 휠 = 팬, Ctrl/⌘+휠 = 줌 · zoom — 휠 = 줌, Shift+휠 = 가로 팬 (마우스 사용자용 설정) */
  wheelMode: 'pan' | 'zoom' = 'pan';

  constructor(opts: CanvasViewOptions) {
    this.engine = opts.engine;
    this.root = opts.container;
    this.onBlockMenu = opts.onBlockMenu;
    this.host = opts;
    this.wheelMode = opts.wheelMode ?? 'pan';
    this.readOnly = opts.readOnly ?? false;
    this.cam = opts.camera ?? { x: -80, y: -60, zoom: 1 };
    applyPaperColor(opts.container, this.engine.note.paper?.color); // 바탕색 토큰부터 — 2D 색은 그다음에 읽는다
    this.theme = readTheme(opts.container);

    const root = this.root;
    root.classList.add('dn-canvas');
    root.tabIndex = 0;
    this.under = document.createElement('canvas');
    this.under.className = 'dn-layer dn-under';
    this.world = document.createElement('div');
    this.world.className = 'dn-world';
    this.over = document.createElement('canvas');
    this.over.className = 'dn-layer dn-over';
    this.grip = createGrip();
    root.append(this.under, this.world, this.over, this.grip);
    this.ink = createInk(root, this.over);

    this.resizeObs = new ResizeObserver(() => this.measureViewport());
    this.resizeObs.observe(root);
    this.blockObs = new ResizeObserver((entries) => {
      for (const en of entries) {
        const id = (en.target as HTMLElement).dataset.id;
        if (id) this.pendingHeights.set(id, (en.target as HTMLElement).offsetHeight);
      }
      this.schedule();
    });
    this.unsub = this.engine.subscribe((e) => handleChange(this, e));

    this.unbindInput = bindInput(this);
    this.measureViewport();
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    cancelAnimationFrame(this.anim);
    for (const m of this.mounted.values()) closeEditor(m);
    this.unsub();
    this.resizeObs.disconnect();
    this.blockObs.disconnect();
    this.unbindInput();
    this.root.replaceChildren();
    this.root.classList.remove('dn-canvas');
  }

  // ───────── 공개 API ─────────
  get camera(): Camera { return this.cam; } get tool(): Tool { return this._tool; }

  /** 카메라 지정. 진행 중인 이동 애니메이션은 취소한다 — 사용자가 손댄 쪽이 이긴다. */
  setCamera(c: Camera): void { cancelAnimationFrame(this.anim); this.applyCamera(c); }

  /** @internal */
  applyCamera(c: Camera): void {
    // 확대는 25% ~ 400%, 화면은 종이(A4) · 보드 둘레 안으로
    const prev = this.cam;
    this.cam = clampSheetCam(this, { ...c, zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, c.zoom)) });
    this.dirtyCamera = true;
    // 화면이 움직이면 화면 좌표로 띄운 것(화살표 라벨 칸 · 고르기 막대 · 슬래시 메뉴)은 거둔다 — 제자리에 떠 있지 않게 (CQ-011)
    if (prev.x !== this.cam.x || prev.y !== this.cam.y || prev.zoom !== this.cam.zoom) {
      this.labelInput?.blur();
      if (this.editingId) this.mounted.get(this.editingId)?.editor?.hidePopups();
    }
    this.host.onCameraChange?.(this.cam);
    this.schedule();
    this.notifyUi();
  }

  setTool(t: Tool): void {
    this._tool = t;
    for (const x of ['select', 'block', 'title', 'arrow', 'hand', 'pen', 'highlighter', 'eraser', 'lasso', 'both']) this.root.classList.toggle(`dn-tool-${x}`, x === t);
    if (t !== 'lasso' && t !== 'both' && this.ink.selected.size) this.ink.selected.clear();
    this.notifyUi();
  }

  zoomStep(dir: 1 | -1): void { this.zoomTo(nextZoomStep(this.cam.zoom, dir)); }

  zoomTo(z: number): void {
    this.setCamera(zoomAt(this.cam, { x: this.size.w / 2, y: this.size.h / 2 }, z));
  }

  /** 전체 맞춤 (FR-012). 블록이 없으면 기본 줌 · 원점. `animate`면 250ms로 이동. */
  fit(animate = false): void {
    // 창이 숨겨져 크기가 0이면 맞춤 계산이 최소 줌으로 망가진다 — 크기가 생길 때까지 미룬다
    if (this.size.w < 1 || this.size.h < 1) { this.pendingFit = true; return; }
    this.pendingFit = false;
    const u = unionRects([...this.engine.blocks()]);
    let c = sheetFitCam(this) ?? (u ? fitRect(u, this.size) : { x: -80, y: -60, zoom: 1 });
    // 가장 작게 줄여도 다 안 들어가면 가운데(빈 곳일 수 있다) 대신 왼쪽 위 블록부터 보인다 (CQ-020)
    if (u && !sheetFitCam(this) && c.zoom <= MIN_ZOOM + 1e-6) c = { zoom: MIN_ZOOM, x: u.x - 40 / MIN_ZOOM, y: u.y - 40 / MIN_ZOOM };
    if (animate) this.animateTo(c); else this.setCamera(c);
  }

  /** 테마가 바뀐 뒤 (FR-086) — 캔버스 색을 다시 읽고 전부 다시 그린다 */
  refreshTheme(): void { this.theme = readTheme(this.root); this.ink.staticSig = ''; this.dirtyAll = true; this.schedule(); }

  /** 읽기 모드 (FR-085) 등으로 보기 전용 켜고 끄기 — 켜면 편집을 끝내고 핸들을 숨긴다 */
  setReadOnly(on: boolean): void {
    if (on) { this.endEditing(); cancelConnect(this, true); }
    this.readOnly = on;
    this.root.classList.toggle('dn-readonly', on);
    this.schedule(); this.notifyUi();
  }

  exportPng(opts: PngOptions = {}): Promise<Blob | null> { return exportPng(this, opts); } // PNG (FR-129) — ids 없으면 전체

  refreshNoteLinks(): void { refreshNoteLinks(this.world); } // 노트 제목이 바뀌면 화면의 노트 링크 글자를 다시 (FR-080)

  /** 특정 블록으로 이동 (FR-012) — 300ms 이내 애니메이션 */
  focusBlock(id: Id): void {
    const r = this.engine.blockRect(id);
    if (!r) return;
    // 막 연 노트는 화면 크기를 아직 모른다 — 재고 나서 옮긴다 (안 그러면 최소 줌으로 맞춰진다)
    if (this.size.w < 1 || this.size.h < 1) { this.pendingFocus = id; this.select([id]); return; }
    this.pendingFocus = null;
    // 여백은 화면의 짧은 변 기준 — 넓은 화면에서 폭 기준 여백을 높이에도 쓰면 줌이 바닥까지 내려간다
    this.animateTo(fitRect(r, this.size, Math.max(64, Math.min(this.size.w, this.size.h) / 4)));
    this.select([id]);
  }

  /** 카메라 이동 애니메이션. 줌은 로그 공간에서 보간해야 확대 · 축소 속도가 일정하게 보인다. */
  animateTo(target: Camera, ms = 250): void { animateTo(this, target, ms); }

  get selectedBlocks(): Id[] { return [...this.selBlocks]; }

  // 블록 메뉴 동작 (FR-024) — 선택된 블록 전체에 적용
  duplicateSelection(): void {
    const r = duplicateBlocks(this.engine, [...this.selBlocks], 24, { dock: true });
    if (r.ok) this.select(r.value);
  }

  deleteSelection(): void {
    if (this.selBlocks.size || this.selArrows.size) deleteEntities(this.engine, [...this.selBlocks], [...this.selArrows]);
  }

  setSelectionColor(color: string | undefined): void { setBlockColor(this.engine, [...this.selBlocks], color); }

  /** 선택 블록을 제목 상자 / 내용 상자로 바꾼다 (블록 메뉴). undo 한 번. */
  convertSelection(kind: BoxKind): void {
    this.endEditing();
    convertBoxes(this.engine, [...this.selBlocks], kind);
  }

  /** 선택 블록의 텍스트 전체를 한 형식으로 (텍스트 · 제목 · 목록 · 인용). undo 한 번. */
  formatSelection(cmd: FormatCommand): void { formatSelection(this, cmd); }

  undo(): void { this.endEditing(); this.engine.undo(); this.notifyUi(); }
  redo(): void { this.endEditing(); this.engine.redo(); this.notifyUi(); }

  onUi(fn: (s: CanvasUiState) => void): () => void {
    this.uiListeners.add(fn);
    fn(this.uiState());
    return () => { this.uiListeners.delete(fn); };
  }

  /** 화면 중앙에 새 블록 (툴바 버튼용). */
  addBlockAtCenter(kind: BoxKind = 'text'): void {
    if (this.readOnly) return;
    const c = screenToWorld(this.cam, { x: this.size.w / 2 - 130, y: this.size.h / 2 - 42 });
    createBlockAt(this, c, kind);
  }

  /** 블록의 화면 위치 (캔버스 루트 기준 px) — 앱이 블록 옆에 칩 · 카드를 띄울 때 */
  blockScreenRect(id: Id): Rect | null {
    const b = this.engine.getBlock(id);
    if (!b) return null;
    const p = this.toScreen(b);
    return { x: p.x, y: p.y, w: b.w * this.cam.zoom, h: b.h * this.cam.zoom };
  }

  /** 월드 사각형이 보이도록 이동 (AI 결과 적용 후 등, FR-012) */
  revealRect(r: Rect): void {
    this.animateTo(fitRect(r, this.size, 80));
  }

  /**
   * 문서를 주어진 폭의 상자로 그렸을 때 높이 (AI 배치 DomMeasurer, ENGINE 10.3). 실제 블록과 같은 DOM 구조로 잰다.
   * `kind`: 'text' 내용 상자(기본) · 'title' 제목 상자
   */
  measureText(doc: TextDoc, w: number, kind: BoxKind = 'text'): number {
    return measureText(this, doc, w, kind);
  }

  // ───────── 동작 ─────────
  select(ids: readonly Id[]): void {
    this.selBlocks.clear();
    this.selArrows.clear();
    if (this._tool === 'both') this.ink.selected.clear();
    for (const id of ids) this.selBlocks.add(id);
    this.schedule();
    this.notifyUi();
  }

  /** 화살표 라벨을 그 자리에서 고치기 (화살표 메뉴 · 두 번 누르기) */
  editArrowLabel(id: Id): void { editArrowLabel(this, id); }

  /** @internal */
  selectArrow(id: Id): void {
    this.selBlocks.clear();
    this.selArrows.clear();
    this.selArrows.add(id);
    this.schedule();
    this.notifyUi();
  }

  /**
   * 블록 텍스트 편집 시작 — 편집 중인 칸 하나에만 ProseMirror 에디터를 띄운다 (ENGINE 5.6).
   * `at`: 화면 좌표면 그 자리의 칸, 'start'면 첫 칸 맨 앞, 'end'면 마지막 칸 끝. `part`로 칸을 직접 지정할 수 있다.
   */
  startEditing(id: Id, at: EditAt = 'end', part?: 'title' | 'body'): void {
    startEditing(this, id, at, part);
  }

  endEditing(): void {
    endEditing(this);
  }

  // ───────── 상태 · 이벤트 ─────────
  private uiState(): CanvasUiState {
    return {
      zoom: this.cam.zoom, tool: this._tool, selectedBlocks: this.selBlocks.size, selectedArrows: this.selArrows.size,
      ink: { color: this.ink.color, hlColor: this.ink.hlColor, colors: [...this.ink.colors], hlColors: [...this.ink.hlColors], width: this.ink.width, hlWidth: this.ink.hlWidth, pen: this.ink.pen, hl: this.ink.hl, show: this.ink.show, showBlocks: this.ink.showBlocks, penOnly: this.ink.penOnly, selected: this.ink.selected.size },
      editing: this.editingId !== null, canUndo: this.engine.canUndo(), canRedo: this.engine.canRedo(),
    };
  }

  /** @internal */
  notifyUi(): void {
    const s = this.uiState();
    const key = JSON.stringify(s);
    if (key === this.lastUi) return;
    this.lastUi = key;
    for (const fn of this.uiListeners) fn(s);
  }

  private measureViewport(): void {
    const r = this.root.getBoundingClientRect(), old = this.size;
    // 화면 회전 · 창 크기 · 옆 패널 (FR-155): 보던 가운데가 그대로 가운데에
    this.size = { w: r.width, h: r.height };
    if (old.w >= 1 && old.h >= 1 && r.width >= 1 && r.height >= 1 && (old.w !== r.width || old.h !== r.height)) this.applyCamera({ ...this.cam, x: this.cam.x + (old.w - r.width) / 2 / this.cam.zoom, y: this.cam.y + (old.h - r.height) / 2 / this.cam.zoom });
    if (this.pendingFit && r.width >= 1 && r.height >= 1) queueMicrotask(() => this.fit());
    if (this.pendingFocus && r.width >= 1 && r.height >= 1) { const id = this.pendingFocus; queueMicrotask(() => this.focusBlock(id)); }
    this.dpr = window.devicePixelRatio || 1;
    // 같은 값이라도 width를 넣으면 그림이 지워진다 — 바뀔 때만. 잉크는 '바뀐 게 있을 때만' 그리니 다시 그리게 (AT-019: 열자마자 다시 재면 필기가 사라졌다)
    for (const c of [this.under, this.ink.canvas, this.over]) { const w = Math.max(1, Math.round(r.width * this.dpr)), h = Math.max(1, Math.round(r.height * this.dpr)); if (c.width !== w || c.height !== h) { c.width = w; c.height = h; } }
    this.ink.staticSig = ''; this.dirtyCamera = true; this.schedule();
  }

  /** @internal */
  schedule(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.render(); });
  }

  // ───────── 렌더 ─────────
  private render(): void {
    if (this.pendingHeights.size) {
      const h = this.pendingHeights;
      this.pendingHeights = new Map();
      applyMeasuredHeights(this.engine, h);
    }
    if (this.dirtyCamera) {
      const c = this.cam;
      this.world.style.transform = `scale(${c.zoom}) translate(${-c.x}px, ${-c.y}px)`;
    }
    syncMounts(this);
    this.dirtyCamera = false;
    this.dirtyAll = false;
    this.dirtyIds.clear();
    drawUnder(this);
    drawInk(this);
    drawOver(this);
    syncSourceLink(this);
  }

  /** @internal */
  visibleRect(): Rect {
    const r = visibleWorldRect(this.cam, this.size);
    const m = Math.max(r.w, r.h) * 0.25;
    return { x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m };
  }

  /** @internal */
  get lod(): boolean { return this.cam.zoom < LOD_ZOOM; }

  /** @internal */
  previewRect(id: Id): Rect | undefined { return previewRectOf(this, id); } // 끌기 · 크기 조절 · 블록 크기 조절 중 자리

  /** @internal */
  ctx(c: HTMLCanvasElement): CanvasRenderingContext2D {
    const ctx = c.getContext('2d')!; ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); ctx.clearRect(0, 0, this.size.w, this.size.h); return ctx;
  }

  /** @internal */
  toScreen(p: Vec2): Vec2 { return worldToScreen(this.cam, p); }
}
