// NoteStore IndexedDB 구현: 노트당 스냅샷 1건 + 추가 전용 연산 로그 (ENGINE 12.5 · 12.6, DATABASE 4.2).
import type { Id, NoteSnapshot, Op, Origin } from '@dn/engine-core';
import { done, openDb, req, write, type DbHooks } from './idb';
import { isSealed, VaultLockedError, type Sealed, type VaultCipher } from './vault';

export interface LogRecord {
  noteId: Id;
  seq: number;
  txId: string;
  origin: Origin;
  ops: readonly Op[];
  at: number;
  schemaVersion: number;
}

/** 보던 자리. center면 x · y는 화면 가운데의 월드 좌표 (없으면 예전 기록 — 왼쪽 위) */
export interface ViewRecord { noteId: Id; x: number; y: number; zoom: number; center?: true }

export interface LoadedNote { snapshot: unknown; upToSeq: number; log: LogRecord[]; view?: ViewRecord }

const DB_NAME = 'dn-notes';
const DB_VERSION = 3;
const MAX_BACKUPS_PER_NOTE = 5;
/** 노트당 버전 기록 한도 (FR-093) — 넘으면 오래된 것부터 지운다 */
export const MAX_VERSIONS_PER_NOTE = 30;

/** 기기 사이 동기화 상태: 노트의 Y 기록(전체) · 마지막 동기화 때 블록 지문 · 그 시각 */
export interface SyncState {
  noteId: Id; update: Uint8Array; base: Record<string, string> | null; syncedAt: number;
  /** 저장할 때 엔진 · Y 양쪽에 다 있던 엔티티 id (@dn/sync knownIds) — 다시 이어 붙일 때 "이쪽이 지운 것"과 "아직 안 들어온 것"을 가른다. 예전 기록엔 없다 */
  known?: Id[];
}

/** 버전 기록 한 건 (FR-093) — 목록에는 snapshot 없이 */
export interface VersionInfo { noteId: Id; at: number; reason: VersionReason; title: string; blocks: number }
export type VersionReason = 'auto' | 'close' | 'before-ai' | 'before-restore' | 'before-replace' | 'manual' | 'before-sync' | 'sync';

/**
 * 잠긴 노트(FR-144 · FR-146)는 스냅샷 · 연산 로그 · 버전 · 백업을 금고 열쇠로 암호화해 저장한다({sealed}).
 * 읽을 때는 기록 모양으로 알아보고(sealed가 있으면 잠긴 노트), 금고가 잠겨 있으면 VaultLockedError.
 */
export class IdbNoteStore {
  private vault: VaultCipher | null = null;
  private readonly lockedIds = new Set<Id>();
  private constructor(private readonly db: IDBDatabase) {}

  /** 풀린 금고 (null = 잠금) */
  setVault(c: VaultCipher | null): void { this.vault = c; }
  /** 이 노트를 암호화해 쓴다 (앱이 메타의 locked로 알려 준다) */
  markLocked(noteId: Id, on: boolean): void { if (on) this.lockedIds.add(noteId); else this.lockedIds.delete(noteId); }
  isLocked(noteId: Id): boolean { return this.lockedIds.has(noteId); }
  private cipher(noteId: Id): VaultCipher {
    if (!this.vault) throw new VaultLockedError(noteId);
    return this.vault;
  }
  private seal(noteId: Id, v: unknown): Promise<Sealed> { return this.cipher(noteId).seal(v); }
  private unseal<T>(noteId: Id, s: Sealed): Promise<T> { return this.cipher(noteId).open<T>(s); }

