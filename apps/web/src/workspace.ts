// 앱 계층 조립: 앱 시작 · 새 버전 안내 · 설정 · 템플릿.
// 층 순서: ws-base(상태 · 토스트 · 목록) → ws-notes(노트 열기/닫기 · 잠금 · 저장 상태) → ws-organize(폴더 · 태그 · 휴지통 · 검색 · 내보내기) → ws-import(가져오기) → ws-todos(할 일 모아보기) → ws-replace(찾아 바꾸기)
// → ws-dbpages → ws-versions → ws-lock → ws-sync → ws-record → ws-remind(알림) → ws-ai(AI 자동 구조화 · 키) → 여기
import { AccountCtl } from './account';
import { OcrCtl } from './ocr-flow';
import { AiEditCtl, summaryBlocks } from './ai-edit-flow';
import { noteSegments, translatedCopy, type NoteSegments } from './translate-note';
import { EDIT_LANGS, type EditLang } from '@dn/ai-pipeline';
import { noteToMarkdown } from './export';
import { createTextBlock, newId, setNoteRole, type Engine } from '@dn/engine-core';
import { tidyBlocks, type AiEditRequest, type DocZoom } from '@dn/engine-dom';
import { markdownToDoc } from '@dn/text-pm';
import { AttachmentStore, IdbNoteStore, MetaStore, readNote } from '@dn/storage-idb';
import { loadAiSettings } from './ai';
import { buildSampleNote, buildSynthNote, SAMPLE_PASTE } from './sample';
import { instantiate, toTemplate, type TemplateEntry, type UserTemplate } from './templates';
import { registerServiceWorker } from './sw-register';
import { applyTheme, storedTheme, watchSystemTheme, type ThemePref } from './theme';
import { SEARCH_DOC_VERSION, type NoteRole, type SearchDoc } from '@dn/search';
import { SideLayer } from './ws-side';
import { insertSnippet, makeSnippet, MAX_SNIPPETS, SNIPPET_PIN, snippetIsBlock, validSnippets, type Snippet } from './snippets';
import { DAY, TRASH_DAYS, type NoteSort } from './ws-model';

export {
  ago, displayTitle, SORT_LABEL, TRASH_DAYS, type NoteSort, type Overlay, type WorkspaceState,
} from './ws-model';

export class Workspace extends SideLayer {
  private reloadAction: (() => void) | null = null;
  private unwatchTheme: () => void = () => {};
  /** 계정 · 로그인 (선택 — 안 해도 모든 편집이 된다) */
  auth!: AccountCtl;
  /** 손글씨 → 글 (FR-038) */
  ocr!: OcrCtl;
  /** 고른 글 AI 편집 — 작성 도우미 (FR-112) */
  aiEdit!: AiEditCtl;

  async init(container: HTMLElement, docContainer?: HTMLElement): Promise<void> {
    this.docContainer = docContainer ?? null;
    try {
      await this.boot(container);
    } catch (err) {
      console.error(err);
      this.set({ error: `앱을 열지 못했어요. 새로 고침해 주세요. 노트는 이 기기에 그대로 있어요. (${String(err)})` });
    } finally {
      this.set({ booting: false });
    }
  }

