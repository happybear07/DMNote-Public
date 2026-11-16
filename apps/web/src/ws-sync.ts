// 워크스페이스 동기화 층 (FR-095 · 096 · 097)
// 1) 같은 기기 탭 사이 실시간: 노트를 열면 Y.Doc을 엔진과 잇고(@dn/sync) 노트마다 탭 채널에 붙는다. 쓰기 탭(노트 잠금을 가진 탭)만 저장,
//    다른 탭은 쓰기 탭이 있는 동안 함께 고친다. 쓰기 탭은 다른 탭이 나타날 때만 Y.Doc을 만든다(큰 노트 열기 비용 없음).
// 2) 기기 사이 동기화 파일: 한 번이라도 파일로 오간 노트는 "동기화 노트" — 그 Y 기록을 저장해 두고 열 때마다 이어 붙여 기록을 공유한다.
//    다른 기기 파일을 가져오면 Y 기록끼리 합치고(필드 · 글자 단위), 한쪽이 지우고 다른 쪽이 고친 블록은 되살려 충돌 표시(남기기 · 지우기).
//    합치기 전 · 후를 버전 기록에 남긴다. 잠긴 노트는 파일에 넣지 않는다.
// 층 순서: … → ws-lock → 여기 → workspace.ts
import * as Y from 'yjs';
import { Engine, newId, SCHEMA_VERSION, serialize, type Id } from '@dn/engine-core';
import { attach, docAttachments, fingerprints, fromB64, isSyncFile, knownIds, mergeRemote, TabSync, toB64, type Bridge, type Conflict, type OnRemote, type SyncFile } from '@dn/sync';
import { openNote, readNote, type NoteSession } from '@dn/storage-idb';
import { download } from './export';
import { LockLayer } from './ws-lock';
import { collectReminders } from './reminders';
import type { OpenNote } from './ws-base';

interface Live { doc: Y.Doc; bridge: Bridge | null; tabs: TabSync | null; offs: (() => void)[] }

/** 이 기기 이름 (동기화 파일에 적는다) */
const deviceName = () => (navigator.userAgent.match(/(Windows|Mac OS X|Android|iPad|iPhone|Linux)/)?.[1] ?? '기기').replace('Mac OS X', 'Mac');

export abstract class SyncLayer extends LockLayer {
  private live: Live | null = null;
  /** 동기화 노트 (Y 기록을 저장해 둔 노트) */
  private synced = new Set<Id>();
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  /** 이 기기 id — 묘비 키(`_del:<id>`)와 "이 기기가 지웠나" 판정에 쓴다. 기기(브라우저 저장소)마다 하나, 처음 쓸 때 만든다 */
  private get device(): string {
    try {
      let id = localStorage.getItem('dn:device-id');
      if (!id) { id = newId(); localStorage.setItem('dn:device-id', id); }
      return id;
    } catch { return this.fallbackDevice; }
  }
  private readonly fallbackDevice = newId();

  protected async loadSyncIds(): Promise<void> { this.synced = new Set(await this.store.listSyncIds().catch(() => [])); }

  /** 열린 노트가 이 앱보다 새 스키마로 쓰였으면 그 버전 — 보기 전용 (SYNC 10.5). 다리는 로컬 변경을 Y에 쓰지 않는다 */
  private newerSchema: number | null = null;
  private readonly onNewer = (_v: number): void => {
    this.newerSchema = _v;
    this.syncReadOnly();
    this.set({ error: '이 노트는 새 버전 앱에서 고쳐졌어요 — 앱을 업데이트하면 고칠 수 있어요. 지금은 보기만 할 수 있어요.' });
  };
  protected override isReadOnly(o: OpenNote): boolean { return super.isReadOnly(o) || this.newerSchema !== null; }

