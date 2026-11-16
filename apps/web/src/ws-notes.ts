// 워크스페이스 노트 층: 노트 열기 · 닫기 · 편집 잠금 · 저장 상태 · 편집 뒤 목록 정보 갱신 · 블록 링크.
import { clampToNoteSheet, findDockSpot, noteGroups, sheetFits, Engine, mediaKind, newId, type ChangeEvent, type Vec2, PDF_VIEW_H, SHEET_COVER_AT } from '@dn/engine-core';

const MAX_IMAGE = 25 * 1024 * 1024;
/** 첨부 파일 한 개 상한 (FR-052) — 기기 저장 공간 · 나중의 동기화 전송량을 생각해 */
export const MAX_FILE = 50 * 1024 * 1024;
import { CanvasView, DocView, type AiEditRequest, type DocViewOptions, type EmbedHost } from '@dn/engine-dom';
import type { NoteLinkHost } from '@dn/text-pm';
import { NoteSession, openNote, readNote, VaultLockedError, type OpenResult, type SaveStatus } from '@dn/storage-idb';
import { WorkspaceBase, type OpenNote } from './ws-base';
import { collectReminders } from './reminders';
import { CHIP_MIN_CHARS, countTodos, displayTitle, firstLine, nameMatch, NOTICE, recentFirst, SAVE_FAILED, STORAGE_FULL, tryLockNote, type NotePlace } from './ws-model';
import { webHost } from './web-host';

export abstract class NotesLayer extends WorkspaceBase {
  protected container: HTMLElement | null = null;
  /** 문서 뷰를 그릴 자리 (FR-088) */
  protected docContainer: HTMLElement | null = null;
  protected doc: DocView | null = null;
  private metaTimer: ReturnType<typeof setTimeout> | null = null;
  private viewTimer: ReturnType<typeof setTimeout> | null = null;
  private busy: Promise<void> = Promise.resolve();
  private camFrame = 0;
  private outlineFrame = 0;
  /** 화면이 움직였을 때 (목차의 지금 위치 강조, FR-084) — 프레임마다 한 번 */
  private readonly cameraListeners = new Set<() => void>();

  /** 블록 하나를 AI로 구조화 (슬래시 메뉴 · 칩에서 부른다 — workspace.ts) */
  abstract structure(blockId?: string): Promise<void>;
  abstract openMoveTo(ids: readonly string[]): void;
  /** 고른 글 AI 편집 — 작성 도우미 창 (FR-112, workspace.ts) */
  abstract openAiEdit(req: AiEditRequest): void;

  /** `force`: 이미 열린 노트도 닫고 다시 연다 (열기 시간 측정 등) */
  openById(id: string, opts: { force?: boolean } = {}): Promise<void> {
    if (this.state.page !== 'note') this.set({ page: 'note' });
    if (id === this.state.currentId && this.open && !opts.force) return this.busy;
    this.busy = this.busy.then(() => this.doOpen(id)).catch((err) => { console.error(err); this.set({ error: String(err) }); });
    return this.busy;
  }