  static async open(name = DB_NAME, hooks: DbHooks = {}): Promise<IdbNoteStore> {
    const db = await openDb(name, DB_VERSION, (db, old) => {
      if (old < 1) {
        db.createObjectStore('snapshots', { keyPath: 'noteId' });
        db.createObjectStore('oplog', { keyPath: ['noteId', 'seq'] });
        db.createObjectStore('views', { keyPath: 'noteId' });
        const b = db.createObjectStore('backups', { keyPath: ['noteId', 'key'] });
        b.createIndex('by_note', 'noteId');
      }
      // v2: 버전 기록 (FR-093) — [노트, 시각]
      if (old < 2) db.createObjectStore('versions', { keyPath: ['noteId', 'at'] });
      // v3: 기기 사이 동기화 상태 (FR-096 · 097) — 노트의 Y 기록 · 마지막 동기화 때 블록 지문
      if (old < 3) db.createObjectStore('ysync', { keyPath: 'noteId' });
    }, hooks);
    return new IdbNoteStore(db);
  }

  close(): void { this.db.close(); }

  async load(noteId: Id): Promise<LoadedNote | null> {
    const tx = this.db.transaction(['snapshots', 'oplog', 'views'], 'readonly');
    const [snap, log, view] = await Promise.all([
      req(tx.objectStore('snapshots').get(noteId)) as Promise<{ snapshot: unknown; upToSeq: number } | undefined>,
      req(tx.objectStore('oplog').getAll(IDBKeyRange.bound([noteId, 0], [noteId, Infinity]))) as Promise<LogRecord[]>,
      req(tx.objectStore('views').get(noteId)) as Promise<ViewRecord | undefined>,
    ]);
    if (!snap && log.length === 0) return null;
    const sealedSnap = snap && isSealed((snap as { sealed?: unknown }).sealed);
    const sealedLog = log.some((r) => isSealed((r as { sealed?: unknown }).sealed));
    if (sealedSnap || sealedLog) {
      this.lockedIds.add(noteId);
      const snapshot = sealedSnap ? await this.unseal(noteId, (snap as unknown as { sealed: Sealed }).sealed) : snap?.snapshot;
      const plain: LogRecord[] = [];
      for (const r of log) plain.push(isSealed((r as { sealed?: unknown }).sealed) ? { ...(await this.unseal<LogRecord>(noteId, (r as unknown as { sealed: Sealed }).sealed)), noteId, seq: r.seq } : r);
      return { snapshot, upToSeq: snap?.upToSeq ?? 0, log: plain, view };
    }
    return { snapshot: snap?.snapshot, upToSeq: snap?.upToSeq ?? 0, log, view };
  }

  async appendLog(records: readonly LogRecord[]): Promise<void> {
    if (!records.length) return;
    // 암호화는 트랜잭션을 열기 전에 (IDB 트랜잭션은 await를 건너면 저절로 닫힌다)
    const rows: unknown[] = [];
    for (const r of records) rows.push(this.lockedIds.has(r.noteId) ? { noteId: r.noteId, seq: r.seq, sealed: await this.seal(r.noteId, r) } : r);
    await write(this.db, 'oplog', (s) => { for (const r of rows) s.put(r); });
  }

  /** 스냅샷 재기록 + 흡수된 로그 삭제를 IDB 트랜잭션 하나로 (원자적). */
  async compact(noteId: Id, snapshot: NoteSnapshot, upToSeq: number): Promise<void> {
    const rec = this.lockedIds.has(noteId)
      ? { noteId, schemaVersion: snapshot.schemaVersion, sealed: await this.seal(noteId, snapshot), upToSeq, savedAt: Date.now() }
      : { noteId, schemaVersion: snapshot.schemaVersion, snapshot, upToSeq, savedAt: Date.now() };
    const tx = this.db.transaction(['snapshots', 'oplog'], 'readwrite');
    tx.objectStore('snapshots').put(rec);
    tx.objectStore('oplog').delete(IDBKeyRange.bound([noteId, 0], [noteId, upToSeq]));
    await done(tx);
  }

  saveView(v: ViewRecord): Promise<void> { return write(this.db, 'views', (s) => s.put(v)); }