  private async boot(container: HTMLElement): Promise<void> {
    this.container = container;
    // e2e · 디버깅용 — 개발 서버, 또는 e2e용으로 VITE_E2E=1을 켜고 만든 빌드에서만 (일반 배포 빌드에는 없다)
    if (import.meta.env.DEV || import.meta.env.VITE_E2E === '1') (window as unknown as { __dn: Workspace }).__dn = this;
    if (import.meta.env.PROD) {
      registerServiceWorker((apply) => {
        this.reloadAction = apply;
        this.set({ reload: { text: '새 버전이 준비됐어요. 다시 열면 적용돼요.', later: true } });
      });
    }
    const BLOCKED = '다른 탭에 이전 버전의 DamianNote가 열려 있어요. 그 탭을 닫으면 이어서 열려요. 노트는 그대로예요.';
    const hooks = {
      blocked: () => this.set({ error: BLOCKED }),
      versionChange: () => this.onVersionChange(),
    };
    this.store = await IdbNoteStore.open(undefined, hooks);
    this.meta = await MetaStore.open(undefined, hooks);
    this.files = await AttachmentStore.open(undefined, hooks);
    const ws = this;
    this.auth = new AccountCtl({ meta: this.meta, get account() { return ws.state.account; }, get login() { return ws.state.login; }, patch: (p) => this.set(p), toast: (t) => this.toast(t) });
    await this.auth.init();
    this.initQa();
    this.ocr = new OcrCtl({
      get view() { return ws.view; }, meta: this.meta, get consent() { return ws.state.ai.consent; }, get hasKey() { return !!ws.state.ai.keyLast4; }, get ocr() { return ws.state.ocr; },
      patch: (p) => this.set(p), toast: (t) => this.toast(t),
      askConsent: () => this.set({ dialog: { kind: 'consent' } }), askKey: (reason) => this.set({ dialog: { kind: 'settings', reason } }),
      structure: (text, at) => void this.structureText(text, at), inkRead: (ids, text) => this.rememberInk(ids, text),
      get locked() { return !!ws.open && ws.store.isLocked(ws.open.engine.note.id); },
    });
    this.aiEdit = new AiEditCtl({
      get engine() { return ws.open?.engine ?? null; }, meta: this.meta, get consent() { return ws.state.ai.consent; }, get hasKey() { return !!ws.state.ai.keyLast4; },
      get locked() { return !!ws.open && ws.store.isLocked(ws.open.engine.note.id); }, get aiEdit() { return ws.state.aiEdit; },
      patch: (p) => this.set(p), toast: (t, undo) => this.toast(t, undo ? { label: '실행 취소', run: () => this.view?.undo() } : undefined),
      askConsent: () => this.set({ dialog: { kind: 'consent' } }), askKey: (reason) => this.set({ dialog: { kind: 'settings', reason } }),
      noteSource: () => ws.currentMarkdown(ws.open ? summaryBlocks(ws.open.engine) : []), noteSegments: () => (ws.open ? noteSegments(ws.open.engine) : null),
      translatedNote: (segs, out, o) => ws.translatedNote(segs, out, o),
      measure: (doc, w) => ws.view?.measureText(doc, w) ?? 160, reveal: (id) => ws.focusBlock(id),
    });
    if (this.state.error === BLOCKED) this.set({ error: null });
    if ('storage' in navigator && navigator.storage.persist) void navigator.storage.persist();
    window.addEventListener('beforeunload', this.onBeforeUnload);
    this.state.sort = (await this.meta.getSetting<NoteSort>('noteSort')) ?? 'updated';
    this.state.ai = await loadAiSettings(this.meta);
    await this.loadEditSettings();
    this.applyText((await this.meta.getSetting<number>('textScale')) ?? 1, (await this.meta.getSetting<number>('lineSpacing')) ?? 1);
    this.state.expanded = (await this.meta.getSetting<Record<string, boolean>>('treeExpanded')) ?? { tags: true };
    this.state.recent = (await this.meta.getSetting<string[]>('recentNotes')) ?? [];
    this.state.panel = (await this.meta.getSetting<boolean>('notePanel')) ?? false;
    this.state.templates = (await this.meta.getSetting<UserTemplate[]>('templates')) ?? [];
    this.state.noteRoles = (await this.meta.getSetting<NoteRole[]>('noteRoles')) ?? [];
    this.state.lastExportAt = (await this.meta.getSetting<number>('lastExportAt')) ?? null;
    this.state.startPage = (await this.meta.getSetting<'last' | 'home'>('startPage')) ?? 'last';
    this.state.toolbarPins = (await this.meta.getSetting<string[]>('toolbarPins')) ?? [];
    this.state.snippets = validSnippets(await this.meta.getSetting<unknown>('snippets'));
    this.state.docPages = (await this.meta.getSetting<boolean>('docPages')) ?? true;
    this.state.docZoom = (await this.meta.getSetting<DocZoom>('docZoom')) ?? 1;
    // 폰 폭에서는 처음엔 문서 뷰(위에서 아래로 흐름, FR-152) — 직접 고른 적이 있으면 그대로
    // 기본 보기를 정해 두었으면 그것으로 (FR-143)
    this.state.defaultView = (await this.meta.getSetting<'last' | 'canvas' | 'doc'>('defaultView')) ?? 'last';
    this.state.viewMode = this.state.defaultView !== 'last' ? this.state.defaultView
      : (await this.meta.getSetting<'canvas' | 'doc'>('viewMode')) ?? (matchMedia('(max-width: 600px)').matches ? 'doc' : 'canvas');
    this.state.sidebarHidden = (await this.meta.getSetting<boolean>('sidebarHidden')) ?? false;
    this.state.theme = (await this.meta.getSetting<ThemePref>('theme')) ?? storedTheme();
    applyTheme(this.state.theme);
    this.installDbHost();
    this.installVersioning();
    this.installReminders();
    this.unwatchTheme = watchSystemTheme(() => { if (this.state.theme === 'system' && applyTheme('system')) this.view?.refreshTheme(); });
    this.state.installHint = needsInstall();
    // 형식이 예전인 검색 문서는 버리고 backfillIndex가 노트를 다시 읽어 색인한다 (블록 종류 · AI · 링크 필드)
    // 필기에서 읽은 글(FR-120)은 노트에서 다시 만들 수 없으니 예전 형식 문서에서도 건진다
    for (const d of (await this.meta.listSearchDocs()) as SearchDoc[]) if (d.v === SEARCH_DOC_VERSION) this.index.put(d); else this.index.keepInk(d.noteId, d.ink ?? []);
    const expired = await this.meta.expired(Date.now() - TRASH_DAYS * DAY);
    await this.purge(expired);
    if (expired.length) this.toast(`휴지통에서 ${TRASH_DAYS}일이 지난 노트 ${expired.length}개를 영구 삭제했어요.`);

    const synth = import.meta.env.DEV || import.meta.env.VITE_E2E === '1' ? Number(new URLSearchParams(location.search).get('synth')) : 0; // 배포에서는 무시 (보안 8-1)
    let notes = await this.meta.list();
    if (synth > 0) {
      const id = await this.addEngine(buildSynthNote(Math.min(synth, 50_000)));
      history.replaceState(null, '', location.pathname);
      await this.refreshList();
      return this.openById(id);
    }
    if (notes.length === 0) {
      await this.addEngine(buildSampleNote());
      notes = await this.meta.list();
    }
    await this.refreshList();
    // 잠금 (FR-144 · 145): 잠긴 노트 표시 · 앱 잠금이면 잠금 화면부터
    await this.installLocks();
    await this.loadSyncIds();
    this.set({});
    window.addEventListener('hashchange', this.onHash); this.listenMediaSeek(true);
    if (await this.openLink(location.hash)) return;
    const last = await this.meta.getSetting<string>('lastNoteId');
    const target = notes.find((n) => n.id === last) ?? this.state.notes[0];
    if (target) await this.openById(target.id);
    // 시작 화면이 홈이면 노트는 뒤에 열어 두고(캔버스 준비) 홈을 앞에
    if (this.state.startPage === 'home') this.showHome();
    void this.backfillIndex();
  }