  /** 다른 곳 변경 중 엔진 규칙에 막혀 못 들인 것이 있으면 알린다 (나머지는 들어갔다 — @dn/sync reconcile) */
  private readonly onRemote: OnRemote = (_changed, rejected) => {
    if (rejected) this.toast(`다른 곳에서 온 변경 ${rejected}개를 이 노트에 넣지 못했어요. 나머지 변경은 반영했어요.`);
  };

  protected override afterOpen(o: OpenNote, writer: boolean): void {
    super.afterOpen(o, writer);
    // 다른 탭 · 기기의 변경과 겹친 되돌리기는 겹친 부분만 건너뛴다(engine-core undo-guard) — 그때 알린다
    o.engine.undoNotice = (kind) => this.toast(`다른 곳의 변경과 겹쳐 일부만 ${kind === 'undo' ? '되돌렸어요' : '다시 실행했어요'}.`);
    const live: Live = { doc: new Y.Doc(), bridge: null, tabs: null, offs: [] };
    this.live = live;
    this.newerSchema = null;
    const id = o.engine.note.id;
    if (writer && this.synced.has(id)) void this.openSynced(o, live);
    else this.joinTabs(o, live, writer);
  }

  /** 동기화 노트: 저장된 Y 기록을 이어 붙이고 엔진과 잇는다 — 이후 편집은 그 기록에 쌓여 저장된다 */
  private async openSynced(o: OpenNote, live: Live): Promise<void> {
    const st = await this.store.getSync(o.engine.note.id).catch(() => null);
    if (this.live !== live) return;
    if (st) Y.applyUpdate(live.doc, st.update, 'stored');
    // known: 지난번 저장 때 양쪽에 다 있던 것 — Y에만 있는 엔티티가 "아직 엔진에 안 들어온 것"인지 "이 기기가 지운 것"인지 가른다
    live.bridge = attach(o.engine, live.doc, { onRemote: this.onRemote, onNewerSchema: this.onNewer, prefer: 'engine', known: st?.known ? new Set(st.known) : null, device: this.device });
    const save = () => {
      if (this.persistTimer) clearTimeout(this.persistTimer);
      this.persistTimer = setTimeout(() => { void this.persistSync(o.engine.note.id, live.doc, o.engine, o.session); }, 800);
    };
    live.doc.on('update', save);
    live.offs.push(() => { live.doc.off('update', save); if (this.persistTimer) { clearTimeout(this.persistTimer); this.persistTimer = null; void this.persistSync(o.engine.note.id, live.doc, o.engine, o.session); } });
    this.joinTabs(o, live, true);
  }

  /**
   * Y 기록 저장. 엔진 로그를 먼저 디스크에 쓴다 — known(양쪽에 다 있던 것)은 "엔진에 저장된 것"이어야 한다.
   * 거꾸로면 엔진 로그를 쓰기 전에 앱이 닫혔을 때, 다음에 열며 Y의 그 엔티티를 "이 기기가 지운 것"으로 잘못 보고 지운다.
   */
  private async persistSync(noteId: Id, doc: Y.Doc, engine: Engine, session: NoteSession): Promise<void> {
    await session.flush().catch(() => {});
    const prev = await this.store.getSync(noteId).catch(() => null);
    await this.store.putSync({ noteId, update: Y.encodeStateAsUpdate(doc), base: prev?.base ?? null, syncedAt: prev?.syncedAt ?? 0, known: [...knownIds(engine, doc)] }).catch(() => {});
    this.synced.add(noteId);
  }

  /** 보는 탭: 저장하는 탭과 이어져 있으면 함께 고친다 */
  protected override coEditing(): boolean { return !!this.live?.bridge && !!this.live.tabs?.hasWriter; }

