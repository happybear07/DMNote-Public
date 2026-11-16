// 워크스페이스 할 일 · 홈 층 (FR-137 · 홈 대시보드 09): 모든 노트의 할 일 모으기 · 여기서 체크하면 원래 노트에 반영 · 시작 화면.
// 표지 쪽 (11/03): 만들기 · 지우기 · 그림 붙이기, 바뀌면 썸네일을 목록 정보에 (홈 책장의 책 표지, cover-flow.ts).
// 층 순서: … → ws-import → ws-move → ws-present → 여기 → workspace.ts
import { addCoverPage, coverItems, coverRect, editTexts, fitRect, groupMembers, isTextContent, removeCoverPage, renameGroup, ungroupBlocks, type Engine } from '@dn/engine-core';
import { applyDocZoom, focusGroup, insertBlock, isInsertKind, type DocView, type DocViewOptions, type DocZoom } from '@dn/engine-dom';
import type { OpenNote } from './ws-base';
import { readNote } from '@dn/storage-idb';
import { flipAttrSteps } from '@dn/text-pm';
import { collectTodos, type TodoItem } from './todos';
import { PresentLayer } from './ws-present';
import { displayTitle, NOTICE } from './ws-model';
import type { GraphEdge, GraphNode } from './graph';
import { pickFiles } from './pick-files';
import { collectReminders } from './reminders';
import { coverSig, placeCoverImage, renderCoverThumb } from './cover-flow';

export abstract class TodoLayer extends PresentLayer {
  // ───────── 문서 뷰를 워드처럼 (서식 막대 DocRibbon) ─────────
  /** 지금 문서 뷰 (서식 막대가 명령을 보낸다) */
  get docView(): DocView | null { return this.doc; }
  protected override docExtra(): Partial<DocViewOptions> {
    return {
      pages: this.docPagesOn(),
      // 오른쪽 클릭: 캔버스와 같은 블록 메뉴 — 메뉴는 캔버스 선택으로 일하므로 같은 상자를 고른다
      onBlockMenu: (blockMenu) => { this.view?.select(blockMenu.ids); this.set({ blockMenu, arrowMenu: null }); },
      title: () => { const m = this.state.notes.find((n) => n.id === this.state.currentId); return m ? displayTitle(m) : ''; }, // 머리글 · 바닥글 {제목}
      diagram: (ids) => this.view?.exportPng({ ids, scale: 2, pad: 12 }) ?? Promise.resolve(null), // '문서에서 그림으로' 묶음
      cover: { // 첫 쪽 표지 (doc-cover.ts) — 표지 쪽 영역을 그림으로, 두 번 누르면 캔버스의 표지로
        image: () => { const v = this.view, cr = v && coverRect(v.engine.note); return v && cr ? v.exportPng({ ids: coverItems(v.engine).blocks, region: cr, scale: 1.5, bg: v.theme.card }) : Promise.resolve(null); },
        open: () => this.addCover(),
      },
      word: {
        measure: (doc, w, kind) => this.view?.measureText(doc, w, kind) ?? 32,
        onUi: (docUi) => this.set({ docUi }),
        onSave: () => this.toast('자동으로 저장되고 있어요 — 따로 저장하지 않아도 돼요.'),
        insertImage: (at) => { if (this.view) insertBlock(this.view, 'image', { at }); },
        insertBlock: (kind, at, width) => (this.view && isInsertKind(kind) ? insertBlock(this.view, kind, { at, ...(width ? { width } : {}) }) : null),
        onNotice: (code) => this.toast(NOTICE[code]),
        onComments: (req) => this.openComments(req),
        onMoveBlocks: (ids) => this.openMoveTo(ids),
        onAiEdit: (req) => this.openAiEdit(req),
        openInCanvas: (id) => { this.setViewMode('canvas'); requestAnimationFrame(() => this.focusBlock(id)); },
      },
    };
  }
  /** 쪽 보기가 실제로 켜지는가 — 좁은 화면(종이 794px가 넘침) · 노트의 '문서 뷰 전체 폭'이면 종이 없이 */
  private docPagesOn(): boolean { return this.state.docPages && !this.state.look.page?.fullWidth && matchMedia('(min-width: 860px)').matches; }
  /** 쪽 보기 켜고 끄기 (설정에 저장) */
  setDocPages(on: boolean): void {
    this.set({ docPages: on });
    void this.meta.setSetting('docPages', on);
    this.syncDocPages();
  }
  /** 전체 폭 · 창 크기가 바뀌면 쪽 보기를 다시 맞춘다 (App) */
  syncDocPages(): void { this.doc?.setPages(this.docPagesOn()); this.syncDocZoom(); }
  /** 문서 뷰 확대 (상태 줄 · Ctrl+휠): 배율 · 쪽 너비 · 한 쪽 — 설정에 저장 */
  setDocZoom(z: DocZoom): void {
    this.set({ docZoom: z });
    void this.meta.setSetting('docZoom', z);
    this.syncDocZoom();
  }
  /** 지금 문서 뷰에 배율을 맞춘다 — 맞춤이면 칸 크기로 다시 센다 (창 · 사이드바 크기가 바뀔 때도) */
  syncDocZoom(): void {
    if (!this.doc) return;
    const now = applyDocZoom(this.doc, this.state.docZoom);
    if (now !== this.state.docZoomNow) this.set({ docZoomNow: now });
  }