  /** 저장 못 한 변경이 화면에만 있을 때 창을 닫으려 하면 브라우저 확인 창 (MSG-SAVE-006) */
  private onBeforeUnload = (e: BeforeUnloadEvent): void => {
    if (this.state.status === 'error') { e.preventDefault(); e.returnValue = ''; }
  };

  /** 다른 탭에서 새 버전이 DB를 올리려 한다 — 남은 편집을 쓰고 연결을 내준 뒤 다시 열기를 안내 (배포 QA E2) */
  private async onVersionChange(): Promise<void> {
    await this.open?.session.flush().catch(() => {});
    this.set({ reload: { text: '다른 탭에서 새 버전의 DamianNote가 열렸어요. 이 탭은 저장을 멈췄어요. 다시 열면 새 버전으로 이어서 쓸 수 있어요.' } });
  }

  /** 배너의 [다시 열기] — 서비스 워커 업데이트면 새 워커로 바꾼 뒤 */
  reloadApp(): void {
    if (this.reloadAction) this.reloadAction();
    else location.reload();
  }

  dismissReload(): void { this.set({ reload: null }); }

  /** 검색 문서가 없는 노트(P3 이전에 만든 노트)를 읽어 색인한다 — 저장하지 않고 읽기만, 한 번에 하나씩 */
  private async backfillIndex(): Promise<void> {
    const todo = [...this.state.notes, ...this.state.trash].filter((n) => !this.index.has(n.id) && n.id !== this.state.currentId);
    if (!todo.length) return;
    this.set({ indexing: { done: 0, total: todo.length } });
    let done = 0;
    for (const n of todo) {
      if (!this.index.has(n.id)) {
        const engine: Engine | null = await readNote(this.store, n.id).catch(() => null);
        if (engine) await this.putSearchDoc(engine, n.updatedAt);
      }
      this.set({ indexing: ++done < todo.length ? { done, total: todo.length } : null });
    }
    // 글 속 #태그로 태그가 생겼으면 사이드바 · 노트에 묻기 범위에 바로
    if (this.tagsDirty) { this.tagsDirty = false; await this.refreshList(); }
  }