  private async doOpen(id: string): Promise<void> {
    await this.closeCurrent();
    if (!this.container) return;
    const release = await tryLockNote(id);
    let r: Awaited<ReturnType<typeof openNote>>;
    try { r = release ? await openNote(this.store, id) : await this.openReadOnly(id); }
    catch (err) {
      release?.();
      // 잠긴 노트 (FR-144): 금고를 풀어 달라는 화면을 띄운다
      if (err instanceof VaultLockedError) { this.set({ currentId: id, title: this.state.notes.find((x) => x.id === id)?.title ?? '', unlockFor: id }); return; }
      throw err;
    }
    if (!r.ok) {
      release?.();
      this.set({ error: r.reason === 'newer-version' ? '새 버전 앱에서 저장된 노트예요. 앱을 업데이트하면 열 수 있어요.' : '노트를 열지 못했어요. 원본은 백업해 두었어요.' });
      return;
    }
    const { engine, session } = r;
    // 보던 자리 (가운데로 저장): 지금 캔버스 크기로 왼쪽 위를 구한다 — 뒤에 크기가 바뀌면 캔버스가 가운데를 지킨다
    const box = this.container.getBoundingClientRect(), cw = box.width || innerWidth, ch = box.height || innerHeight;
    const cam = r.view && (r.view.center ? { x: r.view.x - cw / 2 / r.view.zoom, y: r.view.y - ch / 2 / r.view.zoom, zoom: r.view.zoom } : { x: r.view.x, y: r.view.y, zoom: r.view.zoom });
    const view = new CanvasView({
      engine, container: this.container,
      readOnly: session.readonly,
      wheelMode: this.state.wheelMode,
      onBlockMenu: (blockMenu) => this.set({ blockMenu, arrowMenu: null }),
      onArrowMenu: (arrowMenu) => this.set({ arrowMenu, blockMenu: null }),
      onNotice: (code) => this.toast(NOTICE[code]),
      onPasted: (blockId, info) => { if (info.chars >= CHIP_MIN_CHARS) this.set({ chip: blockId }); },
      onSlashAi: (blockId) => void this.structure(blockId),
      noteLinks: this.linkHost,
      embeds: this.embedHost, web: webHost,
      files: { url: (h) => this.fileUrl(h), blob: (h) => this.fileBlob(h) },
      onImages: (files, at) => void this.addImages(files, at),
      onFiles: (files, at) => void this.addFiles(files, at),
      onInsertMenu: (insertMenu) => { if (this.state.viewMode !== 'doc') this.set({ insertMenu, blockMenu: null, noteMenu: null }); }, onNoteMenu: (noteMenu) => { if (this.state.viewMode !== 'doc') this.set({ noteMenu, insertMenu: null, blockMenu: null }); },
      onRecord: (at) => void this.startRecording(at),
      onComments: (req) => this.openComments(req),
      onMoveBlocks: (ids) => this.openMoveTo(ids),
      onAiEdit: (req) => this.openAiEdit(req),
      onEditContent: (blockId, contentId, tab) => this.set({ dialog: { kind: 'chart', blockId, contentId, ...(tab ? { tab } : {}) } }),
      camera: cam ?? undefined,
      onCameraChange: (c) => {
        if ((this.state.chip || this.state.aiRun) && !this.camFrame) {
          this.camFrame = requestAnimationFrame(() => { this.camFrame = 0; this.set({ camTick: this.state.camTick + 1 }); });
        }
        if (this.cameraListeners.size && !this.outlineFrame) {
          this.outlineFrame = requestAnimationFrame(() => { this.outlineFrame = 0; for (const fn of this.cameraListeners) fn(); });
        }
        if (this.viewTimer) clearTimeout(this.viewTimer);
        this.viewTimer = setTimeout(() => { const k = view.camera, z = view.size; session.saveView({ x: k.x + z.w / 2 / k.zoom, y: k.y + z.h / 2 / k.zoom, zoom: k.zoom, center: true }); }, 500);
      },
    });
    const offs = [
      view.onUi((ui) => this.set({ ui })),
      session.onStatus((status) => this.onSaveStatus(session, status)),
      engine.subscribe((e) => this.onEngineChange(e)),
    ];
    this.open = { engine, session, view, offs, release: release ?? (() => {}) };
    if (!release) this.waitForLock(id);
    this.afterOpen(this.open, !!release);
    if (!r.view) view.fit();
    if (this.state.defaultView !== 'last' && this.state.viewMode !== this.state.defaultView) this.set({ viewMode: this.state.defaultView }); // 늘 캔버스 · 늘 문서 (FR-143)
    if (this.state.viewMode === 'doc') this.mountDoc();
    this.syncReadOnly();
    if (!this.index.has(id)) void this.putSearchDoc(engine, engine.note.updatedAt);
    void this.meta.setSetting('lastNoteId', id);
    const recent = [id, ...this.state.recent.filter((x) => x !== id)].slice(0, 20);
    void this.meta.setSetting('recentNotes', recent);
    this.set({ recent });
    this.set({ unlockFor: null, currentId: id, title: engine.note.title, look: { icon: engine.note.icon, cover: engine.note.cover, page: engine.note.page, sheet: engine.note.sheet }, error: r.warning ?? null, todos: countTodos(engine), emptyCanvas: engine.blockCount === 0 });
    // 문서 뷰면 숨은 캔버스에 키보드를 주지 않는다 (Delete · / 같은 캔버스 단축키가 보이지 않는 곳에 작용하지 않게)
    if (this.state.viewMode !== 'doc') view.root.focus({ preventScroll: true });
  }

  /** 노트를 연 뒤 · 닫기 전 (동기화 층이 쓴다). writer: 이 탭이 노트 잠금을 가져 저장하는 탭 */
  protected afterOpen(_o: OpenNote, _writer: boolean): void { /* 위 층에서 */ }
  protected beforeClose(_o: OpenNote): void { /* 위 층에서 */ }