  /** 손상 · 마이그레이션 전 원본 보존 (FR-090 · FR-149). 노트당 최근 5건만 유지. */
  async backup(noteId: Id, reason: string, data: unknown): Promise<void> {
    const body = this.lockedIds.has(noteId) ? { sealed: await this.seal(noteId, data) } : { data };
    const tx = this.db.transaction('backups', 'readwrite');
    const s = tx.objectStore('backups');
    const at = Date.now();
    s.put({ noteId, key: `${reason}-${at}`, reason, ...body, at });
    const keys = (await req(s.index('by_note').getAllKeys(noteId))) as [Id, string][];
    keys.sort((a, b) => (a[1] < b[1] ? -1 : 1));
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX_BACKUPS_PER_NOTE))) s.delete(k);
    await done(tx);
  }

  async deleteNote(noteId: Id): Promise<void> {
    const tx = this.db.transaction(['snapshots', 'oplog', 'views', 'versions', 'ysync'], 'readwrite');
    tx.objectStore('snapshots').delete(noteId);
    tx.objectStore('oplog').delete(IDBKeyRange.bound([noteId, 0], [noteId, Infinity]));
    tx.objectStore('views').delete(noteId);
    tx.objectStore('versions').delete(IDBKeyRange.bound([noteId, 0], [noteId, Infinity]));
    tx.objectStore('ysync').delete(noteId);
    await done(tx);
  }

  // ───────── 버전 기록 (FR-093) ─────────

  /** 스냅샷 한 벌을 버전으로 남기고, 한도를 넘으면 오래된 것부터 지운다 */
  async saveVersion(info: Omit<VersionInfo, 'at'> & { at?: number }, snapshot: NoteSnapshot): Promise<VersionInfo> {
    const sealedSnap = this.lockedIds.has(info.noteId) ? await this.seal(info.noteId, snapshot) : null;
    const tx = this.db.transaction('versions', 'readwrite');
    const s = tx.objectStore('versions');
    const v: VersionInfo = { noteId: info.noteId, at: info.at ?? Date.now(), reason: info.reason, title: info.title, blocks: info.blocks };
    s.put(this.lockedIds.has(info.noteId) ? { ...v, sealed: sealedSnap } : { ...v, snapshot });
    const range = IDBKeyRange.bound([info.noteId, 0], [info.noteId, Infinity]);
    const keys = (await req(s.getAllKeys(range))) as [Id, number][];
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX_VERSIONS_PER_NOTE))) s.delete(k);
    await done(tx);
    return v;
  }

  /** 새것부터 */
  async listVersions(noteId: Id): Promise<VersionInfo[]> {
    const tx = this.db.transaction('versions', 'readonly');
    const all = (await req(tx.objectStore('versions').getAll(IDBKeyRange.bound([noteId, 0], [noteId, Infinity])))) as (VersionInfo & { snapshot: unknown })[];
    return all.map(({ snapshot: _s, sealed: _x, ...v }: VersionInfo & { snapshot?: unknown; sealed?: unknown }) => v).sort((a, b) => b.at - a.at);
  }

  async getVersion(noteId: Id, at: number): Promise<unknown | null> {
    const tx = this.db.transaction('versions', 'readonly');
    const r = (await req(tx.objectStore('versions').get([noteId, at]))) as { snapshot?: unknown; sealed?: Sealed } | undefined;
    if (r?.sealed) return this.unseal(noteId, r.sealed);
    return r?.snapshot ?? null;
  }

  // ───────── 잠그기 · 풀기 (FR-144 · FR-146) ─────────

  /**
   * 노트를 잠그거나(암호화) 푼다: 지금 내용(snapshot — 저장된 로그까지 반영된 엔진에서 찍은 것)을 새 형태로 다시 쓰고 연산 로그는 비운다.
   * 버전 기록도 같은 형태로 바꿔 쓰고, 원본 보존 백업(평문일 수 있음)은 지운다. 잠그든 풀든 금고가 열려 있어야 한다.
   */
  async setNoteLocked(noteId: Id, on: boolean, snapshot: NoteSnapshot): Promise<void> {
    this.cipher(noteId);
    const range = IDBKeyRange.bound([noteId, 0], [noteId, Infinity]);
    const r0 = this.db.transaction(['oplog', 'versions'], 'readonly');
    const [logKeys, versions] = await Promise.all([
      req(r0.objectStore('oplog').getAllKeys(range)) as Promise<[Id, number][]>,
      req(r0.objectStore('versions').getAll(range)) as Promise<(VersionInfo & { snapshot?: unknown; sealed?: Sealed })[]>,
    ]);
    // 동기화 노트의 Y 기록도 같은 형태로 — 안 바꾸면 잠근 뒤에도 평문 Y 기록(노트 내용 전부)이 남는다
    const sync = await this.getSync(noteId);
    const upToSeq = Math.max(0, ...logKeys.map((k) => k[1]));
    const plainVersions: (VersionInfo & { snapshot: unknown })[] = [];
    for (const v of versions) {
      const { sealed, snapshot: snap, ...info } = v;
      plainVersions.push({ ...info, snapshot: sealed ? await this.unseal(noteId, sealed) : snap });
    }
    this.markLocked(noteId, on);
    const snapRec = on
      ? { noteId, schemaVersion: snapshot.schemaVersion, sealed: await this.seal(noteId, snapshot), upToSeq, savedAt: Date.now() }
      : { noteId, schemaVersion: snapshot.schemaVersion, snapshot, upToSeq, savedAt: Date.now() };
    const versionRecs: unknown[] = [];
    for (const v of plainVersions) {
      const { snapshot: snap, ...info } = v;
      versionRecs.push(on ? { ...info, sealed: await this.seal(noteId, snap) } : v);
    }
    const syncRec = sync ? await this.syncRecord(sync) : null;
    const tx = this.db.transaction(['snapshots', 'oplog', 'versions', 'backups', 'ysync'], 'readwrite');
    tx.objectStore('snapshots').put(snapRec);
    if (syncRec) tx.objectStore('ysync').put(syncRec);
    tx.objectStore('oplog').delete(range);
    for (const v of versionRecs) tx.objectStore('versions').put(v);
    const b = tx.objectStore('backups');
    for (const k of (await req(b.index('by_note').getAllKeys(noteId))) as IDBValidKey[]) b.delete(k);
    await done(tx);
  }

  // ───────── 기기 사이 동기화 상태 (FR-096 · 097) ─────────

  /** 동기화하는 노트의 Y 기록 · 기준 지문 (잠긴 노트면 암호화된 채로 저장돼 있다) */
  async getSync(noteId: Id): Promise<SyncState | null> {
    const r = (await req(this.db.transaction('ysync').objectStore('ysync').get(noteId))) as (Partial<SyncState> & { sealed?: Sealed }) | undefined;
    if (!r) return null;
    return r.sealed ? this.unsealSync(noteId, r.sealed) : (r as SyncState);
  }

  private async unsealSync(noteId: Id, s: Sealed): Promise<SyncState> {
    const v = await this.unseal<{ update: number[]; base: Record<string, string> | null; syncedAt: number; known?: Id[] }>(noteId, s);
    return { noteId, update: new Uint8Array(v.update), base: v.base, syncedAt: v.syncedAt, ...(v.known ? { known: v.known } : {}) };
  }

  /** 저장할 모양 — 잠긴 노트면 암호화 */
  private async syncRecord(st: SyncState): Promise<unknown> {
    if (!this.lockedIds.has(st.noteId)) return st;
    return { noteId: st.noteId, sealed: await this.seal(st.noteId, { update: [...st.update], base: st.base, syncedAt: st.syncedAt, ...(st.known ? { known: st.known } : {}) }) };
  }

  async putSync(st: SyncState): Promise<void> {
    const rec = await this.syncRecord(st);
    await write(this.db, 'ysync', (s) => s.put(rec));
  }

  async listSyncIds(): Promise<Id[]> {
    return (await req(this.db.transaction('ysync').objectStore('ysync').getAllKeys())) as Id[];
  }
}
