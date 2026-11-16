// 노트 열기 · 자동 저장 (FR-089 · FR-090). 커밋된 트랜잭션을 300ms 디바운스(최대 1초)로 로그에 쓰고,
// 로그 500건 · 유휴 30초 · 페이지 숨김 때 스냅샷으로 압축한다 (ENGINE 12.5).
import { deserialize, Engine, serialize, SCHEMA_VERSION, type ChangeEvent, type Id } from '@dn/engine-core';
import type { IdbNoteStore, LoadedNote, LogRecord, ViewRecord } from './note-store';

export type SaveStatus = 'saved' | 'pending' | 'saving' | 'error' | 'readonly';

const DEBOUNCE_MS = 300;
const MAX_DELAY_MS = 1000;
const COMPACT_AFTER = 500;
const IDLE_COMPACT_MS = 30_000;
/** 노트를 닫을 때 압축할 로그 길이 — 이보다 짧으면 다음 열기 때 재생하는 편이 싸다 */
const CLOSE_COMPACT_AFTER = 100;
/** 쓰기 실패 뒤 다시 시도 간격 (MSG-SAVE-004: 1 · 2 · 4초, 그 뒤로는 10초마다) */
const RETRY_MS = [1000, 2000, 4000, 10_000];

export type OpenResult =
  | { ok: true; engine: Engine; session: NoteSession; view?: ViewRecord; warning?: string }
  | { ok: false; reason: 'not-found' | 'newer-version' | 'invalid'; detail?: string };

export async function openNote(store: IdbNoteStore, noteId: Id): Promise<OpenResult> {
  const loaded = await store.load(noteId);
  if (!loaded) return { ok: false, reason: 'not-found' };
  const snapVersion = (loaded.snapshot as { schemaVersion?: number } | undefined)?.schemaVersion;
  if (typeof snapVersion === 'number' && snapVersion < SCHEMA_VERSION) return openOlder(store, noteId, loaded, snapVersion);
  let engine: Engine;
  let warning: string | undefined;
  let readonly = false;
  if (loaded.snapshot !== undefined) {
    // 상위 버전도 열린 파싱으로 읽되 읽기 전용으로 연다 (FR-090: 덮어쓰지 않고 경고)
    const r = deserialize(loaded.snapshot, { allowNewer: true });
    if (!r.ok) {
      if (r.reason === 'newer-version') return { ok: false, reason: 'newer-version', detail: `v${r.version}` };
      await store.backup(noteId, 'corrupt-snapshot', loaded.snapshot);
      return { ok: false, reason: 'invalid', detail: r.errors.join('; ') };
    }
    if (r.migratedFrom !== undefined) await store.backup(noteId, 'migration', loaded.snapshot);
    engine = new Engine(r.data);
    if (r.newer !== undefined) {
      readonly = true;
      warning = '새 버전 앱에서 저장된 노트라서 읽기 전용으로 열었어요. 앱을 업데이트하면 편집할 수 있어요.';
    }
  } else {
    engine = new Engine({ note: { id: noteId, title: '', createdAt: Date.now(), updatedAt: Date.now() } });
  }
  let seq = loaded.upToSeq;
  for (const rec of readonly ? [] : loaded.log) {
    if (rec.schemaVersion > SCHEMA_VERSION) { readonly = true; warning = '새 버전 앱에서 저장된 변경이 있어 읽기 전용으로 열었어요. 앱을 업데이트하면 편집할 수 있어요.'; break; }
    const failed = engine.replay(rec.ops);
    if (failed > 0) {
      // 손상된 로그: 그 지점에서 멈추고 원본 로그는 백업 (ENGINE 12.5)
      await store.backup(noteId, 'corrupt-log', loaded.log);
      warning = '저장 기록 일부를 읽지 못해 마지막 정상 상태로 열었어요. 원본은 백업해 두었어요.';
      break;
    }
    seq = rec.seq;
  }
  engine.clearHistory();
  const session = new NoteSession(store, engine, seq, readonly, readonly ? 0 : seq - loaded.upToSeq);
  return { ok: true, engine, session, view: loaded.view, warning };
}

/**
 * 저장하지 않고 읽기만 한다 — 검색 색인처럼 파생 데이터를 만들 때 (열린 세션 · 백업 · 재압축 없음).
 * 구버전이면 메모리에서만 마이그레이션한다. 읽지 못하면 null.
 */