  // ───────── 설정 › 편집 (FR-011 · FR-143) ─────────

  openSettings(reason?: string): void { this.set({ dialog: { kind: 'settings', ...(reason ? { reason } : {}) } }); }
  openHelp(): void { this.set({ dialog: { kind: 'help' } }); }

  /** 글자 크기 · 줄 간격: CSS 변수로 바꾸면 블록 높이는 측정(layout)으로 따라온다 */
  private applyText(textScale: number, lineSpacing: number): void {
    document.documentElement.style.setProperty('--dn-fs', String(textScale));
    document.documentElement.style.setProperty('--dn-fs-user', String(textScale));
    document.documentElement.style.setProperty('--dn-lh', String(lineSpacing));
    this.set({ textScale, lineSpacing });
  }

  setTextScale(v: number): void { void this.meta.setSetting('textScale', v); this.applyText(v, this.state.lineSpacing); }
  setLineSpacing(v: number): void { void this.meta.setSetting('lineSpacing', v); this.applyText(this.state.textScale, v); }

  /** 아래 도구 막대에 넣기 항목 고정 · 풀기 (넣기 메뉴의 📌, 막대에서 오른쪽 클릭) */
  togglePin(kind: string): void {
    const pins = this.state.toolbarPins.includes(kind) ? this.state.toolbarPins.filter((k) => k !== kind) : [...this.state.toolbarPins, kind];
    this.set({ toolbarPins: pins });
    void this.meta.setSetting('toolbarPins', pins);
  }

  /** 내 블록 (넣기 메뉴): 고른 상자 · 블록 저장 · 넣기 · 이름 바꾸기 · 빼기 — 이 기기 설정에. 저장 · 넣기는 이름 창부터(name이 오면 바로) */
  saveSnippet(ids: readonly string[], name?: string): void {
    const v = this.view, sn = v && makeSnippet(v.engine, ids, this.state.snippets, name);
    if (!sn) return;
    if (name === undefined) { this.set({ dialog: { kind: 'snippet', save: [...ids], name: sn.name } }); return; }
    this.set({ dialog: null });
    this.setSnippets([sn, ...this.state.snippets].slice(0, MAX_SNIPPETS));
    this.toast(`'${sn.name}'을(를) 넣기(＋) 메뉴의 내 블록에 저장했어요. 누를 때마다 같은 블록이 새로 들어가요.`);
  }
  useSnippet(id: string, at?: { x: number; y: number }, name?: string): void {
    const v = this.view, sn = this.state.snippets.find((x) => x.id === id);
    if (!v || !sn) return;
    if (name === undefined && snippetIsBlock(sn)) { this.set({ dialog: { kind: 'snippet', use: id, name: sn.name, ...(at ? { at } : {}) } }); return; }
    this.set({ dialog: null }); insertSnippet(v, sn, at, name);
  }
  renameSnippet(id: string, name: string): void { if (name.trim()) this.setSnippets(this.state.snippets.map((x) => (x.id === id ? { ...x, name: name.trim().slice(0, 40) } : x))); }
  removeSnippet(id: string): void {
    this.setSnippets(this.state.snippets.filter((x) => x.id !== id));
    if (this.state.toolbarPins.includes(SNIPPET_PIN + id)) this.togglePin(SNIPPET_PIN + id);
  }
  private setSnippets(list: Snippet[]): void { this.set({ snippets: list }); void this.meta.setSetting('snippets', list); }

  /** 테마 (FR-086): 밝게 · 어둡게 · 시스템 — 캔버스로 그리는 색도 다시 읽는다 */
  setTheme(theme: ThemePref): void {
    void this.meta.setSetting('theme', theme);
    this.set({ theme });
    if (applyTheme(theme)) this.view?.refreshTheme();
  }

  setWheelMode(mode: 'pan' | 'zoom'): void {
    void this.meta.setSetting('wheelMode', mode);
    if (this.open) this.open.view.wheelMode = mode;
    this.set({ wheelMode: mode });
  }

  // ───────── 노트 패널 · 첫 사용 안내 (FR-071 · FR-081 · FR-148) ─────────

  togglePanel(open = !this.state.panel): void {
    void this.meta.setSetting('notePanel', open);
    this.set({ panel: open });
  }

  /** 이번 실행 동안만 닫는다 — 설치 전까지는 열 때마다 다시 안내 (D1: 설치 안 하면 7일 미사용 시 데이터 삭제 위험) */
  dismissInstallHint(): void { this.set({ installHint: false }); }