  /** 다른 탭이 편집 중인 노트: 저장하지 않는 세션으로 읽기만 한다 */
  private async openReadOnly(id: string): Promise<OpenResult> {
    const engine = await readNote(this.store, id);
    if (!engine) return { ok: false, reason: 'not-found' };
    return {
      ok: true, engine, session: new NoteSession(this.store, engine, 0, true),
      warning: '다른 탭에서 이 노트를 편집하고 있어서 읽기 전용으로 열었어요. 그 탭을 닫으면 여기서 바로 편집할 수 있어요.',
    };
  }

  /** 잠금이 풀리면(다른 탭을 닫음) 아직 그 노트를 읽기 전용으로 보고 있을 때 편집 가능하게 다시 연다 */
  private waitForLock(id: string): void {
    const locks = (navigator as Navigator & { locks?: LockManager }).locks;
    void locks?.request(`dn-note:${id}`, () => {}).then(() => {
      if (this.state.currentId === id && this.open?.session.readonly) void this.openById(id, { force: true });
    });
  }

  /** 저장 실패는 상단 바 글자만으로는 놓치기 쉽다 — 데이터 상태와 함께 배너로 (MSG-SAVE-004 · MSG-STORE-002) */
  private onSaveStatus(session: NoteSession, status: SaveStatus): void {
    const shown = this.state.error === SAVE_FAILED || this.state.error === STORAGE_FULL;
    if (status === 'error') {
      const quota = (session.lastError as { name?: string } | null)?.name === 'QuotaExceededError';
      this.set({ status, error: quota ? STORAGE_FULL : SAVE_FAILED });
      if (quota && !shown) void this.storageHint();
    } else {
      this.set(shown && status === 'saved' ? { status, error: null } : { status });
    }
  }

  private onEngineChange(e: ChangeEvent): void {
    const o = this.open;
    if (!o) return;
    if (e.ops.some((op) => op.e === 'note')) {
      this.set({ title: o.engine.note.title, look: { icon: o.engine.note.icon, cover: o.engine.note.cover, page: o.engine.note.page, sheet: o.engine.note.sheet } });
      this.syncReadOnly();
    }
    if ((o.engine.blockCount === 0) !== this.state.emptyCanvas) this.set({ emptyCanvas: o.engine.blockCount === 0 });
    if (this.state.chip && !o.engine.getBlock(this.state.chip)) this.set({ chip: null });
    // 칩 · 진행 카드는 블록 아래에 붙는다 — 높이 측정(layout) · 이동이 끝나면 위치를 다시 잡는다
    else if (this.state.chip || this.state.aiRun) this.set({ camTick: this.state.camTick + 1 });
    if (e.origin === 'layout') return;
    if (this.metaTimer) clearTimeout(this.metaTimer);
    this.metaTimer = setTimeout(() => void this.syncMeta(), 400);
  }

  /** `o`: 닫는 중인 노트 — closeCurrent는 this.open을 먼저 비우므로 넘겨받는다 (안 그러면 마지막 400ms 편집의 제목 · 미리보기가 목록에 안 남는다) */
  private async syncMeta(o: OpenNote | null = this.open): Promise<void> {
    if (!o) return;
    // 편집이 멈춘 뒤(400ms) 한 번만 — 할 일 세기는 노트 전체 문서를 훑는다
    if (o === this.open) this.set({ todos: countTodos(o.engine) });
    const now = Date.now();
    await this.meta.patch(o.engine.note.id, {
      title: o.engine.note.title, preview: this.store.isLocked(o.engine.note.id) ? '' : firstLine(o.engine), icon: o.engine.note.icon, updatedAt: now, stats: { blocks: o.engine.blockCount }, blocks: this.store.isLocked(o.engine.note.id) ? undefined : noteGroups(o.engine).map((g) => ({ id: g.id, name: g.name })),
      // 알림 (FR-136): 노트를 열지 않고도 띄우려고 목록 정보에 (잠긴 노트는 글자 없이)
      reminders: collectReminders(o.engine, { hideText: this.store.isLocked(o.engine.note.id) }),
    });
    await this.putSearchDoc(o.engine, now);
    await this.refreshList();
  }