  // 사이드바 블록 ▸ 콘텐츠 나무는 ws-side.ts (11/09)
  protected override afterOpen(o: OpenNote, writer: boolean): void {
    super.afterOpen(o, writer);
    o.offs.push(o.engine.subscribe(() => this.coverSoon(o)));
    this.coverSoon(o); // 열 때도 — 가져온 노트 · 다른 기기에서 바뀐 표지
  }
  protected override beforeClose(o: OpenNote): void {
    if (this.coverTimer) { clearTimeout(this.coverTimer); this.coverTimer = null; }
    super.beforeClose(o);
  }
  // ───────── 표지 쪽 (11/03) ─────────
  private coverTimer: ReturnType<typeof setTimeout> | null = null;
  /** 노트 id → 마지막으로 그린 표지 모양 */
  private readonly coverDone = new Map<string, string>();
  private coverSoon(o: OpenNote): void {
    if (this.coverTimer) clearTimeout(this.coverTimer);
    this.coverTimer = setTimeout(() => void this.coverThumb(o), 1200);
  }
  /** 표지가 바뀌었으면 썸네일을 다시 그려 목록 정보에 — 잠긴 노트 · 표지 없는 노트는 지운다 */
  private async coverThumb(o: OpenNote): Promise<void> {
    if (this.open !== o) return;
    if (o.view.editingId) { this.coverSoon(o); return; } // 글을 고치는 중 — 그리면 편집이 끝난다
    const id = o.engine.note.id, meta = this.state.notes.find((n) => n.id === id);
    const sig = this.store.isLocked(id) ? '' : coverSig(o.engine);
    if (sig === this.coverDone.get(id) && (!sig || meta?.coverThumb)) return;
    this.coverDone.set(id, sig);
    const thumb = sig ? await renderCoverThumb(o.view) : null;
    if (this.open !== o || (thumb ?? undefined) === meta?.coverThumb) return;
    await this.meta.patch(id, { coverThumb: thumb ?? undefined });
    await this.refreshList();
  }
  /** 표지 쪽 만들기 (있으면 거기로) — 화면을 표지에 맞춘다 */
  addCover(): void {
    const v = this.view;
    if (!v || v.readOnly) return;
    if (this.state.viewMode === 'doc') this.setViewMode('canvas');
    const r = addCoverPage(v.engine);
    if (!r.ok) return;
    const c = fitRect({ x: r.value.x - 60, y: r.value.y - 60, w: r.value.w + 120, h: r.value.h + 120 }, v.size);
    v.animateTo({ ...c, zoom: Math.min(c.zoom, 1) });
    v.root.focus({ preventScroll: true });
  }
  removeCover(): void {
    const v = this.view;
    if (!v || v.readOnly || !coverRect(v.engine.note)) return;
    if (removeCoverPage(v.engine).ok) this.toast('표지 쪽을 지웠어요. 표지에 그린 것 · 놓은 것도 함께 지웠어요.', { label: '실행 취소', run: () => this.view?.undo() });
  }
  /** 표지에 그림 붙이기 — 표지가 없으면 만들고, 그림은 표지 안에 비율대로 가장 크게 */
  pickCoverImage(): void {
    void pickFiles('image/*').then((f) => { if (f?.[0]) void this.setCoverImage(f[0]); });
  }
  async setCoverImage(f: File): Promise<void> {
    const o = this.open;
    if (!o || !this.canWrite(o) || !f.type.startsWith('image/')) return;
    let w = 0, h = 0;
    try { const bmp = await createImageBitmap(f); w = bmp.width; h = bmp.height; bmp.close(); } catch { this.toast(`${f.name}: 이미지를 읽지 못했어요.`); return; }
    const hash = await this.files.put(f, { w, h });
    if (this.open !== o) return;
    this.addCover();
    const id = placeCoverImage(o.engine, hash, w, h, f.name.replace(/\.[^.]+$/, ''));
    if (id) o.view.select([id]);
  }