  /** 빈 캔버스의 [샘플로 체험하기]: AI 답변 예시를 붙여넣은 것처럼 상자 하나 + "구조화하기" 칩 */
  trySample(): void {
    const o = this.open;
    if (!o || o.session.readonly) return;
    const r = createTextBlock(o.engine, { x: 0, y: 0 }, { doc: markdownToDoc(SAMPLE_PASTE), w: 420, label: '샘플 붙여넣기' });
    if (!r.ok) return;
    o.view.select([r.value.blockId]);
    o.view.fit(true);
    this.set({ chip: r.value.blockId });
  }

  /** 고른 글 AI 편집 (FR-112) — 읽기 전용 노트에서는 열지 않는다 */
  openAiEdit(req: AiEditRequest): void {
    if (this.open && !this.open.session.readonly) this.aiEdit.open(req);
  }

  /** 노트를 떠날 때 그 노트의 AI 창(작성 도우미 · 손글씨 읽기)도 닫는다 — 보내던 요청은 그만두고, 결과가 다른 노트에 들어가지 않게 */
  protected override async closeCurrent(): Promise<void> {
    this.aiEdit?.close();
    this.ocr?.close();
    return super.closeCurrent();
  }
  // 작성 도우미 · 손글씨 읽기 중 창을 연 쪽이 이어서 (둘 다 불러 닫았으면 둘 다 잊게)
  protected override afterAiDialog(ok: boolean): boolean { const a = this.aiEdit?.resume(ok) ?? false, o = this.ocr?.resume(ok) ?? false; return a || o; }

  /** 노트 요약 (FR-115): 노트 전체 → 요약 · 결정 · 할 일 → 노트 맨 위 콜아웃 */
  summarizeNote(): void {
    if (this.open && !this.open.session.readonly) void this.aiEdit.openNote();
  }

  /** 노트 번역 (FR-114): 노트 전체 → 언어 고르기 → 새 노트. 원본은 손대지 않으니 읽기 전용 노트에서도 */
  translateNote(): void { if (this.open) this.aiEdit.openTranslate(); }

  /** 초안 (FR-113): 주제 → 노트 맨 끝 새 상자 */
  draftNote(): void { if (this.open && !this.open.session.readonly) this.aiEdit.openDraft(); }

  /** 번역한 조각으로 노트 사본을 만들어 연다 — 원본과 같은 폴더 · 상위 노트 · 태그 */
  async translatedNote(segs: NoteSegments, out: readonly (string | null)[], o: { model?: string; target: EditLang }): Promise<{ title: string; missing: number } | null> {
    const src = this.open?.engine, meta = src && this.state.notes.find((n) => n.id === src.note.id);
    if (!src || !meta || src.note.id !== segs.noteId) return null;
    const ai = { generated: true as const, runId: newId(), promptVersion: 'edit.v1', ...(o.model ? { model: o.model } : {}) };
    const langLabel = EDIT_LANGS.find((l) => l.lang === o.target)?.label ?? o.target;
    const { engine, missing } = translatedCopy(src, segs.segs, out, { id: newId(), now: Date.now(), ai, langLabel });
    const id = await this.addEngine(engine, { ...(meta.folderId ? { folderId: meta.folderId } : {}), ...(meta.parentNoteId ? { parentNoteId: meta.parentNoteId } : {}) },
      meta.tagIds?.length ? { tagIds: [...meta.tagIds] } : {});
    await this.refreshList();
    await this.openById(id);
    return { title: engine.note.title, missing };
  }

  /** 열린 노트의 Markdown — 제목은 목록 정보가 아직 저장 전이어도 지금 제목 (노트 요약 입력 — skip: 이전 'AI 요약' 상자) */
  currentMarkdown(skip: readonly string[] = []): string | null {
    const o = this.open, meta = o && this.state.notes.find((n) => n.id === o.engine.note.id);
    return o && meta ? noteToMarkdown(o.engine, { ...meta, title: o.engine.note.title }, { ...this.exportCtx(), ...(skip.length ? { skip: new Set(skip) } : {}) }) : null;
  }