  protected async closeCurrent(): Promise<void> {
    const o = this.open;
    if (!o) return;
    this.open = null;
    if (this.metaTimer) { clearTimeout(this.metaTimer); this.metaTimer = null; await this.syncMeta(o).catch(() => {}); }
    this.beforeClose(o);
    for (const off of o.offs) off();
    this.doc?.destroy(); this.doc = null;
    o.view.destroy();
    await o.session.dispose();
    o.release();
    this.aiAbort?.abort(); // 노트를 떠나면 진행 중인 구조화는 취소 — 결과를 다른 노트에 놓지 않는다
    this.set({ ui: null, blockMenu: null, arrowMenu: null, insertMenu: null, noteMenu: null, comments: null, chip: null, ...(this.state.dialog?.kind === 'chart' ? { dialog: null } : {}) });
  }

  /** 편집 잠금 (FR-072) · 읽기 모드 · 보기 전용 세션을 화면에 맞춘다 */
  protected syncReadOnly(): void {
    const o = this.open;
    if (!o) return;
    const ro = this.isReadOnly(o);
    if (o.view.readOnly !== ro) o.view.setReadOnly(ro);
    // 문서 뷰는 컬럼 막대까지 다시 만들어야 해서 바뀌었을 때만 새로
    if (this.doc && this.docRo !== ro) { this.doc.destroy(); this.doc = null; this.mountDoc(); }
  }
  private docRo = false;

  protected async openFallback(): Promise<void> {
    const next = this.state.notes[0];
    if (next) await this.openById(next.id);
    else { await this.closeCurrent(); this.set({ currentId: null, title: '' }); }
  }

  /** 영구 삭제 (스냅샷 · 로그 · 메타 · 검색 문서) */
  protected async purge(ids: readonly string[]): Promise<void> {
    for (const id of ids) {
      if (this.state.currentId === id) { await this.closeCurrent(); this.set({ currentId: null, title: '' }); }
      await this.store.deleteNote(id);
      await this.meta.remove(id);
      this.index.remove(id);
    }
  }

  protected onHash = (): void => { void this.openLink(location.hash); };