  /** 사이드바 블록 → 그 블록으로 이동 (문서 뷰면 캔버스로) */
  focusNoteBlock(id: string): void {
    if (!this.view) return;
    if (this.state.viewMode === 'doc') this.setViewMode('canvas');
    focusGroup(this.view, id);
    this.view.root.focus({ preventScroll: true });
  }
  /** 다른 노트의 블록 → 그 노트를 열고 그 블록으로 (내 페이지 '이어서 쓰기' 칩) */
  async openNoteBlock(noteId: string, blockId: string): Promise<void> {
    if (this.state.currentId !== noteId || this.state.page !== 'note') await this.openById(noteId);
    if (this.state.currentId === noteId) requestAnimationFrame(() => this.focusNoteBlock(blockId));
  }
  renameNoteBlock(id: string, name: string): void { if (this.open) renameGroup(this.open.engine, id, name); }
  /** 사이드바 블록 › 묶음 풀기 (상자는 그대로) */
  ungroupNoteBlock(id: string): void { const e = this.open?.engine, ids = e && groupMembers(e).get(id); if (e && ids) ungroupBlocks(e, ids); }

  showHome(): void { this.set({ page: 'home' }); } // 서재 — 모든 노트를 책으로 (HomePage.tsx)
  /** 내 페이지 (MePage.tsx): 오늘 할 일 카드가 있어 할 일도 같이 모은다 */
  showMe(): void {
    this.set({ page: 'me' });
    void this.loadTodos();
  }

  /** 앱을 열 때 처음 화면: 마지막 노트(기본) · 홈 (기기 설정) */
  setDefaultView(defaultView: 'last' | 'canvas' | 'doc'): void {
    void this.meta.setSetting('defaultView', defaultView);
    this.set({ defaultView });
  }

  setStartPage(startPage: 'last' | 'home'): void {
    void this.meta.setSetting('startPage', startPage);
    this.set({ startPage });
  }

  /** 노트 관계 그래프 (FR-083) */
  showGraph(): void { this.set({ page: 'graph' }); }

  /** 링크 그래프: 휴지통 · 잠긴 노트는 빼고, 노트 링크(검색 색인의 블록 링크)를 화살표로. degree = 들어오고 나가는 링크 수 */
  linkGraph(): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const notes = this.state.notes.filter((n) => !n.locked && !n.dbRef);
    const ids = new Set(notes.map((n) => n.id));
    const edges: GraphEdge[] = [];
    const deg = new Map<string, number>();
    for (const n of notes) {
      for (const to of this.index.linksFrom(n.id)) {
        if (!ids.has(to) || to === n.id) continue;
        edges.push({ from: n.id, to });
        deg.set(n.id, (deg.get(n.id) ?? 0) + 1);
        deg.set(to, (deg.get(to) ?? 0) + 1);
      }
    }
    return { nodes: notes.map((n) => ({ id: n.id, title: displayTitle(n), ...(n.icon ? { icon: n.icon } : {}), degree: deg.get(n.id) ?? 0 })), edges };
  }

  showTodos(): void {
    this.set({ page: 'todos' });
    void this.loadTodos();
  }

  /** 노트를 하나씩 읽어 할 일을 모은다 (열린 노트는 화면의 엔진 — 저장 전 편집 포함) */
  async loadTodos(): Promise<void> {
    this.set({ todoList: this.state.todoList ?? null, todoLoading: true });
    const all: TodoItem[] = [];
    for (const n of this.state.notes) {
      if (n.locked) continue; // 잠긴 노트는 모으지 않는다 (FR-144)
      const engine = this.open?.engine.note.id === n.id ? this.open.engine : await readNote(this.store, n.id);
      if (engine) all.push(...collectTodos(engine));
    }
    this.set({ todoList: all, todoLoading: false });
  }

  /** 체크 뒤집기 — 열린 노트면 바로, 아니면 잠금을 잡고 열어 바꾼 뒤 저장 */
  async toggleTodo(item: TodoItem): Promise<void> {
    const flip = (e: Engine): boolean => {
      const c = e.getContent(item.contentId);
      if (!c || !isTextContent(c)) return false;
      const steps = flipAttrSteps(c.doc, item.pos, 'checked');
      if (!steps) return false;
      return editTexts(e, [{ contentId: c.id, steps }], '할 일 체크').ok;
    };
    const ok = await this.editNote(item.noteId, flip, (e) => ({ updatedAt: Date.now(), reminders: collectReminders(e, { hideText: this.store.isLocked(item.noteId) }) }));
    if (ok === 'busy') { this.toast('다른 탭에서 편집 중인 노트예요. 그 탭에서 체크해 주세요.'); return; }
    if (!ok) { this.toast('할 일을 바꾸지 못했어요. 노트가 그사이 바뀌었을 수 있어요 — 목록을 새로 고칠게요.'); await this.loadTodos(); return; }
    // 목록에서는 바로 그 항목만 바꾼다 (다시 모으면 완료한 항목이 사라져 손이 헛나간다)
    this.set({ todoList: (this.state.todoList ?? []).map((t) => (t === item ? { ...t, checked: !t.checked } : t)) });
    if (this.open?.engine.note.id !== item.noteId) await this.refreshList();
  }
}