  /** 배치 다듬기 (서브 구조화): 고른 상자(둘 이상), 없으면 캔버스 전체의 줄 · 간격 · 폭을 다듬는다 — 실행 취소 한 번 */
  tidy(ids?: readonly string[]): void {
    const o = this.open;
    if (!o || o.session.readonly) return;
    if (this.state.viewMode === 'doc') this.setViewMode('canvas');
    const r = tidyBlocks(o.view, ids ?? o.view.selectedBlocks);
    if (!r.ok) { this.toast(r.reason); return; }
    this.toast(r.value ? `상자 ${r.value}개의 배치를 다듬었어요.` : '이미 가지런해요.', r.value ? { label: '실행 취소', run: () => { o.engine.undo(); } } : undefined);
  }

  // ───────── 템플릿 (FR-078) ─────────

  openTemplates(): void { this.set({ dialog: { kind: 'templates' } }); }

  /** 템플릿으로 새 노트 — 지금 노트와 같은 폴더에 만들고 연다 */
  async newFromTemplate(entry: TemplateEntry): Promise<void> {
    let engine: Engine;
    try { engine = instantiate(entry); } catch { this.toast('템플릿을 열지 못했어요.'); return; }
    // 기본 템플릿(회의록 · 강의 필기 · 리서치 · 주간 계획)은 같은 이름의 역할로 시작한다 (노트에 묻기 범위)
    if (entry.builtin && this.roles.some((r) => r.id === entry.id)) engine.transact((tx) => tx.setNote({ role: entry.id }), { origin: 'load', undoable: false });
    const cur = this.state.notes.find((n) => n.id === this.state.currentId);
    const id = await this.addEngine(engine, cur?.folderId ? { folderId: cur.folderId } : {});
    this.set({ dialog: null });
    await this.refreshList();
    await this.openById(id);
    this.view?.fit();
  }

  // ───────── 노트 역할 (노트에 묻기 범위 좁히기, 10/26) ─────────

  /** 지금 노트의 역할 — null이면 지움(앱이 제목 · 소제목으로 다시 추정). 실행 취소 한 번 */
  setNoteRole(role: string | null): void { const o = this.open; if (o) setNoteRole(o.engine, role); }

  /** 역할 만들기 — 이름 · 질문에서 이 역할을 가리키는 낱말. 실패하면 사용자 문구 */
  async addNoteRole(name: string, keywords: readonly string[]): Promise<string | null> {
    const n = name.normalize('NFC').trim().slice(0, 30);
    if (!n) return '역할 이름을 적어 주세요.';
    if (this.roles.some((r) => r.name === n)) return `'${n}' 역할이 이미 있어요.`;
    const kw = [...new Set(keywords.map((k) => k.normalize('NFC').trim()).filter(Boolean))].slice(0, 12);
    const noteRoles = [...this.state.noteRoles, { id: `r-${newId()}`, name: n, keywords: kw }];
    await this.meta.setSetting('noteRoles', noteRoles);
    this.set({ noteRoles });
    return null;
  }

  /** 만든 역할 지우기 — 그 역할을 단 노트는 역할 없음(다시 추정)이 된다 */
  async removeNoteRole(id: string): Promise<void> {
    const noteRoles = this.state.noteRoles.filter((r) => r.id !== id);
    await this.meta.setSetting('noteRoles', noteRoles);
    this.set({ noteRoles });
    if (this.open?.engine.note.role === id) setNoteRole(this.open.engine, null);
  }

  /** 지금 노트를 템플릿으로 저장 (이 기기 설정에 스냅샷) */
  async saveAsTemplate(name: string): Promise<void> {
    const o = this.open;
    if (!o || !name.trim()) return;
    const templates = [...this.state.templates, toTemplate(o.engine, name.trim())];
    await this.meta.setSetting('templates', templates);
    this.set({ templates });
    this.toast(`'${name.trim()}' 템플릿으로 저장했어요. 새 노트를 만들 때 고를 수 있어요.`);
  }

  async deleteTemplate(id: string): Promise<void> {
    const templates = this.state.templates.filter((t) => t.id !== id);
    await this.meta.setSetting('templates', templates);
    this.set({ templates });
  }

  async dispose(): Promise<void> {
    window.removeEventListener('hashchange', this.onHash); this.listenMediaSeek(false);
    window.removeEventListener('beforeunload', this.onBeforeUnload);
    this.unwatchTheme();
    this.stopVersioning();
    this.uninstallLocks();
    this.stopRecorderOnDispose();
    this.stopReminders();
    await this.closeCurrent();
  }
}

/** iPad · iPhone 브라우저(홈 화면 앱이 아님) — Safari는 7일 동안 안 쓴 사이트의 저장소를 지울 수 있다 */
function needsInstall(): boolean {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return ios && !standalone;
}