  private joinTabs(o: OpenNote, live: Live, writer: boolean): void {
    if (typeof BroadcastChannel !== 'function') return;
    const tabs = new TabSync(o.engine.note.id, live.doc, writer, writer ? () => { if (!live.bridge && this.live === live) live.bridge = attach(o.engine, live.doc, { onRemote: this.onRemote, onNewerSchema: this.onNewer, device: this.device }); } : undefined);
    live.tabs = tabs;
    const sync = () => {
      if (this.live !== live) return;
      const guest = !writer;
      // 다른 탭(쓰기 탭)이 있으면 함께 고칠 수 있다 — 저장은 그 탭이
      if (guest) this.syncReadOnly();
      this.set({ tabPeers: tabs.peerList.length, tabRole: guest ? (tabs.hasWriter ? 'guest' : 'readonly') : 'writer', ...(guest && tabs.hasWriter ? { error: null } : {}) });
    };
    live.offs.push(tabs.onPeers(sync));
    if (writer) sync();
    else {
      // 쓰기 탭의 지금 상태(아직 저장 전 편집 포함)를 먼저 받고 잇는다 — 없으면 저장된 내용으로
      void tabs.waitForState(500).then(() => {
        if (this.live !== live) return;
        live.bridge = attach(o.engine, live.doc, { onRemote: this.onRemote, onNewerSchema: this.onNewer, device: this.device });
        sync();
      });
    }
  }

  protected override beforeClose(o: OpenNote): void {
    const l = this.live;
    this.live = null;
    if (l) { for (const f of l.offs) f(); l.bridge?.detach(); l.tabs?.close(); setTimeout(() => l.doc.destroy(), 2000); }
    this.newerSchema = null;
    this.set({ tabPeers: 0, tabRole: null });
    super.beforeClose(o);
  }

  // ───────── 기기 사이 동기화 파일 (FR-096 · 097) ─────────

  /** 이 노트의 Y 기록과 그 엔진 (열린 노트면 지금 것, 아니면 저장된 것 — 처음이면 노트에서 새로 만들어 동기화 노트로) */
  private async docOf(id: Id): Promise<{ doc: Y.Doc; engine: Engine } | null> {
    const open = this.open?.engine.note.id === id ? this.live : null;
    if (open?.bridge && this.open) { await this.open.session.flush().catch(() => {}); return { doc: open.doc, engine: this.open.engine }; }
    const doc = new Y.Doc();
    const st = await this.store.getSync(id).catch(() => null);
    if (st) {
      Y.applyUpdate(doc, st.update);
      // 저장된 기록이 엔진보다 늦을 수 있다(기록 없이 고친 경우) — 엔진 기준으로 이어 붙이되, Y에만 있는 것은 known으로 가른다
      const e = await readNote(this.store, id).catch(() => null);
      if (!e) return null;
      attach(e, doc, { prefer: 'engine', known: st.known ? new Set(st.known) : null, device: this.device }).detach();
      return { doc, engine: e };
    }
    // 열린 노트: 지금 탭의 Y.Doc을 그대로 엔진과 이어 쓴다 (따로 만들어 합치면 같은 내용이 서로 다른 기록으로 두 벌 생긴다)
    if (open && this.open) {
      open.bridge = attach(this.open.engine, open.doc, { onRemote: this.onRemote, onNewerSchema: this.onNewer, device: this.device });
      await this.open.session.flush().catch(() => {});
      return { doc: open.doc, engine: this.open.engine };
    }
    const engine = await readNote(this.store, id).catch(() => null);
    if (!engine) return null;
    attach(engine, doc, { device: this.device }).detach();
    return { doc, engine };
  }

