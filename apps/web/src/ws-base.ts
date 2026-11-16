// 워크스페이스 바닥 층: 상태 보관 · 구독 · 토스트 · 목록 새로 고침 · 검색 문서 · 새 노트 저장.
// 층 순서: WorkspaceBase → NotesLayer(ws-notes) → OrganizeLayer(ws-organize) → Workspace(workspace.ts)
import { setNoteCover, setNoteIcon, setNotePage, type Engine, type Id, type NoteCover, type NotePage, type Vec2, setNoteSheet, type NoteSheet } from '@dn/engine-core';
import type { CanvasView, CommentRequest, InsertMenuRequest } from '@dn/engine-dom';
import { createNote, readNote, type AttachmentStore, type IdbNoteStore, type MetaStore, type NoteMeta, type NoteSession } from '@dn/storage-idb';
import { extractSearchDoc, inkRef, isInkRef, SearchIndex, type NoteRole } from '@dn/search';
import { allRoles, syncNoteScope } from './note-scope';
import { setNoteTitleResolver, setSpellcheck as applySpellcheck } from '@dn/text-pm';
import { pickFiles } from './pick-files';
import { collectReminders } from './reminders';
import { displayTitle, firstLine, INITIAL_STATE, sortNotes, type NotePlace, type NoteSort, type Toast, type WorkspaceState } from './ws-model';

export interface OpenNote { engine: Engine; session: NoteSession; view: CanvasView; offs: (() => void)[]; release: () => void }

export abstract class WorkspaceBase {
  protected store!: IdbNoteStore;
  protected meta!: MetaStore;
  /** 첨부 파일 (이미지, FR-018) */
  protected files!: AttachmentStore;
  private readonly fileUrls = new Map<string, Promise<string | null>>();
  protected open: OpenNote | null = null;
  /** 다른 탭이 저장하는 노트를 함께 고치는 중 (동기화 층이 정한다) */
  protected coEditing(): boolean { return false; }
  /** 이 탭에서 노트를 고칠 수 있나 — 저장하는 탭이거나, 저장하는 탭과 함께 편집 중 */
  protected canWrite(o: OpenNote): boolean { return !o.session.readonly || this.coEditing(); }
  /** 화면을 보기 전용으로: 읽기 모드 · 편집 잠금 (FR-072) · 고칠 수 없는 탭 */
  protected isReadOnly(o: OpenNote): boolean { return this.state.readMode || !!o.engine.note.page?.editLock || !this.canWrite(o); }
  state: WorkspaceState = { ...INITIAL_STATE };
  readonly index = new SearchIndex();
  /** 진행 중인 구조화 — 노트를 닫으면 취소한다 */
  protected aiAbort: AbortController | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private toastSeq = 0;
  private readonly listeners = new Set<(s: WorkspaceState) => void>();