  /** 블록 링크 `#n=<노트>&b=<블록>` 열기 (블록 메뉴의 링크 복사, FR-024). 열었으면 true. */
  protected async openLink(hash: string): Promise<boolean> {
    const p = new URLSearchParams(hash.replace(/^#/, ''));
    const n = p.get('n'), b = p.get('b');
    if (!n) return false;
    history.replaceState(null, '', location.pathname + location.search);
    if (!this.state.notes.some((x) => x.id === n)) {
      this.toast(this.state.trash.some((x) => x.id === n) ? '휴지통에 있는 노트예요. 열려면 먼저 복원해 주세요.' : '노트를 찾지 못했어요. 휴지통으로 옮겨졌거나 다른 기기에서 삭제됐을 수 있어요.');
      return false;
    }
    await this.openById(n);
    if (b && this.open?.engine.getBlock(b)) this.focusBlock(b);
    else if (b) this.toast('링크한 블록을 찾지 못했어요. 지워졌을 수 있어요 — 노트만 열었어요.');
    return true;
  }

  /** 노트 링크 자동완성 · 열기 (FR-080). 빈 검색어면 최근 연 노트부터, 지금 노트는 뺀다. */
  /** 블록 임베드 (FR-082): 원본 블록 — 열린 노트면 화면의 엔진(저장 전 편집 포함), 아니면 저장소에서. 잠긴 노트는 금고가 열려 있을 때만 */
  readonly embedHost: EmbedHost = {
    resolve: async (noteId, blockId) => {
      const meta = this.state.notes.find((n) => n.id === noteId);
      if (!meta) return null;
      let engine: Engine | null;
      try { engine = this.open?.engine.note.id === noteId ? this.open.engine : await readNote(this.store, noteId); }
      catch (e) { return e instanceof VaultLockedError ? 'locked' : null; }
      if (!engine?.getBlock(blockId)) return null;
      return { noteTitle: displayTitle(meta), contents: engine.contentsOf(blockId) };
    },
    open: (noteId, blockId) => { void this.openById(noteId).then(() => { if (this.state.currentId === noteId) this.focusBlock(blockId); }); },
  };

  private readonly linkHost: NoteLinkHost = {
    search: (q) => {
      const s = this.state;
      const list = q ? s.notes.filter((n) => nameMatch(n, q)) : recentFirst(s.notes, s.recent);
      return list.filter((n) => n.id !== s.currentId).slice(0, 8)
        .map((n) => ({ id: n.id, title: displayTitle(n), hint: n.preview && n.title.trim() ? n.preview : '' }));
    },
    create: async (title) => {
      // 지금 노트와 같은 폴더에 만든다 — 링크를 건 자리 가까이
      const cur = this.state.notes.find((n) => n.id === this.state.currentId);
      const e = new Engine({ note: { id: newId(), title, createdAt: Date.now(), updatedAt: Date.now() } });
      const id = await this.addEngine(e, cur?.folderId ? { folderId: cur.folderId } : {});
      await this.refreshList();
      return { id, title };
    },
    open: (id) => void this.openById(id),
  };

  /** 이미지 붙여넣기 · 끌어 놓기 (FR-018): 첨부로 저장(내용 해시) → 원래 비율의 이미지 블록, 여러 장이면 옆으로 */
  async addImages(all: File[], at: Vec2): Promise<void> {
    const o = this.open;
    if (!o || !this.canWrite(o)) return;
    // 이미지가 아닌 파일은 첨부 파일 블록으로 (FR-052)
    const files = all.filter((f) => f.type.startsWith('image/'));
    const others = all.filter((f) => !f.type.startsWith('image/'));
    if (others.length) { await this.addFiles(others, files.length ? { x: at.x, y: at.y - 100 } : at); if (!files.length) return; }
    const ids: string[] = [];
    let x = at.x;
    for (const f of files) {
      if (f.size > MAX_IMAGE) { this.toast(`${f.name}: 25MB가 넘는 이미지는 넣을 수 없어요.`); continue; }
      let w = 0, h = 0;
      try { const bmp = await createImageBitmap(f); w = bmp.width; h = bmp.height; bmp.close(); }
      catch { this.toast(`${f.name}: 이미지를 읽지 못했어요.`); continue; }
      const hash = await this.files.put(f, { w, h });
      const bw = Math.min(480, Math.max(80, w)), bh = Math.round((bw * h) / Math.max(1, w));
      if (this.open !== o || !this.canWrite(o)) return; // 겹치면 아래 가까운 빈자리 (붙은 블록을 덮지 않게)
      const p = findDockSpot(o.engine, clampToNoteSheet(o.engine, { x, y: at.y, w: bw, h: bh }), undefined, undefined, sheetFits(o.engine));
      const r = o.engine.transact((tx) => {
        const b = tx.createBlock({ x: p.x, y: p.y, w: bw, h: bh });
        tx.createContent({ blockId: b, type: 'image', attachment: hash, alt: f.name.replace(/\.[^.]+$/, ''), natural: { w, h } } as never);
        return b;
      }, { origin: 'user', label: '이미지 넣기' });
      if (r.ok) ids.push(r.value);
      x = p.x + bw + 24;
    }
    if (ids.length && this.open === o) o.view.select(ids);
  }

  /** 첨부 파일 (FR-052): 첨부 저장소에 넣고(내용 해시) 이름 · 크기 카드 블록을 위에서부터 */
  /** `meta.duration`: 녹음 블록(FR-043)의 길이(초). 만든 블록 id들 */
  async addFiles(files: File[], at: Vec2, meta: { duration?: number } = {}): Promise<string[]> {
    const o = this.open;
    if (!o || !this.canWrite(o)) return [];
    const ids: string[] = [];
    let y = at.y;
    for (const f of files) {
      if (f.size > MAX_FILE) { this.toast(`${f.name}: 50MB가 넘는 파일은 첨부할 수 없어요 (${Math.round(f.size / 1024 / 1024)}MB).`); continue; }
      let hash: string;
      try { hash = await this.files.put(f); }
      catch { this.toast(`${f.name}: 저장 공간이 부족해 첨부하지 못했어요.`); continue; }
      // 저장하는 사이 노트를 옮겼거나 보기 전용이 되었으면 닫힌 엔진에 쓰지 않는다 (저장되지 않는다)
      if (this.open !== o || !this.canWrite(o)) return ids;
      // 소리 · 영상은 카드 아래 재생기 자리까지 (높이는 그린 뒤 실제 높이로 맞춰진다)
      const media = mediaKind(f.type);
      const pdf = !media && (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)); // PDF는 펼친 채로 (GAP #22)
      const size = media === 'video' ? { w: 400, h: 300 } : media === 'audio' ? { w: 360, h: 112 } : pdf ? { w: 520, h: PDF_VIEW_H } : { w: 320, h: 64 };
      const r = o.engine.transact((tx) => {
        const b = tx.createBlock({ ...clampToNoteSheet(o.engine, { x: at.x, y, ...size }), ...(pdf ? { sizing: 'fixed' as const, minH: PDF_VIEW_H } : {}) }); // 용지(A4)면 종이 안으로 · PDF 보기는 크기 고정
        tx.createContent({
          blockId: b, type: 'file', attachment: hash, name: f.name || '이름 없는 파일', mime: f.type || 'application/octet-stream', size: f.size,
          ...(meta.duration ? { duration: Math.round(meta.duration * 10) / 10 } : {}), ...(pdf ? { preview: true } : {}),
        } as never);
        return b;
      }, { origin: 'user', label: media === 'audio' && meta.duration ? '녹음 넣기' : '파일 첨부' });
      if (r.ok) ids.push(r.value);
      y += size.h + 16;
    }
    if (ids.length && this.open === o) o.view.select(ids);
    return ids;
  }

  // ───────── 문서 뷰 · 인쇄 (FR-088 · FR-131) ─────────

  private mountDoc(): void {
    const o = this.open;
    if (!o || !this.docContainer || this.doc) return;
    this.docRo = this.isReadOnly(o);
    this.doc = new DocView({ engine: o.engine, container: this.docContainer, readOnly: this.docRo, files: { url: (h) => this.fileUrl(h), blob: (h) => this.fileBlob(h) }, noteLinks: this.linkHost, embeds: this.embedHost, web: webHost, ...this.docExtra() });
  }
  protected docExtra(): Partial<DocViewOptions> { return {}; } // 문서 뷰 워드 편집 · 쪽 보기 (ws-todos.ts)

  /** 캔버스 ↔ 문서 — 같은 엔진이라 어느 쪽에서 고쳐도 다른 쪽에 반영된다 */
  setViewMode(viewMode: 'canvas' | 'doc'): void {
    if (viewMode === this.state.viewMode) return;
    void this.meta.setSetting('viewMode', viewMode);
    if (viewMode === 'doc') { this.view?.endEditing(); this.view?.root.blur(); this.set({ viewMode, insertMenu: null, noteMenu: null, blockMenu: null }); this.mountDoc(); }
    else { this.doc?.destroy(); this.doc = null; this.set({ viewMode }); }
  }

  onCamera(fn: () => void): () => void {
    this.cameraListeners.add(fn);
    return () => { this.cameraListeners.delete(fn); };
  }

  /** 읽기 모드 (FR-085): 내용만 보고 실수로 고치지 않게. 다른 탭이 편집 중인 노트는 원래 보기 전용 */
  setReadMode(on: boolean): void {
    if (on === this.state.readMode) return;
    this.set({ readMode: on });
    this.syncReadOnly();
    if (on) this.toast('읽기 모드예요. Esc나 Ctrl+Alt+Enter로 나갈 수 있어요.');
  }

  toggleSidebar(): void {
    const sidebarHidden = !this.state.sidebarHidden;
    void this.meta.setSetting('sidebarHidden', sidebarHidden);
    this.set({ sidebarHidden });
  }

  /** 블록으로 이동 — 지금 보는 쪽(캔버스 · 문서)에서 */
  focusBlock(id: string): void {
    if (this.doc) this.doc.focusBlock(id);
    else this.view?.focusBlock(id);
  }

  /** 인쇄 · PDF · 다른 파일로 저장 (FR-131): 미리보기 창 (ExportDialog) */
  printNote(): void { if (this.state.currentId) this.set({ dialog: { kind: 'export' } }); }

  setTitle(title: string): void {
    const o = this.open;
    if (!o) return;
    o.engine.transact((tx) => tx.setNote({ title }), { origin: 'user', label: '제목 변경', mergeKey: 'note-title' });
  }

  /** 새 노트. `place`: 폴더 안 · 다른 노트 아래 (FR-073) */
  async newNote(place: NotePlace = {}): Promise<void> {
    const e = new Engine({ note: { id: newId(), title: '', createdAt: Date.now(), updatedAt: Date.now(), ...(place.sheet ? { sheet: place.sheet } : {}), ...(place.sheet && place.cover ? { coverPage: { ...SHEET_COVER_AT } } : {}) } });
    const id = await this.addEngine(e, (({ cover: _c, ...rest }) => rest)(place)); // 표지 쪽은 노트에, 목록 정보에는 안 넣는다
    const open = place.folderId ? `f:${place.folderId}` : place.parentNoteId ? `n:${place.parentNoteId}` : null;
    if (open) this.setExpanded(open, true);
    await this.refreshList();
    await this.openById(id);
  }
}