  /** 동기화 파일 내보내기: 잠기지 않은 노트 전부의 Y 기록 + 지금 블록 지문을 "마지막 동기화"로 기억 */
  async exportSyncFile(): Promise<void> {
    const notes = this.state.notes.filter((n) => !n.locked);
    const out: SyncFile = { app: 'DamianNote', kind: 'sync', v: 4, schema: SCHEMA_VERSION, device: deviceName(), exportedAt: new Date().toISOString(), notes: [], attachments: [] };
    const hashes = new Set<string>();
    for (const n of notes) {
      const got = await this.docOf(n.id);
      if (!got) continue;
      const { doc, engine } = got;
      const update = Y.encodeStateAsUpdate(doc);
      out.notes.push({ id: n.id, title: n.title, update: toB64(update) });
      for (const h of docAttachments(doc)) hashes.add(h);
      await this.store.putSync({ noteId: n.id, update, base: fingerprints(doc), syncedAt: Date.now(), known: [...knownIds(engine, doc)] });
      this.synced.add(n.id);
    }
    // 첨부(이미지 · 파일 · 녹음 · 커버)도 함께 — 없으면 받는 기기에서 그림 · 파일이 비어 보인다
    for (const h of hashes) {
      const a = await this.files.get(h).catch(() => undefined);
      if (a) out.attachments!.push({ hash: h, mime: a.mime, data: toB64(new Uint8Array(await a.blob.arrayBuffer())) });
    }
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    download(`DamianNote-sync-${stamp}.dnsync.json`, JSON.stringify(out), 'application/json');
    const locked = this.state.notes.length - notes.length;
    this.toast(`동기화 파일을 만들었어요 (노트 ${out.notes.length}개${locked ? ` · 잠긴 노트 ${locked}개 제외` : ''}). 다른 기기에서 가져오면 합쳐져요.`);
  }

  /** 동기화 파일 가져오기: 같은 노트는 합치고, 없던 노트는 새로, 공통 기록이 없는 노트는 사본으로 */
  async importSyncFile(file: File): Promise<void> {
    let data: unknown;
    try { data = JSON.parse(await file.text()); } catch { this.toast('동기화 파일을 읽지 못했어요.'); return; }
    if (!isSyncFile(data)) { this.toast('DamianNote 동기화 파일이 아니에요.'); return; }
    // 새 버전 앱이 만든 파일 — 모르는 필드를 잘못 합치지 않게 가져오지 않는다 (OD-15)
    if ((data.schema ?? 0) > SCHEMA_VERSION) { this.toast('새 버전 앱에서 만든 동기화 파일이에요. 앱을 업데이트한 뒤 가져와 주세요.'); return; }
    let merged = 0, created = 0, copied = 0, skipped = 0, conflicts = 0, badFiles = 0;
    // 첨부를 먼저 넣는다 (합친 노트를 그릴 때 이미지가 바로 보이게). 내용 해시를 다시 계산해 맞지 않으면 버린다
    for (const a of data.attachments ?? []) {
      if (typeof a?.hash !== 'string' || typeof a.data !== 'string') { badFiles++; continue; }
      if (await this.files.get(a.hash).catch(() => undefined)) continue;
      const h = await this.files.put(new Blob([fromB64(a.data) as Uint8Array<ArrayBuffer>], { type: typeof a.mime === 'string' ? a.mime : 'application/octet-stream' })).catch(() => null);
      if (h !== a.hash) badFiles++;
    }
    for (const n of data.notes) {
      const meta = this.state.notes.find((x) => x.id === n.id) ?? this.state.trash.find((x) => x.id === n.id);
      const update = fromB64(n.update);
      if (meta?.locked) { skipped++; continue; }
      if (!meta) { await this.createFromSync(n.id, update); created++; continue; }
      if (!this.synced.has(n.id)) { await this.createFromSync(n.id, update, `${n.title || '제목 없음'} (${data.device})`); copied++; continue; }
      conflicts += await this.mergeSyncInto(n.id, update);
      merged++;
    }
    await this.refreshList();
    this.toast([`동기화 파일을 합쳤어요: 합침 ${merged} · 새 노트 ${created}`, copied && `공통 기록이 없어 사본 ${copied}`, skipped && `잠긴 노트 ${skipped} 건너뜀`,
      conflicts && `충돌 ${conflicts}개 — 주황 테두리 블록에서 남기기 · 지우기를 골라 주세요`, badFiles && `읽지 못한 첨부 ${badFiles}개`].filter(Boolean).join(' · '));
  }