export async function readNote(store: IdbNoteStore, noteId: Id): Promise<Engine | null> {
  const loaded = await store.load(noteId);
  if (!loaded) return null;
  const v = (loaded.snapshot as { schemaVersion?: number } | undefined)?.schemaVersion;
  if (typeof v === 'number' && v < SCHEMA_VERSION) {
    const m = migrateOlder(loaded, v);
    return 'error' in m ? null : new Engine(m.migrated.data);
  }
  let engine: Engine;
  if (loaded.snapshot !== undefined) {
    const r = deserialize(loaded.snapshot, { allowNewer: true });
    if (!r.ok) return null;
    engine = new Engine(r.data);
  } else {
    engine = new Engine({ note: { id: noteId, title: '', createdAt: 0, updatedAt: 0 } });
  }
  for (const rec of loaded.log) {
    if (rec.schemaVersion > SCHEMA_VERSION || engine.replay(rec.ops) > 0) break;
  }
  return engine;
}

/**
 * 구버전 노트 (FR-090 "구버전 데이터 로드 시 자동 마이그레이션 후 재저장").
 * 구버전 연산 로그는 구버전 문서 형태를 전제로 하므로, 구버전 그대로 스냅샷 + 로그를 재생한 다음 마이그레이션한다.
 * 그 뒤 원본(스냅샷 + 로그)을 백업하고 새 버전 스냅샷으로 바로 압축해 다시 열 때는 정상 경로를 탄다.
 * 어느 단계든 실패하면 원본은 건드리지 않고 백업만 남긴다.
 */
async function openOlder(store: IdbNoteStore, noteId: Id, loaded: LoadedNote, version: number): Promise<OpenResult> {
  const fail = async (detail: string): Promise<OpenResult> => {
    await store.backup(noteId, 'migration-failed', { snapshot: loaded.snapshot, log: loaded.log });
    return { ok: false, reason: 'invalid', detail };
  };
  const m = migrateOlder(loaded, version);
  if ('error' in m) return fail(m.error);
  const engine = new Engine(m.migrated.data);
  await store.backup(noteId, `migration-v${version}`, { snapshot: loaded.snapshot, log: loaded.log });
  await store.compact(noteId, serialize(engine, m.migrated.extra), m.seq);
  return { ok: true, engine, session: new NoteSession(store, engine, m.seq, false), view: loaded.view };
}

/** 구버전 그대로 스냅샷 + 로그를 재생한 다음 마이그레이션. seq = 재생한 마지막 로그 */
function migrateOlder(loaded: LoadedNote, version: number): { migrated: Extract<ReturnType<typeof deserialize>, { ok: true }>; seq: number } | { error: string } {
  const why = (r: { reason: 'newer-version' } | { reason: 'invalid'; errors: string[] }) => (r.reason === 'invalid' ? r.errors.join('; ') : r.reason);
  const old = deserialize(loaded.snapshot, { noMigrate: true });
  if (!old.ok) return { error: why(old) };
  const legacy = new Engine(old.data);
  let seq = loaded.upToSeq;
  for (const rec of loaded.log) {
    if (legacy.replay(rec.ops) > 0) break; // 손상된 꼬리는 버리고 그 앞까지 (원본은 백업에 남는다)
    seq = rec.seq;
  }
  const migrated = deserialize(serialize(legacy, old.extra, version));
  return migrated.ok ? { migrated, seq } : { error: why(migrated) };
}

export async function createNote(store: IdbNoteStore, engine: Engine): Promise<NoteSession> {
  await store.compact(engine.note.id, serialize(engine), 0);
  return new NoteSession(store, engine, 0, false);
}

export class NoteSession {
  private queue: LogRecord[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private firstQueuedAt = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private sinceCompact = 0;
  private writing: Promise<void> = Promise.resolve();
  private _status: SaveStatus;
  private readonly listeners = new Set<(s: SaveStatus) => void>();
  private readonly unsub: () => void;
  private disposed = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retries = 0;
  private _lastError: unknown = null;

  constructor(
    private readonly store: IdbNoteStore,
    readonly engine: Engine,
    private seq: number,
    readonly readonly: boolean,
    /** 열 때 스냅샷 밖에 남아 있던 로그 수 — 0이면 바뀐 것 없이 닫을 때 압축(전체 재저장)을 건너뛴다 */
    logOnOpen = 0,
  ) {
    this.sinceCompact = logOnOpen;
    this._status = readonly ? 'readonly' : 'saved';
    this.unsub = engine.subscribe((e) => this.onChange(e));
    globalThis.addEventListener?.('pagehide', this.onHide);
    globalThis.document?.addEventListener('visibilitychange', this.onVisibility);
  }

  get status(): SaveStatus { return this._status; }

  /** 마지막 쓰기 실패 원인 (QuotaExceededError면 저장 공간 안내) — 성공하면 null */
  get lastError(): unknown { return this._lastError; }

  /** 쓰기에 실패하면 편집이 없어도 다시 시도한다 — 안 그러면 다음 편집 전까지 메모리에만 남는다 (배포 QA E4) */
  private failed(err: unknown): void {
    this._lastError = err;
    this.setStatus('error');
    if (this.retryTimer || this.disposed) return;
    const ms = RETRY_MS[Math.min(this.retries++, RETRY_MS.length - 1)]!;
    this.retryTimer = setTimeout(() => { this.retryTimer = null; void this.compact(); }, ms);
  }

  private succeeded(): void {
    this._lastError = null;
    this.retries = 0;
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
  }

  onStatus(fn: (s: SaveStatus) => void): () => void {
    this.listeners.add(fn);
    fn(this._status);
    return () => { this.listeners.delete(fn); };
  }

  private setStatus(s: SaveStatus): void {
    if (s === this._status) return;
    this._status = s;
    for (const fn of this.listeners) fn(s);
  }

  private onChange(e: ChangeEvent): void {
    if (this.readonly || this.disposed || e.origin === 'load') return;
    this.queue.push({
      noteId: this.engine.note.id, seq: ++this.seq, txId: e.txId, origin: e.origin,
      ops: e.ops, at: Date.now(), schemaVersion: SCHEMA_VERSION,
    });
    this.setStatus('pending');
    const now = Date.now();
    if (!this.firstQueuedAt) this.firstQueuedAt = now;
    if (this.timer) clearTimeout(this.timer);
    const wait = Math.min(DEBOUNCE_MS, Math.max(0, this.firstQueuedAt + MAX_DELAY_MS - now));
    this.timer = setTimeout(() => void this.flushLog(), wait);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => void this.compact(), IDLE_COMPACT_MS);
  }