  /** 하단 토스트. 동작 버튼이 있으면 조금 더 오래 보인다. */
  toast(text: string, action?: Toast['action'], alt?: Toast['alt']): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.set({ toast: { id: ++this.toastSeq, text, action, ...(alt ? { alt } : {}) } });
    this.toastTimer = setTimeout(() => this.set({ toast: null }), action ? 6000 : 3500);
  }

  dismissToast(): void { if (this.toastTimer) clearTimeout(this.toastTimer); this.set({ toast: null }); }

  subscribe(fn: (s: WorkspaceState) => void): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => { this.listeners.delete(fn); };
  }

  protected set(patch: Partial<WorkspaceState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn(this.state);
  }

  get view(): CanvasView | null { return this.open?.view ?? null; }

  /** 첨부 해시 → 화면용 주소 (한 번 만든 object URL은 앱이 켜져 있는 동안 다시 쓴다) */
  /** 첨부 내용 (PDF 보기가 머리 바이트를 본다) */
  fileBlob(hash: string): Promise<Blob | null> { return this.files.get(hash).then((a) => a?.blob ?? null).catch(() => null); }

  fileUrl(hash: string): Promise<string | null> {
    let u = this.fileUrls.get(hash);
    if (!u) {
      u = this.files.get(hash).then((a) => (a ? URL.createObjectURL(a.blob) : null)).catch(() => null);
      this.fileUrls.set(hash, u);
    }
    return u;
  }
  /** 지금 열린 노트의 엔진 (노트 정보 패널 등 읽기 전용 용도) */
  get engine(): Engine | null { return this.open?.engine ?? null; }

  /** 검색 문서를 다시 만들어 색인 · 저장 (FR-120). 실패해도 편집 · 저장은 그대로 — false를 돌려주고 다음 편집 · '색인 다시 만들기'에서 다시 */
  protected async putSearchDoc(engine: Engine, updatedAt = Date.now()): Promise<boolean> {
    const id = engine.note.id;
    try {
      // 잠긴 노트는 검색에서 뺀다 (FR-144)
      if (this.store.isLocked(id)) { this.index.remove(id); await this.meta.deleteSearchDoc(id); return true; }
      const d = extractSearchDoc(engine, updatedAt, this.index.inkOf(id));
      // 역할(직접 · 추정) · 글 속 #태그를 노트 메타에, 요약 카드 md를 문서에 (노트에 묻기 범위 좁히기)
      const tagsChanged = await syncNoteScope(this.meta, engine, d, this.roles).catch(() => false);
      this.index.put(d);
      await this.meta.putSearchDoc(d);
      if (tagsChanged) this.tagsDirty = true;
      return true;
    } catch (err) {
      console.warn('검색 색인 실패', id, err);
      return false;
    }
  }

  /** 검색 블록 id(상자 · 필기에서 읽은 글)가 열린 노트에 아직 있나 — 검색 결과 · 인용으로 가기 전에 (FR-117 · FR-120) */
  protected hasTarget(id: string): boolean {
    const e = this.open?.engine;
    if (!e) return false;
    if (!isInkRef(id)) return !!e.getBlock(id);
    return this.index.inkOf(e.note.id).some((x) => x.id === id && x.strokes.some((s) => e.getStroke(s)));
  }

  /** 손글씨를 글로 읽은 결과를 그 획들의 검색 글로 (FR-120) — 노트가 아니라 색인에만, 잠긴 노트는 남기지 않는다 */
  rememberInk(strokes: readonly Id[], text: string): void {
    const e = this.open?.engine;
    if (!e || !strokes.length || !text.trim() || this.store.isLocked(e.note.id)) return;
    this.index.addInk(e.note.id, { id: inkRef(strokes[0]!), strokes: [...strokes], text, at: Date.now() });
    void this.putSearchDoc(e);
  }
  /** 글 속 #태그로 태그가 생기거나 바뀌었다 — 다음 목록 새로 고침에서 반영 */
  protected tagsDirty = false;

  /**
   * 검색 색인 다시 만들기 (FR-120, 설정 › 데이터 · 명령 팔레트) — 모든 노트를 저장 없이 읽어 다시 색인하고, 없어진 노트의 문서는 지운다.
   * 필기에서 읽은 글은 그대로 이어진다. 잠긴 노트는 빼고, 읽지 못한 노트 수를 알린다. 진행률은 검색 창 · 설정에(indexing).
   * 저장소 오류로 멈춰도 진행 표시는 거둔다 — 안 그러면 '색인 다시 만들기'가 계속 막힌다 (교차 검토 B11)
   */
  async rebuildIndex(): Promise<void> {
    if (this.state.indexing) return;
    const all = [...this.state.notes, ...this.state.trash];
    const live = new Set(all.map((n) => n.id));
    let failed = 0;
    try {
      for (const d of await this.meta.listSearchDocs()) if (!live.has(d.noteId)) { this.index.remove(d.noteId); await this.meta.deleteSearchDoc(d.noteId); }
      this.set({ indexing: { done: 0, total: all.length } });
      for (const [i, n] of all.entries()) {
        if (this.store.isLocked(n.id)) { this.index.remove(n.id); await this.meta.deleteSearchDoc(n.id); }
        else {
          const engine = this.open?.engine.note.id === n.id ? this.open.engine : await readNote(this.store, n.id).catch(() => null);
          if (!engine || !(await this.putSearchDoc(engine, n.updatedAt))) failed++;
        }
        this.set({ indexing: { done: i + 1, total: all.length } });
        if (i % 10 === 9) await new Promise((r) => setTimeout(r)); // 화면이 멈추지 않게
      }
    } catch (err) {
      console.warn('색인 다시 만들기 실패', err);
      this.toast('검색 색인을 다시 만들지 못했어요. 잠시 뒤 다시 해 주세요. 노트는 그대로예요.');
      return;
    } finally {
      this.set({ indexing: null });
    }
    if (this.tagsDirty) { this.tagsDirty = false; await this.refreshList(); }
    this.toast(failed ? `검색 색인을 다시 만들었어요 — 노트 ${failed}개는 읽지 못했어요.` : `검색 색인을 다시 만들었어요 (노트 ${all.length}개).`);
  }

  /** 기본 역할 + 사용자가 만든 역할 */
  get roles(): NoteRole[] { return allRoles(this.state.noteRoles); }

  /** `extra`: 가져오기처럼 날짜 · 태그를 정해서 넣을 때 */
  protected async addEngine(engine: Engine, place: NotePlace = {}, extra: Partial<NoteMeta> = {}): Promise<string> {
    const session = await createNote(this.store, engine);
    await session.dispose();
    const now = Date.now();
    const reminders = collectReminders(engine);
    await this.meta.put({ id: engine.note.id, title: engine.note.title, createdAt: engine.note.createdAt, updatedAt: now, stats: { blocks: engine.blockCount }, preview: firstLine(engine), ...(engine.note.icon ? { icon: engine.note.icon } : {}), ...(reminders.length ? { reminders } : {}), schemaVersion: 1, ...place, ...extra });
    await this.putSearchDoc(engine, now);
    return engine.note.id;
  }

  protected async refreshList(): Promise<void> {
    const trash = (await this.meta.list({ trash: true })).sort((a, b) => b.deletedAt! - a.deletedAt!);
    const [folders, tags] = await Promise.all([this.meta.listFolders(), this.meta.listTags()]);
    tags.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    const tagFilter = this.state.tagFilter && tags.some((t) => t.id === this.state.tagFilter) ? this.state.tagFilter : null;
    const notes = await this.meta.list();
    // 노트 링크는 대상 노트의 지금 제목을 보여 준다 (FR-080) — 휴지통 · 없는 노트는 null
    const titles = new Map(notes.map((n) => [n.id, displayTitle(n)]));
    setNoteTitleResolver((id) => titles.get(id) ?? null);
    this.set({ notes: sortNotes(notes, this.state.sort), trash, folders, tags, tagFilter });
    this.open?.view.refreshNoteLinks();
  }

  setSort(sort: NoteSort): void {
    void this.meta.setSetting('noteSort', sort);
    this.set({ sort, notes: sortNotes(this.state.notes, sort) });
  }

  setExpanded(key: string, open: boolean): void {
    const expanded = { ...this.state.expanded, [key]: open };
    void this.meta.setSetting('treeExpanded', expanded);
    this.set({ expanded });
  }

  /** 이동 경로의 폴더 누르기 (GAP #17): 사이드바를 보이고 그 폴더까지 펼쳐 그 줄로 */
  revealFolder(id: string): void {
    const byId = new Map(this.state.folders.map((f) => [f.id, f]));
    const expanded = { ...this.state.expanded };
    for (let f = byId.get(id), n = 0; f && n < 64; f = f.parentId ? byId.get(f.parentId) : undefined, n++) expanded[`f:${f.id}`] = true;
    void this.meta.setSetting('treeExpanded', expanded);
    if (this.state.sidebarHidden) void this.meta.setSetting('sidebarHidden', false);
    this.set({ expanded, sidebarHidden: false });
    // 사이드바가 다시 그려진 뒤 — 깜빡임은 className이 아니라 애니메이션으로(React가 className을 덮어쓴다)
    setTimeout(() => {
      const row = document.querySelector<HTMLElement>(`.note-item[data-key="f:${CSS.escape(id)}"]`);
      row?.scrollIntoView({ block: 'nearest' });
      row?.animate?.([{ background: 'rgba(76, 110, 245, 0.18)' }, { background: 'rgba(76, 110, 245, 0.18)', offset: 0.4 }, { background: 'transparent' }], { duration: 1200, easing: 'ease-out' });
    }, 30);
  }

  showTrash(): void { this.set({ page: 'trash' }); }
  closeBlockMenu(): void { if (this.state.blockMenu) this.set({ blockMenu: null }); }
  closeArrowMenu(): void { if (this.state.arrowMenu) this.set({ arrowMenu: null }); }
  /** 음성 녹음 시작 — 녹음 층(ws-record)이 구현 */
  abstract startRecording(at?: Vec2): Promise<void>;
  // ───────── 노트 아이콘 · 커버 (FR-070) ─────────

  setNoteIcon(icon: string | null): void {
    const o = this.open;
    if (!o || !this.canWrite(o)) return;
    if (!setNoteIcon(o.engine, icon).ok) return;
    // 목록 · 검색은 메타를 보므로 바로 맞춘다 (저장은 편집 멈춤 뒤 syncMeta가)
    const id = o.engine.note.id, v = o.engine.note.icon;
    this.set({ notes: this.state.notes.map((n) => (n.id === id ? { ...n, icon: v } : n)) });
  }

  /** 커버 이미지 고르기 → 첨부 저장소 → 노트 커버 (위치는 가운데) */
  async pickNoteCover(): Promise<void> {
    const f = (await pickFiles('image/*'))?.[0];
    if (f) await this.setNoteCoverFile(f);
  }

  async setNoteCoverFile(file: File): Promise<void> {
    const o = this.open;
    if (!o || !this.canWrite(o)) return;
    if (!file.type.startsWith('image/')) { this.toast('커버는 이미지 파일로만 할 수 있어요.'); return; }
    if (file.size > 25 * 1024 * 1024) { this.toast(`${file.name}: 25MB가 넘는 이미지는 커버로 쓸 수 없어요.`); return; }
    let hash: string;
    try { hash = await this.files.put(file); }
    catch { this.toast('저장 공간이 부족해 커버를 넣지 못했어요.'); return; }
    if (this.open === o) setNoteCover(o.engine, { attachment: hash, pos: 50 });
  }

  setNoteCover(cover: NoteCover | null): void {
    const o = this.open;
    if (o && this.canWrite(o)) setNoteCover(o.engine, cover);
  }

  setNoteCoverPos(pos: number): void {
    const o = this.open;
    const c = o?.engine.note.cover;
    if (o && c && this.canWrite(o)) setNoteCover(o.engine, { ...c, pos });
  }

  /** 저장 공간이 가득 찼을 때 (FR-091): 지금 사용량 · 한도와 백업 내보내기로 */
  protected async storageHint(): Promise<void> {
    const est = await navigator.storage?.estimate?.().catch(() => null);
    const mb = (n?: number) => (n === undefined ? '?' : n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)}GB` : `${Math.round(n / 1024 / 1024)}MB`);
    const used = est ? `(${mb(est.usage)} / ${mb(est.quota)} 사용 중) ` : '';
    this.toast(`저장 공간이 부족해요 ${used}— 전체 백업을 내보낸 뒤 안 쓰는 노트 · 큰 첨부를 지우면 다시 저장돼요.`, { label: '백업 내보내기', run: () => void this.exportAll() });
  }

  /** 설정 › 편집: 휠 · 새 노트 용지 · 맞춤법 검사 */
  protected async loadEditSettings(): Promise<void> {
    this.state.wheelMode = (await this.meta.getSetting<'pan' | 'zoom'>('wheelMode')) ?? 'pan';
    this.state.newNoteSheet = (await this.meta.getSetting<'a4' | 'a4l' | 'none'>('newNoteSheet')) ?? 'a4';
    this.state.spellcheck = (await this.meta.getSetting<boolean>('spellcheck')) ?? true;
    applySpellcheck(this.state.spellcheck);
  }
  setSpellcheck(on: boolean): void {
    this.set({ spellcheck: on });
    applySpellcheck(on);
    void this.meta.setSetting('spellcheck', on);
  }

  /** 화면의 '새 노트' — 용지(설정) + 표지 쪽 (11/09: 첫 쪽은 늘 표지). extra: 폴더 등 */
  newNotePlace(extra: NotePlace = {}): NotePlace { return { ...extra, sheet: this.newNoteSheetValue(), cover: true }; }
  /** 화면의 '새 노트'가 쓸 용지 (설정 — 기본 A4 세로). A4로 고정(11/03) — 예전 설정 '끝없는 캔버스'도 A4 세로로 */
  newNoteSheetValue(): NoteSheet {
    return { size: 'a4', ...(this.state.newNoteSheet === 'a4l' ? { landscape: true } : {}) };
  }
  setNewNoteSheet(k: WorkspaceState['newNoteSheet']): void {
    this.set({ newNoteSheet: k });
    void this.meta.setSetting('newNoteSheet', k);
  }

  /** 용지: A4 세로 · 가로 · 끝없는 캔버스 — 바꾸면 종이에 맞춰 보기 */
  setNoteSheet(sheet: NoteSheet | null): void {
    const o = this.open;
    if (!o || !this.canWrite(o)) return;
    if (setNoteSheet(o.engine, sheet).ok) requestAnimationFrame(() => o.view.fit(true));
  }

  /** 페이지 표시 옵션 (FR-072) */
  setNotePage(patch: NotePage): void {
    const o = this.open;
    if (!o || !this.canWrite(o)) return;
    setNotePage(o.engine, patch);
  }

  // ───────── 옆에 노트 (FR-153) ─────────
  /** 노트를 오른쪽에 읽기로 연다. 좁은 화면 · 지금 노트는 안 된다 */
  async openSide(noteId: string): Promise<void> {
    if (noteId === this.state.currentId) { this.toast('지금 연 노트예요. 다른 노트를 옆에 열어 주세요.'); return; }
    if (matchMedia('(max-width: 760px)').matches) { this.toast('화면이 좁아 옆에 열 수 없어요 — 태블릿 · 컴퓨터 화면에서 써 주세요.'); return; }
    const ratio = this.state.side?.ratio ?? (await this.meta.getSetting<number>('sideRatio')) ?? 0.58;
    this.set({ side: { noteId, ratio }, page: 'note' });
  }
  closeSide(): void { if (this.state.side) this.set({ side: null }); }
  /** 나눔 비율 (왼쪽 몫, 0.3 ~ 0.8). save면 기기 설정에도 */
  setSideRatio(r: number, save: boolean): void {
    const side = this.state.side;
    if (!side) return;
    const ratio = Math.round(Math.max(0.3, Math.min(0.8, r)) * 1000) / 1000;
    if (ratio !== side.ratio) this.set({ side: { ...side, ratio } });
    if (save) void this.meta.setSetting('sideRatio', ratio);
  }
  /** 두 노트 자리 바꾸기 */
  async swapSide(): Promise<void> {
    const side = this.state.side, main = this.state.currentId;
    if (!side || !main) return;
    this.set({ side: { ...side, noteId: main } });
    await this.openById(side.noteId);
  }
  /** 읽기용 엔진 — 지금 노트면 화면의 엔진, 아니면 저장소에서 (잠긴 노트 · 없는 노트는 null) */
  async readEngine(id: string): Promise<Engine | null> {
    if (this.open?.engine.note.id === id) return this.open.engine;
    if (!this.state.notes.some((n) => n.id === id)) return null;
    return readNote(this.store, id).catch(() => null);
  }
  abstract openById(id: string, opts?: { force?: boolean }): Promise<void>;
  abstract exportAll(): Promise<void>;

  // ───────── 댓글 (FR-132) ─────────
  openComments(req: CommentRequest): void { this.set({ comments: req, blockMenu: null, insertMenu: null }); }
  closeComments(): void { if (this.state.comments) this.set({ comments: null }); }
  /** 새 댓글을 달았거나 그만둔 뒤: 고른 글 초안 지우기 */
  setCommentDraft(draft: CommentRequest['draft'] | null): void { const c = this.state.comments; if (c) this.set({ comments: { ...c, draft: draft ?? undefined } }); }
  /** 선택한 블록 하나에 댓글 (Ctrl+Alt+M · 블록 메뉴) */
  commentOnSelection(): void {
    const v = this.open?.view;
    const id = v?.selectedBlocks.length === 1 ? v.selectedBlocks[0]! : null;
    if (!v || !id) { this.toast('댓글을 달 블록을 하나 골라 주세요.'); return; }
    const r = v.blockScreenRect(id), o = v.root.getBoundingClientRect();
    this.openComments({ blockId: id, x: o.left + (r ? r.x + r.w + 12 : 40), y: o.top + (r ? r.y : 40) });
  }

  closeInsertMenu(): void { if (this.state.insertMenu) this.set({ insertMenu: null }); }
  openInsertMenu(req: InsertMenuRequest): void { this.set({ insertMenu: req, blockMenu: null, noteMenu: null }); }
  closeNoteMenu(): void { if (this.state.noteMenu) this.set({ noteMenu: null }); }
}