  private async createFromSync(id: Id, update: Uint8Array, copyTitle?: string): Promise<void> {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, update);
    const nm = doc.getMap<unknown>('note');
    const engine = new Engine({ note: { id: copyTitle ? newId() : id, title: String(copyTitle ?? nm.get('title') ?? ''), createdAt: Number(nm.get('createdAt') ?? Date.now()), updatedAt: Date.now() } });
    attach(engine, doc, { onRemote: this.onRemote, device: this.device }).detach();
    if (copyTitle) engine.transact((tx) => tx.setNote({ title: copyTitle }), { origin: 'load', undoable: false });
    const nid = await this.addEngine(engine);
    if (!copyTitle) { await this.store.putSync({ noteId: nid, update, base: fingerprints(doc), syncedAt: Date.now(), known: [...knownIds(engine, doc)] }); this.synced.add(nid); }
  }

  /** 동기화 노트에 다른 기기 기록을 합친다 — 충돌 블록 수 */
  private async mergeSyncInto(id: Id, update: Uint8Array): Promise<number> {
    const isOpen = this.open?.engine.note.id === id && !!this.live?.bridge;
    const st = await this.store.getSync(id).catch(() => null);
    let engine: Engine, doc: Y.Doc, session: NoteSession, finish: () => Promise<void>;
    if (isOpen) { engine = this.open!.engine; doc = this.live!.doc; session = this.open!.session; finish = async () => {}; }
    else {
      const r = await openNote(this.store, id);
      if (!r.ok) return 0;
      engine = r.engine;
      session = r.session;
      doc = new Y.Doc();
      if (st) Y.applyUpdate(doc, st.update);
      const b = attach(engine, doc, { onRemote: this.onRemote, prefer: 'engine', known: st?.known ? new Set(st.known) : null, device: this.device });
      finish = async () => {
        b.detach(); await r.session.dispose(); await this.putSearchDoc(engine);
        await this.meta.patch(id, { reminders: collectReminders(engine, { hideText: this.store.isLocked(id) }) });
      };
    }
    await this.store.saveVersion({ noteId: id, reason: 'before-sync', title: engine.note.title, blocks: engine.blockCount }, serialize(engine)).catch(() => null);
    const conflicted = () => new Set([...engine.blocks()].filter((b) => b.conflict).map((b) => b.id));
    const before = conflicted();
    const found: Conflict[] = mergeRemote(doc, update, st?.base ?? null);
    // 지우기 ↔ 고치기 충돌: 고친 쪽 내용으로 되살려 표시 (이 되살림도 Y 기록에 들어가 다음 동기화 때 상대 기기로 간다)
    if (found.length) {
      engine.transact((tx) => {
        for (const c of found) {
          if (engine.getBlock(c.blockId)) continue;
          tx.createBlock({ ...(c.bundle.block as Record<string, unknown>), conflict: { kind: c.kind, at: Date.now() } } as never);
          for (const ct of c.bundle.contents) tx.createContent(ct as never);
        }
      }, { origin: 'user', label: '동기화 충돌 블록 되살리기' });
    }
    await this.store.saveVersion({ noteId: id, reason: 'sync', title: engine.note.title, blocks: engine.blockCount }, serialize(engine)).catch(() => null);
    // 합친 내용을 엔진 로그에 먼저 쓴 뒤 Y 기록을 (persistSync와 같은 순서)
    await session.flush().catch(() => {});
    await this.store.putSync({ noteId: id, update: Y.encodeStateAsUpdate(doc), base: fingerprints(doc), syncedAt: Date.now(), known: [...knownIds(engine, doc)] });
    // 충돌 수 = 이번에 새로 충돌 표시가 붙은 블록 (묘비 보류로 살아난 것 + 예전 방식 되살리기)
    const n = [...conflicted()].filter((b) => !before.has(b)).length;
    await finish();
    return n;
  }
}