  private flushLog(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.firstQueuedAt = 0;
    const batch = this.queue;
    if (!batch.length) return this.writing;
    this.queue = [];
    this.writing = this.writing.then(async () => {
      this.setStatus('saving');
      try {
        await this.store.appendLog(batch);
        this.sinceCompact += batch.length;
        this.succeeded();
        this.setStatus(this.queue.length ? 'pending' : 'saved');
        if (this.sinceCompact >= COMPACT_AFTER) await this.compactNow();
      } catch (err) {
        // 쓰기 실패: 다시 큐 앞에 넣고 오류 표시 (FR-091). 메모리 상태는 그대로 유지된다.
        this.queue = [...batch, ...this.queue];
        this.failed(err);
        console.error('[dn] 저장 실패', err);
      }
    });
    return this.writing;
  }

  /** 스냅샷과 seq를 같은 동기 시점에 잡는다 — 대기 중인 로그는 스냅샷에 이미 반영돼 있으므로 쓰지 않는다. */
  private async compactNow(): Promise<void> {
    const pending = this.queue;
    this.queue = [];
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.firstQueuedAt = 0;
    const snapshot = serialize(this.engine);
    const upTo = this.seq;
    try {
      this.setStatus('saving');
      await this.store.compact(this.engine.note.id, snapshot, upTo);
      this.sinceCompact = 0;
      this.succeeded();
      this.setStatus(this.queue.length ? 'pending' : 'saved');
    } catch (err) {
      this.queue = [...pending, ...this.queue];
      throw err;
    }
  }

  /**
   * 대기 중인 로그를 쓰고 스냅샷으로 압축한다. 마지막 압축 뒤 바뀐 게 없으면 아무것도 하지 않는다 —
   * 1만 블록 노트에서 압축은 직렬화 + 전체 쓰기로 100ms가 넘어, 노트 전환마다 하면 그대로 열기 지연이 된다 (FR-008 · FR-147).
   */
  async compact(): Promise<void> {
    if (this.readonly) return;
    await this.flushLog();
    if (this.sinceCompact === 0 && this.queue.length === 0) return this.writing;
    this.writing = this.writing.then(() => this.compactNow()).catch((err) => { this.failed(err); console.error(err); });
    return this.writing;
  }

  async flush(): Promise<void> { await this.flushLog(); }

  saveView(v: Omit<ViewRecord, 'noteId'>): void {
    void this.store.saveView({ noteId: this.engine.note.id, ...v }).catch(() => {});
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    // 닫을 때는 로그만 쓴다 — 로그는 이미 디스크에 있으니 압축(1만 블록이면 직렬화 + 전체 쓰기 100ms+)은 노트 전환을 늦출 뿐이다.
    // 로그가 길면(다음 열기의 재생 비용) 그때만 압축한다. 평소 압축은 유휴 30초 · 500건 · 페이지 숨김에서.
    if (this.sinceCompact + this.queue.length >= CLOSE_COMPACT_AFTER) await this.compact();
    else await this.flushLog();
    this.disposed = true;
    this.unsub();
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    globalThis.removeEventListener?.('pagehide', this.onHide);
    globalThis.document?.removeEventListener('visibilitychange', this.onVisibility);
  }

  private onHide = (): void => { void this.compact(); };
  private onVisibility = (): void => { if (globalThis.document?.visibilityState === 'hidden') void this.compact(); };
}
